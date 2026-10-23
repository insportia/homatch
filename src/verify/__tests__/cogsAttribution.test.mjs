// Verify COGS attribution (VERIFY_V2_AUDIT F7), on the real numbers of prod
// job 61c1c38c and the real price book rows (2026-07-30):
//   gpt-5.6-terra  in $2/M   cached $0.2/M   out $12/M
//   gpt-5.6-luna   in $0.2/M cached $0.02/M  out $1.2/M
// research-agent's own SYNTHESIS stage ran on terra and was recorded at luna
// ($0.009468 instead of $0.094678); verify-synthesis' report ($0.027051) was
// never recorded. Job total with 2Captcha and APIFY: $0.952924, not $0.771163.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  priceStage, priceVerification, totalVerificationCost, consumptionFromUsage, costOperationFor,
  pricedModel, researchStageModel, reportConsumption, reportCostRequestId, REPORT_STAGE,
} from '../cogs.ts';

const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

const BOOK = [
  ['gpt-5.6-terra', 'INPUT_TOKEN', 2], ['gpt-5.6-terra', 'CACHED_INPUT_TOKEN', 0.2], ['gpt-5.6-terra', 'OUTPUT_TOKEN', 12],
  ['gpt-5.6-luna', 'INPUT_TOKEN', 0.2], ['gpt-5.6-luna', 'CACHED_INPUT_TOKEN', 0.02], ['gpt-5.6-luna', 'OUTPUT_TOKEN', 1.2],
].map(([model, unit, rate]) => ({ provider: 'OPENAI', model, unit, rate, per_units: 1_000_000, currency: 'USD', effective_from: '2026-07-30T00:00:00Z' }))
  .concat([{ provider: 'OPENAI', model: null, unit: 'WEB_SEARCH_CALL', rate: 10, per_units: 1000, currency: 'USD', effective_from: '2026-07-30T00:00:00Z' }]);
const ctx = (at = '2026-10-22T12:10:41.985Z') => ({ provider: 'OPENAI', rows: BOOK, at });
const close = (a, b, msg) => assert.ok(Math.abs(a - b) < 5e-7, `${msg}: ${a} vs ${b}`);

/** Verbatim costUsage of 61c1c38c. */
const USAGE = {
  market: { input_tokens: 56896, total_tokens: 68053, output_tokens: 11157, input_tokens_details: { cached_tokens: 4435, cache_write_tokens: 10564 }, output_tokens_details: { reasoning_tokens: 2450 } },
  identity: { input_tokens: 52952, total_tokens: 56689, output_tokens: 3737, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 7380 }, output_tokens_details: { reasoning_tokens: 2325 } },
  synthesis: { input_tokens: 20963, total_tokens: 25359, output_tokens: 4396, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 20960 }, output_tokens_details: { reasoning_tokens: 2588 } },
  public_research: { input_tokens: 34155, total_tokens: 38921, output_tokens: 4766, input_tokens_details: { cached_tokens: 4435, cache_write_tokens: 4393 }, output_tokens_details: { reasoning_tokens: 2664 } },
  official_collection: { input_tokens: 41365, total_tokens: 44614, output_tokens: 3249, input_tokens_details: { cached_tokens: 4435, cache_write_tokens: 36927 }, output_tokens_details: { reasoning_tokens: 1552 } },
};
const SEARCHES = { market: 5, identity: 6, synthesis: 0, public_research: 3, official_collection: 0 };
/** Verbatim synthesis_json._usage of 61c1c38c. */
const REPORT_USAGE = { model: 'gpt-5.6-luna', inputTokens: 53960, cachedTokens: 0, outputTokens: 13549 };

test('research-agent SYNTHESIS is priced at terra, the model that ran it: $0.094678 (was $0.009468 at luna)', () => {
  const model = researchStageModel('synthesis', null, 'gpt-5.6-terra');
  assert.equal(model, 'gpt-5.6-terra');
  const s = priceStage({ stage: 'synthesis', model, usage: USAGE.synthesis }, ctx());
  close(s.costUsd, 0.094678, 'terra synthesis');
  assert.equal(s.priced, true);
  // The old attribution, for the record: the same tokens at luna.
  close(priceStage({ stage: 'synthesis', model: 'gpt-5.6-luna', usage: USAGE.synthesis }, ctx()).costUsd, 0.0094678, 'old luna figure');
});

test('verify-synthesis report is its own stage at luna: $0.027051', () => {
  const c = reportConsumption(REPORT_USAGE, 'fallback-model');
  assert.equal(c.stage, REPORT_STAGE);
  assert.equal(c.model, 'gpt-5.6-luna');
  const [s] = priceVerification([c], ctx('2026-10-22T12:12:34.758Z'));
  close(s.costUsd, 0.027051, 'luna report');
  assert.equal(costOperationFor(REPORT_STAGE), 'VERIFY_REPORT');
  assert.equal(costOperationFor('synthesis'), 'VERIFY_SYNTHESIS', 'the existing operation name is kept');
});

test('cached tokens are a subset of input and priced at the cached rate (market: $0.239693 + 5 searches)', () => {
  const s = priceStage({ stage: 'market', model: 'gpt-5.6-terra', usage: USAGE.market, webSearches: 5 }, ctx());
  close(s.modelCostUsd, 0.239693, 'market tokens');
  close(s.searchCostUsd, 0.05, 'market searches');
  const r = reportConsumption({ model: 'gpt-5.6-luna', inputTokens: 1_000_000, cachedTokens: 400_000, outputTokens: 0 }, 'x');
  const [rc] = priceVerification([r], ctx());
  close(rc.costUsd, 600_000 * 0.2 / 1e6 + 400_000 * 0.02 / 1e6, 'report cached');
  // A cached count larger than the input can never price as negative fresh input.
  assert.equal(reportConsumption({ inputTokens: 10, cachedTokens: 99, outputTokens: 1 }, 'm').usage.input_tokens_details.cached_tokens, 10);
});

test('the whole OpenAI line of 61c1c38c: $0.883424 (= $0.743424 tokens + $0.14 searches); job with 2Captcha + APIFY $0.952924', () => {
  const stages = priceVerification([
    ...consumptionFromUsage(USAGE, (st) => researchStageModel(st, null, 'gpt-5.6-terra'), (st) => SEARCHES[st] ?? 0),
    reportConsumption(REPORT_USAGE, 'gpt-5.6-luna'),
  ], ctx());
  const t = totalVerificationCost(stages);
  assert.equal(t.state, 'PRICED');
  close(t.modelCostUsd, 0.743424, 'model');
  close(t.searchCostUsd, 0.14, 'search');
  close(t.totalUsd + 14 * 0.003 + 0.0275, 0.952924, 'all providers');
});

test('the model to price at: recorded > research model; a dated snapshot prices as its model', () => {
  assert.equal(pricedModel(undefined, 'gpt-5.6-terra'), 'gpt-5.6-terra');
  assert.equal(pricedModel('gpt-5.6-terra-2026-07-30', 'gpt-5.6-terra'), 'gpt-5.6-terra');
  assert.equal(pricedModel('gpt-5.6-luna', 'gpt-5.6-terra'), 'gpt-5.6-luna', 'a different model that ran is believed');
  assert.equal(researchStageModel('market', { market: 'gpt-5.6-luna' }, 'gpt-5.6-terra'), 'gpt-5.6-luna');
  assert.equal(researchStageModel('market_stopped', { market: 'gpt-5.6-luna' }, 'gpt-5.6-terra'), 'gpt-5.6-luna');
  assert.equal(researchStageModel('identity', { market: 'x' }, 'gpt-5.6-terra'), 'gpt-5.6-terra');
  assert.equal(reportConsumption(null, 'm'), null);
  assert.equal(reportConsumption({ model: 'x', inputTokens: 0, outputTokens: 0 }, 'm'), null, 'no call, no line');
  assert.equal(reportConsumption({ inputTokens: 5, outputTokens: 1 }, 'gpt-5.6-luna').model, 'gpt-5.6-luna');
});

test('one report row per build: job + attempt + claim time', () => {
  assert.equal(reportCostRequestId('j', 1, '2026-10-22T12:10:42Z'), 'verify_report:j:1:2026-10-22T12:10:42Z');
  assert.equal(reportCostRequestId('j', 1, '2026-10-22T12:10:42Z'), reportCostRequestId('j', 1, '2026-10-22T12:10:42Z'));
  assert.notEqual(reportCostRequestId('j', 1, 'a'), reportCostRequestId('j', 2, 'a'));
  assert.equal(reportCostRequestId('j', null, null), 'verify_report:j:0:unknown');
});

/* ── wiring ──────────────────────────────────────────────────────────── */

const agent = () => read('supabase/functions/research-agent/index.ts');
const recorder = () => { const s = agent(); const i = s.indexOf('async function recordVerificationCost'); return s.slice(i, s.indexOf('\nfunction sanitizeForCustomer', i)); };

test('research-agent prices every costUsage key at the research model (or what its response named), never the report model', () => {
  const fn = recorder();
  assert.match(fn, /\(stage\) => researchStageModel\(stage, stageModels, researchModel\)/);
  assert.doesNotMatch(fn, /reportModel|OPENAI_SYNTHESIS_MODEL/);
  assert.match(fn, /\.like\('operation_type', 'VERIFY_%'\)\s*\.neq\('operation_type', 'VERIFY_REPORT'\)/, 'the report row must not stop the research rows');
  const src = agent();
  assert.match(src, /prior\._models = \{ \.\.\.\(prior\._models \|\| \{\}\), \[s\.toLowerCase\(\)\]: typeof p\?\.model === 'string' \? p\.model : null \};/);
  assert.match(src, /costModels: prior\._models \?\? null,/);
  // Internal economics never reach a customer.
  assert.match(src, /delete r\._models;\s*delete r\.costModels;/);
  const inProgress = src.slice(src.indexOf('function stripInternalInProgress('), src.indexOf('function sanitizeForCustomer('));
  assert.match(inProgress, /delete r\._models;/);
});

test('verify-synthesis writes one VERIFY_REPORT cost_events row, after the report is saved, priced from the book', () => {
  const src = read('supabase/functions/verify-synthesis/index.ts');
  const fn = src.slice(src.indexOf('async function recordReportCost'), src.indexOf('A REPORT ALREADY WRITTEN CAN STILL BE WRONG'));
  assert.match(fn, /reportConsumption\(usage, MODEL\)/, 'the model that wrote the report');
  assert.match(fn, /from\('provider_price_book'\)/);
  assert.match(fn, /\.eq\('request_id', requestId\);\s*if \(\(count \?\? 0\) > 0\) return;/, 'checked before written');
  assert.match(fn, /provider: 'OPENAI',/, 'OPENAI: outside the customer meter (verify_job_cost counts non-OpenAI rows only)');
  assert.match(fn, /job_id: jobId,/);
  assert.match(fn, /error\.code !== '23505'/);
  assert.match(fn, /\} catch \(e\) \{/, 'bookkeeping never costs the report');
  assert.match(src, /await persist\(writer, jobId, payload\);\s*\/\/[^\n]*\n\s*await recordReportCost\(writer, jobId, usage, job\.synthesis_at \?\? null\);/);
  // The customer meter does not count OpenAI cost_events — so this row cannot change a charge.
  const meter = read('supabase/migrations/20261026100000_verify_credit_budget.sql');
  assert.match(meter, /where ce\.job_id = p_job_id and ce\.provider::text <> 'OPENAI'/);
});

test('the COGS views keep every existing column in order and append the breakdown; no customer billing object is touched', () => {
  const sql = read('supabase/migrations/20261120090100_verify_cogs_attribution.sql');
  const cols = (view) => {
    const body = sql.slice(sql.indexOf(`create or replace view public.${view} as`));
    const end = body.indexOf(';');
    const outer = body.slice(0, end);
    const sel = outer.slice(outer.lastIndexOf('\nselect') + 7, outer.lastIndexOf('\nfrom '));
    return sel.split('\n').map((l) => l.replace(/\/\*.*?\*\//g, '').trim()).filter((l) => l && !l.startsWith('/*') && !l.startsWith('*'))
      .join(' ').split(/,(?![^(]*\))/).map((c) => (c.match(/\bas\s+(\w+)\s*$/i)?.[1] ?? c.trim().split('.').pop().trim()));
  };
  assert.deepEqual(cols('verify_stage_cogs'), [
    'job_id', 'subject', 'completed_at', 'stage', 'model', 'input_tokens', 'cached_input_tokens', 'fresh_input_tokens',
    'output_tokens', 'reasoning_tokens', 'total_tokens', 'web_searches', 'model_cost_usd', 'search_cost_usd', 'price_state',
    'priced_at',
  ]);
  assert.deepEqual(cols('verify_job_cogs'), [
    'job_id', 'subject', 'completed_at', 'stages', 'total_tokens', 'cached_input_tokens', 'web_searches',
    'model_cost_usd', 'search_cost_usd', 'total_cogs_usd', 'total_cogs_cents', 'price_state',
    'ai_cost_usd', 'web_search_cost_usd', 'captcha_cost_usd', 'apify_cost_usd', 'other_provider_cost_usd', 'captcha_solves',
  ]);
  // research-agent's synthesis stage: research model unless recorded; the report from _usage.
  assert.match(sql, /when m\.recorded is null\s+or m\.recorded = 'gpt-5\.6-terra'/);
  assert.doesNotMatch(sql, /when s\.key = 'synthesis' then 'gpt-5\.6-luna'/);
  assert.match(sql, /'report'::text,/);
  assert.match(sql, /coalesce\(j\.synthesis_at, j\.completed_at\)/);
  // Captcha from the per-job ledger, providers from cost_events, OpenAI never twice.
  assert.match(sql, /from public\.verify_captcha_events ev\s+where ev\.job_id = a\.job_id/);
  assert.match(sql, /and ce\.provider::text <> 'OPENAI'/);
  // History is corrected on read: nothing written, nothing in the customer meter.
  const code = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
  assert.doesNotMatch(code, /\b(update|delete from|insert into)\s+public\.cost_events/i);
  assert.doesNotMatch(code, /public\.(verify_job_cost|verify_billing_open|verify_billing_close|verify_budget_policy|verify_billing\b)/i);
});
