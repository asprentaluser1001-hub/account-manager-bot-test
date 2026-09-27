import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';

const require=createRequire(import.meta.url);
test('production-mode migration preserves an existing booking and manual extension timer',()=>{
 const dir=mkdtempSync(join(tmpdir(),'fr-prod-migration-'));
 process.env.DB_PATH=join(dir,'production-copy.sqlite');
 process.env.V3_PREVIEW='false';
 process.env.SANDBOX_MODE='false';
 process.env.TELEGRAM_BOT_TOKEN='test-only-token';
 try{
  const {DatabaseSync}=require('node:sqlite');
  const oldDb=new DatabaseSync(process.env.DB_PATH);
  oldDb.exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT NOT NULL,password TEXT NOT NULL,sold INTEGER NOT NULL DEFAULT 0,sold_until TEXT,last_reset_at TEXT,created_at TEXT NOT NULL);
   CREATE TABLE test_orders(id TEXT PRIMARY KEY,chat_id TEXT NOT NULL,username TEXT NOT NULL,hours INTEGER NOT NULL,amount INTEGER NOT NULL,status TEXT NOT NULL,account_id TEXT,created_at TEXT NOT NULL,claimed_at TEXT,approved_at TEXT,expires_at TEXT,delivered_at TEXT,error TEXT,source TEXT NOT NULL DEFAULT 'telegram',access_token TEXT,customer_contact TEXT,payment_reference TEXT,proof_data_url TEXT);`);
  oldDb.close();
  const {db}=require('../dist/db.js');
  const now=new Date().toISOString();
  db.prepare('INSERT INTO accounts(id,name,email,password,sold,sold_until,created_at) VALUES (?,?,?,?,0,NULL,?)')
   .run('test-account','Test Account','example@example.invalid','not-a-live-password',now);
  db.exec('CREATE TABLE IF NOT EXISTS bot_visitors(chat_id TEXT PRIMARY KEY,welcomed_at TEXT NOT NULL)');
  db.prepare('INSERT INTO bot_visitors VALUES (?,?)').run('123456',now);
  const orders=require('../dist/lib/testOrders.js');
  require('../dist/lib/v3Features.js');
  assert.equal(orders.availableAccounts().length,1);
  const booking=orders.createManualBooking('Test Customer','',1,100,'test-account','123456');
  assert.equal(booking.status,'approved');
  assert.equal(booking.chat_id,'123456');
  const oldExpiry=booking.expires_at;
  const extension=orders.createManualExtension('Test Customer','',50,'test-account');
  const newExpiry=orders.getOrder(booking.id).expires_at;
  assert.equal(new Date(newExpiry)-new Date(oldExpiry),50*60_000);
  assert.equal(orders.getOrder(extension.id).parent_order_id,booking.id);
  assert.equal(orders.getOrder(extension.id).amount,50);
  assert.equal(db.prepare('SELECT sold_until FROM accounts WHERE id=?').get('test-account').sold_until,newExpiry);
  assert.equal(db.prepare('SELECT run_at FROM auto_reset_schedule WHERE account_id=?').get('test-account').run_at,newExpiry);
  assert.throws(()=>orders.createManualExtension('Another Customer','',50,'test-account'),/Customer name must match/);
  const repeat=orders.createManualExtension('Test Customer','',50,'test-account');
  assert.equal(repeat.parent_order_id,booking.id);
  assert.equal(new Date(orders.getOrder(booking.id).expires_at)-new Date(newExpiry),50*60_000);
  const report=require('../dist/lib/v3Features.js').financeReport();
  assert.ok(report.total>=200);
  db.prepare('INSERT INTO accounts(id,name,email,password,sold,sold_until,created_at) VALUES (?,?,?,?,0,NULL,?)').run('manual-account','Manual Account','manual@example.invalid','not-a-live-password',now);
  const offline=orders.createManualBooking('Offline Customer','',1,100,'manual-account','');
  assert.equal(offline.status,'delivered');assert.equal(offline.chat_id,'manual');
  const {bookingAlert}=require('../dist/lib/bookingNotifications.js');
  const alert=bookingAlert(offline);
  assert.equal(alert.title,'Booking confirmed');
  assert.match(alert.body,/Offline Customer · ₹100/);
  assert.match(alert.body,/Share access privately/);
  assert.ok(!alert.body.includes('not-a-live-password'));
  const extendedAlert=bookingAlert(orders.getOrder(booking.id),true);
  assert.equal(extendedAlert.title,'Booking extended');
  assert.match(extendedAlert.body,/Test Customer · ₹50/);
 }finally{delete process.env.DB_PATH;delete process.env.TELEGRAM_BOT_TOKEN;rmSync(dir,{recursive:true,force:true});}
});

test('production HTTP path keeps IMB enabled and rejects test payment claims',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'fr-prod-http-'));
 const port=await new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p))})});
 const base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['dist/index.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,DB_PATH:join(dir,'prod.sqlite'),SANDBOX_MODE:'false',V3_PREVIEW:'false',PAYMENT_MODE:'live',IMB_API_TOKEN:'test-only-do-not-contact-provider',TELEGRAM_BOT_TOKEN:'',ADMIN_PASSWORD:'integration-test-password',JWT_SECRET:'integration-test-secret-at-least-thirty-two-characters',PORT:String(port)},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
 try{
  let ready=false;
  for(let i=0;i<80;i++){if(child.exitCode!==null)break;try{ready=(await fetch(base+'/api/health')).ok;if(ready)break}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
  assert.ok(ready,`Production server did not start: ${output}`);
  const config=await (await fetch(base+'/api/checkout/config')).json();
  assert.equal(config.mockPayment,false);assert.equal(config.gatewayEnabled,true);
  const login=await (await fetch(base+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'integration-test-password'})})).json();
  const headers={Authorization:`Bearer ${login.token}`};
  const oldToken=require('jsonwebtoken').sign({role:'admin'},'integration-test-secret-at-least-thirty-two-characters',{expiresIn:'7d'});
  assert.equal((await fetch(base+'/api/test-orders',{headers:{Authorization:`Bearer ${oldToken}`}})).status,200);
  assert.equal((await fetch(base+'/api/test-orders/demo',{method:'POST',headers})).status,403);
  assert.equal((await fetch(base+'/api/test-orders/WEB-12345678/claim',{method:'POST',headers})).status,403);
  assert.equal((await fetch(base+'/api/v3/ops/backup',{method:'POST',headers})).status,500);
 }finally{child.kill('SIGTERM');await new Promise(resolve=>setTimeout(resolve,150));rmSync(dir,{recursive:true,force:true})}
});
