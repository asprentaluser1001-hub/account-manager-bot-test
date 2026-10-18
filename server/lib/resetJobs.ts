export type ResetResult = {success:boolean;newPassword?:string;error?:string;retryable?:boolean};
const jobs = new Map<string,{controller:AbortController;done:Promise<ResetResult>}>();
const recovering = new Set<string>();

// Manual and scheduled resets share one lock and a bounded execution window.
export async function runResetJob(accountId:string,work:(signal:AbortSignal)=>Promise<ResetResult>,externalSignal?:AbortSignal):Promise<ResetResult>{
 if(jobs.has(accountId)||recovering.has(accountId))return {success:false,error:'A reset or recovery is already in progress for this account',retryable:false};
 if(externalSignal?.aborted)return {success:false,error:'Scheduled reset cancelled',retryable:false};
 const controller=new AbortController();
 const abortFromScheduler=()=>controller.abort(externalSignal?.reason || new Error('Scheduled reset cancelled'));
 externalSignal?.addEventListener('abort',abortFromScheduler,{once:true});
 const timer=setTimeout(()=>controller.abort(new Error('Password reset timed out; use recovery or retry')),120_000);
 const done=Promise.resolve().then(()=>work(controller.signal)).catch(error=>({success:false,error:error instanceof Error?error.message:'Password reset failed',retryable:!controller.signal.aborted}));
 jobs.set(accountId,{controller,done});
 try{return await done;}finally{clearTimeout(timer);externalSignal?.removeEventListener('abort',abortFromScheduler);jobs.delete(accountId);}
}

export async function withResetStopped<T>(accountId:string,work:()=>T):Promise<T>{
 if(recovering.has(accountId))throw new Error('Account recovery is already in progress');
 recovering.add(accountId);
 try{
  const job=jobs.get(accountId);
  if(job){job.controller.abort(new Error('Reset stopped by admin'));await job.done;}
  return work();
 }finally{recovering.delete(accountId);}
}
