import {useEffect,useState} from 'react';

type Order={id:string;hours:number;amount:number;status:string;created_at:string;expires_at:string|null};
type Home={name:string;available:boolean;plans:Array<{hours:number;amount:number}>;orders:Order[];sampleOnly:true};
type TelegramWebApp={initData:string;ready:()=>void;expand:()=>void};
const telegram=()=>((window as Window & {Telegram?:{WebApp?:TelegramWebApp}}).Telegram?.WebApp);
const label=(hours:number)=>hours===168?'1 week':hours===720?'1 month':`${hours} hour${hours===1?'':'s'}`;

export default function MiniAppTest(){
 const [home,setHome]=useState<Home|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[selected,setSelected]=useState(1);
 async function request(path:string,options?:RequestInit){
  const initData=telegram()?.initData;
  if(!initData)throw new Error('Open this test from @Booking_testfling_bot in Telegram.');
  const response=await fetch(`/api/miniapp-test${path}`,{...options,headers:{...options?.headers,'X-Telegram-Init-Data':initData,'Content-Type':'application/json'},cache:'no-store'});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'Could not load test app.');
  return result;
 }
 useEffect(()=>{
  telegram()?.ready();telegram()?.expand();
  request('/home').then(setHome).catch(e=>setError(e instanceof Error?e.message:'Could not load test app.'));
 },[]);
 async function book(hours:number){
  if(busy)return;setBusy(true);setError('');
  try{await request('/orders',{method:'POST',body:JSON.stringify({hours})});setHome(await request('/home'));}
  catch(e){setError(e instanceof Error?e.message:'Could not create sample booking.');}
  finally{setBusy(false);}
 }
 const existing=!!home?.orders.length;
 return <main className="miniapp-shell">
  <div className="miniapp-inner">
   <header className="miniapp-top"><span className="miniapp-logo">F</span><div><strong>FlingRoulette</strong><small>Customer test app</small></div><span className="miniapp-test">TEST</span></header>
   <section className="miniapp-hero"><span className="miniapp-eyebrow">WELCOME{home?`, ${home.name.toUpperCase()}`:''}</span><h1>Book your time,<br/>beautifully simple.</h1><p>Try the booking experience inside Telegram. Sample bookings only; no payment is collected.</p></section>
   {error&&<p className="miniapp-error" role="alert">{error}</p>}
   {!home&&!error&&<p className="miniapp-muted">Opening test app…</p>}
   {home&&<>
    <div className="miniapp-availability"><span className={home.available?'miniapp-dot':'miniapp-dot unavailable'}/>{home.available?'Sample access available':'No sample access available'}</div>
    {existing&&<button className="miniapp-quick" disabled={busy||!home.available} onClick={()=>book(1)}><span>⚡ Quick 1-hour booking</span><strong>₹{home.plans.find(p=>p.hours===1)?.amount}</strong></button>}
    <section className="miniapp-section"><h2>Choose a plan</h2><div className="miniapp-plans">{home.plans.map(plan=><button key={plan.hours} onClick={()=>setSelected(plan.hours)} className={selected===plan.hours?'chosen':''}><span>{label(plan.hours)}</span><strong>₹{plan.amount}</strong></button>)}</div><button className="miniapp-primary" disabled={busy||!home.available} onClick={()=>book(selected)}>{busy?'Creating sample booking…':'Create sample booking'}</button></section>
    {existing&&<section className="miniapp-section"><h2>Your booking history</h2>{home.orders.map(order=><article className="miniapp-order" key={order.id}><div><strong>{label(order.hours)} · ₹{order.amount}</strong><small>{order.id} · {new Date(order.created_at).toLocaleDateString()}</small></div><span>{order.status.replace(/_/g,' ')}</span></article>)}</section>}
    <p className="miniapp-footnote">Test data only. This screen cannot accept payments or reveal account credentials.</p>
   </>}
  </div>
 </main>;
}
