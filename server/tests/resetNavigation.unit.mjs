import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {findResetAccount,openResetLogin,openVerificationLogin,ResetNavigationError}=require('../dist/lib/resetNavigation.js');
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
