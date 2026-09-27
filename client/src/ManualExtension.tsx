import {useCallback,useEffect,useState} from 'react';

type ActiveAccount={id:string;name:string;soldUntil:string};
type Booking={id:string;account_id:string|null;username:string;status:string;order_type?:string};

export default function ManualExtension({token,onBookingChanged}:{token:string;onBookingChanged:()=>void}){
 const [active,setActive]=useState<ActiveAccount[]>([]);
 const [bookings,setBookings]=useState<Booking[]>([]);
 const [accountId,setAccountId]=useState('');
 const [confirmed,setConfirmed]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const load=useCallback(async()=>{
  const response=await fetch('/api/test-orders',{headers:{Authorization:`Bearer ${token}`}});
  const result=await response.json();
  if(!response.ok)throw new Error(result.error||'Could not load active bookings');
  setActive(result.active||[]);setBookings(result.orders||[]);
 },[token]);
 useEffect(()=>{load().catch(e=>setMessage(e.message))},[load]);
 const selected=bookings.find(order=>order.account_id===accountId&&['approved','delivered','delivery_failed'].includes(order.status)&&(!order.order_type||order.order_type==='booking'));
 async function extend(){
  if(!accountId||!selected||!confirmed)return;
  setBusy(true);setMessage('');
  try{
   const response=await fetch('/api/test-orders/manual-extension',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({accountId,name:selected.username,contact:'',amount:50})});
   const result=await response.json();if(!response.ok)throw new Error(result.error||'Extension failed');
   setMessage(`Extended ${selected.username} by 50 minutes. New end: ${new Date(result.order.expires_at).toLocaleString()}.`);
   setConfirmed(false);setAccountId('');await load();onBookingChanged();
  }catch(e){setMessage(e instanceof Error?e.message:'Extension failed')}finally{setBusy(false)}
 }
 return <section className="admin-panel mt-4"><h2 className="font-heading text-xl font-semibold">Extend active booking · 50 minutes</h2>
  <p className="mt-2 text-sm text-slate-600">₹50 · same customer and account. The reset timer moves forward 50 minutes after you verify payment.</p>
  <label className="mt-4 block text-sm font-medium">Active account<select className="mt-1 w-full rounded-xl border p-3" value={accountId} onChange={e=>{setAccountId(e.target.value);setConfirmed(false)}}><option value="">Choose a booking</option>{active.map(account=><option key={account.id} value={account.id}>{account.name} · ends {new Date(account.soldUntil).toLocaleString()}</option>)}</select></label>
  {accountId&&<p className="mt-2 text-sm">Customer: {selected?.username||'No linked booking found'}</p>}
  <label className="mt-4 flex gap-2 text-sm"><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>I verified the ₹50 payment was received</label>
  <button className="admin-primary mt-4 w-full" disabled={busy||!selected||!confirmed} onClick={extend}>{busy?'Extending…':'Extend same booking +50 min'}</button>
  {message&&<p role="status" className="mt-3 text-sm">{message}</p>}
 </section>;
}
