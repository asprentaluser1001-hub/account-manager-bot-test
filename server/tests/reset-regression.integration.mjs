import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const dir = mkdtempSync(join(tmpdir(), 'reset-regression-'));
process.env.DB_PATH = join(dir, 'test.sqlite');
process.env.SANDBOX_MODE = 'false';
process.env.V3_PREVIEW = 'false';
process.env.TELEGRAM_BOT_TOKEN = '';
const { db } = require('../dist/db.js');
const { runResetJob, withResetStopped } = require('../dist/lib/resetJobs.js');
const { chromium, errors } = require('playwright');
const { resetAccountPassword } = require('../dist/lib/passwordReset.js');
require('../dist/lib/v3Features.js'); // Apply the same booking migrations as server startup.
after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
const defer = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('different accounts share one FIFO browser slot; queued cancellation does not open another slot', async () => {
  const started = defer(), finish = defer();
  const calls = [];
  const first = runResetJob('first', async () => { calls.push('first'); started.resolve(); await finish.promise; return { success: true }; });
  await started.promise;
  const cancelled = runResetJob('cancelled', async () => { assert.fail('Cancelled job ran'); });
  const last = runResetJob('last', async () => { calls.push('last'); return { success: true }; });
  await withResetStopped('cancelled', () => {});
  assert.equal((await cancelled).success, false);
  assert.deepEqual(calls, ['first']);
  assert.equal((await runResetJob('first', async () => ({ success: true }))).success, false);
  finish.resolve();
  assert.equal((await first).success, true);
  assert.equal((await last).success, true);
  assert.deepEqual(calls, ['first', 'last']);
});

test('a failed job releases the slot for other accounts', async () => {
  const failure = runResetJob('throws', async () => { throw new Error('Browser unavailable'); });
  const next = runResetJob('next', async () => ({ success: true }));
  assert.equal((await failure).success, false);
  assert.equal((await next).success, true);
});

test('the execution deadline is retryable while an explicit cancellation is not',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  try{
    const started=defer();
    const timed=runResetJob('deadline-classification',signal=>new Promise((_resolve,reject)=>{
      signal.addEventListener('abort',()=>reject(signal.reason),{once:true});started.resolve();
    }));
    await started.promise;t.mock.timers.tick(120_000);
    const result=await timed;
    assert.equal(result.retryable,true);assert.equal(result.errorCode,'timeout');
    const parent=new AbortController(),ready=defer();
    const cancelled=runResetJob('cancel-classification',signal=>new Promise((_resolve,reject)=>{
      signal.addEventListener('abort',()=>reject(signal.reason),{once:true});ready.resolve();
    }),parent.signal);
    await ready.promise;parent.abort(new Error('Stopped by admin'));
    const stopped=await cancelled;
    assert.equal(stopped.retryable,false);assert.equal(stopped.errorCode,'cancelled');
  }finally{t.mock.timers.reset();}
});

function addAccount(id, candidate = null) {
  db.prepare('INSERT INTO accounts(id,name,email,password,reset_candidate_password,created_at) VALUES (?,?,?,?,?,?)')
    .run(id, id, id + '@example.invalid', 'old-password', candidate, new Date().toISOString());
}
function account(id) { return db.prepare('SELECT * FROM accounts WHERE id=?').get(id); }

// The browser model changes its external password only when submission completes.
// Authenticated selectors reject invalid credentials, including in a fresh profile.
function fakeBrowser(initialPassword, { failVerification = false, submissionTimeout = false, navigationError = null,
  initialStatus = 200, verificationStatus = 200, verificationTitle = 'Flingster', deferSubmission = false, submissionError = null, hangVerification = false } = {}) {
  let external = initialPassword, launches = 0, submissions = 0;
  let pending;
  const logins = [], events = [], contexts = [], launchOptions = [], pendingNavigations = [];
  const model = {
    engines: 0,
    logins, events, contexts, launchOptions,
    get external() { return external; },
    get submissions() { return submissions; },
    newContext: async options => {
      launchOptions.push(structuredClone(options));
      const launch = ++launches;
      if (pending) {
        assert.equal(contexts[0].closed, false, 'pending submission must survive verification startup');
        external = pending;
        pending = null;
      }
      const fields = {};
      let loggedIn = false, submitted = false;
      const page = {
        setDefaultTimeout() {}, setDefaultNavigationTimeout() {},
        goto: async () => {
          if(hangVerification && launch>1)return new Promise((_resolve,reject)=>pendingNavigations.push(reject));
          return {status:()=>launch===1?initialStatus:verificationStatus};
        },
        title: async () => launch === 1 ? 'Flingster' : verificationTitle,
        getByText: () => ({ all: async () => [] }),
        fill: async (s, v) => { fields[s] = v; },
        click: async s => {
          if (s === 'button.rlt-login') {
            logins.push(fields['#user-pass']);
            loggedIn = fields['#user-pass'] === external;
          }
          if (s === 'button.rlt-change-pass') {
            assert.equal(loggedIn, true);
            const candidate = fields['#chng-new-pass'];
            if (deferSubmission) pending = candidate;
            else external = candidate;
            submissions++; submitted = true;
            assert.equal(db.prepare('SELECT reset_candidate_password FROM accounts WHERE email=?').get(fields['#user-email']).reset_candidate_password, candidate);
          }
        },
        locator: () => ({ isVisible: async () => loggedIn, click: async () => {} }),
        waitForSelector: async s => {
          if (s === '.mw-user.red-lnk' || s === '.fi-pencil.chn-pass-mdl') {
            if (!loggedIn && navigationError) throw new (require('../dist/lib/resetNavigation.js').ResetNavigationError)('Explicit login failure',navigationError);
            if (!loggedIn || (failVerification && launch > 1)) throw new Error('Authenticated page timed out');
            events.push('authenticated');
          }
        },
        waitForFunction: async () => {
          assert.equal(submitted, true);
          events.push('submission-complete');
          if (submissionError) throw submissionError;
          if (submissionTimeout) throw new errors.TimeoutError('Submission confirmation timed out');
        },
      };
      const context = { closed: false, pages: () => [page], close: async () => { context.closed = true; } };
      contexts.push(context);
      return context;
    },
  };
  model.launch=async()=>{
    model.engines++;
    return {newContext:model.newContext,close:async()=>{
      for(const context of contexts)context.closed=true;
      for(const reject of pendingNavigations)reject(new Error('Browser closed'));
    }};
  };
  return model;
}
async function withBrowser(fake, work) {
  const original = chromium.launch;
  const navigation=require('../dist/lib/resetNavigation.js');
  const originals={openResetLogin:navigation.openResetLogin,openVerificationLogin:navigation.openVerificationLogin,findResetAccount:navigation.findResetAccount};
  navigation.openResetLogin=navigation.openVerificationLogin=async page=>page.waitForSelector('#user-email',{state:'visible'});
  navigation.findResetAccount=async page=>{
    await page.waitForSelector('.mw-user.red-lnk',{state:'visible'});
    return {click:async()=>page.click('.mw-user.red-lnk')};
  };
  chromium.launch = fake.launch;
  try { return await work(); }
  finally { chromium.launch = original; Object.assign(navigation,originals); }
}

test('normal reset uses one engine and verifies in an isolated context before saving', async () => {
  addAccount('normal');
  const fake = fakeBrowser('old-password');
  const result = await withBrowser(fake, () => resetAccountPassword('normal'));
  assert.equal(result.success, true);
  assert.equal(account('normal').password, fake.external);
  assert.equal(account('normal').reset_candidate_password, null);
  assert.equal(fake.logins.length, 2);
  assert.equal(fake.engines, 1);
  assert.equal(fake.contexts.length, 2);
  assert.ok(fake.events.includes('submission-complete'));
});

test('reset and candidate recovery keep the VPS-tested preset across jobs despite different random inputs', async () => {
  addAccount('stable-settings');
  const originalRandom = Math.random;
  const runWithRandom = async (start, work) => {
    let value = start;
    Math.random = () => { value = (value + 0.01) % 1; return value; };
    try { return await work(); } finally { Math.random = originalRandom; }
  };
  const first = fakeBrowser('old-password', { failVerification: true });
  assert.equal((await runWithRandom(0, () => withBrowser(first, () => resetAccountPassword('stable-settings')))).success, false);
  const recovery = fakeBrowser(first.external);
  assert.equal((await runWithRandom(0.8, () => withBrowser(recovery, () => resetAccountPassword('stable-settings')))).success, true);
  const launches = [...first.launchOptions, ...recovery.launchOptions];
  assert.equal(launches.length, 3);
  for (const options of launches) {
    assert.deepEqual(options, launches[0], 'settings must stay consistent across separate reset/recovery jobs');
    assert.equal(options.userAgent, 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36');
    assert.deepEqual(options.viewport, { width: 1280, height: 720 });
    assert.equal(options.locale, 'en-US');
    assert.equal(options.timezoneId, 'Asia/Kolkata');
  }
});

test('next automatic attempt recovers a changed password after verification fails', async () => {
  addAccount('recover');
  const first = fakeBrowser('old-password', { failVerification: true });
  const failed = await withBrowser(first, () => resetAccountPassword('recover'));
  assert.equal(failed.success, false);
  assert.match(failed.error, /confirming verified account login/);
  assert.equal(account('recover').password, 'old-password');
  assert.equal(account('recover').reset_candidate_password, first.external);
  const second = fakeBrowser(first.external);
  const recovered = await withBrowser(second, () => resetAccountPassword('recover'));
  assert.equal(recovered.success, true);
  assert.deepEqual(second.logins, [first.external]);
  assert.equal(second.submissions, 0);
  assert.equal(account('recover').password, first.external);
  assert.equal(account('recover').reset_candidate_password, null);
});

test('rejected candidate falls back to old password, then rotates and verifies', async () => {
  addAccount('rejected', 'candidate-not-applied');
  const fake = fakeBrowser('old-password');
  const result = await withBrowser(fake, () => resetAccountPassword('rejected'));
  assert.equal(result.success, true);
  assert.deepEqual(fake.logins.slice(0, 2), ['candidate-not-applied', 'old-password']);
  assert.equal(fake.submissions, 1);
});

test('failed candidate and old-password checks preserve the recovery credential', async () => {
  addAccount('unknown', 'saved-candidate');
  const fake = fakeBrowser('unavailable-password');
  const result = await withBrowser(fake, () => resetAccountPassword('unknown'));
  assert.equal(result.success, false);
  assert.equal(fake.submissions, 0);
  assert.equal(account('unknown').password, 'old-password');
  assert.equal(account('unknown').reset_candidate_password, 'saved-candidate');
});

test('an unchanged form verifies the candidate in the same attempt without another submission', async () => {
  addAccount('submission-timeout');
  const first = fakeBrowser('old-password', { submissionTimeout: true });
  const result = await withBrowser(first, () => resetAccountPassword('submission-timeout'));
  assert.equal(result.success, true, result.error);
  assert.equal(first.submissions, 1);
  assert.deepEqual(first.logins, ['old-password', first.external]);
  assert.equal(account('submission-timeout').password, first.external);
  assert.equal(account('submission-timeout').reset_candidate_password, null);
  assert.ok(first.contexts.every(c => c.closed));
});

test('a slow submission remains alive during same-attempt verification', async () => {
  addAccount('slow-submit');
  const fake = fakeBrowser('old-password', { submissionTimeout: true, deferSubmission: true });
  const result = await withBrowser(fake, () => resetAccountPassword('slow-submit'));
  assert.equal(result.success, true, result.error);
  assert.equal(fake.submissions, 1);
  assert.ok(fake.contexts.every(c => c.closed));
});

test('unverified candidate survives a submission UI timeout followed by verification failure', async () => {
  addAccount('uncertain-submit');
  const fake = fakeBrowser('old-password', { submissionTimeout: true, failVerification: true });
  const result = await withBrowser(fake, () => resetAccountPassword('uncertain-submit'));
  assert.equal(result.success, false);
  assert.equal(account('uncertain-submit').password, 'old-password');
  assert.equal(account('uncertain-submit').reset_candidate_password, fake.external);
  assert.ok(fake.contexts.every(c => c.closed));
});

test('a verification execution timeout preserves the candidate and remains automatically retryable',async t=>{
  addAccount('verification-deadline');
  const fake=fakeBrowser('old-password',{submissionTimeout:true,hangVerification:true});
  t.mock.timers.enable({apis:['setTimeout']});
  try{
    const result=await withBrowser(fake,async()=>{
      const pending=resetAccountPassword('verification-deadline');
      for(let i=0;i<30&&fake.contexts.length<2;i++)await new Promise(setImmediate);
      assert.equal(fake.contexts.length,2);
      t.mock.timers.tick(120_000);
      return pending;
    });
    assert.equal(result.success,false);assert.equal(result.retryable,true);
    assert.equal(result.errorCode,'timeout');assert.equal(fake.engines,1);
    assert.equal(account('verification-deadline').password,'old-password');
    assert.equal(account('verification-deadline').reset_candidate_password,fake.external);
    assert.ok(fake.contexts.every(context=>context.closed));
  }finally{t.mock.timers.reset();}
});

test('non-timeout submission errors do not start same-attempt verification', async () => {
  addAccount('broken-submit');
  const fake = fakeBrowser('old-password', { submissionError: new Error('Browser disconnected') });
  const result = await withBrowser(fake, () => resetAccountPassword('broken-submit'));
  assert.equal(result.success, false);
  assert.match(result.error, /Browser disconnected/);
  assert.equal(fake.contexts.length, 1);
  assert.equal(account('broken-submit').reset_candidate_password, fake.external);
});

test('initial HTTP 403 stops before login or submission', async () => {
  addAccount('blocked-initial');
  const fake = fakeBrowser('old-password', { initialStatus: 403 });
  const result = await withBrowser(fake, () => resetAccountPassword('blocked-initial'));
  assert.equal(result.success, false);
  assert.equal(result.retryable, false);
  assert.match(result.error, /HTTP: 403/);
  assert.deepEqual(fake.logins, []);
  assert.equal(fake.submissions, 0);
});

test('HTTP 403 on candidate recovery preserves it without trying the old password', async () => {
  addAccount('blocked-candidate', 'saved-candidate');
  const fake = fakeBrowser('old-password', { initialStatus: 403 });
  const result = await withBrowser(fake, () => resetAccountPassword('blocked-candidate'));
  assert.equal(result.retryable, false);
  assert.deepEqual(fake.logins, []);
  assert.equal(account('blocked-candidate').reset_candidate_password, 'saved-candidate');
});

for (const status of [200, 403]) test(`verification challenge (${status}) preserves the candidate after UI timeout`, async () => {
  const id = 'blocked-verification-' + status;
  addAccount(id);
  const fake = fakeBrowser('old-password', { submissionTimeout: true, verificationStatus: status, verificationTitle: 'Just a moment...' });
  const result = await withBrowser(fake, () => resetAccountPassword(id));
  assert.equal(result.success, false);
  assert.equal(result.retryable, false);
  assert.equal(fake.submissions, 1);
  assert.deepEqual(fake.logins, ['old-password']);
  assert.equal(account(id).password, 'old-password');
  assert.equal(account(id).reset_candidate_password, fake.external);
  assert.ok(fake.contexts.every(c => c.closed));
});

test('scheduled resets run even when booking-end notifications never settle', async () => {
  process.env.SANDBOX_MODE = 'true';
  const bot = require('../dist/lib/telegramBot.js');
  const push = require('../dist/routes/push.js');
  const oldBot = bot.sendAdminBookingEnd, oldPush = push.sendBookingEndPush;
  bot.sendAdminBookingEnd = push.sendBookingEndPush = () => new Promise(() => {});
  const orders = require('../dist/lib/testOrders.js');
  const scheduler = require('../dist/lib/autoResetScheduler.js');
  addAccount('scheduled');
  const order = orders.createManualBooking('Test Customer', '', 1, 100, 'scheduled', '');
  const past = new Date(Date.now() - 1000).toISOString();
  db.prepare('UPDATE test_orders SET expires_at=? WHERE id=?').run(past, order.id);
  db.prepare('UPDATE auto_reset_schedule SET run_at=? WHERE account_id=?').run(past, 'scheduled');
  try {
    scheduler.startAutoResetScheduler();
    for (let i = 0; i < 30 && account('scheduled').sold; i++) await new Promise(r => setTimeout(r, 10));
    assert.equal(account('scheduled').sold, 0);
    assert.equal(db.prepare('SELECT status FROM auto_reset_schedule WHERE account_id=?').get('scheduled').status, 'done');
  } finally {
    scheduler.stopAutoResetScheduler();
    bot.sendAdminBookingEnd = oldBot; push.sendBookingEndPush = oldPush;
    process.env.SANDBOX_MODE = 'false';
  }
});



test('unconfirmed initial login remains eligible for automatic retry', async () => {
  addAccount('transient-login');
  const fake=fakeBrowser('different-password');
  const result=await withBrowser(fake,()=>resetAccountPassword('transient-login'));
  assert.equal(result.success,false);
  assert.equal(result.retryable,true);
});

test('explicit rejection of the stored password requires review', async () => {
  addAccount('rejected-login');
  const fake=fakeBrowser('different-password',{navigationError:'credentials'});
  const result=await withBrowser(fake,()=>resetAccountPassword('rejected-login'));
  assert.equal(result.success,false);
  assert.equal(result.retryable,false);
});

test('candidate security challenge stops without trying the old password', async () => {
  addAccount('challenge-login','saved-candidate');
  const fake=fakeBrowser('different-password',{navigationError:'challenge'});
  const result=await withBrowser(fake,()=>resetAccountPassword('challenge-login'));
  assert.equal(result.success,false);
  assert.equal(result.retryable,false);
  assert.deepEqual(fake.logins,['saved-candidate']);
  assert.equal(account('challenge-login').reset_candidate_password,'saved-candidate');
});

test('scheduler retries an unconfirmed login automatically without an admin click', async t => {
  const worker=require('../dist/lib/passwordReset.js');
  const scheduler=require('../dist/lib/autoResetScheduler.js');
  const orders=require('../dist/lib/testOrders.js');
  addAccount('auto-retry');
  orders.createManualBooking('Test Auto Retry','',1,100,'auto-retry','');
  db.prepare('UPDATE auto_reset_schedule SET run_at=? WHERE account_id=?').run(new Date(Date.now()-1000).toISOString(),'auto-retry');
  const original=worker.resetAccountPassword;
  let attempts=0;
  const started=defer();
  worker.resetAccountPassword=async id=>{
    assert.equal(id,'auto-retry');
    attempts++;started.resolve();
    return attempts===1?{success:false,error:'Login state unconfirmed',retryable:true}:orders.sandboxReset(id);
  };
  t.mock.timers.enable({apis:['setTimeout']});
  try {
    scheduler.startAutoResetScheduler();
    await started.promise;
    await new Promise(setImmediate);
    assert.equal(attempts,1);
    t.mock.timers.tick(30_000);
    await new Promise(setImmediate);
    assert.equal(attempts,2);
    assert.equal(db.prepare('SELECT status FROM auto_reset_schedule WHERE account_id=?').get('auto-retry').status,'done');
    assert.equal(account('auto-retry').sold,0);
  } finally {
    scheduler.stopAutoResetScheduler();worker.resetAccountPassword=original;t.mock.timers.reset();
  }
});
