import {useCallback,useEffect,useState} from 'react';
type Proof={id:number;fileId:string;kind:'photo'|'video'};
type Settings={supportUsername:string;proofs:Proof[]};
export default function BotSettingsPanel({token}:{token:string}){
 const [settings,setSettings]=useState<Settings>({supportUsername:'',proofs:[]});
 const [username,setUsername]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const request=useCallback(async(path:string,method='GET',body?:object)=>{
  const r=await fetch('/api/bot-settings'+path,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const d=await r.json().catch(()=>({error:'Request failed. Try a smaller image.'}));
  if(!r.ok)throw new Error(d.error||'Request failed');return d;
 },[token]);
 const load=useCallback(async()=>{const d=await request('');setSettings(d);setUsername(d.supportUsername)},[request]);
 useEffect(()=>{load().catch(e=>setError(e.message))},[load]);
 async function act(work:()=>Promise<unknown>,message:string){setBusy(true);setError('');setNotice('');try{await work();await load();setNotice(message)}catch(e){setError(e instanceof Error?e.message:'Request failed')}finally{setBusy(false)}}
 async function upload(file:File){
  await act(async()=>{
   if(!['image/png','image/jpeg','image/webp','video/mp4'].includes(file.type)||file.size>(file.type==='video/mp4'?15:3)*1024*1024)throw new Error('Choose a PNG, JPEG or WebP image up to 3 MB, or an MP4 video up to 15 MB.');
   const dataUrl=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Could not read image'));reader.readAsDataURL(file)});
   await request('/proofs','POST',{dataUrl});
  },'Proof saved. Customers can view it from the bot menu.');
 }
 return <section className="rounded-2xl border border-slate-200 bg-white p-5 mb-8 shadow-sm">
  <h2 className="font-heading text-xl font-bold text-slate-900">Bot settings</h2>
  <p className="text-sm text-slate-500 mt-1 mb-4">Manage customer photos, videos and your support contact.</p>
  <form className="flex flex-wrap gap-2 items-end mb-6" onSubmit={e=>{e.preventDefault();act(()=>request('/support','PUT',{username}),'Support contact saved.')}}>
   <label className="text-sm text-slate-700 flex-1">Your Telegram username<input className="block w-full border border-slate-300 rounded-lg px-3 py-2 mt-1" placeholder="your_username" value={username} onChange={e=>setUsername(e.target.value)} disabled={busy}/></label>
   <button disabled={busy} className="rounded-lg bg-slate-900 text-white px-4 py-2 disabled:opacity-50">Save contact</button>
  </form>
  <div className="flex flex-wrap justify-between gap-2 items-center"><h3 className="font-semibold">Proof photos & videos ({settings.proofs.length})</h3>
  <label className={'rounded-lg px-3 py-2 text-sm border border-slate-300 '+(busy?'opacity-50':'cursor-pointer')}>Add photo or video<input className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,video/mp4" disabled={busy} onChange={e=>{const file=e.target.files?.[0];if(file)upload(file);e.target.value=''}}/></label></div>
  <p className="text-xs text-slate-500 mt-2 mb-3">PNG, JPEG or WebP up to 3 MB; MP4 up to 15 MB. No limit on the number of proofs. Uploads also appear in your admin Telegram chat for review. New customers receive these images; returning customers can tap Rates & proofs.</p>
  {!settings.proofs.length&&<p className="text-sm text-slate-500 py-3">No proofs yet. Add your first photo or video above.</p>}
  {settings.proofs.map((proof,i)=><div key={proof.id} className="flex items-center justify-between border-t py-3 gap-2"><span className="text-sm">{proof.kind==='video'?'Video':'Photo'} {i+1}</span><button disabled={busy} className="text-sm text-red-700 border rounded-lg px-3 py-1 disabled:opacity-50" onClick={()=>{if(window.confirm('Remove this proof from future bot replies?'))act(()=>request('/proofs/'+proof.id,'DELETE'),'Proof removed.')}}>Remove</button></div>)}
  {busy&&<p role="status" className="text-sm text-slate-500 mt-3">Saving…</p>}
  {error&&<p role="alert" className="text-sm text-red-700 mt-3">{error}</p>}
  {notice&&<p role="status" className="text-sm text-emerald-700 mt-3">{notice}</p>}
 </section>
}
