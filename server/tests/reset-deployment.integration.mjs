import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
const require=createRequire(import.meta.url),helper=require('../scripts/reset-db-backup.cjs');
const dir=mkdtempSync(join(tmpdir(),'reset-deploy-'));
after(()=>rmSync(dir,{recursive:true,force:true}));

test('SQLite snapshot includes committed WAL data and refuses to overwrite a backup',async()=>{
 const source=join(dir,'live.sqlite'),target=join(dir,'backup.sqlite'),db=new DatabaseSync(source);
 try{
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE state(password TEXT);');
  db.prepare('INSERT INTO state VALUES (?)').run('committed-in-wal');
  await helper.snapshot(source,target);
  const copy=new DatabaseSync(target,{readOnly:true});
  try{assert.equal(copy.prepare('SELECT password FROM state').get().password,'committed-in-wal');}finally{copy.close();}
  assert.equal(statSync(target).mode&0o777,0o600);
  await assert.rejects(helper.snapshot(source,target),/already exists/);
 }finally{db.close();}
});

test('rollback pauses unfinished jobs and holds IDs without reverting their latest credentials',()=>{
 const file=join(dir,'rollback.sqlite'),db=new DatabaseSync(file);
 try{
  db.exec(`CREATE TABLE accounts(id TEXT PRIMARY KEY,password TEXT,reset_candidate_password TEXT,sold INTEGER,sold_until TEXT);
   CREATE TABLE auto_reset_schedule(account_id TEXT PRIMARY KEY,run_at TEXT,status TEXT,created_at TEXT);
   CREATE TABLE manual_reset_jobs(account_id TEXT,status TEXT,stage TEXT,error TEXT,finished_at TEXT,updated_at TEXT);`);
  db.prepare('INSERT INTO accounts VALUES (?,?,?,?,?)').run('id','latest-verified-password','preserved-candidate',0,'2026-01-01');
  db.prepare('INSERT INTO manual_reset_jobs(account_id,status) VALUES (?,?)').run('id','retrying');
 }finally{db.close();}
 helper.quarantineForRollback(file);
 const current=new DatabaseSync(file);
 try{
  const row=current.prepare('SELECT * FROM accounts').get();
  assert.equal(row.password,'latest-verified-password');assert.equal(row.reset_candidate_password,'preserved-candidate');
  assert.equal(row.sold,1);assert.equal(row.sold_until,null);
  assert.equal(current.prepare('SELECT status FROM auto_reset_schedule').get().status,'failed');
  assert.equal(current.prepare('SELECT status FROM manual_reset_jobs').get().status,'cancelled');
 }finally{current.close();}
});

test('deployment resolves the actual service DB_PATH and its dotenv fallback without exposing other variables',async()=>{
 const file=join(dir,'service.sqlite'),db=new DatabaseSync(file);db.close();
 for(const useEnvironment of [true,false]){
  const env={...process.env,ADMIN_PASSWORD:'must-never-be-printed'};delete env.DB_PATH;
  if(useEnvironment)env.DB_PATH='service.sqlite';
  else writeFileSync(join(dir,'.env'),'DB_PATH=service.sqlite\nADMIN_PASSWORD=also-private\n');
  const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{cwd:dir,env,stdio:'ignore'});
  await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
  try{assert.equal(helper.serviceDatabasePath(child.pid),file);}
  finally{const closed=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGTERM');await closed;}
 }
});
