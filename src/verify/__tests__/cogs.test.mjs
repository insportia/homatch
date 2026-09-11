// What a verification costs us, and what we refuse to make up.
//
// The usage block below is copied verbatim from a real completed production
// job. Every number in it is what OpenAI actually reported for that run —
// including the cached_tokens, which are the whole reason reuse is worth
// measuring.
//
// The rates are illustrative and deliberately NOT the real ones. Nothing here
// asserts what a supplier charges; it asserts that the arithmetic is right,
// that a missing rate never becomes a guess, and that a price has a date.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PRICE_UNITS,
  resolveRate,
  priceStage,
  priceVerification,
  totalVerificationCost,
  consumptionFromUsage,
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

const FROM = '2026-01-01T00:00:00Z';
const AT = '2026-06-01T00:00:00Z';

/** Illustrative rates, in the exact shape provider_price_book stores. */
const ROWS = [
  { provider: 'OPENAI', model: 'research-model', unit: 'INPUT_TOKEN', rate: 1.25, per_units: 1000000, currency: 'USD', effective_from: FROM, effective_to: null },
  { provider: 'OPENAI', model: 'research-model', unit: 'CACHED_INPUT_TOKEN', rate: 0.125, per_units: 1000000, currency: 'USD', effective_from: FROM, effective_to: null },
  { provider: 'OPENAI', model: 'research-model', unit: 'OUTPUT_TOKEN', rate: 10, per_units: 1000000, currency: 'USD', effective_from: FROM, effective_to: null },
  { provider: 'OPENAI', model: 'report-model', unit: 'INPUT_TOKEN', rate: 0.25, per_units: 1000000, currency: 'USD', effective_from: FROM, effective_to: null },
  { provider: 'OPENAI', model: 'report-model', unit: 'OUTPUT_TOKEN', rate: 2, per_units: 1000000, currency: 'USD', effective_from: FROM, effective_to: null },
  // Provider-wide: a per-request search charge that does not vary by model.
  { provider: 'OPENAI', model: null, unit: 'WEB_SEARCH_CALL', rate: 0.01, per_units: 1, currency: 'USD', effective_from: FROM, effective_to: null },
];

const ctx = (rows = ROWS, at = AT) => ({ provider: 'OPENAI', rows, at });
const modelFor = (stage) => (stage === 'synthesis' ? 'report-model' : 'research-model');

/* ── resolving a rate ────────────────────────────────────────────────── */

test('a rate is resolved for the moment the spend happened', () => {
  // Re-pricing last month's jobs at this month's rate quietly rewrites
  // history, which is the reason the price book is effective-dated at all.
  const rows = [
    { provider: 'OPENAI', model: 'm', unit: 'INPUT_TOKEN', rate: 1, per_units: 1, effective_from: '2026-01-01T00:00:00Z', effective_to: '2026-06-01T00:00:00Z' },
    { provider: 'OPENAI', model: 'm', unit: 'INPUT_TOKEN', rate: 2, per_units: 1, effective_from: '2026-06-01T00:00:00Z', effective_to: null },
  ];
  const q = (at) => resolveRate(rows, { provider: 'OPENAI', model: 'm', unit: 'INPUT_TOKEN', at })?.rate;
  assert.equal(q('2026-03-01T00:00:00Z'), 1, 'a March job was not priced at the March rate');
  assert.equal(q('2026-09-01T00:00:00Z'), 2);
  // The period is half-open, matching the database constraint: a rate that
  // ends the instant its replacement begins is unambiguous, not briefly both.
  assert.equal(q('2026-06-01T00:00:00Z'), 2, 'the boundary resolved to the old rate');
});

test('a moment before any rate existed has no rate', () => {
  assert.equal(resolveRate(ROWS, { provider: 'OPENAI', model: 'research-model', unit: 'INPUT_TOKEN', at: '2025-01-01T00:00:00Z' }), null);
});

test('a rate for the exact model beats a provider-wide one', () => {
  const rows = [
    { provider: 'OPENAI', model: null, unit: 'INPUT_TOKEN', rate: 99, per_units: 1, effective_from: FROM },
    { provider: 'OPENAI', model: 'm', unit: 'INPUT_TOKEN', rate: 1, per_units: 1, effective_from: FROM },
  ];
  assert.equal(resolveRate(rows, { provider: 'OPENAI', model: 'm', unit: 'INPUT_TOKEN', at: AT }).rate, 1);
  // And a provider-wide charge still applies to a model with no rate of its own.
  assert.equal(resolveRate(rows, { provider: 'OPENAI', model: 'other', unit: 'INPUT_TOKEN', at: AT }).rate, 99);
});

test('a rate for another provider is never borrowed', () => {
  assert.equal(resolveRate(ROWS, { provider: 'APIFY', model: 'research-model', unit: 'INPUT_TOKEN', at: AT }), null);
});

test('an empty or missing price book resolves nothing', () => {
  for (const rows of [null, undefined, []]) {
    assert.equal(resolveRate(rows, { provider: 'OPENAI', model: 'm', unit: 'INPUT_TOKEN', at: AT }), null);
  }
});

/* ── pricing a stage ─────────────────────────────────────────────────── */

test('cached input is billed once, at the cached rate', () => {
  // The provider reports cached_tokens as a SUBSET of input_tokens. Pricing
  // both at the full rate would overstate every reused prompt — and make the
  // reuse work look like it had achieved nothing.
  const s = priceStage(
    { stage: 'official_collection', model: 'research-model', usage: REAL_USAGE.official_collection },
    ctx()
  );
  const fresh = 20004 - 4370;
  const expected = (fresh / 1e6) * 1.25 + (4370 / 1e6) * 0.125 + (1744 / 1e6) * 10;
  assert.equal(s.cachedInputTokens, 4370);
  assert.ok(Math.abs(s.modelCostUsd - expected) < 1e-8, `${s.modelCostUsd} !== ${expected}`);
  assert.equal(s.priced, true);
});

test('the cache saving is the measured difference between two known rates', () => {
  const s = priceStage(
    { stage: 'market', model: 'research-model', usage: REAL_USAGE.market },
    ctx()
  );
  const expected = (4370 / 1e6) * 1.25 - (4370 / 1e6) * 0.125;
  assert.ok(Math.abs(s.cacheSavingUsd - expected) < 1e-8);
});

test('an unmeasurable saving is reported as nothing, not as zero saved', () => {
  // report-model has no cached rate here, so there is no difference to
  // measure. Reporting a number would be inventing one.
  const s = priceStage(
    { stage: 'synthesis', model: 'report-model', usage: { input_tokens: 1000, output_tokens: 0, total_tokens: 1000, input_tokens_details: { cached_tokens: 400 } } },
    ctx()
  );
  assert.equal(s.cacheSavingUsd, 0);
  // And cached input falls back to the full input rate, which is the
  // conservative reading rather than the cheaper one we would prefer.
  assert.ok(Math.abs(s.modelCostUsd - (1000 / 1e6) * 0.25) < 1e-12);
});

test('a web search is charged per call, from a provider-wide rate', () => {
  const s = priceStage(
    { stage: 'public_research', model: 'research-model', usage: REAL_USAGE.public_research, webSearches: 4 },
    ctx()
  );
  assert.equal(s.webSearches, 4);
  assert.ok(Math.abs(s.searchCostUsd - 0.04) < 1e-9);
  assert.ok(s.costUsd > s.modelCostUsd, 'the search cost is missing from the total');
});

test('reasoning tokens are only charged when separately billed', () => {
  // Where a provider folds reasoning into output, the tokens are already
  // inside output_tokens and pricing both double-charges every run.
  const without = priceStage({ stage: 'identity', model: 'research-model', usage: REAL_USAGE.identity }, ctx());
  assert.equal(without.reasoningTokens, 2967);
  assert.equal(without.priced, true, 'unbilled reasoning was reported as a pricing gap');

  const withRate = priceStage(
    { stage: 'identity', model: 'research-model', usage: REAL_USAGE.identity },
    ctx([...ROWS, { provider: 'OPENAI', model: 'research-model', unit: 'REASONING_TOKEN', rate: 5, per_units: 1000000, effective_from: FROM }])
  );
  assert.ok(withRate.modelCostUsd > without.modelCostUsd, 'a separate reasoning rate was ignored');
});

test('an unpriced dimension is named, and contributes nothing', () => {
  // Tokens are the fact; dollars are the interpretation. A COGS figure
  // invented from a plausible-looking rate is worse than a visible gap,
  // because it stops anyone asking.
  const s = priceStage(
    { stage: 'identity', model: 'a-model-nobody-priced', usage: REAL_USAGE.identity },
    ctx()
  );
  assert.equal(s.modelCostUsd, 0);
  assert.equal(s.priced, false);
  assert.deepEqual(s.unpricedUnits.sort(), ['INPUT_TOKEN', 'OUTPUT_TOKEN']);
  assert.equal(s.totalTokens, 41448, 'the consumption was lost along with the price');
});

test('a stage that did not run is not a stage that cost nothing', () => {
  for (const usage of [null, undefined, {}, 'x', 0]) {
    assert.equal(priceStage({ stage: 'identity', model: 'research-model', usage }, ctx()), null);
  }
});

test('a stage that only searched is still a stage', () => {
  const s = priceStage({ stage: 'market', model: 'research-model', usage: null, webSearches: 2 }, ctx());
  assert.ok(s, 'a stage with searches and no tokens vanished');
  assert.ok(Math.abs(s.searchCostUsd - 0.02) < 1e-9);
});

test('cached tokens can never exceed the input they are part of', () => {
  // Without the clamp, fresh input goes negative and the stage prices below
  // zero — a provider field that disagrees with itself becomes a credit.
  const s = priceStage(
    { stage: 'market', model: 'research-model', usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110, input_tokens_details: { cached_tokens: 999 } } },
    ctx()
  );
  assert.equal(s.cachedInputTokens, 100);
  assert.ok(s.costUsd > 0);
});

test('a fraction of a cent is not rounded away to free', () => {
  const s = priceStage({ stage: 'identity', model: 'research-model', usage: { input_tokens: 100, output_tokens: 1, total_tokens: 101 } }, ctx());
  assert.ok(s.costUsd > 0, 'a real but tiny cost was recorded as zero');
});

/* ── a whole verification ────────────────────────────────────────────── */

test('every stage of a real run is priced, on the model that ran it', () => {
  // The stages do not share a model: the research runs on one and the report
  // is written by another. Pricing them as one misattributes the expensive
  // half.
  const stages = priceVerification(consumptionFromUsage(REAL_USAGE, modelFor), ctx());
  assert.equal(stages.length, 5);
  assert.equal(stages.find((s) => s.stage === 'synthesis').model, 'report-model');
  assert.equal(stages.find((s) => s.stage === 'identity').model, 'research-model');
});

test('the total separates model spend from search spend', () => {
  const stages = priceVerification(
    consumptionFromUsage(REAL_USAGE, modelFor, (s) => (s === 'public_research' ? 5 : 0)),
    ctx()
  );
  const t = totalVerificationCost(stages);
  assert.equal(t.totalTokens, 41448 + 21748 + 57263 + 40252 + 25698);
  assert.equal(t.cachedInputTokens, 4370 * 3);
  assert.equal(t.webSearches, 5);
  assert.ok(Math.abs(t.searchCostUsd - 0.05) < 1e-9);
  assert.ok(Math.abs(t.totalUsd - (t.modelCostUsd + t.searchCostUsd)) < 1e-8);
  assert.equal(t.state, 'PRICED');
  assert.ok(t.cacheSavingUsd > 0, 'the measured cache saving was lost in the total');
});

test('one unpriced dimension makes the whole figure partial, and says which', () => {
  // A total that silently omits a stage reads as a cheaper job.
  const rows = ROWS.filter((r) => r.model !== 'report-model');
  const t = totalVerificationCost(priceVerification(consumptionFromUsage(REAL_USAGE, modelFor), ctx(rows)));
  assert.equal(t.state, 'PARTIALLY_PRICED');
  assert.ok(t.unpricedUnits.length, 'the gap is not actionable — nothing says what is missing');
  assert.ok(t.totalUsd > 0, 'the priced stages were discarded along with the unpriced one');
});

test('with no price book at all the state is UNPRICED, never $0.00', () => {
  const t = totalVerificationCost(priceVerification(consumptionFromUsage(REAL_USAGE, modelFor), ctx([])));
  assert.equal(t.state, 'UNPRICED');
  assert.equal(t.totalUsd, 0);
  assert.ok(t.totalTokens > 0, 'usage was thrown away because it could not be priced');
});

test('no usage at all is an empty answer, not a zero-cost verification', () => {
  for (const nothing of [null, undefined, {}, 'x']) {
    const t = totalVerificationCost(priceVerification(consumptionFromUsage(nothing, modelFor), ctx()));
    assert.equal(t.stages.length, 0);
    assert.equal(t.state, 'UNPRICED', 'a job with no usage claimed a real cost figure');
  }
});

/* ── how it is recorded ──────────────────────────────────────────────── */

test('a stage maps to a stable, searchable operation name', () => {
  assert.equal(costOperationFor('official_collection'), 'VERIFY_OFFICIAL_COLLECTION');
  assert.equal(costOperationFor('synthesis'), 'VERIFY_SYNTHESIS');
  assert.equal(costOperationFor('public research'), 'VERIFY_PUBLIC_RESEARCH');
});

/* ── the rates are not in the source ─────────────────────────────────── */

const cogsSource = () => readFileSync(join(process.cwd(), 'src', 'verify', 'cogs.ts'), 'utf8');

test('no supplier rate is hardcoded in the pricing module', () => {
  // A price in source goes stale without anything failing and then produces
  // confident wrong numbers. The price book is the only authority.
  const src = cogsSource();
  assert.ok(!/OPENAI_TOKEN_PRICES/.test(src), 'rates are read from an environment variable again');
  assert.ok(!/gpt-[\w.-]+['"]?\s*:/.test(src), 'a model name is priced in source');
});

test('the price book carries every dimension a supplier might bill', () => {
  for (const unit of ['INPUT_TOKEN', 'CACHED_INPUT_TOKEN', 'OUTPUT_TOKEN', 'REASONING_TOKEN', 'WEB_SEARCH_CALL', 'TOOL_CALL', 'PROVIDER_CALL']) {
    assert.ok(PRICE_UNITS.includes(unit), `${unit} cannot be priced`);
  }
});

test('the migration states what a rate is, and that only one applies at a time', () => {
  const sql = readFileSync(
    join(process.cwd(), 'supabase', 'migrations', '20260911220000_provider_price_book.sql'),
    'utf8'
  );
  for (const column of ['provider', 'model', 'unit', 'rate', 'per_units', 'currency', 'effective_from', 'effective_to', 'source', 'updated_at']) {
    assert.ok(new RegExp(`\\b${column}\\b`).test(sql), `the price book has no ${column}`);
  }
  // Two overlapping rates mean the cost of a job depends on which row the
  // query happened to pick, and a total that changes between two identical
  // reads is worse than no total.
  assert.match(sql, /exclude using gist/, 'overlapping rates are possible');
  assert.match(sql, /tstzrange\(effective_from, effective_to, '\[\)'\)/);
  // And nobody but an admin may read what we pay.
  assert.match(sql, /price_book_admin_read/);
  assert.ok(!/to anon/.test(sql), 'the price book is exposed to anonymous callers');
});

/* ── how it is wired into the orchestrator ───────────────────────────── */

const agent = () =>
  readFileSync(join(process.cwd(), 'supabase', 'functions', 'research-agent', 'index.ts'), 'utf8')
    .split('\r\n')
    .join('\n');

test('searches are counted from the response, not from our intent', () => {
  // What we asked for and what the provider did are different numbers, and
  // only the second one is billed.
  const src = agent();
  assert.match(src, /function countWebSearches/, 'nothing counts web searches');
  assert.match(src, /item\?\.type === 'web_search_call'/, 'searches are counted from something other than the response');
  assert.match(src, /prior\._searches = /, 'the count is never persisted per stage');
  assert.match(src, /webSearchCalls: prior\._searches/, 'the count never reaches the finished report');
});

test('the search count is stripped at the customer boundary, like the token usage', () => {
  const src = agent();
  assert.match(src, /delete r\.webSearchCalls;/, 'how many searches we ran reaches the customer');
  assert.match(src, /delete r\._searches;/);
});

test('the recorder prices from the book, at the date the job completed', () => {
  const src = agent();
  const i = src.indexOf('async function recordVerificationCost');
  const fn = src.slice(i, src.indexOf('\nfunction sanitizeForCustomer', i));
  assert.match(fn, /from\('provider_price_book'\)/, 'rates no longer come from the price book');
  assert.match(fn, /const at = job\?\.completed_at/, 'history is re-priced at today\'s rate');
  assert.ok(!/parseRateTable/.test(fn), 'rates are read from an environment variable again');
  assert.match(fn, /job_id: job\.id/, 'the spend is not linked to the job that spent it');
  assert.match(fn, /unpriced=/, 'an unpriced dimension is indistinguishable from a free one');
});

test('bookkeeping can never cost a customer their report', () => {
  const src = agent();
  const i = src.indexOf('async function recordVerificationCost');
  const fn = src.slice(i, i + 4500);
  assert.match(fn, /try \{/);
  assert.match(fn, /catch \(e\)/);
  const iSave = src.indexOf("const finished = await sb.from('research_jobs').update({ status: 'COMPLETE'");
  const iCost = src.indexOf('await recordVerificationCost(sb,');
  assert.ok(iSave > 0 && iCost > iSave, 'the cost is recorded before the report is saved');
});

test('a missing price book degrades to unpriced, it does not fail the job', () => {
  const src = agent();
  const i = src.indexOf('async function recordVerificationCost');
  const fn = src.slice(i, i + 4500);
  assert.match(fn, /price book unavailable/, 'a price-book failure is silent');
  assert.ok(!/if \(priceError\) return/.test(fn), 'a price-book failure discards the usage too');
});

test('a re-driven job does not double-count', () => {
  const src = agent();
  const i = src.indexOf('async function recordVerificationCost');
  const fn = src.slice(i, i + 2000);
  assert.match(fn, /count: 'exact', head: true/);
  assert.match(fn, /if \(\(count \?\? 0\) > 0\) return;/, 'a second completion records the cost again');
});
