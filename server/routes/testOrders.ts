import {Router,Request,Response} from 'express';
import {adminAuth} from '../auth';
import {approveOrder,availableAccounts,claimPayment,createManualBooking,createOrder,finance,getOrder,markDelivered,markDeliveryFailed,recentOrders,rejectOrder,summary} from '../lib/testOrders';
import {sendAdminClaim,sendCustomerDelivery} from '../lib/telegramBot';
export const testOrdersRouter=Router();testOrdersRouter.use(adminAuth);
const fail=(res:Response,e:unknown)=>res.status(400).json({error:e instanceof Error?e.message:'Request failed'});
testOrdersRouter.get('/',(_req,res)=>res.json({orders:recentOrders(),summary:summary(),finance:finance(),available:availableAccounts()}));
testOrdersRouter.post('/manual',(req,res)=>{try{
 const order=createManualBooking(String(req.body.name||''),String(req.body.contact||''),Number(req.body.hours),Number(req.body.amount),String(req.body.accountId||''));
 res.status(201).json({order});
}catch(e){fail(res,e)}});
// These create/claim routes are ADMIN-ONLY sandbox controls; no public payment or webhook.
testOrdersRouter.post('/demo',async(req,res)=>{try{const order=createOrder(String(req.body.chatId||'999001'),String(req.body.username||'sample_customer'),Number(req.body.hours||1));res.status(201).json({order});}catch(e){fail(res,e)}});
testOrdersRouter.post('/:id/claim',async(req,res)=>{try{const order=claimPayment(req.params.id,String(req.body.chatId||'999001'));await sendAdminClaim(order);res.json({order});}catch(e){fail(res,e)}});
testOrdersRouter.post('/:id/reject',(req,res)=>{try{res.json({order:rejectOrder(req.params.id)})}catch(e){fail(res,e)}});
testOrdersRouter.post('/:id/approve',async(req,res)=>{try{const details=approveOrder(req.params.id,String(req.body.accountId));if(details.order.source==='web'){markDelivered(req.params.id);return res.json({order:getOrder(req.params.id),delivered:true});}const delivered=await sendCustomerDelivery(details.order,details.email,details.password);if(delivered)markDelivered(req.params.id);else markDeliveryFailed(req.params.id,'Telegram delivery unavailable; account stays reserved.');return res.json({order:getOrder(req.params.id),delivered});}catch(e){return fail(res,e)}});
