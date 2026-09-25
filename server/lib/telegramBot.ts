import {db} from '../db';
import {PRICES} from './testOrders';
import {approveOrder,availableAccounts,claimPayment,createOrder,getOrder,markDelivered,markDeliveryFailed,rejectOrder,TestOrder} from './testOrders';
const token=process.env.TELEGRAM_BOT_TOKEN||'';
const adminId=process.env.TELEGRAM_ADMIN_ID||'';
let active=false;
db.exec(`CREATE TABLE IF NOT EXISTS bot_visitors (chat_id TEXT PRIMARY KEY, welcomed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bot_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
function setting(key:string):string {return (db.prepare('SELECT value FROM bot_settings WHERE key=?').get(key) as {value:string}|undefined)?.value||'';}
function saveSetting(key:string,value:string){db.prepare('INSERT INTO bot_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
function duration(hours:number){return hours===168?'1 week (7 days)':hours===720?'1 month (30 days)':`${hours} hour${hours===1?'':'s'}`;}
function rateList(){return Object.entries(PRICES).map(([h,p])=>`${duration(Number(h))}: ₹${p}`).join('\n');}
function supportButton():{text:string;url?:string;callback_data?:string}{
 const username=setting('support_username');
 return username?{text:'Contact admin',url:`https://t.me/${username}`}:{text:'Contact admin',callback_data:'support'};
}
function menu(){return buttons([[{text:'Book now',callback_data:'book'}],[{text:'Check availability',callback_data:'availability'},supportButton()],[{text:'Rates & proofs',callback_data:'proofs'}]]);}
async function showAvailability(chatId:string){const n=availableAccounts().length;await say(chatId,n?`${n} sample ID${n===1?' is':'s are'} available now. Availability is checked again when the admin approves.`:'All IDs are currently busy. Please try later or contact admin.',menu());}
async function showPlans(chatId:string){
 if(!availableAccounts().length){await showAvailability(chatId);return;}
 await say(chatId,'Choose your duration. Time starts when the admin approves. This is a test; no payment is collected.',buttons(Object.entries(PRICES).map(([h,p])=>[{text:`${duration(Number(h))} · ₹${p}`,callback_data:`hours:${h}`}]).concat([[supportButton() as any]])));
}
async function showProofs(chatId:string){
 await say(chatId,`Rate list (test amounts)\n${rateList()}\nTime starts at approval.`,menu());
 const proofs=JSON.parse(setting('proofs')||'[]') as string[];
 for(const photo of proofs){await api('sendPhoto',{chat_id:chatId,photo,caption:'Screenshot supplied by the admin.',protect_content:true});}
 if(!proofs.length)await say(chatId,'Proof screenshots have not been added yet.');
}
async function api(method:string,body:Record<string,unknown>):Promise<any>{
 if(!token)throw new Error('No test bot token configured');
 const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const result=await response.json() as any;
 if(!response.ok||!result.ok)throw new Error(result.description||'Telegram unavailable');
 return result.result;
}
function buttons(buttons:Array<Array<{text:string;callback_data?:string;url?:string}>>){return {inline_keyboard:buttons}}
async function say(chatId:string,text:string,keyboard?:ReturnType<typeof buttons>){
 return api('sendMessage',{chat_id:chatId,text,reply_markup:keyboard,protect_content:true});
}
export async function sendAdminClaim(order:TestOrder){
 if(!token||!adminId)return false;
 try {await say(adminId,`TEST payment claim (no money verified)\nOrder ${order.id} · @${order.username.replace(/^@/,'')} · ${duration(order.hours)} · ₹${order.amount}\nChoose an account only after checking payment.`,buttons([[{text:'Show available accounts',callback_data:`stock:${order.id}`}],[{text:'Reject claim',callback_data:`reject:${order.id}`}]]));return true;}
 catch(e){console.error('[Bot] Admin alert failed',e);return false;}
}
export async function sendCustomerDelivery(order:TestOrder,email:string,password:string){
 if(!token)return false;
 try {await say(order.chat_id,`TEST ACCESS · ${order.id}\nLogin: ${email}\nPassword: ${password}\nEnds: ${order.expires_at}\nOnly sample credentials are used in this sandbox.`);return true;}
 catch(e){console.error('[Bot] Customer delivery failed',e);return false;}
}
async function handleMessage(m:any){
 if(m.chat?.type!=='private')return;
 const chatId=String(m.chat.id), text=String(m.text||'');
 if(chatId===adminId){
  if(m.photo?.length && m.caption==='/proof'){
   const proofs=JSON.parse(setting('proofs')||'[]') as string[];
   if(proofs.length>=5){await say(chatId,'Maximum 5 screenshots. Use /clearproofs to replace them.');return;}
   proofs.push(m.photo[m.photo.length-1].file_id);saveSetting('proofs',JSON.stringify(proofs));
   await say(chatId,'Proof screenshot saved. New customers will receive it on their first visit.');return;
  }
  if(text==='/clearproofs'){saveSetting('proofs','[]');await say(chatId,'Proof screenshots cleared.');return;}
  if(text.startsWith('/supportuser ')){
   const username=text.slice(13).trim().replace(/^@/,'');
   if(!/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(username)){await say(chatId,'Send /supportuser followed by your Telegram username.');return;}
   saveSetting('support_username',username);await say(chatId,`Support button now opens @${username}.`);return;
  }
  if(/^\/stock(?:@\w+)?$/.test(text)){
   const available=availableAccounts();await say(chatId,available.length?`Available sample IDs: ${available.map(a=>a.name).join(', ')}`:'No sample IDs available.');return;
  }
 }
 if(/^\/id(?:@\w+)?$/.test(text)){await say(chatId,`Your Telegram numeric ID: ${chatId}`);return;}
 if(text.startsWith('/support')){await say(chatId,'Contact the admin using the button below.',buttons([[supportButton()]]));return;}
 if(text.startsWith('/start')){
  const seen=db.prepare('SELECT chat_id FROM bot_visitors WHERE chat_id=?').get(chatId);
  if(!seen){await showProofs(chatId);db.prepare('INSERT OR IGNORE INTO bot_visitors VALUES (?,?)').run(chatId,new Date().toISOString());}
  await showAvailability(chatId);
 }

}
async function handleCallback(c:any){
 if(c.message?.chat?.type!=='private'||String(c.message.chat.id)!==String(c.from?.id))return;
 const chatId=String(c.message?.chat?.id||c.from?.id), data=String(c.data||'');
 try {
  if(data==='book'){await showPlans(chatId);
  } else if(data==='availability'){await showAvailability(chatId);
  } else if(data==='proofs'){await showProofs(chatId);
  } else if(data==='support'){
   await say(chatId,'The admin has not set a support username yet. Please try again later.');
  } else if(data.startsWith('hours:')){
   const order=createOrder(chatId,String(c.from?.username||c.from?.first_name||'customer'),Number(data.slice(6)));
   await say(chatId,`TEST ORDER ${order.id}\n${duration(order.hours)} · ₹${order.amount}\nNo payment is collected in this test. Tap below to simulate a payment claim.`,buttons([[{text:'Simulate payment claim',callback_data:`claim:${order.id}`}]]));
  } else if(data.startsWith('claim:')){
   const order=claimPayment(data.slice(6),chatId);await say(chatId,`Claim received for ${order.id}. The admin will review it.`);await sendAdminClaim(order);
  } else if(chatId===adminId && data.startsWith('stock:')){
   const id=data.slice(6),order=getOrder(id);if(!order||order.status!=='payment_claimed')throw new Error('Order is no longer awaiting approval');
   const options=availableAccounts();await say(adminId,options.length?`Select a sample account for ${id}:`:'No sample accounts available.',buttons(options.map(a=>[{text:a.name,callback_data:`approve:${id}:${a.id}`}])));
  } else if(chatId===adminId && data.startsWith('approve:')){
   const [,id,accountId]=data.split(':');const details=approveOrder(id,accountId);const delivered=await sendCustomerDelivery(details.order,details.email,details.password);
   if(delivered)markDelivered(id);else markDeliveryFailed(id,'Telegram delivery failed; account remains reserved.');
   await say(adminId,delivered?`${id} approved and delivered. Reset scheduled for ${details.order.expires_at}.`:`${id} approved but delivery failed. Account remains reserved; check the dashboard.`);
  } else if(chatId===adminId && data.startsWith('reject:')){
   rejectOrder(data.slice(7));await say(adminId,'Test payment claim rejected.');
  }
 }catch(e){await say(chatId,`Could not complete: ${e instanceof Error?e.message:'unknown error'}`);}
 finally{await api('answerCallbackQuery',{callback_query_id:c.id}).catch(()=>{});}
}
export function startTestBot(){
 if(!token){console.log('[Bot] Set TELEGRAM_BOT_TOKEN to enable the test bot.');return;}
 if(!adminId)console.log('[Bot] Send /id to the bot, then set TELEGRAM_ADMIN_ID and restart before trying approvals.');
 if(process.env.SANDBOX_MODE!=='true')throw new Error('This bot runs only in SANDBOX_MODE.');
 active=true;let offset=0;
 (async()=>{while(active){try{const updates=await api('getUpdates',{offset,timeout:20,allowed_updates:['message','callback_query']}) as any[];
  for(const u of updates){offset=Math.max(offset,u.update_id+1);try{if(u.message)await handleMessage(u.message);if(u.callback_query)await handleCallback(u.callback_query);}catch(e){console.error('[Bot] Update error',e);}}
 }catch(e){console.error('[Bot] Polling error',e);await new Promise(r=>setTimeout(r,3000));}}})();
}
