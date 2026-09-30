// The launch adapter contract, against a scripted Graph API and an in-memory
// database: what is sent to Meta, in what order, what is persisted, what
// happens when Meta fails half-way, how Meta's statuses become the customer's,
// and that the ledger settles exactly once.
import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.Deno = { env: { get: (k) => ({ META_APP_ID: 'app', META_APP_SECRET: 'secret', SUPABASE_URL: 'https://x.supabase.co' })[k] } };

const { publishCampaign, syncCampaign, settleCampaign, settlementDue, runPreflight, configFingerprint } = await import('../engine.ts');
const { buildPlan } = await import('../../../../src/lib/metaAds/strategy.ts');

/* ── an in-memory PostgREST-ish client ─────────────────────────────── */
function fakeDb(seed) {
  const tables = structuredClone(seed);
  const log = [];
  const from = (name) => {
    const rows = () => (tables[name] ??= []);
    let filters = [];
    let op = { kind: 'select' };
    const match = (r) => filters.every((f) => f(r));
    const api = {
      select() { return api; },
      order() { return api; }, limit() { return api; }, like(col, pat) { const p = pat.replace('%', ''); filters.push((r) => String(r[col] ?? '').startsWith(p)); return api; },
      eq(col, v) { filters.push((r) => r[col] === v); return api; },
      in(col, vs) { filters.push((r) => vs.includes(r[col])); return api; },
      is(col, v) { filters.push((r) => (r[col] ?? null) === v); return api; },
      not() { return api; }, lt() { return api; }, gt() { return api; }, or() { return api; },
      update(patch) { op = { kind: 'update', patch }; return api; },
      delete() { op = { kind: 'delete' }; return api; },
      insert(v) {
        const list = Array.isArray(v) ? v : [v];
        for (const r of list) {
          if (name === 'meta_ads_ledger' && rows().some((x) => x.idempotency_key && x.idempotency_key === r.idempotency_key)) {
            return Promise.resolve({ data: null, error: { message: 'duplicate key value' } });
          }
          rows().push({ id: `${name}-${rows().length + 1}`, ...r });
          log.push([name, 'insert', r]);
        }
        return Object.assign(Promise.resolve({ data: list, error: null }), { select: () => ({ single: async () => ({ data: list[0], error: null }), maybeSingle: async () => ({ data: list[0], error: null }) }) });
      },
      upsert(v) { return api.insert(v); },
      async maybeSingle() { return { data: run()[0] ?? null, error: null }; },
      async single() { return { data: run()[0] ?? null, error: null }; },
      then(res, rej) { return Promise.resolve({ data: run(), error: null }).then(res, rej); },
    };
    const run = () => {
      const hit = rows().filter(match);
      if (op.kind === 'update') { for (const r of hit) Object.assign(r, op.patch); log.push([name, 'update', op.patch]); }
      if (op.kind === 'delete') tables[name] = rows().filter((r) => !match(r));
      return hit;
    };
    return api;
  };
  return {
    from, tables, log,
    // meta_effective_fee_percent(): the admin policy over the standard 9%.
    rpc: async (fn, args) => {
      if (fn !== 'meta_effective_fee_percent') return { data: null, error: { message: 'unknown rpc' } };
      const p = (tables.meta_fee_policies ?? []).find((r) => r.user_id === args.p_user);
      const pct = !p || p.kind === 'STANDARD_PERCENT' ? 9 : p.kind === 'FEE_EXEMPT' ? 0 : Number(p.percent);
      return { data: pct, error: null };
    },
    storage: { from: () => ({
      download: async () => ({ data: new Blob([new Uint8Array([1, 2, 3])]) }),
      createSignedUrl: async () => ({ data: { signedUrl: 'https://signed/video.mp4' } }),
    }) },
  };
}

/* ── a scripted Graph API ──────────────────────────────────────────── */
function fakeGraph({ failOn } = {}) {
  const calls = [];
  let n = 0;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const path = u.pathname.replace(/^\/v\d+\.\d+/, '');
    const body = init.body ? Object.fromEntries(new URLSearchParams(init.body)) : {};
    const method = init.method ?? 'GET';
    calls.push({ method, path, body, auth: init.headers?.Authorization ?? null, query: u.search });
    const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
    if (failOn && path.endsWith(failOn) && method === 'POST') return new Response(JSON.stringify({ error: { code: 100, message: 'Invalid parameter' } }), { status: 400 });
    if (path.endsWith('/adimages')) return ok({ images: { x: { hash: 'imghash1' } } });
    if (path.endsWith('/campaigns')) return ok({ id: 'camp_9' });
    if (path.endsWith('/adsets')) return ok({ id: `adset_${++n}` });
    if (path.endsWith('/adcreatives')) return ok({ id: `crt_${++n}` });
    if (path.endsWith('/ads') && method === 'POST') return ok({ id: `ad_${++n}` });
    return ok({ success: true });
  };
  return calls;
}

const seed = () => ({
  meta_connections: [{ id: 'conn1', user_id: 'u1', status: 'CONNECTED', granted_scopes: ['ads_management', 'pages_show_list', 'leads_retrieval', 'pages_manage_ads'] }],
  meta_tokens: [{ connection_id: 'conn1', access_token: 'EAAtesttoken', expires_at: null }],
  meta_assets: [
    { id: 'a1', user_id: 'u1', kind: 'PAGE', external_id: 'page1', selected: true, status: 'ACTIVE' },
    { id: 'a2', user_id: 'u1', kind: 'AD_ACCOUNT', external_id: 'act_1', selected: true, status: 'ACTIVE' },
    { id: 'a3', user_id: 'u1', kind: 'LEAD_FORM', external_id: 'form1', selected: true, status: 'ACTIVE' },
  ],
  meta_creatives: [{ id: 'cr-000001', campaign_id: 'c1', sort: 0, kind: 'IMAGE', media: [{ path: 'u1/a.jpg', mime: 'image/jpeg', size: 1000, width: 1080, height: 1350 }], headline: 'Vake 2BR', primary_text: 'Bright flat', description: '', cta: 'SIGN_UP', safety_status: 'READY' }],
  meta_campaigns: [], meta_ad_entities: [], meta_ads_ledger: [], meta_api_errors: [], meta_funnel_events: [], meta_moderation_cases: [],
  admin_settings: [], meta_audiences: [],
});
const settings = { publishingEnabled: true, feePercent: 9, minDurationDays: 2, minDailyCents: 200, maxDailyCents: 1e8, goalsEnabled: ['LEADS_ON_META', 'PROMOTE'], defaultCountries: ['GE'], whatsappEnabled: false };
const campaign = (over = {}) => ({
  id: 'c1', user_id: 'u1', name: '', goal: 'LEADS_ON_META', status: 'READY', daily_budget_cents: 500, duration_days: 7, currency: 'USD',
  property_id: 'prop1', offer: { isProperty: true, dealKind: 'SALE' }, destination: { type: 'META_FORM', formId: 'form1' },
  placements: { mode: 'RECOMMENDED' }, audience_id: null, ...over,
});
const planFor = (c) => buildPlan({
  goal: c.goal, dailyBudgetCents: c.daily_budget_cents, durationDays: c.duration_days, currency: 'USD', specialAdCategories: ['HOUSING'],
  creatives: [{ id: 'cr-000001', kind: 'IMAGE', ready: true }], destination: c.destination, placementsMode: 'RECOMMENDED',
});

test('launch builds the whole tree in order, with media, the lead form, and ACTIVE children under a PAUSED campaign', async () => {
  const db = fakeDb(seed());
  const c = campaign();
  db.tables.meta_campaigns.push(c);
  const calls = fakeGraph();
  const result = await publishCampaign(db, 'u1', c, planFor(c), 'REAL', settings);
  assert.deepEqual(result, { campaignId: 'camp_9', status: 'SUBMITTED' });
  const posts = calls.filter((x) => x.method === 'POST').map((x) => x.path);
  assert.deepEqual(posts, ['/act_1/adimages', '/act_1/campaigns', '/act_1/adsets', '/act_1/adcreatives', '/act_1/ads', '/camp_9']);
  const [, camp, adset, creative, ad, activate] = calls.filter((x) => x.method === 'POST');
  assert.equal(camp.body.status, 'PAUSED');
  assert.equal(camp.body.special_ad_categories, '["HOUSING"]');
  assert.equal(camp.body.special_ad_category_country, '["GE"]');
  assert.equal(adset.body.status, 'ACTIVE');
  assert.equal(adset.body.optimization_goal, 'LEAD_GENERATION');
  assert.equal(adset.body.promoted_object, '{"page_id":"page1"}');
  const spec = JSON.parse(creative.body.object_story_spec);
  assert.equal(spec.link_data.image_hash, 'imghash1', 'the uploaded image is on the creative');
  assert.equal(spec.link_data.call_to_action.value.lead_gen_form_id, 'form1');
  assert.equal(ad.body.status, 'ACTIVE');
  assert.equal(activate.body.status, 'ACTIVE', 'switching the campaign on is the last act');
  // Every call is authenticated with appsecret_proof, and no token is ever in a URL.
  for (const call of calls) {
    assert.ok(!call.query.includes('access_token'), `${call.path}: no token in the URL`);
    if (call.method === 'POST') assert.ok(call.body.appsecret_proof, `${call.path}: appsecret_proof`);
  }
  // Real Meta IDs are persisted.
  assert.equal(db.tables.meta_campaigns[0].external_campaign_id, 'camp_9');
  const kinds = db.tables.meta_ad_entities.map((e) => `${e.kind}:${e.external_id}`);
  assert.ok(kinds.some((k) => k.startsWith('AD_SET:adset_')) && kinds.some((k) => k.startsWith('AD:ad_')) && kinds.some((k) => k.startsWith('CREATIVE:crt_')));
});

test('a failure half-way deletes what was created at Meta and rethrows a normalized error', async () => {
  const db = fakeDb(seed());
  const c = campaign();
  db.tables.meta_campaigns.push(c);
  const calls = fakeGraph({ failOn: '/adsets' });
  await assert.rejects(publishCampaign(db, 'u1', c, planFor(c), 'REAL', settings), (e) => e.normalized?.customerKey === 'meta_err_invalid');
  assert.ok(calls.some((x) => x.method === 'DELETE' && x.path === '/camp_9'), 'the half-built campaign is deleted');
});

test('a goal requirement that is missing stops the launch before anything reaches Meta', async () => {
  const db = fakeDb(seed());
  db.tables.meta_assets = db.tables.meta_assets.filter((a) => a.kind !== 'LEAD_FORM');
  const c = campaign({ destination: { type: 'META_FORM' } });
  const calls = fakeGraph();
  await assert.rejects(publishCampaign(db, 'u1', c, planFor(c), 'REAL', settings), /LEAD_FORM_REQUIRED/);
  assert.equal(calls.filter((x) => x.method === 'POST' && !x.path.endsWith('/adimages')).length, 0);
});

test('MOCK publishes nothing to Meta and marks nothing ACTIVE', async () => {
  const db = fakeDb(seed());
  const c = campaign();
  const calls = fakeGraph();
  const r = await publishCampaign(db, 'u1', c, planFor(c), 'MOCK', settings);
  assert.match(r.campaignId, /^mock_camp_/);
  assert.equal(calls.length, 0);
  assert.ok(db.tables.meta_ad_entities.every((e) => e.status === 'MOCK'));
});

test('sync maps Meta review and rejection, and settlement posts exactly once', async () => {
  const db = fakeDb(seed());
  const c = campaign({ status: 'SUBMITTED', external_campaign_id: 'camp_9', launched_at: new Date(Date.now() - 10 * 86400000).toISOString(), duration_days: 7, spend_cents: 0 });
  db.tables.meta_campaigns.push(c);
  db.tables.meta_ads_ledger.push(
    { user_id: 'u1', campaign_id: 'c1', entry_type: 'RESERVE', amount_cents: -3500, idempotency_key: 'k:reserve' },
    { user_id: 'u1', campaign_id: 'c1', entry_type: 'HOMATCH_FEE', amount_cents: -315, idempotency_key: 'k:fee' },
  );
  globalThis.fetch = async (url) => {
    const p = new URL(url).pathname;
    const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
    if (p.endsWith('/ads')) return ok({ data: [{ id: 'ad_1', effective_status: 'ACTIVE' }] });
    if (p.endsWith('/insights')) return ok({ data: [{ spend: '20.00', impressions: '1000' }] });
    return ok({ status: 'ACTIVE', effective_status: 'ACTIVE' });
  };
  const r = await syncCampaign(db, c, 'REAL');
  assert.equal(r.status, 'COMPLETED', 'end time passed → completed');
  // Ended now; money waits out the settlement grace (late-attributed spend).
  assert.ok(db.tables.meta_campaigns[0].ended_at, 'the end is recorded');
  assert.equal(db.tables.meta_ads_ledger.length, 2, 'nothing settles inside the grace period');
  const ended = { ...db.tables.meta_campaigns[0], ended_at: new Date(Date.now() - 4 * 86400000).toISOString() };
  assert.ok(settlementDue(ended), 'due once the grace has passed');
  await settleCampaign(db, ended, 2000);
  const types = db.tables.meta_ads_ledger.map((l) => `${l.entry_type}:${l.amount_cents}`);
  assert.ok(types.includes('RELEASE:3500') && types.includes('META_SPEND:-2000') && types.includes('REFUND:135'));
  const before = db.tables.meta_ads_ledger.length;
  await settleCampaign(db, ended, 2000);
  assert.equal(db.tables.meta_ads_ledger.length, before, 'a second settlement writes nothing');
});

test('review in progress is META_REVIEW, never ACTIVE', async () => {
  const db = fakeDb(seed());
  const c = campaign({ status: 'SUBMITTED', external_campaign_id: 'camp_9', launched_at: new Date().toISOString() });
  db.tables.meta_campaigns.push(c);
  globalThis.fetch = async (url) => {
    const p = new URL(url).pathname;
    const ok = (b) => new Response(JSON.stringify(b), { status: 200 });
    if (p.endsWith('/ads')) return ok({ data: [{ id: 'ad_1', effective_status: 'PENDING_REVIEW' }] });
    if (p.endsWith('/insights')) return ok({ data: [] });
    return ok({ status: 'ACTIVE', effective_status: 'ACTIVE' });
  };
  const r = await syncCampaign(db, c, 'REAL');
  assert.equal(r.status, 'META_REVIEW');
  assert.equal(db.tables.meta_campaigns[0].status, 'META_REVIEW');
});

test('preflight: a missing lead form and a one-day campaign are ACTION_REQUIRED; the fingerprint changes with any edit', async () => {
  const db = fakeDb(seed());
  db.tables.meta_assets = db.tables.meta_assets.filter((a) => a.kind !== 'LEAD_FORM');
  globalThis.fetch = async () => new Response(JSON.stringify({ account_status: 1, currency: 'USD', funding_source: '123' }), { status: 200 });
  const c = campaign({ destination: { type: 'META_FORM' }, duration_days: 1, status: 'DRAFT' });
  db.tables.meta_campaigns.push(c);
  const r = await runPreflight(db, 'u1', c, settings, 'REAL');
  assert.equal(r.status, 'NEEDS_CHANGES');
  const byKey = Object.fromEntries(r.checks.map((ch) => [ch.key, ch.state]));
  assert.equal(byKey.lead_form, 'ACTION_REQUIRED');
  assert.equal(byKey.duration, 'ACTION_REQUIRED');
  assert.equal(byKey.ad_account_active, 'READY');
  assert.equal(byKey.balance, 'WARNING', 'an empty balance warns; launch enforces it');
  const f1 = await configFingerprint(db, c);
  const f2 = await configFingerprint(db, { ...c, daily_budget_cents: 900 });
  assert.notEqual(f1, f2);
});

test('the fee comes from the canonical policy: exempt 0, custom exact, standard 9', async () => {
  const { customerFeePercent } = await import('../engine.ts');
  const db = fakeDb(seed());
  db.tables.meta_fee_policies = [{ user_id: 'u1', kind: 'FEE_EXEMPT' }, { user_id: 'u2', kind: 'CUSTOM_PERCENT', percent: 4.5 }];
  assert.equal(await customerFeePercent(db, 'u1'), 0);
  assert.equal(await customerFeePercent(db, 'u2'), 4.5);
  assert.equal(await customerFeePercent(db, 'u3'), 9);
  const { computeTotals } = await import('../../../../src/lib/metaAds/strategy.ts');
  for (const [daily, days] of [[1000, 10], [10000, 10], [100000, 10]]) {
    assert.equal(computeTotals(daily, days, await customerFeePercent(db, 'u1')).feeCents, 0, 'exempt pays no service fee');
  }
  assert.equal(computeTotals(1000, 10, 9).feeCents, 900, '$100 at standard = $9');
  assert.equal(computeTotals(1000, 10, 4.5).feeCents, 450, '$100 at 4.5% = $4.50');
  // Never guessed: an unreadable policy fails the caller.
  await assert.rejects(customerFeePercent({ rpc: async () => ({ data: null, error: { message: 'x' } }) }, 'u1'), /FEE_POLICY_UNAVAILABLE/);
});

test('fee rounding is exact half-up in basis points for any 2-decimal percent (matches the database quote)', async () => {
  const { computeTotals } = await import('../../../../src/lib/metaAds/strategy.ts');
  const { serviceFeeCents } = await import('../../../../src/lib/metaAds/billing.ts');
  const exact = (planned, pct) => {            // BigInt half-up: the SQL round(planned * bp / 10000)
    const bp = BigInt(Math.round(pct * 100));
    const n = BigInt(planned) * bp;
    return Number((n * 2n + 10000n) / 20000n);
  };
  for (const pct of [0, 0.35, 0.57, 0.7, 4.5, 9, 9.99, 12.25, 100]) {
    for (const planned of [0, 1, 5000, 5500, 10000, 11000, 99999, 100000, 1000000, 123457]) {
      assert.equal(serviceFeeCents(planned, pct), exact(planned, pct), `serviceFeeCents(${planned}, ${pct})`);
      assert.equal(computeTotals(planned, 1, pct).feeCents, exact(planned, pct), `computeTotals(${planned}, ${pct})`);
    }
  }
});
