export type ResetResult = {success:boolean;newPassword?:string;error?:string};
const jobs = new Map<string,{controller:AbortController;done:Promise<ResetResult>}>();
const recovering = new Set<string>();

// Manual and scheduled resets share one lock and a bounded execution window.
export async function runResetJob(accountId:string,work:(signal:AbortSignal)=>Promise<ResetResult>):Promise<ResetResult>{
 if(jobs.has(accountId)||recovering.has(accountId))return {success:false,error:'A reset or recovery is already in progress for this account'};
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(new Error('Password reset timed out; use recovery or retry')),120_000);
 const done=Promise.resolve().then(()=>work(controller.signal)).catch(error=>({success:false,error:error instanceof Error?error.message:'Password reset failed'}));
 jobs.set(accountId,{controller,done});
 try{return await done;}finally{clearTimeout(timer);jobs.delete(accountId);}
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
