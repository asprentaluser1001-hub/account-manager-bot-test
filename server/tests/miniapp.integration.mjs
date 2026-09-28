import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url);
const token='123456:test-mini-app-token';
function signed(id,authDate=Math.floor(Date.now()/1000),withSignature=false){
 const fields={auth_date:String(authDate),user:JSON.stringify({id,first_name:'Preview',last_name:'Customer'}),...(withSignature?{signature:'telegram-ed25519-signature'}:{})};
 const check=Object.entries(fields).sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('\n');
 const secret=createHmac('sha256','WebAppData').update(token).digest();
 const hash=createHmac('sha256',secret).update(check).digest('hex');
 return new URLSearchParams({...fields,hash}).toString();
}

test('Mini App verifies Telegram identity and keeps customers separated',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'flingroulette-v3-miniapp-'));
 process.env.DB_PATH=join(dir,'v3-preview.db');process.env.V3_PREVIEW='true';process.env.SANDBOX_MODE='true';process.env.PAYMENT_MODE='mock';process.env.TELEGRAM_BOT_TOKEN=token;process.env.TELEGRAM_ADMIN_ID='';
 const express=require('express');
 const {miniAppRouter}=require('../dist/routes/miniApp.js');
 const {db}=require('../dist/db.js');
 const {verifyMiniAppData}=require('../dist/lib/miniAppAuth.js');
 const {createWebOrder}=require('../dist/lib/testOrders.js');
 let server;
 try{
  const alice=signed('12345'),bob=signed('67890');
  assert.equal(verifyMiniAppData(alice,token).id,'12345');
  const signedWithSignature=signed('12345',Math.floor(Date.now()/1000),true);
  assert.equal(verifyMiniAppData(signedWithSignature,token).id,'12345');
  assert.throws(()=>verifyMiniAppData(signedWithSignature.replace('telegram-ed25519-signature','tampered'),token),/Invalid/);
  assert.throws(()=>verifyMiniAppData(signed('12345',Math.floor(Date.now()/1000)-86401),token),/expired/);
  assert.throws(()=>verifyMiniAppData(alice.replace('12345','67890'),token),/Invalid/);
  assert.throws(()=>verifyMiniAppData(alice,token+'other'),/Invalid/);
  db.prepare('INSERT INTO accounts(id,name,email,password,created_at) VALUES (?,?,?,?,?)').run('sample','Sample account','sample@example.invalid','sample-password',new Date().toISOString());
  db.prepare('INSERT INTO accounts(id,name,email,password,created_at) VALUES (?,?,?,?,?)').run('spare','Spare account','spare@example.invalid','spare-password',new Date().toISOString());
  const app=express();app.use('/api/miniapp',miniAppRouter);
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const call=async(path,init,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{'X-Telegram-Init-Data':init,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()}};
  assert.equal((await call('/api/miniapp/me','')).status,401);
  assert.equal((await call('/api/miniapp/me',alice.replace('12345','67890'))).status,401);
  const created=await call('/api/miniapp/book',alice,'POST',{hours:1});
  assert.equal(created.status,201,JSON.stringify(created.data));assert.match(created.data.checkoutUrl,/^\/checkout\?order=/);
  const account=await call('/api/miniapp/me',alice);assert.equal(account.status,200);assert.equal(account.data.recent.length,0);
  const orderId=new URL(created.data.checkoutUrl,'http://local').searchParams.get('order');
  db.prepare("UPDATE test_orders SET status='delivered',account_id='sample',expires_at=?,approved_at=? WHERE id=?").run(new Date(Date.now()+3600000).toISOString(),new Date().toISOString(),orderId);
  assert.equal((await call('/api/miniapp/me',alice)).data.active.id,orderId);
  const other=await call('/api/miniapp/me',bob);assert.equal(other.data.active,null);assert.equal(other.data.recent.length,0);
  assert.equal((await call('/api/miniapp/book',alice,'POST',{hours:1})).status,409);
  assert.equal((await call('/api/miniapp/extend',bob,'POST',{orderId})).status,404);
  assert.equal((await call('/api/miniapp/extend',alice,'POST',{orderId})).status,503);
  assert.equal((await call('/api/miniapp/me',alice)).data.active.extensionRequested,false);
  assert.equal(createWebOrder('Regular Customer','',1).order.chat_id,'web');
 }finally{if(server)await new Promise(resolve=>server.close(resolve));db.close();rmSync(dir,{recursive:true,force:true})}
});
