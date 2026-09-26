import { db, AutoResetRow } from '../db';
import { resetAccountPassword } from './passwordReset';
import { logResetHistory } from './history';
import { markReset } from './testOrders';
import { sendAdminBookingEnd } from './telegramBot';
import { sendBookingEndPush } from '../routes/push';

/**
 * Auto-reset scheduler.
 *
 * Every minute it looks for pending schedules whose run_at time has passed and
 * runs a reset for that account with this retry policy (per user spec):
 *   - try up to 3 times (30s gap between tries)
 *   - if still failing, wait 10 minutes
 *   - try up to 3 more times
 *   - if still failing, give up
 *
 * Each attempt-batch result is logged to reset_history (source 'auto').
 */

const CHECK_INTERVAL_MS = 60_000;      // check every minute
const TRIES_PER_BATCH = 3;
const GAP_BETWEEN_TRIES_MS = 30_000;   // 30s between tries in a batch
const WAIT_BETWEEN_BATCHES_MS = 10 * 60_000; // 10 minutes

let interval: ReturnType<typeof setInterval> | null = null;
const running = new Set<string>(); // account ids currently being processed

function log(msg: string) {
  console.log(`[AutoReset] ${msg}`);
}

async function attemptBatch(accountId: string): Promise<{ success: boolean; newPassword?: string; error?: string }> {
  let last: { success: boolean; newPassword?: string; error?: string } = { success: false, error: 'not run' };
  for (let i = 1; i <= TRIES_PER_BATCH; i++) {
    log(`account ${accountId}: try ${i}/${TRIES_PER_BATCH}`);
    last = await resetAccountPassword(accountId);
    if (last.success) return last;
    if (i < TRIES_PER_BATCH) await sleep(GAP_BETWEEN_TRIES_MS);
  }
  return last;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function processSchedule(row: AutoResetRow): Promise<void> {
  const accountId = row.account_id;
  if (running.has(accountId)) return;
  running.add(accountId);

  // Mark running so we don't pick it up again
  db.prepare(`UPDATE auto_reset_schedule SET status = 'running' WHERE account_id = ?`).run(accountId);

  const acc = db.prepare('SELECT name FROM accounts WHERE id = ?').get(accountId) as { name: string } | undefined;
  const accountName = acc?.name || 'Unknown';

  try {
    const ended=db.prepare("SELECT * FROM test_orders WHERE account_id=? AND status IN ('approved','delivered','delivery_failed') AND end_notified_at IS NULL AND expires_at<=? ORDER BY expires_at DESC LIMIT 1").get(accountId,new Date().toISOString()) as import('./testOrders').TestOrder|undefined;
    if(ended){
      db.prepare('UPDATE test_orders SET end_notified_at=? WHERE id=? AND end_notified_at IS NULL').run(new Date().toISOString(),ended.id);
      await Promise.allSettled([sendAdminBookingEnd(ended),sendBookingEndPush(ended)]);
    }
    log(`account ${accountId}: starting auto reset (batch 1)`);
    let result = await attemptBatch(accountId);

    if (!result.success) {
      log(`account ${accountId}: batch 1 failed, waiting 10 min before batch 2`);
      await sleep(WAIT_BETWEEN_BATCHES_MS);
      log(`account ${accountId}: starting batch 2`);
      result = await attemptBatch(accountId);
    }

    logResetHistory({
      accountId,
      accountName,
      success: result.success,
      newPassword: result.newPassword,
      error: result.success ? undefined : (result.error || 'All auto-reset attempts failed'),
      source: 'auto',
    });

    db.prepare(`UPDATE auto_reset_schedule SET status = ? WHERE account_id = ?`)
      .run(result.success ? 'done' : 'failed', accountId);
    markReset(accountId,result.success,result.error);

    log(`account ${accountId}: auto reset ${result.success ? 'SUCCESS' : 'GAVE UP'}`);
  } catch (err) {
    logResetHistory({
      accountId,
      accountName,
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
      source: 'auto',
    });
    db.prepare(`UPDATE auto_reset_schedule SET status = 'failed' WHERE account_id = ?`).run(accountId);
    markReset(accountId,false,err instanceof Error ? err.message : 'Unknown error');
  } finally {
    running.delete(accountId);
  }
}

function tick(): void {
  const now = new Date().toISOString();
  const due = db
    .prepare(`SELECT account_id, run_at, status, created_at FROM auto_reset_schedule WHERE status = 'pending' AND run_at <= ?`)
    .all(now) as AutoResetRow[];

  for (const row of due) {
    // fire-and-forget; each runs independently
    processSchedule(row).catch((e) => log(`processSchedule error: ${e}`));
  }
}

export function startAutoResetScheduler(): void {
  log('started (checks every minute)');
  if(process.env.SANDBOX_MODE === 'true') db.prepare("UPDATE auto_reset_schedule SET status='pending' WHERE status='running'").run();
  tick(); // run once on startup for any already-due schedules
  interval = setInterval(tick, CHECK_INTERVAL_MS);
}

export function stopAutoResetScheduler(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
}
