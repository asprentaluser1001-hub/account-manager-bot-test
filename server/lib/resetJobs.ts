export type ResetResult = { success: boolean; newPassword?: string; error?: string; retryable?: boolean };
const jobs = new Map<string, { controller: AbortController; done: Promise<ResetResult> }>();
const recovering = new Set<string>();
// All accounts share a FIFO browser slot. Waiting does not consume the job timeout.
let queue: Promise<void> = Promise.resolve();

export async function runResetJob(
  accountId: string,
  work: (signal: AbortSignal) => Promise<ResetResult>,
  externalSignal?: AbortSignal
): Promise<ResetResult> {
  if (jobs.has(accountId) || recovering.has(accountId)) {
    return { success: false, error: 'A reset or recovery is already in progress for this account', retryable: false };
  }
  if (externalSignal?.aborted) return { success: false, error: 'Scheduled reset cancelled', retryable: false };
  const controller = new AbortController();
  const cancel = () => controller.abort(externalSignal?.reason || new Error('Scheduled reset cancelled'));
  externalSignal?.addEventListener('abort', cancel, { once: true });
  const previous = queue;
  const done = (async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopWaiting: (() => void) | undefined;
    try {
      await Promise.race([previous, new Promise<never>((_resolve, reject) => {
        stopWaiting = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', stopWaiting, { once: true });
      })]);
      controller.signal.throwIfAborted();
      timer = setTimeout(() => controller.abort(new Error('Password reset timed out; automatic retry will check the attempted password')), 120_000);
      return await work(controller.signal);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Password reset failed', retryable: !controller.signal.aborted };
    } finally {
      clearTimeout(timer);
      if (stopWaiting) controller.signal.removeEventListener('abort', stopWaiting);
    }
  })();
  // A cancelled queued job can finish immediately, but cannot let later jobs
  // overtake the browser that still owns the slot.
  queue = previous.then(() => done).then(() => {}, () => {});
  jobs.set(accountId, { controller, done });
  try { return await done; }
  finally { externalSignal?.removeEventListener('abort', cancel); jobs.delete(accountId); }
}

export async function withResetStopped<T>(accountId: string, work: () => T): Promise<T> {
  if (recovering.has(accountId)) throw new Error('Account recovery is already in progress');
  recovering.add(accountId);
  try {
    const job = jobs.get(accountId);
    if (job) {
      job.controller.abort(new Error('Reset stopped by admin'));
      await job.done;
    }
    return work();
  } finally { recovering.delete(accountId); }
}

