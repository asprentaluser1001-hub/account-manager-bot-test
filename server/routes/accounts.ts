import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { db, AccountRow, ResetHistoryRow, AutoResetRow } from '../db';
import { adminAuth } from '../auth';
import { resetAccountPassword } from '../lib/passwordReset';
import { logResetHistory } from '../lib/history';

/**
 * Account routes. All protected by adminAuth.
 *   GET    /api/accounts               -> list all accounts
 *   POST   /api/accounts               -> add an account { name, email, password }
 *   PATCH  /api/accounts/:id           -> edit { name, email, password }
 *   PATCH  /api/accounts/:id/sold      -> set sold { sold: boolean }
 *   DELETE /api/accounts/:id           -> delete
 *   POST   /api/accounts/:id/reset-password  -> reset now (headless chromium)
 *   POST   /api/accounts/:id/auto-reset      -> schedule auto reset { runAt }
 *   DELETE /api/accounts/:id/auto-reset      -> cancel scheduled auto reset
 *   GET    /api/history                -> reset history (newest first)
 *
 * Passwords are stored and returned in plain text on purpose: this dashboard
 * exists to view/manage the external-site credentials. Protect it with a
 * strong ADMIN_PASSWORD.
 */

export const accountsRouter = Router();
export const historyRouter = Router();

accountsRouter.use(adminAuth);
historyRouter.use(adminAuth);

// Auto-unsell any account whose sold_until has passed. Called before listing.
function expireSold() {
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE accounts SET sold = 0, sold_until = NULL WHERE sold = 1 AND sold_until IS NOT NULL AND sold_until <= ?`
  ).run(now);
}

// Attach the pending auto-reset schedule (if any) to each account row.
function withSchedule(rows: AccountRow[]) {
  const schedules = db
    .prepare(`SELECT account_id, run_at, status FROM auto_reset_schedule WHERE status = 'pending'`)
    .all() as AutoResetRow[];
  const map = new Map(schedules.map((s) => [s.account_id, s]));
  return rows.map((r) => ({
    ...r,
    sold: !!r.sold,
    soldUntil: r.sold_until ?? null,
    autoResetAt: map.get(r.id)?.run_at ?? null,
  }));
}

// List all accounts (newest first)
accountsRouter.get('/', (_req: Request, res: Response) => {
  if (process.env.SANDBOX_MODE !== 'true') expireSold();
  const rows = db
    .prepare('SELECT id, name, email, password, sold, sold_until, last_reset_at, created_at FROM accounts ORDER BY created_at DESC')
    .all() as AccountRow[];
  return res.json({ accounts: withSchedule(rows) });
});

// Add an account
accountsRouter.post('/', (req: Request, res: Response) => {
  const { name, email, password } = req.body || {};

  if (process.env.SANDBOX_MODE === 'true' && (!String(email).endsWith('@example.invalid') || !String(name).startsWith('Sample'))) return res.status(400).json({error:'Test mode accepts only Sample names and @example.invalid addresses'});
  if (typeof name !== 'string' || name.trim() === '') return res.status(400).json({ error: 'name is required' });
  if (typeof email !== 'string' || email.trim() === '') return res.status(400).json({ error: 'email is required' });
  if (typeof password !== 'string' || password.trim() === '') return res.status(400).json({ error: 'password is required' });

  const row: AccountRow = {
    id: uuidv4(),
    name: name.trim(),
    email: email.trim(),
    password: password.trim(),
    sold: 0,
    sold_until: null,
    last_reset_at: null,
    created_at: new Date().toISOString(),
  };

  db.prepare(
    'INSERT INTO accounts (id, name, email, password, sold, sold_until, last_reset_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).run(row.id, row.name, row.email, row.password, row.sold, row.sold_until, row.last_reset_at, row.created_at);

  return res.status(201).json({ account: { ...row, sold: false, soldUntil: null, autoResetAt: null } });
});

// Edit an account's credentials
accountsRouter.patch('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const { name, email, password } = req.body || {};

  const existing = db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined;
  if (!existing) return res.status(404).json({ error: 'Account not found' });

  if (process.env.SANDBOX_MODE === 'true' && ((email && !String(email).endsWith('@example.invalid')) || (name && !String(name).startsWith('Sample')))) return res.status(400).json({error:'Only sample accounts can be edited in this sandbox.'});
  const newName = typeof name === 'string' && name.trim() ? name.trim() : existing.name;
  const newEmail = typeof email === 'string' && email.trim() ? email.trim() : existing.email;
  const newPassword = typeof password === 'string' && password.trim() ? password.trim() : existing.password;

  db.prepare('UPDATE accounts SET name = ?, email = ?, password = ? WHERE id = ?')
    .run(newName, newEmail, newPassword, id);

  return res.json({ ok: true });
});

// Set "sold" state. To mark sold, pass { sold: true, hours: 1..24 } and the
// account auto-unsells after that many hours. To unsell, pass { sold: false }.
accountsRouter.patch('/:id/sold', (req: Request, res: Response) => {
  const { id } = req.params;
  const { sold, hours } = req.body || {};
  const existing = db.prepare('SELECT id FROM accounts WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Account not found' });

  if (process.env.SANDBOX_MODE === 'true') return res.status(403).json({error:'Use test orders to reserve sample accounts.'});
  if (sold) {
    const h = Number(hours);
    if (!Number.isFinite(h) || h <= 0 || h > 24) {
      return res.status(400).json({ error: 'hours must be between 1 and 24' });
    }
    const soldUntil = new Date(Date.now() + h * 60 * 60 * 1000).toISOString();
    db.prepare('UPDATE accounts SET sold = 1, sold_until = ? WHERE id = ?').run(soldUntil, id);
    return res.json({ ok: true, sold: true, soldUntil });
  }

  db.prepare('UPDATE accounts SET sold = 0, sold_until = NULL WHERE id = ?').run(id);
  return res.json({ ok: true, sold: false, soldUntil: null });
});

// Delete an account (also clears any pending schedule)
accountsRouter.delete('/:id', (req: Request, res: Response) => {
  const { id } = req.params;
  const result = db.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  if (result.changes === 0) return res.status(404).json({ error: 'Account not found' });
  db.prepare('DELETE FROM auto_reset_schedule WHERE account_id = ?').run(id);
  return res.json({ ok: true });
});

// Reset password now (headless Chromium). Logs to history either way.
accountsRouter.post('/:id/reset-password', async (req: Request, res: Response) => {
  const { id } = req.params;
  const acc = db.prepare('SELECT name FROM accounts WHERE id = ?').get(id) as { name: string } | undefined;
  const result = await resetAccountPassword(id);

  logResetHistory({
    accountId: id,
    accountName: acc?.name || 'Unknown',
    success: result.success,
    newPassword: result.newPassword,
    error: result.error,
    source: 'manual',
  });

  if (!result.success) return res.status(500).json({ error: result.error || 'Password reset failed' });
  return res.json({ success: true, newPassword: result.newPassword });
});

// Schedule an auto reset at a specific time (ISO string in body: { runAt })
accountsRouter.post('/:id/auto-reset', (req: Request, res: Response) => {
  const { id } = req.params;
  const { runAt } = req.body || {};

  const existing = db.prepare('SELECT id FROM accounts WHERE id = ?').get(id);
  if (!existing) return res.status(404).json({ error: 'Account not found' });

  const when = new Date(runAt);
  if (isNaN(when.getTime())) return res.status(400).json({ error: 'Invalid runAt time' });

  db.prepare(
    `INSERT INTO auto_reset_schedule (account_id, run_at, status, created_at)
     VALUES (?, ?, 'pending', ?)
     ON CONFLICT(account_id) DO UPDATE SET run_at = excluded.run_at, status = 'pending', created_at = excluded.created_at`
  ).run(id, when.toISOString(), new Date().toISOString());

  return res.json({ ok: true, runAt: when.toISOString() });
});

// Cancel a scheduled auto reset
accountsRouter.delete('/:id/auto-reset', (req: Request, res: Response) => {
  const { id } = req.params;
  db.prepare('DELETE FROM auto_reset_schedule WHERE account_id = ?').run(id);
  return res.json({ ok: true });
});

// ── History ──
historyRouter.get('/', (_req: Request, res: Response) => {
  const rows = db
    .prepare('SELECT * FROM reset_history ORDER BY created_at DESC LIMIT 100')
    .all() as ResetHistoryRow[];
  return res.json({
    history: rows.map((r) => ({ ...r, success: !!r.success })),
  });
});
