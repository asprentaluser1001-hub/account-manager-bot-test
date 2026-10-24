'use strict';
const assert=require('node:assert/strict'),path=require('node:path');
const express=require('express'),{chromium}=require('playwright');
(async()=>{
 const app=express();app.use(express.json());
 const created=new Date().toISOString();
 const accounts=['A','B'].map(id=>({id,name:'Fixture '+id,email:id+'@example.invalid',password:'old-'+id,sold:id==='B',soldUntil:null,
  last_reset_at:null,created_at:created,autoResetAt:null,autoResetStatus:null,resetJob:null}));
 const counts={reset:0,release:0},jobs=new Map(),polls=new Map();
 const finish=id=>{const account=accounts.find(a=>a.id===id),job=jobs.get(id);job.status='succeeded';job.stage='Password verified';job.newPassword='verified-'+id;account.password=job.newPassword;account.sold=false;account.resetJob=null;};
 app.get('/api/accounts',(_req,res)=>res.json({accounts}));
 app.get('/api/history',(_req,res)=>res.json({history:[]}));
 app.post('/api/accounts/:id/:action',(req,res)=>{
  assert.equal(req.headers.authorization,'Bearer fixture-admin-token');
  const {id,action}=req.params;assert.ok(['reset-password','release'].includes(action));
  if(action==='release')counts.release++;else counts.reset++;
  const job={id:'job-'+id,status:'queued',stage:'Queued',attempts:0,nextAttemptAt:null};jobs.set(id,job);
  const account=accounts.find(a=>a.id===id);account.sold=true;account.resetJob=job;
  res.status(202).json({job});
 });
 app.get('/api/accounts/:id/reset-jobs/:jobId',(req,res)=>{
  const {id}=req.params,job=jobs.get(id);assert.equal(job.id,req.params.jobId);
  polls.set(id,(polls.get(id)||0)+1);
  if(id==='A'&&polls.get(id)>=2)finish(id);
  else{job.status='running';job.stage='Verifying password';job.attempts=1;}
  res.json({job});
 });
 app.use('/api',(_req,res)=>res.json({}));
 app.use(express.static(path.resolve(__dirname,'../../client/dist')));
 const server=await new Promise(resolve=>{const server=app.listen(0,'127.0.0.1',()=>resolve(server));});
 const browser=await chromium.launch({headless:true,args:['--no-sandbox'],...(process.env.BROWSER_TEST_EXECUTABLE?{executablePath:process.env.BROWSER_TEST_EXECUTABLE}:{})});
 try{
  const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await context.addInitScript(()=>localStorage.setItem('am_token','fixture-admin-token'));
  const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const url='http://127.0.0.1:'+server.address().port+'/?tab=accounts';await page.goto(url);
  const card=id=>page.locator('div.relative.bg-white').filter({has:page.getByRole('heading',{name:'Fixture '+id,exact:true})});
  await card('A').getByRole('button',{name:'Reset password',exact:true}).click();
  await card('A').getByText('◷ Queued',{exact:true}).waitFor();
  assert.equal(await card('A').getByRole('button',{name:'Reset in progress…',exact:true}).isDisabled(),true);
  await card('A').getByText('✓ New password: verified-A',{exact:true}).waitFor({timeout:12000});
  assert.equal(counts.reset,1);
  await card('B').getByRole('button',{name:'Release & reset',exact:true}).click();
  await card('B').getByText('◷ Queued',{exact:true}).waitFor();
  await page.reload();
  await card('B').getByRole('button',{name:'Reset in progress…',exact:true}).waitFor();
  assert.equal(await card('B').getByRole('button',{name:'Reset in progress…',exact:true}).isDisabled(),true);
  finish('B');
  await card('B').getByRole('button',{name:'Reset password',exact:true}).waitFor({timeout:7000});
  assert.equal(counts.release,1);assert.equal(counts.reset,1);assert.deepEqual(errors,[]);
  console.log('Mobile dashboard: background reset progress, verified success, reserved-account Release action and refresh recovery passed.');
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
