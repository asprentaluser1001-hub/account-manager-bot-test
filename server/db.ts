// Sandbox uses Node.js 24+ built-in SQLite, without a native add-on.
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => any };
import path from 'path';

/**
 * SQLite storage for VIP accounts. Fully local — no external database.
 * The DB file lives on the same VPS (path from DB_PATH env, default ./data.db).
 */

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.db');

export const db: any = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode=WAL');
db.transaction = (fn: (...args:any[]) => any) => (...args:any[]) => {
 db.exec('BEGIN IMMEDIATE');
 try { const result=fn(...args); db.exec('COMMIT'); return result; }
 catch(err){db.exec('ROLLBACK');throw err;}
};

// Accounts table.
db.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL,
    password      TEXT NOT NULL,
    sold          INTEGER NOT NULL DEFAULT 0,
    sold_until    TEXT,
    last_reset_at TEXT,
    created_at    TEXT NOT NULL
  );
`);

// Reset history — one row per password reset attempt/result.
db.exec(`
  CREATE TABLE IF NOT EXISTS reset_history (
    id            TEXT PRIMARY KEY,
    account_id    TEXT NOT NULL,
    account_name  TEXT NOT NULL,
    success       INTEGER NOT NULL,
    new_password  TEXT,
    error         TEXT,
    source        TEXT NOT NULL,   -- 'manual' | 'auto'
    created_at    TEXT NOT NULL
  );
`);

// Auto-reset schedule — at most one pending schedule per account.
db.exec(`
  CREATE TABLE IF NOT EXISTS auto_reset_schedule (
    account_id    TEXT PRIMARY KEY,
    run_at        TEXT NOT NULL,   -- ISO timestamp when the reset should run
    status        TEXT NOT NULL,   -- 'pending' | 'running' | 'done' | 'failed'
    created_at    TEXT NOT NULL
  );
`);

// ── Lightweight migration for existing DBs (add missing columns) ──
try {
  const cols = db.prepare(`PRAGMA table_info(accounts)`).all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === 'sold')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN sold INTEGER NOT NULL DEFAULT 0`);
  }
  if (!cols.some((c) => c.name === 'sold_until')) {
    db.exec(`ALTER TABLE accounts ADD COLUMN sold_until TEXT`);
  }
} catch {
  /* ignore */
}

export interface AccountRow {
  id: string;
  name: string;
  email: string;
  password: string;
  sold: number;
  sold_until: string | null;
  last_reset_at: string | null;
  created_at: string;
}

export interface ResetHistoryRow {
  id: string;
  account_id: string;
  account_name: string;
  success: number;
  new_password: string | null;
  error: string | null;
  source: string;
  created_at: string;
}

export interface AutoResetRow {
  account_id: string;
  run_at: string;
  status: string;
  created_at: string;
}
