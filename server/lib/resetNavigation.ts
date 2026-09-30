import { Page, Locator } from 'playwright';

async function visible(locator: Locator): Promise<Locator | undefined> {
  for (const item of await locator.all()) {
    if (await item.isVisible()) return item;
  }
}

// Desktop/mobile layouts can contain hidden copies of the same control.
// Never force a click on a hidden menu; select an actionable visible copy.
export async function openResetLogin(page: Page, signal: AbortSignal, timeout = 15_000): Promise<void> {
  const deadline = Date.now() + timeout;
  do {
    signal.throwIfAborted();
    if (await visible(page.locator('#user-email'))) return;
    const login = await visible(page.locator('.login-mdl.red-lnk'))
      || await visible(page.getByText(/^(log\s*in|sign\s*in)$/i, { exact: true }));
    if (login) {
      await login.click({ timeout: Math.max(1, deadline - Date.now()) });
      await page.waitForSelector('#user-email', { state: 'visible', timeout: Math.max(1, deadline - Date.now()) });
      return;
    }
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(150);
  } while (Date.now() < deadline);
  throw new Error('No visible Flingster login control or email form; check the loaded page for an overlay, verification page or changed layout');
}

export async function findResetAccount(page: Page, signal: AbortSignal, timeout = 15_000): Promise<Locator> {
  const deadline = Date.now() + timeout;
  let openedMenu = false;
  do {
    signal.throwIfAborted();
    const account = await visible(page.locator('.mw-user.red-lnk'));
    if (account) return account;
    if (!openedMenu) {
      const menu = await visible(page.locator('.fi-menu'));
      if (menu) {
        await menu.click({ timeout: Math.max(1, deadline - Date.now()) });
        openedMenu = true;
      }
    }
    if (Date.now() >= deadline) break;
    await page.waitForTimeout(150);
  } while (Date.now() < deadline);
  throw new Error('My Account did not become visible after login; login may have been rejected or the account/menu layout changed');
}
