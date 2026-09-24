import {approveOrder,availableAccounts,claimPayment,createOrder,getOrder,markDelivered,markDeliveryFailed,rejectOrder,TestOrder} from './testOrders';
const token=process.env.TELEGRAM_BOT_TOKEN||'';
const adminId=process.env.TELEGRAM_ADMIN_ID||'';
let active=false;
async function api(method:string,body:Record<string,unknown>):Promise<any>{
 if(!token)throw new Error('No test bot token configured');
 const response=await fetch(`https://api.telegram.org/bot${token}/${method}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
 const result=await response.json() as any;
 if(!response.ok||!result.ok)throw new Error(result.description||'Telegram unavailable');
 return result.result;
}
function buttons(buttons:Array<Array<{text:string;callback_data:string}>>){return {inline_keyboard:buttons}}
async function say(chatId:string,text:string,keyboard?:ReturnType<typeof buttons>){
 return api('sendMessage',{chat_id:chatId,text,reply_markup:keyboard,protect_content:true});
}
export async function sendAdminClaim(order:TestOrder){
 if(!token||!adminId)return false;
 try {await say(adminId,`TEST payment claim (no money verified)\nOrder ${order.id} · @${order.username.replace(/^@/,'')} · ${order.hours}h · ₹${order.amount}\nChoose an account only after checking payment.`,buttons([[{text:'Show available accounts',callback_data:`stock:${order.id}`}],[{text:'Reject claim',callback_data:`reject:${order.id}`}]]));return true;}
 catch(e){console.error('[Bot] Admin alert failed',e);return false;}
}
export async function sendCustomerDelivery(order:TestOrder,email:string,password:string){
 if(!token)return false;
 try {await say(order.chat_id,`TEST ACCESS · ${order.id}\nLogin: ${email}\nPassword: ${password}\nEnds: ${order.expires_at}\nOnly sample credentials are used in this sandbox.`);return true;}
 catch(e){console.error('[Bot] Customer delivery failed',e);return false;}
}
async function handleMessage(m:any){
 const chatId=String(m.chat.id),username=String(m.from?.username||m.from?.first_name||'customer');
 if(chatId===adminId && /^\/stock(?:@\w+)?$/.test(m.text||'')){
  const available=availableAccounts();await say(chatId,available.length?`Available sample IDs: ${available.map(a=>a.name).join(', ')}`:'No sample IDs available.');return;
 }
 if(m.text?.startsWith('/id')){await say(chatId,`Your Telegram numeric ID: ${chatId}`);return;}
 if(m.text?.startsWith('/start')){
  await say(chatId,'Test booking · Choose 1, 2 or 3 hours. Payments are simulated; no QR or money is collected.',buttons([[1,2,3].map(h=>({text:`${h} hour${h>1?'s':''}`,callback_data:`hours:${h}`}))]));
 }
}
async function handleCallback(c:any){
 const chatId=String(c.message?.chat?.id||c.from?.id), data=String(c.data||'');
 try {
  if(data.startsWith('hours:')){
   const order=createOrder(chatId,String(c.from?.username||c.from?.first_name||'customer'),Number(data.slice(6)));
   await say(chatId,`TEST ORDER ${order.id}\n${order.hours}h · ₹${order.amount}\nNo payment is collected in this test. Tap below to simulate a payment claim.`,buttons([[{text:'Simulate payment claim',callback_data:`claim:${order.id}`}]]));
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
