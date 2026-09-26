import {useEffect,useMemo,useState} from 'react';

type Plan={hours:number;amount:number};
type Config={brand:string;support:string;plans:Plan[];available:boolean;gatewayEnabled:boolean};
type SavedOrder={orderId:string;accessToken:string;amount:number;hours:number};
type OrderStatus={id:string;username:string;hours:number;amount:number;status:string;created_at:string;claimed_at:string|null;approved_at:string|null;expires_at:string|null;error:string|null;payment_url?:string;phonepe_link?:string;paytm_link?:string;bhim_link?:string;credentials:null|{email:string;password:string}};

const ORDER_KEY='flingroulette_checkout_order';
const duration=(hours:number)=>hours===168?'1 week':hours===720?'1 month':`${hours} hour${hours===1?'':'s'}`;
function linkedOrder():SavedOrder|null{
 const query=new URLSearchParams(window.location.search),orderId=query.get('order')||'',accessToken=query.get('token')||'',amount=Number(query.get('amount')),hours=Number(query.get('hours'));
 return orderId&&accessToken&&Number.isFinite(amount)&&amount>0&&[1,2,3,168,720].includes(hours)?{orderId,accessToken,amount,hours}:null;
}

export default function Checkout(){
 const [config,setConfig]=useState<Config|null>(null),[selected,setSelected]=useState<number>(()=>{const value=Number(new URLSearchParams(window.location.search).get('hours'));return [1,2,3,168,720].includes(value)?value:1}),[name,setName]=useState('');
 const [saved,setSaved]=useState<SavedOrder|null>(()=>{const linked=linkedOrder();if(linked)return linked;if(new URLSearchParams(window.location.search).get('new')==='1')return null;try{return JSON.parse(sessionStorage.getItem(ORDER_KEY)||'null')}catch{return null}});
 const [order,setOrder]=useState<OrderStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState('');
 useEffect(()=>{fetch('/api/checkout/config').then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);setConfig(d);if(d.plans?.length&&!d.plans.some((p:Plan)=>p.hours===selected))setSelected(d.plans[0].hours)}).catch(()=>setError('Checkout is temporarily unavailable. Please try again.'))},[]);
 useEffect(()=>{const linked=linkedOrder();if(!linked&&new URLSearchParams(window.location.search).get('new')==='1'){sessionStorage.removeItem(ORDER_KEY);window.history.replaceState({},'',window.location.pathname)}if(linked){sessionStorage.setItem(ORDER_KEY,JSON.stringify(linked));window.history.replaceState({},'',window.location.pathname)}},[]);
 useEffect(()=>{if(!saved)return;let active=true;const load=async()=>{try{const r=await fetch(`/api/checkout/orders/${saved.orderId}?token=${encodeURIComponent(saved.accessToken)}`);const d=await r.json();if(!r.ok)throw new Error(d.error);if(active)setOrder(d)}catch(e){if(active)setError(e instanceof Error?e.message:'Could not check order')}};load();const timer=setInterval(load,8000);return()=>{active=false;clearInterval(timer)}},[saved]);
 const plan=useMemo(()=>config?.plans.find(p=>p.hours===selected),[config,selected]);
 async function createOrder(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{const r=await fetch('/api/checkout/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,hours:selected})});const d=await r.json();if(!r.ok)throw new Error(d.error);if(!d.payment_url)throw new Error('IMB did not return a payment link. Please contact support.');const next={orderId:d.orderId,accessToken:d.accessToken,amount:d.amount,hours:selected};sessionStorage.setItem(ORDER_KEY,JSON.stringify(next));setSaved(next);if(d.payment_url)window.location.assign(d.payment_url)}catch(e){setError(e instanceof Error?e.message:'Could not create order')}finally{setBusy(false)}}
 function startOver(){sessionStorage.removeItem(ORDER_KEY);setSaved(null);setOrder(null);setError('')}
 async function copy(value:string,key:string){await navigator.clipboard.writeText(value);setCopied(key);setTimeout(()=>setCopied(''),1200)}
 if(!config)return <div className="checkout-shell"><div className="checkout-card text-center"><p className="checkout-muted">{error||'Opening secure checkout…'}</p></div></div>;
 const waiting=order?.status==='payment_claimed';
 const approved=!!order?.credentials&&['approved','delivered','delivery_failed'].includes(order.status);
 const rejected=order?.status==='rejected';
 return <div className="checkout-shell">
  <header className="checkout-header"><a href="/checkout" className="checkout-brand"><span>FR</span>{config.brand}</a><div className="checkout-secure">Secure order</div></header>
  <main className="checkout-main">
   <section className="checkout-intro"><p className="checkout-kicker">PRIVATE ACCESS</p><h1>Choose your access time</h1><p>Pick a plan, scan the IMB payment QR, and receive access after payment verification.</p></section>
   {error&&<div className="checkout-alert error" role="alert">{error}</div>}
   {!saved&&<>
    <div className={`availability ${config.available?'available':'unavailable'}`}><span></span>{config.available?'Access is available now':'Currently unavailable'}</div>
    <div className="plan-grid">{config.plans.map(item=><button key={item.hours} onClick={()=>setSelected(item.hours)} className={`plan-card ${selected===item.hours?'selected':''}`}><span>{duration(item.hours)}</span><strong>₹{item.amount}</strong>{selected===item.hours&&<em>Selected</em>}</button>)}</div>
    <form onSubmit={createOrder} className="checkout-card checkout-form">
     <div><label>Your name</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Name" required minLength={2} maxLength={64}/></div>
     <div className="order-total"><span>{plan?duration(plan.hours):''}</span><strong>₹{plan?.amount}</strong></div>
     <button className="checkout-primary" disabled={busy||!config.available||!config.gatewayEnabled}>{busy?'Creating order…':'Continue to IMB secure payment'}</button>
     {!config.gatewayEnabled&&<p className="checkout-note">IMB payment is temporarily unavailable. Please contact support.</p>}
    </form>
   </>}
   {saved&&!waiting&&!approved&&!rejected&&<div className="checkout-card payment-card">
    <div className="order-id"><span>Order</span><strong>{saved.orderId}</strong></div>
    <div className="amount-due"><span>Pay exactly</span><strong>₹{saved.amount}</strong></div>
    {!order&&<p className="checkout-note">Loading payment details…</p>}
    {order?.payment_url?<><p className="checkout-note"><strong>Payment method: IMB</strong></p><a className="checkout-primary block text-center" href={order.payment_url}>Open secure IMB payment</a><p className="checkout-note">Scan the QR code on the IMB payment page to pay. Return here after paying to check your booking.</p></>:order&&<p className="checkout-note">This order has no IMB payment link. If you have already paid, contact support with this order ID. Otherwise, start a new booking to pay through IMB.</p>}
    <button className="checkout-link" onClick={startOver}>Start a new booking</button>
   </div>}
   {waiting&&<div className="checkout-card status-card"><div className="status-icon waiting">⌛</div><h2>Booking pending</h2><p>Your order <strong>{saved?.orderId}</strong> is awaiting account assignment or review. This page checks automatically.</p><div className="status-pulse"><span></span>Preparing your access</div></div>}
   {approved&&order?.credentials&&<div className="checkout-card status-card approved"><div className="status-icon">✓</div><h2>Access approved</h2><p>Your time ends on <strong>{order.expires_at?new Date(order.expires_at).toLocaleString():'the scheduled time'}</strong>.</p><div className="credential"><span>Login</span><strong>{order.credentials.email}</strong><button onClick={()=>copy(order.credentials!.email,'email')}>{copied==='email'?'Copied':'Copy'}</button></div><div className="credential"><span>Password</span><strong>{order.credentials.password}</strong><button onClick={()=>copy(order.credentials!.password,'password')}>{copied==='password'?'Copied':'Copy'}</button></div><p className="checkout-note">Keep this page private. Save your credentials before closing it.</p></div>}
   {rejected&&<div className="checkout-card status-card"><div className="status-icon rejected">×</div><h2>Payment could not be verified</h2><p>Please contact support with order <strong>{saved?.orderId}</strong>.</p>{config.support&&<a className="checkout-primary block" href={config.support.startsWith('http')?config.support:`https://t.me/${config.support.replace(/^@/,'')}`}>Contact support</a>}<button className="checkout-link" onClick={startOver}>Start a new order</button></div>}
  </main>
  <footer className="checkout-footer">© {new Date().getFullYear()} {config.brand} · Payments through IMB</footer>
 </div>
}
