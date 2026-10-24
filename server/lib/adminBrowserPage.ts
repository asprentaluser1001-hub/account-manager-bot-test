export const adminBrowserPage = String.raw`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>VPS browser · FlingRoulette</title>
<style nonce="%NONCE%">
body{font-family:system-ui,sans-serif;margin:0;background:#f1f5f9;color:#0f172a}main{max-width:1000px;margin:auto;padding:18px}h1{font-size:24px;margin-bottom:8px}p{line-height:1.5}.card{padding:16px;background:white;border:1px solid #cbd5e1;border-radius:14px;margin:14px 0}.actions{display:flex;flex-wrap:wrap;gap:8px}button,a{font:inherit}button{padding:11px 15px;border:0;border-radius:9px;background:#0f172a;color:white;cursor:pointer}button:disabled{opacity:.4}#stop{background:#b91c1c}input{box-sizing:border-box;font:inherit;padding:12px;width:100%;margin:8px 0;border:1px solid #94a3b8;border-radius:8px}#frame{display:block;width:100%;height:auto;border:1px solid #94a3b8;background:#fff;touch-action:manipulation}#status{white-space:pre-wrap}a{color:#1d4ed8}.muted{color:#475569;font-size:14px}label{display:block}
[hidden]{display:none!important}
</style></head><body><main>
<a href="/?tab=approvals">← Dashboard</a><h1>VPS browser</h1>
<p>This shows a browser running on your VPS. You control it manually from this page.</p>
<div class="card"><p>Use Flingster for up to three hours per session. Automatic and manual password resets keep running. Close the browser when finished.</p>
<p class="muted">This viewer supports screenshots, taps and typing. It does not stream video, microphone or sound. A scheduled reset can still change the password of an account you are using here.</p>
<p class="muted">If you change a password manually, verify it and save it through account recovery afterward. Completing a challenge here does not confirm that automatic resets will work.</p>
<div class="actions"><button id="start">Open VPS browser</button><button id="stop" disabled>Close browser</button></div><p id="status" role="status">Ready. Sign in to the dashboard first if needed.</p></div>
<img id="frame" hidden alt="Live screenshot from the VPS browser. Tap to click." width="1280" height="720">
<section id="controls" class="card" hidden>
<p class="muted">Tap the picture to click or select a field. Then type below and press Send.</p>
<form id="typing"><label for="text">Text for the selected field</label><input id="text" type="password" autocomplete="off" spellcheck="false" maxlength="500"><button>Send text</button></form>
<div class="actions"><button data-key="Tab">Tab</button><button data-key="Enter">Enter</button><button data-key="Backspace">Backspace</button><button data-key="Escape">Escape</button><button data-scroll="-400">Scroll up</button><button data-scroll="400">Scroll down</button></div>
</section>
<script nonce="%NONCE%">
const status=document.getElementById('status'),image=document.getElementById('frame'),controls=document.getElementById('controls'),start=document.getElementById('start'),stop=document.getElementById('stop');
let id=sessionStorage.getItem('fr_manual_browser')||'',timer,blobUrl='',polling=false;
function timeLeft(expiresAt){const s=Math.max(0,Math.ceil((expiresAt-Date.now())/1000));return Math.floor(s/3600)+'h '+String(Math.floor(s/60)%60).padStart(2,'0')+'m '+String(s%60).padStart(2,'0')+'s';}
async function api(path,method='GET',body){
 const token=localStorage.getItem('am_token');
 if(!token)throw Error('Please sign in at the Dashboard link above, then return here.');
 const headers={Authorization:'Bearer '+token,'X-Admin-Browser-Session':id};
 if(body)headers['Content-Type']='application/json';
 const response=await fetch('/api/admin-browser'+path,{method,headers,body:body?JSON.stringify(body):undefined,cache:'no-store',referrerPolicy:'no-referrer'});
 if(!response.ok){const data=await response.json().catch(()=>({}));throw Object.assign(Error(response.status===401?'Please sign in to the dashboard again.':data.error||'Browser request failed'),{httpStatus:response.status});}
 return response;
}
function clearSession(){id='';sessionStorage.removeItem('fr_manual_browser');image.hidden=true;image.removeAttribute('src');controls.hidden=true;start.disabled=false;stop.disabled=true;clearTimeout(timer);if(blobUrl){URL.revokeObjectURL(blobUrl);blobUrl='';}}
async function poll(){
 clearTimeout(timer);
 if(!id||document.hidden||polling)return;
 polling=true;
 const session=id;
 try{
  const s=await(await api('/status')).json();
  if(session!==id)return;
  status.textContent=s.state==='opening'?'Opening the VPS browser…':s.state==='closed'?'Browser closed. '+(s.note||'You can open another session.'):'Live VPS browser · '+timeLeft(s.expiresAt)+' remaining'+(s.note?'\n'+s.note:'');
  if(s.state==='closed'){clearSession();return;}
  if(s.state==='ready'&&!document.hidden){
   const response=await api('/frame');const blob=await response.blob();if(session!==id)return;const next=URL.createObjectURL(blob);const old=blobUrl;blobUrl=next;image.onload=()=>{if(old)URL.revokeObjectURL(old);};image.src=next;image.hidden=false;controls.hidden=false;
  }
  timer=setTimeout(poll,1000);
 }catch(error){if(session!==id)return;status.textContent=error.message;if(error.httpStatus===401||error.httpStatus===404){clearSession();}else{timer=setTimeout(poll,2000);}}finally{polling=false;if(id&&session!==id&&!document.hidden){clearTimeout(timer);timer=setTimeout(poll,0);}}
}
document.addEventListener('visibilitychange',()=>{clearTimeout(timer);if(!document.hidden&&id)poll();});
start.addEventListener('click',async()=>{start.disabled=true;status.textContent='Requesting browser…';try{const data=await(await api('/start','POST')).json();id=data.id;sessionStorage.setItem('fr_manual_browser',id);stop.disabled=false;await poll();}catch(error){status.textContent=error.message;start.disabled=false;}});
stop.addEventListener('click',async()=>{stop.disabled=true;clearTimeout(timer);try{await api('/stop','POST');status.textContent='Browser closed.';clearSession();}catch(error){status.textContent=error.message;stop.disabled=false;}});
async function action(body){try{await api('/action','POST',body);}catch(error){status.textContent=error.message;}}
image.addEventListener('click',event=>{const rect=image.getBoundingClientRect();action({type:'click',x:Math.min(1279,Math.max(0,(event.clientX-rect.left)*1280/rect.width)),y:Math.min(719,Math.max(0,(event.clientY-rect.top)*720/rect.height))});});
document.getElementById('typing').addEventListener('submit',event=>{event.preventDefault();const input=document.getElementById('text');const text=input.value;input.value='';if(text)action({type:'text',text});});
document.querySelectorAll('[data-key]').forEach(button=>button.addEventListener('click',()=>action({type:'key',key:button.dataset.key})));
document.querySelectorAll('[data-scroll]').forEach(button=>button.addEventListener('click',()=>action({type:'scroll',delta:Number(button.dataset.scroll)})));
if(id){start.disabled=true;stop.disabled=false;poll();}
</script></main></body></html>`;
