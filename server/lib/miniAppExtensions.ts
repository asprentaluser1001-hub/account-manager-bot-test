import {db} from '../db';

db.exec(`CREATE TABLE IF NOT EXISTS miniapp_extension_requests (
 order_id TEXT PRIMARY KEY, chat_id TEXT NOT NULL, requested_expires_at TEXT NOT NULL,
 created_at TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','fulfilled'))
);`);

export function requestMiniAppExtension(orderId:string,chatId:string,expiresAt:string){
 return db.prepare("INSERT INTO miniapp_extension_requests VALUES (?,?,?,?,'pending') ON CONFLICT(order_id) DO UPDATE SET chat_id=excluded.chat_id,requested_expires_at=excluded.requested_expires_at,created_at=excluded.created_at,status='pending' WHERE miniapp_extension_requests.status='fulfilled'")
  .run(orderId,chatId,expiresAt,new Date().toISOString()).changes>0;
}
export function removeMiniAppExtensionRequest(orderId:string){db.prepare("DELETE FROM miniapp_extension_requests WHERE order_id=? AND status='pending'").run(orderId);}
export function fulfillMiniAppExtension(orderId:string){db.prepare("UPDATE miniapp_extension_requests SET status='fulfilled' WHERE order_id=? AND status='pending'").run(orderId);}
export function pendingMiniAppExtensions(){return db.prepare("SELECT r.order_id AS orderId,o.username AS name,r.created_at AS requestedAt FROM miniapp_extension_requests r JOIN test_orders o ON o.id=r.order_id WHERE r.status='pending' AND o.expires_at=r.requested_expires_at AND o.expires_at>? ORDER BY r.created_at DESC LIMIT 30").all(new Date().toISOString()) as Array<{orderId:string;name:string;requestedAt:string}>;}
export function hasPendingMiniAppExtension(orderId:string,expiresAt:string){return !!db.prepare("SELECT 1 FROM miniapp_extension_requests WHERE order_id=? AND status='pending' AND requested_expires_at=?").get(orderId,expiresAt);}
