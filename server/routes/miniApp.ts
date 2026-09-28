import {Router,json,Request,Response,NextFunction} from 'express';
import {adminAuth} from '../auth';
import {db} from '../db';
import {verifyMiniAppData,MiniAppUser} from '../lib/miniAppAuth';
import {availableAccounts,createWebOrder,getOrder,markGatewayError,PRICES,saveGatewayLinks,TestOrder} from '../lib/testOrders';
import {createImbOrder,isImbConfigured} from '../lib/imbPayment';
import {sendAdminExtensionRequest,setting} from '../lib/telegramBot';
import {hasPendingMiniAppExtension,pendingMiniAppExtensions,removeMiniAppExtensionRequest,requestMiniAppExtension} from '../lib/miniAppExtensions';

const confirmed=['approved','delivered','delivery_failed','expired','reset_failed','cancelled'];
const activeStatus=['approved','delivered','delivery_failed'];
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
 const rows=db.prepare("SELECT id,hours,amount,status,created_at,expires_at FROM test_orders WHERE chat_id=? AND COALESCE(order_type,'booking')='booking' AND status IN ('approved','delivered','delivery_failed','expired','reset_failed','cancelled') ORDER BY created_at DESC LIMIT 12")
  .all(user.id) as Array<{id:string;hours:number;amount:number;status:string;created_at:string;expires_at:string|null}>;
 const support=setting('support_username');
 res.json({user,available:availableAccounts().length>0,prices:PRICES,supportUsername:/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(support)?support:null,active:active?{id:active.id,hours:active.hours,expiresAt:active.expires_at,status:active.status,extensionRequested:hasPendingMiniAppExtension(active.id,active.expires_at!)}:null,recent:rows.filter(row=>confirmed.includes(row.status)).map(row=>({id:row.id,hours:row.hours,amount:row.amount,status:row.status,createdAt:row.created_at,expiresAt:row.expires_at}))});
});
miniAppRouter.post('/book',async(req:CustomerRequest,res)=>{
 const user=req.miniUser!,hours=Number(req.body?.hours);
 if(!Object.prototype.hasOwnProperty.call(PRICES,hours))return res.status(400).json({error:'Choose a valid booking duration'});
 if(activeFor(user.id))return res.status(409).json({error:'Your current booking is still active'});
 const preview=process.env.V3_PREVIEW==='true'&&process.env.PAYMENT_MODE==='mock';
 if(!preview&&!isImbConfigured())return res.status(503).json({error:'Payment checkout is unavailable'});
 try{
  const {order,accessToken}=createWebOrder(user.name,'',hours,user.id);
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
 if(hasPendingMiniAppExtension(id,order.expires_at!))return res.json({requested:true});
 if(!requestMiniAppExtension(id,user.id,order.expires_at!))return res.json({requested:true});
 const sent=await sendAdminExtensionRequest(order).catch(()=>false);
 if(!sent){removeMiniAppExtensionRequest(id);return res.status(503).json({error:'Could not send the request. Please contact support.'});}
 return res.status(202).json({requested:true});
});

export const miniAppAdminRouter=Router();
miniAppAdminRouter.use(adminAuth);
miniAppAdminRouter.get('/extension-requests',(_req,res)=>res.json({requests:pendingMiniAppExtensions()}));
