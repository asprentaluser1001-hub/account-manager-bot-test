'use strict';
// Real Chromium, entirely intercepted local fixtures. No external accounts.
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {join}=require('node:path');
const dir=mkdtempSync(join(require('node:os').tmpdir(),'reset-browser-'));
process.env.DB_PATH=join(dir,'test.sqlite');process.env.SANDBOX_MODE='false';process.env.V3_PREVIEW='false';process.env.TELEGRAM_BOT_TOKEN='';
const {db}=require('../dist/db.js');require('../dist/lib/v3Features.js');
const {chromium}=require('playwright'),original=chromium.launch.bind(chromium);
const {resetAccountPassword}=require('../dist/lib/passwordReset.js');
let external='old-password',changes=0,engines=0,contexts=[],logins=[],blockVerification=false,keepForm=true;
const browsers=[];
const html=`<!doctype html><title>Local reset fixture</title>
<button class="login-mdl red-lnk" onclick="this.hidden=true;document.getElementById('login').hidden=false">Log in</button>
<div id="login" hidden><input id="user-email"><input id="user-pass" type="password"><button class="rlt-login">Log in</button><p id="error"></p></div>
<button class="mw-user red-lnk" hidden>My Account</button><button class="fi-pencil chn-pass-mdl" hidden>Change password</button>
<div id="change" hidden><input id="curr-pass" type="password"><input id="chng-new-pass" type="password"><input id="chng-new-pass-conf" type="password"><button class="rlt-change-pass">Save</button></div>
<script>
document.querySelector('.rlt-login').onclick=async()=>{
 const r=await fetch('/login',{method:'POST',body:JSON.stringify({email:document.getElementById('user-email').value,password:document.getElementById('user-pass').value})});
 if(!r.ok){document.getElementById('error').textContent='Incorrect password';return;}
 document.cookie='fixture-session=authenticated; Path=/';localStorage.setItem('fixture-session','authenticated');
 document.getElementById('login').hidden=true;document.querySelector('.mw-user').hidden=false;
};
document.querySelector('.mw-user').onclick=()=>{document.querySelector('.fi-pencil').hidden=false;};
document.querySelector('.fi-pencil').onclick=()=>{document.getElementById('change').hidden=false;};
document.querySelector('.rlt-change-pass').onclick=async()=>{
 const r=await fetch('/change-password',{method:'POST',body:JSON.stringify({current:document.getElementById('curr-pass').value,password:document.getElementById('chng-new-pass').value})});
 const result=await r.json();if(result.clear)document.getElementById('change').hidden=true;
};
</script>`;
chromium.launch=async options=>{
 engines++;
 const browser=await original({...options,...(process.env.BROWSER_TEST_EXECUTABLE?{executablePath:process.env.BROWSER_TEST_EXECUTABLE}:{})});
 browsers.push(browser);const newContext=browser.newContext.bind(browser);
 browser.newContext=async options=>{
  const context=await newContext(options),index=contexts.length;contexts.push(context);
  assert.deepEqual(await context.storageState(),{cookies:[],origins:[]},'login storage leaked into verification');
  await context.route('**/*',async route=>{
   const request=route.request(),url=new URL(request.url());
   assert.equal(url.origin,'https://flingster.com','fixture attempted an external request');
   if(url.pathname==='/')return route.fulfill({status:blockVerification&&index===1?403:200,contentType:'text/html',
    body:blockVerification&&index===1?'<title>Just a moment...</title>':html});
   if(url.pathname==='/login'){
    assert.ok(!request.headers().cookie,'verification inherited the existing login cookie');
    const data=JSON.parse(request.postData());logins.push(data.password);
    return route.fulfill({status:data.password===external?200:401,contentType:'application/json',body:'{}'});
   }
   if(url.pathname==='/change-password'){
    assert.match(request.headers().cookie||'',/fixture-session=authenticated/);
    const data=JSON.parse(request.postData());assert.equal(data.current,external);
    external=data.password;changes++;
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({clear:!keepForm})});
   }
   return route.abort();
  });
  return context;
 };
 return browser;
};
function add(id){db.prepare('INSERT INTO accounts(id,name,email,password,created_at) VALUES (?,?,?,?,?)').run(id,id,id+'@example.invalid','old-password',new Date().toISOString());}
(async()=>{
 try{
  add('success');let result=await resetAccountPassword('success');
  assert.equal(result.success,true,result.error);assert.equal(engines,1);assert.equal(contexts.length,2);assert.equal(changes,1);
  assert.deepEqual(logins,['old-password',external]);assert.ok(browsers.every(browser=>!browser.isConnected()));
  assert.equal(db.prepare('SELECT password FROM accounts WHERE id=?').get('success').password,external);
  console.log('One real Chromium engine verified a changed password in isolated storage while the original form stayed open.');
  external='old-password';contexts=[];logins=[];engines=0;changes=0;keepForm=false;blockVerification=true;
  add('blocked');result=await resetAccountPassword('blocked');
  assert.equal(result.success,false);assert.equal(result.errorCode,'site_blocked');assert.equal(result.retryable,false);
  let saved=db.prepare('SELECT password,reset_candidate_password FROM accounts WHERE id=?').get('blocked');
  assert.equal(saved.password,'old-password');assert.equal(saved.reset_candidate_password,external);assert.equal(changes,1);
  contexts=[];logins=[];engines=0;blockVerification=false;
  result=await resetAccountPassword('blocked');
  assert.equal(result.success,true,result.error);assert.equal(engines,1);assert.equal(contexts.length,1);
  assert.equal(changes,1,'candidate recovery submitted another password change');
  assert.deepEqual(logins,[external]);saved=db.prepare('SELECT password,reset_candidate_password FROM accounts WHERE id=?').get('blocked');
  assert.equal(saved.password,external);assert.equal(saved.reset_candidate_password,null);
  assert.ok(browsers.every(browser=>!browser.isConnected()));
  console.log('Verification block preserved both credentials; recovery verified the candidate without another change. No external website requested.');
 }finally{for(const browser of browsers)await browser.close().catch(()=>{});db.close();rmSync(dir,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
