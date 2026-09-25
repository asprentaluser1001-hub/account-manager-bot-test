import {db} from '../db';
import {PRICES} from './testOrders';
import {approveOrder,availableAccounts,claimPayment,createOrder,getOrder,markDelivered,markDeliveryFailed,rejectOrder,TestOrder} from './testOrders';
const token=process.env.TELEGRAM_BOT_TOKEN||'';
const adminId=process.env.TELEGRAM_ADMIN_ID||'';
const checkoutUrl=process.env.PUBLIC_CHECKOUT_URL||'';
const sandboxMode=process.env.SANDBOX_MODE==='true';
let active=false;
db.exec(`CREATE TABLE IF NOT EXISTS bot_visitors (chat_id TEXT PRIMARY KEY, welcomed_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bot_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS proof_media (id INTEGER PRIMARY KEY AUTOINCREMENT, file_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('photo','video')), created_at TEXT NOT NULL);`);
export function setting(key:string):string {return (db.prepare('SELECT value FROM bot_settings WHERE key=?').get(key) as {value:string}|undefined)?.value||'';}
export function saveSetting(key:string,value:string){db.prepare('INSERT INTO bot_settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,value);}
export type ProofMedia={id:number;fileId:string;kind:'photo'|'video'};
// Migrate screenshots saved by earlier test versions exactly once.
const oldProofs=setting('proofs');
if(oldProofs){
 const old=JSON.parse(oldProofs) as string[];
 for(const fileId of old)db.prepare('INSERT INTO proof_media(file_id,kind,created_at) VALUES (?,?,?)').run(fileId,'photo',new Date().toISOString());
 db.prepare("DELETE FROM bot_settings WHERE key='proofs'").run();
}
export function proofList():ProofMedia[]{return (db.prepare('SELECT id,file_id AS fileId,kind FROM proof_media ORDER BY id').all() as ProofMedia[]);}
export function addProof(fileId:string,kind:'photo'|'video'){
 db.prepare('INSERT INTO proof_media(file_id,kind,created_at) VALUES (?,?,?)').run(fileId,kind,new Date().toISOString());
}
export function removeProof(id:number){return db.prepare('DELETE FROM proof_media WHERE id=?').run(id).changes>0;}
export function clearProofs(){db.prepare('DELETE FROM proof_media').run();}
function duration(hours:number){return hours===168?'1 week (7 days)':hours===720?'1 month (30 days)':`${hours} hour${hours===1?'':'s'}`;}
function rateList(){return Object.entries(PRICES).map(([h,p])=>`${duration(Number(h))}: ₹${p}`).join('\n');}
function supportButton():{text:string;url?:string;callback_data?:string}{
 const username=setting('support_username');
 return username?{text:'Contact admin',url:`https://t.me/${username}`}:{text:'Contact admin',callback_data:'support'};
}
function menu(){return buttons([[{text:'Book now',callback_data:'book'}],[{text:'Check availability',callback_data:'availability'},supportButton()],[{text:'Rates & proofs',callback_data:'proofs'}]]);}
const homeButton={text:'🏠 Home',callback_data:'home'};
async function showAvailability(chatId:string,messageId?:number){
 const text=welcomeText();
 if(messageId){
  try{await api('editMessageText',{chat_id:chatId,message_id:messageId,text,reply_markup:menu()});}
  catch(e){if(!(e instanceof Error && e.message.includes('message is not modified')))throw e;}
 }else await say(chatId,text,menu());
}
async function showPlans(chatId:string){
 if(!availableAccounts().length){await showAvailability(chatId);return;}
 await say(chatId,`Choose your duration. Time starts when the admin approves. ${sandboxMode?'This is a test; no payment is collected.':'Payment is verified manually before access is sent.'}`,buttons(Object.entries(PRICES).map(([h,p])=>[{text:`${duration(Number(h))} · ₹${p}`,callback_data:`hours:${h}`}]).concat([[supportButton() as any],[homeButton]])));
}
function availabilityText(){
 const n=availableAccounts().length;
 return n?'Available — you can book now.':'Currently unavailable — please try later.';
}
async function sendProofPhotos(chatId:string){
 const proofs=proofList();
 for(let index=0;index<proofs.length;index+=10){
  const group=proofs.slice(index,index+10);
  if(group.length===1){
   const item=group[0];await api(item.kind==='video'?'sendVideo':'sendPhoto',{chat_id:chatId,[item.kind==='video'?'video':'photo']:item.fileId,protect_content:true});
  }else await api('sendMediaGroup',{chat_id:chatId,media:group.map(({kind,fileId})=>({type:kind,media:fileId})),protect_content:true});
 }
 return proofs.length;
}
async function showProofs(chatId:string){
 const count=await sendProofPhotos(chatId);
 await say(chatId,`Rates\n\n${rateList()}\n\n${count?'':'No proof screenshots added yet.\n'}${sandboxMode?'Test only · No payment collected.':'Payment is verified by the admin before access is sent.'}`,buttons([[homeButton]]));
}
function welcomeText(){return `Welcome!\n\n${availabilityText()}\n\n${rateList()}\n\nTime starts at approval.\n${sandboxMode?'Test only · No payment collected.':'Payment is verified by the admin before access is sent.'}`;}
async function showWelcome(chatId:string,firstVisit:boolean){
 if(firstVisit)await sendProofPhotos(chatId);
 await say(chatId,welcomeText(),menu());
}
export async function uploadProof(dataUrl:string):Promise<void>{
 if(!token||!adminId)throw new Error('Configure the Telegram bot and admin ID first.');
 const match=/^data:(image\/(?:png|jpeg|webp)|video\/mp4);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
 if(!match)throw new Error('Choose a PNG, JPEG, WebP or MP4 file.');
 const mime=match[1],kind=mime==='video/mp4'?'video':'photo',bytes=Buffer.from(match[2],'base64');
 const limit=kind==='video'?15*1024*1024:3*1024*1024;
 if(bytes.length>limit||bytes.length<12)throw new Error(kind==='video'?'Video must be under 15 MB.':'Image must be under 3 MB.');
 const valid=mime==='image/png'?bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):mime==='image/jpeg'?bytes[0]===255&&bytes[1]===216:mime==='image/webp'?bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP':bytes.toString('ascii',4,8)==='ftyp';
 if(!valid)throw new Error('The file does not match its format.');
 const form=new FormData();
 form.set('chat_id',adminId);form.set('caption','Proof uploaded from your admin panel.');form.set('protect_content','true');
 form.set(kind,new Blob([new Uint8Array(bytes)],{type:mime}),kind==='video'?'proof.mp4':`proof.${mime.slice(6)}`);
 const response=await fetch(`https://api.telegram.org/bot${token}/${kind==='video'?'sendVideo':'sendPhoto'}`,{method:'POST',body:form});
 const result=await response.json() as any;
 if(!response.ok||!result.ok)throw new Error('Telegram could not save the file. Check bot connection and try again.');
 const fileId=kind==='video'?result.result?.video?.file_id:result.result?.photo?.at(-1)?.file_id;
 if(!fileId)throw new Error('Telegram did not return a file ID.');
 addProof(fileId,kind);
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
 const customer=order.source==='web'?order.username:`@${order.username.replace(/^@/,'')}`;
 try {await say(adminId,`${sandboxMode?'TEST ':''}Payment claim\nOrder ${order.id} · ${customer} · ${duration(order.hours)} · ₹${order.amount}\nCheck the proof in the Approvals tab before delivering access.`,buttons([[{text:'Show available accounts',callback_data:`stock:${order.id}`}],[{text:'Reject claim',callback_data:`reject:${order.id}`}],[homeButton]]));return true;}
 catch(e){console.error('[Bot] Admin alert failed',e);return false;}
}
export async function sendCustomerDelivery(order:TestOrder,email:string,password:string){
 if(!token)return false;
 try {await say(order.chat_id,`TEST ACCESS · ${order.id}\nLogin: ${email}\nPassword: ${password}\nEnds: ${order.expires_at}\nOnly sample credentials are used in this sandbox.`,buttons([[homeButton]]));return true;}
 catch(e){console.error('[Bot] Customer delivery failed',e);return false;}
}
async function handleMessage(m:any){
 if(m.chat?.type!=='private')return;
 const chatId=String(m.chat.id), text=String(m.text||'');
 if(chatId===adminId){
  if((m.photo?.length||m.video) && m.caption==='/proof'){
   addProof(m.video?.file_id||m.photo[m.photo.length-1].file_id,m.video?'video':'photo');
   await say(chatId,'Proof saved. Customers can view it in Rates & proofs.');return;
  }
  if(text==='/clearproofs'){clearProofs();await say(chatId,'Proofs cleared.');return;}
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
 if(text.startsWith('/support')){await say(chatId,'Contact the admin using the button below.',buttons([[supportButton()],[homeButton]]));return;}
 if(/^\/(start|home|menu)(?:@\w+)?(?:\s.*)?$/.test(text)||text==='🏠 Home'){
  const seen=db.prepare('SELECT chat_id FROM bot_visitors WHERE chat_id=?').get(chatId);
  await showWelcome(chatId,!seen);
  if(!seen)db.prepare('INSERT OR IGNORE INTO bot_visitors VALUES (?,?)').run(chatId,new Date().toISOString());
 }

}
async function handleCallback(c:any){
 if(c.message?.chat?.type!=='private'||String(c.message.chat.id)!==String(c.from?.id))return;
 const chatId=String(c.message?.chat?.id||c.from?.id), data=String(c.data||'');
 const availabilityMessage=data==='availability'?availabilityText():'';
 await api('answerCallbackQuery',{callback_query_id:c.id,...(availabilityMessage?{text:availabilityMessage,show_alert:true}:{})}).catch(()=>{});
 try {
  if(data==='home'){await showWelcome(chatId,false);
  } else if(data==='book'){await showPlans(chatId);
  } else if(data==='availability'){await showAvailability(chatId,c.message.message_id);
  } else if(data==='proofs'){await showProofs(chatId);
  } else if(data==='support'){
   await say(chatId,'The admin has not set a support username yet. Please try again later.',buttons([[homeButton]]));
  } else if(data.startsWith('hours:')){
   const hours=Number(data.slice(6));
   if(checkoutUrl){
    const order=createOrder(chatId,String(c.from?.username||c.from?.first_name||'customer'),hours);
    const link=new URL(checkoutUrl);link.searchParams.set('hours',String(hours));link.searchParams.set('order',order.id);link.searchParams.set('token',String(order.access_token||''));link.searchParams.set('amount',String(order.amount));
    await say(chatId,`Open the payment page for ${duration(hours)}. The QR download is available there.`,buttons([[{text:'Open payment page',url:link.toString()}],[homeButton]]));
   }else{
    const order=createOrder(chatId,String(c.from?.username||c.from?.first_name||'customer'),hours);
    await say(chatId,`TEST ORDER ${order.id}\n${duration(order.hours)} · ₹${order.amount}\nNo payment is collected in this test. Tap below to simulate a payment claim.`,buttons([[{text:'Simulate payment claim',callback_data:`claim:${order.id}`}],[homeButton]]));
   }
  } else if(data.startsWith('claim:')){
   const order=claimPayment(data.slice(6),chatId);await say(chatId,`Claim received for ${order.id}. The admin will review it.`,buttons([[homeButton]]));await sendAdminClaim(order);
  } else if(chatId===adminId && data.startsWith('stock:')){
   const id=data.slice(6),order=getOrder(id);if(!order||order.status!=='payment_claimed')throw new Error('Order is no longer awaiting approval');
   const options=availableAccounts();await say(adminId,options.length?`Select an account for ${id}:`:'No accounts available.',buttons(options.map(a=>[{text:a.name,callback_data:`approve:${id}:${a.id}`}])));
  } else if(chatId===adminId && data.startsWith('approve:')){
   const [,id,accountId]=data.split(':');const details=approveOrder(id,accountId);
   if(details.order.source==='web'){
    markDelivered(id);await say(adminId,`${id} approved. The customer's checkout page now shows the account. Reset scheduled for ${details.order.expires_at}.`);
   }else{
    const delivered=await sendCustomerDelivery(details.order,details.email,details.password);
    if(delivered)markDelivered(id);else markDeliveryFailed(id,'Telegram delivery failed; account remains reserved.');
    await say(adminId,delivered?`${id} approved and delivered. Reset scheduled for ${details.order.expires_at}.`:`${id} approved but delivery failed. Account remains reserved; check the dashboard.`);
   }
  } else if(chatId===adminId && data.startsWith('reject:')){
   rejectOrder(data.slice(7));await say(adminId,'Payment claim rejected.');
  }
 }catch(e){await say(chatId,`Could not complete: ${e instanceof Error?e.message:'unknown error'}`);}

}
export function startTestBot(){
 if(!token){console.log('[Bot] Set TELEGRAM_BOT_TOKEN to enable the test bot.');return;}
 if(!adminId)console.log('[Bot] Send /id to the bot, then set TELEGRAM_ADMIN_ID and restart before trying approvals.');
 api('setMyCommands',{commands:[{command:'start',description:'Open booking menu'},{command:'home',description:'Return to home'},{command:'support',description:'Contact admin'}]}).catch(e=>console.error('[Bot] Could not set commands',e));
 api('setChatMenuButton',{menu_button:{type:'commands'}}).catch(e=>console.error('[Bot] Could not set menu button',e));
 active=true;let offset=0;
 (async()=>{while(active){try{const updates=await api('getUpdates',{offset,timeout:20,allowed_updates:['message','callback_query']}) as any[];
  for(const u of updates){offset=Math.max(offset,u.update_id+1);try{if(u.message)await handleMessage(u.message);if(u.callback_query)await handleCallback(u.callback_query);}catch(e){console.error('[Bot] Update error',e);}}
 }catch(e){console.error('[Bot] Polling error',e);await new Promise(r=>setTimeout(r,3000));}}})();
}
