// Find Property paid social campaign, executed against a fake database and a fake
// Apify (no network, no provider, no money): the customer pays only for confirmed
// provider work, and every stored offer keeps its own post photos.
import test from 'node:test';
import assert from 'node:assert/strict';

let token = undefined;
globalThis.Deno = { env: { get: (k) => (k === 'APIFY_API_TOKEN' ? token : undefined) } };
const { executeOfferJob, finishOfferCampaign, loadOfferSettings, offerInput } = await import('../findProperty/socialOffers.ts');

/** A tiny PostgREST stand-in: every call is recorded; answers come from `answer`. */
function fakeDb(answer) {
  const calls = [];
  const builder = (table) => {
    const q = { table, op: 'select', filters: [], payload: null };
    const chain = {
      select() { return chain; }, insert(p) { q.op = 'insert'; q.payload = p; return chain; },
      update(p) { q.op = 'update'; q.payload = p; return chain; }, upsert(p) { q.op = 'upsert'; q.payload = p; return chain; },
      eq(c, v) { q.filters.push(['eq', c, v]); return chain; }, in(c, v) { q.filters.push(['in', c, v]); return chain; },
      is(c, v) { q.filters.push(['is', c, v]); return chain; }, not() { return chain; }, order() { return chain; }, limit() { return chain; },
      maybeSingle() { q.single = true; return chain; },
      then(resolve, reject) { calls.push(q); return Promise.resolve(answer(q)).then((data) => ({ data, error: null })).then(resolve, reject); },
    };
    return chain;
  };
  return {
    calls,
    from: builder,
    rpc(name, args) { const q = { rpc: name, args }; calls.push(q); return Promise.resolve({ data: answer(q), error: null }); },
  };
}

const SETTINGS = [{ key: 'find_property_social_enabled', value: true }, { key: 'provider_disabled_list', value: [] }];
const RUN = { id: 'run-1', status: 'SEARCHING', pricing_policy: 'paid_discovery_37_63_v1', provider_budget_micros: 3_150_000 };
const JOB = { id: 'job-1', discovery_run_id: 'run-1', metadata: { stage: 'FB_GROUP_POSTS', actorKey: 'FB_GROUP_POSTS', targetUrl: 'https://www.facebook.com/groups/tbilisi.flats', size: 20, search: { transaction: 'SALE', city: 'Tbilisi' } } };

test('no provider token: no campaign is offered, nothing is reserved', async () => {
  token = undefined;
  const db = fakeDb((q) => (q.table === 'admin_settings' ? SETTINGS : q.table === 'discovery_runs' ? RUN : null));
  const settings = await loadOfferSettings(db);
  assert.equal(settings.configured, false);
  assert.equal(settings.enabled, false, 'switch ON is not enough without a token');
  const outcome = await executeOfferJob(db, JOB);
  assert.equal(outcome.outcome, 'CANCELLED');
  assert.equal(outcome.error, 'PROVIDER_NOT_CONFIGURED');
  assert.equal(db.calls.filter((c) => c.rpc === 'find_property_reserve_actor_run').length, 0, 'never reserved');
});

test('an ambiguous start is HOMATCH cost (START_AMBIGUOUS), never the customer\'s', async () => {
  token = 'test-token-not-real';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new TypeError('connection reset'); };
  try {
    const db = fakeDb((q) => {
      if (q.table === 'admin_settings') return SETTINGS;
      if (q.table === 'discovery_runs') return RUN;
      if (q.rpc === 'find_property_reserve_actor_run') return { ok: true, runId: 'ar-1', actorId: 'memo23~apify-facebook-group-scraper', reservedMicros: 38000, requestedLimit: 20, inputContract: null, timeoutSeconds: 300 };
      if (q.table === 'find_property_actor_runs' && q.op === 'update') return [{ id: 'ar-1' }];
      return null;
    });
    const outcome = await executeOfferJob(db, JOB);
    assert.equal(outcome.outcome, 'FAILED');
    const booked = db.calls.find((c) => c.rpc === 'find_property_book_actor_cost');
    assert.equal(booked.args.p_cost_basis, 'START_AMBIGUOUS');
    assert.equal(booked.args.p_actual_micros, null, 'cost unknown, never silently zero (counted as HOMATCH cost at its reservation)');
    assert.match(booked.args.p_error, /^START_AMBIGUOUS: NETWORK/);
  } finally { globalThis.fetch = realFetch; }
});

test('at the end: a start cut short is START_AMBIGUOUS; the charge is the customer sum', async () => {
  token = 'test-token-not-real';
  const db = fakeDb((q) => {
    if (q.table === 'find_property_actor_runs') return [{ id: 'ar-s', status: 'STARTING', provider_run_id: null }, { id: 'ar-r', status: 'RESERVED', provider_run_id: null }];
    if (q.rpc === 'find_property_customer_micros') return 76000;
    return null;
  });
  const micros = await finishOfferCampaign(db, 'run-1');
  assert.equal(micros, 76000, 'the customer figure, not the committed one');
  const books = db.calls.filter((c) => c.rpc === 'find_property_book_actor_cost');
  assert.deepEqual(books.map((b) => [b.args.p_actor_run_id, b.args.p_cost_basis, b.args.p_status]),
    [['ar-s', 'START_AMBIGUOUS', 'ABORTED'], ['ar-r', 'NOT_STARTED', 'RELEASED']]);
  assert.equal(db.calls.filter((c) => c.rpc === 'find_property_committed_micros').length, 0);
});

test('a finished run stores real offers with their own photos; requests are dropped', async () => {
  token = 'test-token-not-real';
  const realFetch = globalThis.fetch;
  const items = [
    { postId: '1', url: 'https://www.facebook.com/groups/g/posts/1/', time: new Date().toISOString(),
      text: 'იყიდება 3 ოთახიანი ბინა ვაკეში, თბილისი, 92 კვ.მ, ფასი 150000$',
      attachments: [{ photo_image: { uri: 'https://scontent.fbcdn.net/p1.jpg' } }, { photo_image: { uri: 'https://scontent.fbcdn.net/p2.jpg' } }],
      user: { profilePic: 'https://scontent.fbcdn.net/avatar.jpg' } },
    { postId: '2', url: 'https://www.facebook.com/groups/g/posts/2/', time: new Date().toISOString(),
      text: 'ვეძებ 3 ოთახიან ბინას ვაკეში, თბილისი, ბიუჯეტი 150000$' },
  ];
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('/actor-runs/')) return new Response(JSON.stringify({ data: { id: 'p-1', status: 'SUCCEEDED', defaultDatasetId: 'd-1', usageTotalUsd: 0.03 } }), { status: 200 });
    if (u.includes('/datasets/')) return new Response(JSON.stringify(items), { status: 200, headers: { 'x-apify-pagination-total': '2' } });
    throw new Error(`unexpected ${u}`);
  };
  try {
    const db = fakeDb((q) => {
      if (q.table === 'admin_settings') return SETTINGS;
      if (q.table === 'discovery_runs') return RUN;
      if (q.table === 'find_property_actor_runs') return { id: 'ar-1', provider_run_id: 'p-1', dataset_id: 'd-1', requested_limit: 20, actor_key: 'FB_GROUP_POSTS', source_id: 'src-1', created_at: new Date().toISOString(), cost_booked_at: null };
      if (q.table === 'source_registry') return { city: 'Tbilisi' };
      return null;
    });
    const outcome = await executeOfferJob(db, { ...JOB, metadata: { ...JOB.metadata, actorRunId: 'ar-1' } });
    assert.equal(outcome.outcome, 'DONE');
    const stored = db.calls.filter((c) => c.table === 'supply_observations' && c.op === 'upsert').map((c) => c.payload);
    assert.equal(stored.length, 1, 'the request was not stored as a listing');
    assert.deepEqual(stored[0].image_urls, ['https://scontent.fbcdn.net/p1.jpg', 'https://scontent.fbcdn.net/p2.jpg'], 'the post\'s photos, not the avatar');
    assert.equal(stored[0].adapter_version, 'fp-social-offers-2');
    assert.equal(stored[0].field_origins.memo23ActorRunId, 'ar-1');
    assert.equal(stored[0].canonical_url, 'https://www.facebook.com/groups/g/posts/1/');
  } finally { globalThis.fetch = realFetch; }
});

const FB_CONTRACT = { required: ['startUrls'], schemaProperties: ['startUrls', 'maxItems', 'onlyPostsNewerThan', 'search', 'proxy'] };
const TT_CONTRACT = { required: ['mode', 'input'], schemaProperties: ['mode', 'input', 'maxResults'] };

test('batched input: all groups in one Facebook run, never with a keyword; TikTok searches every keyword at once', () => {
  const since = '2026-07-01T00:00:00.000Z';
  const fb = offerInput('FB_GROUP_POSTS', { queries: ['იყიდება ბინა'], targets: [
    { url: 'https://www.facebook.com/groups/a', sourceId: 's-a', city: 'Tbilisi' }, { url: 'https://www.facebook.com/groups/b', sourceId: 's-b', city: 'Tbilisi' }] },
    1000, since, FB_CONTRACT).input;
  assert.deepEqual(fb.startUrls, [{ url: 'https://www.facebook.com/groups/a' }, { url: 'https://www.facebook.com/groups/b' }]);
  assert.equal(fb.search, undefined, 'the unverified `search` field is never sent, even if a keyword is queued');
  assert.equal(fb.maxItems, 1000);
  assert.equal(fb.onlyPostsNewerThan, '2026-07-01');
  const tt = offerInput('TIKTOK_SEARCH', { queries: ['იყიდება ბინა Tbilisi', 'apartment for sale Tbilisi'], targets: [] }, 120, since, TT_CONTRACT).input;
  assert.deepEqual(tt, { mode: 'search', input: ['იყიდება ბინა Tbilisi', 'apartment for sale Tbilisi'], maxResults: 120 });
  /* A row queued before batching is built exactly as before. */
  const legacy = offerInput('FB_GROUP_POSTS', { targetUrl: 'https://www.facebook.com/groups/a' }, 20, since, FB_CONTRACT).input;
  assert.deepEqual(legacy.startUrls, [{ url: 'https://www.facebook.com/groups/a' }]);
  assert.equal(legacy.search, undefined);
});

test('a batched run reserves per community, and every post is stored under the group it came from', async () => {
  token = 'test-token-not-real';
  const realFetch = globalThis.fetch;
  const now = new Date().toISOString();
  const items = [
    { postId: '11', url: 'https://www.facebook.com/groups/a/posts/11/', groupUrl: 'https://www.facebook.com/groups/a', time: now, text: 'იყიდება 2 ოთახიანი ბინა საბურთალოზე, 60 კვ.მ, ფასი 90000$' },
    { postId: '12', url: 'https://www.facebook.com/groups/b/posts/12/', groupUrl: 'https://www.facebook.com/groups/b', time: now, text: 'იყიდება 3 ოთახიანი ბინა ვაკეში, 92 კვ.მ, ფასი 150000$' },
  ];
  let started = null;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.includes('/runs?') || /\/acts\/.+\/runs/.test(u)) { started = JSON.parse(init.body); return new Response(JSON.stringify({ data: { id: 'p-2', defaultDatasetId: 'd-2', status: 'RUNNING' } }), { status: 201 }); }
    if (u.includes('/actor-runs/')) return new Response(JSON.stringify({ data: { id: 'p-2', status: 'SUCCEEDED', defaultDatasetId: 'd-2', usageTotalUsd: 0.2 } }), { status: 200 });
    if (u.includes('/datasets/')) return new Response(JSON.stringify(items), { status: 200, headers: { 'x-apify-pagination-total': '2' } });
    throw new Error(`unexpected ${u}`);
  };
  const meta = { stage: 'FB_GROUP_POSTS', actorKey: 'FB_GROUP_POSTS', queries: ['იყიდება ბინა'], targetCount: 2, size: 200,
    targets: [{ url: 'https://www.facebook.com/groups/a', sourceId: 'src-a', city: 'Tbilisi' }, { url: 'https://www.facebook.com/groups/b', sourceId: 'src-b', city: 'Tbilisi' }],
    search: { transaction: 'SALE', city: 'Tbilisi' } };
  try {
    const db = fakeDb((q) => {
      if (q.table === 'admin_settings') return SETTINGS;
      if (q.table === 'discovery_runs') return RUN;
      if (q.rpc === 'find_property_reserve_actor_run') return { ok: true, runId: 'ar-2', actorId: 'memo23~apify-facebook-group-scraper', reservedMicros: 308000, requestedLimit: 200, inputContract: FB_CONTRACT, timeoutSeconds: 600 };
      if (q.table === 'find_property_actor_runs' && q.op === 'update') return [{ id: 'ar-2' }];
      if (q.table === 'find_property_actor_runs') return { id: 'ar-2', provider_run_id: 'p-2', dataset_id: 'd-2', requested_limit: 200, actor_key: 'FB_GROUP_POSTS', source_id: null, created_at: now, cost_booked_at: null };
      return null;
    });
    const first = await executeOfferJob(db, { id: 'job-2', discovery_run_id: 'run-1', metadata: meta });
    assert.equal(first.outcome, 'WAIT');
    assert.equal(first.metadata.timeoutSeconds, 600);
    const reserve = db.calls.find((c) => c.rpc === 'find_property_reserve_actor_run');
    assert.equal(reserve.args.p_target_count, 2);
    assert.deepEqual(started.startUrls.map((x) => x.url), ['https://www.facebook.com/groups/a', 'https://www.facebook.com/groups/b']);
    assert.equal(started.search, undefined);
    const done = await executeOfferJob(db, { id: 'job-2', discovery_run_id: 'run-1', metadata: { ...meta, ...first.metadata } });
    assert.equal(done.outcome, 'DONE');
    const stored = db.calls.filter((c) => c.table === 'supply_observations' && c.op === 'upsert').map((c) => c.payload);
    assert.deepEqual(stored.map((r) => [r.canonical_url, r.source_id]), [
      ['https://www.facebook.com/groups/a/posts/11/', 'src-a'], ['https://www.facebook.com/groups/b/posts/12/', 'src-b']]);
    assert.deepEqual(stored.map((r) => String(r.city).toLowerCase()), ['tbilisi', 'tbilisi']);
  } finally { globalThis.fetch = realFetch; }
});
