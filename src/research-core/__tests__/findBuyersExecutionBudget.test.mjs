// FIND BUYERS / FIND TENANTS — the $5 minimum and spending the execution budget well
// (owner, 2026-10-19). Numbers are production's: the gpt-4o-mini price book, the measured
// AI_REPLAY cost per call, and each Actor's record of qualified people per dollar.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AiSpendGate, actorYieldPrior, aiCallCeilingMicros, classifyCallCeilingMicros, executionHeadroomMicros,
  DEFAULT_AI_HEADROOM_PER_ITEM_MICROS, YIELD_PRIOR_MAX,
} from '../findBuyers/executionBudget.ts';
import { applyYieldPrior } from '../findBuyers/campaignPlan.ts';
import { allocateCampaign, minimumCampaignCredits, PAID_DISCOVERY_MIN_USD } from '../billing/paidDiscoveryPolicy.ts';

const BOOK = { inputPerMTokMicros: 150_000, outputPerMTokMicros: 600_000 }; // gpt-4o-mini, admin price book

test('1. a paid campaign starts at exactly 50 credits = $5 and larger budgets stay allowed', () => {
  assert.equal(PAID_DISCOVERY_MIN_USD, 5);
  assert.equal(minimumCampaignCredits(10), 50, '10 credits = $1');
  assert.equal(minimumCampaignCredits(10, 1), 50, 'never below $5');
  assert.equal(minimumCampaignCredits(10, 20), 200, 'a larger configured minimum is honoured');
  /* The execution budget is the central policy's number, read back — never re-derived here. */
  assert.equal(allocateCampaign(50, 10).priceMicros, 5_000_000);
  assert.ok(allocateCampaign(500, 10).providerBudgetMicros > allocateCampaign(50, 10).providerBudgetMicros);
});

test('2. a call ceiling bounds what OpenAI can bill: input as sent, output at max_tokens', () => {
  assert.equal(aiCallCeilingMicros(BOOK, 1000, 1000), 750);
  /* 15 items (AI_BATCH_SIZE): 5,400 input + 3,000 max output tokens. */
  assert.equal(classifyCallCeilingMicros(BOOK, 15), 2610);
  /* Production AI_REPLAY averaged 1,340 µ$ per call: the ceiling sits above the real cost. */
  assert.ok(classifyCallCeilingMicros(BOOK, 15) >= 1340);
  assert.equal(classifyCallCeilingMicros(BOOK, 0), aiCallCeilingMicros(BOOK, 900, 300));
});

test('3. the spend gate admits only what fits, books what was spent, and is open without a campaign', () => {
  const open = new AiSpendGate(null);
  assert.equal(open.admit(10_000_000), true, 'no campaign: no budget to enforce');
  const g = new AiSpendGate(3000);
  assert.equal(g.admit(2610), true);
  g.spend(1340);
  assert.equal(g.remainingMicros, 1660);
  assert.equal(g.admit(2610), false, 'the next call would pass the ceiling');
  assert.equal(g.refused, 1);
  g.spend(5000);
  assert.equal(g.remainingMicros, 0, 'never negative');
  assert.equal(new AiSpendGate(-5).remainingMicros, 0, 'an overspent campaign admits nothing');
});

test('4. headroom is budget minus everything committed, never negative', () => {
  assert.equal(executionHeadroomMicros(3_150_000, 3_000_000), 150_000);
  assert.equal(executionHeadroomMicros(3_150_000, 4_000_000), 0);
  assert.equal(executionHeadroomMicros(NaN, 1), 0);
  assert.equal(DEFAULT_AI_HEADROOM_PER_ITEM_MICROS, 250, 'above the ≈170 µ$ per item production classification cost');
});

test('5. first probes follow measured yield per dollar — never an invented one', () => {
  /* Production 2026-10-19: Facebook group posts 147 finished runs, 37 qualified, $6.619. */
  assert.equal(actorYieldPrior({ bookedRuns: 147, qualified: 37, spentMicros: 6_619_000 }), 6);
  assert.equal(actorYieldPrior({ bookedRuns: 60, qualified: 0, spentMicros: 1_043_000 }), 0, 'no qualified person, no boost');
  assert.equal(actorYieldPrior({ bookedRuns: 3, qualified: 3, spentMicros: 10_000 }), 0, 'too few runs to judge');
  assert.equal(actorYieldPrior({ bookedRuns: 9, qualified: 9 }), 0, 'unknown spend, no boost');
  assert.equal(actorYieldPrior({ bookedRuns: 50, qualified: 400, spentMicros: 1_000_000 }), YIELD_PRIOR_MAX, 'bounded');
  assert.equal(actorYieldPrior(null), 0);

  const jobs = [
    { stage: 'FB_GROUP_POSTS', actorKey: 'FB_GROUP_POSTS', priority: 85, reason: 'known_source_reuse' },
    { stage: 'FB_GROUP_SEARCH', actorKey: 'FB_GROUP_SEARCH', priority: 85, reason: 'source_discovery' },
    { stage: 'TIKTOK_SEARCH', actorKey: 'TIKTOK', priority: 85, reason: 'demand_search' },
  ];
  const history = {
    FB_GROUP_POSTS: { bookedRuns: 147, qualified: 37, spentMicros: 6_619_000 },
    FB_GROUP_SEARCH: { bookedRuns: 60, qualified: 50, spentMicros: 1_000_000 },
    TIKTOK: { bookedRuns: 19, qualified: 0, spentMicros: 589_000 },
  };
  const out = applyYieldPrior(jobs.map((j) => ({ ...j })), history);
  assert.equal(out[0].priority, 91, 'the Actor that found people goes first');
  assert.equal(out[1].priority, 85, 'source discovery is not reranked');
  assert.equal(out[2].priority, 85, 'zero yield gets no boost (applyDepth demotes it separately)');
});
