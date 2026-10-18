import { Page, Locator } from 'playwright';

export class ResetNavigationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ResetNavigationError';
  }
}

async function visible(locator: Locator): Promise<Locator | undefined> {
  for (const item of await locator.all()) {
    if (await item.isVisible().catch(() => false)) return item;
  }
}

// Responsive layouts can contain hidden duplicates; only use visible controls.
export async function openResetLogin(page: Page, signal: AbortSignal, timeout = 15_000): Promise<void> {
  const deadline = Date.now() + timeout;
  do {
    signal.throwIfAborted();
    if (await visible(page.locator('#user-email'))) return;
    const login = await visible(page.locator('.login-mdl.red-lnk'))
      || await visible(page.getByRole('button', { name: /^(log\s*in|sign\s*in)$/i }))
      || await visible(page.getByText(/^(log\s*in|sign\s*in)$/i, { exact: true }));
    if (login) {
      await login.click({ timeout: Math.max(1, deadline - Date.now()) });
      await page.waitForSelector('#user-email', { state: 'visible', timeout: Math.max(1, deadline - Date.now()) });
      return;
    }
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(150);
  } while (Date.now() < deadline);
  throw new ResetNavigationError('Login form was not accessible; inspect site changes or a security challenge before retrying');
}

// HTTP 200 does not mean the account actually logged in.
export async function findResetAccount(page: Page, signal: AbortSignal, timeout = 15_000): Promise<Locator> {
  const deadline = Date.now() + timeout;
  let openedMenu = false;
  do {
    signal.throwIfAborted();
    const account = await visible(page.locator('.mw-user.red-lnk'))
      || await visible(page.getByRole('link', { name: /^my account$/i }))
      || await visible(page.getByRole('button', { name: /^my account$/i }))
      || await visible(page.getByText(/^my account$/i, { exact: true }));
    if (account) return account;

    if (!openedMenu) {
      const menu = await visible(page.locator('.fi-menu'))
        || await visible(page.getByRole('button', { name: /^(open )?(menu|navigation)( menu)?$/i }))
        || await visible(page.locator('button[aria-label*="menu" i]'));
      if (menu) {
        await menu.click({ timeout: Math.max(1, deadline - Date.now()) });
        openedMenu = true;
      }
    }
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(150);
  } while (Date.now() < deadline);

  // Classify the failure without logging page text, emails, cookies or passwords.
  if (await visible(page.getByText(/captcha|verify you are human|security check/i))) {
    throw new ResetNavigationError('Site verification challenge detected; complete it manually. Automated retries paused');
  }
  if (await visible(page.locator('#user-email'))) {
    throw new ResetNavigationError('Login form remains visible; saved credentials may be rejected or outdated');
  }
  throw new ResetNavigationError('My Account not visible after login; authentication unconfirmed or account/menu layout changed');
}
