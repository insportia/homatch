// FIND BUYERS — Phase 1 before Phase 2, enforced where money is spent.
//
// Runs the real executor (_shared/findBuyers/executor.ts) against an in-memory
// database: a Phase 2 Actor (TikTok search, Facebook group posts) is not
// reserved or started while Phase 1 discovery is still open inside its time
// box; it proceeds once Phase 1 is done (even partially) or timed out; a run
// already started is still polled; a Phase 1 job above its spend ceiling is
// refused before any reservation. No network: no Apify request is sent.
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
globalThis.fetch = async (url, init = {}) => {
  requests.push({ url: String(url), method: init.method ?? 'GET' });
  return new Response(JSON.stringify({ data: { id: 'pr1', status: 'RUNNING' } }), { status: 200 });
};
const { executeSocialJob } = await import('../findBuyers/executor.ts');

const future = () => new Date(Date.now() + 5 * 60_000).toISOString();
const past = () => new Date(Date.now() - 1000).toISOString();

function fakeDb({ phases, queue = [], runs = [], reserve = { ok: false, reason: 'CAMPAIGN_BUDGET' } }) {
  const tables = {
    admin_settings: [{ key: 'find_buyers_social_enabled', value: true }, { key: 'provider_disabled_list', value: ['DATAFORSEO'] }],
    find_buyers_campaigns: [{ matching_job_id: 'job1', campaign_id: 'c1', property_id: 'p1', user_id: 'u1', transaction: 'SALE', dna: {}, provider_budget_micros: 5_000_000, finalized_at: null, query_plan: { phases } }],
    find_buyers_actor_registry: [
      { actor_key: 'TIKTOK', actor_id: 'memo23~tiktok-scraper', probe_size: 15, timeout_seconds: 300, enabled: true, start_fee_micros: 5000, price_per_1k_micros: 2_000_000 },
      { actor_key: 'FB_GROUP_SEARCH', actor_id: 'memo23~facebook-groups-search', probe_size: 10, timeout_seconds: 300, enabled: true, start_fee_micros: 5000, price_per_1k_micros: 1_900_000 },
      { actor_key: 'FB_GROUP_POSTS', actor_id: 'memo23~apify-facebook-group-scraper', probe_size: 20, timeout_seconds: 300, enabled: true, start_fee_micros: 8000, price_per_1k_micros: 1_500_000 },
    ],
    discovery_query_queue: queue.map((q) => ({ matching_job_id: 'job1', ...q })),
    find_buyers_actor_runs: runs.map((r) => ({ matching_job_id: 'job1', ...r })),
  };
  const rpcs = [];
  function from(name) {
    const filters = [];
    const rows = () => (tables[name] ?? []).filter((r) => filters.every(([op, c, v]) => (op === 'eq' ? r[c] === v : op === 'in' ? v.includes(r[c]) : true)));
    const api = {
      select() { return api; }, order() { return api; }, limit() { return api; }, neq() { return api; }, not() { return api; }, is() { return api; },
      eq(c, v) { filters.push(['eq', c, v]); return api; },
      in(c, v) { filters.push(['in', c, v]); return api; },
      update() { return api; }, insert() { return api; }, upsert() { return api; },
      maybeSingle: async () => ({ data: rows()[0] ?? null, error: null }),
      single: async () => ({ data: rows()[0] ?? null, error: null }),
      then: (ok, bad) => Promise.resolve({ data: rows(), error: null }).then(ok, bad),
    };
    return api;
  }
  return { db: { from, rpc: async (n) => { rpcs.push(n); return { data: n === 'find_buyers_reserve_actor_run' ? reserve : null, error: null }; } }, rpcs };
}

const job = (stage, actorKey, extra = {}) => ({ id: `q-${stage}`, matching_job_id: 'job1', language: 'ka', metadata: { stage, actorKey, query: 'ბინა ვაკეში', size: 15, ...extra } });
const phase1Open = [{ provider: 'TELEGRAM_SOURCES', status: 'PROCESSING', metadata: {} }, { provider: 'APIFY_MEMO23', status: 'PENDING', metadata: { stage: 'FB_GROUP_SEARCH' } }];

test('a source-dependent Phase 2 run (reads the discovered pool) waits while Phase 1 is open — no reservation, no provider request', async () => {
  for (const j of [job('FB_GROUP_POSTS', 'FB_GROUP_POSTS', { targetUrl: 'https://www.facebook.com/groups/x/', query: null })]) {
    requests.length = 0;
    const { db, rpcs } = fakeDb({ phases: { phase1DeadlineAt: future() }, queue: phase1Open });
    const r = await executeSocialJob(db, j);
    assert.equal(r.outcome, 'WAIT', j.metadata.stage);
    assert.equal(r.metadata.lastWait, 'PHASE1_DISCOVERY');
    assert.equal(r.metadata.phase1Open, 2);
    assert.deepEqual(rpcs, [], 'nothing reserved');
    assert.equal(requests.length, 0, 'nothing sent to Apify');
  }
});

test('Phase 2 proceeds to the reservation once Phase 1 is done (partially failed counts) or its time box has closed', async () => {
  const done = fakeDb({ phases: { phase1DeadlineAt: future() }, queue: [{ provider: 'TELEGRAM_SOURCES', status: 'FAILED', metadata: {} }, { provider: 'APIFY_MEMO23', status: 'DONE', metadata: { stage: 'FB_GROUP_SEARCH' } }] });
  await executeSocialJob(done.db, job('TIKTOK_SEARCH', 'TIKTOK'));
  assert.deepEqual(done.rpcs, ['find_buyers_reserve_actor_run']);
  const timedOut = fakeDb({ phases: { phase1DeadlineAt: past() }, queue: phase1Open });
  await executeSocialJob(timedOut.db, job('TIKTOK_SEARCH', 'TIKTOK'));
  assert.deepEqual(timedOut.rpcs, ['find_buyers_reserve_actor_run'], 'an unanswered provider cannot stall Phase 2');
});

test('an independent search (TikTok) does not wait for unrelated discovery: it goes to the reservation at once', async () => {
  const { db, rpcs } = fakeDb({ phases: { phase1DeadlineAt: future() }, queue: phase1Open });
  const r = await executeSocialJob(db, job('TIKTOK_SEARCH', 'TIKTOK'));
  assert.notEqual(r.metadata?.lastWait, 'PHASE1_DISCOVERY');
  assert.ok(rpcs.includes('find_buyers_reserve_actor_run'), 'reserved under the same atomic caps');
});

test('the planned-but-not-yet-queued Telegram discovery holds the source-dependent reads', async () => {
  const { db, rpcs } = fakeDb({ phases: { phase1DeadlineAt: future(), expectedProviders: ['TELEGRAM_SOURCES'] }, queue: [] });
  const r = await executeSocialJob(db, job('TELEGRAM_CHANNEL', 'TELEGRAM_CHANNEL', { targetUrl: 'https://t.me/tbilisi_flats', query: null }));
  assert.equal(r.outcome, 'WAIT');
  assert.deepEqual(rpcs, []);
});

test('a campaign planned before phases existed is never held (no stored deadline)', async () => {
  const { db, rpcs } = fakeDb({ phases: undefined, queue: phase1Open });
  await executeSocialJob(db, job('TIKTOK_SEARCH', 'TIKTOK'));
  assert.deepEqual(rpcs, ['find_buyers_reserve_actor_run']);
});

test('a started run is always polled, Phase 1 or not', async () => {
  requests.length = 0;
  const { db } = fakeDb({ phases: { phase1DeadlineAt: future() }, queue: phase1Open,
    runs: [{ id: 'r1', actor_key: 'TIKTOK', provider_run_id: 'pr1', cost_booked_at: null, status: 'RUNNING', created_at: new Date().toISOString(), started_at: new Date().toISOString(), requested_limit: 15 }] });
  const r = await executeSocialJob(db, job('TIKTOK_SEARCH', 'TIKTOK', { actorRunId: 'r1', providerRunId: 'pr1' }));
  assert.notEqual(r.metadata?.lastWait, 'PHASE1_DISCOVERY');
  assert.ok(requests.some((q) => q.url.includes('/actor-runs/pr1')), 'polled');
});

test('Phase 1 discovery is refused before reservation once its spend ceiling is reached; below it, it reserves', async () => {
  const over = fakeDb({ phases: { phase1DeadlineAt: future(), budget: { discoveryCapMicros: 30_000 } },
    runs: [{ id: 'g1', actor_key: 'FB_GROUP_SEARCH', operation: 'FB_GROUP_SEARCH', status: 'SUCCEEDED', reserved_micros: 24_000, actual_micros: 20_000 }] });
  const r = await executeSocialJob(over.db, job('FB_GROUP_SEARCH', 'FB_GROUP_SEARCH', { size: 10 }));
  assert.equal(r.outcome, 'CANCELLED');
  assert.equal(r.error, 'PHASE1_BUDGET');
  assert.equal(r.metadata.committedMicros, 20_000);
  assert.equal(r.metadata.estimateMicros, 24_000);
  assert.deepEqual(over.rpcs, []);
  const under = fakeDb({ phases: { phase1DeadlineAt: future(), budget: { discoveryCapMicros: 61_000 } } });
  await executeSocialJob(under.db, job('FB_GROUP_SEARCH', 'FB_GROUP_SEARCH', { size: 10 }));
  assert.deepEqual(under.rpcs, ['find_buyers_reserve_actor_run']);
});

import { readFileSync } from 'node:fs';
test('the native Telegram read (Find Buyers only) is held by the same gate, without consuming an attempt (source check)', () => {
  const src = readFileSync(new URL('../../discovery-queue-worker/driver.ts', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('async function runSourceJobs'), src.indexOf('async function runSocialJobs'));
  const gate = fn.indexOf("job.metadata?.direction === 'DEMAND'");
  const exec = fn.indexOf('executeSourceJob(baseUrl, serviceKey, job)');
  assert.ok(gate > 0 && exec > gate, 'the gate runs before the read');
  assert.match(fn.slice(gate - 200, exec), /provider \?\? ''\)\.toUpperCase\(\) === 'TELEGRAM'/);
  assert.match(fn.slice(gate, exec), /loadPhase1\(db, job\.matching_job_id\)/);
  assert.match(fn.slice(gate, exec), /phase2MayStart\(p1\.state\)/);
  assert.match(fn.slice(gate, exec), /finish_discovery_source_job_wait/, 'a wait, not a retry: no attempt is consumed');
});

test('circuit breaker: an Actor that failed/came back empty twice in this campaign is cancelled before any reservation or provider request', async () => {
  requests.length = 0;
  const failed = { actor_key: 'TIKTOK', status: 'FAILED', items_fetched: 0, cost_booked_at: past(), created_at: past() };
  const { db, rpcs } = fakeDb({ phases: { phase1DeadlineAt: past() }, queue: [], runs: [failed, { ...failed, status: 'SUCCEEDED' }] });
  const r = await executeSocialJob(db, job('TIKTOK_SEARCH', 'TIKTOK'));
  assert.equal(r.outcome, 'CANCELLED');
  assert.equal(r.error, 'ACTOR_UNPRODUCTIVE_IN_CAMPAIGN');
  assert.deepEqual(rpcs, [], 'nothing reserved');
  assert.equal(requests.length, 0, 'nothing sent to Apify');
});

test('circuit breaker: one productive run keeps the Actor going', async () => {
  const ok = { actor_key: 'TIKTOK', status: 'SUCCEEDED', items_fetched: 15, useful_results: 1, cost_booked_at: past(), created_at: past() };
  const bad = { actor_key: 'TIKTOK', status: 'FAILED', items_fetched: 0, cost_booked_at: past(), created_at: past() };
  const { db, rpcs } = fakeDb({ phases: { phase1DeadlineAt: past() }, queue: [], runs: [bad, ok] });
  const r = await executeSocialJob(db, job('TIKTOK_SEARCH', 'TIKTOK'));
  assert.notEqual(r.error, 'ACTOR_UNPRODUCTIVE_IN_CAMPAIGN');
  assert.ok(rpcs.includes('find_buyers_reserve_actor_run'));
});
