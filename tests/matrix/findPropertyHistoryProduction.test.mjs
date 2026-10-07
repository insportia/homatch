import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedSearchHistory } from '../../supabase/functions/_shared/marketplaceHistory.ts';
import { loadMarketplaceSwitches } from '../../supabase/functions/_shared/marketplaceSearch.ts';
import { sanitizeBrief } from '../../src/research-core/marketplace/brief.ts';
import { edgeHandler, memoryDatabase } from '../helpers/marketplaceEdgeHarness.mjs';
const table = 'discovery_marketplace_searches';
function setup() {
  const db = memoryDatabase({ users: [{id:'owner',auth_id:'owner-auth',suspended_at:null}],
    [table]: [
      {id:'old-complete',user_id:'owner',status:'COMPLETE',created_at:'2026-10-05',brief:{city:{value:'Tbilisi',status:'CONFIRMED'}},properties_count:3,stats:null},
      {id:'new-failed',user_id:'owner',status:'FAILED',created_at:'2026-10-07',brief:null,completed_at:null},
      {id:'legacy-partial',user_id:'owner',status:'PARTIAL_COMPLETE',created_at:'2026-10-06',brief:{districts:{value:42},price:{value:{min:'bad'}}},stats:null},
      {id:'foreign',user_id:'someone-else',status:'COMPLETE',created_at:'2026-10-08',brief:{}},
    ] });
  const handler = edgeHandler('supabase/functions/marketplace-search/index.ts', { createClient:()=>db, loadMarketplaceSwitches, ownedSearchHistory, sanitizeBrief });
  const request = token => new Request('https://fixture.supabase.co/functions/v1/marketplace-search', { method:'POST',headers:{authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'history',page:1,user_id:'someone-else'}) });
  return {db,handler,request};
}
test('real authenticated history handler accepts the V2 action and returns owned legacy/null rows newest first even when acquisition is off',async()=>{
  const {handler,request}=setup();
  const response=await handler(request('owner-jwt'));
  assert.equal(response.status,200);
  const result=await response.json();
  assert.deepEqual(result.items.map(r=>r.id),['new-failed','legacy-partial','old-complete']);
  assert.equal(result.items[0].brief.city,null);
  assert.equal(result.items[1].brief.districts,null);
  assert.equal(result.items[1].brief.price,null);
  assert.equal(result.items[1].rawListings,null);
  assert.equal(result.items[0].completedAt,null);
  assert.equal(result.items[0].uniqueProperties,null,'missing optional counts must not fabricate zero inventory');
  assert.equal(result.items[2].brief.city.value,'Tbilisi');
});
test('history rejects unauthenticated access before querying searches; client user_id cannot change ownership',async()=>{
  const {handler,request}=setup();
  assert.equal((await handler(request('invalid'))).status,401);
  const response=await handler(request('owner-jwt'));
  assert.ok((await response.json()).items.every(r=>r.id!=='foreign'));
});
test('real database failure stays HTTP500, not empty history; an unchanged retry recovers',async()=>{
  const {db,handler,request}=setup();
  db.failure={message:'transient fixture DB failure'};
  const failed=await handler(request('owner-jwt'));
  assert.equal(failed.status,500);assert.deepEqual(await failed.json(),{error:'INTERNAL'});
  db.failure=null;
  const recovered=await handler(request('owner-jwt'));
  assert.equal(recovered.status,200);assert.equal((await recovered.json()).items.length,3);
});
