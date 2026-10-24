'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Script } = require('node:vm');
process.env.ADMIN_PASSWORD = 'viewer-test-admin-password';
process.env.JWT_SECRET = 'viewer-test-secret-with-at-least-thirty-two-characters';
process.env.V3_PREVIEW = 'false';
const express = require('express');
const jwt = require('jsonwebtoken');
const { AdminBrowser, validateBrowserAction } = require('../dist/lib/adminBrowser.js');
const { createAdminBrowserRouter, serveAdminBrowserPage } = require('../dist/routes/adminBrowser.js');
const { adminBrowserPage } = require('../dist/lib/adminBrowserPage.js');
const { runResetJob } = require('../dist/lib/resetJobs.js');
const origin = 'https://dashboard.example';
const sid = 'a'.repeat(64);

function model() {
  const calls = [], handlers = {};
  const main = {};
  const page = {
    setDefaultTimeout() {}, mainFrame: () => main,
    waitForTimeout: async () => {},
    route: async (_pattern, handler) => { handlers.route = handler; },
    on: (event, handler) => { handlers[event] = handler; },
    goto: async url => { calls.push(['goto', url]); return { status: () => 403 }; },
    screenshot: async () => Buffer.from('test-frame'),
    mouse: { click: async (x,y) => calls.push(['click',x,y]), wheel: async (x,y) => calls.push(['wheel',x,y]) },
    keyboard: { insertText: async text => calls.push(['text',text]), press: async key => calls.push(['key',key]) },
  };
  let closes = 0;
  const launch = async () => ({ context: { pages: () => [page], on: (event,handler) => { handlers['context-'+event] = handler; } }, close: async () => { closes++; } });
  return { launch, calls, handlers, main, page, get closes() { return closes; } };
}
async function ready(browser, owner, id) {
  for (let i=0;i<30;i++) {
    const state=browser.status(owner,id).state;
    if(state==='ready')return;
    if(state==='closed')throw Error('Browser unexpectedly closed');
    await new Promise(setImmediate);
  }
  throw Error('Browser did not become ready');
}

test('viewer script parses and secrets are not embedded in the HTML', () => {
  const source = adminBrowserPage.match(/<script nonce="%NONCE%">([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new Script(source));
  assert.ok(!adminBrowserPage.includes(process.env.JWT_SECRET));
  assert.ok(!adminBrowserPage.includes(process.env.ADMIN_PASSWORD));
});

test('browser actions reject URLs, shell commands, shortcuts and out-of-bounds coordinates', () => {
  for(const action of [{type:'navigate',url:'file:///etc/passwd'},{type:'key',key:'Control+L'},{type:'key',key:'F12'},{type:'click',x:1280,y:0},{type:'click',x:NaN,y:0},{type:'text',text:'a'.repeat(501)},{type:'scroll',delta:100000}]) {
    assert.throws(()=>validateBrowserAction(action));
  }
  assert.equal(validateBrowserAction({type:'key',key:'Enter'}).key,'Enter');
});

test('manual browser owns the global queue, shows a challenge for the human, and cleans up on stop', async () => {
  const fake=model(), browser=new AdminBrowser(fake.launch), owner='owner';
  const {id}=browser.start(owner);
  let resetRan=false;
  const waiting=runResetJob('queued-after-manual',async()=>{resetRan=true;return {success:true};});
  try{
    await ready(browser,owner,id);
    assert.equal(browser.status(owner,id).httpStatus,403);
    assert.equal(resetRan,false);
    assert.throws(()=>browser.start(owner));
    assert.throws(()=>browser.status('another-owner',id));
    assert.throws(()=>browser.status(owner,'b'.repeat(64)));
    assert.equal((await browser.frame(owner,id)).toString(),'test-frame');
    await browser.action(owner,id,{type:'click',x:100,y:200});
    await browser.action(owner,id,{type:'text',text:'test-input'});
    assert.deepEqual(fake.calls,[['goto','https://flingster.com/'],['click',100,200],['text','test-input']]);
    let aborted=false,continued=false;
    await fake.handlers.route({request:()=>({isNavigationRequest:()=>true,frame:()=>fake.main,url:()=> 'https://example.invalid/'}),abort:async()=>{aborted=true;},continue:async()=>{continued=true;}});
    assert.equal(aborted,true);assert.equal(continued,false);
    await fake.handlers.route({request:()=>({isNavigationRequest:()=>true,frame:()=>fake.main,url:()=> 'https://flingster.com/account'}),abort:async()=>{throw Error('allowed URL aborted');},continue:async()=>{continued=true;}});
    assert.equal(continued,true);
  }finally{await browser.stop(owner,id);await waiting;}
  assert.equal(fake.closes,1);assert.equal(resetRan,true);
  assert.equal(browser.status(owner,id).state,'closed');
  await assert.rejects(()=>browser.frame(owner,id));
});

test('manual browser automatically closes at the existing two-minute job deadline',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const fake=model(),browser=new AdminBrowser(fake.launch),{id}=browser.start('owner');
  try{
    await ready(browser,'owner',id);
    t.mock.timers.tick(120_000);
    for(let i=0;i<10&&browser.status('owner',id).state!=='closed';i++)await new Promise(setImmediate);
    assert.equal(browser.status('owner',id).state,'closed');
    assert.equal(fake.closes,1);
  }finally{await browser.stop('owner',id);t.mock.timers.reset();}
});

test('launch failure closes the session and releases the reset queue',async()=>{
  const browser=new AdminBrowser(async()=>{throw Error('private system error');});
  const {id}=browser.start('owner');
  for(let i=0;i<20&&browser.status('owner',id).state!=='closed';i++)await new Promise(setImmediate);
  assert.equal(browser.status('owner',id).state,'closed');
  assert.ok(!browser.status('owner',id).note.includes('private system error'));
  assert.equal((await runResetJob('after-failed-manual',async()=>({success:true}))).success,true);
});

test('a transient first-frame capture error is retried once without navigating again',async()=>{
  const fake=model(),browser=new AdminBrowser(fake.launch),{id}=browser.start('owner');
  let frames=0;
  fake.page.screenshot=async()=>{if(++frames===1)throw Error('Protocol error: Unable to capture screenshot');return Buffer.from('frame');};
  try{
    await ready(browser,'owner',id);
    assert.equal((await browser.frame('owner',id)).toString(),'frame');
    assert.equal(frames,2);
    assert.deepEqual(fake.calls,[['goto','https://flingster.com/']]);
  }finally{await browser.stop('owner',id);}
});

test('service shutdown closes the manual browser and its profile before resolving',async()=>{
  const fake=model(),browser=new AdminBrowser(fake.launch),{id}=browser.start('owner');
  await ready(browser,'owner',id);
  await browser.shutdown();
  assert.equal(fake.closes,1);
  assert.equal(browser.status('owner',id).state,'closed');
});

test('viewer HTTP endpoints enforce feature flag, admin auth, origin and session headers',async()=>{
  const seen=[];
  const fake={start:owner=>{seen.push(owner);return {id:sid};},status:()=>({state:'ready'}),frame:async()=>Buffer.from('frame'),action:async()=>{},stop:async()=>{}};
  const app=express();app.use(express.json());app.get('/admin-browser',serveAdminBrowserPage);app.use('/api/admin-browser',createAdminBrowserRouter(fake));
  const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const base='http://127.0.0.1:'+server.address().port;
  const token=jwt.sign({role:'admin'},process.env.JWT_SECRET,{expiresIn:'1h'});
  const request=(path,method='GET',headers={},body)=>fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});
  const auth={Authorization:'Bearer '+token,Origin:origin,'X-Admin-Browser-Session':sid};
  try{
    delete process.env.ENABLE_ADMIN_BROWSER_DIAGNOSTICS;
    assert.equal((await request('/api/admin-browser/start','POST',auth)).status,404);
    process.env.ENABLE_ADMIN_BROWSER_DIAGNOSTICS='true';process.env.ADMIN_BROWSER_ORIGIN=origin;
    for(const path of ['/status','/frame','/start','/action','/stop']){
      assert.equal((await request('/api/admin-browser'+path,['/start','/action','/stop'].includes(path)?'POST':'GET')).status,401);
    }
    assert.equal((await request('/api/admin-browser/start','POST',{...auth,Origin:'https://evil.example'})).status,403);
    assert.equal((await request('/api/admin-browser/start','POST',{Authorization:'Bearer '+token})).status,403);
    const expired=jwt.sign({role:'admin'},process.env.JWT_SECRET,{expiresIn:-1});
    assert.equal((await request('/api/admin-browser/status','GET',{...auth,Authorization:'Bearer '+expired})).status,401);
    const started=await request('/api/admin-browser/start','POST',auth);assert.equal(started.status,200);assert.equal((await started.json()).id,sid);
    assert.equal(seen.length,1);assert.notEqual(seen[0],token);
    const frame=await request('/api/admin-browser/frame','GET',auth);assert.equal(frame.status,200);assert.match(frame.headers.get('content-type'),/image\/jpeg/);assert.equal(frame.headers.get('cache-control'),'no-store');
    assert.equal((await request('/api/admin-browser/frame','GET',{Authorization:'Bearer '+token})).status,404);
    const page=await request('/admin-browser');assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.ok(!(await page.text()).includes('%NONCE%'));
  }finally{await new Promise(resolve=>server.close(resolve));delete process.env.ENABLE_ADMIN_BROWSER_DIAGNOSTICS;delete process.env.ADMIN_BROWSER_ORIGIN;}
});
