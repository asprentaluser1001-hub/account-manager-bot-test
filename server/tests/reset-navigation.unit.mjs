import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {openResetLogin,findResetAccount}=require('../dist/lib/resetNavigation.js');
const signal=()=>new AbortController().signal;
function control(shown,onClick=()=>{}){
 return {isVisible:async()=>shown,click:async(options)=>{assert.notEqual(options?.force,true);assert.ok(shown,'hidden control must never be clicked');onClick();}};
}
function page(selectors,text=[]){
 return {locator:key=>({all:async()=>selectors[key]||[]}),getByText:()=>({all:async()=>text}),waitForSelector:async()=>{},waitForTimeout:async()=>{}};
}
test('login selects visible duplicate rather than hidden first match',async()=>{
 let clicked=false;
 await openResetLogin(page({'.login-mdl.red-lnk':[control(false),control(true,()=>clicked=true)]}),signal());
 assert.equal(clicked,true);
});
test('already open login form needs no login trigger',async()=>{
 await openResetLogin(page({'#user-email':[control(true)]}),signal());
});
test('visible Login text is a fallback when old class is absent',async()=>{
 let clicked=false;
 await openResetLogin(page({},[control(false),control(true,()=>clicked=true)]),signal());
 assert.equal(clicked,true);
});
test('visible account does not require the hidden desktop menu',async()=>{
 const account=control(true);
 assert.equal(await findResetAccount(page({'.mw-user.red-lnk':[account],'.fi-menu':[control(false)]}),signal()),account);
});
test('mobile menu selects visible duplicate and waits for account',async()=>{
 const account=control(true),selectors={'.mw-user.red-lnk':[],'.fi-menu':[control(false),control(true,()=>selectors['.mw-user.red-lnk']=[account])]};
 assert.equal(await findResetAccount(page(selectors),signal()),account);
});
test('hidden menu produces an actionable error without a forced click',async()=>{
 await assert.rejects(findResetAccount(page({'.fi-menu':[control(false)]}),signal(),0),/My Account did not become visible/);
});
test('missing login control reports page/layout failure',async()=>{
 await assert.rejects(openResetLogin(page({}),signal(),0),/No visible Flingster login control/);
});
test('aborted navigation stops before clicking',async()=>{
 const controller=new AbortController();controller.abort(new Error('Stopped by admin'));
 await assert.rejects(openResetLogin(page({}),controller.signal),/Stopped by admin/);
});
