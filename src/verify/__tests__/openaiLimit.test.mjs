// openaiLimit.test.mjs — OpenAI under load (Verify at scale, owner 2026-10-24). The shared budget's SQL is proven on
// PGlite by scripts/verify/openai-rate-db-check.mjs; this covers Retry-After, backoff, limits and the wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { retryAfterMs, backoffMs, estimateTokens, limitsFor, awaitOpenAIBudget, RETRY_AFTER_CAP_MS, RETRYABLE_STATUSES } from '../openaiLimit.ts';

const code = (p) => readFileSync(fileURLToPath(new URL(`../../../${p}`, import.meta.url)), 'utf8');
const h = (o) => ({ get: (k) => o[k] ?? null });

test('Retry-After: ms header first, then seconds, then an HTTP date; capped; absent is null', () => {
  assert.equal(retryAfterMs(h({ 'retry-after-ms': '1500', 'retry-after': '9' })), 1500);
  assert.equal(retryAfterMs(h({ 'retry-after': '4' })), 4000);
  assert.equal(retryAfterMs(h({ 'retry-after': '3600' })), RETRY_AFTER_CAP_MS);
  assert.equal(retryAfterMs(h({ 'retry-after': new Date(10_000).toUTCString() }), 7_000), 3000);
  assert.equal(retryAfterMs(h({})), null);
  assert.equal(retryAfterMs(null), null);
  assert.equal(RETRYABLE_STATUSES.has(429) && RETRYABLE_STATUSES.has(503) && !RETRYABLE_STATUSES.has(400), true);
});

test('backoff doubles with ±25% jitter and is capped', () => {
  assert.equal(backoffMs(0, () => 0.5), 1000);
  assert.equal(backoffMs(3, () => 0.5), 8000);
  assert.equal(backoffMs(30, () => 0.5), 20_000);
  assert.equal(backoffMs(1, () => 0), 1500);
  assert.equal(backoffMs(1, () => 1), 2500);
  assert.equal(estimateTokens('abc', null, 'def'), 2);
});

test('limits: per model or default; absent or zero means unlimited (behaviour unchanged until configured)', () => {
  assert.deepEqual(limitsFor({ 'gpt-x': { rpm: 500, tpm: 200000 } }, 'gpt-x'), { rpm: 500, tpm: 200000 });
  assert.deepEqual(limitsFor({ default: { rpm: 60 } }, 'other'), { rpm: 60, tpm: 0 });
  assert.equal(limitsFor(null, 'gpt-x'), null);
  assert.equal(limitsFor({ 'gpt-x': { rpm: 0, tpm: -1 } }, 'gpt-x'), null);
});

test('the budget waits as told, gives up after its cap, and never blocks when unconfigured or unreadable', async () => {
  const waits = [];
  const answers = [15, 20, 0];
  const db = { rpc: async () => ({ data: answers.shift(), error: null }) };
  assert.equal(await awaitOpenAIBudget(db, 'm', 10, { rpm: 1, tpm: 0 }, 1000, async (ms) => { waits.push(ms); }), 35);
  assert.deepEqual(waits, [15, 20]);
  const full = { rpc: async () => ({ data: 50_000, error: null }) };
  assert.equal(await awaitOpenAIBudget(full, 'm', 10, { rpm: 1, tpm: 0 }, 1000, async () => {}), 0, 'over the cap: the provider decides');
  assert.equal(await awaitOpenAIBudget(db, 'm', 10, null), 0);
  assert.equal(await awaitOpenAIBudget({ rpc: async () => ({ data: null, error: { message: 'missing' } }) }, 'm', 10, { rpm: 1, tpm: 0 }), 0);
});

test('wiring: both functions reserve, honour Retry-After, and an exhausted report build fails instead of shipping', () => {
  const ra = code('supabase/functions/research-agent/index.ts');
  assert.match(ra, /await awaitOpenAIBudget\(db, model, estimateTokens\(init\.body\) \+ 8000/);
  assert.match(ra, /retryAfterMs\(r\.headers\) \?\? backoffMs\(i\)/);
  const vs = code('supabase/functions/verify-synthesis/index.ts');
  assert.match(vs, /await awaitOpenAIBudget\(writer as any, model, estimateTokens\(system, user\)/);
  assert.match(vs, /SYNTHESIS_TRANSIENT_UNAVAILABLE/);
  const callReport = vs.slice(vs.indexOf('callReport = async'), vs.indexOf('callReport = async') + 4000);
  assert.doesNotMatch(callReport.slice(0, callReport.indexOf('} catch (e) {\n        const reason')), /console\.error\(reason\);\n\s+return null;/, 'a 429/5xx no longer degrades silently');
  const sql = code('supabase/migrations/20261205095000_openai_rate_budget.sql');
  assert.match(sql, /grant execute on function public\.openai_rate_reserve\(text, integer, integer, integer\) to service_role/);
});
