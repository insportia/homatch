import test from 'node:test';
import assert from 'node:assert/strict';
import {handleManagedTick} from '../../supabase/functions/publishing-engine/server/handler.ts';
const secret='fixture_only_worker_secret_1234567890';
const request=(body={url:'/v2/worker/tick'},headers={})=>new Request('https://fixture.example/publishing-engine',{method:'POST',headers:{authorization:'Bearer fixture_gateway_token','x-publishing-worker-token':secret,...headers},body:JSON.stringify(body)});
test('machine route requires a separate worker secret and cannot be invoked from browser origins',async()=>{
 let factories=0;const ctx={expectedToken:secret,createAdmin:()=>{factories++;throw Error('must not run');}};
 assert.equal((await handleManagedTick(request({}, {'x-publishing-worker-token':'wrong'}),ctx)).status,403);
 assert.equal((await handleManagedTick(request({}, {origin:'https://homatch.live'}),ctx)).status,403);
 assert.equal((await handleManagedTick(request({}, {authorization:''}),ctx)).status,403);
 assert.equal((await handleManagedTick(request(),{...ctx,expectedToken:undefined})).status,503);
 assert.equal(factories,0);
});
test('authorized worker tick cannot dispatch arbitrary routes, scripts or oversized payloads',async()=>{
 const ctx={expectedToken:secret,createAdmin:()=>assert.fail('no admin before validation')};
 for(const body of [{url:'/v2/admin/settings'},{url:'/v2/worker/tick',body:{script:'evil'}},{url:'/v2/worker/tick',portalId:'myhome'}])assert.equal((await handleManagedTick(request(body),ctx)).status,403);
 assert.equal((await handleManagedTick(request({url:'/v2/worker/tick',body:{large:'x'.repeat(2000)}}),ctx)).status,413);
});
test('existing hosted entry returns blocked providers without claiming jobs or charging wallets',async()=>{
 const calls=[];const admin={rpc:async(name,args)=>{calls.push(name);return {data:0,error:null};}};
 const response=await handleManagedTick(request(),{expectedToken:secret,createAdmin:()=>admin});const result=await response.json();
 assert.equal(response.status,200);assert.deepEqual(calls,['publishing_engine_schedule_managed']);
 assert.deepEqual(result.results.map(p=>p.status),['BLOCKED','BLOCKED']);assert.equal(result.execution,'MANAGED_HTTP');
});
