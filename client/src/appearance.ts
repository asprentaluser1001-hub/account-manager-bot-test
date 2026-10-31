import {useEffect} from 'react';

export type Appearance = {accentColor:string;wallpaperUrl:string|null;revision:string};
export const DEFAULT_ACCENT = '#086b78';
const EVENT = 'appearance-updated';
const CACHE = 'fr_appearance_v7';
let analyzedWallpaper = '';
function analyzeWallpaper(url:string) {
  if(analyzedWallpaper===url)return;
  analyzedWallpaper=url;
  const image=new Image();
  image.onload=()=>{
    if(analyzedWallpaper!==url)return;
    try{
      const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;
      const ctx=canvas.getContext('2d');if(!ctx)return;ctx.drawImage(image,0,0,16,16);
      const pixels=ctx.getImageData(0,0,16,16).data;let luminance=0;
      for(let i=0;i<pixels.length;i+=4)luminance+=.2126*pixels[i]+.7152*pixels[i+1]+.0722*pixels[i+2];
      document.documentElement.dataset.wallpaperDark=String(luminance/(256*255)<.58);
    }catch{/* Retain the existing foreground if the image cannot be sampled. */}
  };
  image.src=url;
}

function apply(value:Appearance) {
  if(!/^#[0-9a-f]{6}$/i.test(value.accentColor))return;
  const root=document.documentElement;
  root.dataset.customAccent=String(value.accentColor.toLowerCase()!==DEFAULT_ACCENT);
  root.style.setProperty('--app-accent',value.accentColor);
  const channels=[1,3,5].map(i=>parseInt(value.accentColor.slice(i,i+2),16));
  // Darken the accent on light glass so even a pale/yellow choice has readable text.
  const ink='#'+channels.map(n=>Math.round(n*.48).toString(16).padStart(2,'0')).join('');
  root.style.setProperty('--app-accent-ink',ink);
  const wallpaper=value.wallpaperUrl;
  if(wallpaper&&/^\/api\/appearance\/wallpaper\?v=[a-z0-9-]+$/i.test(wallpaper)) {
    root.style.setProperty('--app-wallpaper',`url("${wallpaper}")`);
    root.dataset.customWallpaper='true';
    analyzeWallpaper(wallpaper);
  } else {root.style.removeProperty('--app-wallpaper');delete root.dataset.customWallpaper;delete root.dataset.wallpaperDark;analyzedWallpaper='';}
}
export function publishAppearance(value:Appearance) {
  apply(value);
  try{localStorage.setItem(CACHE,JSON.stringify(value));}catch{/* Storage may be unavailable in private webviews. */}
  window.dispatchEvent(new CustomEvent(EVENT,{detail:value}));
}
export function useAppearance() {
  useEffect(()=>{
    let active=true, pending=false;
    try{const cached=localStorage.getItem(CACHE);if(cached)apply(JSON.parse(cached));}catch{/* Fetch authoritative settings below. */}
    const refresh=async()=>{if(pending||document.hidden)return;pending=true;try{const r=await fetch('/api/appearance',{cache:'no-store'});if(r.ok&&active)publishAppearance(await r.json());}catch{/* Retain current design when offline. */}finally{pending=false;}};
    const onStorage=(e:StorageEvent)=>{if(e.key===CACHE&&e.newValue)try{apply(JSON.parse(e.newValue));}catch{/* Ignore invalid local cache. */}};
    void refresh();const interval=setInterval(refresh,15000);
    document.addEventListener('visibilitychange',refresh);window.addEventListener('storage',onStorage);
    return()=>{active=false;clearInterval(interval);document.removeEventListener('visibilitychange',refresh);window.removeEventListener('storage',onStorage);};
  },[]);
}
