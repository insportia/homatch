// PHASE 2 hardening — D2 (charge only delivered listings) and D3 (no contact in
// customer-visible community text), exercised against an in-memory database,
// plus the guarantees that must not move: Verify's billing untouched, retired
// providers refused, every Phase 2 switch defaulting OFF.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  billableDeliveries, claimSettlement, loadDeliveries, planSettlement, settleFindPropertyRun,
} from '../../supabase/functions/_shared/findPropertySettlement.ts';
import { recordCommunitySupply } from '../../supabase/functions/_shared/communitySupply.ts';
import { extractCommunityListing } from '../../src/research-core/discovery/community-listing.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/* ------------------------------------------------------------------ *
 * A tiny PostgREST-shaped fake: tables of rows, eq/is/in/gte filters,  *
 * update/upsert/select, and rpc handlers. Enough for these modules.    *
 * ------------------------------------------------------------------ */
function fakeDb({ tables = {}, rpc = {} } = {}) {
  const calls = { rpc: [], updates: [], upserts: [] };
  const from = (table) => {
    const filters = [];
    let op = 'select';
    let patch = null;
    let limitN = Infinity;
    const rows = () => (tables[table] ??= []);
    const matches = (row) => filters.every((f) => f(row));
    const chain = {
      select() { return chain; },
      update(p) { op = 'update'; patch = p; return chain; },
      upsert(row) { op = 'upsert'; patch = row; return chain; },
      eq(col, v) { filters.push((r) => r[col] === v); return chain; },
      neq(col, v) { filters.push((r) => r[col] !== v); return chain; },
      is(col, v) { filters.push((r) => (r[col] ?? null) === v); return chain; },
      in(col, vs) { filters.push((r) => vs.includes(r[col])); return chain; },
      gte(col, v) { filters.push((r) => r[col] >= v); return chain; },
      order() { return chain; },
      limit(n) { limitN = n; return chain; },
      single() { return chain.then((res) => ({ data: res.data?.[0] ?? null, error: res.error })); },
      maybeSingle() { return chain.single(); },
      then(resolve, reject) {
        try {
          if (op === 'update') {
            const hit = rows().filter(matches);
            hit.forEach((r) => Object.assign(r, patch));
            calls.updates.push({ table, patch, count: hit.length });
            return Promise.resolve({ data: hit.map((r) => ({ id: r.id })), error: null }).then(resolve, reject);
          }
          if (op === 'upsert') {
            calls.upserts.push({ table, row: patch });
            const stored = { id: `obs-${calls.upserts.length}`, ...patch };
            rows().push(stored);
            return Promise.resolve({ data: [{ id: stored.id }], error: null }).then(resolve, reject);
          }
          return Promise.resolve({ data: rows().filter(matches).slice(0, limitN), error: null }).then(resolve, reject);
        } catch (error) { return Promise.reject(error).then(resolve, reject); }
      },
    };
    return chain;
  };
  return {
    calls,
    from,
    async rpc(name, args) {
      calls.rpc.push({ name, args });
      const handler = rpc[name];
      if (!handler) return { data: null, error: { message: `unexpected rpc ${name}` } };
      return handler(args);
    },
  };
}

const STARTED = '2026-10-02T15:00:00.000Z';
const BEFORE = '2026-10-02T14:00:00.000Z';
const DURING = '2026-10-02T15:10:00.000Z';
const match = (observation_id, created_at, entity_id = null, extra = {}) => ({
  intent_profile_id: 'plan-1', source_kind: 'EXTERNAL_LISTING', compatibility: 'COMPATIBLE',
  observation_id, created_at, observation: { entity_id, validation_state: 'UNVERIFIED' }, ...extra,
});
const GRANT = {
  ok: true, funding: 'PAYG', productCode: 'FIND_PROPERTY', userId: 'u1', planCode: 'PAYG',
  reservationId: 'res-1', authorizedMaxCredits: 100, reservedCredits: 100,
};
const UNIT = 25;
const walletDb = (extra = {}) => fakeDb({
  rpc: {
    billing_price_quote: () => ({ data: [{ credits: UNIT }], error: null }),
    wallet_settle: ({ p_actual_credits }) => ({ data: [{ settled_credits: Math.min(p_actual_credits, 100), clamped: p_actual_credits > 100 }], error: null }),
  },
  ...extra,
});
const usage = (deliveries) => ({ runId: 'run-1', searchCount: 3, durationMs: 1000, providerCostUsd: 0, providerCostUnknown: false, deliveries });

/* ------------------------------- D2 ------------------------------- */

test('D2 count: 0 delivered when nothing new was matched during the run', () => {
  assert.equal(billableDeliveries([], STARTED).delivered, 0);
  assert.equal(billableDeliveries([match('o1', BEFORE, 'e1')], STARTED).delivered, 0, 'a match from before the run is not this run\'s');
});

test('D2 count: 1 and many delivered, one per property', () => {
  assert.equal(billableDeliveries([match('o1', DURING, 'e1')], STARTED).delivered, 1);
  assert.equal(billableDeliveries([match('o1', DURING, 'e1'), match('o2', DURING, 'e2'), match('o3', DURING, null)], STARTED).delivered, 3);
});

test('D2 count: duplicates, rejected, incompatible and already-delivered properties are not billed', () => {
  const rows = [
    match('o1', DURING, 'e1'),
    match('o2', DURING, 'e1'), // repost of the same flat
    match('o3', DURING, 'e3', { observation: { entity_id: 'e3', validation_state: 'INVALID' } }),
    match('o4', DURING, 'e4', { observation: { entity_id: 'e4', validation_state: 'REMOVED' } }),
    match('o5', DURING, 'e5', { compatibility: 'INCOMPATIBLE' }),
    match('o6', BEFORE, 'e6'), match('o7', DURING, 'e6'), // e6 was delivered before the run
  ];
  const d = billableDeliveries(rows, STARTED);
  assert.equal(d.delivered, 1);
  assert.deepEqual(d.excluded, { incompatible: 1, unusable: 2, duplicate: 1, previouslyDelivered: 1 });
});

test('D2 count is read from the server by plan, never from a caller', async () => {
  const db = fakeDb({ tables: { supply_matches: [match('o1', DURING, 'e1'), { ...match('o9', DURING, 'e9'), intent_profile_id: 'someone-else' }] } });
  assert.equal((await loadDeliveries(db, 'plan-1', STARTED)).delivered, 1);
  assert.equal((await loadDeliveries(db, null, STARTED)).delivered, 0, 'no plan, nothing delivered');
});

test('D2 plan: 0 releases, 1 and n charge the unit price each, the reservation caps it', () => {
  const base = { unitCredits: UNIT, authorizedMaxCredits: 100, reservationId: 'r' };
  assert.deepEqual(planSettlement({ ...base, delivered: 0 }), { action: 'RELEASE', credits: 0, reason: 'NO_DELIVERED_LISTINGS' });
  assert.equal(planSettlement({ ...base, delivered: 1 }).credits, 25);
  assert.equal(planSettlement({ ...base, delivered: 3 }).credits, 75);
  const capped = planSettlement({ ...base, delivered: 9 });
  assert.equal(capped.credits, 100);
  assert.equal(capped.capped, true);
  assert.equal(planSettlement({ ...base, delivered: 2, reservationId: null }).action, 'RELEASE');
  assert.throws(() => planSettlement({ ...base, delivered: 2, unitCredits: Number.NaN }), /no unit price/);
});

test('D2 settle: zero delivered releases the reservation and charges 0 — no price, no wallet_settle', async () => {
  const db = walletDb();
  const released = [];
  const out = await settleFindPropertyRun(db, GRANT, usage(billableDeliveries([], STARTED)), async (g, reason) => { released.push([g.reservationId, reason]); });
  assert.deepEqual(out, { action: 'RELEASE', creditsCharged: 0 });
  assert.deepEqual(released, [['res-1', 'no_delivered_listings']]);
  assert.equal(db.calls.rpc.length, 0, 'no billing_price_quote, no wallet_settle');
});

test('D2 settle: delivered listings settle unit x delivered at the plan the run started under', async () => {
  const db = walletDb();
  const out = await settleFindPropertyRun(db, GRANT, usage(billableDeliveries([match('o1', DURING, 'e1'), match('o2', DURING, 'e2')], STARTED)), async () => assert.fail('must not release'));
  assert.equal(out.action, 'SETTLE');
  assert.equal(out.creditsCharged, 50);
  const [quote, settle] = db.calls.rpc;
  assert.deepEqual(quote.args, { p_product_code: 'FIND_PROPERTY', p_plan_code: 'PAYG', p_landed_cogs_cents: null });
  assert.equal(settle.name, 'wallet_settle');
  assert.equal(settle.args.p_reservation_id, 'res-1');
  assert.equal(settle.args.p_actual_credits, 50);
  assert.equal(settle.args.p_usage.provider_units, 2);
  assert.equal(settle.args.p_usage.metadata.pricing, 'per_delivered_listing');
});

test('D2 settle: never more than the reservation', async () => {
  const many = Array.from({ length: 12 }, (_, i) => match(`o${i}`, DURING, `e${i}`));
  const db = walletDb();
  const out = await settleFindPropertyRun(db, GRANT, usage(billableDeliveries(many, STARTED)), async () => undefined);
  assert.equal(db.calls.rpc[1].args.p_actual_credits, 100, 'capped before the wallet');
  assert.equal(out.creditsCharged, 100);
  assert.equal(out.capped, true);
});

test('D2 settle: a missing price is an error (the run defers), never a blind charge', async () => {
  const db = fakeDb({ rpc: { billing_price_quote: () => ({ data: null, error: { message: 'down' } }) } });
  await assert.rejects(settleFindPropertyRun(db, GRANT, usage(billableDeliveries([match('o1', DURING, 'e1')], STARTED)), async () => undefined), /billing_price_quote failed/);
  assert.ok(!db.calls.rpc.some((c) => c.name === 'wallet_settle'));
});

test('D2 idempotent: only the first finaliser of a MATCHING run settles; a repeat touches no wallet', async () => {
  const db = walletDb({ tables: { discovery_runs: [{ id: 'run-1', status: 'MATCHING', stage: 'VALIDATING', credits_charged: null }] } });
  assert.equal(await claimSettlement(db, 'run-1'), true);
  assert.equal(await claimSettlement(db, 'run-1'), false, 'a concurrent second finaliser loses the claim');
  const run = (await db.from('discovery_runs').select().eq('id', 'run-1')).data[0];
  assert.equal(run.stage, 'SETTLING');
  /* the ending records the charge and the final status */
  run.credits_charged = 50; run.status = 'COMPLETED';
  assert.equal(await claimSettlement(db, 'run-1'), false, 'a repeat finds it already settled');
  const racing = walletDb({ tables: { discovery_runs: [{ id: 'run-2', status: 'MATCHING', stage: 'MATCHING', credits_charged: 0 }] } });
  assert.equal(await claimSettlement(racing, 'run-2'), false, 'a recorded charge is never settled again');
});

test('D2 wiring: finalize claims first, counts on the server, settles via the Phase 2 module only', () => {
  const lib = code('supabase/functions/_shared/discoveryRun.ts');
  const fin = lib.slice(lib.indexOf('export async function finalizeDiscoveryRun'), lib.indexOf('export async function failDiscoveryRun'));
  const claim = fin.indexOf('claimSettlement(db, run.id)');
  assert.ok(claim > 0 && claim < fin.indexOf('loadDeliveries(') && claim < fin.indexOf('settleFindPropertyRun('), 'claim before count and charge');
  assert.match(fin, /repeated: true/);
  const onError = fin.slice(fin.indexOf('} catch (error) {'));
  assert.match(onError, /releaseExecution\(db, grant, 'settle_failed'\)/, 'a settle that fails releases, never strands the hold');
  assert.ok(onError.indexOf("'settle_failed'") < onError.indexOf("'DEFERRED'"), 'deferred only if the release itself failed');
  assert.doesNotMatch(lib, /settleExecution/, 'the work-priced shared settle is not used for Find Property');
  /* failed and stopped runs */
  const fail = lib.slice(lib.indexOf('export async function failDiscoveryRun'));
  assert.match(fail, /releaseExecution\(db, grant/, 'a failed run releases everything');
  assert.doesNotMatch(fail, /wallet_settle|settleFindPropertyRun/, 'a failed run is never charged');
  const migration = read('supabase/migrations/20261009100000_phase2_universal_discovery.sql');
  assert.match(migration, /set status = 'SEARCHING', deadline_at = now\(\)/, 'stop ends the run through the same delivered-only finalize');
  const settlement = code('supabase/functions/_shared/findPropertySettlement.ts');
  assert.match(settlement, /^import type \{ ExecutionGrant \} from '\.\/billing\.ts';$/m, 'type only: the shared billing is not executed from here');
  assert.doesNotMatch(settlement, /verify/i);
});

test('D2: a stopped run that delivered nothing is released, one that delivered is charged for those', async () => {
  const none = walletDb();
  let released = false;
  await settleFindPropertyRun(none, GRANT, usage(billableDeliveries([match('o1', BEFORE, 'e1')], STARTED)), async () => { released = true; });
  assert.equal(released, true);
  const some = walletDb();
  const out = await settleFindPropertyRun(some, GRANT, usage(billableDeliveries([match('o1', DURING, 'e1')], STARTED)), async () => assert.fail());
  assert.equal(out.creditsCharged, 25);
});

/* ------------------------------- D3 ------------------------------- */

const PHONE = /(?:\+?995[\s-]*)?\(?5\d{2}\)?[\s-]?\d{2,3}[\s-]?\d{2,3}[\s-]?\d{2,3}|8\s?\(999\)/;
const CONTACT = [PHONE, /@[A-Za-z]/, /t\.me|wa\.me|whatsapp\.com/i, /[A-Za-z0-9._-]+@[A-Za-z]/];

const posts = {
  ka: 'ქირავდება 2 ოთახიანი ბინა ბათუმში, რუსთაველის 12, 65 მ², მე-5 სართული\nფასი 700$ თვეში\nტელ: 599 12 34 56 @batumi_flats',
  en: '599 12 34 56\nFor rent: 2-room flat in Batumi, Rustaveli 12, 65 sqm, 5th floor, 700$ per month. WhatsApp wa.me/995599123456',
  ru: 'Сдается 2-комн. квартира в Батуми, ул. Руставели 12, 65 м², 5 этаж, 700$ в месяц. Звоните +995 (599) 12-34-56, t.me/batumi_rent',
};

for (const [lang, post] of Object.entries(posts)) {
  test(`D3 (${lang}): the stored title and description carry no contact; parsed facts are unchanged`, async () => {
    const db = fakeDb();
    const signal = {
      id: `sig-${lang}`, platform: 'TELEGRAM', source_id: 'src-1', external_id: `m-${lang}`, source_url: 'https://t.me/batumi_channel/42',
      original_text: post, language: lang, published_at: DURING, content_fingerprint: null,
      source: { city: 'Batumi', country_code: 'GE' },
    };
    const id = await recordCommunitySupply(db, signal);
    assert.ok(id, 'recognised as a listing');
    const row = db.calls.upserts[0].row;
    for (const pattern of CONTACT) {
      assert.doesNotMatch(row.title ?? '', pattern, `title leaked ${pattern}: ${row.title}`);
      assert.doesNotMatch(row.description, pattern, `description leaked ${pattern}: ${row.description}`);
    }
    assert.ok(row.title && !/^\[•••\]$/.test(row.title), 'the title is a line that says something, not a mask');
    assert.ok(Object.values(row.field_origins.contactsRedacted).reduce((a, b) => a + b, 0) >= 2);
    /* the facts come from the original post, exactly as before */
    const listing = extractCommunityListing(post, { sourceCity: 'Batumi' });
    assert.equal(row.rent_amount, listing.price?.amount ?? null);
    assert.equal(row.area_sqm, listing.areaSqm);
    assert.equal(row.rooms, listing.rooms);
    assert.equal(row.city, listing.city);
    assert.equal(row.canonical_url, 'https://t.me/batumi_channel/42', 'the post link is provenance, not a personal contact');
    assert.ok(row.description.includes('12') && /65/.test(row.description), 'address and area kept for matching');
  });
}

test('D3: customer-visible text in find-property is the stored, redacted title', () => {
  const fp = read('supabase/functions/find-property/index.ts');
  assert.match(fp, /title: observation\.title/);
  assert.doesNotMatch(code('supabase/functions/find-property/index.ts'), /original_text/);
  const lib = code('supabase/functions/_shared/communitySupply.ts');
  assert.match(lib, /title: communityTitle\(shown\.text\)/);
  assert.match(lib, /description: shown\.text\.slice\(0, 4000\)/);
  assert.doesNotMatch(lib, /description: String\(signal\.original_text/);
});

/* --------------------- guarantees that do not move -------------------- */

test('Verify and the shared billing are untouched by Phase 2 hardening', () => {
  const billing = read('supabase/functions/_shared/billing.ts');
  assert.match(billing, /export async function settleExecution\(/, 'shared settle still there, unchanged API');
  for (const p of ['supabase/functions/_shared/findPropertySettlement.ts', 'src/research-core/discovery/portal-selection.ts',
    'src/research-core/discovery/contact-redaction.ts']) {
    assert.doesNotMatch(code(p), /research-agent|verify-synthesis|verification-handoff|from '.*verify/i, `${p} reaches no Verify code`);
  }
});

test('retired providers stay refused and every Phase 2 switch defaults OFF', () => {
  const migration = read('supabase/migrations/20261009100000_phase2_universal_discovery.sql');
  for (const key of ['find_property_discovery_enabled', 'discovery_worker_route_enabled']) {
    assert.match(migration, new RegExp(`'${key}',\\s*'false'::jsonb`), `${key} defaults OFF`);
  }
  assert.match(migration, /'discovery_worker_portal_adapters',\s*'\[\]'::jsonb/);
  const claim = migration.slice(migration.indexOf('function public.claim_discovery_source_jobs_v2'));
  assert.match(claim.slice(0, 6000), /'TELEGRAM', 'TELEGRAM_SOURCES', 'FORUM', 'PORTAL'/);
  assert.doesNotMatch(claim.slice(0, 6000), /APIFY|DATAFORSEO/);
});
