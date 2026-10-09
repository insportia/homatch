import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { acquireMyHome } from '../.tstest-build/marketplace/myhome/adapter.js';
import { buildQueries, candidateFromMyHome } from '../.tstest-build/marketplace/myhome/mapping.js';
import { parsePagination, AcquisitionError } from '../.tstest-build/marketplace/myhome/api.js';
import { publicSearchUrl, parsePublicPage, publicPage } from '../.tstest-build/marketplace/myhome/public-page.js';
import { startMyHomeRuntime } from '../.tstest-build/marketplace/MyHomeRuntime.js';
import { validateWorkerReport } from '../../src/research-core/marketplace/worker-contract.ts';
import { processSearch } from '../../src/research-core/marketplace/pipeline.ts';
import { sanitizeBrief, emptyBrief } from '../../src/research-core/marketplace/brief.ts';
import { buildSearchRequest } from '../../src/research-core/marketplace/worker-contract.ts';

const request = { contract: 'marketplace-worker-1', searchId: '00000000-0000-4000-8000-000000000001', searchPlanId: '00000000-0000-4000-8000-000000000002',
  market: 'Georgia', country: 'Georgia', city: 'Tbilisi', districts: ['Krtsanisi'], transactionType: 'BUY', propertyType: 'APARTMENT',
  priceMinUsd: 0, priceMaxUsd: 200000, collectPriceMaxUsd: 220000, areaMinSqm: 70, areaMaxSqm: null,
  rooms: null, bedrooms: null, bathrooms: null, buildingStatuses: [], renovationPreferences: [], furnished: null, parking: null,
  mustHave: [], niceToHave: [], exclusions: [], searchLanguages: ['ka','en'], requestedAt: new Date().toISOString() };
const locations = { data: [{id:1,display_name:'Tbilisi',districts:[{id:6,display_name:'Old Tbilisi',urbans:[{id:65,display_name:'Krtsanisi'}]}]}] };
const filters = { data: { real_estate_types: [{id:1},{id:2}], deal_types:{1:[{id:1},{id:2},{id:7}],2:[{id:1},{id:2},{id:7}]},
  room_types: [{id:10,display_name:'9'},{id:11,display_name:'10+'}], bedroom_types:[{id:10,display_name:'10+'}], bathroom_types:[{id:3,display_name:'3+'}],
  statuses:{1:[{id:2,display_name:'ახალი აშენებული'}]}, conditions:{1:[{id:5,display_name:'თეთრი კარკასი'}]}, parking_types:[{id:3,display_name:'პარკინგის გარეშე'}] } };
const row = id => ({id,uuid:`uuid-${id}`,dynamic_title:'Source listing',dynamic_slug:'source-listing',deal_type_id:1,real_estate_type_id:1,city_id:1,district_id:6,urban_id:65,
  city_name:'თბილისი',district_name:'ძველი თბილისი',urban_name:'კრწანისი',area_type_id:1,area:100,room:'10+',bedroom:'10+',price:{2:{price_total:180000,price_square:1800}},
  lat:null,lng:null,yard_area:null,address:'Source address',images:[{large:'https://static-api-statements.tnet.ge/image.webp'}],last_updated:'2026-10-06 16:48:54'});

test('owner start canonicalization maps Varketili through proven multilingual MyHome dictionary', () => {
  const brief=sanitizeBrief({...emptyBrief(),transactionType:{value:'BUY',status:'STATED'},propertyType:{value:'APARTMENT',status:'STATED'},
    city:{value:'ვარკეთილი',status:'STATED'},districts:{value:['სუხიშვილის ქუჩა','მიკროები'],status:'STATED'},price:{value:{min:null,max:90000},status:'STATED'}});
  const req=buildSearchRequest(brief,{searchId:request.searchId,searchPlanId:request.searchPlanId});
  const liveShape={data:[{id:1,display_name:'Tbilisi',slug:'tbilisi',translations:{ka:{display_name:'თბილისი'}},districts:[{id:5,display_name:'Isani-Samgori',urbans:[{id:52,display_name:'Varketili',slug:'varketili',translations:{ka:{display_name:'ვარკეთილი',display_name_in:'ვარკეთილში'}}}]}]}]};
  for(const district of ['Varketili','ვარკეთილი','ვარკეთილში']) {
    const url=new URL(buildQueries({...req,districts:[district]},liveShape,filters)[0].url);
    assert.equal(url.searchParams.get('cities'),'1');assert.equal(url.searchParams.get('districts'),'5');assert.equal(url.searchParams.get('urbans'),'52');
  }
  assert.deepEqual(req.districts,['Varketili']);assert.ok(!JSON.stringify(buildQueries(req,liveShape,filters)).includes('სუხიშვილის'));
});
function simulated({ lastPage = 6, total = 139, repeated = false, failPage = null, duplicate = false, emptyPage = null, missingUrlId = null } = {}) {
  const pages = [], reports = []; let listCalls = 0;
  const fetcher = async (input) => {
    const url = new URL(input); let payload;
    if(url.hostname.includes('locations')) payload = locations;
    else if(url.pathname.endsWith('statement-parameters')) payload = filters;
    else if(url.pathname.endsWith('/count')) payload = { result:true,data:{page:1,last_page:lastPage,total} };
    else if(url.hostname === 'www.myhome.ge' && /-\d+\/$/.test(url.pathname)) { const id = Number(url.pathname.match(/-(\d+)\/$/)[1]); payload = {result:true,data:{statement:{...row(id),room_type_id:11}}}; }
    else { const page = Number(url.searchParams.get('page')); pages.push(page);listCalls++;
      if(failPage===page) return new Response('Denied',{status:403});
      const size = total === 0 || emptyPage===page ? 0 : page===lastPage ? total-(lastPage-1)*24 : 24;
      const offset = (repeated && page>1 ? 0 : page-1)*24;
      const rows = Array.from({length:size},(_,i)=>row(offset+i+1));
      if(duplicate && rows.length) rows.push(rows[0]);
      payload={result:true,data:{data:rows}};
    }
    const records = payload.data?.data ?? (payload.data?.statement ? [payload.data.statement] : []);
    for (const record of records) if (record.id === missingUrlId) { record.dynamic_slug = null; record.dynamic_title = null; }
    if (url.hostname === 'www.myhome.ge') {
      const id = payload.data?.statement?.id;
      const queryKey = id ? ['statements','details',{locale:'ka',statementId:String(id)}] : ['statements','list',{params:{locale:'ka'},query:Object.fromEntries(url.searchParams)}];
      return new Response(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({page:'/[...slug]',props:{pageProps:{locale:'ka',dehydratedState:{queries:[{queryKey,state:{status:'success',data:payload}}]}}}})}</script>`);
    }
    return Response.json(payload);
  };
  return { pages,reports,fetcher,run: (overrides={}) => acquireMyHome({...request,...overrides},{deadlineAt:new Date(Date.now()+900000).toISOString(),fetcher,report:async r=>reports.push(r)}) };
}

test('public Next fixtures confirm exact filters, pagination and detail identity', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/myhome-public-next.json',import.meta.url),'utf8'));
  const html = next => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify(next)}</script>`;
  const list = parsePublicPage(html(fixture.search), fixture.searchUrl);
  assert.equal(list.data.data[0].id,25610778);
  const detail = parsePublicPage(html(fixture.detail), fixture.detailUrl,'25610778');
  assert.equal(detail.data.statement.id,list.data.data[0].id);
  assert.equal(detail.data.statement.uuid,list.data.data[0].uuid);
  assert.throws(()=>parsePublicPage(html(fixture.search),fixture.searchUrl.replace('page=1','page=2')),/does not confirm/);
  assert.throws(()=>parsePublicPage(html(fixture.detail),fixture.detailUrl,'999'),/does not confirm/);
  assert.throws(()=>parsePublicPage('<html>challenge</html>',fixture.searchUrl),/no structured/);
  const changed=structuredClone(fixture.search);
  delete changed.props.pageProps.dehydratedState.queries[0].queryKey[2].query.price_to;
  assert.throws(()=>parsePublicPage(html(changed),fixture.searchUrl),/does not confirm/);
  assert.equal(publicSearchUrl('https://api-statements.tnet.ge/v1/statements?room_types%5B0%5D=3&page=2'),'https://www.myhome.ge/udzravi-qoneba/?room_types%5B0%5D=3&page=2');
});

test('public page acquisition stops on access restriction and uses no credentials', async () => {
  let calls=0;
  await assert.rejects(publicPage('https://www.myhome.ge/udzravi-qoneba/?page=1',async (_url,init)=>{
    calls++;assert.deepEqual(init.headers,{Accept:'text/html'});return new Response('Denied',{status:403});
  }),/HTTP 403/);
  assert.equal(calls,1);
});
test('long production query cannot erase HTTP diagnostics at report ingress', () => {
  const error = new AcquisitionError('https://api-statements.tnet.ge/v1/statements?' + 'room_types[0]=3&'.repeat(40), 422, 'HTTP 422; request stopped');
  const validated = validateWorkerReport({contract:'marketplace-worker-1',searchId:request.searchId,searchPlanId:request.searchPlanId,
    workerId:'myhome-agent',sourceId:'myhome-ge',status:'FAILED',startedAt:new Date().toISOString(),completedAt:new Date().toISOString(),
    queryApplied:{},discoveredCount:44,returnedCount:0,listings:[],errors:[{code:'SOURCE_REQUEST_FAILED',message:error.message}],metrics:{}}, 'myhome-ge');
  assert.equal(validated.ok,true);
  assert.match(validated.report.errors[0].message, /^HTTP 422; request stopped/);
  assert.ok(validated.report.errors[0].message.length <= 300);
});

test('canonical mapping preserves collectPriceMaxUsd and exact location IDs',()=>{
  const u=new URL(buildQueries(request,locations,filters)[0].url);
  assert.equal(u.searchParams.get('price_to'),'220000');assert.equal(u.searchParams.get('urbans'),'65');assert.equal(u.searchParams.get('area_from'),'70');
});
test('rent/house is materially different and daily rent uses its proven ID',()=>{
  let u=new URL(buildQueries({...request,transactionType:'MONTHLY_RENT',propertyType:'HOUSE',collectPriceMaxUsd:5500},locations,filters)[0].url);
  assert.equal(u.searchParams.get('deal_types'),'2');assert.equal(u.searchParams.get('real_estate_types'),'2');assert.equal(u.searchParams.get('price_to'),'5500');
  u=new URL(buildQueries({...request,transactionType:'DAILY_RENT'},locations,filters)[0].url);assert.equal(u.searchParams.get('deal_types'),'7');
});
test('real deal dictionary is keyed by property; land rent is not invented from apartment deal IDs',()=>{
  const f={data:{...filters.data,real_estate_types:[...filters.data.real_estate_types,{id:4},{id:5}],deal_types:{...filters.data.deal_types,4:[{id:1},{id:10}],5:[{id:1},{id:2},{id:7}]}}};
  assert.throws(()=>buildQueries({...request,propertyType:'LAND',transactionType:'MONTHLY_RENT'},locations,f),/Unsupported MyHome property\/transaction/);
  const u=new URL(buildQueries({...request,propertyType:'COMMERCIAL',buildingStatuses:['NEW_BUILD']},locations,f)[0].url);
  assert.equal(u.searchParams.get('statuses[0]'),null,'commercial subtype is not building age');
});
test('rooms resolve labels rather than assuming dictionary ID equals count',()=>{
  const u=new URL(buildQueries({...request,rooms:{min:9,max:9}},locations,filters)[0].url);
  assert.equal(u.searchParams.get('room_types[0]'),'10');assert.equal(u.searchParams.get('room_types[1]'),null);
});

test('proven bedrooms, bathrooms, building, renovation and parking mappings use dictionary IDs',()=>{
  const f={data:{...filters.data,conditions:{1:[...filters.data.conditions[1],{id:15,display_name:'თეთრი პლიუსი'}]}}};
  const u=new URL(buildQueries({...request,bedrooms:{min:10,max:null},bathrooms:{min:3,max:null},buildingStatuses:['NEW_BUILD'],renovationPreferences:['WHITE_FRAME'],parking:false},locations,f)[0].url);
  for(const [key,value] of [['bedroom_types[0]','10'],['bathroom_types[0]','3'],['statuses[0]','2'],['conditions[0]','5'],['parking_types[0]','3']]) assert.equal(u.searchParams.get(key),value);
});

test('proven central heating and positive attributes resolve dynamic IDs, with exact floor flags',()=>{
  const f={data:{...filters.data,heating_types:[{id:101,display_name:'ცენტრალური გათბობა'},{id:105,display_name:'ცენტრალური+იატაკის გათბობა'}],
    statement_parameters:{1:[{id:106,type:'feature',svg_file_name:'elevator',deal_types:[1,2,7]},{id:104,type:'furniture-equipment',svg_file_name:'conditioner',deal_types:[1,2,7]},{id:110,type:'furniture-equipment',svg_file_name:'furniture-equipment',deal_types:[1,2,7]},{id:149,type:'label',svg_file_name:'pets-allowed',deal_types:[2,7]}]}}};
  const u=new URL(buildQueries({...request,mustHave:['CENTRAL_HEATING','ELEVATOR','AIR_CONDITIONING','PET_FRIENDLY'],floorPreferences:['NOT_FIRST','NOT_LAST','HIGH']},locations,f)[0].url);
  assert.equal(u.searchParams.get('heating_types[0]'),'101');assert.equal(u.searchParams.get('heating_types[1]'),'105');
  assert.equal(u.searchParams.get('attrs[feature][]'),'106');assert.equal(u.searchParams.get('attrs[furniture-equipment][]'),'104');
  assert.equal(u.searchParams.get('attrs[label][]'),null,'pet permission is not a sale filter');
  assert.equal(u.searchParams.get('not_first'),'1');assert.equal(u.searchParams.get('not_last'),'1');assert.equal(u.searchParams.get('floor_from'),null,'HIGH has no invented threshold');
  const rent=new URL(buildQueries({...request,transactionType:'MONTHLY_RENT',mustHave:['PET_FRIENDLY','FURNISHED']},locations,f)[0].url);
  assert.equal(rent.searchParams.get('attrs[label][]'),'149');assert.equal(rent.searchParams.get('attrs[furniture-equipment][]'),'110');
  const c=candidateFromMyHome({...row(1),heating_type_id:105,floor:2,total_floors:10},f,'https://api-statements.tnet.ge/v1/statements');
  assert.ok(c.amenities.includes('CENTRAL_HEATING'));assert.equal(c.floor,2);assert.equal(c.totalFloors,10);
  assert.throws(()=>buildQueries({...request,mustHave:['CENTRAL_HEATING']},locations,filters),/Dictionary mapping unavailable/);
});

test('unproven detail criteria are not invented; source years and exact detail counts stay truthful',()=>{
  const c=candidateFromMyHome({...row(1),room:'10+',room_type_id:10,build_year:'1955-2000'},filters,'https://api-statements.tnet.ge/v1/statements');
  assert.equal(c.rooms,9,'detail dictionary ID wins over an inherited list label');assert.equal(c.constructionYear,null);assert.equal(c.retrievalMetadata.buildYearSource,'1955-2000');
  const u=new URL(buildQueries({...request,niceToHave:['CENTRAL_HEATING'],exclusions:['AIR_CONDITIONING']},locations,filters)[0].url);
  assert.equal(u.searchParams.has('heating_types[0]'),false);assert.equal(u.searchParams.has('attrs[furniture-equipment][]'),false);
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
test('a live record with no canonical URL does not truncate pagination or invent a URL',async()=>{
  const s=simulated({missingUrlId:38});const result=await s.run();
  assert.deepEqual(s.pages,[1,2,3,4,5,6]);assert.equal(result.delivered,138);assert.equal(result.status,'PARTIAL');
  assert.equal(s.reports.at(-1).errors[0].code,'SOURCE_URL_UNAVAILABLE');assert.match(s.reports.at(-1).errors[0].message,/38/);
  assert.ok(s.reports.flatMap(r=>r.listings).every(l=>l.sourceListingId!=='38' && !l.exactUrl.includes('null')));
});
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
  for(const property of output.properties) for(const listing of property.listings){
    const candidate=validated.report.listings.find(c=>c.sourceListingId===listing.sourceListingId);
    assert.ok(candidate,'public response retains the individual source identity');
    assert.equal(listing.address,candidate.address??null);
    assert.equal(listing.exactUrl,candidate.exactUrl);
  }
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

test('access diagnostics distinguish explicit CAPTCHA, managed challenge and unknown rejection without leaking response data', async () => {
  for (const [body,headers,category] of [
    ['<div class="cf-turnstile">SECRET_CHALLENGE_TOKEN</div>',{'server':'cloudflare'},'CAPTCHA_REQUIRED'],
    ['<script>cf_chl_SECRET_CHALLENGE_TOKEN</script>',{'server':'cloudflare','cf-mitigated':'challenge'},'CHALLENGE_REQUIRED'],
    ['Denied SECRET_CHALLENGE_TOKEN',{},'ACCESS_RESTRICTED'],
  ]) {
    let calls=0;
    await assert.rejects(publicPage('https://www.myhome.ge/udzravi-qoneba/?page=1',async ()=>{
      calls++;return new Response(body,{status:403,headers});
    }), error => {
      assert.match(error.message,new RegExp('^HTTP 403; '+category));
      assert.ok(!error.message.includes('SECRET_CHALLENGE_TOKEN'));
      return true;
    });
    assert.equal(calls,1);
  }
});

test('public hydration preserves repeated attribute filters rather than dropping or broadening them', () => {
  const fixture=JSON.parse(readFileSync(new URL('./fixtures/myhome-public-next.json',import.meta.url),'utf8'));
  const next=structuredClone(fixture.search);
  const applied=next.props.pageProps.dehydratedState.queries[0].queryKey[2].query;
  applied['attrs[feature][]']=['106','107'];
  const url=fixture.searchUrl+'&attrs%5Bfeature%5D%5B%5D=106&attrs%5Bfeature%5D%5B%5D=107';
  const html=()=>'<script id="__NEXT_DATA__">'+JSON.stringify(next)+'</script>';
  assert.equal(parsePublicPage(html(),url).data.data[0].id,25610778);
  applied['attrs[feature][]']=['106'];
  assert.throws(()=>parsePublicPage(html(),url),/does not confirm/);
});
