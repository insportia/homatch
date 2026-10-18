// FIND BUYERS — CPU ISOLATION OF THE DISCOVERY DRIVER (HTTP 546, campaign 8f6b8544,
// 2026-10-18). An Edge request has 2 s of CPU in total. The tick that died had read
// three Actor datasets (111 posts) in its social pass and then, in the same request,
// finished the campaign: classify + matching (their own functions, so I/O here), then
// the native Telegram assessment (~220 messages through the same pipeline) and the
// settlement -- "CPU Time exceeded" one second after run-matching returned.
//
// What is proven here, against the real driver and the real campaign ending:
//   - the tick claims and DISPATCHES: each social job and each campaign finish is its
//     own request to discovery-queue-worker (its own CPU budget), carrying only ids;
//   - a child request acts only for the claim that sent it (a lapsed or re-claimed
//     job is refused, no provider call);
//   - a native Telegram assessment that dies (546) is recorded and the campaign still
//     finishes and settles;
//   - a finish run again after a request died after settlement charges nothing twice,
//     keeps every lead, and ends 'completed';
//   - the native Telegram assessment runs once per campaign.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('https://esm.sh/@supabase/supabase-js')) {
      return { url: 'data:text/javascript,export const createClient = () => { throw new Error("no network in tests"); };', shortCircuit: true };
    }
    return next(spec, ctx);
  }`));
globalThis.Deno ??= { env: { get: () => undefined } };

const { drive, finishCampaign, runClaimedSocialJob, assessCampaignTelegram } = await import('../../discovery-queue-worker/driver.ts');

/* ── a small PostgREST stand-in: the filters, counts and writes the driver uses ── */
function fakeDb(seed = {}, rpcHandlers = {}) {
  const tables = Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))]));
  const t = (n) => (tables[n] ??= []);
  const rpcs = [];
  let seq = 0;
  const cmp = (op, x, v) => {
    if (op === 'eq') return x === v;
    if (op === 'neq') return x !== v;
    if (op === 'in') return v.includes(x);
    if (op === 'is') return v === null ? x == null : x === v;
    if (op === 'notnull') return x != null;
    if (op === 'lt') return x != null && x < v;
    if (op === 'lte') return x != null && x <= v;
    if (op === 'gt') return x != null && x > v;
    if (op === 'gte') return x != null && x >= v;
    return true;
  };
  function from(name) {
    const st = { op: 'select', filters: [], payload: null, single: false, limit: null, head: false };
    const match = (r) => st.filters.every(([op, c, v]) => cmp(op, r[c], v));
    const exec = async () => {
      const rows = t(name);
      if (st.op === 'insert') {
        const list = (Array.isArray(st.payload) ? st.payload : [st.payload]).map((r) => ({ id: r.id ?? `${name}-${++seq}`, created_at: new Date().toISOString(), ...r }));
        rows.push(...list);
        return { data: st.single ? list[0] : list, error: null };
      }
      if (st.op === 'update') {
        const hit = rows.filter(match);
        hit.forEach((r) => Object.assign(r, st.payload));
        return { data: st.single ? hit[0] ?? null : hit, error: null };
      }
      let hit = rows.filter(match);
      if (st.limit != null) hit = hit.slice(0, st.limit);
      if (st.head) return { data: null, count: hit.length, error: null };
      return { data: st.single ? hit[0] ?? null : hit, count: hit.length, error: null };
    };
    const b = {};
    b.select = (_cols, o) => { if (o?.head) st.head = true; return b; };
    for (const op of ['eq', 'neq', 'in', 'is', 'lt', 'lte', 'gt', 'gte']) b[op] = (c, v) => { st.filters.push([op, c, v]); return b; };
    b.not = (c, op, v) => { if (op === 'is' && v === null) st.filters.push(['notnull', c, null]); return b; };
    for (const m of ['order', 'or', 'ilike', 'like', 'contains', 'range']) b[m] = () => b;
    b.limit = (n) => { st.limit = n; return b; };
    b.insert = (p) => { st.op = 'insert'; st.payload = p; return b; };
    b.update = (p) => { st.op = 'update'; st.payload = p; return b; };
    b.upsert = (p) => { st.op = 'insert'; st.payload = p; return b; };
    b.maybeSingle = () => { st.single = true; return b; };
    b.single = () => { st.single = true; return b; };
    b.then = (ok, bad) => exec().then(ok, bad);
    return b;
  }
  const db = {
    from,
    rpc: (n, a) => {
      rpcs.push({ n, a });
      const run = async () => {
        try { return { data: rpcHandlers[n] ? await rpcHandlers[n](a, tables) : null, error: null }; }
        catch (e) { return { data: null, error: { message: String(e.message ?? e) } }; }
      };
      return { then: (ok, bad) => run().then(ok, bad) };
    },
  };
  return { db, tables, rpcs };
}

/* The wallet as the SQL behaves: wallet_settle settles a RESERVED reservation once; a
   second call returns the first result marked as a duplicate. */
function wallet(reserved = 100) {
  const res = { status: 'RESERVED', reserved, settled: 0, released: 0 };
  const settles = [];
  return {
    res, settles,
    rpc: {
      billing_landed_cogs_cents: (a) => Number(a.p_raw_provider_cents || 0),
      wallet_settle: (a) => {
        settles.push(a);
        if (res.status !== 'RESERVED') return [{ settled_credits: res.settled, released_credits: res.released, was_duplicate: true, clamped: false }];
        res.settled = Math.min(res.reserved, Number(a.p_actual_credits)); res.released = res.reserved - res.settled; res.status = 'SETTLED';
        return [{ settled_credits: res.settled, released_credits: res.released, was_duplicate: false, clamped: false }];
      },
      find_buyers_settle_extensions: () => ({ chargedCredits: 0 }),
    },
  };
}

/* The Edge network: every function call is recorded; `routes[name]` answers it. */
function edge(routes) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const name = u.includes('/functions/v1/') ? u.split('/functions/v1/')[1] : 'external';
    const body = init?.body ? JSON.parse(init.body) : null;
    calls.push({ name, body });
    const key = name === 'discovery-queue-worker' ? `dqw:${body?.mode}` : name;
    const route = routes[key];
    if (!route) return new Response('{}', { status: name === 'external' ? 503 : 404 });
    const out = await route(body);
    return new Response(JSON.stringify(out?.http ? out.body : out ?? {}), { status: out?.http ?? 200 });
  };
  return calls;
}

const GRANT = { reservationId: 'res-1', funding: 'PAYG', productCode: 'FIND_CLIENTS', planCode: 'PAYG', qualityTier: 'STANDARD', estimateMaxCredits: 100 };
const STARTED = '2026-10-18T06:16:07.922Z';

function finishingCampaign(extra = {}) {
  return {
    matching_jobs: [{ id: 'job-1', property_id: 'prop-1', campaign_id: 'camp-1', started_at: STARTED, status: 'classifying',
      billing_grant: GRANT, search_languages: ['ka', 'ru'], discovery_deadline_at: '2026-10-18T06:26:12Z', updated_at: new Date().toISOString() }],
    matching_job_events: [],
    discovery_query_queue: [
      { id: 'q1', matching_job_id: 'job-1', provider: 'APIFY_MEMO23', status: 'DONE', result_count: 39 },
      { id: 'q2', matching_job_id: 'job-1', provider: 'APIFY_MEMO23', status: 'DONE', result_count: 68 },
      { id: 'q3', matching_job_id: 'job-1', provider: 'TELEGRAM', status: 'DONE', result_count: 7 },
      { id: 'q4', matching_job_id: 'job-1', provider: 'APIFY_MEMO23', status: 'CANCELLED', result_count: 0 },
    ],
    find_buyers_leads: [
      { id: 'lead-1', matching_job_id: 'job-1', person_id: 'p1' },
      { id: 'lead-2', matching_job_id: 'job-1', person_id: 'p2' },
    ],
    matches: [], cost_events: [{ property_id: 'prop-1', timestamp: '2026-10-18T06:20:00Z', cost_usd: 0.5052 }],
    find_buyers_campaigns: [{ matching_job_id: 'job-1', pricing_policy: 'paid_discovery_37_63_v1', credits_per_usd: 10, finalized_at: null }],
    find_buyers_actor_runs: [], admin_settings: [], campaign_languages: [],
    ...extra,
  };
}

const finishRoutes = (over = {}) => ({
  'classify-signals-v2': () => ({ processed: 0 }),
  'run-matching-v2': () => ({ matchesCreated: 0, rejectedAncientDemand: 0 }),
  'dqw:assess_native_telegram': () => ({ jobId: 'job-1', assessed: 0 }),
  ...over,
});

test('a native Telegram assessment that dies (546) is recorded; the campaign still finishes and settles once', async () => {
  const w = wallet();
  const { db, tables } = fakeDb(finishingCampaign(), w.rpc);
  const calls = edge(finishRoutes({
    'dqw:assess_native_telegram': () => ({ http: 546, body: { code: 'WORKER_RESOURCE_LIMIT' } }),
  }));
  const out = await finishCampaign(db, 'https://x.supabase.co', 'svc', 'job-1');
  assert.equal(out.ended, 'completed', JSON.stringify(out));
  const job = tables.matching_jobs[0];
  assert.equal(job.status, 'completed');
  assert.equal(job.failure_reason, null);
  const events = tables.matching_job_events.map((e) => e.event_type);
  assert.ok(events.includes('NATIVE_TELEGRAM_ASSESS_FAILED'), events.join(','));
  assert.ok(events.includes('JOB_COMPLETE'));
  assert.equal(w.settles.length, 1, 'settled exactly once');
  /* consumed ÷ 0.63 at 10 Credits per $1: $0.5052 → 8.0191 Credits, under the 100 reserved */
  assert.ok(w.res.settled > 0 && w.res.settled < 100, String(w.res.settled));
  assert.equal(tables.find_buyers_leads.length, 2, 'every lead kept');
  /* The heavy step went to its own request; classify and matching to their own functions. */
  assert.deepEqual(calls.filter((c) => c.name !== 'external').map((c) => c.name === 'discovery-queue-worker' ? c.body.mode : c.name),
    ['classify-signals-v2', 'run-matching-v2', 'assess_native_telegram']);
});

test('a finish run again after its request died after settlement charges nothing twice and ends completed', async () => {
  const w = wallet();
  const { db, tables } = fakeDb(finishingCampaign(), w.rpc);
  edge(finishRoutes());
  await finishCampaign(db, 'https://x.supabase.co', 'svc', 'job-1');
  const firstCharge = w.res.settled;
  /* The request died after wallet_settle and before the ending was written: the job is
     back in a finishing state (rescueStuck → searching_sources → claimed 'classifying'). */
  Object.assign(tables.matching_jobs[0], { status: 'classifying', completed_at: null });
  const again = await finishCampaign(db, 'https://x.supabase.co', 'svc', 'job-1');
  assert.equal(again.ended, 'completed');
  assert.equal(w.settles.length, 2, 'the replay asked the wallet again');
  assert.equal(w.res.settled, firstCharge, 'and the wallet charged once');
  assert.equal(tables.find_buyers_leads.length, 2);
  assert.equal(tables.matching_jobs[0].status, 'completed');
});

test('a finish only runs for a job in a finishing state (a cancelled or completed job is left alone)', async () => {
  for (const status of ['completed', 'cancelled', 'failed', 'searching_sources']) {
    const w = wallet();
    const seed = finishingCampaign();
    seed.matching_jobs[0].status = status;
    const { db, tables } = fakeDb(seed, w.rpc);
    const calls = edge(finishRoutes());
    const out = await finishCampaign(db, 'https://x.supabase.co', 'svc', 'job-1');
    assert.equal(out.skipped, status);
    assert.equal(calls.length, 0);
    assert.equal(w.settles.length, 0);
    assert.equal(tables.matching_jobs[0].status, status);
  }
});

test('matching that fails ends the campaign as before: PIPELINE_ERROR, the whole budget released, leads kept', async () => {
  const w = wallet();
  const releases = [];
  const { db, tables } = fakeDb(finishingCampaign(), { ...w.rpc, wallet_release: (a) => { releases.push(a); return [{ released_credits: 100 }]; } });
  edge(finishRoutes({ 'run-matching-v2': () => ({ http: 500, body: { error: 'boom' } }) }));
  const out = await finishCampaign(db, 'https://x.supabase.co', 'svc', 'job-1');
  assert.equal(out.ended, 'failed');
  assert.equal(tables.matching_jobs[0].failure_reason, 'PIPELINE_ERROR');
  assert.equal(w.settles.length, 0, 'nothing charged');
  assert.equal(tables.find_buyers_leads.length, 2, 'leads are never deleted by a failure');
});

test('the native Telegram assessment runs once per campaign, and only for a finishing job', async () => {
  const done = finishingCampaign({ matching_job_events: [{ job_id: 'job-1', event_type: 'NATIVE_TELEGRAM_ASSESSED' }] });
  const a = fakeDb(done);
  assert.equal((await assessCampaignTelegram(a.db, 'job-1')).skipped, 'ALREADY_ASSESSED');
  const idle = finishingCampaign();
  idle.matching_jobs[0].status = 'completed';
  const b = fakeDb(idle);
  assert.equal((await assessCampaignTelegram(b.db, 'job-1')).skipped, 'completed');
});

test('a social job request acts only while the claim that sent it still holds the job', async () => {
  const { db } = fakeDb({ discovery_query_queue: [
    { id: 'j1', status: 'PROCESSING', claim_token: 'tok-new', provider: 'APIFY_MEMO23', metadata: {} },
    { id: 'j2', status: 'DONE', claim_token: 'tok-a', provider: 'APIFY_MEMO23', metadata: {} },
  ] });
  const calls = edge({});
  assert.equal((await runClaimedSocialJob(db, 'j1', 'tok-old')).skipped, 'CLAIM_NOT_HELD', 'lease lapsed and re-claimed');
  assert.equal((await runClaimedSocialJob(db, 'j2', 'tok-a')).skipped, 'CLAIM_NOT_HELD', 'already finished');
  assert.equal((await runClaimedSocialJob(db, '', '')).skipped, 'BAD_REQUEST');
  assert.equal(calls.length, 0, 'no provider or function call');
});

test('the tick dispatches: each social job and the campaign finish are their own requests, carrying only ids', async () => {
  const queue = [
    { id: 's1', matching_job_id: 'job-1', provider: 'APIFY_MEMO23', status: 'PENDING', claim_token: null, metadata: { stage: 'FB_GROUP_SEARCH' } },
    { id: 's2', matching_job_id: 'job-1', provider: 'APIFY_MEMO23', status: 'PENDING', claim_token: null, metadata: { stage: 'FB_GROUP_POSTS' } },
    { id: 's3', matching_job_id: 'job-1', provider: 'APIFY_MEMO23', status: 'PENDING', claim_token: null, metadata: { stage: 'FB_GROUP_POSTS' } },
  ];
  const seed = finishingCampaign({ discovery_query_queue: queue });
  Object.assign(seed.matching_jobs[0], { status: 'searching_sources', discovery_deadline_at: new Date(Date.now() - 60_000).toISOString(), billing_grant: null });
  let token = 0;
  const { db, tables } = fakeDb(seed, {
    claim_discovery_source_jobs_v2: (a, tb) => {
      if (!a.p_providers?.includes('APIFY_MEMO23')) return [];
      const next = tb.discovery_query_queue.find((q) => q.provider === 'APIFY_MEMO23' && q.status === 'PENDING');
      if (!next) return [];
      Object.assign(next, { status: 'PROCESSING', claim_token: `tok-${++token}` });
      return [{ ...next }];
    },
  });
  const calls = edge({
    'dqw:social_job': (b) => {
      const q = tables.discovery_query_queue.find((x) => x.id === b.jobId);
      assert.equal(q.claim_token, b.claimToken, 'the child is sent the claim it must hold');
      Object.assign(q, { status: 'DONE', result_count: 10 });
      return { id: b.jobId, outcome: 'DONE', status: 'DONE' };
    },
    'dqw:finish_campaign': (b) => ({ jobId: b.jobId, ended: 'completed' }),
  });
  const report = await drive(db, 'https://x.supabase.co', 'svc', { mode: 'drive', source: 'cron' });
  const dispatched = calls.filter((c) => c.name === 'discovery-queue-worker');
  assert.deepEqual(dispatched.filter((c) => c.body.mode === 'social_job').map((c) => c.body.jobId).sort(), ['s1', 's2', 's3']);
  for (const c of dispatched) assert.deepEqual(Object.keys(c.body).sort(), c.body.mode === 'social_job' ? ['claimToken', 'jobId', 'mode'] : ['jobId', 'mode']);
  /* This tick processed Actor results, so PR #254's deferral holds the finish for the next
     tick (the window closed a minute ago, inside the grace) ... */
  assert.equal(dispatched.filter((c) => c.body.mode === 'finish_campaign').length, 0, JSON.stringify({ c: report.campaigns, s: report.socialJobs }));
  assert.ok(!calls.some((c) => c.name === 'run-matching-v2' || c.name === 'classify-signals-v2'), 'the tick itself never classifies or matches');
  /* ... and the next tick dispatches the finish as its own request. */
  await drive(db, 'https://x.supabase.co', 'svc', { mode: 'drive', source: 'cron' });
  const finishes = calls.filter((c) => c.name === 'discovery-queue-worker' && c.body.mode === 'finish_campaign');
  assert.deepEqual(finishes.map((c) => c.body.jobId), ['job-1']);
  assert.equal(tables.matching_jobs[0].status, 'classifying', 'claimed once by the tick; the finish request owns the rest');
  assert.ok(!calls.some((c) => c.name === 'run-matching-v2' || c.name === 'classify-signals-v2'));
});

test('a finish request that dies is reported, and the job waits for rescueStuck (no release by the tick)', async () => {
  const seed = finishingCampaign();
  Object.assign(seed.matching_jobs[0], { status: 'searching_sources', discovery_deadline_at: new Date(Date.now() - 10 * 60_000).toISOString(), billing_grant: null });
  seed.discovery_query_queue = seed.discovery_query_queue.map((q) => ({ ...q, status: 'DONE' }));
  const { db, tables } = fakeDb(seed, { claim_discovery_source_jobs_v2: () => [] });
  edge({ 'dqw:finish_campaign': () => ({ http: 546, body: { code: 'WORKER_RESOURCE_LIMIT' } }) });
  await drive(db, 'https://x.supabase.co', 'svc', { mode: 'drive', source: 'cron' });
  const job = tables.matching_jobs[0];
  assert.equal(job.status, 'classifying');
  assert.ok(tables.matching_job_events.some((e) => e.event_type === 'FINISH_REQUEST_FAILED'));
  assert.ok(!tables.matching_job_events.some((e) => e.event_type === 'JOB_FAILED'));
});
