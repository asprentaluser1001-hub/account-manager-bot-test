import {Router} from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {db} from '../db';
import {adminAuth} from '../auth';
import {auditLog} from '../lib/v3Features';

export const v3OpsRouter=Router();
v3OpsRouter.use(adminAuth);
const dbPath=process.env.DB_PATH||'';
const backups=path.join(path.dirname(dbPath),'backups');
function previewOnly(){if(process.env.V3_PREVIEW!=='true'||process.env.SANDBOX_MODE!=='true'||path.basename(dbPath)!=='v3-preview.db'||!path.resolve(dbPath).includes('flingroulette-v3'))throw new Error('Preview operations are disabled outside the isolated V3 database.');}

v3OpsRouter.get('/health',(_req,res)=>{
 try{previewOnly();const integrity=db.prepare('PRAGMA quick_check').get() as {quick_check:string};const disk=fs.statfsSync(path.dirname(dbPath));return res.json({ok:integrity.quick_check==='ok',database:integrity.quick_check,uptimeSeconds:Math.floor(process.uptime()),freeDiskBytes:disk.bavail*disk.bsize,freeMemoryBytes:os.freemem(),paymentMode:'mock',preview:true});}
 catch(e){return res.status(503).json({ok:false,error:e instanceof Error?e.message:'Health unavailable'});}
});
v3OpsRouter.get('/backups',(_req,res)=>{
 try{previewOnly();const files=fs.existsSync(backups)?fs.readdirSync(backups).filter(name=>/^v3-preview-\d{8}-\d{6}-[a-f0-9]{8}\.sqlite$/.test(name)).map(name=>({name,bytes:fs.statSync(path.join(backups,name)).size})).sort((a,b)=>b.name.localeCompare(a.name)):[];return res.json({files});}
 catch(e){return res.status(500).json({error:e instanceof Error?e.message:'Could not list backups'});}
});
v3OpsRouter.post('/backup',(_req,res)=>{
 try{previewOnly();fs.mkdirSync(backups,{recursive:true,mode:0o700});const now=new Date(),stamp=now.toISOString().replace(/[-:T]/g,'').slice(0,14),suffix=require('crypto').randomBytes(4).toString('hex');const filename=`v3-preview-${stamp.slice(0,8)}-${stamp.slice(8)}-${suffix}.sqlite`,target=path.join(backups,filename);
  // Target is generated internally; SQLite VACUUM INTO makes a consistent snapshot.
  db.exec(`VACUUM INTO '${target}'`);return res.status(201).json({name:filename,bytes:fs.statSync(target).size});
 }catch(e){return res.status(500).json({error:e instanceof Error?e.message:'Backup failed'});}
});
v3OpsRouter.get('/audit',(_req,res)=>res.json({entries:auditLog()}));
