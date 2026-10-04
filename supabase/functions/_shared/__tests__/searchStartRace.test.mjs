// ONE ACTIVE SEARCH PER PROPERTY — two near-simultaneous starts against the
// real claim (_shared/findBuyers/startClaim.ts) and the real billing gateway
// (_shared/billing.ts), in the order match-campaign runs them: claim the job
// row, THEN reserve. The in-memory matching_jobs table enforces the same
// partial unique index as uidx_matching_jobs_one_active_per_property, and its
// insert yields before the check so the two starts genuinely interleave.
//
// Proven: campaigns created = 1, reservations = 1, search execution paths = 1;
// the loser resolves to the winner's job without reserving; a replay of the
// same request id resolves the same way; a finished search never blocks the
// next one; a refused reservation gives the claim back.
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

globalThis.Deno = { env: { get: () => undefined } };
const { beginExecution } = await import('../billing.ts');
const { claimSearch, abandonClaim, ACTIVE_SEARCH_STATUSES } = await import('../findBuyers/startClaim.ts');

const tick = () => new Promise((r) => setImmediate(r));

function fakeDb({ balance = 1000 } = {}) {
  const state = { balance, reservations: [], byKey: new Map(), jobs: [], executions: 0, seq: 0 };
  const active = (j) => ACTIVE_SEARCH_STATUSES.includes(j.status);
  const rpcs = {
    billing_entitlements: () => ({ plan_code: 'FREE', pricing_version: 1, wallet: { balance: state.balance },
      products: [{ product_code: 'FIND_CLIENTS', included_remaining: 0, payg_available: true, quality_tier: 'STANDARD', result_ceiling: null, priority_level: 0 }] }),
    billing_price_quote: () => [{ credits: 25, pricing_version: 1 }],
    billing_landed_cogs_cents: () => 0,
    wallet_reserve: (a) => {
      if (state.byKey.has(a.p_idempotency_key)) {
        const r = state.byKey.get(a.p_idempotency_key);
        return [{ reservation_id: r.id, reserved_credits: r.reserved, balance_after: state.balance, was_duplicate: true }];
      }
      if (state.balance < a.p_authorized_max_credits) throw new Error('INSUFFICIENT_CREDITS');
      const r = { id: `res-${state.reservations.length + 1}`, reserved: a.p_authorized_max_credits };
      state.balance -= r.reserved; state.reservations.push(r); state.byKey.set(a.p_idempotency_key, r);
      return [{ reservation_id: r.id, reserved_credits: r.reserved, balance_after: state.balance, was_duplicate: false }];
    },
  };
  function from(name) {
    const tables = { billable_products: [{ code: 'FIND_CLIENTS', min_viable_budget_credits: 50, config: {} }],
      product_plan_entitlements: [{ product_code: 'FIND_CLIENTS', plan_code: 'FREE', provider_budget_ceiling_cents: null }] };
    const q = { filters: [], op: 'select', patch: null, row: null };
    const rows = () => (name === 'matching_jobs' ? state.jobs : tables[name] ?? []);
    const hit = () => rows().filter((r) => q.filters.every(([op, c, v]) =>
      op === 'eq' ? r[c] === v : op === 'in' ? v.includes(r[c]) : op === 'is' ? (r[c] ?? null) === v : true));
    const run = async () => {
      if (q.op === 'insert') {
        await tick(); // the other request runs here
        const row = q.row;
        if (state.jobs.some((j) => j.idempotency_key === row.idempotency_key)
          || (active(row) && state.jobs.some((j) => j.property_id === row.property_id && active(j)))) {
          return { data: null, error: { code: '23505', message: 'duplicate key value violates unique constraint' } };
        }
        const job = { id: `job-${++state.seq}`, billing_grant: null, created_at: state.seq, ...row };
        state.jobs.push(job);
        return { data: [{ id: job.id }], error: null };
      }
      if (q.op === 'update') { hit().forEach((r) => Object.assign(r, q.patch)); return { data: null, error: null }; }
      if (q.op === 'delete') { const h = new Set(hit()); state.jobs = state.jobs.filter((j) => !h.has(j)); return { data: null, error: null }; }
      return { data: hit(), error: null };
    };
    const api = {
      select() { return api; }, order() { return api; }, limit() { return api; }, not() { return api; },
      eq(c, v) { q.filters.push(['eq', c, v]); return api; },
      in(c, v) { q.filters.push(['in', c, v]); return api; },
      is(c, v) { q.filters.push(['is', c, v]); return api; },
      insert(row) { q.op = 'insert'; q.row = row; return api; },
      update(p) { q.op = 'update'; q.patch = p; return api; },
      delete() { q.op = 'delete'; return api; },
      single: async () => { const r = await run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      maybeSingle: async () => { const r = await run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      then: (ok, bad) => run().then(ok, bad),
    };
    return api;
  }
  const db = { from, rpc: async (n, a) => { try { return { data: rpcs[n](a), error: null }; } catch (e) { return { data: null, error: { message: e.message } }; } } };
  return { db, state };
}

/* match-campaign's start, in its order: claim the job row, then reserve, then
   store the grant and run the search. */
async function start(db, state, { property = 'p1', key, budget = 100 }) {
  const idempotencyKey = `u1:${key}`;
  const claim = await claimSearch(db, { property_id: property, user_id: 'u1', idempotency_key: idempotencyKey, status: 'queued' }, property, idempotencyKey);
  if (!claim.ok) return { alreadyRunning: true, jobId: claim.existing?.id ?? null };
  const grant = await beginExecution(db, { userId: 'u1', productCode: 'FIND_CLIENTS', idempotencyKey: `findclients:${idempotencyKey}`,
    jobRef: property, authorizedMaxCredits: budget, allowIncluded: false, budgetIsCeiling: true, requireFullBudget: true });
  if (!grant.ok) { await abandonClaim(db, claim.jobId); return { refused: grant.reason }; }
  await db.from('matching_jobs').update({ billing_grant: grant }).eq('id', claim.jobId);
  state.executions++;
  return { jobId: claim.jobId };
}

test('two simultaneous starts with different request ids: one search, one reservation, one execution', async () => {
  const { db, state } = fakeDb();
  const [a, b] = await Promise.all([start(db, state, { key: 'ui-1' }), start(db, state, { key: 'ui-2' })]);
  assert.equal(state.jobs.length, 1, 'campaigns created');
  assert.equal(state.reservations.length, 1, 'customer reservations');
  assert.equal(state.executions, 1, 'search execution paths');
  assert.equal(state.balance, 900);
  const loser = a.alreadyRunning ? a : b;
  const winner = a.alreadyRunning ? b : a;
  assert.equal(loser.alreadyRunning, true);
  assert.equal(loser.jobId, winner.jobId, 'the loser is pointed at the running search');
});

test('five starts at once (double click, two tabs, retries) still make one search and one reservation', async () => {
  const { db, state } = fakeDb();
  const out = await Promise.all(['a', 'b', 'c', 'd', 'e'].map((k) => start(db, state, { key: k })));
  assert.equal(state.jobs.length, 1);
  assert.equal(state.reservations.length, 1);
  assert.equal(state.executions, 1);
  assert.equal(out.filter((o) => o.alreadyRunning).length, 4);
});

test('a replay of the same request id resolves to the same search without a second reservation', async () => {
  const { db, state } = fakeDb();
  const [a, b] = await Promise.all([start(db, state, { key: 'same' }), start(db, state, { key: 'same' })]);
  assert.equal(state.jobs.length, 1);
  assert.equal(state.reservations.length, 1);
  assert.equal((a.jobId ?? b.jobId), state.jobs[0].id);
});

test('a paused search still holds the property; a finished one does not', async () => {
  const { db, state } = fakeDb();
  await start(db, state, { key: 'first' });
  state.jobs[0].status = 'paused';
  assert.equal((await start(db, state, { key: 'second' })).alreadyRunning, true);
  assert.equal(state.reservations.length, 1);
  for (const terminal of ['completed', 'partially_completed', 'failed', 'cancelled', 'budget_reached']) {
    state.jobs.forEach((j) => { j.status = terminal; });
    const next = await start(db, state, { key: `after-${terminal}` });
    assert.ok(next.jobId && !next.alreadyRunning, `a ${terminal} search must not block a new one`);
  }
  assert.equal(state.reservations.length, 6);
});

test('different properties are independent', async () => {
  const { db, state } = fakeDb();
  await Promise.all([start(db, state, { key: 'x', property: 'p1' }), start(db, state, { key: 'y', property: 'p2' })]);
  assert.equal(state.jobs.length, 2);
  assert.equal(state.reservations.length, 2);
});

test('a refused reservation gives the claim back, so the property is not blocked', async () => {
  const { db, state } = fakeDb({ balance: 10 });
  const r = await start(db, state, { key: 'poor' });
  assert.ok(r.refused);
  assert.equal(state.jobs.length, 0, 'no claim left behind');
  assert.equal(state.reservations.length, 0);
  state.balance = 1000;
  assert.ok((await start(db, state, { key: 'topped-up' })).jobId);
});
