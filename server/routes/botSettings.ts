import {Router,json} from 'express';
import {adminAuth} from '../auth';
import {proofList,removeProof,setting,saveSetting,uploadProof} from '../lib/telegramBot';
export const botSettingsRouter=Router();
botSettingsRouter.use(adminAuth);
botSettingsRouter.get('/',(_req,res)=>res.json({supportUsername:setting('support_username'),proofs:proofList()}));
botSettingsRouter.put('/support',json(),(req,res)=>{
 const username=String(req.body.username||'').trim().replace(/^@/,'');
 if(username&&!/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(username))return res.status(400).json({error:'Enter a valid Telegram username, without a link.'});
 saveSetting('support_username',username);return res.json({ok:true});
});
botSettingsRouter.post('/proofs',json({limit:'22mb'}),async(req,res)=>{
 try{await uploadProof(String(req.body.dataUrl||''));res.status(201).json({ok:true});}
 catch(e){res.status(400).json({error:e instanceof Error?e.message:'Upload failed'});}
});
botSettingsRouter.delete('/proofs/:id',(req,res)=>{
 if(!/^\d+$/.test(req.params.id)||!removeProof(Number(req.params.id)))return res.status(404).json({error:'Proof not found'});
 return res.json({ok:true});
});
