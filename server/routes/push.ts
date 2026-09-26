import {Router,json} from 'express';
import webPush, {PushSubscription} from 'web-push';
import {adminAuth} from '../auth';
import {db} from '../db';
import {TestOrder} from '../lib/testOrders';

db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (
 endpoint TEXT PRIMARY KEY,
 p256dh TEXT NOT NULL,
 auth TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS app_secrets (
 key TEXT PRIMARY KEY,
 value TEXT NOT NULL
);`);

function secret(key:string){return (db.prepare('SELECT value FROM app_secrets WHERE key=?').get(key) as {value:string}|undefined)?.value||'';}
function saveSecret(key:string,value:string){db.prepare('INSERT INTO app_secrets(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}

let publicKey=process.env.VAPID_PUBLIC_KEY||secret('vapid_public_key');
let privateKey=process.env.VAPID_PRIVATE_KEY||secret('vapid_private_key');
if(!publicKey||!privateKey){
 const generated=webPush.generateVAPIDKeys();publicKey=generated.publicKey;privateKey=generated.privateKey;
 saveSecret('vapid_public_key',publicKey);saveSecret('vapid_private_key',privateKey);
}
webPush.setVapidDetails(process.env.VAPID_SUBJECT||'https://flingroulette.duckdns.org',publicKey,privateKey);

export const pushRouter=Router();
pushRouter.use(adminAuth);
pushRouter.get('/public-key',(_req,res)=>res.json({publicKey}));
pushRouter.post('/subscribe',json({limit:'16kb'}),(req,res)=>{
 try{
  const endpoint=String(req.body?.endpoint||''),p256dh=String(req.body?.keys?.p256dh||''),auth=String(req.body?.keys?.auth||'');
  const url=new URL(endpoint);
  if(url.protocol!=='https:'||endpoint.length>2048||p256dh.length<20||p256dh.length>512||auth.length<8||auth.length>256)throw new Error('Invalid push subscription');
  db.prepare('INSERT INTO push_subscriptions(endpoint,p256dh,auth,created_at) VALUES (?,?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh,auth=excluded.auth,created_at=excluded.created_at').run(endpoint,p256dh,auth,new Date().toISOString());
  return res.json({ok:true});
 }catch(error){return res.status(400).json({error:error instanceof Error?error.message:'Could not enable notifications'});}
});
pushRouter.post('/unsubscribe',json({limit:'8kb'}),(req,res)=>{
 db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(String(req.body?.endpoint||''));return res.json({ok:true});
});

async function sendPush(payload:{title:string;body:string;url:string;tag:string}):Promise<number>{
 const subscriptions=db.prepare('SELECT endpoint,p256dh,auth FROM push_subscriptions').all() as Array<{endpoint:string;p256dh:string;auth:string}>;
 let sent=0;
 await Promise.all(subscriptions.map(async row=>{
  const subscription:PushSubscription={endpoint:row.endpoint,keys:{p256dh:row.p256dh,auth:row.auth}};
  try{
   await webPush.sendNotification(subscription,JSON.stringify(payload));sent+=1;
  }catch(error){
   const status=(error as {statusCode?:number}).statusCode;
   if(status===404||status===410)db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(row.endpoint);
   else console.error('[Push] Notification failed',error);
  }
 }));
 return sent;
}
export function sendApprovalPush(order:TestOrder):Promise<number>{
 return sendPush({title:'Approval waiting',body:`${order.username} · ₹${order.amount} · ${order.id}`,url:'/?tab=approvals',tag:order.id});
}
export function sendBookingEndPush(order:TestOrder):Promise<number>{
 return sendPush({title:'Booking time ended',body:`${order.username} · ${order.id} · password reset is starting`,url:'/?tab=accounts',tag:`end-${order.id}`});
}

export function sendResetResultPush(accountId:string,accountName:string,success:boolean,runAt:string):Promise<number>{
 return sendPush({title:success?'Reset completed':'Reset failed',body:success?`${accountName}: password reset completed successfully. Account is available.`:`${accountName}: password reset failed. Account remains booked; check Accounts and History.`,url:'/?tab=accounts',tag:`reset-result-${accountId}-${runAt}`});
}
