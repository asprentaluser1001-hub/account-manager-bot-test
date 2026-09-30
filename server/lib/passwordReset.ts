import { chromium } from 'playwright';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { db, AccountRow } from '../db';
import { sandboxReset } from './testOrders';
import {runResetJob,ResetResult} from './resetJobs';
import {openResetLogin,findResetAccount} from './resetNavigation';

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

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
];
const LOCALES = ['en-US', 'en-GB', 'en-IN'];
const TIMEZONES = ['Asia/Kolkata', 'America/New_York', 'Europe/London'];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** New password: 3 lowercase letters + 3 digits, e.g. "xqr847". */
function generatePassword(): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  let pw = '';
  for (let i = 0; i < 3; i++) pw += letters[Math.floor(Math.random() * letters.length)];
  for (let i = 0; i < 3; i++) pw += digits[Math.floor(Math.random() * digits.length)];
  return pw;
}

function createTempUserDataDir(): string {
  const dir = path.join(os.tmpdir(), `pw-reset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function removeTempDir(dir: string): void {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ }
}

export function resetAccountPassword(accountId:string):Promise<ResetResult>{
 return runResetJob(accountId,signal=>performReset(accountId,signal));
}
async function performReset(accountId:string,signal:AbortSignal):Promise<ResetResult>{
  signal.throwIfAborted();
  if (process.env.SANDBOX_MODE === 'true') return sandboxReset(accountId);
  const account = db
    .prepare('SELECT id, name, email, password, last_reset_at, created_at FROM accounts WHERE id = ?')
    .get(accountId) as AccountRow | undefined;

  if (!account) {
    return { success: false, error: 'Account not found' };
  }

  const userDataDir = createTempUserDataDir();
  const verificationDir = createTempUserDataDir();
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null;

  let navigationStatus: number | undefined;
  let stage = 'launching browser';
  let activePage: import('playwright').Page | undefined;
  const stop=()=>{if(context)void context.close().catch(()=>{});};
  signal.addEventListener('abort',stop,{once:true});
  try {
    await randomDelay(1000, 3000);
    signal.throwIfAborted();

    const browserOptions = {
      headless: true,
      timeout: 20_000,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      userAgent: randomItem(USER_AGENTS),
      viewport: {
        width: 1280 + Math.floor(Math.random() * 200) - 100,
        height: 720 + Math.floor(Math.random() * 100) - 50,
      },
      locale: randomItem(LOCALES),
      timezoneId: randomItem(TIMEZONES),
    };
    context = await chromium.launchPersistentContext(userDataDir, browserOptions);

    signal.throwIfAborted();
    const page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(20000);

    activePage = page;
    stage = 'loading initial login page';
    // 1. Open site
    const initialResponse = await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' });
    navigationStatus = initialResponse?.status();

    // 2. Open login modal
    stage = 'opening initial login form';
    await openResetLogin(page, signal);

    stage = 'submitting current credentials';
    // 3. Login
    await page.waitForSelector(SEL_LOGIN_EMAIL, { state: 'visible' });
    await page.fill(SEL_LOGIN_EMAIL, account.email);
    await page.fill(SEL_LOGIN_PASSWORD, account.password);
    await page.click(SEL_LOGIN_SUBMIT);
    await page.waitForTimeout(3000);

    stage = 'opening account after initial login';
    const accountLink = await findResetAccount(page, signal);
    await accountLink.click();

    stage = 'opening password change form';
    // 5. Open change-password modal
    await page.waitForSelector(SEL_CHANGE_PASSWORD_OPEN, { state: 'visible' });
    await page.click(SEL_CHANGE_PASSWORD_OPEN);

    // 6. Fill form
    await page.waitForSelector(SEL_CURRENT_PASSWORD, { state: 'visible' });
    const newPassword = generatePassword();
    await page.fill(SEL_CURRENT_PASSWORD, account.password);
    await page.fill(SEL_NEW_PASSWORD, newPassword);
    await page.fill(SEL_CONFIRM_PASSWORD, newPassword);

    signal.throwIfAborted();
    db.prepare('UPDATE accounts SET reset_candidate_password=? WHERE id=?').run(newPassword,account.id);
    stage = 'submitting password change';
    // 7. Submit
    await page.click(SEL_PASSWORD_SUBMIT);
    await page.waitForTimeout(3000);

    // Verify the new credentials in an entirely fresh browser profile.
    // Missing error text alone is not proof that the change succeeded.
    await context.close();
    context=null;
    signal.throwIfAborted();
    stage = 'launching verification browser';
    // Keep the same page presentation settings, but do not copy cookies or
    // authenticated storage: verification must prove the new credentials work.
    context=await chromium.launchPersistentContext(verificationDir, browserOptions);
    signal.throwIfAborted();
    const verificationPage=context.pages()[0]||await context.newPage();
    activePage = verificationPage;
    stage = 'loading verification login page';
    verificationPage.setDefaultTimeout(15000);
    const verificationResponse = await verificationPage.goto(SITE_URL,{waitUntil:'domcontentloaded',timeout:20000});
    navigationStatus = verificationResponse?.status();
    stage = 'opening verification login form';
    await openResetLogin(verificationPage, signal);
    stage = 'submitting new credentials for verification';
    await verificationPage.fill(SEL_LOGIN_EMAIL,account.email);
    await verificationPage.fill(SEL_LOGIN_PASSWORD,newPassword);
    await verificationPage.click(SEL_LOGIN_SUBMIT);
    await verificationPage.waitForTimeout(3000);
    stage = 'confirming verified account login';
    await findResetAccount(verificationPage, signal);

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
    const detail = cause instanceof Error ? cause.message : 'Unknown error';
    let location = 'unavailable';
    try { const url = new URL(activePage?.url() || SITE_URL); location = url.origin + url.pathname; } catch {}
    let title = 'unavailable';
    try { title = (await activePage?.title() || title).slice(0, 120); } catch {}
    const message = `${stage}: ${detail} (page: ${location}; HTTP: ${navigationStatus ?? 'unknown'}; title: ${JSON.stringify(title)})`;
    console.error(`[PasswordReset] ✗ ${account.name} — ${message}`);
    return { success: false, error: message };
  } finally {
    signal.removeEventListener('abort',stop);
    if (context) await context.close().catch(()=>{});
    removeTempDir(userDataDir);
    removeTempDir(verificationDir);
  }
}
