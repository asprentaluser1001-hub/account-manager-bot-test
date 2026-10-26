import {confirmSlotPayment} from '../lib/v5Bookings';
import {Router,json,raw,urlencoded,Request} from 'express';
import {randomBytes} from 'crypto';
import {adminAuth} from '../auth';
import {approveOrder,availableAccounts,customerIsBlocked,claimGatewayPayment,createWebOrder,markDelivered,markGatewayError,PRICES,publicWebOrder,saveGatewayLinks,submitWebProof,getOrder} from '../lib/testOrders';
import {db} from '../db';
import {sendAdminClaim,sendCustomerDelivery,setting as botSetting} from '../lib/telegramBot';
import {sendApprovalPush} from './push';
import {notifyBookingRecorded} from '../lib/bookingNotifications';
import {checkImbOrder,createImbOrder,isImbConfigured} from '../lib/imbPayment';
import {createCashfreeOrder,verifyCashfreeOrder,verifyCashfreeSignature} from '../lib/cashfreePayment';
import {activePaymentProvider,paymentGatewayConfig,selectPaymentProvider} from '../lib/paymentGateway';

db.exec(`CREATE TABLE IF NOT EXISTS payment_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
const getSetting=(key:string)=>(db.prepare('SELECT value FROM payment_settings WHERE key=?').get(key) as {value:string}|undefined)?.value||'';
const saveSetting=(key:string,value:string)=>db.prepare('INSERT INTO payment_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
const supportUrl=(value:string):string=>{
 const contact=value.trim();
 if(/^@?[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(contact))return `https://t.me/${contact.replace(/^@/,'')}`;
 try{const url=new URL(contact);return url.protocol==='https:'&&!url.username&&!url.password?url.toString():'';}catch{return '';}
};
export const supportContactUrl=()=>supportUrl(getSetting('support'))||supportUrl(botSetting('support_username'));
const plans=Object.entries(PRICES).map(([hours,amount])=>({hours:Number(hours),amount}));
const mockPayment=()=>process.env.V3_PREVIEW==='true' && process.env.PAYMENT_MODE==='mock';
const clientConfig=()=>({brand:getSetting('brand')||'FlingRoulette',payeeName:mockPayment()?'':getSetting('payee_name'),upiId:mockPayment()?'':getSetting('upi_id'),qrDataUrl:mockPayment()?'':getSetting('qr_data_url'),support:getSetting('support'),supportUrl:supportContactUrl(),plans,available:availableAccounts().length>0,...paymentGatewayConfig(),mockPayment:mockPayment()});

const attempts=new Map<string,{count:number;reset:number}>();
function limited(req:Request){
 const key=req.ip||'unknown',now=Date.now(),current=attempts.get(key);
 if(!current||current.reset<now){attempts.set(key,{count:1,reset:now+10*60_000});return false;}
 current.count+=1;return current.count>30;
}

export const checkoutRouter=Router();
checkoutRouter.get('/config',(_req,res)=>res.json(clientConfig()));
checkoutRouter.post('/orders',json({limit:'32kb'}),async(req,res)=>{
 try{
  if(limited(req))return res.status(429).json({error:'Too many attempts. Please wait and try again.'});
  const provider=activePaymentProvider();
  if(!mockPayment() && !paymentGatewayConfig().gatewayEnabled)return res.status(503).json({error:'Payment is temporarily unavailable. Please contact support.'});
  const phone=String(req.body.phone||'').replace(/[ +()-]/g,'').replace(/^91(?=\d{10}$)/,'');
  if(!mockPayment() && provider==='cashfree' && !/^[6-9]\d{9}$/.test(phone))return res.status(400).json({error:'Enter a valid 10-digit Indian mobile number'});
  const cookie=/^(?:.*; )?fr_customer=([A-Za-z0-9_-]{32})(?:;.*)?$/.exec(req.headers.cookie||'');
  const customerKey=cookie?.[1]||randomBytes(24).toString('base64url');
  const result=createWebOrder(String(req.body.name||''),provider==='cashfree'?phone:'',Number(req.body.hours),customerKey);
  db.prepare('UPDATE test_orders SET payment_provider=? WHERE id=?').run(provider,result.order.id);
  res.cookie('fr_customer',customerKey,{httpOnly:true,sameSite:'lax',secure:!mockPayment(),path:'/api/checkout',maxAge:365*24*60*60*1000});
  if(!mockPayment()){
   try{
    const base=process.env.PUBLIC_CHECKOUT_URL||`${req.protocol}://${req.get('host')}/checkout`;
    const redirect=new URL('/checkout',base);redirect.searchParams.set('order',result.order.id);redirect.searchParams.set('token',result.accessToken);redirect.searchParams.set('amount',String(result.order.amount));redirect.searchParams.set('hours',String(result.order.hours));
    if(provider==='cashfree'){
     if(!process.env.PUBLIC_CHECKOUT_URL || redirect.protocol!=='https:')throw new Error('Configure PUBLIC_CHECKOUT_URL with the public HTTPS checkout URL');
     const session=await createCashfreeOrder({orderId:result.order.id,amount:result.order.amount,name:result.order.username,phone,returnUrl:redirect.toString()});
     db.prepare('UPDATE test_orders SET cashfree_session_id=?,cashfree_environment=? WHERE id=?').run(session.paymentSessionId,session.cashfreeEnvironment,result.order.id);
     return res.status(201).json({orderId:result.order.id,accessToken:result.accessToken,amount:result.order.amount,status:result.order.status,paymentProvider:provider,payment_session_id:session.paymentSessionId,cashfree_environment:session.cashfreeEnvironment});
    }
    const links=await createImbOrder({orderId:result.order.id,amount:result.order.amount,mobile:result.order.customer_contact||'',redirectUrl:redirect.toString()});
    saveGatewayLinks(result.order.id,links);
    return res.status(201).json({orderId:result.order.id,accessToken:result.accessToken,amount:result.order.amount,status:result.order.status,paymentProvider:provider,...links});
   }catch(error){markGatewayError(result.order.id,error instanceof Error?error.message:'Payment order creation failed');throw error;}
  }
  return res.status(201).json({orderId:result.order.id,accessToken:result.accessToken,amount:result.order.amount,status:result.order.status});
 }
 catch(error){const message=error instanceof Error?error.message:'Could not create order';return res.status(message.startsWith('Booking paused')?403:400).json({error:message});}
});
checkoutRouter.post('/orders/:id/proof',json({limit:'5mb'}),async(req,res)=>{
 try{if(mockPayment())return res.status(403).json({error:'Payment proof is disabled in the test preview; no payment is collected.'});if(limited(req))return res.status(429).json({error:'Too many attempts. Please wait and try again.'});const order=submitWebProof(req.params.id,String(req.body.accessToken||''),String(req.body.paymentReference||''),String(req.body.proofDataUrl||''));const [adminAlerted,pushAlerts]=await Promise.all([sendAdminClaim(order),sendApprovalPush(order)]);return res.json({status:order.status,adminAlerted,pushAlerts});}
 catch(error){return res.status(400).json({error:error instanceof Error?error.message:'Could not submit payment proof'});}
});
checkoutRouter.get('/orders/:id',async(req,res)=>{
 try{
  const token=String(req.query.token||'');
  const snapshot=publicWebOrder(req.params.id,token);
  if(!mockPayment()&&isImbConfigured()&&snapshot.payment_provider==='imb'&&snapshot.payment_url&&['awaiting_payment_claim','payment_claimed'].includes(String(snapshot.status))){try{await confirmImbPayment(req.params.id);}catch{/* The webhook and next poll retry verified gateway status. */}}
  return res.json(publicWebOrder(req.params.id,token));}
 catch(error){return res.status(404).json({error:error instanceof Error?error.message:'Order not found'});}
});

async function confirmImbPayment(orderId:string){
 const order=getOrder(orderId);if(!order||order.source!=='web'||order.payment_provider!=='imb')throw new Error('Unknown IMB order');
 if(['approved','delivered','delivery_failed','expired','reserved','payment_late','reservation_failed'].includes(order.status))return {alreadyProcessed:true};
 const checked=await checkImbOrder(orderId),result=checked.result;
 const verified=(checked.status==='COMPLETED'||checked.status===true)&&result?.status==='SUCCESS'&&result.txnStatus==='COMPLETED';
 if(!verified||result?.orderId!==orderId||Number(result.amount)!==order.amount)throw new Error('IMB has not confirmed this order and exact amount');
 return fulfillPayment(orderId,result.utr?String(result.utr):null);
}

async function fulfillPayment(orderId:string, reference:string|null){
 const newlyClaimed=claimGatewayPayment(orderId,reference);
 const current=getOrder(orderId)!;
 if(!newlyClaimed&&current.status!=='payment_claimed')return {alreadyProcessed:true};
 if(customerIsBlocked('web',current.customer_key||'')){
  if(!confirmSlotPayment(orderId))db.prepare("UPDATE test_orders SET status='payment_late',approved_at=?,error='Customer approval required; contact admin for refund or reassignment' WHERE id=? AND status='payment_claimed'").run(new Date().toISOString(),orderId);
  if(newlyClaimed)await Promise.all([sendAdminClaim(current),sendApprovalPush(current)]);
  return {alreadyProcessed:false,delivered:false};
 }
 const kind=confirmSlotPayment(orderId);
 if(kind){void notifyBookingRecorded(getOrder(orderId)!,kind==='extension');return {alreadyProcessed:false,delivered:getOrder(orderId)!.status==='delivered'};}
 for(const account of availableAccounts()){
  try{const details=approveOrder(orderId,account.id);markDelivered(orderId);if(/^\d{1,16}$/.test(details.order.chat_id))void sendCustomerDelivery(details.order,details.email,details.password).catch(()=>false);void notifyBookingRecorded(getOrder(orderId)!);return {alreadyProcessed:false,delivered:true};}
  catch(error){if(!(error instanceof Error)||!['Account is unavailable','Account is already in use','No IDs are available','This time overlaps an advance booking or pending extension'].includes(error.message))throw error;}
 }
 if(newlyClaimed){const currentOrder=getOrder(orderId)!;await Promise.all([sendAdminClaim(currentOrder),sendApprovalPush(currentOrder)]);}
 return {alreadyProcessed:false,delivered:false};
}

checkoutRouter.post('/imb/webhook',json({limit:'64kb'}),urlencoded({extended:true,limit:'64kb'}),async(req,res)=>{
 try{
  const body=req.body||{},nested=typeof body.result==='string'?JSON.parse(body.result):body.result||{};
  const orderId=String(body.order_id||nested.orderId||'');
  if(!/^WEB-[A-Z0-9-]{8,40}$/.test(orderId))return res.status(400).json({error:'Invalid order'});
  await confirmImbPayment(orderId);
  return res.status(200).send('OK');
 }catch(error){
  // A non-success status is not an error; IMB's callback may be for pending/failed.
  if(error instanceof Error&&error.message==='IMB has not confirmed this order and exact amount')return res.status(200).send('Pending');
  return res.status(500).send('Retry');
 }
});

async function confirmCashfreePayment(orderId:string){
 const order=getOrder(orderId);
 if(!order||order.source!=='web'||order.payment_provider!=='cashfree')throw new Error('Unknown Cashfree order');
 if(['approved','delivered','delivery_failed','expired','reserved','payment_late','reservation_failed'].includes(order.status))return {alreadyProcessed:true};
 if(!order.cashfree_environment)throw new Error('Cashfree order environment missing');
 const paymentId=await verifyCashfreeOrder(orderId,order.amount,order.cashfree_environment);
 if(!paymentId)return {pending:true};
 return fulfillPayment(orderId,paymentId);
}
checkoutRouter.post('/cashfree/webhook',raw({type:'application/json',limit:'64kb'}),async(req,res)=>{
 if(!Buffer.isBuffer(req.body)||!verifyCashfreeSignature(req.body,String(req.headers['x-webhook-timestamp']||''),String(req.headers['x-webhook-signature']||'')))return res.status(401).send('Invalid signature');
 try{
  const event=JSON.parse(req.body.toString('utf8'));
  if(event.type!=='PAYMENT_SUCCESS_WEBHOOK')return res.status(200).send('OK');
  const orderId=String(event.data?.order?.order_id||'');
  if(!/^WEB-[A-F0-9]{8}$/.test(orderId))return res.status(400).send('Invalid order');
  const order=getOrder(orderId);
  if(!order)return res.status(200).send('Unknown order ignored');
  if(order.payment_provider!=='cashfree')return res.status(400).send('Wrong payment provider');
  if(event.data?.payment?.payment_status!=='SUCCESS'||Number(event.data?.order?.order_amount)!==order.amount||event.data?.order?.order_currency!=='INR')return res.status(400).send('Payment mismatch');
  const result=await confirmCashfreePayment(orderId);
  if('pending' in result)return res.status(503).send('Retry');
  return res.status(200).send('OK');
 }catch{return res.status(500).send('Retry');}
});
// Mini-app orders arrive here before Cashfree has a customer phone/session.
const creatingSessions=new Map<string,Promise<unknown>>();
checkoutRouter.post('/orders/:id/session',json({limit:'8kb'}),async(req,res)=>{
 try{
  if(limited(req))return res.status(429).json({error:'Please wait before trying again.'});
  const order=getOrder(req.params.id);
  if(!order||!order.access_token||order.access_token!==req.body?.accessToken)return res.status(404).json({error:'Order not found'});
  if(order.payment_provider!=='cashfree'||order.status!=='awaiting_payment_claim')return res.status(400).json({error:'This order cannot start payment'});
  if(order.cashfree_session_id)return res.json(publicWebOrder(order.id,order.access_token));
  const phone=String(req.body.phone||'').replace(/[ +()-]/g,'').replace(/^91(?=\d{10}$)/,'');
  if(!/^[6-9]\d{9}$/.test(phone))return res.status(400).json({error:'Enter a valid 10-digit Indian mobile number'});
  let pending=creatingSessions.get(order.id);
  if(!pending){
   pending=(async()=>{
    const redirect=new URL('/checkout',process.env.PUBLIC_CHECKOUT_URL||'');
    if(redirect.protocol!=='https:')throw new Error('Configure PUBLIC_CHECKOUT_URL with HTTPS');
    redirect.searchParams.set('order',order.id);redirect.searchParams.set('token',order.access_token!);redirect.searchParams.set('amount',String(order.amount));redirect.searchParams.set('hours',String(order.hours));
    const session=await createCashfreeOrder({orderId:order.id,amount:order.amount,name:order.username,phone,returnUrl:redirect.toString()});
    db.prepare('UPDATE test_orders SET cashfree_session_id=?,cashfree_environment=?,customer_contact=? WHERE id=?').run(session.paymentSessionId,session.cashfreeEnvironment,phone,order.id);
   })();
   creatingSessions.set(order.id,pending);
  }
  try{await pending;}finally{creatingSessions.delete(order.id);}
  return res.json(publicWebOrder(order.id,order.access_token));
 }catch{return res.status(503).json({error:'Could not start Cashfree payment. Please try again or contact support.'});}
});

// Reconcile after returning from checkout or when a customer taps Check payment.
// A browser redirect itself never counts as proof of payment.
checkoutRouter.post('/orders/:id/verify',json({limit:'8kb'}),async(req,res)=>{
 try{
  if(limited(req))return res.status(429).json({error:'Please wait before checking again.'});
  const order=getOrder(req.params.id);
  if(!order||!order.access_token||order.access_token!==req.body?.accessToken)return res.status(404).json({error:'Order not found'});
  if(order.payment_provider!=='cashfree')return res.status(400).json({error:'This order uses another gateway'});
  await confirmCashfreePayment(order.id);
  return res.json(publicWebOrder(order.id,order.access_token));
 }catch{return res.status(503).json({error:'Payment verification is temporarily unavailable. Please try again.'});}
});

export const paymentSettingsRouter=Router();
paymentSettingsRouter.use(adminAuth);
paymentSettingsRouter.get('/',(_req,res)=>res.json(clientConfig()));
paymentSettingsRouter.put('/gateway',json({limit:'8kb'}),(req,res)=>{
 try{selectPaymentProvider(req.body?.paymentProvider);return res.json(clientConfig());}
 catch(error){return res.status(400).json({error:error instanceof Error?error.message:'Could not switch gateway'});}
});
paymentSettingsRouter.put('/',json({limit:'5mb'}),(req,res)=>{
 try{
  const brand=String(req.body.brand||'FlingRoulette').trim(),payeeName=String(req.body.payeeName||'').trim(),upiId=String(req.body.upiId||'').trim(),support=String(req.body.support||'').trim(),qrDataUrl=String(req.body.qrDataUrl||'');
  if(mockPayment()&&(payeeName||upiId||qrDataUrl))throw new Error('Real payment details cannot be configured in the V3 test preview.');
  if(brand.length<2||brand.length>40)throw new Error('Brand name must be 2–40 characters');
  if(payeeName.length>80||support.length>100)throw new Error('Payment details are too long');
  if(support&&!supportUrl(support))throw new Error('Enter a Telegram username or an HTTPS support URL');
  if(upiId&&!/^[\w.\-]+@[\w.\-]+$/.test(upiId))throw new Error('Enter a valid UPI ID');
  if(qrDataUrl){const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(qrDataUrl);if(!match||Buffer.from(match[2],'base64').length>3*1024*1024)throw new Error('QR must be a PNG, JPEG or WebP image under 3 MB');}
  saveSetting('brand',brand);saveSetting('payee_name',payeeName);saveSetting('upi_id',upiId);saveSetting('support',support);saveSetting('qr_data_url',qrDataUrl);
  return res.json(clientConfig());
 }catch(error){return res.status(400).json({error:error instanceof Error?error.message:'Could not save payment settings'});}
});

