import {randomBytes,randomUUID} from 'crypto';
import {db} from '../db';
import {getOrder,PRICES,TestOrder} from './testOrders';

// Holds are persisted so checkout retries and process restarts cannot double-book.
db.exec(`CREATE TABLE IF NOT EXISTS booking_slots (
 order_id TEXT PRIMARY KEY, account_id TEXT NOT NULL, starts_at TEXT NOT NULL,
 ends_at TEXT NOT NULL, hold_until TEXT, status TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('advance','extension'))
);
CREATE INDEX IF NOT EXISTS booking_slots_account ON booking_slots(account_id,starts_at,ends_at);
`);
export const RESET_BUFFER_MS=2*60_000;
export const EXTENSION_PRICE=50;
type Slot={order_id:string;account_id:string;starts_at:string;ends_at:string;hold_until:string|null;status:string;kind:string};
export function expireHolds(){
 db.prepare("UPDATE booking_slots SET status='expired' WHERE status='hold' AND hold_until<=?").run(new Date().toISOString());
}
export function assertBookingWindow(accountId:string,start:string,end:string,ignoreOrder=''){
 expireHolds();
 const conflict=db.prepare("SELECT 1 FROM booking_slots WHERE account_id=? AND order_id<>? AND status IN ('hold','reserved') AND starts_at<? AND ends_at>? LIMIT 1").get(accountId,ignoreOrder,end,start);
 if(conflict)throw new Error('This time overlaps an advance booking or pending extension');
}
export function availability(hours=1){
 if(!PRICES[hours])throw new Error('Choose a valid booking duration');
 expireHolds();
 const now=Date.now();
 const accounts=db.prepare(`SELECT a.id,a.name,a.sold,a.sold_until,s.status AS reset_status FROM accounts a LEFT JOIN auto_reset_schedule s ON s.account_id=a.id ORDER BY a.created_at`).all() as Array<{id:string;name:string;sold:number;sold_until:string|null;reset_status:string|null}>;
 return accounts.map(a=>{
  let next=now;
  let uncertain=a.reset_status==='failed'||a.reset_status==='running';
  const active=db.prepare("SELECT MAX(expires_at) AS ends FROM test_orders WHERE account_id=? AND status IN ('approved','delivered','delivery_failed','reset_failed') AND COALESCE(order_type,'booking')='booking'").get(a.id) as {ends:string|null};
  const end=a.sold_until||active.ends;
  if(a.sold||active.ends||a.reset_status==='pending'){
   if(!end||Date.parse(end)<=now)uncertain=true;
   else next=Math.max(next,Date.parse(end)+RESET_BUFFER_MS);
  }
  if(uncertain)return {id:a.id,name:a.name,used:true,availableAt:null,resetPending:true};
  const slots=db.prepare("SELECT * FROM booking_slots WHERE account_id=? AND status IN ('hold','reserved') ORDER BY starts_at").all(a.id) as Slot[];
  const length=hours*3600000;
  for(const s of slots){if(Date.parse(s.ends_at)<=next)continue;if(next+length+RESET_BUFFER_MS<=Date.parse(s.starts_at))break;next=Date.parse(s.ends_at)+RESET_BUFFER_MS;}
  return {id:a.id,name:a.name,used:next>now,availableAt:new Date(next).toISOString(),resetPending:false};
 });
}
export function createAdvanceOrder(name:string,chatId:string,hours:number,accountId:string,startsAt:string){
 if(!PRICES[hours]||!/^\d{1,20}$/.test(chatId)||name.trim().length<2)throw new Error('Invalid booking');
 return db.transaction(()=>{
  const option=availability(hours).find(a=>a.id===accountId);
  const start=Date.parse(startsAt),now=Date.now();
  if(!option?.availableAt||!Number.isFinite(start)||start<now+60_000||start< Date.parse(option.availableAt)||start>now+30*86400000)throw new Error('This slot has changed. Refresh availability.');
  const ends=new Date(start+hours*3600000).toISOString(),from=new Date(start).toISOString();
  assertBookingWindow(accountId,from,new Date(Date.parse(ends)+RESET_BUFFER_MS).toISOString());
  const id='WEB-'+randomUUID().slice(0,8).toUpperCase(),accessToken=randomBytes(24).toString('base64url');
  db.prepare("INSERT INTO test_orders(id,chat_id,username,hours,amount,status,created_at,source,access_token,account_id) VALUES (?,?,?,?,?,'awaiting_payment_claim',?,'web',?,?)").run(id,chatId,name.trim(),hours,PRICES[hours],new Date(now).toISOString(),accessToken,accountId);
  db.prepare("INSERT INTO booking_slots VALUES (?,?,?,?,?,'hold','advance')").run(id,accountId,from,ends,new Date(Math.min(now+5*60_000,start)).toISOString());
  return {order:getOrder(id)!,accessToken};
 })();
}
export function extensionEligibility(order:TestOrder){
 if(order.hours===0.5)return {allowed:false,reason:'30-minute bookings cannot be extended'};
 if(!order.account_id||!order.expires_at||!['approved','delivered'].includes(order.status)||Date.parse(order.expires_at)<=Date.now())return {allowed:false,reason:'Booking has ended or access needs support'};
 const reset=db.prepare('SELECT status FROM auto_reset_schedule WHERE account_id=?').get(order.account_id) as {status:string}|undefined;
 if(reset?.status!=='pending')return {allowed:false,reason:'Password reset has started or needs support'};
 try{assertBookingWindow(order.account_id,order.expires_at,new Date(Date.parse(order.expires_at)+3600000+RESET_BUFFER_MS).toISOString());return {allowed:true,reason:null};}
 catch{return {allowed:false,reason:'An advance booking or extension payment already reserves this time'};}
}
export function createExtensionOrder(parent:TestOrder){
 return db.transaction(()=>{
  if(parent.hours===0.5)throw new Error('30-minute bookings cannot be extended');
  expireHolds();
  const existing=db.prepare("SELECT o.* FROM test_orders o JOIN booking_slots s ON s.order_id=o.id WHERE o.parent_order_id=? AND s.kind='extension' AND s.status='hold'").get(parent.id) as TestOrder|undefined;
  if(existing)return {order:existing,accessToken:existing.access_token!};
  const eligibility=extensionEligibility(parent);if(!eligibility.allowed)throw new Error(eligibility.reason!);
  const id='WEB-'+randomUUID().slice(0,8).toUpperCase(),accessToken=randomBytes(24).toString('base64url'),now=new Date().toISOString();
  db.prepare("INSERT INTO test_orders(id,chat_id,username,hours,amount,status,created_at,source,access_token,account_id,order_type,parent_order_id) VALUES (?,?,?,1,?,'awaiting_payment_claim',?,'web',?,?,'extension',?)").run(id,parent.chat_id,parent.username,EXTENSION_PRICE,now,accessToken,parent.account_id,parent.id);
  db.prepare("INSERT INTO booking_slots VALUES (?,?,?,?,?,'hold','extension')").run(id,parent.account_id,parent.expires_at,new Date(Date.parse(parent.expires_at!)+3600000).toISOString(),parent.expires_at);
  return {order:getOrder(id)!,accessToken};
 })();
}
export function releaseHold(id:string){db.prepare("UPDATE booking_slots SET status='expired' WHERE order_id=? AND status='hold'").run(id);}
export function confirmSlotPayment(id:string):'extension'|'advance'|null{
 return db.transaction(()=>{
  expireHolds();
  const slot=db.prepare('SELECT * FROM booking_slots WHERE order_id=?').get(id) as Slot|undefined;
  if(!slot)return null;
  const order=getOrder(id)!;
  if(slot.status==='reserved'||slot.status==='fulfilled')return slot.kind as 'extension'|'advance';
  if(order.status!=='payment_claimed')throw new Error('Payment has not been verified');
  if(slot.status!=='hold'){
   db.prepare("UPDATE test_orders SET status='payment_late',approved_at=?,error='Payment confirmed after the slot/payment deadline; contact support for refund or reassignment' WHERE id=? AND status='payment_claimed'").run(new Date().toISOString(),id);
   return slot.kind as 'extension'|'advance';
  }
  if(slot.kind==='advance'){
   db.prepare("UPDATE booking_slots SET status='reserved',hold_until=NULL WHERE order_id=?").run(id);
   db.prepare("UPDATE test_orders SET status='reserved',approved_at=?,expires_at=? WHERE id=? AND status='payment_claimed'").run(new Date().toISOString(),slot.ends_at,id);
   return 'advance';
  }
  const parent=getOrder((order as TestOrder&{parent_order_id:string}).parent_order_id);
  const account=db.prepare('SELECT sold,sold_until FROM accounts WHERE id=?').get(slot.account_id) as {sold:number;sold_until:string|null};
  const reset=db.prepare('SELECT status FROM auto_reset_schedule WHERE account_id=?').get(slot.account_id) as {status:string}|undefined;
  if(!parent||parent.hours===0.5||!['approved','delivered'].includes(parent.status)||parent.expires_at!==slot.starts_at||account?.sold_until!==slot.starts_at||!account.sold||reset?.status!=='pending'||Date.parse(slot.starts_at)<=Date.now()){
   releaseHold(id);db.prepare("UPDATE test_orders SET status='payment_late',approved_at=?,error='Booking ended or changed before payment confirmation; contact support' WHERE id=?").run(new Date().toISOString(),id);return 'extension';
  }
  assertBookingWindow(slot.account_id,slot.starts_at,new Date(Date.parse(slot.ends_at)+RESET_BUFFER_MS).toISOString(),id);
  db.prepare('UPDATE accounts SET sold_until=? WHERE id=?').run(slot.ends_at,slot.account_id);
  db.prepare("UPDATE auto_reset_schedule SET run_at=? WHERE account_id=? AND status='pending'").run(slot.ends_at,slot.account_id);
  db.prepare('UPDATE test_orders SET expires_at=?,reminder_notified_at=NULL WHERE id=?').run(slot.ends_at,parent.id);
  db.prepare("UPDATE test_orders SET status='delivered',approved_at=?,delivered_at=?,expires_at=?,duration_minutes=60 WHERE id=? AND status='payment_claimed'").run(new Date().toISOString(),new Date().toISOString(),slot.ends_at,id);
  db.prepare("UPDATE booking_slots SET status='fulfilled',hold_until=NULL WHERE order_id=?").run(id);
  return 'extension';
 })();
}
export function activateReservations():Array<{order:TestOrder;email:string;password:string}>{
 expireHolds();
 const now=new Date().toISOString(),delivered:Array<{order:TestOrder;email:string;password:string}>=[];
 const due=db.prepare("SELECT * FROM booking_slots WHERE status='reserved' AND starts_at<=? ORDER BY starts_at").all(now) as Slot[];
 for(const slot of due)db.transaction(()=>{
  if(slot.ends_at<=now){db.prepare("UPDATE booking_slots SET status='blocked' WHERE order_id=?").run(slot.order_id);db.prepare("UPDATE test_orders SET status='reservation_failed',error='Slot ended before account reset completed; contact support' WHERE id=? AND status='reserved'").run(slot.order_id);return;}
  const acc=db.prepare('SELECT sold,email,password FROM accounts WHERE id=?').get(slot.account_id) as {sold:number;email:string;password:string}|undefined;
  const reset=db.prepare('SELECT status FROM auto_reset_schedule WHERE account_id=?').get(slot.account_id) as {status:string}|undefined;
  if(!acc||acc.sold||['pending','running','failed'].includes(reset?.status||''))return;
  if(db.prepare("SELECT 1 FROM test_orders WHERE account_id=? AND status IN ('approved','delivered','delivery_failed','reset_failed') AND COALESCE(order_type,'booking')='booking'").get(slot.account_id))return;
  const changed=db.prepare("UPDATE test_orders SET status='delivered',delivered_at=? WHERE id=? AND status='reserved'").run(now,slot.order_id);if(!changed.changes)return;
  db.prepare('UPDATE accounts SET sold=1,sold_until=? WHERE id=?').run(slot.ends_at,slot.account_id);
  db.prepare("INSERT INTO auto_reset_schedule VALUES (?,?,'pending',?) ON CONFLICT(account_id) DO UPDATE SET run_at=excluded.run_at,status='pending',created_at=excluded.created_at").run(slot.account_id,slot.ends_at,now);
  db.prepare("UPDATE booking_slots SET status='fulfilled' WHERE order_id=?").run(slot.order_id);
  delivered.push({order:getOrder(slot.order_id)!,email:acc.email,password:acc.password});
 })();
 return delivered;
}
