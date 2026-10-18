import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {findResetAccount,ResetNavigationError}=require('../dist/lib/resetNavigation.js');
const invisible=()=>({all:async()=>[]});
test('unknown login state is non-retryable and does not reveal page contents',async()=>{
 const page={locator:()=>invisible(),getByRole:()=>invisible(),getByText:()=>invisible(),waitForTimeout:async()=>{}};
 await assert.rejects(()=>findResetAccount(page,new AbortController().signal,2),error=>{
  assert.ok(error instanceof ResetNavigationError);
  assert.match(error.message,/authentication unconfirmed/);
  return true;
 });
});
test('visible semantic account link can confirm the account view without legacy classes',async()=>{
 const link={isVisible:async()=>true,click:async()=>{}};
 const page={locator:()=>invisible(),getByRole:(role)=>role==='link'?{all:async()=>[link]}:invisible(),getByText:()=>invisible(),waitForTimeout:async()=>{}};
 const found=await findResetAccount(page,new AbortController().signal,50);
 assert.equal(found,link);
});
