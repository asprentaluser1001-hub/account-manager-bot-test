import {useCallback,useEffect,useState} from 'react';
import './miniApp.css';

type Row={id:string;hours:number;amount:number;status:string;createdAt:string;expiresAt:string|null};
type Account={user:{id:string;name:string};available:boolean;prices:Record<string,number>;active:{id:string;hours:number;expiresAt:string;status:string;extensionRequested:boolean}|null;recent:Row[]};
type Tab='home'|'book'|'history'|'help';
type TelegramApp={initData:string;ready:()=>void;expand:()=>void;close:()=>void;openTelegramLink?:(url:string)=>void};
declare global {interface Window {Telegram?:{WebApp:TelegramApp}}}

function remaining(end:string,now:number){const total=Math.max(0,Math.floor((Date.parse(end)-now)/1000));return total?`${Math.floor(total/3600)?Math.floor(total/3600)+'h ':''}${String(Math.floor(total%3600/60)).padStart(2,'0')}m ${String(total%60).padStart(2,'0')}s`:'Ending soon';}
function duration(hours:number){return hours===168?'1 week':hours===720?'1 month':`${hours} hour${hours===1?'':'s'}`;}
function date(iso:string){return new Date(iso).toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'});}
function time(iso:string){return new Date(iso).toLocaleTimeString('en-IN',{hour:'numeric',minute:'2-digit',timeZone:'Asia/Kolkata'});}

export default function MiniApp(){
 const [data,setData]=useState<Account|null>(null),[tab,setTab]=useState<Tab>('home'),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[now,setNow]=useState(Date.now());
 const initData=window.Telegram?.WebApp?.initData||'';
 const load=useCallback(async()=>{
  if(!initData){setError('Open the Mini App from the FlingRoulette Telegram bot.');return;}
  try{const response=await fetch('/api/miniapp/me',{headers:{'X-Telegram-Init-Data':initData},cache:'no-store'});const body=await response.json();if(!response.ok)throw new Error(body.error||'Could not load your bookings');setData(body);setError('')}
  catch(e){setError(e instanceof Error?e.message:'Could not load your bookings')}
 },[initData]);
 useEffect(()=>{document.documentElement.classList.add('mini-app-page');window.Telegram?.WebApp?.ready();window.Telegram?.WebApp?.expand();void load();const tick=setInterval(()=>setNow(Date.now()),1000);const refresh=setInterval(()=>{if(!document.hidden)void load()},30_000);return()=>{document.documentElement.classList.remove('mini-app-page');clearInterval(tick);clearInterval(refresh)}},[load]);
 async function book(hours:number){if(busy)return;setBusy(true);setError('');try{
  const response=await fetch('/api/miniapp/book',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Init-Data':initData},body:JSON.stringify({hours})});const body=await response.json();if(!response.ok)throw new Error(body.error||'Could not open checkout');window.location.assign(body.checkoutUrl);
 }catch(e){setError(e instanceof Error?e.message:'Could not start booking')}finally{setBusy(false)}}
 async function requestExtension(){if(!data?.active||busy)return;setBusy(true);setError('');try{
  const response=await fetch('/api/miniapp/extend',{method:'POST',headers:{'Content-Type':'application/json','X-Telegram-Init-Data':initData},body:JSON.stringify({orderId:data.active.id})});const body=await response.json();if(!response.ok)throw new Error(body.error||'Could not request extension');setNotice('Request sent. Time is added only after the admin confirms the ₹50 payment.');await load();
 }catch(e){setError(e instanceof Error?e.message:'Could not request extension')}finally{setBusy(false)}}
 const active=data?.active,hasBooking=!!data?.recent.length,plans=Object.entries(data?.prices||{}).sort(([a],[b])=>Number(a)-Number(b));
 return <div className="mini-shell"><div className="mini-inner">
  <header className="mini-top"><button aria-label="Close" onClick={()=>window.Telegram?.WebApp?.close()} className="mini-close">×</button><span className="mini-logo">F</span><div><strong>FlingRoulette</strong><small>Your bookings</small></div><span className="mini-top-dot" aria-hidden="true">•••</span></header>
  {error&&<p className="mini-error" role="alert">{error}</p>}{notice&&<p className="mini-notice" role="status">{notice}</p>}
  {!data&&!error&&<p className="mini-loading">Loading your bookings…</p>}
  {data&&<>
   {tab==='home'&&<>
    <section className="mini-intro"><h1>Hello, {data.user.name.split(' ')[0]}</h1><p>Your access at a glance</p></section>
    {active?<article className="mini-feature"><div className="mini-feature-head"><h2>Current booking</h2><span className="mini-pill"><span/>Active</span></div><div className="mini-active"><div className="mini-clock" aria-hidden="true">◷</div><div><h3>{duration(active.hours)} access</h3><strong>{remaining(active.expiresAt,now)} left</strong><div className="mini-progress"><span/></div><p>Ends {date(active.expiresAt)} at {time(active.expiresAt)}</p></div></div>{active.status==='delivery_failed'?<p className="mini-hint">There is an access issue. Contact support before extending.</p>:<button className="mini-extend" disabled={busy||active.extensionRequested} onClick={requestExtension}>{active.extensionRequested?'Extension requested — awaiting payment check':'◷  Request +50 min · ₹50'} <span>›</span></button>}</article>
    :<article className="mini-feature mini-empty"><h2>Ready when you are</h2><p>Choose a plan to book your access. Time starts after confirmation.</p>{data.available?<button className="mini-primary" disabled={busy} onClick={()=>book(1)}>⚡  Book 1 hour · ₹{data.prices[1]||100} <span>›</span></button>:<p className="mini-hint">No accounts are available right now.</p>}</article>}
    {hasBooking&&<section className="mini-recent"><div className="mini-section-head"><h2>Recent bookings</h2><button onClick={()=>setTab('history')}>View all ›</button></div>{data.recent.slice(0,2).map(item=><HistoryRow key={item.id} item={item}/>)}</section>}
   </>}
   {tab==='book'&&<section className="mini-page"><h1>Choose access</h1><p>Pay through the existing checkout. Access starts after confirmation.</p>{active?<div className="mini-feature"><h2>Current booking is active</h2><p>Your next quick booking appears after this booking ends.</p></div>:plans.map(([hours,amount])=><button key={hours} className="mini-plan" disabled={busy||!data.available} onClick={()=>book(Number(hours))}><span>{duration(Number(hours))}</span><strong>₹{amount}</strong><span>›</span></button>)}</section>}
   {tab==='history'&&<section className="mini-page"><h1>Booking history</h1><p>Only bookings linked to your Telegram account appear here.</p>{data.recent.length?data.recent.map(item=><HistoryRow key={item.id} item={item}/>):<div className="mini-feature mini-empty"><h2>No bookings yet</h2><p>Once your first booking is confirmed, you’ll see it here.</p></div>}</section>}
   {tab==='help'&&<section className="mini-page"><h1>Need help?</h1><p>Contact the FlingRoulette bot for help with bookings or extensions.</p><div className="mini-feature"><h2>Payment and access</h2><p>A request does not add time. The admin confirms payment before extending your booking.</p><button className="mini-extend" onClick={()=>window.Telegram?.WebApp?.close()}>Return to bot <span>›</span></button></div></section>}
  </>}
 </div><nav className="mini-nav" aria-label="Mini App navigation">{(['home','book','history','help'] as const).map((item)=><button key={item} className={tab===item?'selected':''} onClick={()=>{setTab(item);setNotice('')}} aria-current={tab===item?'page':undefined}><span aria-hidden="true">{{home:'⌂',book:'▣',history:'◴',help:'?'}[item]}</span>{item[0].toUpperCase()+item.slice(1)}</button>)}</nav></div>;
}
function HistoryRow({item}:{item:Row}){return <article className="mini-history-row"><span className="mini-history-icon" aria-hidden="true">◷</span><div><strong>{duration(item.hours)} access</strong><small>{date(item.createdAt)} · {item.id}</small></div><span className="mini-history-state">{item.status==='expired'?'Completed':item.status==='cancelled'?'Cancelled':item.status==='delivery_failed'?'Needs help':item.status==='reset_failed'?'Reset pending':'Active'}</span><b>₹{item.amount}</b></article>}
