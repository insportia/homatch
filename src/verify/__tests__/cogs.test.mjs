// What a verification costs us, and what we refuse to make up.
//
// The usage block below is copied verbatim from a real completed production
// job. Every number in it is what OpenAI actually reported for that run —
// including the cached_tokens, which are the whole reason reuse is worth
// measuring.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseRateTable,
  priceStage,
  priceVerification,
  totalVerificationCost,
  costOperationFor,
} from '../cogs.ts';

/** Verbatim from research_jobs.result_json.costUsage of a completed run. */
const REAL_USAGE = {
  identity: {
    input_tokens: 37624, total_tokens: 41448, output_tokens: 3824,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 2967 },
  },
  official_collection: {
    input_tokens: 20004, total_tokens: 21748, output_tokens: 1744,
    input_tokens_details: { cached_tokens: 4370, cache_write_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 490 },
  },
  public_research: {
    input_tokens: 55054, total_tokens: 57263, output_tokens: 2209,
    input_tokens_details: { cached_tokens: 4370, cache_write_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 1466 },
  },
  market: {
    input_tokens: 36644, total_tokens: 40252, output_tokens: 3608,
    input_tokens_details: { cached_tokens: 4370, cache_write_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 1807 },
  },
  synthesis: {
    input_tokens: 23472, total_tokens: 25698, output_tokens: 2226,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    output_tokens_details: { reasoning_tokens: 1060 },
  },
};

const RATES = {
  'research-model': { input: 1.25, output: 10, cachedInput: 0.125 },
  'report-model': { input: 0.25, output: 2 },
};
const modelFor = (stage) => (stage === 'synthesis' ? 'report-model' : 'research-model');

/* ── the rate table ──────────────────────────────────────────────────── */

test('rates come from configuration, not from the code', () => {
  // A hardcoded price goes stale without anything failing, and then produces
  // confident wrong numbers.
  const t = parseRateTable('{"m":{"input":1.5,"output":6,"cachedInput":0.15}}');
  assert.deepEqual(t.m, { input: 1.5, output: 6, cachedInput: 0.15 });
});

test('a broken rate table yields no rates, never a default price', () => {
  for (const bad of [null, undefined, '', 'not json', '[]', '{"m":"free"}', '{"m":{}}']) {
    assert.deepEqual(parseRateTable(bad), {}, `${String(bad)} produced a rate`);
  }
});

/* ── pricing a stage ─────────────────────────────────────────────────── */

test('cached input is billed once, at the cached rate', () => {
  // The provider reports cached_tokens as a SUBSET of input_tokens. Pricing
  // both at the full rate would overstate every reused prompt — and make the
  // reuse work look like it had achieved nothing.
  const s = priceStage('official_collection', REAL_USAGE.official_collection, 'research-model', RATES);
  const fresh = 20004 - 4370;
  const expected =
    (fresh / 1_000_000) * 1.25 + (4370 / 1_000_000) * 0.125 + (1744 / 1_000_000) * 10;
  assert.equal(s.cachedInputTokens, 4370);
  assert.ok(Math.abs(s.costUsd - expected) < 1e-9, `${s.costUsd} !== ${expected}`);
  assert.equal(s.priced, true);
});

test('a model with no cached rate bills cached input at the full rate', () => {
  // The conservative reading, never the cheaper one we would prefer.
  const usage = { input_tokens: 1000, output_tokens: 0, total_tokens: 1000, input_tokens_details: { cached_tokens: 400 } };
  const s = priceStage('synthesis', usage, 'report-model', RATES);
  assert.ok(Math.abs(s.costUsd - (1000 / 1_000_000) * 0.25) < 1e-12);
});

test('an unpriced model records the tokens and no dollars', () => {
  // Tokens are the fact; dollars are the interpretation. A COGS figure
  // invented from a plausible-looking rate is worse than a visible gap,
  // because it stops anyone asking.
  const s = priceStage('identity', REAL_USAGE.identity, 'a-model-nobody-priced', {});
  assert.equal(s.costUsd, 0);
  assert.equal(s.priced, false);
  assert.equal(s.totalTokens, 41448);
  assert.equal(s.inputTokens, 37624);
});

test('a stage that did not run is not a stage that cost nothing', () => {
  // Null must not become a zero-cost row: that is a claim about spend.
  for (const nothing of [null, undefined, {}, 'x', 0]) {
    assert.equal(priceStage('identity', nothing, 'research-model', RATES), null);
  }
});

test('cached tokens can never exceed the input they are part of', () => {
  // Defends against a provider field that disagrees with itself; without the
  // clamp, fresh input goes negative and the stage prices below zero.
  const usage = { input_tokens: 100, output_tokens: 10, total_tokens: 110, input_tokens_details: { cached_tokens: 999 } };
  const s = priceStage('market', usage, 'research-model', RATES);
  assert.equal(s.cachedInputTokens, 100);
  assert.ok(s.costUsd > 0);
});

/* ── a whole verification ────────────────────────────────────────────── */

test('every stage of a real run is priced, on the model that ran it', () => {
  // The stages do not share a model: the research runs on one and the report
  // is written by another. Pricing them as one misattributes the expensive
  // half.
  const stages = priceVerification(REAL_USAGE, modelFor, RATES);
  assert.equal(stages.length, 5);
  assert.deepEqual(
    stages.map((s) => s.stage).sort(),
    ['identity', 'market', 'official_collection', 'public_research', 'synthesis']
  );
  assert.equal(stages.find((s) => s.stage === 'synthesis').model, 'report-model');
  assert.equal(stages.find((s) => s.stage === 'identity').model, 'research-model');
});

test('the total is the sum, and says whether it is complete', () => {
  const t = totalVerificationCost(priceVerification(REAL_USAGE, modelFor, RATES));
  assert.equal(t.totalTokens, 41448 + 21748 + 57263 + 40252 + 25698);
  assert.equal(t.cachedInputTokens, 4370 * 3);
  assert.equal(t.fullyPriced, true);
  assert.ok(t.totalUsd > 0);
  // Sanity against the real shape of a run: five stages, ~186k tokens. At
  // these illustrative rates that is cents, not dollars — the assertion is
  // on the arithmetic, not on any claim about the real rate.
  const summed = t.stages.reduce((a, s) => a + s.costUsd, 0);
  assert.ok(Math.abs(t.totalUsd - summed) < 1e-8);
});

test('one unpriced stage makes the whole figure incomplete', () => {
  // A total that silently omits a stage reads as a cheaper job.
  const partial = priceVerification(REAL_USAGE, modelFor, { 'research-model': RATES['research-model'] });
  const t = totalVerificationCost(partial);
  assert.equal(t.fullyPriced, false, 'an unpriced stage was reported as a complete figure');
  assert.ok(t.totalUsd > 0, 'the priced stages were discarded along with the unpriced one');
});

test('no usage at all is an empty answer, not a zero-cost verification', () => {
  for (const nothing of [null, undefined, {}, 'x']) {
    const t = totalVerificationCost(priceVerification(nothing, modelFor, RATES));
    assert.equal(t.stages.length, 0);
    assert.equal(t.fullyPriced, false, 'a job with no usage claimed a complete cost figure');
  }
});

test('a fraction of a cent is not rounded away to free', () => {
  const usage = { input_tokens: 100, output_tokens: 1, total_tokens: 101 };
  const s = priceStage('identity', usage, 'research-model', RATES);
  assert.ok(s.costUsd > 0, 'a real but tiny cost was recorded as zero');
});

/* ── how it is recorded ──────────────────────────────────────────────── */

test('a stage maps to a stable, searchable operation name', () => {
  assert.equal(costOperationFor('official_collection'), 'VERIFY_OFFICIAL_COLLECTION');
  assert.equal(costOperationFor('synthesis'), 'VERIFY_SYNTHESIS');
  assert.equal(costOperationFor('public research'), 'VERIFY_PUBLIC_RESEARCH');
});

/* ── how it is wired ─────────────────────────────────────────────────── */

const agent = () =>
  readFileSync(join(process.cwd(), 'supabase', 'functions', 'research-agent', 'index.ts'), 'utf8')
    .split('\r\n')
    .join('\n');

test('the cost is recorded against the job, one row per stage', () => {
  const src = agent();
  const i = src.indexOf('async function recordVerificationCost');
  assert.ok(i > 0, 'nothing records what a verification cost');
  const fn = src.slice(i, src.indexOf('\nfunction sanitizeForCustomer', i));

  assert.match(fn, /job_id: job\.id/, 'the spend is not linked to the job that spent it');
  // One row per stage: "the synthesis is cheap and the public research is
  // not" is the finding that makes any of this actionable, and a single
  // total hides it.
  assert.match(fn, /stages\.map\(/, 'the stages are collapsed into one row');
  assert.match(fn, /cache_hit: s\.cachedInputTokens > 0/, 'cached tokens are not recorded');
});

test('bookkeeping can never cost a customer their report', () => {
  // Fails loudly into the logs and quietly for the customer: a verification
  // they paid for must not be lost because an insert failed.
  const src = agent();
  const i = src.indexOf('async function recordVerificationCost');
  const fn = src.slice(i, i + 3500);
  assert.match(fn, /try \{/, 'the recorder can throw into the completion path');
  assert.match(fn, /catch \(e\)/, 'the recorder has no catch');
  // And the job is written BEFORE the accounting runs.
  const iSave = src.indexOf("const finished = await sb.from('research_jobs').update({ status: 'COMPLETE'");
  const iCost = src.indexOf('await recordVerificationCost(sb,');
  assert.ok(iSave > 0 && iCost > iSave, 'the cost is recorded before the report is saved');
});

test('a re-driven job does not double-count', () => {
  // A resumed or re-driven job reaches completion more than once.
  const src = agent();
  const i = src.indexOf('async function recordVerificationCost');
  const fn = src.slice(i, i + 2000);
  assert.match(fn, /count: 'exact', head: true/, 'nothing checks whether this job was already recorded');
  assert.match(fn, /if \(\(count \?\? 0\) > 0\) return;/, 'a second completion records the cost again');
});

test('an unconfigured rate is marked, so a zero is never read as free', () => {
  const src = agent();
  assert.ok(src.includes('unpriced'), 'an unpriced stage is indistinguishable from a free one');
});
