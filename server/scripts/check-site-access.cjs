'use strict';

// Public landing-page diagnostics only. No database, credentials, clicks,
// password changes, clearance-cookie export, or production-service changes.
const SITE_URL = 'https://flingster.com/';
const PRESETS = [
  { name: 'native-defaults', options: {} },
  {
    name: 'application-preset-sample',
    options: {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      locale: 'en-US', timezoneId: 'Asia/Kolkata',
    },
  },
];

function isChallenge(status, headers, title) {
  return status === 401 || status === 403 || headers['cf-mitigated'] === 'challenge'
    || /just a moment|captcha|verification required|security check|access denied/i.test(title);
}

async function probe(chromium, preset) {
  let browser;
  const started = Date.now();
  const result = { configuration: preset.name };
  let stage = 'launch';
  try {
    browser = await chromium.launch({ headless: true, timeout: 20000, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
    result.browserVersion = browser.version();
    const context = await browser.newContext(preset.options);
    const page = await context.newPage();
    page.setDefaultTimeout(5000);
    stage = 'navigation';
    const response = await page.goto(SITE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
    const headers = response ? response.headers() : {};
    result.status = response ? response.status() : null;
    result.title = (await page.title()).slice(0, 120);
    result.challenge = isChallenge(result.status, headers, result.title);
    result.server = headers.server || null;
    result.mitigation = headers['cf-mitigated'] || null;
    result.ray = headers['cf-ray'] || null;
    // Stop at the challenge. Do not click or wait for it to clear.
    if (!result.challenge && result.status >= 200 && result.status < 400) {
      stage = 'checking public login controls';
      const controls = page.locator('.login-mdl.red-lnk, #user-email, button.rlt-login')
        .or(page.getByRole('button', { name: /^(log\s*in|sign\s*in)$/i }))
        .or(page.getByRole('link', { name: /^(log\s*in|sign\s*in)$/i }));
      // The page may render controls shortly after DOMContentLoaded.
      try { await controls.filter({ visible: true }).first().waitFor({ state: 'visible', timeout: 3000 }); }
      catch (error) { if (error.name !== 'TimeoutError') throw error; }
      result.loginControlVisible = false;
      for (const control of await controls.all()) {
        if (await control.isVisible()) { result.loginControlVisible = true; break; }
      }
    }
  } catch (error) {
    // Avoid printing browser launch arguments, page dumps, or environment data.
    result.error = `${stage}: ${error.name || 'Error'}`;
  } finally {
    if (browser) await browser.close().catch(() => {});
    result.elapsedSeconds = Number(((Date.now() - started) / 1000).toFixed(1));
  }
  return result;
}

async function checkSiteAccess(chromium, log = console.log) {
  const results = [];
  // Two deterministic checks, sequentially; no fingerprint rotation or retries.
  for (const preset of PRESETS) {
    const result = await probe(chromium, preset);
    results.push(result);
    log(JSON.stringify(result, null, 2));
  }
  const [native, sample] = results;
  if (native.challenge && sample.challenge) {
    log('RESULT: Both browser configurations received a site-access challenge. No account or password was tested.');
  } else if (native.loginControlVisible && !sample.loginControlVisible) {
    log('RESULT: Native defaults reached login controls while the preset sample did not. Browser configuration needs investigation; login/password reset remains unverified.');
  } else {
    log('RESULT: Compare the statuses above. Landing-page access does not prove login or password-reset success.');
  }
  return results;
}

module.exports = { checkSiteAccess, isChallenge };
if (require.main === module) {
  checkSiteAccess(require('playwright').chromium).catch(() => {
    console.error('Diagnostic could not complete. Check the existing Playwright installation.');
    process.exitCode = 1;
  });
}
