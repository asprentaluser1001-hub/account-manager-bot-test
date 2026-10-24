import { Router, Request, Response } from 'express';
import { createHash, randomBytes } from 'crypto';
import { adminAuth } from '../auth';
import { AdminBrowser, AdminBrowserError } from '../lib/adminBrowser';
import { adminBrowserPage } from '../lib/adminBrowserPage';

function configuredOrigin(): string | undefined {
  if (process.env.ENABLE_ADMIN_BROWSER_DIAGNOSTICS !== 'true') return;
  const value = process.env.ADMIN_BROWSER_ORIGIN || '';
  try { const url = new URL(value); if (url.protocol === 'https:' && url.origin === value) return value; } catch {}
}
function owner(req: Request) { return createHash('sha256').update(req.headers.authorization || '').digest('hex'); }
function sessionId(req: Request) {
  const id = req.get('X-Admin-Browser-Session') || '';
  if (!/^[a-f0-9]{64}$/.test(id)) throw new AdminBrowserError('Browser session not found', 404);
  return id;
}
function failure(res: Response, error: unknown) {
  return res.status(error instanceof AdminBrowserError ? error.status : 409).json({ error: error instanceof AdminBrowserError ? error.message : 'Browser unavailable or session expired. Close it and try again.' });
}

export function serveAdminBrowserPage(_req: Request, res: Response) {
  if (!configuredOrigin()) return res.status(404).send('Browser diagnostics are disabled');
  const nonce = randomBytes(18).toString('base64');
  res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; img-src blob:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'` });
  return res.type('html').send(adminBrowserPage.replace(/%NONCE%/g, nonce));
}

export function createAdminBrowserRouter(browser = new AdminBrowser()) {
  const router = Router();
  router.use((_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff' });
    if (!configuredOrigin()) return res.status(404).json({ error: 'Browser diagnostics are disabled' });
    next();
  });
  router.use(adminAuth);
  router.use((req, res, next) => {
    if (req.method !== 'GET' && req.get('Origin') !== configuredOrigin()) return res.status(403).json({ error: 'Open the browser viewer from the configured HTTPS dashboard' });
    next();
  });
  router.post('/start', (req, res) => { try { return res.json(browser.start(owner(req))); } catch (e) { return failure(res, e); } });
  router.get('/status', (req, res) => { try { return res.json(browser.status(owner(req), sessionId(req))); } catch (e) { return failure(res, e); } });
  router.get('/frame', async (req, res) => { try { return res.type('jpeg').send(await browser.frame(owner(req), sessionId(req))); } catch (e) { return failure(res, e); } });
  router.post('/action', async (req, res) => { try { await browser.action(owner(req), sessionId(req), req.body); return res.json({ ok: true }); } catch (e) { return failure(res, e); } });
  router.post('/stop', async (req, res) => { try { await browser.stop(owner(req), sessionId(req)); return res.json({ ok: true }); } catch (e) { return failure(res, e); } });
  return router;
}

const adminBrowser = new AdminBrowser();
export const adminBrowserRouter = createAdminBrowserRouter(adminBrowser);
export const shutdownAdminBrowser = () => adminBrowser.shutdown();
