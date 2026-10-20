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
const { chromium } = require('playwright');
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

function addAccount(id, candidate = null) {
  db.prepare('INSERT INTO accounts(id,name,email,password,reset_candidate_password,created_at) VALUES (?,?,?,?,?,?)')
    .run(id, id, id + '@example.invalid', 'old-password', candidate, new Date().toISOString());
}
function account(id) { return db.prepare('SELECT * FROM accounts WHERE id=?').get(id); }

// The browser model changes its external password only when submission completes.
// Authenticated selectors reject invalid credentials, including in a fresh profile.
function fakeBrowser(initialPassword, { failVerification = false, submissionTimeout = false } = {}) {
  let external = initialPassword, launches = 0, submissions = 0;
  const logins = [], events = [];
  return {
    logins, events,
    get external() { return external; },
    get submissions() { return submissions; },
    launch: async () => {
      const launch = ++launches;
      const fields = {};
      let loggedIn = false, submitted = false;
      const page = {
        setDefaultTimeout() {}, setDefaultNavigationTimeout() {},
        goto: async () => {},
        fill: async (s, v) => { fields[s] = v; },
        click: async s => {
          if (s === 'button.rlt-login') {
            logins.push(fields['#user-pass']);
            loggedIn = fields['#user-pass'] === external;
          }
          if (s === 'button.rlt-change-pass') {
            assert.equal(loggedIn, true);
            external = fields['#chng-new-pass'];
            submissions++; submitted = true;
            assert.equal(db.prepare('SELECT reset_candidate_password FROM accounts WHERE email=?').get(fields['#user-email']).reset_candidate_password, external);
          }
        },
        locator: () => ({ isVisible: async () => loggedIn, click: async () => {} }),
        waitForSelector: async s => {
          if (s === '.mw-user.red-lnk' || s === '.fi-pencil.chn-pass-mdl') {
            if (!loggedIn || (failVerification && launch > 1)) throw new Error('Authenticated page timed out');
            events.push('authenticated');
          }
        },
        waitForFunction: async () => {
          assert.equal(submitted, true);
          events.push('submission-complete');
          if (submissionTimeout) throw new Error('Submission confirmation timed out');
        },
      };
      return { pages: () => [page], close: async () => {} };
    },
  };
}
async function withBrowser(fake, work) {
  const original = chromium.launchPersistentContext;
  chromium.launchPersistentContext = fake.launch;
  try { return await work(); }
  finally { chromium.launchPersistentContext = original; }
}

test('normal reset waits for submission and verifies in a fresh profile before saving', async () => {
  addAccount('normal');
  const fake = fakeBrowser('old-password');
  const result = await withBrowser(fake, () => resetAccountPassword('normal'));
  assert.equal(result.success, true);
  assert.equal(account('normal').password, fake.external);
  assert.equal(account('normal').reset_candidate_password, null);
  assert.equal(fake.logins.length, 2);
  assert.ok(fake.events.includes('submission-complete'));
});

test('next automatic attempt recovers a changed password after verification fails', async () => {
  addAccount('recover');
  const first = fakeBrowser('old-password', { failVerification: true });
  const failed = await withBrowser(first, () => resetAccountPassword('recover'));
  assert.equal(failed.success, false);
  assert.match(failed.error, /verifying new password/);
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

test('a submission timeout retains the proposed password for the next automatic attempt', async () => {
  addAccount('submission-timeout');
  const first = fakeBrowser('old-password', { submissionTimeout: true });
  const failed = await withBrowser(first, () => resetAccountPassword('submission-timeout'));
  assert.equal(failed.success, false);
  assert.equal(account('submission-timeout').reset_candidate_password, first.external);
  const next = fakeBrowser(first.external);
  assert.equal((await withBrowser(next, () => resetAccountPassword('submission-timeout'))).success, true);
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

