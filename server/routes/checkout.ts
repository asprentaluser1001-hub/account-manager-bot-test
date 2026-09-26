import {Router,json,urlencoded,Request} from 'express';
import {adminAuth} from '../auth';
import {approveOrder,availableAccounts,claimGatewayPayment,createWebOrder,markDelivered,markGatewayError,PRICES,publicWebOrder,saveGatewayLinks,submitWebProof,getOrder} from '../lib/testOrders';
import {db} from '../db';
import {sendAdminClaim} from '../lib/telegramBot';
import {sendApprovalPush} from './push';
import {checkImbOrder,createImbOrder,isImbConfigured} from '../lib/imbPayment';

db.exec(`CREATE TABLE IF NOT EXISTS payment_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
const getSetting=(key:string)=>(db.prepare('SELECT value FROM payment_settings WHERE key=?').get(key) as {value:string}|undefined)?.value||'';
const saveSetting=(key:string,value:string)=>db.prepare('INSERT INTO payment_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
const plans=Object.entries(PRICES).map(([hours,amount])=>({hours:Number(hours),amount}));
const clientConfig=()=>({brand:getSetting('brand')||'FlingRoulette',payeeName:getSetting('payee_name'),upiId:getSetting('upi_id'),qrDataUrl:getSetting('qr_data_url'),support:getSetting('support'),plans,available:availableAccounts().length>0,gatewayEnabled:isImbConfigured()});

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
  if(isImbConfigured()&&!/^[6-9]\d{9}$/.test(String(req.body.contact||'').replace(/\D/g,'').slice(-10)))return res.status(400).json({error:'Enter a valid 10-digit Indian mobile number for IMB payment.'});
  const result=createWebOrder(String(req.body.name||''),String(req.body.contact||''),Number(req.body.hours));
  if(isImbConfigured()){
   try{
    const base=process.env.PUBLIC_CHECKOUT_URL||`${req.protocol}://${req.get('host')}/checkout`;
    const redirect=new URL('/checkout',base);redirect.searchParams.set('order',result.order.id);redirect.searchParams.set('token',result.accessToken);redirect.searchParams.set('amount',String(result.order.amount));redirect.searchParams.set('hours',String(result.order.hours));
    const links=await createImbOrder({orderId:result.order.id,amount:result.order.amount,mobile:result.order.customer_contact||'',redirectUrl:redirect.toString()});
    saveGatewayLinks(result.order.id,links);
    return res.status(201).json({orderId:result.order.id,accessToken:result.accessToken,amount:result.order.amount,status:result.order.status,...links});
   }catch(error){markGatewayError(result.order.id,error instanceof Error?error.message:'IMB order creation failed');throw error;}
  }
  return res.status(201).json({orderId:result.order.id,accessToken:result.accessToken,amount:result.order.amount,status:result.order.status});
 }
 catch(error){return res.status(400).json({error:error instanceof Error?error.message:'Could not create order'});}
});
checkoutRouter.post('/orders/:id/proof',json({limit:'5mb'}),async(req,res)=>{
 try{if(limited(req))return res.status(429).json({error:'Too many attempts. Please wait and try again.'});const order=submitWebProof(req.params.id,String(req.body.accessToken||''),String(req.body.paymentReference||''),String(req.body.proofDataUrl||''));const [adminAlerted,pushAlerts]=await Promise.all([sendAdminClaim(order),sendApprovalPush(order)]);return res.json({status:order.status,adminAlerted,pushAlerts});}
 catch(error){return res.status(400).json({error:error instanceof Error?error.message:'Could not submit payment proof'});}
});
checkoutRouter.get('/orders/:id',(req,res)=>{
 try{return res.json(publicWebOrder(req.params.id,String(req.query.token||'')));}
 catch(error){return res.status(404).json({error:error instanceof Error?error.message:'Order not found'});}
});

async function confirmImbPayment(orderId:string){
 const order=getOrder(orderId);if(!order||order.source!=='web')throw new Error('Unknown IMB order');
 if(['approved','delivered','delivery_failed','expired'].includes(order.status))return {alreadyProcessed:true};
 const checked=await checkImbOrder(orderId),result=checked.result;
 const verified=(checked.status==='COMPLETED'||checked.status===true)&&result?.status==='SUCCESS'&&result.txnStatus==='COMPLETED';
 if(!verified||result?.orderId!==orderId||Number(result.amount)!==order.amount)throw new Error('IMB has not confirmed this order and exact amount');
 const newlyClaimed=claimGatewayPayment(orderId,result.utr?String(result.utr):null);
 const current=getOrder(orderId)!;
 if(!newlyClaimed&&current.status!=='payment_claimed')return {alreadyProcessed:true};
 for(const account of availableAccounts()){
  try{approveOrder(orderId,account.id);markDelivered(orderId);return {alreadyProcessed:false,delivered:true};}
  catch(error){if(!(error instanceof Error)||!['Account is unavailable','Account is already in use','No IDs are available'].includes(error.message))throw error;}
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

export const paymentSettingsRouter=Router();
paymentSettingsRouter.use(adminAuth);
paymentSettingsRouter.get('/',(_req,res)=>res.json(clientConfig()));
paymentSettingsRouter.put('/',json({limit:'5mb'}),(req,res)=>{
 try{
  const brand=String(req.body.brand||'FlingRoulette').trim(),payeeName=String(req.body.payeeName||'').trim(),upiId=String(req.body.upiId||'').trim(),support=String(req.body.support||'').trim(),qrDataUrl=String(req.body.qrDataUrl||'');
  if(brand.length<2||brand.length>40)throw new Error('Brand name must be 2–40 characters');
  if(payeeName.length>80||support.length>100)throw new Error('Payment details are too long');
  if(upiId&&!/^[\w.\-]+@[\w.\-]+$/.test(upiId))throw new Error('Enter a valid UPI ID');
  if(qrDataUrl){const match=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(qrDataUrl);if(!match||Buffer.from(match[2],'base64').length>3*1024*1024)throw new Error('QR must be a PNG, JPEG or WebP image under 3 MB');}
  saveSetting('brand',brand);saveSetting('payee_name',payeeName);saveSetting('upi_id',upiId);saveSetting('support',support);saveSetting('qr_data_url',qrDataUrl);
  return res.json(clientConfig());
 }catch(error){return res.status(400).json({error:error instanceof Error?error.message:'Could not save payment settings'});}
});
