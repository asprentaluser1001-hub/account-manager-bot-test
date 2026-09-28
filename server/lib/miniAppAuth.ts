import {createHmac,timingSafeEqual} from 'crypto';

export type MiniAppUser={id:string;name:string};

export function verifyMiniAppData(raw:string,botToken:string,now=Date.now()):MiniAppUser {
 if(!botToken||!raw||raw.length>4096)throw new Error('Open this page from the FlingRoulette Telegram bot.');
 const params=new URLSearchParams(raw),hash=params.get('hash');
 if(!hash||!(/^[a-f0-9]{64}$/i).test(hash))throw new Error('Invalid Telegram session');
 const entries=[...params.entries()];
 if(new Set(entries.map(([key])=>key)).size!==entries.length)throw new Error('Invalid Telegram session');
 // Bot-token HMAC signs every received field except hash. The Ed25519
 // third-party scheme excludes signature as well, but that is a different check.
 const signed=entries.filter(([key])=>key!=='hash').sort(([a],[b])=>a.localeCompare(b)).map(([key,value])=>`${key}=${value}`).join('\n');
 const key=createHmac('sha256','WebAppData').update(botToken).digest();
 const expected=createHmac('sha256',key).update(signed).digest();
 if(!timingSafeEqual(Buffer.from(hash,'hex'),expected))throw new Error('Invalid Telegram session');
 const authDate=Number(params.get('auth_date'));
 if(!Number.isSafeInteger(authDate)||authDate*1000>now+60_000||now-authDate*1000>24*60*60_000)throw new Error('Telegram session expired. Reopen the Mini App.');
 let user:unknown;
 try{user=JSON.parse(params.get('user')||'null')}catch{throw new Error('Invalid Telegram user')}
 if(!user||typeof user!=='object')throw new Error('Invalid Telegram user');
 const data=user as {id?:unknown;first_name?:unknown;last_name?:unknown};
 const id=String(data.id??'');
 if(!/^\d{1,16}$/.test(id)||!Number.isSafeInteger(Number(id)))throw new Error('Invalid Telegram user');
 const name=[data.first_name,data.last_name].filter(item=>typeof item==='string').join(' ').trim().slice(0,64)||'Telegram customer';
 return {id,name};
}
