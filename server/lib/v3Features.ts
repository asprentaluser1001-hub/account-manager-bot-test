import {randomUUID} from 'crypto';
import {db} from '../db';
import {availableAccounts, getOrder, TestOrder} from './testOrders';

// All mutations in this module are confined to the V3 SQLite database.
db.exec(`CREATE TABLE IF NOT EXISTS v3_audit (
 id TEXT PRIMARY KEY, action TEXT NOT NULL, subject TEXT NOT NULL,
 details TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v3_refunds (
 order_id TEXT PRIMARY KEY, status TEXT NOT NULL CHECK(status IN ('not_requested','requested','processing','completed','rejected')),
 note TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS v3_booking_events (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL, kind TEXT NOT NULL,
 amount INTEGER NOT NULL DEFAULT 0, details TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL
);`);
for(const [name, definition] of [['order_type',"TEXT NOT NULL DEFAULT 'booking'"],['parent_order_id','TEXT'],['duration_minutes','INTEGER'],['reminder_notified_at','TEXT']] as const){
 const columns=db.prepare('PRAGMA table_info(test_orders)').all() as Array<{name:string}>;
 if(!columns.some(column=>column.name===name))db.exec(`ALTER TABLE test_orders ADD COLUMN ${name} ${definition}`);
}

function log(action:string,subject:string,details:string){db.prepare('INSERT INTO v3_audit VALUES (?,?,?,?,?)').run(randomUUID(),action,subject,details,new Date().toISOString());}
export const auditLog=()=>db.prepare('SELECT action,subject,details,created_at FROM v3_audit ORDER BY created_at DESC LIMIT 100').all();
export const bookingEvents=(orderId:string)=>db.prepare('SELECT id,kind,amount,details,created_at FROM v3_booking_events WHERE order_id=? ORDER BY created_at DESC').all(orderId);
export const refundStates=()=>db.prepare('SELECT r.order_id,r.status,r.note,r.updated_at FROM v3_refunds r JOIN test_orders o ON o.id=r.order_id WHERE o.history_hidden=0 ORDER BY r.updated_at DESC LIMIT 200').all();

function activeOrder(id:string):TestOrder{
 const order=getOrder(id);
 if(!order||!['approved','delivered','delivery_failed'].includes(order.status)||!order.account_id||!order.expires_at||new Date(order.expires_at).getTime()<=Date.now()||(order as TestOrder&{order_type?:string}).order_type==='extension')throw new Error('Select an active booking');
 return order;
}
function schedule(accountId:string,when:string){db.prepare("INSERT INTO auto_reset_schedule(account_id,run_at,status,created_at) VALUES (?,?,'pending',?) ON CONFLICT(account_id) DO UPDATE SET run_at=excluded.run_at,status='pending',created_at=excluded.created_at").run(accountId,when,new Date().toISOString());}
function event(orderId:string,kind:string,amount:number,details:string){db.prepare('INSERT INTO v3_booking_events VALUES (?,?,?,?,?,?)').run(randomUUID(),orderId,kind,amount,details,new Date().toISOString());}

export function extendBooking(id:string):TestOrder{
 return db.transaction(()=>{
  const order=activeOrder(id),accountId=order.account_id!;
  const account=db.prepare('SELECT sold,sold_until FROM accounts WHERE id=?').get(accountId) as {sold:number;sold_until:string|null}|undefined;
  if(!account?.sold||!account.sold_until||account.sold_until!==order.expires_at)throw new Error('Booking timer changed; refresh and try again');
  const now=new Date().toISOString(),expires=new Date(new Date(order.expires_at!).getTime()+50*60000).toISOString();
  db.prepare('UPDATE accounts SET sold_until=? WHERE id=? AND sold_until=?').run(expires,accountId,order.expires_at);
  db.prepare("UPDATE test_orders SET expires_at=? WHERE id=?").run(expires,id);
  schedule(accountId,expires);
  const extensionId='EXT-'+randomUUID().slice(0,8).toUpperCase();
  db.prepare("INSERT INTO test_orders(id,chat_id,username,hours,amount,status,account_id,created_at,approved_at,expires_at,source,customer_contact,order_type,parent_order_id,duration_minutes) VALUES (?,?,?,?,?,'delivered',?,?,?,?,?,?,'extension',?,50)")
    .run(extensionId,order.chat_id,order.username,1,50,accountId,now,now,expires,order.source,order.customer_contact,id);
  event(id,'extend',50,'Added 50 minutes; mock payment recorded by admin');log('booking.extend',id,extensionId);
  return getOrder(id)!;
 })();
}

export function endBooking(id:string,reason:'end_early'|'cancel'):TestOrder{
 return db.transaction(()=>{
  const order=activeOrder(id),now=new Date().toISOString();
  db.prepare("UPDATE test_orders SET expires_at=?, status=? WHERE id=?").run(now,reason==='cancel'?'cancelled':order.status,id);
  db.prepare('UPDATE accounts SET sold_until=? WHERE id=?').run(now,order.account_id);
  schedule(order.account_id!,now);
  event(id,reason,0,'Password reset queued; account remains unavailable until it succeeds');log('booking.'+reason,id,'Reset queued');
  return getOrder(id)!;
 })();
}

export function transferBooking(id:string,newAccountId:string):TestOrder{
 return db.transaction(()=>{
  const order=activeOrder(id);
  if(!availableAccounts().some(account=>account.id===newAccountId))throw new Error('Choose a different available sample account');
  const oldAccountId=order.account_id!,now=new Date().toISOString();
  const changed=db.prepare('UPDATE accounts SET sold=1,sold_until=? WHERE id=? AND sold=0').run(order.expires_at,newAccountId);
  if(!changed.changes)throw new Error('New account is no longer available');
  schedule(newAccountId,order.expires_at!);
  db.prepare('UPDATE test_orders SET account_id=? WHERE id=?').run(newAccountId,id);
  db.prepare('UPDATE accounts SET sold_until=? WHERE id=?').run(now,oldAccountId);
  schedule(oldAccountId,now);
  event(id,'transfer',0,`From ${oldAccountId} to ${newAccountId}; old account reset queued`);log('booking.transfer',id,`From ${oldAccountId} to ${newAccountId}`);
  return getOrder(id)!;
 })();
}

export function setRefund(id:string,status:string,note:string){
 if(!['not_requested','requested','processing','completed','rejected'].includes(status)||note.length>300)throw new Error('Invalid refund status or note');
 const order=getOrder(id);if(!order)throw new Error('Booking not found');
 db.prepare('INSERT INTO v3_refunds VALUES (?,?,?,?) ON CONFLICT(order_id) DO UPDATE SET status=excluded.status,note=excluded.note,updated_at=excluded.updated_at').run(id,status,note,new Date().toISOString());
 log('refund.status',id,status);return {orderId:id,status,note};
}

export function financeReport(){
 const rows=db.prepare("SELECT date(approved_at,'+330 minutes') day,amount,status,order_type FROM test_orders WHERE history_hidden=0 AND approved_at IS NOT NULL AND approved_at >= '2026-09-25T18:30:00.000Z' ORDER BY approved_at DESC").all() as Array<{day:string;amount:number;status:string;order_type:string}>;
 const confirmed=rows.filter(row=>['approved','delivered','expired','delivery_failed','reset_failed','cancelled'].includes(row.status));
 const sum=(subset:typeof rows)=>subset.reduce((value,row)=>value+row.amount,0);
 const period=(key:string)=>({period:key,bookings:confirmed.filter(row=>row.day.startsWith(key)).length,revenue:sum(confirmed.filter(row=>row.day.startsWith(key)))});
 const failures=db.prepare("SELECT COUNT(*) n FROM test_orders WHERE history_hidden=0 AND status IN ('rejected','payment_gateway_error')").get() as {n:number};
 return {daily:[...new Set(confirmed.map(row=>row.day))].map(period),monthly:[...new Set(confirmed.map(row=>row.day.slice(0,7)))].map(period),total:sum(confirmed),successful:confirmed.length,failed:failures.n,refunds:refundStates()};
}
