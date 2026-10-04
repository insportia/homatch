// APIFY RESTORED FOR MEMO23 ONLY — the Admin → Providers switch is real.
//
// Runs the real executor (_shared/findBuyers/executor.ts), settings loader
// (campaign.ts) and memo23 client against an in-memory database and a fetch
// recorder. No network: every Apify request is captured, never sent.
//
// Proven: APIFY in provider_disabled_list stops every new memo23 run before
// any reservation or provider request; an in-flight run is asked to abort and
// still polled so its cost is booked; the database's own refusal
// (find_buyers_reserve_actor_run → APIFY_DISABLED_BY_ADMIN) is honoured; a job
// can only run an Actor that is in the registry, and only a memo23 one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('https://esm.sh/')) {
      return { url: 'data:text/javascript,export const createClient = () => { throw new Error("no network in tests"); };', shortCircuit: true };
    }
    return next(spec, ctx);
  }`));

globalThis.Deno = { env: { get: (k) => (k === 'APIFY_API_TOKEN' ? 'test-token-not-real' : undefined) } };
const requests = [];
let runStatus = 'RUNNING';
globalThis.fetch = async (url, init = {}) => {
  requests.push({ url: String(url), method: init.method ?? 'GET' });
  const body = String(url).includes('/actor-runs/') ? { data: { id: 'pr1', status: runStatus, startedAt: new Date().toISOString() } } : { data: {} };
  return new Response(JSON.stringify(body), { status: 200 });
};

const { executeSocialJob } = await import('../findBuyers/executor.ts');
const { apifyDisabledByAdmin, loadFindBuyersSettings } = await import('../findBuyers/campaign.ts');
const { assertMemo23ActorId } = await import('../findBuyers/memo23Client.ts');

function fakeDb({ disabled = ['DATAFORSEO'], social = true, reserve = null, actors = null, run = null } = {}) {
  const tables = {
    admin_settings: [
      { key: 'find_buyers_social_enabled', value: social },
      { key: 'provider_disabled_list', value: disabled },
    ],
    find_buyers_campaigns: [{ matching_job_id: 'job1', campaign_id: 'c1', property_id: 'p1', user_id: 'u1', transaction: 'SALE', dna: {}, provider_budget_micros: 5000000, finalized_at: null }],
    find_buyers_actor_registry: actors ?? [{ actor_key: 'TIKTOK', actor_id: 'memo23~tiktok-scraper', probe_size: 15, timeout_seconds: 300, enabled: true }],
    find_buyers_actor_runs: run ? [run] : [],
  };
  const rpcs = [];
  function from(name) {
    const filters = [];
    const rows = () => (tables[name] ?? []).filter((r) => filters.every(([op, c, v]) => (op === 'eq' ? r[c] === v : op === 'in' ? v.includes(r[c]) : true)));
    const api = {
      select() { return api; }, order() { return api; }, limit() { return api; }, neq() { return api; }, not() { return api; },
      eq(c, v) { filters.push(['eq', c, v]); return api; },
      in(c, v) { filters.push(['in', c, v]); return api; },
      update() { return api; }, insert() { return api; }, upsert() { return api; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (ok, bad) => Promise.resolve({ data: rows(), error: null }).then(ok, bad),
    };
    return api;
  }
  const db = { from, rpc: async (n, a) => { rpcs.push(n); return { data: n === 'find_buyers_reserve_actor_run' ? reserve : null, error: null }; } };
  return { db, rpcs };
}

const newJob = { id: 'q1', matching_job_id: 'job1', language: 'ka', metadata: { stage: 'TIKTOK_SEARCH', actorKey: 'TIKTOK', query: 'ბინა ვაკეში' } };

test('the switch reads provider_disabled_list as stored (array or JSON text), case-insensitively', () => {
  assert.equal(apifyDisabledByAdmin(['APIFY', 'DATAFORSEO']), true);
  assert.equal(apifyDisabledByAdmin('["apify"]'), true);
  assert.equal(apifyDisabledByAdmin(['DATAFORSEO']), false);
  assert.equal(apifyDisabledByAdmin(undefined), false);
  assert.equal(apifyDisabledByAdmin('not json'), false);
});

test('Apify disabled on Admin → Providers turns social off even when find_buyers_social_enabled is on', async () => {
  const off = await loadFindBuyersSettings(fakeDb({ disabled: ['APIFY', 'DATAFORSEO'] }).db);
  assert.equal(off.apifyEnabled, false);
  assert.equal(off.socialEnabled, false);
  const on = await loadFindBuyersSettings(fakeDb({ disabled: ['DATAFORSEO'] }).db);
  assert.equal(on.apifyEnabled, true);
  assert.equal(on.socialEnabled, true);
});

test('Apify disabled: a new memo23 job is refused before any reservation or provider request', async () => {
  requests.length = 0;
  const { db, rpcs } = fakeDb({ disabled: ['APIFY'] });
  const r = await executeSocialJob(db, newJob);
  assert.equal(r.outcome, 'CANCELLED');
  assert.equal(r.error, 'APIFY_DISABLED_BY_ADMIN');
  assert.deepEqual(rpcs, [], 'no reservation');
  assert.equal(requests.length, 0, 'no Apify request');
});

test('Apify disabled while a run is in flight: the provider is asked to abort and the run is still polled (cost booked later)', async () => {
  requests.length = 0;
  runStatus = 'RUNNING';
  const run = { id: 'r1', actor_key: 'TIKTOK', provider_run_id: 'pr1', cost_booked_at: null, created_at: new Date().toISOString(), started_at: new Date().toISOString(), requested_limit: 15 };
  const { db } = fakeDb({ disabled: ['APIFY'], run });
  const r = await executeSocialJob(db, { ...newJob, metadata: { ...newJob.metadata, actorRunId: 'r1', providerRunId: 'pr1' } });
  assert.ok(requests.some((q) => q.method === 'POST' && q.url.endsWith('/actor-runs/pr1/abort')), 'abort requested');
  assert.ok(requests.some((q) => q.method === 'GET' && q.url.endsWith('/actor-runs/pr1')), 'still polled');
  assert.ok(!requests.some((q) => q.url.includes('/acts/') && q.method === 'POST'), 'nothing new is started');
  assert.equal(r.outcome, 'WAIT', 'kept until terminal so its real cost is booked');
});

test('the database gate is honoured: reserve refusing APIFY_DISABLED_BY_ADMIN means no run', async () => {
  requests.length = 0;
  const { db, rpcs } = fakeDb({ reserve: { ok: false, reason: 'APIFY_DISABLED_BY_ADMIN' } });
  const r = await executeSocialJob(db, newJob);
  assert.deepEqual(rpcs, ['find_buyers_reserve_actor_run'], 'reserve is asked first');
  assert.equal(r.outcome, 'CANCELLED');
  assert.equal(r.error, 'APIFY_DISABLED_BY_ADMIN');
  assert.equal(requests.length, 0);
});

test('only registered Actors run: an unknown actorKey (or an actorId in the job) cannot bypass the registry', async () => {
  requests.length = 0;
  const { db, rpcs } = fakeDb();
  const r = await executeSocialJob(db, { ...newJob, metadata: { ...newJob.metadata, actorKey: 'EVIL', actorId: 'someone~web-scraper' } });
  assert.equal(r.outcome, 'FAILED');
  assert.match(String(r.error), /UNKNOWN_ACTOR/);
  assert.deepEqual(rpcs, []);
  assert.equal(requests.length, 0);
  for (const bad of ['apify~web-scraper', 'someone/x', '', 'memo23~../acts']) assert.throws(() => assertMemo23ActorId(bad), /ACTOR_NOT_ALLOWED/);
  assert.equal(assertMemo23ActorId('memo23/tiktok-scraper'), 'memo23~tiktok-scraper');
});
