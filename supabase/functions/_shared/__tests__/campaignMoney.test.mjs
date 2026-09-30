// CAMPAIGN MONEY PATHS — the real billing gateway (_shared/billing.ts) and the
// real campaign ending (_shared/campaignRun.ts), against an in-memory wallet
// whose reserve / settle / release RPCs behave like the SQL ones they stand in
// for: a reservation takes credits out of the balance, settlement charges at
// most what was reserved and returns the rest, release returns all of it, and
// an idempotency key reserves once.
//
// What is proven here: PAYG-only (no allowance), the 50-Credit budget taken as
// a ceiling and never shrunk, refusal without a reservation when the balance
// is short, idempotent start, settle-once under concurrent finishers, full
// release on stop/failure, and that the result counts only this run's current
// demand.
import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

/* billing.ts imports supabase-js from esm.sh for serviceClient(), which these
   tests never call. Map the URL to an empty stub so Node can load the module. */
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('https://esm.sh/@supabase/supabase-js')) {
      return { url: 'data:text/javascript,export const createClient = () => { throw new Error("no network in tests"); };', shortCircuit: true };
    }
    return next(spec, ctx);
  }`));

globalThis.Deno = { env: { get: () => undefined } };
const { beginExecution, releaseExecution } = await import('../billing.ts');
const { finalizeCampaignJob, failCampaignJob, claimJobTransition } = await import('../campaignRun.ts');
const { DEFAULT_ACTIVE_DEMAND_POLICY } = await import('../../../../src/research-core/discovery/freshness-policy.ts');

/* ── an in-memory database with the query surface these modules use ───── */
function fakeDb({ balance = 100, includedRemaining = 1, minViable = 50, unitCredits = 25 } = {}) {
  const state = {
    balance, reserved: 0, calls: [], reservations: new Map(), byKey: new Map(),
    tables: {
      billable_products: [{ code: 'FIND_CLIENTS', min_viable_budget_credits: minViable, config: { estimate_spread_bps: 3000 } }],
      product_plan_entitlements: [{ product_code: 'FIND_CLIENTS', plan_code: 'FREE', provider_budget_ceiling_cents: null }],
      matching_jobs: [], matching_job_events: [], matches: [], cost_events: [], discovery_query_queue: [], usage_events: [],
    },
  };
  const rpcs = {
    billing_entitlements: () => ({ plan_code: 'FREE', pricing_version: 1, wallet: { balance: state.balance },
      products: [{ product_code: 'FIND_CLIENTS', included_remaining: includedRemaining, payg_available: true,
        quality_tier: 'STANDARD', result_ceiling: null, priority_level: 0 }] }),
    billing_claim_allowance: () => 'allowance-1',
    billing_price_quote: () => [{ credits: unitCredits, pricing_version: 1 }],
    billing_landed_cogs_cents: (a) => Number(a.p_raw_provider_cents || 0),
    wallet_reserve: (a) => {
      if (state.byKey.has(a.p_idempotency_key)) {
        const r = state.reservations.get(state.byKey.get(a.p_idempotency_key));
        return [{ reservation_id: r.id, reserved_credits: r.reserved, balance_after: state.balance, was_duplicate: true }];
      }
      if (a.p_authorized_max_credits < minViable) throw new Error(`BELOW_MIN_VIABLE_BUDGET: ${a.p_authorized_max_credits} < ${minViable}`);
      if (state.balance < a.p_authorized_max_credits) throw new Error('INSUFFICIENT_CREDITS');
      const id = `res-${state.reservations.size + 1}`;
      state.balance -= a.p_authorized_max_credits; state.reserved += a.p_authorized_max_credits;
      state.reservations.set(id, { id, reserved: a.p_authorized_max_credits, status: 'RESERVED', charged: 0 });
      state.byKey.set(a.p_idempotency_key, id);
      return [{ reservation_id: id, reserved_credits: a.p_authorized_max_credits, balance_after: state.balance, was_duplicate: false }];
    },
    wallet_settle: (a) => {
      const r = state.reservations.get(a.p_reservation_id);
      if (r.status !== 'RESERVED') return [{ settled_credits: 0, released_credits: 0, clamped: false }];
      const charge = Math.min(a.p_actual_credits, r.reserved);
      state.balance += r.reserved - charge; state.reserved -= r.reserved;
      Object.assign(r, { status: 'SETTLED', charged: charge });
      return [{ settled_credits: charge, released_credits: r.reserved - charge, clamped: a.p_actual_credits > r.reserved }];
    },
    wallet_release: (a) => {
      const r = state.reservations.get(a.p_reservation_id);
      if (r.status === 'RESERVED') { state.balance += r.reserved; state.reserved -= r.reserved; r.status = 'RELEASED'; }
      return [{}];
    },
  };
  const match = (row, f) => f.every(([op, col, val]) => {
    const v = row[col];
    if (op === 'eq') return v === val;
    if (op === 'in') return val.includes(v);
    if (op === 'is') return v === val || (val === null && v === undefined);
    if (op === 'gte') return String(v) >= String(val);
    if (op === 'lt') return String(v) < String(val);
    return true;
  });
  function from(name) {
    const rows = state.tables[name] ?? (state.tables[name] = []);
    const q = { filters: [], op: 'select', patch: null, returning: false };
    const run = () => {
      const hit = rows.filter((r) => match(r, q.filters));
      if (q.op === 'update') { hit.forEach((r) => Object.assign(r, q.patch)); return { data: q.returning ? hit.map((r) => ({ id: r.id })) : null, error: null }; }
      return { data: hit, error: null };
    };
    const api = {
      select() { if (q.op === 'update') q.returning = true; return api; },
      eq(c, v) { q.filters.push(['eq', c, v]); return api; },
      in(c, v) { q.filters.push(['in', c, v]); return api; },
      is(c, v) { q.filters.push(['is', c, v]); return api; },
      gte(c, v) { q.filters.push(['gte', c, v]); return api; },
      lt(c, v) { q.filters.push(['lt', c, v]); return api; },
      not() { return api; }, order() { return api; }, limit() { return api; },
      update(p) { q.op = 'update'; q.patch = p; return api; },
      insert(row) { (Array.isArray(row) ? row : [row]).forEach((r) => rows.push({ ...r })); return Promise.resolve({ data: null, error: null }); },
      maybeSingle: () => { const r = run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: null }); },
      single: () => { const r = run(); return Promise.resolve({ data: r.data?.[0] ?? null, error: null }); },
      then: (ok, bad) => Promise.resolve(run()).then(ok, bad),
    };
    return api;
  }
  const db = {
    from,
    rpc: async (name, args) => {
      state.calls.push(name);
      try { return { data: rpcs[name](args), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; }
    },
  };
  return { db, state };
}

const campaign = (db, extra = {}) => beginExecution(db, {
  userId: 'u1', productCode: 'FIND_CLIENTS', idempotencyKey: 'findclients:u1:k1', jobRef: 'p1',
  authorizedMaxCredits: 50, allowIncluded: false, budgetIsCeiling: true, requireFullBudget: true, ...extra,
});

test('a campaign never consumes a plan allowance, even when one is available', async () => {
  const { db, state } = fakeDb({ includedRemaining: 1 });
  const grant = await campaign(db);
  assert.equal(grant.ok, true);
  assert.equal(grant.funding, 'PAYG');
  assert.ok(!state.calls.includes('billing_claim_allowance'), 'the allowance path was touched');
});

test('the 50-Credit budget is reserved in full as a ceiling, not capped at the per-run estimate', async () => {
  const { db, state } = fakeDb({ balance: 100, unitCredits: 25 });
  const grant = await campaign(db);
  /* The estimate is 25 ± 30% (max 32.5); the customer's ceiling is 50. */
  assert.equal(grant.reservedCredits, 50);
  assert.equal(state.balance, 50);
  assert.equal(grant.partialBudget, false);
});

test('a balance short of the budget is refused with no reservation, never silently shrunk', async () => {
  const { db, state } = fakeDb({ balance: 30 });
  const grant = await campaign(db);
  assert.equal(grant.ok, false);
  assert.equal(grant.reason, 'INSUFFICIENT_CREDITS');
  assert.equal(state.reservations.size, 0);
  assert.equal(state.balance, 30);
});

test('a budget below the product minimum is refused', async () => {
  const { db, state } = fakeDb({ balance: 500 });
  const grant = await campaign(db, { authorizedMaxCredits: 40 });
  assert.equal(grant.ok, false);
  assert.equal(grant.reason, 'BELOW_MIN_VIABLE_BUDGET');
  assert.equal(state.reservations.size, 0);
});

test('a repeated start with the same key reserves once', async () => {
  const { db, state } = fakeDb({ balance: 100 });
  const [a, b] = await Promise.all([campaign(db), campaign(db)]);
  assert.equal(a.reservationId, b.reservationId);
  assert.equal(state.balance, 50, 'the second request held credits again');
});

function seedJob(state, startedAt) {
  const job = { id: 'job1', property_id: 'p1', campaign_id: 'c1', started_at: startedAt, status: 'searching_sources' };
  state.tables.matching_jobs.push(job);
  return job;
}

test('finishing is a single transition: two concurrent finishers, one settlement', async () => {
  const { db, state } = fakeDb({ balance: 100 });
  const grant = await campaign(db);
  const job = seedJob(state, '2026-09-29T10:00:00Z');
  const [one, two] = await Promise.all([
    claimJobTransition(db, job.id, ['searching_sources'], { status: 'classifying' }),
    claimJobTransition(db, job.id, ['searching_sources'], { status: 'classifying' }),
  ]);
  assert.deepEqual([one, two].sort(), [false, true]);
  await finalizeCampaignJob(db, job, grant, DEFAULT_ACTIVE_DEMAND_POLICY);
  await finalizeCampaignJob(db, job, grant, DEFAULT_ACTIVE_DEMAND_POLICY).catch(() => undefined);
  const r = state.reservations.get(grant.reservationId);
  assert.equal(r.status, 'SETTLED');
  assert.equal(r.charged, 25, 'charged actual usage (the unit price), not the ceiling');
  assert.equal(state.balance, 75, '50 reserved, 25 charged, 25 returned -- once');
});

test('the result counts only this run\'s matches on current demand', async () => {
  const { db, state } = fakeDb({ balance: 100 });
  const grant = await campaign(db);
  const now = Date.now();
  const iso = (days) => new Date(now - days * 86_400_000).toISOString();
  const job = seedJob(state, iso(0.01));
  state.tables.matches.push(
    { id: 'old-current', property_id: 'p1', created_at: iso(3), status: 'NEW', demand_published_at: iso(5) },
    { id: 'old-stale', property_id: 'p1', created_at: iso(40), status: 'NEW', demand_published_at: iso(90) },
    { id: 'new-current', property_id: 'p1', created_at: new Date(now).toISOString(), status: 'NEW', demand_published_at: iso(2) },
    { id: 'new-undated', property_id: 'p1', created_at: new Date(now).toISOString(), status: 'NEW', demand_published_at: null },
  );
  const result = await finalizeCampaignJob(db, job, grant, DEFAULT_ACTIVE_DEMAND_POLICY);
  assert.equal(result.freshMatches, 1, 'only the new match on current demand counts');
  assert.equal(result.stillCurrentFromEarlier, 1, 'an earlier current match is reported separately');
  assert.equal(state.tables.matching_jobs[0].matches_created, 1);
  assert.equal(state.tables.matches.find((m) => m.id === 'new-current').unlock_included_reservation_id, grant.reservationId);
  assert.equal(state.tables.matches.find((m) => m.id === 'old-current').unlock_included_reservation_id, undefined,
    'an earlier, separately priced match is not made free by this run');
});

test('stop or failure releases the whole reservation and cancels open source jobs', async () => {
  const { db, state } = fakeDb({ balance: 100 });
  const grant = await campaign(db);
  const job = seedJob(state, '2026-09-29T10:00:00Z');
  state.tables.discovery_query_queue.push(
    { id: 's1', matching_job_id: 'job1', status: 'PENDING' },
    { id: 's2', matching_job_id: 'job1', status: 'RETRY_WAIT' },
    { id: 's3', matching_job_id: 'job1', status: 'DONE' },
  );
  await failCampaignJob(db, job, grant, 'STOPPED_BY_ADMIN', 'stopped', 'cancelled');
  assert.equal(state.balance, 100, 'every reserved credit came back');
  assert.equal(state.reservations.get(grant.reservationId).status, 'RELEASED');
  assert.deepEqual(state.tables.discovery_query_queue.map((s) => s.status), ['CANCELLED', 'CANCELLED', 'DONE']);
  assert.equal(state.tables.matching_jobs[0].status, 'cancelled');
});

test('a released reservation cannot then be charged', async () => {
  const { db, state } = fakeDb({ balance: 100 });
  const grant = await campaign(db);
  await releaseExecution(db, grant, 'pipeline_error');
  const job = seedJob(state, '2026-09-29T10:00:00Z');
  await finalizeCampaignJob(db, job, grant, DEFAULT_ACTIVE_DEMAND_POLICY);
  assert.equal(state.balance, 100);
});
