import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import ts from 'typescript';
import { normalizeListing, validateListing } from '../../supabase/functions/publishing-engine/listing-schema.js';
import { advance } from '../../supabase/functions/publishing-engine/engine.js';

const extension = 'publishing-extension/';
test('production extension rejects lookalikes, other routes, other extensions and child frames', async () => {
  let listener;
  const chrome = { runtime: { id: 'owned', onMessage: { addListener: fn => { listener = fn; } } }, tabs: { query: async () => [{ id: 5, url: 'https://statements.myhome.ge/ka/statement/create' }] } };
  vm.runInNewContext(fs.readFileSync(extension + 'background.js', 'utf8'), { chrome, URL, Set });
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
  assert.deepEqual(manifest.permissions, ['activeTab', 'scripting', 'storage']);
});

const ownerId = '11111111-1111-4111-8111-111111111111';
const listingId = '22222222-2222-4222-8222-222222222222';
const jobId = '33333333-3333-4333-8333-333333333333';
function setup({ validAuth = true, state = 'FILL_FORM', listingOwner = ownerId } = {}) {
  const payload = { id: listingId, version: 1, portalTargets: ['myhome'], price: 155000, photos: [] };
  const rows = { users: [{ id: ownerId, auth_id: 'auth-owner' }], publishing_engine_listings: [{ id: listingId, user_id: listingOwner, payload }], publishing_engine_jobs: [{ id: jobId, user_id: ownerId, revision: 0, payload: { id: jobId, listingId, version: 1, state, revision: 0, events: [] } }] };
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
  vm.runInNewContext(compiled, { createClient: () => client, normalizeListing, validateListing, advance, registry: { portals: [] }, parsePhoneNumberFromString: () => null, Deno: { env: { get: () => 'test' }, serve: fn => { handler = fn; } }, Request, Response, URL, Set, Error, JSON, Number, String, Uint8Array, Blob, atob, btoa, crypto: crypto.webcrypto });
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
  assert.equal((await (await request('/browser', { type: 'EXECUTE', portalId: 'ssge', tabId: 5, action: 'fillListing', listingId, jobId })).json()).code, 'COMMAND_NOT_ALLOWED');
});
test('browser writes require the exact job state and publication confirmation', async () => {
  const command = { type: 'EXECUTE', portalId: 'myhome', tabId: 5, listingId, jobId };
  assert.equal((await (await setup({ state: 'CONNECT_BROWSER' }).request('/browser', { ...command, action: 'fillListing' })).json()).code, 'JOB_STATE_MISMATCH');
  assert.equal((await (await setup({ state: 'READY_FOR_REVIEW' }).request('/browser', { ...command, action: 'publishAfterConfirmation', payload: { confirmed: true, reviewToken: 'review' } })).json()).code, 'JOB_STATE_MISMATCH');
  assert.equal((await (await setup({ state: 'SUBMITTING' }).request('/browser', { ...command, action: 'publishAfterConfirmation', payload: { reviewToken: 'review' } })).json()).code, 'PUBLICATION_CONFIRMATION_REQUIRED');
});
test('job transition uses revision checks and cannot skip review', async () => {
  const { request } = setup();
  assert.equal((await (await request('/jobs/transition', { jobId, revision: 9, state: 'UPLOAD_PHOTOS' })).json()).code, 'JOB_REVISION_CONFLICT');
  assert.equal((await (await request('/jobs/transition', { jobId, revision: 0, state: 'PUBLISHED' })).json()).code, 'INVALID_JOB_TRANSITION');
  assert.equal((await (await request('/jobs/transition', { jobId, revision: 0, state: 'UPLOAD_PHOTOS' })).json()).job.revision, 1);
  assert.equal((await (await request('/jobs/transition', { jobId, revision: 0, state: 'VERIFY_FORM' })).json()).code, 'JOB_REVISION_CONFLICT');
});
