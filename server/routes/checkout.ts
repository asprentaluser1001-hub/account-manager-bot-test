import {Router,json,Request} from 'express';
import {adminAuth} from '../auth';
import {availableAccounts,createWebOrder,PRICES,publicWebOrder,submitWebProof} from '../lib/testOrders';
import {db} from '../db';

db.exec(`CREATE TABLE IF NOT EXISTS payment_settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
const getSetting=(key:string)=>(db.prepare('SELECT value FROM payment_settings WHERE key=?').get(key) as {value:string}|undefined)?.value||'';
const saveSetting=(key:string,value:string)=>db.prepare('INSERT INTO payment_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);
const plans=Object.entries(PRICES).map(([hours,amount])=>({hours:Number(hours),amount}));
const clientConfig=()=>({brand:getSetting('brand')||'FlingRoulette',payeeName:getSetting('payee_name'),upiId:getSetting('upi_id'),qrDataUrl:getSetting('qr_data_url'),support:getSetting('support'),plans,available:availableAccounts().length>0});

const attempts=new Map<string,{count:number;reset:number}>();
function limited(req:Request){
 const key=req.ip||'unknown',now=Date.now(),current=attempts.get(key);
 if(!current||current.reset<now){attempts.set(key,{count:1,reset:now+10*60_000});return false;}
 current.count+=1;return current.count>30;
}

export const checkoutRouter=Router();
checkoutRouter.get('/config',(_req,res)=>res.json(clientConfig()));
checkoutRouter.post('/orders',json({limit:'32kb'}),(req,res)=>{
 try{if(limited(req))return res.status(429).json({error:'Too many attempts. Please wait and try again.'});const result=createWebOrder(String(req.body.name||''),String(req.body.contact||''),Number(req.body.hours));return res.status(201).json({orderId:result.order.id,accessToken:result.accessToken,amount:result.order.amount,status:result.order.status});}
 catch(error){return res.status(400).json({error:error instanceof Error?error.message:'Could not create order'});}
});
checkoutRouter.post('/orders/:id/proof',json({limit:'5mb'}),(req,res)=>{
 try{if(limited(req))return res.status(429).json({error:'Too many attempts. Please wait and try again.'});const order=submitWebProof(req.params.id,String(req.body.accessToken||''),String(req.body.paymentReference||''),String(req.body.proofDataUrl||''));return res.json({status:order.status});}
 catch(error){return res.status(400).json({error:error instanceof Error?error.message:'Could not submit payment proof'});}
});
checkoutRouter.get('/orders/:id',(req,res)=>{
 try{return res.json(publicWebOrder(req.params.id,String(req.query.token||'')));}
 catch(error){return res.status(404).json({error:error instanceof Error?error.message:'Order not found'});}
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
