import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);

test('V5.3 manual 30-minute booking uses the ₹60 plan',()=>{
 const dir=mkdtempSync(join(tmpdir(),'fr-v53-manual-'));
 process.env.DB_PATH=join(dir,'data.db');process.env.V3_PREVIEW='false';process.env.SANDBOX_MODE='true';
 const orders=require('../dist/lib/testOrders.js'),{db}=require('../dist/db.js');
 try{
  db.prepare('INSERT INTO accounts(id,name,email,password,created_at) VALUES (?,?,?,?,?)').run('manual-half-hour','Manual test account','manual@example.invalid','private-password',new Date().toISOString());
  const order=orders.createManualBooking('Manual customer','',0.5,orders.PRICES[0.5],'manual-half-hour','');
  assert.equal(order.hours,0.5);
  assert.equal(order.amount,60);
  assert.equal(order.source,'manual');
  assert.equal(Date.parse(order.expires_at)-Date.parse(order.created_at),30*60*1000);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
