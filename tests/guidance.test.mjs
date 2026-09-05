import test from 'node:test';
import assert from 'node:assert/strict';
import {retryCheck,permissionHint,statusText} from '../scripts/guidance.mjs';
test('readiness retries temporary failures and stops on success',async()=>{
  let calls=0,waits=0;
  assert.equal(await retryCheck(async()=>{if(++calls===1)throw Error('temporary');return calls===3;},
    {attempts:6,wait:async()=>waits++}),true);
  assert.equal(calls,3);assert.equal(waits,2);
});
test('readiness has bounded retries',async()=>{
  let calls=0;
  assert.equal(await retryCheck(async()=>{calls++;return false;},{attempts:3,wait:async()=>{}}),false);
  assert.equal(calls,3);
});
test('permission and status diagnostics distinguish their causes',()=>{
  assert.match(permissionHint('/workers/scripts'),/Workers Scripts/);
  assert.match(statusText({ok:true,paired:false,last:null}),/pair/);
  assert.match(statusText({ok:true,paired:true,last:{ok:true,test:true}}),/Test Alarm/);
});
