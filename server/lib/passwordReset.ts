import { chromium, BrowserContext, Page } from 'playwright';
import { randomInt } from 'crypto';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { db, AccountRow } from '../db';
import { sandboxReset } from './testOrders';
import { runResetJob, ResetResult } from './resetJobs';

const SITE_URL = 'https://flingster.com/';
const LOGIN_OPEN = '.login-mdl.red-lnk';
const LOGIN_EMAIL = '#user-email';
const LOGIN_PASSWORD = '#user-pass';
const LOGIN_SUBMIT = 'button.rlt-login';
const MENU = '.fi-menu';
const MY_ACCOUNT = '.mw-user.red-lnk';
const CHANGE_OPEN = '.fi-pencil.chn-pass-mdl';
const CURRENT_PASSWORD = '#curr-pass';
const NEW_PASSWORD = '#chng-new-pass';
const CONFIRM_PASSWORD = '#chng-new-pass-conf';
const CHANGE_SUBMIT = 'button.rlt-change-pass';

function generatePassword(): string {
  return Array.from({ length: 3 }, () => String.fromCharCode(97 + randomInt(26))).join('')
    + Array.from({ length: 3 }, () => String(randomInt(10))).join('');
}

export function resetAccountPassword(accountId: string): Promise<ResetResult> {
  return runResetJob(accountId, signal => performReset(accountId, signal));
}

async function performReset(accountId: string, signal: AbortSignal): Promise<ResetResult> {
  signal.throwIfAborted();
  if (process.env.SANDBOX_MODE === 'true') return sandboxReset(accountId);
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as
    (AccountRow & { reset_candidate_password: string | null }) | undefined;
  if (!account) return { success: false, error: 'Account not found' };

  let context: BrowserContext | null = null;
  let stage = 'opening browser';
  const dirs: string[] = [];
  const stop = () => { if (context) void context.close().catch(() => {}); };
  signal.addEventListener('abort', stop, { once: true });

  async function closeBrowser(): Promise<void> {
    if (context) await context.close();
    context = null;
  }

  // Both change and verification logins use the same settings and a fresh profile.
  async function login(password: string): Promise<Page> {
    signal.throwIfAborted();
    await closeBrowser();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pw-reset-'));
    dirs.push(dir);
    context = await chromium.launchPersistentContext(dir, {
      headless: true, timeout: 20_000,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      viewport: { width: 1280, height: 720 }, locale: 'en-US', timezoneId: 'Asia/Kolkata',
    });
    signal.throwIfAborted();
    const page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(25_000);
    page.setDefaultNavigationTimeout(30_000);
    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector(LOGIN_OPEN, { state: 'visible' });
    await page.click(LOGIN_OPEN);
    await page.waitForSelector(LOGIN_EMAIL, { state: 'visible' });
    await page.fill(LOGIN_EMAIL, account!.email);
    await page.fill(LOGIN_PASSWORD, password);
    await page.click(LOGIN_SUBMIT);
    // Wait for the actual authenticated UI, rather than assuming login took 3s.
    await page.waitForSelector(LOGIN_EMAIL, { state: 'hidden' });
    if (!await page.locator(MY_ACCOUNT).isVisible()) {
      await page.locator(MENU).click();
    }
    await page.waitForSelector(MY_ACCOUNT, { state: 'visible' });
    await page.click(MY_ACCOUNT);
    await page.waitForSelector(CHANGE_OPEN, { state: 'visible' });
    signal.throwIfAborted();
    return page;
  }

  function saveVerified(password: string): ResetResult {
    signal.throwIfAborted();
    db.prepare('UPDATE accounts SET password=?,last_reset_at=?,reset_candidate_password=NULL WHERE id=?')
      .run(password, new Date().toISOString(), account!.id);
    return { success: true, newPassword: password };
  }

  try {
    // A previous attempt may have changed the site password before verification
    // timed out. Check that password first; never discard it on a network error.
    if (account.reset_candidate_password) {
      stage = 'checking previously attempted password';
      try {
        await login(account.reset_candidate_password);
        return saveVerified(account.reset_candidate_password);
      } catch {
        signal.throwIfAborted();
        // Only a successful old-password login lets us replace the candidate.
      }
    }

    stage = 'logging in with stored password';
    const page = await login(account.password);
    stage = 'opening password form';
    await page.click(CHANGE_OPEN);
    await page.waitForSelector(CURRENT_PASSWORD, { state: 'visible' });
    const newPassword = generatePassword();
    await page.fill(CURRENT_PASSWORD, account.password);
    await page.fill(NEW_PASSWORD, newPassword);
    await page.fill(CONFIRM_PASSWORD, newPassword);
    signal.throwIfAborted();
    // Persist before submitting so a crash never loses the proposed credential.
    db.prepare('UPDATE accounts SET reset_candidate_password=? WHERE id=?').run(newPassword, account.id);
    stage = 'submitting password change';
    await page.click(CHANGE_SUBMIT);
    // Wait until the site finishes processing the form before closing Chromium.
    await page.waitForFunction((selector: string) => {
      const input = document.querySelector<HTMLInputElement>(selector);
      return !input || input.value === '' || input.getClientRects().length === 0;
    }, CURRENT_PASSWORD, { timeout: 25_000 });

    stage = 'verifying new password';
    await login(newPassword);
    return saveVerified(newPassword);
  } catch (error) {
    const reason = signal.aborted ? String(signal.reason?.message || 'Reset stopped')
      : error instanceof Error ? error.message : 'Unknown error';
    const message = stage + ': ' + reason;
    console.error('[PasswordReset] failed for account ' + account.id + ' at ' + stage);
    return { success: false, error: message };
  } finally {
    signal.removeEventListener('abort', stop);
    if (context) await (context as BrowserContext).close().catch(() => {});
    for (const dir of dirs) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
    }
  }
}

