import {availability,createAdvanceOrder,createExtensionOrder,extensionEligibility} from '../lib/v5Bookings';
import {Router,json,Request,Response,NextFunction} from 'express';
import {adminAuth} from '../auth';
import {db} from '../db';
import {verifyMiniAppData,MiniAppUser} from '../lib/miniAppAuth';
import {createWebOrder,getOrder,markGatewayError,PRICES,saveGatewayLinks,TestOrder} from '../lib/testOrders';
import {createImbOrder,isImbConfigured} from '../lib/imbPayment';
import {setting} from '../lib/telegramBot';
import {pendingMiniAppExtensions} from '../lib/miniAppExtensions';

const confirmed=['approved','delivered','delivery_failed','expired','reset_failed','cancelled','reserved','reservation_failed','payment_late'];
type CustomerRequest=Request&{miniUser?:MiniAppUser};
export const miniAppRouter=Router();
miniAppRouter.use(json({limit:'8kb'}));
miniAppRouter.use((req:CustomerRequest,res:Response,next:NextFunction)=>{
 res.setHeader('Cache-Control','no-store');
 try{req.miniUser=verifyMiniAppData(String(req.get('X-Telegram-Init-Data')||''),process.env.TELEGRAM_BOT_TOKEN||'');next()}
 catch(error){res.status(401).json({error:error instanceof Error?error.message:'Invalid Telegram session'})}
});
function activeFor(chatId:string):TestOrder|undefined{
 return db.prepare("SELECT * FROM test_orders WHERE chat_id=? AND COALESCE(order_type,'booking')='booking' AND status IN ('approved','delivered','delivery_failed') AND expires_at>? ORDER BY approved_at DESC LIMIT 1").get(chatId,new Date().toISOString()) as TestOrder|undefined;
}
miniAppRouter.get('/me',(req:CustomerRequest,res)=>{
 const user=req.miniUser!,active=activeFor(user.id);
 const rows=db.prepare("SELECT id,hours,amount,status,created_at,expires_at FROM test_orders WHERE chat_id=? AND COALESCE(order_type,'booking')='booking' AND status IN ('approved','delivered','delivery_failed','expired','reset_failed','cancelled','reserved','reservation_failed','payment_late') ORDER BY created_at DESC LIMIT 12")
  .all(user.id) as Array<{id:string;hours:number;amount:number;status:string;created_at:string;expires_at:string|null}>;
 const support=setting('support_username');
 const slots=availability(Number(req.query.hours)||1);
 const credentials=active?.account_id&&active.status!=='delivery_failed'?db.prepare('SELECT email,password FROM accounts WHERE id=? AND sold=1 AND sold_until=?').get(active.account_id,active.expires_at):null;
 const reservations=db.prepare("SELECT o.id,o.hours,o.status,s.starts_at AS startsAt,s.ends_at AS endsAt FROM test_orders o JOIN booking_slots s ON s.order_id=o.id WHERE o.chat_id=? AND o.status='reserved' ORDER BY s.starts_at").all(user.id);
 const eligibility=active?extensionEligibility(active):null;
 const pendingPayment=active?db.prepare("SELECT 1 FROM booking_slots s JOIN test_orders o ON o.id=s.order_id WHERE o.parent_order_id=? AND s.status='hold' AND s.kind='extension' AND s.starts_at=?").get(active.id,active.expires_at):null;
 res.json({user,slots,reservations,available:slots.some(slot=>!slot.used&&!slot.resetPending),prices:PRICES,supportUsername:/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(support)?support:null,active:active?{id:active.id,hours:active.hours,expiresAt:active.expires_at,status:active.status,credentials,extensionAllowed:!!pendingPayment||eligibility?.allowed,extensionReason:eligibility?.reason,extensionPending:!!pendingPayment,extensionRequested:false}:null,recent:rows.filter(row=>confirmed.includes(row.status)).map(row=>({id:row.id,hours:row.hours,amount:row.amount,status:row.status,createdAt:row.created_at,expiresAt:row.expires_at}))});
});
miniAppRouter.post('/book',async(req:CustomerRequest,res)=>{
 const user=req.miniUser!,hours=Number(req.body?.hours);
 if(!Object.prototype.hasOwnProperty.call(PRICES,hours))return res.status(400).json({error:'Choose a valid booking duration'});
 if(activeFor(user.id)&&!req.body?.advance)return res.status(409).json({error:'Your current booking is still active'});
 const preview=process.env.V3_PREVIEW==='true'&&process.env.PAYMENT_MODE==='mock';
 if(!preview&&!isImbConfigured())return res.status(503).json({error:'Payment checkout is unavailable'});
 try{
  const active=activeFor(user.id);if(req.body?.advance&&active?.expires_at&&Date.parse(String(req.body.startsAt))<Date.parse(active.expires_at))throw new Error('Advance slot must start after your current booking');
  const {order,accessToken}=req.body?.advance?createAdvanceOrder(user.name,user.id,hours,String(req.body.accountId||''),String(req.body.startsAt||'')):createWebOrder(user.name,'',hours,user.id);
  const destination=new URL('/checkout',process.env.PUBLIC_CHECKOUT_URL||`${req.protocol}://${req.get('host')}`);
  destination.searchParams.set('order',order.id);destination.searchParams.set('token',accessToken);destination.searchParams.set('amount',String(order.amount));destination.searchParams.set('hours',String(hours));
  if(!preview){
   try{const links=await createImbOrder({orderId:order.id,amount:order.amount,mobile:'',redirectUrl:destination.toString()});saveGatewayLinks(order.id,links);}
   catch(error){markGatewayError(order.id,error instanceof Error?error.message:'IMB order creation failed');throw error;}
  }
  res.status(201).json({checkoutUrl:destination.pathname+destination.search});
 }catch(error){res.status(400).json({error:error instanceof Error?error.message:'Could not start booking'})}
});
miniAppRouter.post('/extend',async(req:CustomerRequest,res)=>{
 const user=req.miniUser!,id=String(req.body?.orderId||''),order=activeFor(user.id);
 if(!order||order.id!==id)return res.status(404).json({error:'No active booking for this account'});
 if(order.status==='delivery_failed')return res.status(409).json({error:'Contact support to resolve access before extending'});
 try{
  const preview=process.env.V3_PREVIEW==='true'&&process.env.PAYMENT_MODE==='mock';
  if(!preview&&!isImbConfigured())return res.status(503).json({error:'Payment checkout is unavailable'});
  const {order:payment,accessToken}=createExtensionOrder(order);
  const destination=new URL('/checkout',process.env.PUBLIC_CHECKOUT_URL||`${req.protocol}://${req.get('host')}`);
  destination.searchParams.set('order',payment.id);destination.searchParams.set('token',accessToken);destination.searchParams.set('amount',String(payment.amount));destination.searchParams.set('hours','1');
  if(!preview){try{saveGatewayLinks(payment.id,await createImbOrder({orderId:payment.id,amount:payment.amount,mobile:'',redirectUrl:destination.toString()}));}catch(error){markGatewayError(payment.id,error instanceof Error?error.message:'Payment unavailable');throw error;}}
  return res.status(201).json({checkoutUrl:destination.pathname+destination.search});
 }catch(error){return res.status(409).json({error:error instanceof Error?error.message:'Could not start extension'})}
});

export const miniAppAdminRouter=Router();
miniAppAdminRouter.use(adminAuth);
miniAppAdminRouter.get('/extension-requests',(_req,res)=>res.json({requests:pendingMiniAppExtensions()}));

