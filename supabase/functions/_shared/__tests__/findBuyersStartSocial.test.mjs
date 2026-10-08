// FIND BUYERS — the customer search actually plans and queues memo23 Actors.
//
// Production 2026-10-04 (jobs 7517daa6, 123bd287): planQueries ended with
// `db.from('find_buyers_query_cache').upsert(...).catch(...)`. A supabase-js
// PostgREST builder is only THENABLE (no .catch) and LAZY (the request is sent
// on .then), so the call threw `.catch is not a function`, startSocialCampaign
// died before writing the query plan or any APIFY_MEMO23 queue row, and every
// owner search ran native Telegram only (0 find_buyers_actor_runs).
//
// This test drives the real startSocialCampaign against builders shaped like
// production's — then only, no catch — and proves the plan is written, enabled
// primary Actors are queued, enrichment needs a seed, and a failing cache write
// never blocks the plan.
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

/* No OpenAI key: the model step returns no extra queries (deterministic plan only). */
globalThis.Deno = { env: { get: () => undefined } };
globalThis.fetch = async () => { throw new Error('no network in tests'); };

const { startSocialCampaign } = await import('../findBuyers/campaign.ts');

const PRICED = (key, extra = {}) => ({ actor_key: key, enabled: true, emergency_disabled: false, health: 'UNKNOWN', pricing_verified_at: new Date().toISOString(),
  pricing_model: 'PAY_PER_EVENT', price_per_1k_micros: 1_000_000, probe_size: 10, priority: 60, ...extra });

/** A database whose builders behave like PostgREST's: lazy, thenable, and with NO .catch. */
function prodLikeDb({ actors, sources = [], cacheUpsertError = null }) {
  const log = { inserts: [], updates: [], upserts: [], rpcs: [] };
  const tables = {
    admin_settings: [{ key: 'credits_per_usd', value: 10 }],
    find_buyers_actor_registry: actors,
    find_buyers_query_cache: [],
    source_registry: sources,
  };
  function builder(name) {
    const st = { op: 'select', filters: [], payload: null, single: false };
    const exec = async () => {
      if (st.op === 'insert') { log.inserts.push({ table: name, row: st.payload }); return { data: null, error: null }; }
      if (st.op === 'update') { log.updates.push({ table: name, patch: st.payload }); return { data: null, error: null }; }
      if (st.op === 'upsert') {
        log.upserts.push({ table: name, row: st.payload });
        return { data: null, error: name === 'find_buyers_query_cache' ? cacheUpsertError : null };
      }
      const rows = (tables[name] ?? []).filter((r) => st.filters.every(([c, v]) => r[c] === v));
      return { data: st.single ? rows[0] ?? null : rows, error: null };
    };
    const b = {};
    for (const m of ['select', 'eq', 'neq', 'in', 'is', 'not', 'or', 'order', 'limit', 'gte', 'lte', 'ilike']) {
      b[m] = (c, v) => { if (m === 'eq') st.filters.push([c, v]); return b; };
    }
    b.insert = (p) => { st.op = 'insert'; st.payload = p; return b; };
    b.update = (p) => { st.op = 'update'; st.payload = p; return b; };
    b.upsert = (p) => { st.op = 'upsert'; st.payload = p; return b; };
    b.maybeSingle = () => { st.single = true; return b; };
    b.single = () => { st.single = true; return b; };
    b.then = (ok, bad) => exec().then(ok, bad);
    assert.equal(b.catch, undefined, 'a PostgREST builder has no .catch');
    return b;
  }
  const db = { from: builder, rpc: (n, a) => { log.rpcs.push(n); return { then: (ok, bad) => Promise.resolve({ data: null, error: null }).then(ok, bad) }; } };
  return { db, log };
}

const SETTINGS = { socialEnabled: true, apifyEnabled: true, minUsd: 10, providerShareBps: 5000, pricingMaxAgeDays: 30, commentGate: { skipBelow: 70, eligibleFrom: 85 }, sampling: null, priceBook: null };
const INPUT = {
  matchingJobId: 'job-1', campaignId: 'camp-1', propertyId: 'prop-1', userId: 'user-1', credits: 100, planId: 'plan-1',
  property: { transaction_type: 'SALE', property_type: 'APARTMENT' },
  facts: { country_code: 'GE', city: 'Tbilisi', district: 'Krtsanisi', total_price: 180000, currency: 'USD', area: 95, rooms: 3, bedrooms: 2 },
  nativeTelegramActive: true,
};

test('an uncached search plans and queues memo23 Actors with production-shaped builders (no .catch)', async () => {
  const { db, log } = prodLikeDb({ actors: [PRICED('FB_GROUP_SEARCH'), PRICED('TIKTOK'), PRICED('LINKEDIN_POSTS'), PRICED('BLUESKY')] });
  const out = await startSocialCampaign(db, INPUT, SETTINGS);
  assert.equal(out.reason, null, `planning stopped: ${out.reason}`);
  assert.ok(out.queued > 0, 'memo23 jobs queued');
  const planWrite = log.updates.find((u) => u.table === 'find_buyers_campaigns' && u.patch.query_plan);
  assert.ok(planWrite, 'the query plan is written');
  const queued = log.inserts.filter((i) => i.table === 'discovery_query_queue').map((i) => i.row);
  assert.equal(queued.length, out.queued);
  assert.ok(queued.every((r) => r.provider === 'APIFY_MEMO23'), 'all social jobs go to the memo23 pool');
  const actorsQueued = new Set(queued.map((r) => r.metadata?.actorKey));
  for (const k of ['FB_GROUP_SEARCH', 'TIKTOK', 'LINKEDIN_POSTS', 'BLUESKY']) assert.ok(actorsQueued.has(k), `${k} queued`);
  assert.ok(queued.every((r) => r.metadata?.query || r.metadata?.targetUrl), 'never a job without a query or target');
  assert.ok(log.upserts.some((u) => u.table === 'find_buyers_query_cache'), 'the query cache write is actually sent');
});

test('a failing cache write never blocks the plan', async () => {
  const { db } = prodLikeDb({ actors: [PRICED('FB_GROUP_SEARCH')], cacheUpsertError: { message: 'permission denied' } });
  const out = await startSocialCampaign(db, INPUT, SETTINGS);
  assert.equal(out.reason, null);
  assert.ok(out.queued > 0);
});

test('enrichment Actors need a seed: with no known sources they are not queued; with one they are', async () => {
  const enrich = [PRICED('FB_GROUP_POSTS'), PRICED('IG_PROFILE_POSTS'), PRICED('X_PROFILE'), PRICED('YOUTUBE_COMMENTS'), PRICED('THREADS_PROFILE'), PRICED('VK_POSTS_COMMENTS')];
  const none = prodLikeDb({ actors: enrich });
  const a = await startSocialCampaign(none.db, INPUT, SETTINGS);
  assert.equal(a.queued, 0, 'no seed → no paid enrichment job');
  assert.equal(a.reason, 'NO_JOBS');
  const seeded = prodLikeDb({ actors: enrich, sources: [{ id: 's1', platform: 'FACEBOOK', url: 'https://www.facebook.com/groups/tbilisi.flats/', languages: ['ka'], language: 'ka', city: 'Tbilisi', fb_spend_micros: 0, fb_qualified_leads: 0, last_checked_at: null, access_state: 'PUBLIC', lifecycle: 'ACTIVE' }] });
  const b = await startSocialCampaign(seeded.db, INPUT, SETTINGS);
  const rows = seeded.log.inserts.filter((i) => i.table === 'discovery_query_queue').map((i) => i.row);
  assert.ok(rows.length >= 1 && rows.every((r) => r.metadata?.actorKey === 'FB_GROUP_POSTS' && r.metadata?.targetUrl), `only the seeded family runs: ${JSON.stringify(rows.map((r) => r.metadata?.actorKey))}`);
  assert.equal(b.reason, null);
});

test('disabled, unpriced or switched-off Actors are never queued', async () => {
  const { db } = prodLikeDb({ actors: [PRICED('TIKTOK', { enabled: false }), PRICED('BLUESKY', { pricing_verified_at: null }), PRICED('LINKEDIN_POSTS', { pricing_model: 'UNKNOWN' })] });
  const out = await startSocialCampaign(db, INPUT, SETTINGS);
  assert.equal(out.queued, 0);
  assert.equal(out.reason, 'NO_ACTOR_READY');
  const off = await startSocialCampaign(prodLikeDb({ actors: [PRICED('TIKTOK')] }).db, INPUT, { ...SETTINGS, socialEnabled: false });
  assert.equal(off.reason, 'SOCIAL_DISABLED');
});

test('PAID_FIRST queues the memo23 Telegram Actor on known channels and reports it (the free reader then becomes the fallback)', async () => {
  const tg = (i) => ({ id: `tg${i}`, platform: 'TELEGRAM', url: `https://t.me/tbilisi_flats_${i}`, languages: ['ru'], language: 'ru', city: 'Tbilisi', fb_spend_micros: 0, fb_qualified_leads: 0, last_checked_at: null, access_state: 'PUBLIC', lifecycle: 'ACTIVE' });
  const run = async (pref) => {
    const { db, log } = prodLikeDb({ actors: [PRICED('TELEGRAM_CHANNEL', { probe_size: 30 })], sources: [tg(1), tg(2)] });
    const out = await startSocialCampaign(db, INPUT, { ...SETTINGS, telegramPreference: pref });
    return { out, rows: log.inserts.filter((i) => i.table === 'discovery_query_queue').map((i) => i.row) };
  };
  const native = await run('NATIVE_FIRST');
  assert.equal(native.out.paidTelegramQueued ?? 0, 0, 'default: free reader collects, no paid Telegram');
  const paidFirst = await run('PAID_FIRST');
  assert.equal(paidFirst.out.paidTelegramQueued, 2);
  assert.ok(paidFirst.rows.every((r) => r.provider === 'APIFY_MEMO23' && r.metadata?.actorKey === 'TELEGRAM_CHANNEL' && r.metadata?.targetUrl?.startsWith('https://t.me/')));
});
