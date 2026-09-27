import {useEffect,useState} from 'react';

export function usePreviewMode(){
 const [preview,setPreview]=useState(false);
 useEffect(()=>{fetch('/api/checkout/config').then(response=>response.json()).then(config=>setPreview(config.mockPayment===true)).catch(()=>{})},[]);
 return preview;
}
