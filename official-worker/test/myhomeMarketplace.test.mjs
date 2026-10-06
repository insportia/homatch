import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { acquireMyHome } from '../.tstest-build/marketplace/myhome/adapter.js';
import { buildQueries, candidateFromMyHome } from '../.tstest-build/marketplace/myhome/mapping.js';
import { parsePagination } from '../.tstest-build/marketplace/myhome/api.js';
import { startMyHomeRuntime } from '../.tstest-build/marketplace/MyHomeRuntime.js';
import { validateWorkerReport } from '../../src/research-core/marketplace/worker-contract.ts';
import { processSearch } from '../../src/research-core/marketplace/pipeline.ts';

const request = { contract: 'marketplace-worker-1', searchId: '00000000-0000-4000-8000-000000000001', searchPlanId: '00000000-0000-4000-8000-000000000002',
  market: 'Georgia', country: 'Georgia', city: 'Tbilisi', districts: ['Krtsanisi'], transactionType: 'BUY', propertyType: 'APARTMENT',
  priceMinUsd: 0, priceMaxUsd: 200000, collectPriceMaxUsd: 220000, areaMinSqm: 70, areaMaxSqm: null,
  rooms: null, bedrooms: null, bathrooms: null, buildingStatuses: [], renovationPreferences: [], furnished: null, parking: null,
  mustHave: [], niceToHave: [], exclusions: [], searchLanguages: ['ka','en'], requestedAt: new Date().toISOString() };
const locations = { data: [{id:1,display_name:'Tbilisi',districts:[{id:6,display_name:'Old Tbilisi',urbans:[{id:65,display_name:'Krtsanisi'}]}]}] };
const filters = { data: { real_estate_types: [{id:1},{id:2}], deal_types:[{id:1},{id:2},{id:7}],
  room_types: [{id:10,display_name:'9'},{id:11,display_name:'10+'}], bedroom_types:[{id:10,display_name:'10+'}], bathroom_types:[{id:3,display_name:'3+'}],
  statuses:{1:[{id:2,display_name:'ახალი აშენებული'}]}, conditions:{1:[{id:5,display_name:'თეთრი კარკასი'}]}, parking_types:[{id:3,display_name:'პარკინგის გარეშე'}] } };
const row = id => ({id,uuid:`uuid-${id}`,dynamic_title:'Source listing',dynamic_slug:'source-listing',deal_type_id:1,real_estate_type_id:1,city_id:1,district_id:6,urban_id:65,
  city_name:'თბილისი',district_name:'ძველი თბილისი',urban_name:'კრწანისი',area_type_id:1,area:100,room:'10+',bedroom:'10+',price:{2:{price_total:180000,price_square:1800}},
  lat:null,lng:null,yard_area:null,address:'Source address',images:[{large:'https://static-api-statements.tnet.ge/image.webp'}],last_updated:'2026-10-06 16:48:54'});
function simulated({ lastPage = 6, total = 139, repeated = false, failPage = null, duplicate = false, emptyPage = null } = {}) {
  const pages = [], reports = []; let listCalls = 0;
  const fetcher = async (input) => {
    const url = new URL(input); let payload;
    if(url.hostname.includes('locations')) payload = locations;
    else if(url.pathname.endsWith('statement-parameters')) payload = filters;
    else if(url.pathname.endsWith('/count')) payload = { result:true,data:{page:1,last_page:lastPage,total} };
    else if(/\/statements\/\d+$/.test(url.pathname)) { const id = Number(url.pathname.split('/').at(-1)); payload = {result:true,data:{statement:{...row(id),room_type_id:11}}}; }
    else { const page = Number(url.searchParams.get('page')); pages.push(page);listCalls++;
      if(failPage===page) return new Response('Denied',{status:403});
      const size = total === 0 || emptyPage===page ? 0 : page===lastPage ? total-(lastPage-1)*24 : 24;
      const offset = (repeated && page>1 ? 0 : page-1)*24;
      const rows = Array.from({length:size},(_,i)=>row(offset+i+1));
      if(duplicate && rows.length) rows.push(rows[0]);
      payload={result:true,data:{data:rows}};
    }
    return Response.json(payload);
  };
  return { pages,reports,fetcher,run: (overrides={}) => acquireMyHome({...request,...overrides},{deadlineAt:new Date(Date.now()+900000).toISOString(),fetcher,report:async r=>reports.push(r)}) };
}
test('canonical mapping preserves collectPriceMaxUsd and exact location IDs',()=>{
  const u=new URL(buildQueries(request,locations,filters)[0].url);
  assert.equal(u.searchParams.get('price_to'),'220000');assert.equal(u.searchParams.get('urbans'),'65');assert.equal(u.searchParams.get('area_from'),'70');
});
test('rent/house is materially different and daily rent uses its proven ID',()=>{
  let u=new URL(buildQueries({...request,transactionType:'MONTHLY_RENT',propertyType:'HOUSE',collectPriceMaxUsd:5500},locations,filters)[0].url);
  assert.equal(u.searchParams.get('deal_types'),'2');assert.equal(u.searchParams.get('real_estate_types'),'2');assert.equal(u.searchParams.get('price_to'),'5500');
  u=new URL(buildQueries({...request,transactionType:'DAILY_RENT'},locations,filters)[0].url);assert.equal(u.searchParams.get('deal_types'),'7');
});
test('rooms resolve labels rather than assuming dictionary ID equals count',()=>{
  const u=new URL(buildQueries({...request,rooms:{min:9,max:9}},locations,filters)[0].url);
  assert.equal(u.searchParams.get('room_types[0]'),'10');assert.equal(u.searchParams.get('room_types[1]'),null);
});
test('unsupported city or unrepresentable room filter fails explicitly',()=>{
  assert.throws(()=>buildQueries({...request,city:'Unknown'},locations,filters));
  assert.throws(()=>buildQueries({...request,rooms:{min:20,max:19}},locations,filters));
});
test('special counts and nullable coordinates remain source evidence, never zero or exact 10',()=>{
  const c=candidateFromMyHome(row(1),filters,'https://api-statements.tnet.ge/v1/statements');
  assert.equal(c.rooms,null);assert.equal(c.retrievalMetadata.roomLabel,'10+');assert.equal(c.bedrooms,null);
  assert.equal(c.latitude,null);assert.equal(c.longitude,null);assert.equal(c.retrievalMetadata.yardAreaSqm,null);assert.equal(c.parking,null);assert.equal(c.furnished,null);
});
test('detail dictionary shape, coordinates and source URL survive mapping',()=>{
  const r={...row(42),room:undefined,room_type_id:10,lat:41.67,lng:44.81,condition_id:5,status_id:2};
  const c=candidateFromMyHome(r,filters,'https://api-statements.tnet.ge/v1/statements');
  assert.equal(c.rooms,9);assert.equal(c.sourceListingId,'42');assert.equal(c.exactUrl,'https://www.myhome.ge/udzravi-qoneba/source-listing-42/');
  assert.equal(c.latitude,41.67);assert.equal(c.district,'კრწანისი');assert.equal(c.renovationStatus,'WHITE_FRAME');assert.equal(c.updatedAt,'2026-10-06T12:48:54.000Z');assert.equal(c.images.length,1);
});
test('production processes all six pages, all 139 unique IDs and progressive batches',async()=>{
  const s=simulated({duplicate:true});const result=await s.run();
  assert.deepEqual(s.pages,[1,2,3,4,5,6]);assert.equal(result.status,'COMPLETE');assert.equal(result.delivered,139);
  assert.equal(s.reports.filter(r=>r.status==='RESULTS_RECEIVED').length,6);assert.equal(new Set(s.reports.flatMap(r=>r.listings.map(l=>l.sourceListingId))).size,139);
  assert.equal(s.reports.at(-1).status,'COMPLETE');assert.equal(s.reports.at(-1).listings.length,0);
});
test('production can traverse 50 pages without an arbitrary small cap',async()=>{const s=simulated({lastPage:50,total:1200});const result=await s.run();assert.equal(result.delivered,1200);assert.equal(s.pages.length,50);});
test('repeated pages report PARTIAL and preserve ingested results',async()=>{const s=simulated({repeated:true});const result=await s.run();assert.equal(result.status,'PARTIAL');assert.equal(result.delivered,24);assert.equal(s.reports.at(-1).errors[0].code,'REPEATED_PAGE');});
test('unexpected empty page cannot be reported as complete',async()=>{const s=simulated({emptyPage:2});assert.equal((await s.run()).status,'PARTIAL');assert.equal(s.reports.at(-1).errors[0].code,'EMPTY_PAGE');});
test('access denied is not bypassed or silently converted into empty success',async()=>{const s=simulated({failPage:1});assert.equal((await s.run()).status,'BLOCKED');assert.deepEqual(s.pages,[1]);});
test('zero inventory is a legitimate complete result',async()=>{const s=simulated({lastPage:0,total:0});assert.equal((await s.run()).status,'COMPLETE');assert.equal(s.reports.at(-1).returnedCount,0);});
test('count metadata must be authoritative and sane',()=>{assert.throws(()=>parsePagination({result:true,data:{page:2,last_page:6,total:139}},1));assert.throws(()=>parsePagination({result:true,data:{page:1,last_page:0,total:3}},1));});
test('existing deadline is respected with explicit timed-out status',async()=>{const s=simulated();const result=await acquireMyHome(request,{deadlineAt:new Date().toISOString(),fetcher:s.fetcher,report:async r=>s.reports.push(r)});assert.equal(result.status,'TIMED_OUT');assert.equal(s.pages.length,0);});
test('runtime remains inert without its dedicated token and explicit enablement',()=>{let calls=0;const runtime=startMyHomeRuntime({},async()=>{calls++;throw Error('unexpected')});assert.equal(runtime.status().configured,false);assert.equal(calls,0);runtime.shutdown();});
test('Docker-local type snapshot stays aligned with authoritative contract interfaces',()=>{
  const root=readFileSync(new URL('../../src/research-core/marketplace/worker-contract.ts',import.meta.url),'utf8').replaceAll('\r\n','\n');
  const local=readFileSync(new URL('../src/marketplace/contract.ts',import.meta.url),'utf8').replaceAll('\r\n','\n');
  for(const name of ['MarketplaceSearchRequest','ExternalListingCandidate','MarketplaceWorkerResult','WorkerMetrics']){const start=root.indexOf('export interface '+name+' {'),end=root.indexOf('\n}',start)+2;assert.ok(local.includes(root.slice(start,end)),name+' drift');}
});
test('real worker report contract feeds the existing pipeline with URLs and images intact',async()=>{
  const s=simulated({lastPage:1,total:3});await s.run();
  const report=s.reports.find(r=>r.listings.length);
  const validated=validateWorkerReport(report,'myhome-ge');assert.equal(validated.ok,true);
  assert.equal(validated.report.rejected.length,0);assert.equal(validated.report.listings.length,3);
  const output=processSearch({request,candidates:validated.report.listings.map(candidate=>({candidate})),now:new Date()});
  assert.ok(output.properties.length>0);assert.equal(output.properties[0].listings[0].exactUrl.startsWith('https://www.myhome.ge/'),true);
  assert.ok(output.properties[0].images.length>0);
});
test('runtime uses authenticated claim, heartbeat and result report without a service role key',async()=>{
  const source=simulated({lastPage:1,total:3});let claimed=false,completed=false;const bodies=[];
  const fetcher=async(input,init)=>{
    if(!String(input).includes('/functions/v1/')) return source.fetcher(input,init);
    assert.equal(init.headers.Authorization,'Bearer '+'x'.repeat(40));assert.equal(init.headers['x-homatch-worker'],'myhome-agent');
    const body=JSON.parse(init.body);bodies.push(body);
    if(body.action==='claim'){const runs=claimed?[]:[{runId:'00000000-0000-4000-8000-000000000003',attempt:1,deadlineAt:new Date(Date.now()+900000).toISOString(),request}];claimed=true;return Response.json({runs});}
    if(body.action==='report'){assert.equal(body.report,undefined);assert.equal(validateWorkerReport(body.result,'myhome-ge').ok,true);completed=body.result.status==='COMPLETE';return Response.json({accepted:body.result.listings.length,rejected:[],searchStatus:'RESULTS_AVAILABLE'});}
    return Response.json({leaseExpiresAt:new Date().toISOString()});
  };
  const runtime=startMyHomeRuntime({SUPABASE_URL:'https://example.supabase.co',MYHOME_WORKER_TOKEN:'x'.repeat(40),MYHOME_MARKETPLACE_ENABLED:'true'},fetcher);
  try {for(let i=0;i<100&&!completed;i++) await new Promise(resolve=>setTimeout(resolve,10));assert.equal(completed,true);assert.ok(runtime.status().lastClaimAt);assert.ok(bodies.some(b=>b.result?.status==='RESULTS_RECEIVED'));}
  finally{runtime.shutdown();}
});
