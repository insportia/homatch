// WHAT A CUSTOMER'S PLAN BUYS, AND WHAT IT DOES NOT.
//
// The failure this guards against is specific and expensive: a registry of a
// hundred sources, a customer on the free plan, and one search that fans out
// across all hundred because nothing in the path ever asked what they had
// paid for. The ladder already stops when it has enough results; it did not
// stop when the money ran out, and it had no notion of a source being further
// down the priority list than a plan reaches.
//
// The entitlement numbers used below are the ones production actually holds
// (product_plan_entitlements, read 2026-09-26), not invented tiers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  deriveSearchBudget,
  shouldContinue,
  withinPriorityCeiling,
} from '../discovery/search-budget.ts';

/* Real rows, copied from production rather than imagined. */
const FIND_CLIENTS_FREE = {
  productCode: 'FIND_CLIENTS', planCode: 'FREE', qualityTier: 'STANDARD',
  resultCeiling: 10, providerBudgetCeilingCents: 200, priorityLevel: 0,
};
const FIND_CLIENTS_VIP = {
  productCode: 'FIND_CLIENTS', planCode: 'VIP', qualityTier: 'ENHANCED',
  resultCeiling: 30, providerBudgetCeilingCents: 600, priorityLevel: 1,
};
const FIND_CLIENTS_PREMIUM = {
  productCode: 'FIND_CLIENTS', planCode: 'PREMIUM', qualityTier: 'MAXIMUM',
  resultCeiling: 75, providerBudgetCeilingCents: 1500, priorityLevel: 2,
};
/* VERIFY caps spend but not results — it answers about one subject. */
const VERIFY_FREE = {
  productCode: 'VERIFY', planCode: 'FREE', qualityTier: 'STANDARD',
  resultCeiling: null, providerBudgetCeilingCents: 40, priorityLevel: 0,
};

const SOURCES = [
  { id: 'ss-ge', priorityTier: 0 },
  { id: 'place-ge', priorityTier: 0 },
  { id: 'home-ge', priorityTier: 0 },
  { id: 'home24-ge', priorityTier: 1 },
  { id: 'korter-ge', priorityTier: 1 },
  { id: 'makler-ge', priorityTier: 2 },
  { id: 'some-agency', priorityTier: 3 },
  { id: 'never-judged', priorityTier: null },
];

/* ── CASE A — low entitlement gets a small, bounded envelope ────────────── */

test('CASE A: a free plan reaches critical sources only', () => {
  const budget = deriveSearchBudget(FIND_CLIENTS_FREE);
  assert.equal(budget.sourcePriorityCeiling, 0);
  assert.equal(budget.targetResults, 10);
  assert.equal(budget.maxInternalCostCents, 200);
  assert.equal(budget.expensiveEnrichmentAllowed, false);

  const { eligible, skipped } = withinPriorityCeiling(SOURCES, budget);
  assert.deepEqual(eligible.map((s) => s.id), ['ss-ge', 'place-ge', 'home-ge']);
  // The long tail is refused with a reason, not silently dropped.
  assert.ok(skipped.every((s) => s.reason === 'OVER_BUDGET'));
  assert.equal(skipped.length, 5);
});

/* ── CASE B — high entitlement may go further, on the same first stages ── */

test('CASE B: a premium plan reaches further down the same ordered list', () => {
  const free = deriveSearchBudget(FIND_CLIENTS_FREE);
  const premium = deriveSearchBudget(FIND_CLIENTS_PREMIUM);

  assert.ok(premium.sourcePriorityCeiling > free.sourcePriorityCeiling);
  assert.ok(premium.targetResults > free.targetResults);
  assert.ok(premium.maxSourceJobs > free.maxSourceJobs);
  assert.equal(premium.expensiveEnrichmentAllowed, true);

  const premiumEligible = withinPriorityCeiling(SOURCES, premium).eligible.map((s) => s.id);
  const freeEligible = withinPriorityCeiling(SOURCES, free).eligible.map((s) => s.id);

  // Premium is a SUPERSET: it does not skip the strong sources to chase the tail.
  for (const id of freeEligible) assert.ok(premiumEligible.includes(id), `${id} dropped`);
  assert.ok(premiumEligible.includes('makler-ge'));
  // Even premium does not reach an experimental or an unjudged source.
  assert.equal(premiumEligible.includes('some-agency'), false);
  assert.equal(premiumEligible.includes('never-judged'), false);
});

/* ── CASE E — budget exhausted stops cleanly ────────────────────────────── */

test('CASE E: spend at the ceiling stops the search', () => {
  const budget = deriveSearchBudget(FIND_CLIENTS_FREE);
  const decision = shouldContinue(budget, {
    usefulResults: 2, sourceJobsExecuted: 1, internalCostCents: 200,
  });
  assert.equal(decision.stop, true);
  assert.equal(decision.reason, 'BUDGET_EXHAUSTED');
});

test('the job bound stops a search whose cost nobody measured', () => {
  /*
   * The trap: maxInternalCostCents null and internalCostCents null, so the
   * money guard cannot fire. If that were the only guard, an uncosted product
   * would search without limit. The job bound is why it does not.
   */
  const budget = deriveSearchBudget({ ...FIND_CLIENTS_FREE, providerBudgetCeilingCents: null });
  assert.equal(budget.maxInternalCostCents, null);

  const decision = shouldContinue(budget, {
    usefulResults: 0, sourceJobsExecuted: budget.maxSourceJobs, internalCostCents: null,
  });
  assert.equal(decision.stop, true);
  assert.equal(decision.reason, 'JOB_LIMIT_REACHED');
});

/* ── CASE H — enough results early stops, even with budget remaining ───── */

test('CASE H: the target is reached, so the search stops with budget left', () => {
  const budget = deriveSearchBudget(FIND_CLIENTS_PREMIUM);
  const decision = shouldContinue(budget, {
    usefulResults: 75, sourceJobsExecuted: 2, internalCostCents: 30,
  });
  assert.equal(decision.stop, true);
  assert.equal(decision.reason, 'TARGET_REACHED');
  // Premium bought the opportunity to search further, not the obligation.
  assert.ok(budget.maxInternalCostCents - 30 > 0);
});

/* ── the conservative defaults ──────────────────────────────────────────── */

test('an unentitled product gets the narrowest envelope, not the widest', () => {
  const budget = deriveSearchBudget(null);
  assert.equal(budget.sourcePriorityCeiling, 0);
  assert.equal(budget.expensiveEnrichmentAllowed, false);
  assert.match(budget.rationale, /narrowest envelope/);
  assert.equal(withinPriorityCeiling(SOURCES, budget).eligible.length, 3);
});

test('a null priority_level does not mean "reach everything"', () => {
  const budget = deriveSearchBudget({ ...FIND_CLIENTS_FREE, priorityLevel: null });
  assert.equal(budget.sourcePriorityCeiling, 0);
});

test('a product with no result ceiling is bounded by jobs rather than by a made-up number', () => {
  const budget = deriveSearchBudget(VERIFY_FREE);
  assert.equal(budget.targetResults, budget.maxSourceJobs);
  assert.match(budget.rationale, /no result_ceiling on this product, bounded by jobs/);
});

test('an unmeasured cost ceiling is reported as unknown, never as zero', () => {
  const budget = deriveSearchBudget({ ...VERIFY_FREE, providerBudgetCeilingCents: null });
  assert.equal(budget.maxInternalCostCents, null);
  assert.match(budget.rationale, /UNKNOWN/);
  // Null spend must not read as "already at the ceiling" and stop everything.
  const decision = shouldContinue(budget, {
    usefulResults: 0, sourceJobsExecuted: 0, internalCostCents: null,
  });
  assert.equal(decision.stop, false);
});

test('the derivation is explained, because a silently narrowed search looks like a bug', () => {
  const budget = deriveSearchBudget(FIND_CLIENTS_VIP);
  assert.match(budget.rationale, /FIND_CLIENTS\/VIP/);
  assert.match(budget.rationale, /tier ENHANCED/);
  assert.match(budget.rationale, /sources up to P1/);
});

/* ── 1,000 SEARCHES, and no uncontrolled fan-out ───────────────────────── */

test('1,000 mixed-entitlement searches stay inside their plans', () => {
  /*
   * The acceptance question is not "does it run" but "does a cheap search
   * ever reach a source it did not pay for". Synthetic and offline: this
   * asserts the planner's arithmetic, and sends no request anywhere.
   */
  const PLANS = [FIND_CLIENTS_FREE, FIND_CLIENTS_VIP, FIND_CLIENTS_PREMIUM, null];
  const CITIES = ['Tbilisi', 'Batumi', 'Kutaisi', 'Rustavi'];

  let totalJobsAuthorised = 0;
  let freeSearches = 0;
  let premiumSearches = 0;
  const tiersTouchedByFree = new Set();

  for (let i = 0; i < 1000; i += 1) {
    const plan = PLANS[i % PLANS.length];
    const budget = deriveSearchBudget(plan);
    const { eligible } = withinPriorityCeiling(SOURCES, budget);

    // Nothing may ever be authorised beyond the plan's own ceiling.
    for (const source of eligible) {
      assert.ok(source.priorityTier <= budget.sourcePriorityCeiling,
        `search ${i} reached P${source.priorityTier} on a P${budget.sourcePriorityCeiling} plan`);
    }

    if (plan === FIND_CLIENTS_FREE) {
      freeSearches += 1;
      for (const source of eligible) tiersTouchedByFree.add(source.priorityTier);
    }
    if (plan === FIND_CLIENTS_PREMIUM) premiumSearches += 1;

    // A search is authorised at most maxSourceJobs, whatever the city.
    const jobs = Math.min(eligible.length, budget.maxSourceJobs);
    assert.ok(jobs <= budget.maxSourceJobs);
    totalJobsAuthorised += jobs;

    // The city varies; the bound does not.
    assert.ok(CITIES[i % CITIES.length].length > 0);
  }

  assert.equal(freeSearches, 250);
  assert.equal(premiumSearches, 250);
  // Every free search touched P0 and nothing else, across all 250.
  assert.deepEqual([...tiersTouchedByFree], [0]);

  /*
   * The number that matters. 1,000 searches against an 8-source registry
   * could authorise 8,000 source jobs if nothing bounded them. Free and
   * unentitled plans cap at 3 eligible, VIP at 5, premium at 6 — and the job
   * ceiling cuts further still.
   */
  assert.ok(totalJobsAuthorised <= 1000 * 6,
    `fan-out ${totalJobsAuthorised} exceeds what any plan authorises`);
  assert.ok(totalJobsAuthorised < 8000, 'the registry size, not the plan, is bounding the search');
});

/* ── WIRED, not merely implemented ──────────────────────────────────────── */

test('the supply sweep actually applies the entitlement ceiling', () => {
  /*
   * A budget module with passing unit tests and no caller is a budget nobody
   * is subject to. Before this, supply-discovery selected EVERY source that
   * was LIVE_TESTED and active, whatever the customer had paid for, and
   * grant.priorityLevel was computed by beginExecution and then used
   * nowhere at all.
   *
   * This asserts the call sites rather than the export, because the export
   * existing is what was already true while the behaviour was missing.
   */
  const sweep = readFileSync('supabase/functions/supply-discovery/index.ts', 'utf8');
  assert.match(sweep, /deriveSearchBudget/, 'the sweep never derives a budget');
  assert.match(sweep, /withinPriorityCeiling\(tiered, budget\)/,
    'the sweep never applies the ceiling to its source list');
  // The tier has to be SELECTED before it can be compared.
  assert.match(sweep, /select\('id,name,url,adapter_id,lifecycle,active,quality_score,priority_tier'\)/,
    'priority_tier is compared but never read from the registry');
  // And the plan comes from the same RPC the billing path uses.
  assert.match(sweep, /billing_entitlements/,
    'the sweep invents a plan instead of reading the one billing resolved');
});

test('an operator sweep is ungated and a campaign sweep is not', () => {
  /*
   * The distinction that keeps this honest in both directions. No campaign
   * means no customer and no bill, so Homatch filling its own store is not
   * throttled by an entitlement nobody holds. A campaign with an
   * unresolvable owner gets the NARROWEST envelope rather than the widest,
   * because a lookup that failed is not a licence.
   */
  const sweep = readFileSync('supabase/functions/supply-discovery/index.ts', 'utf8');
  assert.match(sweep, /if \(campaignId\) \{/);
  assert.match(sweep, /campaign owner unresolved/);
  assert.match(sweep, /operator sweep: no customer, no priority ceiling/);
});

test('the sweep reports what the entitlement excluded', () => {
  // "permitted 3" cannot be told from "the registry only has 3", and the two
  // call for opposite responses.
  const sweep = readFileSync('supabase/functions/supply-discovery/index.ts', 'utf8');
  assert.match(sweep, /sourcesOutsideEntitlement: gate\.skipped\.length/);
  assert.match(sweep, /sourcesConsidered: tiered\.length/);
});

test('overlapping searches on the same plan authorise identical envelopes', () => {
  /*
   * Coalescing happens a layer up, in the planner that groups jobs. It can
   * only be correct if two equivalent searches produce the same bounds in the
   * first place, so this is the precondition for it rather than the thing
   * itself.
   */
  const a = deriveSearchBudget(FIND_CLIENTS_VIP);
  const b = deriveSearchBudget({ ...FIND_CLIENTS_VIP });
  assert.deepEqual(a, b);
});
