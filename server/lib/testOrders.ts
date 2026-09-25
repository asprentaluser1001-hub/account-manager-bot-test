import { randomBytes, randomUUID } from 'crypto';
import { db } from '../db';

export type TestOrder = { id:string; chat_id:string; username:string; hours:number; amount:number; status:string; account_id:string|null; created_at:string; claimed_at:string|null; approved_at:string|null; expires_at:string|null; delivered_at:string|null; error:string|null };
export const PRICES: Record<number,number> = {1:100,2:150,3:200,168:750,720:1800};

db.exec(`CREATE TABLE IF NOT EXISTS test_orders (
 id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, username TEXT NOT NULL, hours INTEGER NOT NULL,
 amount INTEGER NOT NULL, status TEXT NOT NULL, account_id TEXT,
 created_at TEXT NOT NULL, claimed_at TEXT, approved_at TEXT, expires_at TEXT,
 delivered_at TEXT, error TEXT
);
CREATE INDEX IF NOT EXISTS idx_test_orders_status ON test_orders(status);
CREATE INDEX IF NOT EXISTS idx_test_orders_account ON test_orders(account_id);
`);
export function getOrder(id:string):TestOrder|undefined {return db.prepare('SELECT * FROM test_orders WHERE id = ?').get(id) as TestOrder|undefined;}
export function recentOrders():TestOrder[]{return db.prepare('SELECT * FROM test_orders ORDER BY created_at DESC LIMIT 200').all() as TestOrder[];}
export function createOrder(chatId:string,username:string,hours:number):TestOrder {
 if (!PRICES[hours] || !/^\d{1,20}$/.test(chatId) || username.length > 64) throw new Error('Invalid order');
 if(!availableAccounts().length) throw new Error('No IDs are available right now. Please try again later or contact support.');
 const id='TEST-'+randomUUID().slice(0,8).toUpperCase(), now=new Date().toISOString();
 db.prepare('INSERT INTO test_orders (id,chat_id,username,hours,amount,status,created_at) VALUES (?,?,?,?,?,?,?)').run(id,chatId,username,hours,PRICES[hours],'awaiting_payment_claim',now);
 return getOrder(id)!;
}
export function claimPayment(id:string,chatId:string):TestOrder {
 const result=db.prepare("UPDATE test_orders SET status='payment_claimed', claimed_at=? WHERE id=? AND chat_id=? AND status='awaiting_payment_claim'").run(new Date().toISOString(),id,chatId);
 if(!result.changes) throw new Error('Order not found or already claimed');
 return getOrder(id)!;
}
export function rejectOrder(id:string):TestOrder {
 const result=db.prepare("UPDATE test_orders SET status='rejected' WHERE id=? AND status='payment_claimed'").run(id);
 if(!result.changes) throw new Error('This order cannot be rejected');
 return getOrder(id)!;
}
export function availableAccounts():Array<{id:string;name:string}>{
 return db.prepare(`SELECT id,name FROM accounts WHERE sold=0 AND id NOT IN
 (SELECT account_id FROM auto_reset_schedule WHERE status IN ('pending','running','failed'))
 AND id NOT IN (SELECT account_id FROM test_orders WHERE status IN ('approved','delivered','reset_failed')) ORDER BY created_at ASC`).all() as Array<{id:string;name:string}>;
}
export function approveOrder(id:string,accountId:string):{order:TestOrder;email:string;password:string} {
 const txn=db.transaction(()=>{
  const order=getOrder(id);if(!order||order.status!=='payment_claimed')throw new Error('Order is not awaiting approval');
  if(!availableAccounts().some(a=>a.id===accountId))throw new Error('Account is unavailable');
  const account=db.prepare('SELECT email,password FROM accounts WHERE id=?').get(accountId) as {email:string;password:string}|undefined;
  if(!account)throw new Error('Account missing');
  const now=new Date(), ends=new Date(now.getTime()+order.hours*3600000).toISOString();
  const sold=db.prepare('UPDATE accounts SET sold=1,sold_until=? WHERE id=? AND sold=0').run(ends,accountId);
  if(!sold.changes)throw new Error('Account is already in use');
  db.prepare("INSERT INTO auto_reset_schedule (account_id,run_at,status,created_at) VALUES (?,?,'pending',?) ON CONFLICT(account_id) DO UPDATE SET run_at=excluded.run_at,status='pending',created_at=excluded.created_at").run(accountId,ends,now.toISOString());
  db.prepare("UPDATE test_orders SET status='approved',account_id=?,approved_at=?,expires_at=? WHERE id=? AND status='payment_claimed'").run(accountId,now.toISOString(),ends,id);
  return {order:getOrder(id)!,email:account.email,password:account.password};
 });return txn();
}
export function markDelivered(id:string){db.prepare("UPDATE test_orders SET status='delivered',delivered_at=? WHERE id=? AND status='approved'").run(new Date().toISOString(),id);}
export function markDeliveryFailed(id:string,error:string){db.prepare("UPDATE test_orders SET status='delivery_failed',error=? WHERE id=? AND status='approved'").run(error.slice(0,300),id);}
export function markReset(accountId:string,success:boolean,error?:string){
 db.prepare("UPDATE test_orders SET status=?,error=? WHERE account_id=? AND status IN ('approved','delivered','delivery_failed')").run(success?'expired':'reset_failed',success?null:error||'Reset failed',accountId);
 if(success)db.prepare('UPDATE accounts SET sold=0,sold_until=NULL WHERE id=?').run(accountId);
}
export function sandboxReset(accountId:string):{success:boolean;newPassword?:string;error?:string}{
 const account=db.prepare('SELECT id FROM accounts WHERE id=?').get(accountId);
 if(!account)return {success:false,error:'Missing account'};
 const newPassword=randomBytes(18).toString('base64url');
 db.prepare('UPDATE accounts SET password=?,last_reset_at=? WHERE id=?').run(newPassword,new Date().toISOString(),accountId);
 return {success:true,newPassword};
}
export function summary(){
 const paid=db.prepare("SELECT COUNT(*) as sales,COALESCE(SUM(amount),0) as revenue FROM test_orders WHERE status IN ('approved','delivered','expired','delivery_failed','reset_failed')").get() as {sales:number;revenue:number};
 return {...paid,bookings:(db.prepare("SELECT COUNT(*) as n FROM test_orders").get() as {n:number}).n,customers:(db.prepare("SELECT COUNT(DISTINCT chat_id) as n FROM test_orders").get() as {n:number}).n,pending:db.prepare("SELECT COUNT(*) as n FROM test_orders WHERE status='payment_claimed'").get() as {n:number},available:availableAccounts().length};
}
