import {useState} from 'react';

export default function AccountRecovery({id,name,candidate,token,onChanged,onClose}:{id:string;name:string;candidate?:string|null;token:string;onChanged:()=>void;onClose:()=>void}){
 const [password,setPassword]=useState(candidate||''),[confirmation,setConfirmation]=useState('');
 const [revealed,setRevealed]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function recover(action:'stop'|'retry'|'retire'){
  const message=action==='retire'?'Permanently remove this ID and end any linked booking? This does not reset the password on Flingster.':action==='stop'?'Stop retries and end any linked booking? This ID will remain unavailable until you recover it.':'End any linked booking and retry using the password you recovered?';
  if(!window.confirm(message))return;
  setBusy(true);setError('');setNotice('');
  try{
   const response=await fetch(`/api/accounts/${encodeURIComponent(id)}/recovery`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action,password,confirmation})});
   const data=await response.json();if(!response.ok)throw new Error(data.error||'Recovery failed');
   setNotice(data.message);setPassword('');onChanged();if(action==='retire')onClose();
  }catch(e){setError(e instanceof Error?e.message:'Recovery failed');}finally{setBusy(false);}
 }
 return <section className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-3">
  <div className="flex justify-between gap-2"><h3 className="font-semibold">Recover or remove {name}</h3><button disabled={busy} onClick={onClose} className="text-sm">Close</button></div>
  <p className="text-xs text-slate-600">If the password is lost, recover it on Flingster first. You can stop retries now, then enter the correct current password below. The ID stays unavailable until reset succeeds.</p>
  <button disabled={busy} onClick={()=>recover('stop')} className="admin-secondary">Stop reset &amp; quarantine ID</button>
  {candidate&&<p className="text-xs text-amber-800">The last attempted password has been saved in the field below. Check whether it works on Flingster before retrying.</p>}
  <label className="block text-xs">Recovered current password<input type={revealed?'text':'password'} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} disabled={busy} className="block w-full mt-1 border rounded-lg p-2"/></label>
  <button disabled={busy} onClick={()=>setRevealed(!revealed)} className="text-xs underline">{revealed?'Hide password':'Show password'}</button>
  <button disabled={busy||!password.trim()} onClick={()=>recover('retry')} className="admin-secondary">Save password &amp; retry reset</button>
  <div className="border-t border-amber-200 pt-3 space-y-2"><p className="text-xs text-slate-600">Unable to recover it? Remove this ID permanently. Booking history is kept; the external password is unchanged.</p>
   <label className="block text-xs">Type {name} to confirm<input value={confirmation} onChange={e=>setConfirmation(e.target.value)} disabled={busy} className="block w-full mt-1 border rounded-lg p-2"/></label>
   <button disabled={busy||confirmation!==name} onClick={()=>recover('retire')} className="admin-secondary text-red-700">Remove unusable ID permanently</button>
  </div>
  {busy&&<p role="status" className="text-xs">Stopping the worker and saving…</p>}{error&&<p role="alert" className="text-xs text-red-700">{error}</p>}{notice&&<p role="status" className="text-xs text-emerald-800">{notice}</p>}
 </section>;
}
