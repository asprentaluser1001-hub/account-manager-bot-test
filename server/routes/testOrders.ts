import {Router,Response} from 'express';
import {db} from '../db';
import {adminAuth} from '../auth';
import {approveOrder,availableAccounts,claimPayment,createManualBooking,createOrder,finance,getOrder,markDelivered,markDeliveryFailed,recentOrders,rejectOrder,summary} from '../lib/testOrders';
import {sendAdminClaim,sendCustomerDelivery,sendCustomerStatus} from '../lib/telegramBot';
import {auditLog,bookingEvents,endBooking,extendBooking,financeReport,refundStates,setRefund,transferBooking} from '../lib/v3Features';
export const testOrdersRouter=Router();testOrdersRouter.use(adminAuth);
const fail=(res:Response,e:unknown)=>res.status(400).json({error:e instanceof Error?e.message:'Request failed'});
testOrdersRouter.get('/',(_req,res)=>res.json({orders:recentOrders(),summary:summary(),finance:finance(),available:availableAccounts()}));
testOrdersRouter.get('/v3/finance',(_req,res)=>res.json(financeReport()));
testOrdersRouter.get('/v3/audit',(_req,res)=>res.json({entries:auditLog()}));
testOrdersRouter.get('/v3/refunds',(_req,res)=>res.json({refunds:refundStates()}));
testOrdersRouter.get('/:id/events',(req,res)=>res.json({events:bookingEvents(req.params.id)}));
testOrdersRouter.post('/:id/extend',(req,res)=>{try{if(req.body?.paymentConfirmed!==true)throw new Error('Confirm the ₹50 test payment before extending');res.json({order:extendBooking(req.params.id)})}catch(e){fail(res,e)}});
testOrdersRouter.post('/:id/end',(req,res)=>{try{res.json({order:endBooking(req.params.id,'end_early')})}catch(e){fail(res,e)}});
testOrdersRouter.post('/:id/cancel',(req,res)=>{try{res.json({order:endBooking(req.params.id,'cancel')})}catch(e){fail(res,e)}});
testOrdersRouter.post('/:id/transfer',async(req,res)=>{try{const order=transferBooking(req.params.id,String(req.body?.accountId||''));let delivered=false;if(order.source==='telegram'){
 const account=db.prepare('SELECT email,password FROM accounts WHERE id=?').get(order.account_id) as {email:string;password:string};
 delivered=await sendCustomerDelivery(order,account.email,account.password).catch(()=>false);
 }res.json({order,delivered})}catch(e){fail(res,e)}});
testOrdersRouter.patch('/:id/refund',(req,res)=>{try{res.json(setRefund(req.params.id,String(req.body?.status||''),String(req.body?.note||'')))}catch(e){fail(res,e)}});
testOrdersRouter.post('/manual',(req,res)=>{try{
 const order=createManualBooking(String(req.body.name||''),String(req.body.contact||''),Number(req.body.hours),Number(req.body.amount),String(req.body.accountId||''));
 res.status(201).json({order});
}catch(e){fail(res,e)}});
// These create/claim routes are ADMIN-ONLY sandbox controls; no public payment or webhook.
testOrdersRouter.post('/demo',async(req,res)=>{try{const order=createOrder(String(req.body.chatId||'999001'),String(req.body.username||'sample_customer'),Number(req.body.hours||1));res.status(201).json({order});}catch(e){fail(res,e)}});
testOrdersRouter.post('/:id/claim',async(req,res)=>{try{const existing=getOrder(req.params.id);if(!existing)throw new Error('Booking not found');const order=claimPayment(req.params.id,existing.chat_id);await sendAdminClaim(order).catch(()=>{});res.json({order});}catch(e){fail(res,e)}});
testOrdersRouter.post('/:id/reject',async(req,res)=>{try{const order=rejectOrder(req.params.id);await sendCustomerStatus(order,'Payment proof rejected').catch(()=>{});res.json({order})}catch(e){fail(res,e)}});
testOrdersRouter.post('/:id/approve',async(req,res)=>{try{const details=approveOrder(req.params.id,String(req.body.accountId));if(details.order.source==='web'){markDelivered(req.params.id);return res.json({order:getOrder(req.params.id),delivered:true});}const delivered=await sendCustomerDelivery(details.order,details.email,details.password);if(delivered)markDelivered(req.params.id);else markDeliveryFailed(req.params.id,'Telegram delivery unavailable; account stays reserved.');return res.json({order:getOrder(req.params.id),delivered});}catch(e){return fail(res,e)}});
