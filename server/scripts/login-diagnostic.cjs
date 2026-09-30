// Read-only database access. Logs in once; never opens password-change controls.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { chromium } = require(path.join(process.cwd(), 'node_modules/playwright'));
const { openResetLogin, findResetAccount } = require(path.join(process.cwd(), 'dist/lib/resetNavigation.js'));
process.umask(0o077);
async function main() {
  const db = new DatabaseSync('/root/account-manager-bot-test/server/test.db', { readOnly: true });
  let account;
  try { account = db.prepare('SELECT email,password FROM accounts WHERE lower(email)=lower(?)').get(process.argv[2] || ''); }
  finally { db.close(); }
  if (!account || !account.password) throw new Error('Account or saved password not found');
  const clean = value => String(value).split(account.password).join('[password hidden]').split(account.email).join('[email hidden]').replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email hidden]');
  const folder = '/root/flingroulette-diagnostics';
  fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
  const profile = fs.mkdtempSync(path.join(folder, 'login-profile-'));
  let context, page;
  let stage = 'launching browser';
  try {
    context = await chromium.launchPersistentContext(profile, { headless: true, timeout: 20000, args: ['--no-sandbox', '--disable-setuid-sandbox'], userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36', viewport: { width: 1280, height: 720 }, locale: 'en-US', timezoneId: 'Asia/Kolkata' });
    page = context.pages()[0] || await context.newPage();
    page.setDefaultTimeout(15000);
    stage = 'loading site';
    const response = await page.goto('https://flingster.com/', { waitUntil: 'domcontentloaded', timeout: 20000 });
    console.log('HTTP:', response?.status());
    stage = 'opening login';
    await openResetLogin(page, new AbortController().signal);
    stage = 'submitting saved credentials';
    await page.fill('#user-email', account.email);
    await page.fill('#user-pass', account.password);
    await page.click('button.rlt-login');
    await page.waitForTimeout(3000);
    stage = 'checking account menu';
    try { await findResetAccount(page, new AbortController().signal); console.log('Account control: visible'); }
    catch (error) { console.log('Account check:', clean(error.message)); }
  } catch (error) { console.log('Stopped at:', stage, '\nError:', clean(error.message)); }
  finally {
    try {
      if (page && !page.isClosed()) {
        const url = new URL(page.url());
        console.log('Page:', url.origin + url.pathname, '\nTitle:', clean(await page.title()));
        for (const selector of ['#user-email', '#user-pass', '.mw-user.red-lnk', '.fi-menu', 'button.rlt-login']) {
          const items = await page.locator(selector).all();
          let shown = 0;
          for (const item of items) if (await item.isVisible()) shown++;
          console.log(selector, 'total:', items.length, 'visible:', shown);
        }
        const labels = await page.locator('button:visible, a:visible, [role=button]:visible, [role=alert]:visible').allTextContents();
        console.log('Visible controls/alerts:', clean(labels.map(s => s.trim()).filter(Boolean).join(' | ')).slice(0, 2500));
        const screenshot = path.join(folder, 'login-check-' + Date.now() + '.png');
        await page.screenshot({ path: screenshot, mask: [page.locator('input, textarea'), page.getByText(account.email, { exact: false })] });
        fs.chmodSync(screenshot, 0o600);
        console.log('Screenshot:', screenshot);
      }
    } finally {
      if (context) await context.close();
      fs.rmSync(profile, { recursive: true, force: true });
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
