import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dir=await mkdtemp(path.join(os.tmpdir(),'flingroulette-v3-miniapp-'));
const port=44517,secret='111111:FAKE_TEST_TOKEN';
const server=spawn(process.execPath,['dist/index.js'],{cwd:path.resolve('server'),env:{...process.env,PORT:String(port),DB_PATH:path.join(dir,'v3-preview.db'),ADMIN_PASSWORD:'test-only-password-123',JWT_SECRET:'test-only-jwt-secret-of-more-than-32-characters',V3_PREVIEW:'true',SANDBOX_MODE:'true',PAYMENT_MODE:'mock',TELEGRAM_BOT_TOKEN:secret,TELEGRAM_TEST_BOT_USERNAME:'Booking_testfling_bot',MINI_APP_TEST_URL:'https://preview.example.test/miniapp',IMB_API_TOKEN:''},stdio:['ignore','ignore','pipe']});
let startupError='';server.stderr.on('data',chunk=>startupError+=String(chunk).slice(0,2000));
const base=`http://127.0.0.1:${port}/api/miniapp-test`;
function signed(userId,authDate=Math.floor(Date.now()/1000)){
 const fields=new URLSearchParams({auth_date:String(authDate),user:JSON.stringify({id:userId,first_name:'Sample'})});
 const value=[...fields.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
 const key=createHmac('sha256','WebAppData').update(secret).digest();
 fields.set('hash',createHmac('sha256',key).update(value).digest('hex'));
 return fields.toString();
}
async function call(endpoint,identity,body){return fetch(base+endpoint,{method:body?'POST':'GET',headers:{'X-Telegram-Init-Data':identity,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});}
try{
 let ready=false;
 for(let i=0;i<60;i++){
  if(server.exitCode!==null)throw new Error(`Preview failed to start: ${startupError}`);
  try{const response=await fetch(`http://127.0.0.1:${port}/api/health`);if(response.ok){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(ready,'Preview ready');
 const alice=signed(12001),bob=signed(12002);
 assert.equal((await call('/home','')).status,401,'Missing identity rejected');
 assert.equal((await call('/home',signed(12001,Math.floor(Date.now()/1000)-600))).status,401,'Expired identity rejected');
 assert.equal((await call('/home',alice.replace('12001','12002'))).status,401,'Tampering rejected');
 const initial=await call('/home',alice);assert.equal(initial.status,200);
 assert.equal((await initial.json()).orders.length,0);
 assert.equal((await call('/orders',alice,{hours:4})).status,400,'Unknown plan rejected');
 const booked=await call('/orders',alice,{hours:1});assert.equal(booked.status,201);
 const order=await booked.json();assert.match(order.id,/^BOT-/);
 assert.equal((await call('/orders',alice,{hours:1})).status,409,'Repeated booking blocked');
 const own=await (await call('/home',alice)).json();assert.equal(own.orders[0].id,order.id);
 const other=await (await call('/home',bob)).json();assert.equal(other.orders.length,0,'Customers cannot read each other’s history');
 console.log('Mini App integration: signed identity, expiry, booking, duplicate and history isolation passed.');
}finally{server.kill();await rm(dir,{recursive:true,force:true});}
