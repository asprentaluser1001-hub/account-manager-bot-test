'use strict';
// Deployment helper: read only DB_PATH from the service, never print its env.
const fs=require('node:fs'),path=require('node:path');
const {DatabaseSync,backup}=require('node:sqlite');
function serviceDatabasePath(pid){
 if(!/^\d+$/.test(String(pid))||Number(pid)<=1)throw Error('A running service PID is required');
 const cwd=fs.realpathSync('/proc/'+pid+'/cwd');
 const entry=fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').find(value=>value.startsWith('DB_PATH='));
 let configured=entry?.slice('DB_PATH='.length);
 if(!configured&&fs.existsSync(path.join(cwd,'.env')))configured=require('dotenv').parse(fs.readFileSync(path.join(cwd,'.env'))).DB_PATH;
 const file=configured?path.resolve(cwd,configured):path.resolve(__dirname,'..','data.db');
 if(!fs.statSync(file).isFile())throw Error('Service database was not found; deployment stopped');
 return file;
}
async function snapshot(source,destination){
 if(fs.existsSync(destination))throw Error('Backup destination already exists');
 const db=new DatabaseSync(source,{readOnly:true});
 try{await backup(db,destination);fs.chmodSync(destination,0o600);}finally{db.close();}
}
function quarantineForRollback(file){
 if(!fs.existsSync(file))throw Error('Database missing; refusing rollback changes');
 const db=new DatabaseSync(file);
 try{
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='manual_reset_jobs'").get())return;
  const now=new Date().toISOString();db.exec('BEGIN IMMEDIATE');
  try{
   db.prepare("INSERT INTO auto_reset_schedule(account_id,run_at,status,created_at) SELECT account_id,?,'failed',? FROM manual_reset_jobs WHERE status IN ('queued','running','retrying') AND account_id IN (SELECT id FROM accounts) ON CONFLICT(account_id) DO UPDATE SET status='failed'").run(now,now);
   db.prepare("UPDATE accounts SET sold=1,sold_until=NULL WHERE id IN (SELECT account_id FROM manual_reset_jobs WHERE status IN ('queued','running','retrying'))").run();
   db.prepare("UPDATE manual_reset_jobs SET status='cancelled',stage='Paused after deployment rollback',error='Reset paused during rollback; review the saved credentials before retrying',finished_at=?,updated_at=? WHERE status IN ('queued','running','retrying')").run(now,now);
   db.exec('COMMIT');
  }catch(error){db.exec('ROLLBACK');throw error;}
 }finally{db.close();}
}
module.exports={serviceDatabasePath,snapshot,quarantineForRollback};
if(require.main===module)(async()=>{
 const [command,...args]=process.argv.slice(2);
 if(command==='resolve')console.log(serviceDatabasePath(args[0]));
 else if(command==='snapshot')await snapshot(args[0],args[1]);
 else if(command==='quarantine')quarantineForRollback(args[0]);
 else throw Error('Choose resolve, snapshot or quarantine');
})().catch(error=>{console.error(error.message);process.exitCode=1;});
