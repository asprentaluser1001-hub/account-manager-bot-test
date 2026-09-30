import {Router,Response} from 'express';
import {db} from '../db';
import {adminAuth} from '../auth';
import {activeAccounts,approveOrder,availableAccounts,claimPayment,createManualBooking,createManualExtension,createOrder,finance,getOrder,hideOrderHistory,markDelivered,markDeliveryFailed,recentOrders,rejectOrder,summary} from '../lib/testOrders';
import {sendAdminClaim,sendCustomerDelivery,sendCustomerStatus} from '../lib/telegramBot';
import {notifyBookingRecorded} from '../lib/bookingNotifications';
import {fulfillMiniAppExtension} from '../lib/miniAppExtensions';
import {addExtraTime,auditLog,bookingEvents,endBooking,extendBooking,financeReport,refundStates,setRefund,transferBooking} from '../lib/v3Features';
export const testOrdersRouter=Router();testOrdersRouter.use(adminAuth);
const fail=(res:Response,e:unknown)=>res.status(400).json({error:e instanceof Error?e.message:'Request failed'});
testOrdersRouter.get('/',(_req,res)=>res.json({orders:recentOrders(),summary:summary(),finance:finance(),available:availableAccounts(),active:activeAccounts()}));
testOrdersRouter.get('/:id/proof',(req,res)=>{const order=getOrder(req.params.id);if(!order||order.history_hidden||!order.proof_data_url)return res.status(404).json({error:'Payment proof unavailable'});res.setHeader('Cache-Control','no-store');return res.json({proofDataUrl:order.proof_data_url});});
testOrdersRouter.post('/history/hide',(req,res)=>{try{res.json({removed:hideOrderHistory(req.body?.ids)})}catch(e){fail(res,e)}});
testOrdersRouter.get('/v3/finance',(_req,res)=>res.json(financeReport()));
testOrdersRouter.get('/v3/audit',(_req,res)=>res.json({entries:auditLog()}));
testOrdersRouter.get('/v3/refunds',(_req,res)=>res.json({refunds:refundStates()}));
testOrdersRouter.get('/:id/events',(req,res)=>res.json({events:bookingEvents(req.params.id)}));
testOrdersRouter.post('/:id/extend',(req,res)=>{try{if(req.body?.paymentConfirmed!==true)throw new Error('Verify the ₹50 payment before extending');const order=extendBooking(req.params.id);fulfillMiniAppExtension(order.id);void notifyBookingRecorded(order,true);res.json({order})}catch(e){fail(res,e)}});
testOrdersRouter.post('/:id/extra-time',async(req,res)=>{try{const order=addExtraTime(req.params.id,req.body?.minutes);const notified=await sendCustomerStatus(order,`Extra ${req.body.minutes} minutes added. New end time: ${order.expires_at}`);res.json({order,notified})}catch(e){fail(res,e)}});
testOrdersRouter.post('/:id/end',(req,res)=>{try{res.json({order:endBooking(req.params.id,'end_early')})}catch(e){fail(res,e)}});
testOrdersRouter.post('/:id/cancel',(req,res)=>{try{res.json({order:endBooking(req.params.id,'cancel')})}catch(e){fail(res,e)}});
testOrdersRouter.post('/:id/transfer',async(req,res)=>{try{const order=transferBooking(req.params.id,String(req.body?.accountId||''));let delivered=false;if(/^\d{1,20}$/.test(order.chat_id)){
 const account=db.prepare('SELECT email,password FROM accounts WHERE id=?').get(order.account_id) as {email:string;password:string};
 delivered=await sendCustomerDelivery(order,account.email,account.password).catch(()=>false);
 }res.json({order,delivered,manualDelivery:!/^\d{1,20}$/.test(order.chat_id),message:delivered?'Replacement credentials sent.': 'Migration saved. Share replacement credentials privately from Accounts.'})}catch(e){fail(res,e)}});
testOrdersRouter.patch('/:id/refund',(req,res)=>{try{res.json(setRefund(req.params.id,String(req.body?.status||''),String(req.body?.note||'')))}catch(e){fail(res,e)}});
testOrdersRouter.post('/manual',async(req,res)=>{try{
 const order=createManualBooking(String(req.body.name||''),String(req.body.contact||''),Number(req.body.hours),Number(req.body.amount),String(req.body.accountId||''),String(req.body.telegramChatId||''));
 if(order.chat_id==='manual'){void notifyBookingRecorded(order);return res.status(201).json({order,delivered:false,manualDelivery:true});}
 const account=db.prepare('SELECT email,password FROM accounts WHERE id=?').get(order.account_id) as {email:string;password:string};
 const delivered=await sendCustomerDelivery(order,account.email,account.password).catch(()=>false);
 if(delivered)markDelivered(order.id);else markDeliveryFailed(order.id,'Telegram delivery failed; check the chat ID and bot, then share credentials privately.');
 const saved=getOrder(order.id)!;void notifyBookingRecorded(saved);
 res.status(201).json({order:saved,delivered});
}catch(e){fail(res,e)}});
testOrdersRouter.post('/manual-extension',(req,res)=>{try{
 const order=createManualExtension(String(req.body.name||''),String(req.body.contact||''),Number(req.body.amount),String(req.body.accountId||''));
 void notifyBookingRecorded(order,true);
 res.status(201).json({order});
}catch(e){fail(res,e)}});
// These create/claim routes are ADMIN-ONLY sandbox controls; no public payment or webhook.
testOrdersRouter.post('/demo',async(req,res)=>{try{if(process.env.V3_PREVIEW!=='true')return res.status(403).json({error:'Test orders are disabled in production'});const order=createOrder(String(req.body.chatId||'999001'),String(req.body.username||'sample_customer'),Number(req.body.hours||1));res.status(201).json({order});}catch(e){fail(res,e)}});
testOrdersRouter.post('/:id/claim',async(req,res)=>{try{if(process.env.V3_PREVIEW!=='true')return res.status(403).json({error:'Test claims are disabled in production; payment must be verified by IMB'});const existing=getOrder(req.params.id);if(!existing)throw new Error('Booking not found');const order=claimPayment(req.params.id,existing.chat_id);await sendAdminClaim(order).catch(()=>{});res.json({order});}catch(e){fail(res,e)}});
testOrdersRouter.post('/:id/reject',async(req,res)=>{try{const order=rejectOrder(req.params.id);await sendCustomerStatus(order,'Payment proof rejected').catch(()=>{});res.json({order})}catch(e){fail(res,e)}});
testOrdersRouter.post('/:id/approve',async(req,res)=>{try{const details=approveOrder(req.params.id,String(req.body.accountId));if(details.order.source==='web'){
  markDelivered(req.params.id);
  if(/^\d{1,16}$/.test(details.order.chat_id))void sendCustomerDelivery(details.order,details.email,details.password).catch(()=>false);
  const order=getOrder(req.params.id)!;void notifyBookingRecorded(order);return res.json({order,delivered:true});
 }const delivered=await sendCustomerDelivery(details.order,details.email,details.password);if(delivered)markDelivered(req.params.id);else markDeliveryFailed(req.params.id,'Telegram delivery unavailable; account stays reserved.');const order=getOrder(req.params.id)!;void notifyBookingRecorded(order);return res.json({order,delivered});}catch(e){return fail(res,e)}});
