import {createHmac,timingSafeEqual} from 'crypto';
import {Router,json} from 'express';
import {db} from '../db';
import {availableAccounts,createOrder,PRICES,TestOrder} from '../lib/testOrders';

export const miniAppTestRouter=Router();
miniAppTestRouter.use((req,res,next)=>{
 if(process.env.V3_PREVIEW!=='true'||process.env.SANDBOX_MODE!=='true'||process.env.PAYMENT_MODE!=='mock'||!process.env.MINI_APP_TEST_URL||process.env.IMB_API_TOKEN?.trim())return res.status(404).json({error:'Unavailable'});
 res.setHeader('Cache-Control','no-store');next();
});
miniAppTestRouter.use(json({limit:'4kb'}));
miniAppTestRouter.use((req,res,next)=>{
 const data=req.get('X-Telegram-Init-Data')||'';
 const token=process.env.TELEGRAM_BOT_TOKEN||'';
 if(!token||!data||data.length>4096)return res.status(401).json({error:'Open this test from the Telegram bot.'});
 try{
  const params=new URLSearchParams(data),entries=[...params.entries()];
  if(new Set(entries.map(([key])=>key)).size!==entries.length)throw new Error('Duplicate fields');
  const hash=params.get('hash')||'',authDate=Number(params.get('auth_date'));
  if(!/^[a-f0-9]{64}$/i.test(hash)||!Number.isSafeInteger(authDate)||Math.abs(Date.now()/1000-authDate)>300)throw new Error('Expired identity');
  const signed=entries.filter(([key])=>key!=='hash'&&key!=='signature').sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('\n');
  const secret=createHmac('sha256','WebAppData').update(token).digest();
  const expected=createHmac('sha256',secret).update(signed).digest();
  if(!timingSafeEqual(expected,Buffer.from(hash,'hex')))throw new Error('Invalid signature');
  const user=JSON.parse(params.get('user')||'null') as {id?:number;first_name?:string;username?:string}|null;
  if(!user||!Number.isSafeInteger(user.id)||Number(user.id)<=0)throw new Error('Missing Telegram user');
  res.locals.telegramUser={id:String(user.id),name:String(user.first_name||user.username||'Customer').slice(0,64)};
  next();
 }catch{return res.status(401).json({error:'Telegram session expired. Close and reopen the test app.'});}
});

function customerOrders(id:string){
 return (db.prepare("SELECT id,hours,amount,status,created_at,expires_at FROM test_orders WHERE chat_id=? AND source='telegram' AND history_hidden=0 ORDER BY created_at DESC LIMIT 20").all(id) as Pick<TestOrder,'id'|'hours'|'amount'|'status'|'created_at'|'expires_at'>[]);
}
miniAppTestRouter.get('/home',(_req,res)=>{
 const user=res.locals.telegramUser as {id:string;name:string};
 return res.json({name:user.name,available:availableAccounts().length>0,plans:Object.entries(PRICES).map(([hours,amount])=>({hours:Number(hours),amount})),orders:customerOrders(user.id),sampleOnly:true});
});
miniAppTestRouter.post('/orders',(req,res)=>{
 const user=res.locals.telegramUser as {id:string;name:string},hours=req.body?.hours;
 if(!Number.isInteger(hours)||!PRICES[hours])return res.status(400).json({error:'Choose a valid plan.'});
 const active=db.prepare("SELECT id FROM test_orders WHERE chat_id=? AND source='telegram' AND status='awaiting_payment_claim' AND created_at>? ORDER BY created_at DESC LIMIT 1").get(user.id,new Date(Date.now()-3600000).toISOString()) as {id:string}|undefined;
 if(active)return res.status(409).json({error:'You already have a sample booking waiting in the test dashboard.'});
 const count=db.prepare("SELECT COUNT(*) AS n FROM test_orders WHERE chat_id=? AND created_at>?").get(user.id,new Date(Date.now()-3600000).toISOString()) as {n:number};
 if(count.n>=5)return res.status(429).json({error:'Please try again later.'});
 try{
  const order=createOrder(user.id,user.name,hours);
  return res.status(201).json({id:order.id,hours:order.hours,amount:order.amount,status:order.status});
 }catch(e){return res.status(400).json({error:e instanceof Error?e.message:'Could not create sample booking.'});}
});
