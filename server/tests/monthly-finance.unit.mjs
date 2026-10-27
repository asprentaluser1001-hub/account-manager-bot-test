import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const require=createRequire(import.meta.url);
const {indiaMonthWindow}=require('../dist/lib/reportingPeriod.js');

test('India month boundaries are independent of UTC month and handle year/leap transitions',()=>{
 const september=indiaMonthWindow(new Date('2026-09-30T18:29:59.999Z'));
 const october=indiaMonthWindow(new Date('2026-09-30T18:30:00.000Z'));
 assert.equal(september.cutoff,'2026-09-01');assert.equal(october.cutoff,'2026-10-01');
 assert.equal(october.start,'2026-09-30T18:30:00.000Z');assert.equal(october.end,'2026-10-31T18:30:00.000Z');
 const january=indiaMonthWindow(new Date('2026-12-31T18:30:00.000Z'));
 assert.equal(january.cutoff,'2027-01-01');assert.equal(january.end,'2027-01-31T18:30:00.000Z');
 const february=indiaMonthWindow(new Date('2028-02-15T00:00:00Z'));
 assert.equal(february.end,'2028-02-29T18:30:00.000Z');
});

test('monthly overview and detailed finance agree, preserve history and retain cross-month seven-day chart data',()=>{
 const dir=mkdtempSync(join(tmpdir(),'fr-monthly-finance-'));
 Object.assign(process.env,{DB_PATH:join(dir,'report.db'),V3_PREVIEW:'false',SANDBOX_MODE:'false'});
 const {db}=require('../dist/db.js');
 const orders=require('../dist/lib/testOrders.js');
 const {financeReport}=require('../dist/lib/v3Features.js');
 const insert=(id,amount,approved,status='delivered',hidden=0)=>db.prepare('INSERT INTO test_orders(id,chat_id,username,hours,amount,status,created_at,approved_at,history_hidden) VALUES (?,?,?,?,?,?,?,?,?)').run(id,'web','Sample report fixture',1,amount,status,approved||'2026-10-02T00:00:00.000Z',approved,hidden);
 try{
  insert('old',90,'2026-09-30T18:29:59.999Z');
  insert('month-start',100,'2026-09-30T18:30:00.000Z');
  insert('month-end',150,'2026-10-31T18:29:59.999Z','expired');
  insert('next-month',200,'2026-10-31T18:30:00.000Z');
  insert('hidden',300,'2026-10-01T00:00:00.000Z','delivered',1);
  insert('unpaid',400,null,'awaiting_payment_claim');
  insert('failed-current',0,'2026-10-02T00:00:00.000Z','payment_gateway_error');
  insert('failed-old',0,'2026-09-30T18:00:00.000Z','rejected');
  const now=new Date('2026-10-02T00:00:00.000Z');
  const summary=orders.summary(now),finance=orders.finance(now),report=financeReport(now);
  assert.equal(summary.revenue,250);assert.equal(summary.sales,2);
  assert.equal(report.total,summary.revenue);assert.equal(report.successful,summary.sales);assert.equal(report.failed,1);
  assert.deepEqual(report.monthly,[{period:'2026-10',bookings:2,revenue:250}]);
  assert.equal(report.cutoff,'2026-10-01');assert.equal(report.until,'2026-11-01');
  assert.equal(finance.cutoff,'2026-10-01');assert.equal(finance.until,'2026-11-01');
  assert.ok(finance.days.some(row=>row.day==='2026-09-30'&&row.amount===90));
  assert.equal(finance.days.filter(row=>row.day>=finance.cutoff&&row.day<finance.until).reduce((sum,row)=>sum+row.amount,0),250);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM test_orders').get().n,8,'reporting does not delete history');
  const november=orders.summary(new Date('2026-10-31T18:30:00.000Z'));
  assert.equal(november.revenue,200);assert.equal(november.sales,1);
  const empty=financeReport(new Date('2027-01-05T00:00:00Z'));
  assert.equal(empty.total,0);assert.equal(empty.failed,0);assert.deepEqual(empty.daily,[]);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
