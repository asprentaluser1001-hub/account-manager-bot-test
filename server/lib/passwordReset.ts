import { chromium } from 'playwright';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';
import { db, AccountRow } from '../db';
import { sandboxReset } from './testOrders';

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
const SEL_LOGIN_OPEN = '.login-mdl.red-lnk';
const SEL_LOGIN_EMAIL = '#user-email';
const SEL_LOGIN_PASSWORD = '#user-pass';
const SEL_LOGIN_SUBMIT = 'button.rlt-login';

// Navigation to My Account
const SEL_MENU_ICON = '.fi-menu';
const SEL_MY_ACCOUNT = '.mw-user.red-lnk';

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

export async function resetAccountPassword(
  accountId: string
): Promise<{ success: boolean; newPassword?: string; error?: string }> {
  if (process.env.SANDBOX_MODE === 'true') return sandboxReset(accountId);
  const account = db
    .prepare('SELECT id, name, email, password, last_reset_at, created_at FROM accounts WHERE id = ?')
    .get(accountId) as AccountRow | undefined;

  if (!account) {
    return { success: false, error: 'Account not found' };
  }

  const userDataDir = createTempUserDataDir();
  let context: Awaited<ReturnType<typeof chromium.launchPersistentContext>> | null = null;

  try {
    await randomDelay(1000, 3000);

    context = await chromium.launchPersistentContext(userDataDir, {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      userAgent: randomItem(USER_AGENTS),
      viewport: {
        width: 1280 + Math.floor(Math.random() * 200) - 100,
        height: 720 + Math.floor(Math.random() * 100) - 50,
      },
      locale: randomItem(LOCALES),
      timezoneId: randomItem(TIMEZONES),
    });

    const page = context.pages()[0] || (await context.newPage());
    page.setDefaultTimeout(15000);
    page.setDefaultNavigationTimeout(20000);

    // 1. Open site
    await page.goto(SITE_URL, { waitUntil: 'domcontentloaded' });

    // 2. Open login modal
    await page.waitForSelector(SEL_LOGIN_OPEN, { state: 'visible' });
    await page.click(SEL_LOGIN_OPEN);

    // 3. Login
    await page.waitForSelector(SEL_LOGIN_EMAIL, { state: 'visible' });
    await page.fill(SEL_LOGIN_EMAIL, account.email);
    await page.fill(SEL_LOGIN_PASSWORD, account.password);
    await page.click(SEL_LOGIN_SUBMIT);
    await page.waitForTimeout(3000);

    // 4. Open My Account (open hamburger menu first if needed)
    const myAccountVisible = await page.locator(SEL_MY_ACCOUNT).isVisible().catch(() => false);
    if (!myAccountVisible) {
      await page.locator(SEL_MENU_ICON).click({ force: true });
      await page.waitForTimeout(1000);
    }
    await page.waitForSelector(SEL_MY_ACCOUNT, { state: 'visible' });
    await page.click(SEL_MY_ACCOUNT);
    await page.waitForTimeout(2000);

    // 5. Open change-password modal
    await page.waitForSelector(SEL_CHANGE_PASSWORD_OPEN, { state: 'visible' });
    await page.click(SEL_CHANGE_PASSWORD_OPEN);

    // 6. Fill form
    await page.waitForSelector(SEL_CURRENT_PASSWORD, { state: 'visible' });
    const newPassword = generatePassword();
    await page.fill(SEL_CURRENT_PASSWORD, account.password);
    await page.fill(SEL_NEW_PASSWORD, newPassword);
    await page.fill(SEL_CONFIRM_PASSWORD, newPassword);

    // 7. Submit
    await page.click(SEL_PASSWORD_SUBMIT);
    await page.waitForTimeout(3000);

    // 8. Verify — if the current-password field is still filled, likely failed
    const currentPassValue = await page.locator(SEL_CURRENT_PASSWORD).inputValue().catch(() => '');
    if (currentPassValue.length > 0) {
      const errorVisible = await page
        .locator('.error, .alert-danger, .err-msg')
        .isVisible()
        .catch(() => false);
      if (errorVisible) {
        return { success: false, error: 'Password change rejected by site' };
      }
    }

    // 9. Save new password to SQLite
    db.prepare('UPDATE accounts SET password = ?, last_reset_at = ? WHERE id = ?').run(
      newPassword,
      new Date().toISOString(),
      account.id
    );

    console.log(`[PasswordReset] ✓ ${account.name} — new password: ${newPassword}`);
    return { success: true, newPassword };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`[PasswordReset] ✗ ${account.name} — ${message}`);
    return { success: false, error: message };
  } finally {
    if (context) await context.close();
    removeTempDir(userDataDir);
  }
}
