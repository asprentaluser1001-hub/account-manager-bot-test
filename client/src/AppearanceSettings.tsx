import {useEffect,useRef,useState} from 'react';
import {DEFAULT_ACCENT,publishAppearance,type Appearance} from './appearance';

export default function AppearanceSettings({token,mode}:{token:string;mode:'wallpaper'|'accent'}) {
  const [settings,setSettings]=useState<Appearance|null>(null),[color,setColor]=useState(DEFAULT_ACCENT),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const [file,setFile]=useState<File|null>(null),[preview,setPreview]=useState('');
  const input=useRef<HTMLInputElement>(null);
  useEffect(()=>{let active=true;fetch('/api/appearance',{cache:'no-store'}).then(async r=>{if(!r.ok)throw Error('Could not load appearance settings.');const value=await r.json();if(active){setSettings(value);setColor(value.accentColor);}}).catch(e=>{if(active)setError(e.message)});return()=>{active=false};},[]);
  useEffect(()=>{if(!file){setPreview('');return;}const url=URL.createObjectURL(file);setPreview(url);return()=>URL.revokeObjectURL(url);},[file]);
  async function update(path:string,method:string,body?:BodyInit,type?:string) {
    setBusy(true);setError('');setNotice('');
    try {
      const response=await fetch(`/api/appearance${path}`,{method,headers:{Authorization:`Bearer ${token}`,...(type?{'Content-Type':type}:{})},body});
      const data=await response.json().catch(()=>({error:response.status===413?'Choose an image under 3 MB.':'Could not save appearance.'}));
      if(!response.ok)throw Error(data.error||'Could not save appearance.');
      publishAppearance(data);setSettings(data);setColor(data.accentColor);setFile(null);if(input.current)input.current.value='';
      setNotice('Saved for admin and mini app. Other open screens update automatically.');
    }catch(e){setError(e instanceof Error?e.message:'Could not save appearance.');}finally{setBusy(false);}
  }
  async function select(selected:File) {
    setError('');setNotice('');setFile(null);
    if(!['image/png','image/jpeg','image/webp'].includes(selected.type)||selected.size>3*1024*1024){setError('Choose a PNG, JPEG or WebP image under 3 MB.');return;}
    try{const image=await createImageBitmap(selected);image.close();setFile(selected);}catch{setError('This image could not be opened. Choose another image.');}
  }
  return <div className="v7-appearance-settings">
    {mode==='wallpaper'?<>
      <p>Use one wallpaper across admin, mini app and checkout. Portrait images work best on phones.</p>
      <img className="v7-wallpaper-preview" src={preview||settings?.wallpaperUrl||'/backgrounds/pearl-aqua.jpg'} alt={file?'Selected wallpaper preview':'Current wallpaper'} />
      <label className="v7-upload-label">Choose wallpaper<input ref={input} type="file" accept="image/png,image/jpeg,image/webp" disabled={busy||!settings} onChange={e=>{const next=e.target.files?.[0];if(next)void select(next);}}/></label>
      {file&&<p className="v7-file-name">{file.name} · Preview only until saved</p>}
      <div className="v7-setting-actions"><button type="button" className="admin-primary" disabled={busy||!file||!settings} onClick={()=>file&&void update('/wallpaper','POST',file,file.type)}>{busy?'Saving…':'Apply wallpaper'}</button>
      <button type="button" className="admin-secondary" disabled={busy||!settings?.wallpaperUrl} onClick={()=>void update('/wallpaper','DELETE')}>Restore Pearl wallpaper</button></div>
    </>:<>
      <p>Change buttons, icons and selection accents while keeping the Pearl glass design.</p>
      <label className="v7-color-label">Accent color<input type="color" value={/^#[0-9a-f]{6}$/i.test(color)?color:DEFAULT_ACCENT} disabled={busy||!settings} onChange={e=>setColor(e.target.value)}/><input aria-label="Accent hex color" type="text" value={color} maxLength={7} disabled={busy||!settings} onChange={e=>setColor(e.target.value)}/></label>
      <div className="v7-color-presets">{[['Pearl','#086b78'],['Red','#b42343'],['Purple','#7c3aed'],['Blue','#2563eb'],['Green','#15803d'],['Orange','#c2410c']].map(([name,value])=><button key={value} type="button" aria-label={`${name} accent`} aria-pressed={color===value} disabled={busy||!settings} onClick={()=>setColor(value)} style={{backgroundColor:value}}><span className="sr-only">{name}</span>{color===value?'✓':''}</button>)}</div>
      <div className="v7-setting-actions"><button type="button" className="admin-primary" disabled={busy||!settings||!/^#[0-9a-f]{6}$/i.test(color)} onClick={()=>void update('','PATCH',JSON.stringify({accentColor:color}),'application/json')}>{busy?'Saving…':'Save accent color'}</button>
      <button type="button" className="admin-secondary" disabled={busy||!settings} onClick={()=>void update('','PATCH',JSON.stringify({accentColor:DEFAULT_ACCENT}),'application/json')}>Restore Pearl accent</button></div>
    </>}
    {error&&<p className="v7-setting-error" role="alert">{error}</p>}
    {notice&&<p className="v7-setting-notice" role="status">{notice}</p>}
  </div>;
}
