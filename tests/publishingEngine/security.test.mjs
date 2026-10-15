import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
import { normalizeListing, validateListing } from '../../supabase/functions/publishing-engine/listing-schema.js';
import { advance } from '../../supabase/functions/publishing-engine/engine.js';

const extension = 'publishing-extension/';
test('publishing frame permits same-origin embedding while all existing pages retain frame denial',()=>{
  const config=JSON.parse(fs.readFileSync('vercel.json','utf8'));
  const root=config.headers.find(x=>x.source==='/(.*)');
  assert.equal(root.headers.find(x=>x.key==='X-Frame-Options').value,'DENY');
  const frame=config.headers.at(-1);
  assert.equal(frame.source,'/publishing-engine/(.*)');
  assert.equal(frame.headers.find(x=>x.key==='X-Frame-Options').value,'SAMEORIGIN');
  assert.match(frame.headers.find(x=>x.key==='Content-Security-Policy').value,/frame-ancestors 'self'/);
});
test('production extension rejects lookalikes, other routes, other extensions and child frames', async () => {
  let listener;
  const chrome = { runtime: { id: 'owned', onMessage: { addListener: fn => { listener = fn; } } }, tabs: { query: async () => [{ id: 5, url: 'https://statements.myhome.ge/ka/statement/create' }] } };
  vm.runInNewContext([fs.readFileSync('publishing-extension/adapters/contract.js','utf8'),fs.readFileSync('publishing-extension/adapters/portals.js','utf8'),fs.readFileSync(extension + 'background.js', 'utf8').replace(/^importScripts.*\n/,'')].join('\n'), { chrome, URL, Set });
  for (const url of ['https://homatch.live.evil.test/property/publish', 'http://homatch.live/property/publish', 'https://homatch.live/property', 'https://evil.test/']) assert.equal(listener({ type: 'CONNECT' }, { id: 'owned', frameId: 0, tab: { url } }, () => assert.fail('Rejected sender received data')), undefined);
  const sender = { id: 'owned', frameId: 0, tab: { url: 'https://homatch.live/property/publish' } };
  assert.equal(listener({ type: 'CONNECT' }, { ...sender, frameId: 1 }, () => assert.fail()), undefined);
  assert.equal(listener({ type: 'CONNECT' }, { ...sender, id: 'another' }, () => assert.fail()), undefined);
  const response = await new Promise(resolve => listener({ type: 'CONNECT' }, sender, resolve));
  assert.equal(response.tabs[0].id, 5);
  assert.equal((await new Promise(resolve => listener({type:'CONNECT'}, {...sender,tab:{url:'https://www.homatch.live/property/publish'}},resolve))).ok,true);
  for (const action of ['eval', 'navigate', 'deleteListing', 'pauseListing']) assert.equal((await new Promise(resolve => listener({ type: 'EXECUTE', portalId: 'myhome', action }, sender, resolve))).ok, false);
});

test('bridge checks origin and pathname at message time after SPA navigation', async () => {
  let receive, calls = 0;
  const window = { addEventListener: (_, fn) => { receive = fn; }, postMessage: () => {} };
  const location = { origin: 'https://homatch.live', pathname: '/property/add' };
  vm.runInNewContext(fs.readFileSync(extension + 'bridge.js', 'utf8'), { window, location, chrome: { runtime: { sendMessage: async () => { calls++; return { ok: true }; } } } });
  const event = { source: window, origin: location.origin, data: { source: 'HOMATCH_UI', requestId: 'request', command: { type: 'CONNECT' } } };
  await receive(event); assert.equal(calls, 0);
  location.pathname = '/property/publish'; await receive(event); assert.equal(calls, 1);
  await receive({ ...event, origin: 'https://evil.test' }); await receive({ ...event, source: {} }); assert.equal(calls, 1);
  const manifest = JSON.parse(fs.readFileSync(extension + 'manifest.json', 'utf8'));
  assert.ok(manifest.host_permissions.includes('https://homatch.live/*'));
  assert.ok(!JSON.stringify(manifest).includes('<all_urls>'));
  assert.deepEqual(manifest.permissions, ['scripting']);
  assert.ok(!fs.readFileSync(extension+'popup.js','utf8').includes('executeScript'));
});

const ownerId = '11111111-1111-4111-8111-111111111111';
const listingId = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';
function setup({ validAuth = true, state = 'FILL_FORM', listingOwner = ownerId, portalId = 'myhome', extraOrigins } = {}) {
  const payload = { id: listingId, version: 1, portalTargets: [portalId], price: 155000, photos: [] };
  const rows = { users: [{ id: ownerId, auth_id: 'auth-owner' }], publishing_engine_listings: [{ id: listingId, user_id: listingOwner, payload }], publishing_engine_jobs: [{ id: jobId, user_id: ownerId, revision: 0, payload: { id: jobId, listingId, portalId, version: 1, state, revision: 0, events: [] } }] };
  const client = {
    auth: { getUser: async () => ({ data: { user: validAuth ? { id: 'auth-owner' } : null }, error: validAuth ? null : {} }) },
    from(table) {
      const filters = []; let update;
      const read = () => (rows[table] || []).filter(row => filters.every(([k, v]) => row[k] === v));
      const query = { select() { return query; }, eq(k, v) { filters.push([k, v]); return query; }, order() { return query; }, limit() { return query; }, update(value) { update = value; return query; }, async maybeSingle() { const row = read()[0]; if (row && update) Object.assign(row, update); return { data: row || null, error: null }; }, then(resolve, reject) { return Promise.resolve({ data: read(), error: null }).then(resolve, reject); } };
      return query;
    },
  };
  let handler;
  const source = fs.readFileSync('supabase/functions/publishing-engine/index.ts', 'utf8').replace(/^import .*;\r?\n/gm, '').replace('export async function handler', 'async function handler');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  vm.runInNewContext(compiled, { createClient: () => client, normalizeListing, validateListing, advance, registry: JSON.parse(fs.readFileSync('supabase/functions/publishing-engine/registry.json','utf8')), parsePhoneNumberFromString: () => null, Deno: { env: { get: name => name === 'PUBLISHING_ALLOWED_ORIGINS' ? extraOrigins : 'test' }, serve: fn => { handler = fn; } }, Request, Response, URL, Set, Error, JSON, Number, String, Uint8Array, Blob, atob, btoa, crypto: crypto.webcrypto });
  const request = (url, body, { origin = 'https://homatch.live', auth = 'Bearer synthetic-test-token' } = {}) => handler(new Request('https://example.test', { method: 'POST', headers: { Origin: origin, Authorization: auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ url, body }) }));
  return { request, payload, rows };
}
test('API denies foreign origins, missing auth and invalid sessions', async () => {
  const { request } = setup();
  assert.equal((await request('/listings', null, { origin: 'https://homatch.live.evil.test' })).status, 403);
  assert.equal((await request('/listings', null, { auth: '' })).status, 401);
  assert.equal((await setup({ validAuth: false }).request('/listings')).status, 401);
});
test('API reads only owned drafts and cannot authorize another owner listing', async () => {
  const { request } = setup({ listingOwner: 'another-owner' });
  assert.deepEqual((await (await request('/listings')).json()).listings, []);
  const response = await request('/browser', { type: 'EXECUTE', portalId: 'myhome', tabId: 5, action: 'fillListing', listingId, jobId });
  assert.equal((await response.json()).code, 'OWNED_RECORD_REQUIRED');
});
test('browser authorization replaces supplied listing data with the saved canonical version', async () => {
  const { request } = setup();
  const response = await request('/browser', { type: 'EXECUTE', portalId: 'myhome', tabId: 5, action: 'fillListing', listingId, jobId, payload: { price: 1, portalTargets: ['ssge'] } });
  const result = await response.json();
  assert.equal(result.command.payload.price, 155000);
  assert.deepEqual(result.command.payload.portalTargets, ['myhome']);
  assert.equal((await (await request('/browser', { type: 'EXECUTE', portalId: 'ssge', tabId: 5, action: 'fillListing', listingId, jobId })).json()).code, 'JOB_LISTING_MISMATCH');
});
test('browser writes require the exact job state and publication confirmation', async () => {
  const command = { type: 'EXECUTE', portalId: 'myhome', tabId: 5, listingId, jobId };
  assert.equal((await (await setup({ state: 'CONNECT_BROWSER' }).request('/browser', { ...command, action: 'fillListing' })).json()).code, 'JOB_STATE_MISMATCH');
  // Live submission is disabled even with a fabricated review token or confirmation.
  for(const state of ['READY_FOR_REVIEW','SUBMITTING'])for(const confirmed of [false,true])assert.equal((await (await setup({state}).request('/browser',{...command,action:'publishAfterConfirmation',payload:{confirmed,reviewToken:'review'}})).json()).code,'LIVE_BROWSER_VERIFICATION_REQUIRED');
  assert.throws(()=>advance({state:'READY_FOR_REVIEW',events:[]},'SUBMITTING',{confirmed:false}),/PUBLICATION_CONFIRMATION_REQUIRED/);
});
test('job transition uses revision checks and cannot skip review', async () => {
  const { request } = setup();
  assert.equal((await (await request('/jobs/transition', { jobId, revision: 9, state: 'UPLOAD_PHOTOS' })).json()).code, 'JOB_REVISION_CONFLICT');
  assert.equal((await (await request('/jobs/transition', { jobId, revision: 0, state: 'PUBLISHED' })).json()).code, 'LIVE_BROWSER_VERIFICATION_REQUIRED');
  assert.equal((await (await request('/jobs/transition', { jobId, revision: 0, state: 'UPLOAD_PHOTOS' })).json()).job.revision, 1);
  assert.equal((await (await request('/jobs/transition', { jobId, revision: 0, state: 'VERIFY_FORM' })).json()).code, 'JOB_REVISION_CONFLICT');
});

test('SS.ge backend isolates the portal and blocks publication even with confirmation',async()=>{
 const {request}=setup({portalId:'ssge'});
 const command={type:'EXECUTE',portalId:'ssge',tabId:5,listingId,jobId};
 const result=await (await request('/browser',{...command,action:'fillListing',payload:{price:1}})).json();
 assert.equal(result.command.portalId,'ssge');assert.equal(result.command.payload.price,155000);
 assert.equal((await (await request('/browser',{...command,portalId:'myhome',action:'fillListing'})).json()).code,'JOB_LISTING_MISMATCH');
 assert.equal((await (await request('/browser',{...command,action:'publishAfterConfirmation',payload:{confirmed:true,reviewToken:'review'}})).json()).code,'LIVE_BROWSER_VERIFICATION_REQUIRED');
 for(const state of ['READY_FOR_REVIEW','SUBMITTING','PUBLISHED'])assert.equal((await (await request('/jobs/transition',{jobId,revision:0,state,confirmed:true})).json()).code,'LIVE_BROWSER_VERIFICATION_REQUIRED');
});

test('deployment origins allow only explicitly configured HTTPS origins, not wildcards or lookalikes',async()=>{
 const s=setup({extraOrigins:'https://homatch-preview.vercel.app,https://*.vercel.app,https://bad.test/path,http://insecure.test'});
 assert.equal((await s.request('/listings',null,{origin:'https://homatch-preview.vercel.app'})).status,200);
 for(const origin of ['https://another.vercel.app','https://homatch-preview.vercel.app.evil.test','https://bad.test','http://insecure.test'])assert.equal((await s.request('/listings',null,{origin})).status,403);
});
