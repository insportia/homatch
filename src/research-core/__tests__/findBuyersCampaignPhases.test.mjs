// FIND BUYERS — two phases per campaign (campaignPhases.ts, pure).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISCOVERY_STAGES, isPhase1Job, phase1State, phase1TimeoutMinutes, phase2Category, phase2MayStart, phaseOfStage, planDiscoveryBudget, probeEstimateMicros,
} from '../findBuyers/campaignPhases.ts';
import { STAGE_ACTOR } from '../findBuyers/actorInputs.ts';

test('stage → phase and Phase 2 category come from the Actor catalog (sources vs demand, needs a seed or not)', () => {
  assert.equal(phaseOfStage('FB_GROUP_SEARCH'), 'PHASE1_DISCOVERY');
  assert.equal(phaseOfStage('LINKEDIN_GROUPS'), 'PHASE1_DISCOVERY');
  for (const s of Object.keys(STAGE_ACTOR).filter((x) => !DISCOVERY_STAGES.has(x))) assert.equal(phaseOfStage(s), 'PHASE2_EXTRACTION', s);
  assert.equal(phase2Category('FB_GROUP_POSTS'), 'SOURCE_DEPENDENT');
  assert.equal(phase2Category('TELEGRAM_CHANNEL'), 'SOURCE_DEPENDENT');
  assert.equal(phase2Category('VK_WALL'), 'SOURCE_DEPENDENT');
  assert.equal(phase2Category('TIKTOK_SEARCH'), 'INDEPENDENT_SEARCH');
  assert.equal(phase2Category('BLUESKY_SEARCH'), 'INDEPENDENT_SEARCH');
  assert.equal(phase2Category('LINKEDIN_POSTS'), 'INDEPENDENT_SEARCH');
  assert.ok(isPhase1Job({ provider: 'TELEGRAM_SOURCES' }) && isPhase1Job({ provider: 'APIFY_MEMO23', stage: 'FB_GROUP_SEARCH' }));
  assert.ok(!isPhase1Job({ provider: 'TELEGRAM' }) && !isPhase1Job({ provider: 'APIFY_MEMO23', stage: 'TIKTOK_SEARCH' }));
});

test('Phase 1 is time-boxed inside the campaign window: a third, 3..10 minutes', () => {
  assert.equal(phase1TimeoutMinutes(30), 10);
  assert.equal(phase1TimeoutMinutes(45), 10);
  assert.equal(phase1TimeoutMinutes(12), 4);
  assert.equal(phase1TimeoutMinutes(5), 3);
  assert.equal(phase1TimeoutMinutes(NaN), 10);
});

test('Phase 1 state: running → Phase 2 holds; done (even with failures) or timed out → Phase 2 proceeds with the pool', () => {
  const now = 1_000_000, before = now + 60_000, after = now - 1;
  const running = [{ provider: 'TELEGRAM_SOURCES', status: 'PROCESSING' }, { provider: 'APIFY_MEMO23', stage: 'FB_GROUP_SEARCH', status: 'DONE' }, { provider: 'APIFY_MEMO23', stage: 'TIKTOK_SEARCH', status: 'PENDING' }];
  assert.deepEqual(phase1State(running, now, before), { state: 'RUNNING', open: 1, finished: 1 });
  assert.equal(phase2MayStart('RUNNING'), false);
  assert.equal(phase1State(running, now, after).state, 'TIMED_OUT', 'a provider that never answers cannot stall the campaign');
  const partial = [{ provider: 'TELEGRAM_SOURCES', status: 'FAILED' }, { provider: 'APIFY_MEMO23', stage: 'FB_GROUP_SEARCH', status: 'DONE' }];
  assert.equal(phase1State(partial, now, before).state, 'DONE', 'partial discovery is kept and Phase 2 proceeds');
  assert.equal(phase1State([{ provider: 'APIFY_MEMO23', stage: 'TIKTOK_SEARCH', status: 'PENDING' }], now, before).state, 'NONE');
  assert.ok(phase2MayStart('DONE') && phase2MayStart('TIMED_OUT') && phase2MayStart('NONE'));
});

test('an expected discovery job not queued yet holds Phase 2 (until the time box closes)', () => {
  const now = 1_000_000;
  assert.equal(phase1State([], now, now + 60_000, ['TELEGRAM_SOURCES']).state, 'RUNNING');
  assert.equal(phase1State([], now, now - 1, ['TELEGRAM_SOURCES']).state, 'TIMED_OUT');
  assert.equal(phase1State([{ provider: 'TELEGRAM_SOURCES', status: 'DONE' }], now, now + 60_000, ['TELEGRAM_SOURCES']).state, 'DONE');
});

test('the discovery budget is planned from the campaign\'s own probes, not a fixed share', () => {
  const $ = (usd) => Math.round(usd * 1e6);
  /* Covered by known sources: the planner queued no discovery job → nothing for Phase 1. */
  assert.deepEqual(planDiscoveryBudget({ providerBudgetMicros: $(5), discoveryEstimatesMicros: [], extractionEstimatesMicros: [$(0.04), $(0.03)] }),
    { discoveryCapMicros: 0, extractionReserveMicros: $(0.07), discoveryNeedMicros: 0, rationale: 'NO_DISCOVERY_PLANNED' });
  /* Poorly covered, budget enough: full discovery. */
  const full = planDiscoveryBudget({ providerBudgetMicros: $(5), discoveryEstimatesMicros: [$(0.024), $(0.024), $(0.013)], extractionEstimatesMicros: [$(0.035), $(0.03)] });
  assert.equal(full.rationale, 'FULL_DISCOVERY');
  assert.equal(full.discoveryCapMicros, $(0.061));
  /* Extraction takes most of a small budget: discovery gets the rest. */
  const limited = planDiscoveryBudget({ providerBudgetMicros: $(0.1), discoveryEstimatesMicros: [$(0.024), $(0.05)], extractionEstimatesMicros: [$(0.07)] });
  assert.equal(limited.rationale, 'DISCOVERY_LIMITED_BY_EXTRACTION');
  assert.equal(limited.discoveryCapMicros, $(0.03));
  /* Nothing left: one discovery probe still fits the campaign. */
  const one = planDiscoveryBudget({ providerBudgetMicros: $(0.1), discoveryEstimatesMicros: [$(0.024), $(0.05)], extractionEstimatesMicros: [$(0.2)] });
  assert.equal(one.rationale, 'ONE_DISCOVERY_PROBE');
  assert.equal(one.discoveryCapMicros, $(0.024));
  assert.ok(one.extractionReserveMicros <= $(0.1), 'never more than the budget');
  assert.equal(planDiscoveryBudget({ providerBudgetMicros: $(0.01), discoveryEstimatesMicros: [$(0.024)], extractionEstimatesMicros: [] }).discoveryCapMicros, 0, 'never beyond the campaign budget');
});

test('the probe estimate is the reservation\'s formula (start fee + limit × price/1k)', () => {
  assert.equal(probeEstimateMicros({ startFeeMicros: 5000, pricePer1kMicros: 1_900_000 }, 10), 24_000);
  assert.equal(probeEstimateMicros({ startFeeMicros: 10_000, pricePer1kMicros: 3_600_000 }, 20), 82_000);
  assert.equal(probeEstimateMicros({ pricePer1kMicros: null }, 20), 0);
});

import { actorBreaker, isEmptyResultMessage } from '../findBuyers/campaignPhases.ts';

test('circuit breaker: two finished failed/empty runs of one Actor in a campaign open it; a productive run resets it', () => {
  const failed = { status: 'FAILED', items_fetched: 0, cost_booked_at: 'x' };
  const empty = { status: 'SUCCEEDED', items_fetched: 0, cost_booked_at: 'x' };
  const good = { status: 'SUCCEEDED', items_fetched: 12, useful_results: 1, cost_booked_at: 'x' };
  assert.equal(actorBreaker([failed]).open, false);
  assert.equal(actorBreaker([failed, empty]).open, true);
  assert.equal(actorBreaker([failed, good, empty]).open, false);
  assert.equal(actorBreaker([{ status: 'RUNNING' }, { status: 'RESERVED' }]).open, false, 'in-flight runs are not judged');
  assert.equal(actorBreaker([{ status: 'RELEASED' }, { status: 'RELEASED' }]).open, false, 'released (never started) runs cost nothing and do not count');
  /* VILLION: Bluesky failed 6 times on empty datasets. */
  assert.equal(actorBreaker(Array(6).fill(failed)).consecutive, 6);
});

test('the memo23 "dataset is empty" failure is recognised as an empty answer, not a broken Actor', () => {
  assert.ok(isEmptyResultMessage('This run produced no items — the dataset is empty, and that is reported as a FAILURE on purpose.'));
  assert.ok(!isEmptyResultMessage('all 1 target(s) failed and 0 items were saved'), 'a failed target is a failure (VK), not an empty answer');
  assert.ok(!isEmptyResultMessage('Input is not valid: Field input.cookies is required'));
});
