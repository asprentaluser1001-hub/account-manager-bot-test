import { chromium, BrowserContext, Page, errors } from 'playwright';
import { spawn, ChildProcess } from 'child_process';
import { Readable } from 'stream';
import { randomBytes, timingSafeEqual } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runResetJob } from './resetJobs';

const WIDTH = 1280, HEIGHT = 720;
const SITE = 'https://flingster.com/';
const MAX_WAIT_MS = 5 * 60_000;
const ALLOWED_KEYS = new Set(['Enter', 'Tab', 'Backspace', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class AdminBrowserError extends Error {
  constructor(message: string, readonly status = 409) { super(message); }
}

function browserEnvironment(display?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  // Never pass the API's JWT, admin password, bot or payment secrets to the GUI.
  for (const key of ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'XDG_RUNTIME_DIR']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  if (display) env.DISPLAY = display;
  return env;
}

async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  await new Promise<void>(resolve => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); }, 1500);
    child.once('exit', () => { clearTimeout(timer); resolve(); });
    child.kill('SIGTERM');
  });
}

async function startDisplay(): Promise<{ display: string; close: () => Promise<void> }> {
  const child: ChildProcess = spawn('Xvfb', ['-displayfd', '3', '-screen', '0', `${WIDTH}x${HEIGHT}x24`, '-nolisten', 'tcp', '-noreset'], {
    env: browserEnvironment(), stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
  });
  const close = () => stopChild(child);
  try {
    const number = await new Promise<string>((resolve, reject) => {
      let text = '';
      const timer = setTimeout(() => reject(new Error('Display timeout')), 5000);
      const fail = () => { clearTimeout(timer); reject(new Error('Display unavailable')); };
      child.once('error', fail);
      child.once('exit', fail);
      (child.stdio[3] as Readable).on('data', chunk => {
        text += String(chunk);
        if (/^\d+\n$/.test(text)) { clearTimeout(timer); resolve(text.trim()); }
      });
    });
    return { display: `:${number}`, close };
  } catch {
    await close();
    throw new AdminBrowserError('VPS display unavailable. Run the browser-viewer setup command.');
  }
}

// Headed Chromium needs a desktop session bus on a minimal VPS. Give this
// viewer its own Unix socket inside its private profile, never a TCP listener
// or an inherited desktop session. It receives no app credentials.
async function startDesktopBus(profile: string): Promise<{ address: string; close: () => Promise<void> }> {
  const child = spawn('dbus-daemon', ['--session', '--nofork', '--nopidfile', `--address=unix:tmpdir=${profile}`, '--print-address=3'], {
    env: browserEnvironment(), stdio: ['ignore', 'ignore', 'ignore', 'pipe'],
  });
  const close = () => stopChild(child);
  try {
    const address = await new Promise<string>((resolve, reject) => {
      let output = '';
      const timer = setTimeout(() => reject(new Error('Desktop bus timeout')), 5000);
      const fail = () => { clearTimeout(timer); reject(new Error('Desktop bus unavailable')); };
      child.once('error', fail);
      child.once('exit', fail);
      (child.stdio[3] as Readable).on('data', chunk => {
        output += String(chunk);
        if (/^unix:[^\r\n]+\n$/.test(output)) { clearTimeout(timer); resolve(output.trim()); }
        else if (output.length > 4096) fail();
      });
    });
    return { address, close };
  } catch {
    await close();
    throw new AdminBrowserError('VPS desktop bus unavailable. Run the browser-viewer setup command.');
  }
}

interface BrowserHandle { context: BrowserContext; close: () => Promise<void>; }
async function launchManualBrowser(signal: AbortSignal): Promise<BrowserHandle> {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'flingroulette-manual-browser-'));
  let display: Awaited<ReturnType<typeof startDisplay>> | undefined;
  let desktopBus: Awaited<ReturnType<typeof startDesktopBus>> | undefined;
  let context: BrowserContext | undefined;
  let closing: Promise<void> | undefined;
  const close = () => closing ||= (async () => {
    signal.removeEventListener('abort', abort);
    if (context) {
      const browser = context.browser();
      await context.close().catch(() => {});
      if (browser) await browser.close().catch(() => {});
    }
    if (desktopBus) await desktopBus.close();
    if (display) await display.close();
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  })();
  const abort = () => { if (context) void context.close().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    signal.throwIfAborted();
    display = await startDisplay();
    signal.throwIfAborted();
    desktopBus = await startDesktopBus(profile);
    signal.throwIfAborted();
    context = await chromium.launchPersistentContext(profile, {
      headless: false, timeout: 60_000, viewport: { width: WIDTH, height: HEIGHT },
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
      env: { ...browserEnvironment(display.display), DBUS_SESSION_BUS_ADDRESS: desktopBus.address }, acceptDownloads: false,
    });
    signal.throwIfAborted();
    return { context, close };
  } catch (error) {
    await close();
    if (!signal.aborted && error instanceof errors.TimeoutError) {
      throw new AdminBrowserError('VPS browser startup exceeded 60 seconds. Run the local browser diagnostic in Termius.');
    }
    throw error;
  }
}

interface Session {
  id: string; owner: string; state: 'queued' | 'opening' | 'ready' | 'closed';
  controller: AbortController; done: Promise<unknown>; page?: Page;
  expiresAt?: number; httpStatus?: number; note?: string; operations: Promise<unknown>;
}

export function validateBrowserAction(action: unknown): { type: string; x?: number; y?: number; text?: string; key?: string; delta?: number } {
  if (!action || typeof action !== 'object') throw new AdminBrowserError('Invalid browser action', 400);
  const a = action as Record<string, unknown>;
  if (a.type === 'click' && typeof a.x === 'number' && typeof a.y === 'number' && Number.isFinite(a.x) && Number.isFinite(a.y) && a.x >= 0 && a.x < WIDTH && a.y >= 0 && a.y < HEIGHT) {
    return { type: 'click', x: a.x, y: a.y };
  }
  if (a.type === 'text' && typeof a.text === 'string' && a.text.length > 0 && a.text.length <= 500) return { type: 'text', text: a.text };
  if (a.type === 'key' && typeof a.key === 'string' && ALLOWED_KEYS.has(a.key)) return { type: 'key', key: a.key };
  if (a.type === 'scroll' && (a.delta === 400 || a.delta === -400)) return { type: 'scroll', delta: a.delta };
  throw new AdminBrowserError('Invalid browser action', 400);
}

export class AdminBrowser {
  private current?: Session;
  constructor(private launch: (signal: AbortSignal) => Promise<BrowserHandle> = launchManualBrowser) {}

  start(owner: string) {
    if (this.current && this.current.state !== 'closed') throw new AdminBrowserError('A browser session is already open. Close it or wait for it to expire.');
    const session: Session = { id: randomBytes(32).toString('hex'), owner, state: 'queued', controller: new AbortController(), done: Promise.resolve(), operations: Promise.resolve() };
    this.current = session;
    const deadline = setTimeout(() => session.controller.abort(), MAX_WAIT_MS);
    deadline.unref();
    session.done = runResetJob('__manual_browser_diagnostic__', async signal => {
      let handle: BrowserHandle | undefined;
      session.state = 'opening';
      session.expiresAt = Date.now() + 120_000;
      try {
        handle = await this.launch(signal);
        signal.throwIfAborted();
        const context = handle.context;
        const page = context.pages()[0] || await context.newPage();
        session.page = page;
        page.setDefaultTimeout(5000);
        // Only the fixed Flingster site can be opened in the top-level page.
        await page.route('**/*', route => {
          const request = route.request();
          if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
            const url = new URL(request.url());
            if (url.protocol !== 'https:' || !(url.hostname === 'flingster.com' || url.hostname.endsWith('.flingster.com'))) return route.abort();
          }
          return route.continue();
        });
        context.on('page', popup => { if (popup !== page) void popup.close().catch(() => {}); });
        page.on('dialog', dialog => { void dialog.dismiss().catch(() => {}); });
        try {
          const response = await page.goto(SITE, { waitUntil: 'domcontentloaded', timeout: 20_000 });
          session.httpStatus = response?.status();
        } catch { session.note = 'Page navigation did not finish. The current screen is shown below.'; }
        signal.throwIfAborted();
        session.state = 'ready';
        await new Promise<void>(resolve => {
          if (signal.aborted) resolve();
          else signal.addEventListener('abort', () => resolve(), { once: true });
        });
        return { success: true };
      } catch (error) {
        if (!signal.aborted) session.note = error instanceof AdminBrowserError ? error.message : 'Could not open the VPS browser. Check the viewer setup and installed Chromium.';
        throw error;
      } finally { if (handle) await handle.close(); }
    }, session.controller.signal).catch(() => {}).finally(() => {
      clearTimeout(deadline);
      session.state = 'closed';
      session.page = undefined;
    });
    return { id: session.id };
  }

  private session(owner: string, id: string): Session {
    const s = this.current;
    if (!s || s.owner !== owner || id.length !== s.id.length || !timingSafeEqual(Buffer.from(id), Buffer.from(s.id))) {
      throw new AdminBrowserError('Browser session not found', 404);
    }
    return s;
  }
  status(owner: string, id: string) {
    const s = this.session(owner, id);
    return { state: s.state, expiresAt: s.expiresAt, httpStatus: s.httpStatus, note: s.note, width: WIDTH, height: HEIGHT };
  }
  private operate<T>(owner: string, id: string, work: (page: Page) => Promise<T>): Promise<T> {
    const s = this.session(owner, id);
    const task = s.operations.then(async () => {
      if (s.state !== 'ready' || !s.page || s.controller.signal.aborted || (s.expiresAt !== undefined && Date.now() >= s.expiresAt)) throw new AdminBrowserError('Browser is not ready or has expired');
      return work(s.page);
    });
    s.operations = task.catch(() => {});
    return task;
  }
  frame(owner: string, id: string) {
    return this.operate(owner, id, async page => {
      const capture = () => page.screenshot({ type: 'jpeg', quality: 55, timeout: 15_000 });
      try { return await capture(); }
      catch (error) {
        // Xvfb can have a page before Chromium's first drawable frame exists.
        // A slow first frame can also exceed the capture deadline. Retry only
        // these rendering failures once, without reloading or repeating input.
        if (!(error instanceof errors.TimeoutError)
          && (!(error instanceof Error) || !error.message.includes('Unable to capture screenshot'))) throw error;
        await page.waitForTimeout(150);
        return capture();
      }
    });
  }
  action(owner: string, id: string, body: unknown) {
    const a = validateBrowserAction(body);
    return this.operate(owner, id, async page => {
      if (a.type === 'click') await page.mouse.click(a.x!, a.y!);
      if (a.type === 'text') await page.keyboard.insertText(a.text!);
      if (a.type === 'key') await page.keyboard.press(a.key!);
      if (a.type === 'scroll') await page.mouse.wheel(0, a.delta!);
    });
  }
  async stop(owner: string, id: string) {
    const s = this.session(owner, id);
    s.controller.abort(new Error('Manual browser closed'));
    await s.done;
  }
  async shutdown() {
    const s = this.current;
    if (s && s.state !== 'closed') {
      s.controller.abort(new Error('Server stopping'));
      await s.done;
    }
  }
}
