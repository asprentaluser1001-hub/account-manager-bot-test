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

async function challengeVisible(page: Page): Promise<boolean> {
  // Do not work around a CAPTCHA, access denial, or other security challenge.
  const title = await page.title().catch(() => '');
  if (/captcha|verification required|security check|access denied/i.test(title)) return true;
  return !!(await visible(page.getByText(/captcha|verify you are human|security check/i)));
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (/timeout/i.test(error.name) || /timeout.*exceeded/i.test(error.message));
}

// Wait for the actual form rather than a fixed sleep. Click a login control only
// once per page load: repeated clicks can toggle a modal closed.
export async function openResetLogin(page: Page, signal: AbortSignal, timeout = 12_000): Promise<void> {
  const deadline = Date.now() + timeout;
  let clicked = false;
  while (Date.now() < deadline) {
    signal.throwIfAborted();
    if (await visible(page.locator('#user-email'))) return;
    if (await challengeVisible(page)) {
      throw new ResetNavigationError('Site verification challenge detected; manual review required');
    }
    const remaining = Math.max(1, deadline - Date.now());
    if (!clicked) {
      const login = await visible(page.locator('.login-mdl.red-lnk'))
        || await visible(page.getByRole('button', { name: /^(log\s*in|sign\s*in)$/i }))
        || await visible(page.getByText(/^(log\s*in|sign\s*in)$/i, { exact: true }));
      if (login) {
        try {
          await login.click({ timeout: Math.min(2500, remaining) });
          clicked = true;
        } catch (error) {
          if (!isTimeout(error)) throw error;
        }
      }
    }
    if (clicked) {
      try {
        await page.waitForSelector('#user-email', { state: 'visible', timeout: Math.min(2000, Math.max(1, deadline - Date.now())) });
        return;
      } catch (error) {
        if (!isTimeout(error)) throw error;
      }
    } else {
      await page.waitForTimeout(Math.min(200, Math.max(1, deadline - Date.now())));
    }
  }
  signal.throwIfAborted();
  if (await challengeVisible(page)) throw new ResetNavigationError('Site verification challenge detected; manual review required');
  throw new ResetNavigationError(clicked
    ? 'Login form did not become visible after opening the login control'
    : 'No visible login control or login form; inspect website layout');
}

// After a submitted password change, retry ONLY the verification form on one
// clean reload. Never resubmit the password change or bypass a challenge.
export async function openVerificationLogin(page: Page, signal: AbortSignal, siteUrl: string, firstTimeout = 6500, reloadTimeout = 8500): Promise<void> {
  try {
    await openResetLogin(page, signal, firstTimeout);
    return;
  } catch (error) {
    signal.throwIfAborted();
    if (!(error instanceof ResetNavigationError) || await challengeVisible(page)) throw error;
  }
  signal.throwIfAborted();
  console.log('[PasswordReset] Verification login form unavailable; reloading verification page once');
  const response = await page.goto(siteUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 });
  if (response && response.status() >= 400) {
    throw new ResetNavigationError('Verification page returned an error; manual review required');
  }
  await openResetLogin(page, signal, reloadTimeout);
}

// HTTP 200 is not proof of authentication: require an actionable My Account control.
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

  if (await challengeVisible(page)) {
    throw new ResetNavigationError('Site verification challenge detected; complete it manually');
  }
  if (await visible(page.locator('#user-email'))) {
    throw new ResetNavigationError('Login form remains visible; saved credentials may be rejected or outdated');
  }
  throw new ResetNavigationError('My Account not visible after login; authentication unconfirmed or account/menu layout changed');
}
