import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {findResetAccount,openResetLogin,openVerificationLogin,loginForPasswordReset,ResetNavigationError}=require('../dist/lib/resetNavigation.js');
const invisible=()=>({all:async()=>[]});
const visible=()=>({all:async()=>[{isVisible:async()=>true,click:async()=>{}}]});

test('unknown login state is non-retryable and does not reveal page contents',async()=>{
 const page={locator:()=>invisible(),getByRole:()=>invisible(),getByText:()=>invisible(),title:async()=>'',waitForTimeout:async()=>new Promise(r=>setTimeout(r,1))};
 await assert.rejects(()=>findResetAccount(page,new AbortController().signal,3),error=>{
  assert.ok(error instanceof ResetNavigationError);
  assert.match(error.message,/authentication unconfirmed/);
  return true;
 });
});

test('visible semantic account link can confirm the account view without legacy classes',async()=>{
 const link={isVisible:async()=>true,click:async()=>{}};
 const page={locator:()=>invisible(),getByRole:(role)=>role==='link'?{all:async()=>[link]}:invisible(),getByText:()=>invisible(),waitForTimeout:async()=>{}};
 assert.equal(await findResetAccount(page,new AbortController().signal,50),link);
});

test('delayed login form resolves once visible; login control clicked only once',async()=>{
 let clicked=0, email=false;
 const page={
  locator:(selector)=>selector==='#user-email'?(email?visible():invisible()):selector==='.login-mdl.red-lnk'?{all:async()=>[{isVisible:async()=>true,click:async()=>{clicked++}}]}:invisible(),
  getByRole:()=>invisible(),getByText:()=>invisible(),title:async()=>'',
  waitForTimeout:async()=>{},
  waitForSelector:async()=>{email=true}
 };
 await openResetLogin(page,new AbortController().signal,50);
 assert.equal(clicked,1);
});

test('verification reloads once after form timeout without any password submission',async()=>{
 let reloads=0, clicks=0;
 const fail=Object.assign(new Error('Timeout 3ms exceeded'),{name:'TimeoutError'});
 const page={
  locator:(selector)=>selector==='#user-email'?(reloads?visible():invisible()):selector==='.login-mdl.red-lnk'?{all:async()=>[{isVisible:async()=>true,click:async()=>{clicks++}}]}:invisible(),
  getByRole:()=>invisible(),getByText:()=>invisible(),title:async()=>'',
  waitForTimeout:async()=>new Promise(r=>setTimeout(r,1)),
  waitForSelector:async()=>{throw fail},
  goto:async()=>{reloads++;return {status:()=>200}}
 };
 await openVerificationLogin(page,new AbortController().signal,'https://example.invalid/',7,40);
 assert.equal(reloads,1);
 assert.equal(clicks,1);
});

test('verification challenge stops without reloading the page',async()=>{
 let reloads=0;
 const page={
  locator:()=>invisible(),getByRole:()=>invisible(),
  getByText:()=>visible(),title:async()=> 'Verification required',
  waitForTimeout:async()=>{},
  goto:async()=>{reloads++;return {status:()=>200}}
 };
 await assert.rejects(()=>openVerificationLogin(page,new AbortController().signal,'https://example.invalid/',20,20),/challenge/i);
 assert.equal(reloads,0);
});

test('cancellation prevents verification retry',async()=>{
 const ctrl=new AbortController();ctrl.abort();
 const page={goto:async()=>{throw new Error('should not load')}};
 await assert.rejects(()=>openVerificationLogin(page,ctrl.signal,'https://example.invalid/',3,3));
});

test('unconfirmed initial login retries once before the password-change step',async()=>{
 let reloads=0,loginClicks=0,passwordChangeClicks=0;
 const account={isVisible:async()=>true,click:async()=>{}};
 const page={
  locator:(selector)=>{
   if(selector==='#user-email')return visible();
   if(selector==='.mw-user.red-lnk'&&reloads===1&&loginClicks===2)return {all:async()=>[account]};
   return invisible();
  },
  getByRole:()=>invisible(),getByText:()=>invisible(),title:async()=> '',
  waitForTimeout:async()=>new Promise(r=>setTimeout(r,1)),
  fill:async()=>{},
  click:async(selector)=>{if(selector==='button.rlt-login')loginClicks++;if(selector==='button.rlt-change-pass')passwordChangeClicks++;},
  goto:async()=>{reloads++;return {status:()=>200}}
 };
 const result=await loginForPasswordReset(page,new AbortController().signal,'https://example.invalid/','test@example.invalid','sample',10);
 assert.equal(result,account);assert.equal(reloads,1);assert.equal(loginClicks,2);assert.equal(passwordChangeClicks,0);
});

test('explicit wrong-password error stops without retrying login',async()=>{
 let reloads=0,logins=0;
 const page={
  locator:(selector)=>selector==='#user-email'?visible():invisible(),
  getByRole:()=>invisible(),
  getByText:(pattern)=>pattern.test('Incorrect password')?visible():invisible(),
  title:async()=> '',waitForTimeout:async()=>{},
  fill:async()=>{},click:async()=>{logins++},
  goto:async()=>{reloads++;return {status:()=>200}}
 };
 await assert.rejects(()=>loginForPasswordReset(page,new AbortController().signal,'https://example.invalid/','test@example.invalid','secret',12),e=>{
  assert.ok(e instanceof ResetNavigationError);
  assert.equal(e.reason,'credentials_rejected');assert.ok(!e.message.includes('secret'));
  return true;
 });
 assert.equal(logins,1);assert.equal(reloads,0);
});

test('security challenge stops initial login retry',async()=>{
 let reloads=0;
 const page={
  locator:(selector)=>selector==='#user-email'?visible():invisible(),
  getByRole:()=>invisible(),getByText:()=>invisible(),title:async()=> 'Verification required',
  fill:async()=>{},click:async()=>{},waitForTimeout:async()=>{},
  goto:async()=>{reloads++;return {status:()=>200}}
 };
 await assert.rejects(()=>loginForPasswordReset(page,new AbortController().signal,'https://example.invalid/','test@example.invalid','sample',12),e=>{
  assert.equal(e.reason,'challenge');return true;
 });
 assert.equal(reloads,0);
});

test('missing signed-in menu with hidden login form does not retry credentials',async()=>{
 let reloads=0,logins=0,loginVisible=true;
 const page={
  locator:(selector)=>selector==='#user-email'&&loginVisible?visible():invisible(),
  getByRole:()=>invisible(),getByText:()=>invisible(),title:async()=> '',
  fill:async()=>{},click:async()=>{logins++;loginVisible=false},
  waitForTimeout:async()=>new Promise(r=>setTimeout(r,1)),
  goto:async()=>{reloads++;return {status:()=>200}}
 };
 await assert.rejects(()=>loginForPasswordReset(page,new AbortController().signal,'https://example.invalid/','test@example.invalid','sample',10),e=>{
  assert.equal(e.reason,'layout_changed');return true;
 });
 assert.equal(logins,1);assert.equal(reloads,0);
});
