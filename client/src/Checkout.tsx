import {useEffect,useMemo,useState} from 'react';

type Plan={hours:number;amount:number};
type Config={brand:string;payeeName:string;upiId:string;qrDataUrl:string;support:string;plans:Plan[];available:boolean};
type SavedOrder={orderId:string;accessToken:string;amount:number;hours:number};
type OrderStatus={id:string;username:string;hours:number;amount:number;status:string;created_at:string;claimed_at:string|null;approved_at:string|null;expires_at:string|null;error:string|null;credentials:null|{email:string;password:string}};

const ORDER_KEY='flingroulette_checkout_order';
const duration=(hours:number)=>hours===168?'1 week':hours===720?'1 month':`${hours} hour${hours===1?'':'s'}`;
function linkedOrder():SavedOrder|null{
 const query=new URLSearchParams(window.location.search),orderId=query.get('order')||'',accessToken=query.get('token')||'',amount=Number(query.get('amount')),hours=Number(query.get('hours'));
 return orderId&&accessToken&&Number.isFinite(amount)&&amount>0&&[1,2,3,168,720].includes(hours)?{orderId,accessToken,amount,hours}:null;
}

export default function Checkout(){
 const [config,setConfig]=useState<Config|null>(null),[selected,setSelected]=useState<number>(()=>{const value=Number(new URLSearchParams(window.location.search).get('hours'));return [1,2,3,168,720].includes(value)?value:1}),[name,setName]=useState(''),[contact,setContact]=useState('');
 const [saved,setSaved]=useState<SavedOrder|null>(()=>{const linked=linkedOrder();if(linked)return linked;try{return JSON.parse(sessionStorage.getItem(ORDER_KEY)||'null')}catch{return null}});
 const [order,setOrder]=useState<OrderStatus|null>(null),[reference,setReference]=useState(''),[proof,setProof]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[copied,setCopied]=useState('');
 useEffect(()=>{fetch('/api/checkout/config').then(async r=>{const d=await r.json();if(!r.ok)throw new Error(d.error);setConfig(d);if(d.plans?.length&&!d.plans.some((p:Plan)=>p.hours===selected))setSelected(d.plans[0].hours)}).catch(()=>setError('Checkout is temporarily unavailable. Please try again.'))},[]);
 useEffect(()=>{const linked=linkedOrder();if(linked){sessionStorage.setItem(ORDER_KEY,JSON.stringify(linked));window.history.replaceState({},'',window.location.pathname)}},[]);
 useEffect(()=>{if(!saved)return;let active=true;const load=async()=>{try{const r=await fetch(`/api/checkout/orders/${saved.orderId}?token=${encodeURIComponent(saved.accessToken)}`);const d=await r.json();if(!r.ok)throw new Error(d.error);if(active)setOrder(d)}catch(e){if(active)setError(e instanceof Error?e.message:'Could not check order')}};load();const timer=setInterval(load,8000);return()=>{active=false;clearInterval(timer)}},[saved]);
 const plan=useMemo(()=>config?.plans.find(p=>p.hours===selected),[config,selected]);
 const upiQuery=saved&&config?.upiId?`pa=${encodeURIComponent(config.upiId)}&pn=${encodeURIComponent(config.payeeName||config.brand)}&am=${saved.amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(saved.orderId)}`:'';
 const paymentApps=upiQuery?[
  {name:'Google Pay',icon:'/payment-icons/google-pay.svg',className:'google-pay',href:`tez://upi/pay?${upiQuery}`},
  {name:'PhonePe',icon:'/payment-icons/phonepe.svg',className:'phonepe',href:`phonepe://pay?${upiQuery}`},
  {name:'Paytm',icon:'/payment-icons/paytm.svg',className:'paytm',href:`paytmmp://pay?${upiQuery}`},
  {name:'Any UPI app',icon:'/payment-icons/upi.svg',className:'upi',href:`upi://pay?${upiQuery}`},
 ]:[];
 async function createOrder(e:React.FormEvent){e.preventDefault();setBusy(true);setError('');try{const r=await fetch('/api/checkout/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,contact,hours:selected})});const d=await r.json();if(!r.ok)throw new Error(d.error);const next={orderId:d.orderId,accessToken:d.accessToken,amount:d.amount,hours:selected};sessionStorage.setItem(ORDER_KEY,JSON.stringify(next));setSaved(next)}catch(e){setError(e instanceof Error?e.message:'Could not create order')}finally{setBusy(false)}}
 async function chooseProof(file:File){
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>3*1024*1024){setError('Upload a PNG, JPEG or WebP screenshot under 3 MB.');return;}
  const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Could not read screenshot'));reader.readAsDataURL(file)});setProof(data);setError('');
 }
 async function submitProof(e:React.FormEvent){e.preventDefault();if(!saved||!proof)return;setBusy(true);setError('');try{const r=await fetch(`/api/checkout/orders/${saved.orderId}/proof`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({accessToken:saved.accessToken,paymentReference:reference,proofDataUrl:proof})});const d=await r.json();if(!r.ok)throw new Error(d.error);setOrder(prev=>prev?{...prev,status:d.status}:prev);setProof('')}catch(e){setError(e instanceof Error?e.message:'Could not submit payment proof')}finally{setBusy(false)}}
 function startOver(){sessionStorage.removeItem(ORDER_KEY);setSaved(null);setOrder(null);setProof('');setReference('');setError('')}
 async function copy(value:string,key:string){await navigator.clipboard.writeText(value);setCopied(key);setTimeout(()=>setCopied(''),1200)}
 if(!config)return <div className="checkout-shell"><div className="checkout-card text-center"><p className="checkout-muted">{error||'Opening secure checkout…'}</p></div></div>;
 const waiting=order?.status==='payment_claimed';
 const approved=!!order?.credentials&&['approved','delivered','delivery_failed'].includes(order.status);
 const rejected=order?.status==='rejected';
 return <div className="checkout-shell">
  <header className="checkout-header"><a href="/checkout" className="checkout-brand"><span>FR</span>{config.brand}</a><div className="checkout-secure">Secure order</div></header>
  <main className="checkout-main">
   <section className="checkout-intro"><p className="checkout-kicker">PRIVATE ACCESS</p><h1>Choose your access time</h1><p>Pick a plan, pay the exact amount by UPI, and receive access after payment approval.</p></section>
   {error&&<div className="checkout-alert error" role="alert">{error}</div>}
   {!saved&&<>
    <div className={`availability ${config.available?'available':'unavailable'}`}><span></span>{config.available?'Access is available now':'Currently unavailable'}</div>
    <div className="plan-grid">{config.plans.map(item=><button key={item.hours} onClick={()=>setSelected(item.hours)} className={`plan-card ${selected===item.hours?'selected':''}`}><span>{duration(item.hours)}</span><strong>₹{item.amount}</strong>{selected===item.hours&&<em>Selected</em>}</button>)}</div>
    <form onSubmit={createOrder} className="checkout-card checkout-form">
     <div><label>Your name</label><input value={name} onChange={e=>setName(e.target.value)} placeholder="Name" required minLength={2} maxLength={64}/></div>
     <div><label>Telegram username or phone</label><input value={contact} onChange={e=>setContact(e.target.value)} placeholder="@username or mobile number" required minLength={4} maxLength={100}/></div>
     <div className="order-total"><span>{plan?duration(plan.hours):''}</span><strong>₹{plan?.amount}</strong></div>
     <button className="checkout-primary" disabled={busy||!config.available||!config.upiId||(!config.qrDataUrl&&!config.upiId)}>{busy?'Creating order…':'Continue to payment'}</button>
     {!config.upiId&&<p className="checkout-note">Online payment is being configured. Please contact support.</p>}
    </form>
   </>}
   {saved&&!waiting&&!approved&&!rejected&&<div className="checkout-card payment-card">
    <div className="order-id"><span>Order</span><strong>{saved.orderId}</strong></div>
    <div className="amount-due"><span>Pay exactly</span><strong>₹{saved.amount}</strong></div>
    {config.qrDataUrl&&<><img className="payment-qr" src={config.qrDataUrl} alt={`UPI QR for ${config.payeeName||config.brand}`}/><div className="qr-actions"><span>Scan with another phone</span><a href={config.qrDataUrl} download="flingroulette-payment-qr.png">Download QR</a></div></>} 
    <div className="upi-details"><span>UPI ID</span><strong>{config.upiId}</strong><button onClick={()=>copy(config.upiId,'upi')}>{copied==='upi'?'Copied':'Copy'}</button></div>
    {!!paymentApps.length&&<div className="payment-apps"><p>Pay using</p><div className="payment-app-grid">{paymentApps.map(app=><a key={app.name} href={app.href} className={app.className} aria-label={`Pay with ${app.name}`}><span className="payment-app-icon"><img src={app.icon} alt=""/></span><strong>{app.name}</strong><span className="payment-app-arrow" aria-hidden="true">›</span></a>)}</div><small>Choose an app installed on this phone. If it does not open, download the QR and pay from your UPI app.</small></div>}
    <p className="checkout-note">Confirm the payee name is <strong>{config.payeeName||config.brand}</strong>. Enter the exact amount shown above.</p>
    <form onSubmit={submitProof} className="proof-form">
     <label>Payment screenshot</label><label className="upload-box">{proof?<><img src={proof} alt="Selected payment screenshot"/><span>Change screenshot</span></>:<><b>Upload payment screenshot</b><span>PNG, JPEG or WebP · maximum 3 MB</span></>}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];if(file)chooseProof(file)}}/></label>
     <label>UPI reference number <small>(optional)</small></label><input value={reference} onChange={e=>setReference(e.target.value)} placeholder="12-digit UTR / transaction ID" maxLength={80}/>
     <button className="checkout-primary" disabled={busy||!proof}>{busy?'Submitting…':'I have paid · Submit proof'}</button>
    </form>
    <button className="checkout-link" onClick={startOver}>Cancel this order</button>
   </div>}
   {waiting&&<div className="checkout-card status-card"><div className="status-icon waiting">⌛</div><h2>Payment proof received</h2><p>Your order <strong>{saved?.orderId}</strong> is waiting for admin approval. This page checks automatically.</p><div className="status-pulse"><span></span>Review in progress</div></div>}
   {approved&&order?.credentials&&<div className="checkout-card status-card approved"><div className="status-icon">✓</div><h2>Access approved</h2><p>Your time ends on <strong>{order.expires_at?new Date(order.expires_at).toLocaleString():'the scheduled time'}</strong>.</p><div className="credential"><span>Login</span><strong>{order.credentials.email}</strong><button onClick={()=>copy(order.credentials!.email,'email')}>{copied==='email'?'Copied':'Copy'}</button></div><div className="credential"><span>Password</span><strong>{order.credentials.password}</strong><button onClick={()=>copy(order.credentials!.password,'password')}>{copied==='password'?'Copied':'Copy'}</button></div><p className="checkout-note">Keep this page private. Save your credentials before closing it.</p></div>}
   {rejected&&<div className="checkout-card status-card"><div className="status-icon rejected">×</div><h2>Payment could not be verified</h2><p>Please contact support with order <strong>{saved?.orderId}</strong>.</p>{config.support&&<a className="checkout-primary block" href={config.support.startsWith('http')?config.support:`https://t.me/${config.support.replace(/^@/,'')}`}>Contact support</a>}<button className="checkout-link" onClick={startOver}>Start a new order</button></div>}
  </main>
  <footer className="checkout-footer">© {new Date().getFullYear()} {config.brand} · Payments are manually verified</footer>
 </div>
}
