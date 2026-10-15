import test from 'node:test';
import assert from 'node:assert/strict';
import {PortalHttp,PortalFailure} from '../../supabase/functions/publishing-engine/server/http.ts';
import {ManagedPortalAdapter,createMyHomeServerAdapter,createSsgeServerAdapter,environmentSecrets} from '../../supabase/functions/publishing-engine/server/adapters.ts';
import {processManagedPortal,supabaseManagedQueue} from '../../supabase/functions/publishing-engine/server/worker.ts';
function setup(overrides={}){
 const calls=[];const op={id:'op',user_id:'owner',listing_id:'listing',portal_id:'myhome',kind:'PUBLISH',desired_revision:2,payload:{price:145000},payload_hash:'hash-v2',external_id:null,lease_token:'lease',confirmed_at:'2026-10-15',idempotency_key:'listing:myhome:PUBLISH:2',...overrides.operation};
 const binding={portalId:'myhome',documentationUrl:'https://provider.example/fixture-only',authorizationEvidence:'fixture-not-live',idempotentCreate:true,verifiedOperations:{PUBLISH:{verified:true,evidence:'fixture-only'},EDIT:{verified:true,evidence:'fixture-only'},RECONCILE:{verified:true,evidence:'fixture-only'}},authorize:async()=>({authenticated:true,expiresAt:Date.now()+60000,accountId:'owned-fixture'}),validate:()=>({valid:true,errors:[]}),map:x=>({...x}),execute:async(o,p)=>{calls.push(['execute',o.idempotency_key,p]);return {externalId:'remote-1',externalUrl:'https://www.myhome.ge/pr/1/'};},readback:async()=>({externalId:'remote-1',externalUrl:'https://www.myhome.ge/pr/1/',remoteState:'PUBLISHED',readbackHash:'hash-v2',verified:true}),...overrides.binding};
 const adapter=new ManagedPortalAdapter('myhome',['myhome.ge'],binding,{read:async()=> 'DO_NOT_LOG'},'AUTH');
 const queue={authorize:async()=>calls.push(['authorize']),claim:async()=>{calls.push(['claim']);return op;},photos:async()=>[],checkpoint:async(o,r)=>calls.push(['checkpoint',r.externalId]),finish:async(o,v,r,c)=>calls.push(['finish',v,r,c]),bill:async()=>calls.push(['bill']),...overrides.queue};
 return {adapter,queue,calls,op};
}
test('unconfigured managed portals are blocked without claiming jobs or browser fallback',async()=>{
 for(const a of [createMyHomeServerAdapter(),createSsgeServerAdapter()]){
  assert.equal(a.diagnostics().status,'BLOCKED');assert.deepEqual(a.diagnostics().supportedOperations,[]);
  assert.equal((await processManagedPortal({claim:()=>assert.fail('no claim')},a)).code,'PORTAL_API_APPROVAL_REQUIRED');
 }
});
test('server publication preserves provider idempotency, checkpoints identity and independently verifies before billing',async()=>{
 const s=setup();assert.equal((await processManagedPortal(s.queue,s.adapter)).status,'VERIFIED');
 assert.deepEqual(s.calls.map(c=>c[0]),['authorize','claim','execute','checkpoint','finish','bill']);assert.equal(s.calls[2][1],s.op.idempotency_key);assert.equal(s.calls[2][2].price,145000);assert.equal(s.calls[4][1],true);
});
test('mismatched content, identity, moderation or hostile URLs never synchronize or bill',async()=>{
 for(const change of [{readbackHash:'old'},{externalId:'other'},{remoteState:'PENDING_REVIEW'},{externalUrl:'https://myhome.ge.evil.test/pr/1'}]){
  const s=setup({binding:{readback:async()=>({externalId:'remote-1',externalUrl:'https://myhome.ge/pr/1',remoteState:'PUBLISHED',readbackHash:'hash-v2',verified:true,...change})}});
  const r=await processManagedPortal(s.queue,s.adapter);assert.notEqual(r.status,'VERIFIED');assert.ok(!s.calls.some(c=>c[0]==='bill'));assert.equal(s.calls.find(c=>c[0]==='finish')[1],false);
 }
});
test('uncertain writes are not repeated and raw provider errors remain private',async()=>{
 const s=setup({binding:{execute:async()=>{throw Error('DO_NOT_LOG cookie and provider response');}}});
 const r=await processManagedPortal(s.queue,s.adapter);assert.equal(r.code,'REMOTE_UNVERIFIED');assert.ok(!JSON.stringify([r,s.calls]).includes('DO_NOT_LOG'));assert.equal(s.calls.filter(c=>c[0]==='finish').length,1);
});
test('readback authentication failure preserves identity and requires reconciliation rather than retrying create',async()=>{
 const s=setup({binding:{readback:async()=>{throw new PortalFailure('AUTH_REQUIRED');}}});
 assert.equal((await processManagedPortal(s.queue,s.adapter)).code,'REMOTE_UNVERIFIED');assert.equal(s.calls.find(c=>c[0]==='checkpoint')[1],'remote-1');
});
test('expired credentials, missing confirmations, duplicate create and non-idempotent provider cannot dispatch',async()=>{
 const s=setup({binding:{authorize:async()=>({authenticated:true,accountId:'owned',expiresAt:0})}});
 assert.equal((await processManagedPortal(s.queue,s.adapter)).code,'AUTH_REQUIRED');assert.equal(s.calls.length,0);
 for(const operation of [{confirmed_at:null},{external_id:'already-created'}]){const x=setup({operation});await processManagedPortal(x.queue,x.adapter);assert.ok(!x.calls.some(c=>c[0]==='execute'));assert.ok(!x.calls.some(c=>c[0]==='bill'));}
 assert.equal(setup({binding:{idempotentCreate:false}}).adapter.supports('PUBLISH'),false);
});
test('billing outage after confirmed completion cannot repeat successful portal mutation',async()=>{
 const s=setup({queue:{bill:async()=>{throw Error('ledger offline');}}});const r=await processManagedPortal(s.queue,s.adapter);
 assert.equal(r.status,'VERIFIED');assert.equal(r.billingPending,true);assert.equal(s.calls.filter(c=>c[0]==='finish').length,1);
});
test('reconciliation reads existing identity without a write',async()=>{
 const s=setup({operation:{kind:'RECONCILE',external_id:'remote-1'}});assert.equal((await processManagedPortal(s.queue,s.adapter)).status,'VERIFIED');assert.ok(!s.calls.some(c=>['execute','checkpoint'].includes(c[0])));
});
test('HTTP transport rejects cross-origin paths, redirects and unsafe retry of writes',async()=>{
 const calls=[];const client=new PortalHttp('https://approved.example/',['https://approved.example'],async()=>({Authorization:'secret'}),async(u,o)=>{calls.push(o);return new Response('',{status:503});});
 for(const p of ['https://evil.example','//evil.example','/\\evil.example'])await assert.rejects(client.send(p,'GET'),/PORTAL_ORIGIN_DENIED/);assert.equal(calls.length,0);
 await assert.rejects(client.send('/fixture','POST','{}'),e=>e.code==='PORTAL_TEMPORARILY_UNAVAILABLE'&&e.mayHaveWritten);assert.equal(calls[0].redirect,'error');
 await assert.rejects(client.send('/fixture','GET'),e=>!e.mayHaveWritten);
});
test('credential references are allowlisted and diagnostics never contain secret values',async()=>{
 const secrets=environmentSecrets(()=> 'DO_NOT_LOG');assert.equal(await secrets.read('HOMATCH_PUBLISHING_MYHOME_CREDENTIAL'),'DO_NOT_LOG');await assert.rejects(secrets.read('SUPABASE_SERVICE_ROLE_KEY'),/SECRET_REFERENCE_DENIED/);
 assert.ok(!JSON.stringify(setup().adapter.diagnostics()).includes('DO_NOT_LOG'));
});
test('server media uses tenant-owned object paths and verifies content signatures',async()=>{
 const paths=[];const png=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);const id='33333333-3333-4333-8333-333333333333';
 const q=supabaseManagedQueue({storage:{from:()=>({download:async p=>{paths.push(p);return {data:new Blob([png],{type:'image/png'}),error:null};}})}});
 const photos=await q.photos({user_id:'owner',payload:{photos:[{assetId:id,name:'qa.png'}]}});assert.deepEqual(paths,['owner/'+id]);assert.equal(photos[0].mime,'image/png');
 await assert.rejects(q.photos({user_id:'owner',payload:{photos:[{assetId:'https://evil.test/photo'}]}}),/INVALID_ASSET/);
});
