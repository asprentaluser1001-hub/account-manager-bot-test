import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {DatabaseSync} from 'node:sqlite';

async function freePort(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));

test('V3 isolated mock checkout and booking lifecycle',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'flingroulette-v3-integration-'));
 const port=await freePort(),base=`http://127.0.0.1:${port}`;
 const child=spawn(process.execPath,['dist/index.js'],{cwd:new URL('../',import.meta.url),env:{...process.env,DB_PATH:join(dir,'v3-preview.db'),SANDBOX_MODE:'true',V3_PREVIEW:'true',PAYMENT_MODE:'mock',ADMIN_PASSWORD:'integration-test-password',JWT_SECRET:'integration-test-secret-at-least-thirty-two-characters',PORT:String(port),TEST_BOT_TOKEN:'',IMB_API_TOKEN:''},stdio:['ignore','pipe','pipe']});
 let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
 const call=async(path,method='GET',body,token)=>{const response=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()}};
 try{
  let ready=false;for(let n=0;n<80;n++){if(child.exitCode!==null)break;try{const response=await fetch(base+'/api/health');if(response.ok){ready=true;break}}catch{}await pause(100)}
  assert.ok(ready,`server did not start: ${output}`);
  const config=await call('/api/checkout/config');assert.equal(config.data.mockPayment,true);assert.equal(config.data.gatewayEnabled,false);
  const created=await call('/api/checkout/orders','POST',{name:'Sample Customer',hours:1});assert.equal(created.status,201);assert.ok(!created.data.payment_url);
  const login=await call('/api/login','POST',{password:'integration-test-password'});assert.equal(login.status,200);const token=login.data.token;
  const orderId=created.data.orderId;
  assert.equal((await call(`/api/test-orders/${orderId}/extend`,'POST',{paymentConfirmed:true},token)).status,400);
  assert.equal((await call(`/api/test-orders/${orderId}/claim`,'POST',{},token)).status,200);
  const proof='data:image/png;base64,'+'A'.repeat(100_000);
  const proofDb=new DatabaseSync(join(dir,'v3-preview.db'));
  proofDb.prepare('UPDATE test_orders SET proof_data_url=? WHERE id=?').run(proof,orderId);
  proofDb.close();
  const lightList=await call('/api/test-orders','GET',undefined,token);
  const listed=lightList.data.orders.find(order=>order.id===orderId);
  assert.equal(listed.has_proof,1);
  assert.ok(!('proof_data_url' in listed));
  assert.ok(JSON.stringify(lightList.data).length<10_000);
  assert.equal((await call(`/api/test-orders/${orderId}/proof`)).status,401);
  assert.equal((await call(`/api/test-orders/${orderId}/proof`,'GET',undefined,token)).data.proofDataUrl,proof);
  const available=(await call('/api/test-orders','GET',undefined,token)).data.available;
  const invalidManual=await call('/api/test-orders/manual','POST',{name:'Manual Customer',contact:'',telegramChatId:'1234567',hours:1,amount:100,accountId:available[0].id},token);
  assert.equal(invalidManual.status,400);assert.match(invalidManual.data.error,/start the Telegram bot/);
  const approved=await call(`/api/test-orders/${orderId}/approve`,'POST',{accountId:available[0].id},token);assert.equal(approved.status,200);assert.equal(approved.data.delivered,true);
  const wrongExtension=await call(`/api/test-orders/${orderId}/extend`,'POST',{paymentConfirmed:false},token);assert.equal(wrongExtension.status,400);
  const extension=await call(`/api/test-orders/${orderId}/extend`,'POST',{paymentConfirmed:true},token);assert.equal(extension.status,200);assert.equal(new Date(extension.data.order.expires_at)-new Date(approved.data.order.expires_at),50*60_000);
  const transferred=await call(`/api/test-orders/${orderId}/transfer`,'POST',{accountId:available[1].id},token);assert.equal(transferred.status,200);assert.equal(transferred.data.order.account_id,available[1].id);
  const oldAccount=(await call('/api/accounts','GET',undefined,token)).data.accounts.find(account=>account.id===available[0].id);assert.equal(oldAccount.sold,true);
  assert.equal((await call(`/api/accounts/${oldAccount.id}/auto-reset`,'DELETE',undefined,token)).status,409);
  assert.equal((await call(`/api/accounts/${oldAccount.id}`,'DELETE',undefined,token)).status,409);
  assert.equal((await call(`/api/test-orders/${orderId}/cancel`,'POST',{},token)).status,200);
  assert.equal((await call('/api/test-orders/history/hide','POST',{ids:[orderId]},token)).status,400);
  const rejected=await call('/api/test-orders/demo','POST',{chatId:'888111',username:'Other Customer',hours:1},token);
  assert.equal(rejected.status,201);
  assert.equal((await call(`/api/test-orders/${rejected.data.order.id}/claim`,'POST',{},token)).status,200);
  assert.equal((await call(`/api/test-orders/${rejected.data.order.id}/reject`,'POST',{},token)).status,200);
  const beforeHide=await call('/api/test-orders','GET',undefined,token);
  assert.equal((await call('/api/test-orders/history/hide','POST',{ids:[rejected.data.order.id]},token)).status,200);
  const afterHide=await call('/api/test-orders','GET',undefined,token);
  assert.ok(!afterHide.data.orders.some(order=>order.id===rejected.data.order.id));
  assert.equal(afterHide.data.summary.bookings,beforeHide.data.summary.bookings-1);
  assert.equal((await call(`/api/test-orders/${orderId}/refund`,'PATCH',{status:'requested',note:'Test tracking'},token)).status,200);
  const report=await call('/api/test-orders/v3/finance','GET',undefined,token);assert.equal(report.status,200);assert.ok(report.data.total>=150);assert.ok(report.data.refunds.some(refund=>refund.order_id===orderId));
  assert.equal((await call(`/api/accounts/${available[1].id}/release`,'POST',{},token)).status,200);
  const earningsBefore=(await call('/api/test-orders','GET',undefined,token)).data;
  const reportBefore=(await call('/api/test-orders/v3/finance','GET',undefined,token)).data;
  assert.equal((await call('/api/test-orders/history/hide','POST',{ids:[orderId]},token)).status,200);
  const earningsAfter=(await call('/api/test-orders','GET',undefined,token)).data;
  const reportAfter=(await call('/api/test-orders/v3/finance','GET',undefined,token)).data;
  assert.equal(earningsAfter.summary.revenue,earningsBefore.summary.revenue-100);
  assert.equal(earningsAfter.summary.sales,earningsBefore.summary.sales-1);
  assert.equal(earningsAfter.finance.days[0].amount,earningsBefore.finance.days[0].amount-100);
  assert.equal(reportAfter.total,reportBefore.total-100);
  assert.equal(reportAfter.successful,reportBefore.successful-1);
  assert.ok(!reportAfter.refunds.some(refund=>refund.order_id===orderId));
  const health=await call('/api/v3/ops/health','GET',undefined,token);assert.equal(health.data.ok,true);
  const backup=await call('/api/v3/ops/backup','POST',{},token);assert.equal(backup.status,201);assert.match(backup.data.name,/^v3-preview-/);
  const backups=await call('/api/v3/ops/backups','GET',undefined,token);assert.ok(backups.data.files.some(file=>file.name===backup.data.name));
 }finally{child.kill('SIGTERM');await pause(150);rmSync(dir,{recursive:true,force:true});}
});
