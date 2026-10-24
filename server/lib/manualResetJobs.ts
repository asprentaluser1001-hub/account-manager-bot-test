import { randomUUID } from 'crypto';
import { db } from '../db';
import { resetAccountPassword } from './passwordReset';
import { ResetResult, withResetStopped } from './resetJobs';
import { stopScheduledReset } from './autoResetScheduler';
import { logResetHistory } from './history';
import { markReset } from './testOrders';
import { sendCustomerResetFailure } from './telegramBot';

type Action = 'reset' | 'release';
export interface ManualResetJob {
  id:string; account_id:string; action:Action;
  status:'queued'|'running'|'retrying'|'succeeded'|'failed'|'blocked'|'cancelled';
  attempts:number; stage:string; error:string|null; error_code:string|null;
  new_password:string|null; next_attempt_at:string; created_at:string; updated_at:string; finished_at:string|null;
}
export class ManualResetRequestError extends Error {
  constructor(message:string, readonly status=409) { super(message); }
}
let interval:ReturnType<typeof setInterval>|undefined;
const running = new Map<string,{accountId:string;controller:AbortController;done:Promise<void>}>();
const recoveryInProgress=new Set<string>();

export function activeManualResetJobs():ManualResetJob[] {
  return db.prepare("SELECT * FROM manual_reset_jobs WHERE status IN ('queued','running','retrying')").all();
}
export function getManualResetJob(id:string):ManualResetJob|undefined {
  return db.prepare('SELECT * FROM manual_reset_jobs WHERE id=?').get(id);
}
export function publicManualResetJob(job:ManualResetJob) {
  return { id:job.id, accountId:job.account_id, action:job.action, status:job.status, attempts:job.attempts,
    stage:job.stage, error:job.error, errorCode:job.error_code,
    nextAttemptAt:job.status==='retrying'?job.next_attempt_at:null,
    newPassword:job.status==='succeeded'?job.new_password:undefined, updatedAt:job.updated_at };
}

// A retry/double tap returns the same active request instead of quarantining it.
export function queueManualReset(accountId:string,action:Action):ManualResetJob {
  if(recoveryInProgress.has(accountId))throw new ManualResetRequestError('Account recovery is in progress. Wait for it to finish.');
  const job=db.transaction(()=>{
    const existing=db.prepare("SELECT * FROM manual_reset_jobs WHERE account_id=? AND status IN ('queued','running','retrying')").get(accountId) as ManualResetJob|undefined;
    if(existing)return existing;
    const account=db.prepare('SELECT sold FROM accounts WHERE id=?').get(accountId) as {sold:number}|undefined;
    if(!account)throw new ManualResetRequestError('Account not found',404);
    if(action==='reset'&&account.sold)throw new ManualResetRequestError('Use Release & reset now to end a reserved account safely.');
    const schedule=db.prepare('SELECT status FROM auto_reset_schedule WHERE account_id=?').get(accountId) as {status:string}|undefined;
    if(action==='reset'&&schedule?.status==='running')throw new ManualResetRequestError('An automatic reset is already running.');
    const now=new Date().toISOString(),id=randomUUID();
    db.prepare(`INSERT INTO manual_reset_jobs(id,account_id,action,status,stage,next_attempt_at,created_at,updated_at)
      VALUES (?,?,?,'queued','Queued',?,?,?)`).run(id,accountId,action,now,now,now);
    // A pending/uncertain password must never be delivered to another booking.
    db.prepare('UPDATE accounts SET sold=1,sold_until=NULL WHERE id=?').run(accountId);
    return getManualResetJob(id)!;
  })();
  if(interval)dispatch(job.id);
  return job;
}

export async function stopManualResetJobs(accountId:string):Promise<void> {
  const now=new Date().toISOString();
  db.prepare(`UPDATE manual_reset_jobs SET status='cancelled',stage='Stopped by admin',finished_at=?,updated_at=?
    WHERE account_id=? AND status IN ('queued','running','retrying')`).run(now,now,accountId);
  const work=[...running.values()].filter(work=>work.accountId===accountId);
  for(const job of work)job.controller.abort(new Error('Reset stopped by admin'));
  await Promise.allSettled(work.map(job=>job.done));
}

export async function withManualResetRecovery<T>(accountId:string,work:()=>T):Promise<T> {
  if(recoveryInProgress.has(accountId))throw new ManualResetRequestError('Account recovery is already in progress.');
  recoveryInProgress.add(accountId);
  try {
    // Persist the expiry pause before waiting for a manual browser to stop.
    stopScheduledReset(accountId);
    await stopManualResetJobs(accountId);
    return await withResetStopped(accountId,work);
  } finally { recoveryInProgress.delete(accountId); }
}

function recordResult(job:ManualResetJob,result:ResetResult):boolean {
  return db.transaction(()=>{
    const now=new Date().toISOString();
    const row=getManualResetJob(job.id);
    if(row?.status!=='running')return false;
    if(!result.success&&(result.retryable!==false||result.errorCode==='busy')&&(job.attempts<6||result.errorCode==='busy')) {
      const busy=result.errorCode==='busy';
      const delay=busy?5000:job.attempts===3?10*60_000:30_000;
      db.prepare(`UPDATE manual_reset_jobs SET status='retrying',stage=?,error=?,error_code=?,attempts=?,next_attempt_at=?,updated_at=? WHERE id=?`)
        .run(busy?'Waiting for the current reset':'Waiting to retry',result.error||'Temporary reset failure',result.errorCode||'transient',
          busy?Math.max(0,job.attempts-1):job.attempts,new Date(Date.now()+delay).toISOString(),now,job.id);
      return false;
    }
    const status=result.success?'succeeded':result.errorCode==='site_blocked'?'blocked':'failed';
    const stage=result.success?'Password verified':status==='blocked'?'Site verification required':'Reset needs review';
    db.prepare(`UPDATE manual_reset_jobs SET status=?,stage=?,error=?,error_code=?,new_password=?,updated_at=?,finished_at=? WHERE id=?`)
      .run(status,stage,result.success?null:result.error||'Reset failed',result.errorCode||null,result.success?result.newPassword||null:null,now,now,job.id);
    const account=db.prepare('SELECT name FROM accounts WHERE id=?').get(job.account_id) as {name:string}|undefined;
    if(!account)return false;
    markReset(job.account_id,result.success,result.error);
    if(result.success) {
      if(job.action==='release')db.prepare('DELETE FROM auto_reset_schedule WHERE account_id=?').run(job.account_id);
      else db.prepare("UPDATE auto_reset_schedule SET status='done' WHERE account_id=? AND (run_at<=? OR status='failed')").run(job.account_id,now);
    } else {
      db.prepare('UPDATE accounts SET sold=1 WHERE id=?').run(job.account_id);
      db.prepare(`INSERT INTO auto_reset_schedule(account_id,run_at,status,created_at) VALUES (?,?,'failed',?)
        ON CONFLICT(account_id) DO UPDATE SET status='failed'`).run(job.account_id,now,now);
    }
    logResetHistory({accountId:job.account_id,accountName:account.name,success:result.success,
      newPassword:result.newPassword,error:result.error,source:'manual'});
    return !result.success;
  })();
}

function dispatch(id:string):void {
  if(running.has(id))return;
  const row=getManualResetJob(id);
  if(!row||!['queued','retrying'].includes(row.status)||row.next_attempt_at>new Date().toISOString())return;
  const claim=db.prepare(`UPDATE manual_reset_jobs SET status='running',attempts=attempts+1,stage='Waiting for reset worker',updated_at=?
    WHERE id=? AND status IN ('queued','retrying') AND next_attempt_at<=?`).run(new Date().toISOString(),id,new Date().toISOString());
  if(!claim.changes)return;
  const job=getManualResetJob(id)!,controller=new AbortController();
  // Defer work until the ownership record is installed, including sandbox work.
  const done=Promise.resolve().then(async()=>{
    let result:ResetResult;
    try {
      if(job.action==='release') {
        stopScheduledReset(job.account_id);
        await withResetStopped(job.account_id,()=>{});
      }
      controller.signal.throwIfAborted();
      result=await resetAccountPassword(job.account_id,controller.signal,stage=>{
        db.prepare("UPDATE manual_reset_jobs SET stage=?,updated_at=? WHERE id=? AND status='running'")
          .run(stage,new Date().toISOString(),id);
      });
    } catch(error) {
      if(controller.signal.aborted)return;
      result={success:false,retryable:true,errorCode:'transient',error:error instanceof Error?error.message:'Reset worker unavailable'};
    }
    if(controller.signal.aborted)return;
    const notify=recordResult(job,result);
    console.log(`[ManualReset] ${job.account_id} attempt ${job.attempts}: ${getManualResetJob(id)?.status}`);
    if(notify)void sendCustomerResetFailure(job.account_id).catch(()=>false);
  }).catch(error=>console.error('[ManualReset] Worker failed:',error instanceof Error?error.name:'Error'))
    .finally(()=>running.delete(id));
  running.set(id,{accountId:job.account_id,controller,done});
}

function tick():void {
  const jobs=db.prepare("SELECT id FROM manual_reset_jobs WHERE status IN ('queued','retrying') AND next_attempt_at<=? ORDER BY created_at,id")
    .all(new Date().toISOString()) as {id:string}[];
  for(const job of jobs)dispatch(job.id);
}
export function startManualResetWorker():void {
  if(interval)return;
  const now=new Date().toISOString();
  db.prepare(`UPDATE manual_reset_jobs SET status='queued',stage='Resuming interrupted reset',attempts=MAX(0,attempts-1),next_attempt_at=?,updated_at=?
    WHERE status='running'`).run(now,now);
  interval=setInterval(tick,1000);
  tick();
}
export async function stopManualResetWorker():Promise<void> {
  clearInterval(interval);interval=undefined;
  const work=[...running.values()];
  for(const job of work)job.controller.abort(new Error('Server stopping'));
  await Promise.allSettled(work.map(job=>job.done));
}
