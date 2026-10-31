import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';

test('shared appearance requires admin writes and survives a fresh process',async t=>{
  const dir=mkdtempSync(path.join(tmpdir(),'fr-appearance-'));
  process.env.DB_PATH=path.join(dir,'test.db');
  process.env.JWT_SECRET='appearance-test-secret-at-least-32-characters';
  process.env.ADMIN_PASSWORD='appearance-test-password';
  const require=createRequire(import.meta.url);
  const express=require('express'),jwt=require('jsonwebtoken');
  const {appearanceRouter}=await import('../dist/routes/appearance.js');
  const {db}=await import('../dist/db.js');
  const app=express();app.use('/api/appearance',appearanceRouter);
  app.use((err,_req,res,_next)=>res.status(err.status||500).json({error:err.message}));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  t.after(()=>{server.close();db.close();rmSync(dir,{recursive:true,force:true});});
  const base=`http://127.0.0.1:${server.address().port}/api/appearance`;
  const auth={Authorization:`Bearer ${jwt.sign({role:'admin'},process.env.JWT_SECRET)}`};
  const read=async()=>{const response=await fetch(base);assert.equal(response.status,200);return response.json();};
  assert.deepEqual({...await read(),revision:'ignored'},{accentColor:'#086b78',wallpaperUrl:null,revision:'ignored'});
  for(const [method,suffix] of [['PATCH',''],['POST','/wallpaper'],['DELETE','/wallpaper'],['DELETE','']]){
    assert.equal((await fetch(base+suffix,{method})).status,401);
  }
  let response=await fetch(base,{method:'PATCH',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({accentColor:'url(https://invalid.example)'})});
  assert.equal(response.status,400);
  response=await fetch(base,{method:'PATCH',headers:{...auth,'Content-Type':'application/json'},body:JSON.stringify({accentColor:'#B42343'})});
  assert.equal(response.status,200);assert.equal((await response.json()).accentColor,'#b42343');
  const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8ioAAAAASUVORK5CYII=','base64');
  response=await fetch(base+'/wallpaper',{method:'POST',headers:{...auth,'Content-Type':'image/png'},body:image});
  assert.equal(response.status,200);
  const saved=await response.json();assert.equal(saved.accentColor,'#b42343');assert.match(saved.wallpaperUrl,/^\/api\/appearance\/wallpaper\?v=/);
  const asset=await fetch(new URL(saved.wallpaperUrl,base));
  assert.equal(asset.headers.get('content-type'),'image/png');
  assert.equal(asset.headers.get('x-content-type-options'),'nosniff');
  assert.deepEqual(Buffer.from(await asset.arrayBuffer()),image);
  // Fresh process observes the saved values, rather than a browser/local cache.
  const result=execFileSync(process.execPath,['-e',"const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(process.env.DB_PATH);console.log(JSON.stringify(db.prepare('SELECT accent_color, length(wallpaper) AS bytes FROM appearance_settings').get()));db.close()"],{env:process.env,encoding:'utf8'});
  assert.deepEqual(JSON.parse(result),{accent_color:'#b42343',bytes:image.length});
  response=await fetch(base+'/wallpaper',{method:'POST',headers:{...auth,'Content-Type':'image/png'},body:'not an image'});assert.equal(response.status,400);
  response=await fetch(base+'/wallpaper',{method:'POST',headers:{...auth,'Content-Type':'image/svg+xml'},body:'<svg/>'});assert.equal(response.status,400);
  response=await fetch(base+'/wallpaper',{method:'POST',headers:{...auth,'Content-Type':'image/png'},body:Buffer.alloc(3*1024*1024+1)});assert.equal(response.status,413);
  assert.equal((await read()).wallpaperUrl,saved.wallpaperUrl,'failed uploads preserve wallpaper');
  response=await fetch(base+'/wallpaper',{method:'DELETE',headers:auth});assert.equal(response.status,200);
  const restored=await read();assert.equal(restored.wallpaperUrl,null);assert.equal(restored.accentColor,'#b42343','wallpaper restore preserves accent');
  assert.equal((await fetch(base+'/wallpaper')).status,404);
  await fetch(base,{method:'DELETE',headers:auth});assert.equal((await read()).accentColor,'#086b78');
});
