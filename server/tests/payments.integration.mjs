import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {createHmac} from 'node:crypto';
import {IncomingMessage,ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';
const require=createRequire(import.meta.url);

test('Cashfree live-mode HTTP integration and IMB rollback, with mocked provider APIs',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'fr-payments-'));
 Object.assign(process.env,{DB_PATH:join(dir,'test.sqlite'),V3_PREVIEW:'false',SANDBOX_MODE:'false',PAYMENT_MODE:'live',IMB_API_TOKEN:'fake-imb',CASHFREE_APP_ID:'fake-app',CASHFREE_SECRET_KEY:'fake-secret',CASHFREE_ENV:'production',PUBLIC_CHECKOUT_URL:'https://checkout.example.invalid/checkout',JWT_SECRET:'integration-secret-longer-than-thirty-two-characters',TELEGRAM_BOT_TOKEN:'',TELEGRAM_ADMIN_ID:''});
 const {db}=require('../dist/db.js');
 const orders=require('../dist/lib/testOrders.js');
 const express=require('express');
 const {checkoutRouter,paymentSettingsRouter}=require('../dist/routes/checkout.js');
 const app=express();app.use('/api/checkout',checkoutRouter);app.use('/api/payment-settings',paymentSettingsRouter);app.use('/api/miniapp',require('../dist/routes/miniApp.js').miniAppRouter);
 const base='http://local.test';
 const localRequest=(url,options={})=>new Promise((resolve,reject)=>{
  const socket=new Duplex({read(){},write(chunk,encoding,done){done()}});
  socket.remoteAddress='127.0.0.1';
  const req=new IncomingMessage(socket);req.method=options.method||'GET';req.url=String(url).slice(base.length);req.headers=Object.fromEntries(Object.entries(options.headers||{}).map(([k,v])=>[k.toLowerCase(),v]));req.headers.host='local.test';
  const body=options.body||'';if(body)req.headers['content-length']=String(Buffer.byteLength(body));
  const res=new ServerResponse(req);res.end=function(data){resolve(new Response(data||null,{status:res.statusCode,headers:res.getHeaders()}));return this};
  app.handle(req,res,error=>reject(error||new Error('Unhandled route')));
  req.push(body?Buffer.from(body):null);if(body)req.push(null);
 });
 const realFetch=globalThis.fetch,providerOrders=new Map();let providerCalls=0,creationFailure=false,paymentCurrency='INR',paymentAmount=100,paid=false;
 globalThis.fetch=async(url,options={})=>{
  const href=String(url);
  if(href.startsWith(base))return localRequest(url,options);
  providerCalls++;
  if(href.startsWith('https://api.telegram.org/'))return Response.json({ok:true,result:{message_id:1}});
  if(href==='https://api.cashfree.com/pg/orders'){
   assert.equal(options.headers['x-client-id'],'fake-app');assert.equal(options.headers['x-api-version'],'2025-01-01');
   const input=JSON.parse(options.body);assert.equal(input.customer_details.customer_phone,'9876543210');assert.equal(input.order_currency,'INR');assert.ok([50,100].includes(input.order_amount));
   assert.ok(input.order_meta.return_url.startsWith('https://checkout.example.invalid/checkout?'));
   providerOrders.set(input.order_id,input);
   return Response.json(creationFailure?{message:'error'}:{order_id:input.order_id,payment_session_id:'session-'+input.order_id},{status:creationFailure?500:200});
  }
  if(href.startsWith('https://api.cashfree.com/pg/orders/')){
   const id=href.split('/')[5];assert.ok(providerOrders.has(id));
   if(href.endsWith('/payments'))return Response.json([{cf_payment_id:'payment-'+id,payment_status:'SUCCESS',payment_amount:paymentAmount,payment_currency:paymentCurrency}]);
   return Response.json({order_id:id,order_amount:paymentAmount,order_currency:paymentCurrency,order_status:paid?'PAID':'ACTIVE'});
  }
  if(href==='https://api.imbpay.in/v2/create-order'){
   const input=new URLSearchParams(options.body);assert.equal(input.get('user_token'),'fake-imb');
   return Response.json({status:true,result:{orderId:input.get('order_id'),payment_url:'https://payment.example.invalid/imb'}});
  }
  if(href==='https://api.imbpay.in/v2/check-order-status'){
   const id=new URLSearchParams(options.body).get('order_id');
   return Response.json({status:true,result:{status:'SUCCESS',txnStatus:'COMPLETED',orderId:id,amount:100,utr:'imb-reference'}});
  }
  throw new Error('Unexpected external request: '+href);
 };
 const token=require('jsonwebtoken').sign({role:'admin'},process.env.JWT_SECRET,{expiresIn:'1h'});
 const call=async(path,body,admin=false)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(admin?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
 const select=async provider=>fetch(base+'/api/payment-settings/gateway',{method:'PUT',headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},body:JSON.stringify({paymentProvider:provider})});
 const webhook=async(order,overrides={},valid=true)=>{
  const event={type:'PAYMENT_SUCCESS_WEBHOOK',data:{order:{order_id:order.orderId,order_amount:100,order_currency:'INR',...overrides},payment:{payment_status:'SUCCESS'}}};
  const raw=JSON.stringify(event,null,2),timestamp=String(Date.now());
  const signature=createHmac('sha256','fake-secret').update(timestamp+raw).digest('base64');
  return fetch(base+'/api/checkout/cashfree/webhook',{method:'POST',headers:{'Content-Type':'application/json','x-webhook-timestamp':timestamp,'x-webhook-signature':valid?signature:'invalid'},body:raw});
 };
 try{
  for(let i=0;i<5;i++)db.prepare('INSERT INTO accounts(id,name,email,password,created_at) VALUES (?,?,?,?,?)').run('sample-'+i,'Sample '+i,`sample${i}@example.invalid`,'not-live',new Date().toISOString());
  const legacy=orders.createWebOrder('Legacy Customer','',1,'legacy-browser');
  assert.equal(orders.getOrder(legacy.order.id).payment_provider,'imb');
  assert.equal((await (await fetch(base+'/api/checkout/config')).json()).paymentProvider,'imb');
  const unauthorized=await fetch(base+'/api/payment-settings/gateway',{method:'PUT',headers:{'Content-Type':'application/json'},body:'{"paymentProvider":"cashfree"}'});assert.equal(unauthorized.status,401);
  assert.equal((await select('cashfree')).status,200);
  assert.equal((await select('other')).status,400);
  delete process.env.CASHFREE_APP_ID;assert.equal((await select('cashfree')).status,400);process.env.CASHFREE_APP_ID='fake-app';
  assert.equal((await call('/api/checkout/orders',{name:'Test Customer',hours:1})).status,400);
  const first=await (await call('/api/checkout/orders',{name:'Test Customer',phone:'+91 9876543210',hours:1})).json();
  assert.equal(first.paymentProvider,'cashfree');assert.ok(first.payment_session_id);
  const status=await (await fetch(base+`/api/checkout/orders/${first.orderId}?token=${first.accessToken}`)).json();assert.equal(status.cashfree_environment,'production');assert.equal(status.payment_provider,'cashfree');assert.equal(status.credentials,null);
  assert.equal((await call(`/api/checkout/orders/${first.orderId}/verify`,{accessToken:'wrong'})).status,404);
  const before=providerCalls;assert.equal((await webhook(first,{},false)).status,401);assert.equal(providerCalls,before);
  assert.equal((await webhook(first,{order_amount:1})).status,400);
  assert.equal((await webhook(first)).status,503);assert.equal(orders.getOrder(first.orderId).status,'awaiting_payment_claim');
  paid=true;paymentAmount=99;assert.equal((await webhook(first)).status,500);assert.equal(orders.getOrder(first.orderId).status,'awaiting_payment_claim');
  paymentAmount=100;paymentCurrency='USD';assert.equal((await webhook(first)).status,500);paymentCurrency='INR';
  // Roll back while the Cashfree payment is still pending. Its webhook must work.
  assert.equal((await select('imb')).status,200);
  assert.equal((await webhook(first)).status,200);
  const delivered=orders.getOrder(first.orderId);assert.equal(delivered.status,'delivered');assert.match(delivered.payment_reference,/^payment-WEB-/);
  const end=delivered.expires_at,assigned=delivered.account_id;
  const repeated=await Promise.all([webhook(first),webhook(first)]);assert.ok(repeated.every(r=>r.status===200));
  assert.equal(orders.getOrder(first.orderId).expires_at,end);assert.equal(orders.getOrder(first.orderId).account_id,assigned);
  const second=await (await call('/api/checkout/orders',{name:'IMB Customer',hours:1})).json();assert.equal(second.paymentProvider,'imb');assert.ok(second.payment_url);
  assert.equal((await webhook(second)).status,400);
  // An old IMB order must still complete after selecting Cashfree.
  assert.equal((await select('cashfree')).status,200);
  assert.equal((await call('/api/checkout/imb/webhook',{order_id:second.orderId})).status,200);
  assert.equal(orders.getOrder(second.orderId).status,'delivered');
  // Customer reconciliation recovers a payment even without a webhook.
  const third=await (await call('/api/checkout/orders',{name:'Return Customer',phone:'9876543210',hours:1})).json();
  const reconciled=await call(`/api/checkout/orders/${third.orderId}/verify`,{accessToken:third.accessToken});assert.equal(reconciled.status,200);assert.ok((await reconciled.json()).credentials);
  // Telegram identity -> mini-app booking -> deferred Cashfree session.
  process.env.TELEGRAM_BOT_TOKEN='test-only-bot';
  const fields={auth_date:String(Math.floor(Date.now()/1000)),user:JSON.stringify({id:1234567,first_name:'Mini Customer'})};
  const check=Object.entries(fields).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
  const secret=createHmac('sha256','WebAppData').update(process.env.TELEGRAM_BOT_TOKEN).digest();
  const hash=createHmac('sha256',secret).update(check).digest('hex');
  const init=new URLSearchParams({...fields,hash}).toString();
  const miniCall=(path,body)=>fetch(base+'/api/miniapp/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Init-Data':init},body:JSON.stringify(body)});
  const miniResponse=await miniCall('book',{hours:1});assert.equal(miniResponse.status,201);const miniData=await miniResponse.json();
  const link=new URL(miniData.checkoutUrl,base),mini={orderId:link.searchParams.get('order'),accessToken:link.searchParams.get('token')};
  assert.equal(orders.getOrder(mini.orderId).payment_provider,'cashfree');assert.equal(orders.getOrder(mini.orderId).cashfree_session_id,null);
  assert.equal((await call(`/api/checkout/orders/${mini.orderId}/session`,{accessToken:mini.accessToken,phone:'invalid'})).status,400);
  await select('imb');
  const session=await call(`/api/checkout/orders/${mini.orderId}/session`,{accessToken:mini.accessToken,phone:'9876543210'});assert.equal(session.status,200);assert.ok((await session.json()).payment_session_id);
  assert.equal((await webhook(mini)).status,200);assert.equal(orders.getOrder(mini.orderId).status,'delivered');
  await select('cashfree');
  const extendResponse=await miniCall('extend',{orderId:mini.orderId});assert.equal(extendResponse.status,201);
  const extendData=await extendResponse.json(),extLink=new URL(extendData.checkoutUrl,base),extension={orderId:extLink.searchParams.get('order'),accessToken:extLink.searchParams.get('token')};
  const originalEnd=orders.getOrder(mini.orderId).expires_at;
  await select('imb');const resumed=await miniCall('extend',{orderId:mini.orderId});assert.equal(resumed.status,201);assert.equal(orders.getOrder(extension.orderId).payment_provider,'cashfree');
  assert.equal((await call(`/api/checkout/orders/${extension.orderId}/session`,{accessToken:extension.accessToken,phone:'9876543210'})).status,200);
  paymentAmount=50;assert.equal((await webhook(extension,{order_amount:50})).status,200);paymentAmount=100;
  const extended=orders.getOrder(mini.orderId);assert.equal(Date.parse(extended.expires_at)-Date.parse(originalEnd),3600000);
  assert.equal(db.prepare('SELECT run_at FROM auto_reset_schedule WHERE account_id=?').get(extended.account_id).run_at,extended.expires_at);
  assert.equal((await webhook(extension,{order_amount:50})).status,200);assert.equal(orders.getOrder(mini.orderId).expires_at,extended.expires_at);
  await select('cashfree');process.env.TELEGRAM_BOT_TOKEN='';
  // Creation failure never silently charges through the alternate gateway.
  creationFailure=true;const failed=await call('/api/checkout/orders',{name:'Failed Customer',phone:'9876543210',hours:1});assert.equal(failed.status,400);creationFailure=false;
  // Paid with no stock remains claimed for admin attention, without credentials.
  const fourth=await (await call('/api/checkout/orders',{name:'Stock Customer',phone:'9876543210',hours:1})).json();
  db.prepare('UPDATE accounts SET sold=1').run();
  assert.equal((await webhook(fourth)).status,200);assert.equal(orders.getOrder(fourth.orderId).status,'payment_claimed');
  const waiting=orders.publicWebOrder(fourth.orderId,fourth.accessToken);assert.equal(waiting.credentials,null);
 }finally{
  globalThis.fetch=realFetch;db.close();rmSync(dir,{recursive:true,force:true});
 }
});
