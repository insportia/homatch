// DESIGN STUDIO VARIABLE PRICING — measured cost → landed → 55 % margin → credits (0.1).
//
// ESTIMATE → RESERVE → EXECUTE → SETTLE → RELEASE, proven without a database or a paid call:
//   * the quote prices the migration's own measured reference figures through the same formula the SQL
//     billing_price_quote runs (mirrored here and checked against the migration's text), at 0.1 credit;
//   * the signed quote carries min ≤ est ≤ max and a forged or shape-broken one is refused;
//   * the settlement prices the work already in the ledger (a design spec, a walkthrough's AI) WITHOUT writing it
//     again, and wallet_settle still clamps to the reserved maximum;
//   * the walkthrough's GPU is counted over every pass, recorded once, and a closed walkthrough is never charged twice.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(spec, ctx, next) {
    if (spec.startsWith('https://esm.sh/@supabase/supabase-js')) {
      return { url: 'data:text/javascript,export const createClient = () => { throw new Error("no network in tests"); };', shortCircuit: true };
    }
    return next(spec, ctx);
  }`));
globalThis.Deno = { env: { get: () => undefined } };

const pricing = await import('../renderPricing.ts');
const { settleExecution } = await import('../../billing.ts');
const walk = await import('../../../design-studio-reconstruct/walkthroughBilling.ts');

const MIGRATION = readFileSync(new URL('../../../../migrations/20261015100000_design_studio_variable_pricing.sql', import.meta.url), 'utf8');
const ORIGINAL_QUOTE = readFileSync(new URL('../../../../migrations/20260911193358_billing_v2_functions.sql', import.meta.url), 'utf8');

/** The reference figures exactly as the migration writes them: code → {min, est, max} (+ the VARIANT mode). */
function referenceFromMigration() {
  const rows = [...MIGRATION.matchAll(/\('(DS_[A-Z_]+)',\s+([\d.]+),\s+([\d.]+),\s+([\d.]+),/g)];
  const out = {};
  for (const [, code, min, est, max] of rows) out[code] = { reference: { min: +min, est: +est, max: +max } };
  const variant = MIGRATION.match(/'VARIANT', jsonb_build_object\('min', ([\d.]+), 'est', ([\d.]+), 'max', ([\d.]+)\)/);
  out.DS_MASTER_RENDER.modes = { VARIANT: { min: +variant[1], est: +variant[2], max: +variant[3] } };
  for (const c of Object.values(out)) c.credit_rounding_dp = 1;
  return out;
}

/** billing_price_quote as the migration defines it (FREE plan: no profit share; global floor 5500; 10 credits = $1). */
function priceQuote(cfg, landed, standardRetail, referenceLanded) {
  const dp = cfg.credit_rounding_dp ?? 2;
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  const cogs = r4(landed);
  const plan = r4(cogs * (standardRetail / referenceLanded));
  const floor = r4(cogs / (1 - 5500 / 1e4));
  const final = Math.max(plan, floor);
  const p = 10 ** dp;
  let credits = Math.round((final / 10) * p) / p;
  if (credits * 10 < floor - 1e-9) credits = Math.round((credits + 1 / p) * p) / p;
  return credits;
}

/** A service client that answers billable_products and billing_price_quote the way the database would. */
function fakeAdmin(config) {
  const calls = [];
  return {
    calls,
    from(table) {
      const q = { _t: table, _f: {} };
      q.select = () => q;
      q.eq = (k, v) => { q._f[k] = v; return q; };
      q.maybeSingle = async () => {
        const code = q._f.code;
        const c = config[code];
        return { data: c ? { code, pricing_active: c.pricing_active !== false, config: c } : null };
      };
      return q;
    },
    async rpc(name, args) {
      calls.push([name, args]);
      if (name !== 'billing_price_quote') return { data: null, error: { message: 'unexpected' } };
      const c = config[args.p_product_code];
      const est = c.reference.est;
      return { data: [{ credits: priceQuote(c, args.p_landed_cogs_cents, est / 0.45, est) }], error: null };
    },
  };
}

test('the migration prices from the measured figures: standard retail is the 55 % margin, every DS floor is 5500, billing stays off', () => {
  assert.match(MIGRATION, /standard_retail_cents = round\(v\.est \/ 0\.45, 4\)/);
  assert.match(MIGRATION, /set min_gross_margin_bps = 5500, updated_at = now\(\)\s+where code like 'DS\\_%'/);
  assert.match(MIGRATION, /'DS_WALKTHROUGH', 'Design Studio 3D walkthrough', 'VARIABLE', true,/);
  assert.match(MIGRATION, /'credit_rounding_dp', 1,/);
  // The charging switch is never touched by the migration: it stays as production has it (off).
  assert.doesNotMatch(MIGRATION.replace(/--[^\n]*/g, ''), /design_studio_billing_enabled/);
});

test('billing_price_quote changes only by a product\'s own precision: every other line is the original', () => {
  const body = (sql) => {
    const s = sql.slice(sql.indexOf('FUNCTION public.billing_price_quote'));
    return s.slice(s.indexOf('declare'), s.indexOf('end;\n$', s.indexOf('declare')) + 4);
  };
  const norm = (s) => s.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
  const added = /if \(v_p\.config \? 'credit_rounding_dp'\) and \(v_p\.config->>'credit_rounding_dp'\) ~ '\^\[0-4\]\$' then\s+v_dp := \(v_p\.config->>'credit_rounding_dp'\)::integer;\s+end if;/;
  const mine = body(MIGRATION);
  assert.match(mine, added);
  assert.equal(norm(mine.replace(added, '')), norm(body(ORIGINAL_QUOTE)), 'the formula, the floor and its round-up are unchanged');
  // The floor round-up is what keeps 0.1-credit rounding at or above 55 %.
  assert.match(mine, /if public\.billing_credits_to_cents\(v_credits\) < v_floor then\s+v_credits := round\(v_credits \+ power\(10, -v_dp\)::numeric, v_dp\);/);
});

test('the quote: MINIMUM / ESTIMATE / MAXIMUM per operation, at 0.1 credit, from the measured figures', async () => {
  const cfg = referenceFromMigration();
  const admin = fakeAdmin(cfg);
  const q = async (product, mode = null, views = 1) => (await pricing.priceRange(admin, { product, mode, planCode: 'FREE', views })).range;
  assert.deepEqual(await q('DS_MASTER_RENDER'), { min: 5.5, est: 5.8, max: 6.9 });
  assert.deepEqual(await q('DS_MASTER_RENDER', 'VARIANT'), { min: 5.3, est: 5.6, max: 6.4 });
  assert.deepEqual(await q('DS_ROOM_RENDER'), { min: 5.3, est: 5.5, max: 6.1 });
  assert.deepEqual(await q('DS_RENDER_EDIT'), { min: 4.7, est: 5.4, max: 7.4 });
  assert.deepEqual(await q('DS_WALKTHROUGH'), { min: 0.1, est: 0.5, max: 2.7 });
  // Several views are several units, still at 0.1 credit.
  assert.deepEqual(await q('DS_ROOM_RENDER', null, 3), { min: 15.9, est: 16.5, max: 18.3 });
  // Every price is through billing_price_quote — the same function the settlement runs.
  assert.ok(admin.calls.every(([name]) => name === 'billing_price_quote'));
  // Every figure keeps the 55 % margin: price ≥ landed / 0.45.
  for (const [code, c] of Object.entries(cfg)) {
    for (const k of ['min', 'est', 'max']) {
      const credits = priceQuote(c, c.reference[k], c.reference.est / 0.45, c.reference.est);
      assert.ok(credits * 10 >= c.reference[k] / 0.45 - 1e-9, `${code} ${k}`);
      assert.ok(credits * 10 - c.reference[k] / 0.45 < 1 + 1e-9, `${code} ${k}: never more than one 0.1-credit step above`);
    }
  }
});

test('no quote without approved pricing or a valid view count; a mode never invents its own figures', async () => {
  const cfg = referenceFromMigration();
  cfg.DS_RENDER_EDIT.pricing_active = false;
  const admin = fakeAdmin(cfg);
  assert.deepEqual(await pricing.priceRange(admin, { product: 'DS_RENDER_EDIT', planCode: 'FREE', views: 1 }), { error: 'PRICING_INACTIVE' });
  assert.deepEqual(await pricing.priceRange(admin, { product: 'DS_ROOM_RENDER', planCode: 'FREE', views: 13 }), { error: 'BAD_VIEWS' });
  assert.deepEqual(await pricing.priceRange(admin, { product: 'DS_WALKTHROUGH', planCode: 'FREE', views: 2 }), { error: 'BAD_VIEWS' });
  // An unknown mode falls back to the product's own reference.
  assert.deepEqual(pricing.referenceOf(cfg.DS_ROOM_RENDER, 'VARIANT'), cfg.DS_ROOM_RENDER.reference);
  // A broken reference (max below est) cannot be quoted at all.
  assert.equal(pricing.referenceOf({ reference: { min: 1, est: 5, max: 4 } }), null);
  assert.equal(pricing.referenceOf({}), null);
});

test('the signed quote carries min ≤ est ≤ max; a forged or shape-broken one is refused', async () => {
  const SECRET = 'q'.repeat(48);
  const claims = { v: 1, u: 'u1', p: 'p1', ver: 'v1', product: 'DS_WALKTHROUGH', views: 1, credits: 2.7, min: 0.1, est: 0.5, mode: null, charged: false, exp: Date.now() + 60_000, n: 'n' };
  const ok = await pricing.verifyQuote(await pricing.signQuote(claims, SECRET), SECRET);
  assert.equal(ok.ok, true);
  assert.equal(pricing.quoteMatches(ok.claims, { userId: 'u1', projectId: 'p1', versionId: 'v1', product: 'DS_WALKTHROUGH', views: 1 }), true);
  assert.equal(pricing.quoteMatches(ok.claims, { userId: 'u1', projectId: 'p1', versionId: 'v1', product: 'DS_ROOM_RENDER', views: 1 }), false, 'a walkthrough quote never starts a render');
  for (const bad of [{ est: 3 }, { min: 0.6 }, { credits: 0 }, { min: undefined }]) {
    const token = await pricing.signQuote({ ...claims, ...bad }, SECRET);
    assert.equal((await pricing.verifyQuote(token, SECRET)).reason, 'QUOTE_MALFORMED', JSON.stringify(bad));
  }
});

/** A wallet that prices like the database and settles like wallet_settle: clamped to the authorised maximum, once. */
function fakeWallet({ authorized, estimate = 5.5 }) {
  const state = { quoted: [], settled: null, usage: null };
  return {
    state,
    async rpc(name, args) {
      if (name === 'billing_landed_cogs_cents') return { data: Math.round(((args.p_raw_provider_cents ?? 0) + (args.p_ai_cents ?? 0)) * 1.18 * 1e4) / 1e4 };
      if (name === 'billing_price_quote') {
        state.quoted.push(args.p_landed_cogs_cents);
        const cfg = { credit_rounding_dp: 1 };
        return { data: [{ credits: priceQuote(cfg, args.p_landed_cogs_cents, estimate * 10, (estimate * 10) * 0.45) }] };
      }
      if (name === 'wallet_settle') {
        if (state.settled) return { data: [{ settled_credits: state.settled, released_credits: 0, clamped: false }] };
        const charge = Math.min(args.p_actual_credits, authorized);
        state.settled = charge; state.usage = args.p_usage;
        return { data: [{ settled_credits: charge, released_credits: Math.round((authorized - charge) * 10) / 10, clamped: args.p_actual_credits > authorized }] };
      }
      return { data: null };
    },
  };
}
const grant = (authorized) => ({ ok: true, funding: 'PAYG', productCode: 'DS_ROOM_RENDER', userId: 'u1', planCode: 'FREE', reservationId: 'r1', reservedCredits: authorized, authorizedMaxCredits: authorized, estimateMinCredits: authorized, estimateMaxCredits: authorized, pricingVersion: 2 });

test('settle: the measured cost is priced (spec already in the ledger counted in the price, never written again)', async () => {
  const sb = fakeWallet({ authorized: 6.1 });
  // A room: image + object map 19.9 ¢ raw (23.48 ¢ landed); its spec, already recorded, 0.75 ¢ landed.
  const r = await settleExecution(sb, grant(6.1), { aiCostCents: 19.9, alreadyLedgeredLandedCents: 0.75, metadata: { x: 1 } }, 'SUCCESS');
  assert.equal(sb.state.quoted[0], 23.482 + 0.75, 'priced on the image + map + spec');
  assert.equal(r.chargedCredits, 5.4);
  assert.equal(r.releasedCredits, 0.7, 'the rest of the reserved maximum goes back');
  assert.equal(sb.state.usage.landed_cogs_cents, 23.482, 'the usage event records only this settlement\'s own cost (no double counting)');
  assert.equal(sb.state.usage.metadata.already_ledgered_landed_cents, 0.75);
  // Settling again (a second poll, a retry) is the same settlement: nothing more is charged.
  const again = await settleExecution(sb, grant(6.1), { aiCostCents: 19.9, alreadyLedgeredLandedCents: 0.75 }, 'SUCCESS');
  assert.equal(again.chargedCredits, 5.4);
});

test('settle: an unexpectedly expensive run is clamped to the accepted maximum (never above it without a new quote)', async () => {
  const sb = fakeWallet({ authorized: 6.1 });
  const r = await settleExecution(sb, grant(6.1), { aiCostCents: 40 }, 'SUCCESS');
  assert.equal(r.chargedCredits, 6.1);
  assert.equal(r.clamped, true);
});

test('walkthrough GPU: every factory pass counts (a retried pass too); unknown is unknown, never zero', () => {
  assert.deepEqual(walk.gpuOf([{ kind: 'RUNPOD_GPU', usd: 0.0041 }, { kind: 'OPENAI_SCENE_PLAN', usd: 0.02 }, { kind: 'RUNPOD_GPU', usd: 0.0032 }]), { usd: 0.0073, known: true, passes: 2 });
  assert.deepEqual(walk.gpuOf([{ kind: 'RUNPOD_GPU', usd: null }]), { usd: null, known: false, passes: 1 });
  assert.deepEqual(walk.gpuOf(null), { usd: 0, known: true, passes: 0 });
});

/** ds_walkthroughs + usage_events + the wallet, with the conditional updates the closer relies on. */
function walkDb(row, { aiLanded = [] } = {}) {
  const db = { row: { ...row }, events: aiLanded.map((l) => ({ landed_cogs_cents: l })), recorded: [], settled: 0, released: 0, quoted: [] };
  const builder = (table) => {
    const q = { op: 'select', patch: null, f: [] };
    q.select = () => q; q.in = () => q;
    q.eq = (k, v) => { q.f.push(['eq', k, v]); return q; };
    q.is = (k, v) => { q.f.push(['is', k, v]); return q; };
    q.update = (patch) => { q.op = 'update'; q.patch = patch; return q; };
    q.insert = async (v) => { db.recorded.push(v); return { data: null }; };
    const matches = () => q.f.every(([kind, k, v]) => {
      if (k === 'billing->>closed') return (db.row.billing?.closed ?? null) === v;
      if (k === 'billing->>reservationId') return db.row.billing?.reservationId === v;
      return true;
    });
    const run = async () => {
      if (table === 'usage_events') return { data: db.events };
      if (q.op === 'update') { if (!matches()) return { data: [] }; db.row = { ...db.row, ...q.patch }; return { data: [{ id: db.row.id }] }; }
      return { data: db.row };
    };
    q.maybeSingle = run;
    q.then = (res, rej) => run().then(res, rej);
    return q;
  };
  return {
    db,
    from: builder,
    async rpc(name, args) {
      if (name === 'billing_landed_cogs_cents') return { data: Math.round(((args.p_raw_provider_cents ?? 0) + (args.p_ai_cents ?? 0)) * 1.18 * 1e4) / 1e4 };
      if (name === 'billing_price_quote') { db.quoted.push(args.p_landed_cogs_cents); return { data: [{ credits: priceQuote({ credit_rounding_dp: 1 }, args.p_landed_cogs_cents, 2.1 / 0.45, 2.1) }] }; }
      if (name === 'wallet_settle') { db.settled += 1; return { data: [{ settled_credits: Math.min(args.p_actual_credits, 2.7), released_credits: 0, clamped: false }] }; }
      if (name === 'wallet_release') { db.released += 1; return { data: null, error: null }; }
      if (name === 'billing_entitlements') return { data: { plan_code: 'FREE' } };
      return { data: null };
    },
  };
}

test('walkthrough READY: settles its GPU + the AI already in the ledger, once; the reservation is then closed', async () => {
  const admin = walkDb({ id: 'w1', user_id: 'u1', project_id: 'p1', state: 'READY', billing: { state: 'RESERVED', reservationId: 'res-1', credits: 2.7, min: 0.1, est: 0.5 }, cost: [{ kind: 'RUNPOD_GPU', usd: 0.0041 }] }, { aiLanded: [0.97, 0.39] });
  await walk.closeWalkthroughBilling(admin, 'w1', 'SETTLE');
  assert.equal(admin.db.settled, 1);
  assert.equal(admin.db.quoted[0], Math.round(0.41 * 1.18 * 1e4) / 1e4 + 0.97 + 0.39, 'priced on GPU (landed) + the AI calls already recorded');
  assert.equal(admin.db.row.billing.state, 'SETTLED');
  await walk.closeWalkthroughBilling(admin, 'w1', 'SETTLE');
  assert.equal(admin.db.settled, 1, 'a closed walkthrough is never settled twice');
});

test('walkthrough FAILED: the whole reservation is released (its GPU still recorded as cost)', async () => {
  const admin = walkDb({ id: 'w2', user_id: 'u1', project_id: 'p1', state: 'FAILED', error: 'PROVIDER_FAILED', billing: { state: 'RESERVED', reservationId: 'res-2', credits: 2.7 }, cost: [{ kind: 'RUNPOD_GPU', usd: 0.002 }] });
  await walk.closeWalkthroughBilling(admin, 'w2', 'RELEASE');
  assert.equal(admin.db.released, 1);
  assert.equal(admin.db.settled, 0);
  assert.equal(admin.db.row.billing.state, 'RELEASED');
});

test('walkthrough while charging is off: the GPU is recorded once as unbilled cost, never charged', async () => {
  const admin = walkDb({ id: 'w3', user_id: 'u1', project_id: 'p1', state: 'READY', billing: { state: 'NOT_CHARGED', productCode: 'DS_WALKTHROUGH' }, cost: [{ kind: 'RUNPOD_GPU', usd: 0.0037 }] });
  await walk.closeWalkthroughBilling(admin, 'w3', 'SETTLE');
  await walk.closeWalkthroughBilling(admin, 'w3', 'SETTLE');
  assert.equal(admin.db.settled, 0);
  assert.equal(admin.db.recorded.length, 1, 'recorded once');
  assert.equal(admin.db.recorded[0].product_code, 'DS_WALKTHROUGH');
  assert.equal(admin.db.recorded[0].billable, false);
  assert.equal(admin.db.recorded[0].raw_provider_cost_cents, 0.37);
});

test('a retried walkthrough records only its new GPU passes (the earlier attempt\'s are already in the ledger)', async () => {
  // Attempt 1 failed with one pass (0.002 recorded); the retry ran a second pass (0.0041); charging off.
  const admin = walkDb({ id: 'w4', user_id: 'u1', project_id: 'p1', state: 'READY', billing: { state: 'NOT_CHARGED', productCode: 'DS_WALKTHROUGH', ledgeredGpuUsd: 0.002 }, cost: [{ kind: 'RUNPOD_GPU', usd: 0.002 }, { kind: 'RUNPOD_GPU', usd: 0.0041 }] });
  await walk.closeWalkthroughBilling(admin, 'w4', 'SETTLE');
  assert.equal(admin.db.recorded.length, 1);
  assert.equal(admin.db.recorded[0].raw_provider_cost_cents, 0.41, 'only the new pass');
  assert.equal(admin.db.row.billing.ledgeredGpuUsd, 0.0061);
  // And the retry handler carries what was already recorded into the new attempt.
  const src = readFileSync(new URL('../../../design-studio-reconstruct/walkthrough.ts', import.meta.url), 'utf8');
  assert.match(src, /billing: \{ \.\.\.money\.billing, ledgeredGpuUsd: Number\(row\.billing\?\.ledgeredGpuUsd\) \|\| 0 \}/);
});

test('the server code: quote from the price book, maximum reserved as the ceiling, spec claimed once, walkthrough metered as its own product', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const renders = read('../../../design-studio-reconstruct/renders.ts');
  const generate = read('../../../design-studio-reconstruct/generate.ts');
  const walkthrough = read('../../../design-studio-reconstruct/walkthrough.ts');
  assert.match(renders, /const priced = await priceRange\(ctx\.admin, \{ product, mode, planCode, views \}\);/);
  assert.doesNotMatch(renders + generate, /creditsPerView/, 'no price constant left anywhere');
  // The reservation is the confirmed maximum, exactly (never capped below it by the estimate spread).
  for (const src of [renders, generate, read('../../../design-studio-reconstruct/walkthroughBilling.ts')]) assert.match(src, /budgetIsCeiling: true, requireFullBudget: true, allowIncluded: false/);
  // The spec is priced into one settlement only (an atomic claim on the spec job).
  assert.match(generate, /\.is\('output->>billedWithRender', null\)\.select\('id'\)/);
  assert.match(generate, /settleExecution\(admin, grant, \{ \.\.\.usage, alreadyLedgeredLandedCents: specLanded \}, 'SUCCESS'\)/);
  // The object map is itemised and part of a failed render's cost too.
  assert.match(generate, /object_map_usd: ai\.sceneUsd \?\? null/);
  assert.match(generate, /aiUsd: known \? \(ai\.imageUsd \?\? 0\) \+ \(ai\.sceneUsd \?\? 0\) : null/);
  // The walkthrough: its AI under DS_WALKTHROUGH, reserved before work, settled on READY, released on FAILED.
  assert.equal((walkthrough.match(/productCode: WALK_PRODUCT/g) ?? []).length, 2);
  assert.match(walkthrough, /const money = await reserveWalkthrough\(admin, \{ actorId, projectId: project\.id/);
  assert.equal((walkthrough.match(/await closeWalkthroughBilling\(admin, row\.id, 'SETTLE'\);/g) ?? []).length, 2);
  assert.match(walkthrough, /await closeWalkthroughBilling\(admin, row\.id, 'RELEASE'\);/);
  assert.match(walkthrough, /row\.billing\?\.state !== 'RESERVED'\) \{ await fail\(admin, row, 'BILLING_CONFIRMATION_REQUIRED'\)/);
});
