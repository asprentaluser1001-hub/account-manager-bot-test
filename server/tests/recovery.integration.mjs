import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';

const require=createRequire(import.meta.url);
const dir=mkdtempSync(join(tmpdir(),'fr-recovery-'));
process.env.DB_PATH=join(dir,'unit.sqlite');
process.env.SANDBOX_MODE='false';process.env.V3_PREVIEW='false';
process.env.TELEGRAM_BOT_TOKEN='';
const {db}=require('../dist/db.js');
const orders=require('../dist/lib/testOrders.js');
const features=require('../dist/lib/v3Features.js');
const bot=require('../dist/lib/telegramBot.js');
after(()=>{db.close();rmSync(dir,{recursive:true,force:true});});

test('extra time preserves money and migration preserves time, extension links and isolation',()=>{
 const now=new Date().toISOString();
 for(const id of ['old','replacement','last'])db.prepare('INSERT INTO accounts(id,name,email,password,created_at) VALUES (?,?,?,?,?)').run(id,id,id+'@example.invalid','test-only',now);
 const booking=orders.createManualBooking('Test Customer','',1,100,'old','');
 const extension=orders.createManualExtension('Test Customer','',50,'old');
 const before=orders.summary().revenue;
 let expiry=orders.getOrder(booking.id).expires_at;
 for(const minutes of [10,15,30]){
  const changed=features.addExtraTime(booking.id,minutes);
  assert.equal(new Date(changed.expires_at)-new Date(expiry),minutes*60_000);
  assert.equal(db.prepare('SELECT sold_until FROM accounts WHERE id=?').get('old').sold_until,changed.expires_at);
  assert.equal(db.prepare('SELECT run_at FROM auto_reset_schedule WHERE account_id=?').get('old').run_at,changed.expires_at);
  expiry=changed.expires_at;
 }
 assert.equal(orders.summary().revenue,before);
 for(const invalid of [0,5,20,60,'10',null])assert.throws(()=>features.addExtraTime(booking.id,invalid),/10, 15 or 30/);
 db.prepare("UPDATE auto_reset_schedule SET status='running' WHERE account_id='old'").run();
 assert.throws(()=>features.addExtraTime(booking.id,10),/reset has started/);
 assert.throws(()=>features.transferBooking(booking.id,'replacement'),/Stop the current reset/);
 db.prepare("UPDATE auto_reset_schedule SET status='pending' WHERE account_id='old'").run();
 assert.throws(()=>features.transferBooking(booking.id,'old'),/available account/);
 const migrated=features.transferBooking(booking.id,'replacement');
 assert.equal(migrated.expires_at,expiry);
 assert.equal(orders.getOrder(extension.id).account_id,'replacement');
 assert.equal(db.prepare('SELECT sold FROM accounts WHERE id=?').get('old').sold,1);
 assert.equal(db.prepare('SELECT status FROM auto_reset_schedule WHERE account_id=?').get('old').status,'pending');
 orders.markReset('old',true);
 assert.equal(orders.getOrder(booking.id).status,'delivered');
 orders.markReset('replacement',false,'test failure');
 assert.equal(orders.getOrder(booking.id).status,'reset_failed');
 orders.markReset('replacement',true);
 db.prepare("UPDATE auto_reset_schedule SET status='done' WHERE account_id='replacement'").run();
 assert.equal(orders.getOrder(booking.id).status,'expired');
 assert.ok(orders.availableAccounts().some(a=>a.id==='replacement'));
 assert.equal(features.bookingEvents(booking.id).filter(e=>e.kind==='extra_time').length,3);
});

test('reset jobs reject duplicates and cancellation finishes before recovery',async()=>{
 const {runResetJob,withResetStopped}=require('../dist/lib/resetJobs.js');
 let aborted=false;
 const job=runResetJob('lock-test',signal=>new Promise(resolve=>signal.addEventListener('abort',()=>{aborted=true;resolve({success:false,error:'Stopped'});},{once:true})));
 await Promise.resolve();
 assert.equal((await runResetJob('lock-test',async()=>({success:true}))).success,false);
 await withResetStopped('lock-test',()=>assert.equal(aborted,true));
 assert.equal((await job).success,false);
 assert.equal((await runResetJob('lock-test',async()=>({success:true}))).success,true);
});

test('unverified external changes preserve both the old and attempted password',async()=>{
 const {chromium}=require('playwright');
 const original=chromium.launchPersistentContext;
 let launches=0;
 chromium.launchPersistentContext=async()=>{
  const verifying=++launches===2;
  const page={setDefaultTimeout(){},setDefaultNavigationTimeout(){},goto:async()=>{},click:async()=>{},fill:async()=>{},waitForTimeout:async()=>{},locator:(selector)=>({all:async()=>{if(verifying&&selector==='.mw-user.red-lnk')throw new Error('New credentials could not be verified');return [{isVisible:async()=>true,click:async()=>{}}];}}),waitForSelector:async()=>{if(verifying)throw new Error('New credentials could not be verified');}};
  return {pages:()=>[page],close:async()=>{}};
 };
 try{
  const result=await require('../dist/lib/passwordReset.js').resetAccountPassword('last');
  assert.equal(result.success,false);
  const account=db.prepare('SELECT password,reset_candidate_password,last_reset_at FROM accounts WHERE id=?').get('last');
  assert.equal(account.password,'test-only');assert.match(account.reset_candidate_password,/^[a-z]{3}\d{3}$/);assert.equal(account.last_reset_at,null);
 }finally{chromium.launchPersistentContext=original;}
});

test('mini app welcome uses HTTPS and excludes credentials in URLs',()=>{
 bot.saveSetting('mini_app_url','https://example.invalid/checkout');
 assert.match(bot.miniAppPrompt().text,/Telegram mini app/);
 assert.equal(bot.miniAppPrompt().button.web_app.url,'https://example.invalid/checkout');
 bot.saveSetting('mini_app_url','http://example.invalid');assert.equal(bot.miniAppPrompt(),null);
 bot.saveSetting('mini_app_url','https://user:password@example.invalid');assert.equal(bot.miniAppPrompt(),null);
 bot.saveSetting('mini_app_url','');process.env.TELEGRAM_MINI_APP_URL='https://example.invalid/miniapp';
 assert.equal(bot.miniAppPrompt().button.web_app.url,'https://example.invalid/miniapp');
 delete process.env.TELEGRAM_MINI_APP_URL;
});

test('admin HTTP recovery can quarantine, retry and retire without losing history',async()=>{
 const dbPath=join(dir,'http.sqlite');
 const port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['dist/index.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,DB_PATH:dbPath,SANDBOX_MODE:'true',V3_PREVIEW:'false',PAYMENT_MODE:'mock',TELEGRAM_BOT_TOKEN:'',IMB_API_TOKEN:'',ADMIN_PASSWORD:'integration-test-password',JWT_SECRET:'integration-test-secret-at-least-thirty-two-characters',PORT:String(port)},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);
 const call=async(path,method='GET',body,token)=>{const r=await fetch(base+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 try{
  let ready=false;for(let i=0;i<80;i++){try{ready=(await fetch(base+'/api/health')).ok;if(ready)break;}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,output);
  const token=(await call('/api/login','POST',{password:'integration-test-password'})).data.token;
  const booking=(await call('/api/test-orders/manual','POST',{name:'Test Customer',contact:'',hours:1,amount:100,accountId:'sample-1'},token)).data.order;
  const sql=new DatabaseSync(dbPath);
  sql.prepare("UPDATE auto_reset_schedule SET status='running' WHERE account_id='sample-1'").run();
  assert.equal((await call('/api/accounts/sample-1/recovery','POST',{action:'stop'})).status,401);
  assert.equal((await call('/api/accounts/sample-1','DELETE',{},token)).status,409);
  assert.equal((await call('/api/accounts/sample-1/recovery','POST',{action:'stop'},token)).status,200);
  assert.equal(sql.prepare("SELECT status FROM auto_reset_schedule WHERE account_id='sample-1'").get().status,'failed');
  assert.equal(sql.prepare('SELECT status FROM test_orders WHERE id=?').get(booking.id).status,'reset_failed');
  assert.ok(!(await call('/api/test-orders','GET',undefined,token)).data.available.some(a=>a.id==='sample-1'));
  assert.equal((await call('/api/accounts/sample-1/recovery','POST',{action:'retry',password:''},token)).status,400);
  assert.equal((await call('/api/accounts/sample-1/recovery','POST',{action:'retry',password:'recovered-test-password'},token)).status,200);
  assert.equal(sql.prepare("SELECT status FROM auto_reset_schedule WHERE account_id='sample-1'").get().status,'pending');
  assert.equal((await call('/api/accounts/sample-1/release','POST',{},token)).status,200);
  assert.equal(sql.prepare('SELECT status FROM test_orders WHERE id=?').get(booking.id).status,'expired');
  assert.ok((await call('/api/test-orders','GET',undefined,token)).data.available.some(a=>a.id==='sample-1'));
  const retired=(await call('/api/test-orders/manual','POST',{name:'Retired Customer',contact:'',hours:1,amount:100,accountId:'sample-2'},token)).data.order;
  assert.equal((await call('/api/accounts/sample-2/recovery','POST',{action:'retire',confirmation:'wrong'},token)).status,400);
  assert.equal((await call('/api/accounts/sample-2/recovery','POST',{action:'retire',confirmation:'Sample ID 2'},token)).status,200);
  assert.equal(sql.prepare("SELECT id FROM accounts WHERE id='sample-2'").get(),undefined);
  assert.equal(sql.prepare('SELECT status FROM test_orders WHERE id=?').get(retired.id).status,'cancelled');
  assert.equal(sql.prepare("SELECT account_id FROM auto_reset_schedule WHERE account_id='sample-2'").get(),undefined);
  assert.ok(sql.prepare("SELECT action FROM v3_audit WHERE subject='sample-2'").get());
  assert.equal((await call('/api/bot-settings/mini-app','PUT',{url:'http://example.invalid'},token)).status,400);
  assert.equal((await call('/api/bot-settings/mini-app','PUT',{url:'https://example.invalid/checkout'},token)).status,200);
  assert.equal((await call('/api/bot-settings','GET',undefined,token)).data.miniAppUrl,'https://example.invalid/checkout');
  sql.close();
 }finally{child.kill('SIGTERM');await new Promise(r=>setTimeout(r,150));}
});
