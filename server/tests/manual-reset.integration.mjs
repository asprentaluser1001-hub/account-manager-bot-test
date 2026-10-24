import {test,after,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url),dir=mkdtempSync(join(tmpdir(),'manual-reset-'));
process.env.DB_PATH=join(dir,'test.sqlite');process.env.SANDBOX_MODE='false';process.env.V3_PREVIEW='false';process.env.TELEGRAM_BOT_TOKEN='';
process.env.JWT_SECRET='manual-reset-test-secret-at-least-thirty-two-characters';process.env.ADMIN_PASSWORD='manual-reset-admin-password';
const {db}=require('../dist/db.js');
const orders=require('../dist/lib/testOrders.js');require('../dist/lib/v3Features.js');
const worker=require('../dist/lib/passwordReset.js'),original=worker.resetAccountPassword;
const jobs=require('../dist/lib/manualResetJobs.js');
const scheduler=require('../dist/lib/autoResetScheduler.js');
const {runResetJob,shutdownResetJobs}=require('../dist/lib/resetJobs.js');
let seq=0;
function add(){const id='manual-'+(++seq);db.prepare('INSERT INTO accounts(id,name,email,password,created_at) VALUES (?,?,?,?,?)').run(id,id,id+'@example.invalid','old-password',new Date().toISOString());return id;}
function account(id){return db.prepare('SELECT * FROM accounts WHERE id=?').get(id);}
async function status(id,wanted){for(let i=0;i<100;i++){const job=jobs.getManualResetJob(id);if(wanted.includes(job.status))return job;await new Promise(setImmediate);}assert.fail('Job did not reach '+wanted+': '+JSON.stringify(jobs.getManualResetJob(id)));}
afterEach(async()=>{scheduler.stopAutoResetScheduler();await jobs.stopManualResetWorker();await shutdownResetJobs();db.prepare('DELETE FROM manual_reset_jobs').run();worker.resetAccountPassword=original;});
after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});

test('double taps return one durable job and inventory is held before the worker starts',async()=>{
 const id=add(),first=jobs.queueManualReset(id,'reset'),again=jobs.queueManualReset(id,'reset');
 assert.equal(first.id,again.id);assert.equal(account(id).sold,1);
 assert.equal(orders.availableAccounts().some(a=>a.id===id),false);
 assert.equal(require('../dist/lib/v5Bookings.js').availability(1).find(a=>a.id===id).availableAt,null);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reset_history WHERE account_id=?').get(id).n,0);
 let calls=0;worker.resetAccountPassword=async accountId=>{calls++;return orders.sandboxReset(accountId);};
 jobs.startManualResetWorker();const done=await status(first.id,['succeeded']);
 assert.equal(calls,1);assert.equal(done.attempts,1);assert.equal(account(id).sold,0);
 assert.equal(jobs.publicManualResetJob(done).newPassword,account(id).password);
});

test('temporary failure retries after restart without quarantining the customer or losing its delay',async()=>{
 const id=add();let calls=0;
 worker.resetAccountPassword=async accountId=>++calls===1?{success:false,retryable:true,errorCode:'transient',error:'Temporary navigation failure'}:orders.sandboxReset(accountId);
 const job=jobs.queueManualReset(id,'reset');jobs.startManualResetWorker();
 const waiting=await status(job.id,['retrying']);
 assert.equal(waiting.attempts,1);assert.ok(Date.parse(waiting.next_attempt_at)>Date.now());
 assert.equal(account(id).password,'old-password');assert.equal(account(id).sold,1);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reset_history WHERE account_id=?').get(id).n,0);
 assert.equal(db.prepare('SELECT status FROM auto_reset_schedule WHERE account_id=?').get(id),undefined);
 assert.equal(jobs.publicManualResetJob(waiting).newPassword,undefined);
 await jobs.stopManualResetWorker();jobs.startManualResetWorker();
 await new Promise(setImmediate);assert.equal(calls,1,'restart must preserve the retry delay');
 await jobs.stopManualResetWorker();db.prepare('UPDATE manual_reset_jobs SET next_attempt_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),job.id);
 jobs.startManualResetWorker();const done=await status(job.id,['succeeded']);
 assert.equal(calls,2);assert.equal(done.attempts,2);assert.equal(account(id).sold,0);
});

test('site verification is a blocked job, preserves credentials and does not automatically resubmit',async()=>{
 const id=add();let calls=0;
 worker.resetAccountPassword=async()=>{calls++;return {success:false,retryable:false,errorCode:'site_blocked',error:'Site returned 403 before login'};};
 const job=jobs.queueManualReset(id,'reset');jobs.startManualResetWorker();
 const blocked=await status(job.id,['blocked']);
 assert.equal(blocked.error_code,'site_blocked');assert.equal(calls,1);
 assert.equal(account(id).password,'old-password');assert.equal(account(id).sold,1);
 assert.equal(db.prepare('SELECT status FROM auto_reset_schedule WHERE account_id=?').get(id).status,'failed');
 await jobs.stopManualResetWorker();jobs.startManualResetWorker();await new Promise(setImmediate);
 assert.equal(calls,1);
});

test('retries are bounded and the fourth attempt waits ten minutes',async()=>{
 const id=add();worker.resetAccountPassword=async()=>({success:false,retryable:true,errorCode:'timeout',error:'Execution deadline'});
 const job=jobs.queueManualReset(id,'reset');jobs.startManualResetWorker();
 for(let attempt=1;attempt<=6;attempt++){
  const row=await status(job.id,[attempt===6?'failed':'retrying']);assert.equal(row.attempts,attempt);
  if(attempt===3)assert.ok(Date.parse(row.next_attempt_at)-Date.now()>599_000);
  if(attempt<6){await jobs.stopManualResetWorker();db.prepare('UPDATE manual_reset_jobs SET next_attempt_at=? WHERE id=?').run(new Date(0).toISOString(),job.id);jobs.startManualResetWorker();}
 }
 assert.equal(account(id).sold,1);
 assert.equal(db.prepare('SELECT COUNT(*) AS n FROM reset_history WHERE account_id=?').get(id).n,1);
});

test('an interrupted worker resumes its preserved candidate instead of losing its job',async()=>{
 const id=add();let calls=0;
 worker.resetAccountPassword=(accountId,parent)=>runResetJob(accountId,signal=>{
  calls++;
  if(calls===1){db.prepare('UPDATE accounts SET reset_candidate_password=? WHERE id=?').run('candidate-password',accountId);
   return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}
  assert.equal(account(accountId).reset_candidate_password,'candidate-password');
  db.prepare('UPDATE accounts SET password=reset_candidate_password,reset_candidate_password=NULL,last_reset_at=? WHERE id=?').run(new Date().toISOString(),accountId);
  return Promise.resolve({success:true,newPassword:'candidate-password'});
 },parent);
 const job=jobs.queueManualReset(id,'reset');jobs.startManualResetWorker();
 for(let i=0;i<50&&calls===0;i++)await new Promise(setImmediate);
 assert.equal(calls,1);await jobs.stopManualResetWorker();
 assert.equal(jobs.getManualResetJob(job.id).status,'running');
 jobs.startManualResetWorker();const done=await status(job.id,['succeeded']);
 assert.equal(calls,2);assert.equal(done.attempts,1);assert.equal(account(id).password,'candidate-password');
});

test('recovery cancellation remains cancelled across a restart',async()=>{
 const id=add();let calls=0;worker.resetAccountPassword=async()=>{calls++;return {success:true};};
 const job=jobs.queueManualReset(id,'reset');await jobs.stopManualResetJobs(id);jobs.startManualResetWorker();
 await new Promise(setImmediate);assert.equal(calls,0);assert.equal(jobs.getManualResetJob(job.id).status,'cancelled');
});

test('a new request cannot slip into the asynchronous recovery window',async()=>{
 const id=add(),job=jobs.queueManualReset(id,'reset');
 const recovery=jobs.withManualResetRecovery(id,()=>({ok:true}));
 assert.throws(()=>jobs.queueManualReset(id,'release'),/recovery is in progress/i);
 await recovery;
 assert.equal(jobs.getManualResetJob(job.id).status,'cancelled');
 assert.equal(db.prepare('SELECT status FROM auto_reset_schedule WHERE account_id=?').get(id),undefined);
 const next=jobs.queueManualReset(id,'release');assert.notEqual(next.id,job.id);
});

test('automatic expiry skips an account owned by a queued manual job',async()=>{
 const id=add();let calls=0;worker.resetAccountPassword=async()=>{calls++;return {success:true};};
 db.prepare("INSERT INTO auto_reset_schedule VALUES (?,?,'pending',?)").run(id,new Date(0).toISOString(),new Date().toISOString());
 jobs.queueManualReset(id,'reset');scheduler.startAutoResetScheduler();
 await new Promise(setImmediate);assert.equal(calls,0);
 assert.equal(db.prepare('SELECT status FROM auto_reset_schedule WHERE account_id=?').get(id).status,'pending');
});

test('manual success preserves a future schedule and release ends the linked booking safely',async()=>{
 const id=add(),future=new Date(Date.now()+3600_000).toISOString();
 db.prepare("INSERT INTO auto_reset_schedule VALUES (?,?,'pending',?)").run(id,future,new Date().toISOString());
 worker.resetAccountPassword=async accountId=>orders.sandboxReset(accountId);
 let job=jobs.queueManualReset(id,'reset');jobs.startManualResetWorker();await status(job.id,['succeeded']);
 assert.equal(db.prepare('SELECT run_at FROM auto_reset_schedule WHERE account_id=?').get(id).run_at,future);
 const booked=add(),order=orders.createManualBooking('Test Customer','',1,100,booked,'');
 job=jobs.queueManualReset(booked,'release');await status(job.id,['succeeded']);
 assert.equal(orders.getOrder(order.id).status,'expired');assert.equal(account(booked).sold,0);
 assert.equal(db.prepare('SELECT 1 FROM auto_reset_schedule WHERE account_id=?').get(booked),undefined);
});

test('HTTP requests are authenticated, idempotent and can stop running work through recovery',async()=>{
 const express=require('express'),jwt=require('jsonwebtoken'),{accountsRouter}=require('../dist/routes/accounts.js');
 const app=express();app.use(express.json());app.use('/api/accounts',accountsRouter);
 const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
 const base='http://127.0.0.1:'+server.address().port,id=add(),token=jwt.sign({role:'admin'},process.env.JWT_SECRET);
 const call=async(path,method='GET',body,authenticated=true)=>{
  const response=await fetch(base+'/api/accounts'+path,{method,headers:{'Content-Type':'application/json',...(authenticated?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});
  return {status:response.status,cache:response.headers.get('cache-control'),data:await response.json()};
 };
 worker.resetAccountPassword=(accountId,parent,progress)=>runResetJob(accountId,signal=>{
  progress?.('checking previously attempted password');
  return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));
 },parent);
 jobs.startManualResetWorker();
 try{
  assert.equal((await call('/'+id+'/reset-password','POST',{},false)).status,401);
  const first=await call('/'+id+'/reset-password','POST',{});assert.equal(first.status,202);assert.equal(first.cache,'no-store');
  const again=await call('/'+id+'/reset-password','POST',{});assert.equal(again.status,202);assert.equal(again.data.job.id,first.data.job.id);
  const path='/'+id+'/reset-jobs/'+first.data.job.id;
  assert.equal((await call(path,'GET',undefined,false)).status,401);
  assert.equal((await call('/other/reset-jobs/'+first.data.job.id)).status,404);
  assert.equal((await call(path)).data.job.status,'running');
  assert.equal((await call('/'+id,'PATCH',{password:'must-not-be-applied'})).status,409);
  assert.equal((await call('/'+id+'/sold','PATCH',{sold:false})).status,409);
  const stopped=await call('/'+id+'/recovery','POST',{action:'stop'});assert.equal(stopped.status,200);
  assert.equal((await call(path)).data.job.status,'cancelled');
  assert.equal(account(id).password,'old-password');assert.equal(account(id).sold,1);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
