import { v4 as uuidv4 } from 'uuid';
import { db } from '../db';

/**
 * Records a password reset attempt (manual or auto) in reset_history.
 */
export function logResetHistory(entry: {
  accountId: string;
  accountName: string;
  success: boolean;
  newPassword?: string;
  error?: string;
  source: 'manual' | 'auto';
}): void {
  db.prepare(
    `INSERT INTO reset_history (id, account_id, account_name, success, new_password, error, source, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    uuidv4(),
    entry.accountId,
    entry.accountName,
    entry.success ? 1 : 0,
    entry.newPassword ?? null,
    entry.error ?? null,
    entry.source,
    new Date().toISOString()
  );
}
