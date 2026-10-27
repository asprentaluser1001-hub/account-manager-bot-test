import {useEffect,useMemo,useState} from 'react';
import {isTelegramCheckout,openPaymentInBrowser} from './checkoutBrowser';

type Plan={hours:number;amount:number};
type Config={brand:string;support:string;supportUrl:string;plans:Plan[];available:boolean;gatewayEnabled:boolean;mockPayment:boolean;paymentProvider:"imb"|"cashfree"};
type SavedOrder={orderId:string;accessToken:string;amount:number;hours:number};
type OrderStatus={id:string;username:string;hours:number;amount:number;status:string;created_at:string;claimed_at:string|null;approved_at:string|null;expires_at:string|null;error:string|null;starts_at?:string;payment_deadline?:string;order_type?:string;payment_provider?:"imb"|"cashfree";payment_session_id?:string;cashfree_environment?:"sandbox"|"production";payment_url?:string;phonepe_link?:string;paytm_link?:string;bhim_link?:string;credentials:null|{email:string;password:string}};

const ORDER_KEY='flingroulette_checkout_order';
const duration=(hours:number)=>hours===0.5?'30 minutes':hours===168?'1 week':hours===720?'1 month':`${hours} hour${hours===1?'':'s'}`;
function linkedOrder():SavedOrder|null{
 const query=new URLSearchParams(window.location.search),orderId=query.get('order')||'',accessToken=query.get('token')||'',amount=Number(query.get('amount')),hours=Number(query.get('hours'));
 return orderId&&accessToken&&Number.isFinite(amount)&&amount>0&&[0.5,1,2,3,168,720].includes(hours)?{orderId,accessToken,amount,hours}:null;
}

export default function Checkout(){
 const [config,setConfig]=useState<Config|null>(null),[lockedHours]=useState<number|null>(()=>{const query=new URLSearchParams(window.location.search);const value=Number(query.get('hours'));return query.get('new')==='1'&&[0.5,1,2,3,168,720].includes(value)?value:null}),[selected,setSelected]=useState<number>(()=>{const value=Number(new URLSearchParams(window.location.search).get('hours'));return [0.5,1,2,3,168,720].includes(value)?value:1}),[name,setName]=useState(''),[phone,setPhone]=useState('');
 const [saved,setSaved]=useState<SavedOrder|null>(()=>{const linked=linkedOrder();if(linked)return linked;if(new URLSearchParams(window.location.search).get('new')==='1')return null;try{return JSON.parse(sessionStorage.getItem(ORDER_KEY)||'null')}catch{return null}});
 const [order,setOrder]=useState<OrderStatus|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState(''),[showPaymentLink,setShowPaymentLink]=useState(false),[now,setNow]=useState(Date.now());
 useEffect(()=>{const tick=()=>setNow(Date.now());const timer=setInterval(tick,1000);document.addEventListener('visibilitychange',tick);return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',tick)}},[]);
 useEffect(()=>{fetch('/api/checkout/config').then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);setConfig(d);if(d.plans?.length&&!d.plans.some((p:Plan)=>p.hours===selected))setSelected(d.plans[0].hours)}).catch(()=>setError('Checkout is temporarily unavailable. Please try again.'))},[]);
 useEffect(()=>{const linked=linkedOrder();if(!linked&&new URLSearchParams(window.location.search).get('new')==='1'){sessionStorage.removeItem(ORDER_KEY);window.history.replaceState({},'',window.location.pathname)}if(linked){sessionStorage.setItem(ORDER_KEY,JSON.stringify(linked));window.history.replaceState({},'',window.location.pathname)}},[]);
 useEffect(()=>{if(!saved)return;let active=true;const load=async()=>{try{const r=await fetch(`/api/checkout/orders/${saved.orderId}?token=${encodeURIComponent(saved.accessToken)}`);const d=await r.json();if(!r.ok)throw new Error(d.error);if(active)setOrder(d)}catch(e){if(active)setError(e instanceof Error?e.message:'Could not check order')}};load();fetch(`/api/checkout/orders/${saved.orderId}?token=${encodeURIComponent(saved.accessToken)}`).then(r=>r.json()).then(d=>{if(d.payment_provider==='cashfree'&&['awaiting_payment_claim','payment_claimed'].includes(d.status))return fetch(`/api/checkout/orders/${saved.orderId}/verify`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessToken:saved.accessToken})}).then(r=>{if(r.ok)return load()})}).catch(()=>{});const timer=setInterval(load,8000);return()=>{active=false;clearInterval(timer)}},[saved]);
 const plan=useMemo(()=>config?.plans.find(p=>p.hours===selected),[config,selected]);
 async function createOrder(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{const r=await fetch('/api/checkout/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,phone,hours:selected})});const d=await r.json();if(!r.ok)throw new Error(d.error);if(!config?.mockPayment&&!d.payment_url&&!d.payment_session_id)throw new Error('The payment provider did not return checkout details. Please contact support.');const next={orderId:d.orderId,accessToken:d.accessToken,amount:d.amount,hours:selected};sessionStorage.setItem(ORDER_KEY,JSON.stringify(next));setSaved(next);if(d.payment_session_id)await openCashfree(d.payment_session_id,d.cashfree_environment);else if(d.payment_url&&!isTelegramCheckout())openPaymentInBrowser(d.payment_url)}catch(e){setError(e instanceof Error?e.message:'Could not create order')}finally{setBusy(false)}}
 async function checkPayment(){
  if(!saved)return;
  setBusy(true);setError('');
  try{const r=await fetch(`/api/checkout/orders/${saved.orderId}/verify`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessToken:saved.accessToken})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not check payment');setOrder(d)}
  catch(e){setError(e instanceof Error?e.message:'Could not check payment')}finally{setBusy(false)}
 }
 async function startSavedCashfree(e:React.FormEvent){
  e.preventDefault();if(!saved)return;setBusy(true);setError('');
  try{const r=await fetch(`/api/checkout/orders/${saved.orderId}/session`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessToken:saved.accessToken,phone})});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not start payment');setOrder(d);await openCashfree(d.payment_session_id,d.cashfree_environment)}catch(e){setError(e instanceof Error?e.message:'Could not open payment')}finally{setBusy(false)}
 }
 async function resumeCashfree(){
  if(!order?.payment_session_id||!order.cashfree_environment)return;
  setBusy(true);setError('');try{await openCashfree(order.payment_session_id,order.cashfree_environment)}catch(e){setError(e instanceof Error?e.message:'Could not open payment')}finally{setBusy(false)}
 }
 function openImbPayment(){
  if(!order?.payment_url)return;
  setError('');
  try{openPaymentInBrowser(order.payment_url)}catch(e){setShowPaymentLink(true);setError(e instanceof Error?e.message:'Copy the payment link and open it in your browser.')}
 }
 async function copyPaymentLink(){
  if(!order?.payment_url)return;
  try{await navigator.clipboard.writeText(order.payment_url);setCopied('payment-link');setTimeout(()=>setCopied(''),1500)}
  catch{setShowPaymentLink(true);setError('Press and hold the payment link below to copy it, then paste it into Safari or Chrome.')}
 }
 function startOver(){sessionStorage.removeItem(ORDER_KEY);setSaved(null);setOrder(null);setError('');setShowPaymentLink(false)}
 async function copy(value:string,key:string){await navigator.clipboard.writeText(value);setCopied(key);setTimeout(()=>setCopied(''),1200)}
 if(!config)return <div className="checkout-shell"><div className="checkout-card text-center"><p className="checkout-muted">{error||'Opening secure checkout…'}</p></div></div>;
 const waiting=order?.status==='payment_claimed';
 const approved=!!order?.credentials&&!!order.expires_at&&new Date(order.expires_at).getTime()>now&&['approved','delivered','delivery_failed'].includes(order.status);
 const rejected=order?.status==='rejected';
 const resetFailed=order?.status==='reset_failed';
 const expired=order?.status==='expired'||(!!order?.expires_at&&['approved','delivered','delivery_failed'].includes(order.status)&&new Date(order.expires_at).getTime()<=now);
 const remaining=order?.expires_at?Math.max(0,new Date(order.expires_at).getTime()-now):0;
 const total=order?.approved_at&&order.expires_at?new Date(order.expires_at).getTime()-new Date(order.approved_at).getTime():0;
 const remainingText=`${Math.floor(remaining/3600000)}h ${String(Math.floor(remaining/60000)%60).padStart(2,'0')}m ${String(Math.floor(remaining/1000)%60).padStart(2,'0')}s`;
 const supportUrl=config.supportUrl;
 const providerLabel=config.paymentProvider==='cashfree'?'Cashfree':'IMB';
 const orderProviderLabel=(order?.payment_provider||config.paymentProvider)==='cashfree'?'Cashfree':'IMB';
 return <div className="checkout-shell">
  <header className="checkout-header"><a href="/checkout" className="checkout-brand"><span>FR</span>{config.brand}</a><div className="checkout-secure">Secure order</div></header>
  <main className="checkout-main">
   <section className="checkout-intro"><p className="checkout-kicker">{config.mockPayment?'V3 TEST PREVIEW':'PRIVATE ACCESS'}</p><h1>Choose your access time</h1><p>{config.mockPayment?'Create a sample booking. No payment is collected in this preview.':'Pick a plan, pay securely, and receive access after payment verification.'}</p></section>
   {error&&<div className="checkout-alert error" role="alert">{error}{error.includes("Booking paused")&&supportUrl&&<a className="checkout-primary block" href={supportUrl}>Contact admin</a>}</div>}
   {!saved&&<>
    <div className={`availability ${config.available?'available':'unavailable'}`}><span></span>{config.available?'Access is available now':'Currently unavailable'}</div>
    <div className="plan-grid">{config.plans.filter(item=>!lockedHours||item.hours===lockedHours).map(item=><button key={item.hours} onClick={()=>{if(!lockedHours)setSelected(item.hours)}} className={`plan-card ${selected===item.hours?'selected':''}`}><span>{duration(item.hours)}</span><strong>₹{item.amount}</strong>{selected===item.hours&&<em>Selected</em>}</button>)}</div>
    <form onSubmit={createOrder} className="checkout-card checkout-form">
     <div><label>Your name</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Name" required minLength={2} maxLength={64}/></div>
     {!config.mockPayment&&config.paymentProvider==='cashfree'&&<div><label>Mobile number</label><input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="10-digit Indian mobile number" required maxLength={16}/></div>}
     <div className="order-total"><span>{plan?duration(plan.hours):''}</span><strong>₹{plan?.amount}</strong></div>
     <p className="checkout-note">Once payment is done, return to this page and wait 5–10 seconds for payment confirmation and your ID.</p>
     <button className="checkout-primary" disabled={busy||!config.available||(!config.gatewayEnabled&&!config.mockPayment)}>{busy?'Creating order…':config.mockPayment?'Create sample booking':`Continue to ${providerLabel} secure payment`}</button>
     {!config.gatewayEnabled&&!config.mockPayment&&<p className="checkout-note">Payment is temporarily unavailable. Please contact support.</p>}
    </form>
   </>}
   {saved&&!waiting&&!approved&&!rejected&&!resetFailed&&!expired&&!['reserved','payment_late','reservation_failed'].includes(order?.status||'')&&<div className="checkout-card payment-card">
    {order?.order_type==='extension'&&<p className="checkout-note">Extend by 1 hour · ₹50. Payment must be confirmed before {order.payment_deadline?new Date(order.payment_deadline).toLocaleString():'your original booking ends'}. Opening payment does not change your timer.</p>}<div className="order-id"><span>Order</span><strong>{saved.orderId}</strong></div>
    <div className="amount-due"><span>{config.mockPayment?'Sample amount':'Pay exactly'}</span><strong>₹{saved.amount}</strong></div>
    {!order&&<p className="checkout-note">Loading payment details…</p>}
    {config.mockPayment?<p className="checkout-note">This is a test order. No QR or real payment is available. Ask the preview admin to mark this booking as claimed and assign a sample account.</p>:order?.payment_provider==='cashfree'&&!order.payment_session_id?<form onSubmit={startSavedCashfree}><label>Mobile number<input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="10-digit Indian mobile number" required maxLength={16}/></label><button className="checkout-primary" disabled={busy}>Continue to Cashfree payment</button></form>:order?.payment_provider==='cashfree'&&order.payment_session_id?<><p className="checkout-note"><strong>Payment method: Cashfree</strong></p><button className="checkout-primary" disabled={busy} onClick={resumeCashfree}>Open Cashfree payment</button><button className="checkout-link" disabled={busy} onClick={checkPayment}>Check payment status</button><p className="checkout-note">Already paid? Check payment status here. Your access appears after verification.</p></>:order?.payment_url?<><p className="checkout-note"><strong>Payment method: IMB</strong></p><button className="checkout-primary block w-full" onClick={openImbPayment}>Open payment in browser</button><button className="checkout-link" onClick={copyPaymentLink}>{copied==='payment-link'?'Link copied':'Copy payment link'}</button><p className="checkout-note">If Telegram blocks the QR download or a payment app, open this same payment in Safari or Chrome. Keep this order page open and return after paying.</p>{showPaymentLink&&<label className="checkout-note block">Your private payment link<input className="payment-link-fallback" readOnly value={order.payment_url} onFocus={event=>event.currentTarget.select()} /></label>}<p className="checkout-note">Once payment is done, come back to this page and wait 5–10 seconds while we confirm payment and assign your ID. If confirmation takes longer, keep this page open or contact support.</p></>:order&&<p className="checkout-note">This order has no IMB payment link. If you have already paid, contact support with this order ID. Otherwise, start a new booking to pay through IMB.</p>}
    <button className="checkout-link" onClick={startOver}>Start a new booking</button>
   </div>}
   {waiting&&<div className="checkout-card status-card"><div className="status-icon waiting">⌛</div><h2>Booking pending</h2><p>Your order <strong>{saved?.orderId}</strong> is awaiting account assignment or review. This page checks automatically.</p><div className="status-pulse"><span></span>Preparing your access</div></div>}
   {approved&&order?.credentials&&<div className="checkout-card status-card approved"><div className="status-icon">✓</div><h2>Access approved</h2><p>Your time ends on <strong>{order.expires_at?new Date(order.expires_at).toLocaleString():'the scheduled time'}</strong>.</p>{total>0&&<div className="booking-time"><div className="booking-time-label"><span>Time remaining</span><strong>{remainingText}</strong></div><div className="booking-time-track" role="progressbar" aria-label="Booking time remaining" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(remaining/total*100)}><span style={{width:`${Math.min(100,remaining/total*100)}%`}} /></div></div>}<div className="credential"><span>Login</span><strong>{order.credentials.email}</strong><button onClick={()=>copy(order.credentials!.email,'email')}>{copied==='email'?'Copied':'Copy'}</button></div><div className="credential"><span>Password</span><strong>{order.credentials.password}</strong><button onClick={()=>copy(order.credentials!.password,'password')}>{copied==='password'?'Copied':'Copy'}</button></div><p className="checkout-note">Keep this page private. Save your credentials before closing it.</p>{order.hours!==0.5&&<p className="checkout-note">Your ID is ready. You can extend by 1 hour from the booking page for this ID.</p>}<a className="checkout-link" href="/miniapp">Open booking page</a></div>}
   {order?.status==='reserved'&&<div className="checkout-card status-card"><h2>Advance booking confirmed</h2><p>Your slot starts {order.starts_at?new Date(order.starts_at).toLocaleString():''}. Your ID and password appear when the slot starts and the account reset is complete.</p></div>}
   {['payment_late','reservation_failed'].includes(order?.status||'')&&<div className="checkout-card status-card"><h2>Contact support</h2><p>{order?.error}</p><p>Payment has been recorded; do not pay again. Share order {order?.id} with the admin.</p></div>}
   {resetFailed&&<div className="checkout-card status-card"><div className="status-icon rejected">!</div><h2>Account reset needs attention</h2><p>This booking’s ID is blocked from new bookings because its password reset failed. Please contact the admin with order <strong>{saved?.orderId}</strong>. You can book again after the admin approves you.</p>{supportUrl&&<a className="checkout-primary block" href={supportUrl}>Contact admin</a>}</div>}
   {expired&&<div className="checkout-card status-card"><h2>Booking ended</h2><p>Your booking <strong>{saved?.orderId}</strong> has ended.</p><button className="checkout-link" onClick={startOver}>New booking</button></div>}
   {rejected&&<div className="checkout-card status-card"><div className="status-icon rejected">×</div><h2>Payment could not be verified</h2><p>Please contact support with order <strong>{saved?.orderId}</strong>.</p>{config.support&&<a className="checkout-primary block" href={config.support.startsWith('http')?config.support:`https://t.me/${config.support.replace(/^@/,'')}`}>Contact support</a>}<button className="checkout-link" onClick={startOver}>Start a new order</button></div>}
  </main>
  <footer className="checkout-footer">© {new Date().getFullYear()} {config.brand} · {config.mockPayment?'Test preview · no real payments':`Payments through ${orderProviderLabel}`}</footer>
 </div>
}


// Load only for Cashfree orders; an SDK/network failure must not break IMB checkout.
type CashfreeClient={checkout:(options:{paymentSessionId:string;redirectTarget:string})=>Promise<{error?:{message?:string}}|void>};
declare global { interface Window { Cashfree?:(options:{mode:'sandbox'|'production'})=>CashfreeClient } }
let sdkPromise:Promise<void>|null=null;
async function openCashfree(session:string,mode:'sandbox'|'production'){
 if(!window.Cashfree){
  if(!sdkPromise)sdkPromise=new Promise<void>((resolve,reject)=>{
   const script=document.createElement('script');script.src='https://sdk.cashfree.com/js/v3/cashfree.js';
   const timer=setTimeout(()=>{script.remove();sdkPromise=null;reject(new Error('Payment checkout took too long to load. Try again.'))},15000);
   script.onload=()=>{clearTimeout(timer);resolve()};script.onerror=()=>{clearTimeout(timer);script.remove();sdkPromise=null;reject(new Error('Could not load Cashfree checkout. Try again.'))};document.head.appendChild(script);
  });
  await sdkPromise;
 }
 if(!window.Cashfree)throw new Error('Cashfree checkout could not start');
 const result=await window.Cashfree({mode}).checkout({paymentSessionId:session,redirectTarget:'_self'});
 if(result?.error)throw new Error(result.error.message||'Could not open Cashfree checkout');
}
