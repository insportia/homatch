// A PROVIDER COST NOBODY KNOWS IS NOT A PROVIDER COST OF ZERO.
//
// The audit that produced this module found 602 of 925 cost_events carrying
// cost_usd = 0. Most of those belonged to Apify and DataForSEO, and that half
// is now HISTORY rather than a defect: both providers are retired, their last
// row was written on 2026-08-29, and production holds provider_kill_switch =
// true with both names in provider_disabled_list. Those rows stay as recorded.
//
// What these tests guard is the half that is still writing. research-agent
// prices every Verify stage from provider_price_book, and when the price book
// has no rate for a model it wrote $0.00 and put the word "unpriced" in a
// free-text column nothing reads. That happened to gpt-6-astra on 2026-09-19.
// A verification recorded as free is a verification with infinite margin.
//
// So: four ways of being zero, and only one of them is money.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { stripComments } from '../../../../scripts/lib/stripComments.mjs';
import { join } from 'node:path';
import { resolveProviderCost, pricingStateForDerivedCost } from '../providerCost.ts';

const read = (p) => readFileSync(p, 'utf8');

/**
 * Source with its comments removed.
 *
 * A guard that greps for a forbidden string finds the doc comment explaining
 * why the string is forbidden, which is how "this function no longer reads
 * APIFY_API_TOKEN" becomes a failure. Crude on purpose: it does not need to
 * understand strings-containing-slashes, only to stop prose counting as code.
 */
const withoutComments = (src) =>
  stripComments(src);

/* ── resolveProviderCost: providers that bill per call ─────────────────── */

test('a cache hit is a real zero, not an unknown', () => {
  // The whole point of caching is that it shows up as a saving. If a cache
  // hit were UNPRICED it would be excluded from margin alongside the genuine
  // unknowns, and reuse would become invisible to the only report that
  // measures whether it was worth building.
  const r = resolveProviderCost({ cacheHit: true, estimatedUsd: 0.026 });
  assert.deepEqual(r, { cost_usd: 0, pricing_state: 'ZERO_REAL' });
});

test('a failure that bought nothing is a real zero', () => {
  const r = resolveProviderCost({ success: false, estimatedUsd: 0.026 });
  assert.deepEqual(r, { cost_usd: 0, pricing_state: 'ZERO_REAL' });
});

test('a failure that was billed anyway is not free', () => {
  // A run that died halfway has usually already been charged for. Recording
  // it as free is how a provider bill stops reconciling with this table.
  const r = resolveProviderCost({ success: false, billedDespiteFailure: true, estimatedUsd: 0.026 });
  assert.deepEqual(r, { cost_usd: 0.026, pricing_state: 'ESTIMATED' });
});

test('a provider that charged for a failed attempt is believed', () => {
  const r = resolveProviderCost({ success: false, actualUsd: 0.004 });
  assert.deepEqual(r, { cost_usd: 0.004, pricing_state: 'ACTUAL' });
});

test('an actual figure of exactly zero is a real zero', () => {
  /*
   * The trap that `!actualUsd` walks into. A provider that reports costs and
   * reports 0.00 has told us something true; treating that as a missing value
   * would replace it with an estimate we were not asked for.
   */
  const r = resolveProviderCost({ actualUsd: 0, estimatedUsd: 0.026 });
  assert.deepEqual(r, { cost_usd: 0, pricing_state: 'ZERO_REAL' });
});

test('an actual figure beats the price book', () => {
  const r = resolveProviderCost({ actualUsd: 0.031, estimatedUsd: 0.026 });
  assert.deepEqual(r, { cost_usd: 0.031, pricing_state: 'ACTUAL' });
});

test('with no actual figure the price book is used, and labelled as such', () => {
  const r = resolveProviderCost({ estimatedUsd: 0.026 });
  assert.deepEqual(r, { cost_usd: 0.026, pricing_state: 'ESTIMATED' });
});

test('neither an actual nor a rate is UNPRICED — never a silent zero', () => {
  // THE DEFECT, in one assertion. cost_usd is still 0 because the column is
  // NOT NULL and every reader sums it; pricing_state is what stops that zero
  // being read as "this was free".
  const r = resolveProviderCost({});
  assert.equal(r.pricing_state, 'UNPRICED');
  assert.notEqual(r.pricing_state, 'ZERO_REAL');
});

test('null, undefined and NaN are absences, not zeros', () => {
  for (const bad of [null, undefined, Number.NaN, 'free', -1]) {
    assert.equal(resolveProviderCost({ actualUsd: bad }).pricing_state, 'UNPRICED',
      `${String(bad)} was treated as a known cost`);
  }
});

/* ── pricingStateForDerivedCost: costs we calculate ourselves ──────────── */

test('a fully priced stage is ESTIMATED, not ACTUAL', () => {
  /*
   * OpenAI never told us this figure. We multiplied measured tokens by rates
   * we entered ourselves, so it is our arithmetic on our rate card. ACTUAL is
   * reserved for a number the provider sent, and the difference matters the
   * first time a bill disagrees with this table.
   */
  const r = pricingStateForDerivedCost({ costUsd: 0.2196, fullyPriced: true });
  assert.deepEqual(r, { cost_usd: 0.2196, pricing_state: 'ESTIMATED' });
});

test('a half-priced stage is PARTIAL: real spend, and a floor', () => {
  /*
   * The case the fifth state exists for. Tokens priced, WEB_SEARCH_CALL not,
   * because that unit was never entered for the model. ESTIMATED would assert
   * a total we do not have; UNPRICED would throw away spend we do.
   */
  const r = pricingStateForDerivedCost({ costUsd: 0.0412, fullyPriced: false });
  assert.deepEqual(r, { cost_usd: 0.0412, pricing_state: 'PARTIAL' });
});

test('a stage on an unpriced model is UNPRICED', () => {
  // gpt-6-astra, 2026-09-19, VERIFY_SYNTHESIS: recorded as $0.00 and counted
  // as free. This is that row, told truthfully.
  const r = pricingStateForDerivedCost({ costUsd: 0, fullyPriced: false });
  assert.deepEqual(r, { cost_usd: 0, pricing_state: 'UNPRICED' });
});

test('a stage that consumed nothing is a real zero', () => {
  const r = pricingStateForDerivedCost({ costUsd: 0, fullyPriced: true, consumedNothing: true });
  assert.deepEqual(r, { cost_usd: 0, pricing_state: 'ZERO_REAL' });
});

test('priced against every dimension and still zero is a real zero', () => {
  const r = pricingStateForDerivedCost({ costUsd: 0, fullyPriced: true });
  assert.equal(r.pricing_state, 'ZERO_REAL');
});

test('a cached prompt is a cheaper call, not a free one', () => {
  /*
   * MUTATION GUARD. resolveProviderCost turns cacheHit into ZERO_REAL, which
   * is right for a provider call that never happened and catastrophic here:
   * most Verify stages run with part of the prompt cached, so routing
   * research-agent through that function would book the majority of the Verify
   * cost base as free. pricingStateForDerivedCost has no cacheHit input at
   * all, and that absence is deliberate.
   */
  assert.equal(pricingStateForDerivedCost.length, 1);
  const src = read('supabase/functions/_shared/providerCost.ts');
  const body = src.slice(src.indexOf('export function pricingStateForDerivedCost'));
  assert.equal(/cacheHit/.test(body), false,
    'pricingStateForDerivedCost has grown a cache input; a cached prompt is not a free call');
});

test('no state ever pairs a positive cost with an unknown', () => {
  // MUTATION GUARD. UNPRICED means "cost_usd is a placeholder". A positive
  // number under that label would be summed by every reader while being
  // labelled meaningless — the worst of both.
  const cases = [
    resolveProviderCost({}),
    resolveProviderCost({ actualUsd: null }),
    pricingStateForDerivedCost({ costUsd: 0, fullyPriced: false }),
    pricingStateForDerivedCost({ costUsd: 0.5, fullyPriced: false, consumedNothing: true }),
  ];
  for (const r of cases) {
    if (r.pricing_state === 'UNPRICED' || r.pricing_state === 'ZERO_REAL') {
      assert.equal(r.cost_usd, 0, `${r.pricing_state} carried ${r.cost_usd}`);
    }
  }
});

/* ── the vocabulary is one vocabulary ──────────────────────────────────── */

test('the TypeScript states and the database CHECK cannot drift apart', () => {
  /*
   * Two lists of the same five words, in two languages, in two files. The
   * failure this catches is a sixth state added in TypeScript, shipped, and
   * rejected by Postgres at 2am on the row that mattered.
   */
  const ts = read('supabase/functions/_shared/providerCost.ts');
  const declared = ts.match(/export type PricingState =([^;]+);/)[1];
  const states = [...declared.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();

  const sql = read('supabase/migrations/20260925130000_cost_events_pricing_state_partial.sql');
  const check = sql.slice(sql.indexOf('pricing_state in ('));
  const allowed = [...check.slice(0, check.indexOf('))')).matchAll(/'([A-Z_]+)'/g)]
    .map((m) => m[1]).sort();

  assert.deepEqual(states, allowed);
  assert.deepEqual(states, ['ACTUAL', 'ESTIMATED', 'PARTIAL', 'UNPRICED', 'ZERO_REAL']);
});

/* ── the writers that are still running ────────────────────────────────── */

test('research-agent records how much each Verify figure is worth', () => {
  const src = read('supabase/functions/research-agent/index.ts');
  assert.match(src, /pricingStateForDerivedCost/,
    'the only provider path still writing cost_events records no pricing provenance');
  assert.match(src, /pricing_state,/);
  // And it must not have reached for the wrong helper on the way.
  assert.equal(/resolveProviderCost/.test(src), false,
    'research-agent computes its own costs; resolveProviderCost would treat cached prompts as free');
});

test('an unlock is a real zero and says so', () => {
  const src = read('supabase/functions/atomic-unlock/index.ts');
  const block = src.slice(src.indexOf("operation_type: 'MATCH_UNLOCK'"));
  assert.match(block.slice(0, 1200), /pricing_state: 'ZERO_REAL'/,
    'MATCH_UNLOCK is indistinguishable from a cost we never found out');
});

/* ── the retired providers stay retired ────────────────────────────────── */

const RETIRED = [
  'supabase/functions/apify-discover/index.ts',
  'supabase/functions/source-discovery-massive/index.ts',
  'supabase/functions/dataforseo-search/index.ts',
  'supabase/functions/source-monitor-public/index.ts',
];

test('no retired discovery function can reach a paid provider', () => {
  /*
   * apify-discover and source-discovery-massive were the gap. Production had
   * already retired both providers — provider_kill_switch = true,
   * external_discovery_enabled = false, provider_disabled_list carrying APIFY
   * and DATAFORSEO — but those two functions read their credentials straight
   * from the environment and consulted none of it. Deployed, reachable, and
   * one authenticated POST away from spending money on a provider the
   * architecture had left behind.
   */
  for (const path of RETIRED) {
    const src = read(path);
    assert.match(src, /423/, `${path} no longer refuses`);
    assert.match(src, /paidLaunchesBlocked/, `${path} no longer reports the lock`);
    /*
     * CODE, not prose. Each of these files explains in its header what it
     * used to read — "this function read APIFY_API_TOKEN straight out of the
     * environment" — and a guard that greps the whole file fails on the
     * sentence describing the fix. Which it did, the first time this ran.
     */
    const code = withoutComments(src);
    for (const live of [/api\.apify\.com/, /APIFY_API_TOKEN/, /DATAFORSEO_LOGIN/, /dataforseo\.com\/v3/]) {
      assert.equal(live.test(code), false, `${path} has grown a live provider path back: ${live}`);
    }
  }
});

test('nothing in the repository calls a retired discovery function', () => {
  // The other half of the guard: a stub nobody calls is retired, a stub
  // somebody calls is a 423 in production that used to be a feature.
  const names = ['apify-discover', 'source-discovery-massive'];
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|mjs|js)$/.test(entry) && !p.includes('__tests__')) files.push(p);
    }
  };
  walk('src');
  walk('supabase/functions');

  for (const name of names) {
    const callers = files.filter((f) => {
      if (f.includes(name.replace('-', '-'))) return false;
      if (f.includes(join('supabase', 'functions', name))) return false;
      return read(f).includes(`'${name}'`) || read(f).includes(`/${name}`);
    });
    assert.deepEqual(callers, [], `${name} is retired but still called`);
  }
});

test('the portable job library is not mistaken for a live path', () => {
  /*
   * _shared/jobs.ts contains DataForSEO and Apify calls and is imported by
   * nothing — proven here rather than trusted, because its own header says so
   * and a header is not evidence. It is kept as the portable implementation,
   * so the guard is that it stays unwired rather than that it be deleted.
   */
  const importers = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules') continue;
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.ts$/.test(entry) && !p.endsWith(join('_shared', 'jobs.ts'))) {
        if (/from\s+'[^']*_shared\/jobs\.ts'/.test(read(p))) importers.push(p);
      }
    }
  };
  walk('supabase/functions');
  assert.deepEqual(importers, [],
    '_shared/jobs.ts reaches retired providers and is now on a live path');
});
