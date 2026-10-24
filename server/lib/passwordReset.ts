import { chromium, errors, Browser, BrowserContext } from 'playwright';
import { db, AccountRow } from '../db';
import { sandboxReset } from './testOrders';
import {runResetJob,ResetResult,ResetJobTimeoutError} from './resetJobs';
import {openResetLogin,openVerificationLogin,findResetAccount,ResetNavigationError,checkResetPage} from './resetNavigation';

/**
 * Password reset via headless Chromium (Playwright).
 * Logs into the external site with the account's current credentials, opens
 * the change-password modal, sets a new random password, and — on success —
 * saves the new password back to SQLite.
 *
 * Selectors mirror the working FlingBoss rotation flow.
 */

const SITE_URL = 'https://flingster.com/';

// Login flow
const SEL_LOGIN_EMAIL = '#user-email';
const SEL_LOGIN_PASSWORD = '#user-pass';
const SEL_LOGIN_SUBMIT = 'button.rlt-login';

// Navigation to My Account

// Change password modal
const SEL_CHANGE_PASSWORD_OPEN = '.fi-pencil.chn-pass-mdl';
const SEL_CURRENT_PASSWORD = '#curr-pass';
const SEL_NEW_PASSWORD = '#chng-new-pass';
const SEL_CONFIRM_PASSWORD = '#chng-new-pass-conf';
const SEL_PASSWORD_SUBMIT = 'button.rlt-change-pass';

/** New password: 3 lowercase letters + 3 digits, e.g. "xqr847". */
function generatePassword(): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  let pw = '';
  for (let i = 0; i < 3; i++) pw += letters[Math.floor(Math.random() * letters.length)];
  for (let i = 0; i < 3; i++) pw += digits[Math.floor(Math.random() * digits.length)];
  return pw;
}

export function resetAccountPassword(accountId:string, parentSignal?:AbortSignal, onProgress?:(stage:string)=>void):Promise<ResetResult>{
 return runResetJob(accountId,signal=>performReset(accountId,signal,onProgress),parentSignal);
}
async function performReset(accountId:string,signal:AbortSignal,onProgress?:(stage:string)=>void):Promise<ResetResult>{
  signal.throwIfAborted();
  if (process.env.SANDBOX_MODE === 'true') return sandboxReset(accountId);
  const account = db
    .prepare('SELECT * FROM accounts WHERE id = ?')
    .get(accountId) as (AccountRow & { reset_candidate_password: string | null }) | undefined;

  if (!account) {
    return { success: false, error: 'Account not found', retryable: false, errorCode: 'account_missing' };
  }

  let browser: Browser | null = null;
  let context: BrowserContext | null = null;

  let navigationStatus: number | undefined;
  let stage = 'launching browser';
  const started = Date.now();
  const setStage = (next:string) => { stage=next; onProgress?.(next); };
  let changeMayHaveBeenSubmitted = false;
  let proposedPassword: string | undefined;
  let activePage: import('playwright').Page | undefined;
  const stop=()=>{
    if(browser)void browser.close().catch(()=>{});
  };
  signal.addEventListener('abort',stop,{once:true});
  try {
    signal.throwIfAborted();

    setStage('launching browser');
    browser = await chromium.launch({ headless:true, timeout:20_000, args:['--no-sandbox','--disable-setuid-sandbox'] });
    signal.throwIfAborted();
    const browserOptions = {
      // Match the fixed application preset that reached visible login controls
      // in the VPS landing-page diagnostic. Do not randomize it between jobs.
      // This is not proof of authenticated access; challenge checks still apply.
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      locale: 'en-US',
      timezoneId: 'Asia/Kolkata',
    };
    // Verification can fail after the site has already changed the password.
    // Confirm that persisted candidate before trying the old stored credential.
    if (account.reset_candidate_password) {
      setStage('checking previously attempted password');
      context = await browser.newContext(browserOptions);
      signal.throwIfAborted();
      const candidatePage = context.pages()[0] || await context.newPage();
      activePage = candidatePage;
      candidatePage.setDefaultTimeout(15000);
      try {
        const response = await candidatePage.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
        navigationStatus = response?.status();
        await checkResetPage(candidatePage, navigationStatus);
        await openVerificationLogin(candidatePage, signal, SITE_URL);
        await candidatePage.fill(SEL_LOGIN_EMAIL, account.email);
        await candidatePage.fill(SEL_LOGIN_PASSWORD, account.reset_candidate_password);
        await candidatePage.click(SEL_LOGIN_SUBMIT);
        const candidateLink = await findResetAccount(candidatePage, signal);
        await candidateLink.click();
        await candidatePage.waitForSelector(SEL_CHANGE_PASSWORD_OPEN, { state: 'visible' });
        signal.throwIfAborted();
        db.prepare('UPDATE accounts SET password=?,last_reset_at=?,reset_candidate_password=NULL WHERE id=?')
          .run(account.reset_candidate_password, new Date().toISOString(), account.id);
        console.log(`[PasswordReset] ✓ ${account.name} — recovered verified candidate`);
        return { success: true, newPassword: account.reset_candidate_password };
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof ResetNavigationError && error.kind === 'challenge') throw error;
        // Preserve the candidate unless a stored-password login is confirmed.
        // This also covers a candidate that the website never applied.
      }
      await context.close();
      context = null;
    }
    setStage('opening login session');
    context = await browser.newContext(browserOptions);

    signal.throwIfAborted();
    const page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(20000);

    activePage = page;
    setStage('loading initial login page');
    // 1. Open site
    const initialResponse = await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' });
    navigationStatus = initialResponse?.status();
    await checkResetPage(page, navigationStatus);

    // 2. Open login modal
    setStage('opening initial login form');
    await openResetLogin(page, signal);

    setStage('submitting current credentials');
    // 3. Login
    await page.waitForSelector(SEL_LOGIN_EMAIL, { state: 'visible' });
    await page.fill(SEL_LOGIN_EMAIL, account.email);
    await page.fill(SEL_LOGIN_PASSWORD, account.password);
    await page.click(SEL_LOGIN_SUBMIT);

    setStage('opening account after initial login');
    const accountLink = await findResetAccount(page, signal);
    await accountLink.click();

    setStage('opening password change form');
    // 5. Open change-password modal
    await page.waitForSelector(SEL_CHANGE_PASSWORD_OPEN, { state: 'visible' });
    await page.click(SEL_CHANGE_PASSWORD_OPEN);

    // 6. Fill form
    await page.waitForSelector(SEL_CURRENT_PASSWORD, { state: 'visible' });
    const newPassword = proposedPassword = generatePassword();
    await page.fill(SEL_CURRENT_PASSWORD, account.password);
    await page.fill(SEL_NEW_PASSWORD, newPassword);
    await page.fill(SEL_CONFIRM_PASSWORD, newPassword);

    signal.throwIfAborted();
    db.prepare('UPDATE accounts SET reset_candidate_password=? WHERE id=?').run(newPassword,account.id);
    setStage('submitting password change');
    // Treat an interrupted submit as uncertain: the site may have changed the password.
    changeMayHaveBeenSubmitted = true;
    // 7. Submit
    await page.click(SEL_PASSWORD_SUBMIT);
    // Some successful changes leave the form filled and visible. A UI timeout
    // is uncertainty, not failure: verify the candidate in this same job.
    try {
      await page.waitForFunction((selector: string) => {
        const field = document.querySelector<HTMLInputElement>(selector);
        return !field || field.value === '' || field.getClientRects().length === 0;
      }, SEL_CURRENT_PASSWORD, { timeout: 5000 });
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof errors.TimeoutError)) throw error;
      console.log('[PasswordReset] Submission UI unconfirmed; verifying candidate in the same attempt');
      // Keep any in-flight submission alive until verification finishes.
      // The browser retains the submitting context until final cleanup.
      context = null;
    }

    // A fresh context has isolated cookies and storage. Reuse the engine,
    // not the login session: two Chromium processes overloaded small VPS hosts.
    // Missing error text alone is not proof that the change succeeded.
    if (context) await context.close();
    context=null;
    signal.throwIfAborted();
    setStage('opening verification session');
    // Keep the same page presentation settings, but do not copy cookies or
    // authenticated storage: verification must prove the new credentials work.
    context=await browser.newContext(browserOptions);
    signal.throwIfAborted();
    const verificationPage=context.pages()[0]||await context.newPage();
    activePage = verificationPage;
    setStage('loading verification login page');
    verificationPage.setDefaultTimeout(15000);
    const verificationResponse = await verificationPage.goto(SITE_URL,{waitUntil:'domcontentloaded',timeout:20000});
    navigationStatus = verificationResponse?.status();
    await checkResetPage(verificationPage, navigationStatus);
    setStage('opening verification login form');
    await openVerificationLogin(verificationPage, signal, SITE_URL);
    setStage('submitting new credentials for verification');
    await verificationPage.fill(SEL_LOGIN_EMAIL,account.email);
    await verificationPage.fill(SEL_LOGIN_PASSWORD,newPassword);
    await verificationPage.click(SEL_LOGIN_SUBMIT);
    setStage('confirming verified account login');
    const verifiedAccount = await findResetAccount(verificationPage, signal);
    await verifiedAccount.click();
    await verificationPage.waitForSelector(SEL_CHANGE_PASSWORD_OPEN, { state: 'visible' });

    signal.throwIfAborted();
    // 9. Save new password to SQLite
    db.prepare('UPDATE accounts SET password = ?, last_reset_at = ?, reset_candidate_password=NULL WHERE id = ?').run(
      newPassword,
      new Date().toISOString(),
      account.id
    );

    console.log(`[PasswordReset] ✓ ${account.name}`);
    return { success: true, newPassword };
  } catch (err) {
    const cause = signal.aborted ? signal.reason : err;
    let detail = cause instanceof Error ? cause.message : 'Unknown error';
    for(const password of [account.password,account.reset_candidate_password,proposedPassword]) {
      if(password)detail=detail.split(password).join('[redacted]');
    }
    let location = 'unavailable';
    try { const url = new URL(activePage?.url() || SITE_URL); location = url.origin + url.pathname; } catch {}
    let title = 'unavailable';
    try { title = (await activePage?.title() || title).slice(0, 120); } catch {}
    const challenge = (cause instanceof ResetNavigationError && cause.kind === 'challenge')
      || navigationStatus === 403 || /captcha|verification required|security check|access denied|just a moment/i.test(title);
    const rejected = cause instanceof ResetNavigationError && cause.kind === 'credentials';
    // An unconfirmed login is transient. A submitted change remains recoverable
    // because the next attempt checks its candidate before another change.
    const timeout = signal.aborted && cause instanceof ResetJobTimeoutError;
    const retryable = (!signal.aborted || timeout) && !challenge && (!rejected || changeMayHaveBeenSubmitted);
    const guidance = changeMayHaveBeenSubmitted
      ? retryable ? ' Candidate password preserved; the next automatic attempt will verify it first.'
        : ' Candidate password preserved; resolve the login or security challenge manually before retrying.'
      : !retryable ? ' Check the current password and signed-in account screen manually before retrying.' : ' Automatic retries remain enabled.';
    const message = `${stage}: ${detail} (page: ${location}; HTTP: ${navigationStatus ?? 'unknown'}; title: ${JSON.stringify(title)})${guidance}`;
    console.error(`[PasswordReset] ✗ ${account.name} — ${message}`);
    return { success: false, error: message, retryable, errorCode: signal.aborted && !timeout ? 'cancelled'
      : challenge ? 'site_blocked' : timeout ? 'timeout' : rejected ? 'credentials_rejected' : 'transient' };
  } finally {
    signal.removeEventListener('abort',stop);
    // Browser.close waits for all contexts and Chromium's temporary profile.
    // Do not release the global FIFO slot until that cleanup has finished.
    if (browser) await browser.close().catch(()=>{});
    console.log(`[PasswordReset] ${account.name} — finished after ${((Date.now()-started)/1000).toFixed(1)}s at ${stage}`);
  }
}

