import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { acquireSsge } from '../src/marketplace/ssge/acquire.mjs';
import { ssgeCriteria } from '../src/marketplace/ssge/mapping.mjs';
import { startSsgeRuntime } from '../src/marketplace/ssge/runtime.mjs';
import { SsgePublicClient } from '../src/marketplace/ssge/vendor/public-client.mjs';
import { validateWorkerReport, canTransition } from '../../src/research-core/marketplace/worker-contract.ts';
import { leaseUntil, retryDecision, DEFAULT_LEASE_SECONDS } from '../../src/research-core/marketplace/dispatch.ts';
import { loadMarketplaceSwitches, processAndStore, reapRuns } from '../../supabase/functions/_shared/marketplaceSearch.ts';
import { ownedSearchHistory } from '../../supabase/functions/_shared/marketplaceHistory.ts';
import { edgeHandler, memoryDatabase } from '../../tests/helpers/marketplaceEdgeHarness.mjs';
const fixture=JSON.parse(readFileSync(new URL('fixtures/ssge/accepted-scenarios.json',import.meta.url),'utf8'));
const searchId='11111111-1111-4111-8111-111111111111',runId='22222222-2222-4222-8222-222222222222';
const requestFor=s=>({contract:'marketplace-worker-1',searchId,searchPlanId:'33333333-3333-4333-8333-333333333333',country:'GE',market:'GE',city:'Tbilisi',districts:['დიდი დიღომი'],transactionType:s.criteria.transactionType==='sale'?'BUY':'MONTHLY_RENT',propertyType:s.criteria.propertyType==='apartment'?'APARTMENT':'HOUSE',priceMinUsd:0,priceMaxUsd:s.criteria.priceMaxUsd,collectPriceMaxUsd:s.criteria.priceMaxUsd*1.1,areaMinSqm:s.criteria.areaMinSqm,areaMaxSqm:null,rooms:null,bedrooms:null,bathrooms:null,buildingStatuses:[],renovationPreferences:[],furnished:null,parking:null,mustHave:[],niceToHave:[],exclusions:[],searchLanguages:['ka'],requestedAt:new Date().toISOString()});
// Scenario B's accepted property is Lisi Lake; this is an actual source label.
const sourceFor=(s,{wrongDetail=false,repeated=false}={})=>{
  const client=new SsgePublicClient({locations:fixture.locations,session:{authorize:async r=>r},http:{fetchImpl:async(url,init)=>{
    if(String(url).includes('legend-search-count'))return Response.json({cardCount:repeated?32:1,applicationCount:repeated?32:1});
    if(String(url).includes('LegendSearch')){const body=JSON.parse(init.body);assert.equal(body.currencyId,2);assert.equal(body.pageSize,16);return Response.json({realStateItemModel:[s.list],totalCount:0});}
    if(String(url).includes('/details'))return Response.json({...s.detail,applicationId:wrongDetail?'99999999':s.detail.applicationId});
    throw Error('Unexpected fixture request');
  }}});
  return client;
};
const request=s=>{const r=requestFor(s);r.districts=[s.detail.address.subdistrictTitle];return r;};
const options=s=>({client:sourceFor(s),deadlineAt:new Date(Date.now()+900000).toISOString(),sleep:async()=>{},verifyPage:async()=>s.proof});

test('accepted standalone runtime modules are byte-identical to their recorded hashes',()=>{
 const root=new URL('../src/marketplace/ssge/',import.meta.url),manifest=JSON.parse(readFileSync(new URL('vendor-manifest.json',root)));
 assert.equal(manifest.acceptanceRun,fixture.acceptanceRun);
 for(const [file,sha]of Object.entries(manifest.files))assert.equal(createHash('sha256').update(readFileSync(new URL('vendor/'+file,root))).digest('hex'),sha,file);
});
test('live source taxonomy resolves HOMATCH aliases without numeric location constants and preserves the bounded upgrade ceiling',()=>{
 const r=request(fixture.scenarios[0]),c=ssgeCriteria(r,fixture.locations);
 assert.equal(c.city,fixture.scenarios[0].detail.address.cityId);
 assert.ok(c.subdistricts.includes(fixture.scenarios[0].detail.address.subdistrictId));
 assert.equal(c.priceMaxUsd,r.collectPriceMaxUsd);
 assert.throws(()=>ssgeCriteria({...r,districts:['not-a-known-place']},fixture.locations),/Unknown/);
 assert.throws(()=>ssgeCriteria({...r,collectPriceMaxUsd:300000},fixture.locations),/ceiling/);
});
test('sale apartment and monthly rent house flow through real authenticated ingest, normalization, canonical persistence and owned history',async()=>{
 for(const s of fixture.scenarios){
  const r=request(s),token='ssge-fixture-token-'.repeat(3),deadline=new Date(Date.now()+900000).toISOString();
  const db=memoryDatabase({admin_settings:[{key:'marketplace_search_enabled',value:true},{key:'provider_kill_switch',value:true},{key:'marketplace_ssge_enabled',value:true}],
   discovery_marketplace_workers:[{worker_id:'ssge-agent',source_key:'ss-ge',state:'ACTIVE',enabled:true,token_hash:createHash('sha256').update(token).digest('hex'),max_attempts:3}],
   discovery_marketplace_worker_runs:[{id:runId,search_id:searchId,worker_id:'ssge-agent',status:'SEARCHING',deadline_at:deadline,lease_expires_at:deadline,attempts:1,returned_count:0}],
   discovery_marketplace_searches:[{id:searchId,user_id:'owner',request:r,status:'SEARCHING',ai_status:'DONE',created_at:new Date().toISOString(),brief:{},telemetry:{ai:[],workers:[],processingMs:[]}}]});
  const handler=edgeHandler(fileURLToPath(new URL('../../supabase/functions/marketplace-worker-ingest/index.ts',import.meta.url)),{createClient:()=>db,validateWorkerReport,canTransition,loadMarketplaceSwitches,processAndStore,reapRuns,leaseUntil,retryDecision,DEFAULT_LEASE_SECONDS});
  const reports=[];
  const result=await acquireSsge(r,{...options(s),report:async report=>{
   reports.push(report);const parsed=validateWorkerReport(report,'ss-ge');assert.equal(parsed.ok,true);assert.equal(parsed.report.rejected.length,0);
   const response=await handler(new Request('https://fixture/ingest',{method:'POST',headers:{'x-homatch-worker':'ssge-agent',authorization:`Bearer ${token}`},body:JSON.stringify({action:'report',runId,result:report})}));
   assert.equal(response.status,200,JSON.stringify(await response.clone().json()));
   assert.equal((await response.json()).accepted,report.listings.length);
  }});
  assert.equal(result.status,'COMPLETE');assert.equal(result.delivered,1);
  assert.equal(db.tables.discovery_marketplace_listings.length,1);
  assert.equal(db.tables.discovery_marketplace_listings[0].source_key,'ss-ge');
  const properties=db.tables.discovery_marketplace_properties;assert.equal(properties.length,1);
  assert.equal(properties[0].view.listings[0].exactUrl,s.proof.url);
  assert.equal(properties[0].view.listings[0].source,'ss-ge');
  assert.equal(properties[0].view.facts.areaSqm,s.expected.area);
  assert.equal(properties[0].view.facts.priceUsd,s.expected.priceUsd);
  assert.equal(db.tables.discovery_marketplace_searches[0].properties_count,1);
  assert.equal((await ownedSearchHistory(db,'owner',1)).items[0].uniqueProperties,1);
  assert.equal((await ownedSearchHistory(db,'foreign',1)).items.length,0);
  // Replay cannot multiply source observations or canonical properties.
  assert.equal(db.tables.discovery_marketplace_worker_runs[0].status,'COMPLETE');
  const replay=await handler(new Request('https://fixture/ingest',{method:'POST',headers:{'x-homatch-worker':'ssge-agent',authorization:`Bearer ${token}`},body:JSON.stringify({action:'report',runId,result:reports[0]})}));
  assert.equal(replay.status,409);
  assert.equal(db.tables.discovery_marketplace_listings.length,1);
  assert.equal(db.tables.discovery_marketplace_properties.length,1);
  assert.equal(reports[0].listings[0].publishedAt,null);assert.equal(reports[0].listings[0].updatedAt,null,'promotion orderDate is not a publication/update date');
 }
});
test('wrong identity and repeated pages never become empty COMPLETE success',async()=>{
 const s=fixture.scenarios[0];
 for(const config of [{wrongDetail:true},{repeated:true}]){
  const reports=[];const result=await acquireSsge(request(s),{...options(s),client:sourceFor(s,config),report:async r=>reports.push(r)});
  assert.equal(result.status,'PARTIAL');
  if(config.wrongDetail)assert.equal(result.delivered,0);
  else assert.equal(result.delivered,1);
  assert.ok(reports.at(-1).errors.length);
 }
});
test('expired deadline, cancelled run, disabled or unconfigured runtime do not make source requests',async()=>{
 let calls=0;const reports=[];
 const result=await acquireSsge(request(fixture.scenarios[0]),{deadlineAt:new Date(0).toISOString(),client:{locationChain(){calls++;}},report:async r=>reports.push(r)});
 assert.equal(result.status,'TIMED_OUT');assert.equal(calls,0);
 const controller=new AbortController();controller.abort();
 await acquireSsge(request(fixture.scenarios[0]),{deadlineAt:new Date(Date.now()+900000).toISOString(),signal:controller.signal,client:{locationChain(){calls++;}},report:async r=>reports.push(r)});
 assert.equal(calls,0);
 for(const env of [{},{SSGE_MARKETPLACE_ENABLED:'true'}]){const runtime=startSsgeRuntime(env,async()=>{calls++;});await new Promise(r=>setTimeout(r,5));runtime.shutdown();}
 assert.equal(calls,0);
});
test('public access rejection stops acquisition instead of retrying listings or declaring success',async()=>{
 const s=fixture.scenarios[0],reports=[];let proofs=0;
 const result=await acquireSsge(request(s),{...options(s),verifyPage:async()=>{proofs++;return {status:403,passed:false};},report:async r=>reports.push(r)});
 assert.equal(result.status,'BLOCKED');assert.equal(result.delivered,0);assert.equal(proofs,1);
});
test('an unstarted transient source failure uses the existing retry budget without claiming success',async()=>{
 const reports=[];
 const result=await acquireSsge(request(fixture.scenarios[0]),{deadlineAt:new Date(Date.now()+900000).toISOString(),client:{locationChain:async()=>{throw Object.assign(Error('fixture 503'),{status:503,transient:true});}},report:async r=>reports.push(r)});
 assert.equal(result.status,'FAILED');assert.equal(result.delivered,0);assert.equal(reports[0].retryable,true);
 assert.equal(validateWorkerReport(reports[0],'ss-ge').report.retryable,true);
});
test('SS.ge switch is disabled when missing and cannot enable other providers',async()=>{
 const db=memoryDatabase({admin_settings:[{key:'marketplace_search_enabled',value:true},{key:'provider_kill_switch',value:true}]});
 let state=await loadMarketplaceSwitches(db);assert.equal(state.ssgeEnabled,false);assert.equal(state.providersKilled,true);
 db.tables.admin_settings.push({key:'marketplace_ssge_enabled',value:true});
 state=await loadMarketplaceSwitches(db);assert.equal(state.ssgeEnabled,true);assert.equal(state.providersKilled,true);assert.equal(state.myhomeEnabled,false);
});
test('queue runtime uses its own worker token and reports through the existing ingest contract',async()=>{
 const s=fixture.scenarios[0],r=request(s);let claimed=false,finished=false;
 const runtime=startSsgeRuntime({SUPABASE_URL:'https://fixture.supabase.co',SSGE_WORKER_TOKEN:'x'.repeat(40),SSGE_MARKETPLACE_ENABLED:'true'},async(_url,init)=>{
  assert.equal(init.headers['x-homatch-worker'],'ssge-agent');assert.equal(init.headers.Authorization,'Bearer '+'x'.repeat(40));
  const body=JSON.parse(init.body);
  if(body.action==='claim'){const runs=claimed?[]:[{runId,request:r,deadlineAt:new Date(Date.now()+900000).toISOString()}];claimed=true;return Response.json({runs});}
  if(body.action==='report'){finished=body.result.status==='COMPLETE';return Response.json({accepted:body.result.listings.length,rejected:[]});}
  return Response.json({});
 },(request,opts)=>acquireSsge(request,{...opts,...options(s)}));
 try{for(let i=0;i<100&&!finished;i++)await new Promise(r=>setTimeout(r,10));assert.equal(finished,true);}finally{runtime.shutdown();}
});
