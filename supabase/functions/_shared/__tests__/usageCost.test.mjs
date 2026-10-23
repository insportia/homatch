// Finance V2.1 recorder: every metered call records what the provider reported, priced from
// provider_price_book; a missing rate or missing usage is never booked as a real $0.
import test from 'node:test';
import assert from 'node:assert/strict';

const { tokenUsage, priceUsage, recordUsageCost, deferCost } = await import('../providerCost.ts');

/* Price book: gpt-4o-mini input 0.15/M, cached 0.075/M, output 0.60/M; nothing else. */
const RATES = { 'OPENAI|gpt-4o-mini|INPUT_TOKEN': 0.15e-6, 'OPENAI|gpt-4o-mini|CACHED_INPUT_TOKEN': 0.075e-6, 'OPENAI|gpt-4o-mini|OUTPUT_TOKEN': 0.6e-6, 'CARTESIA|sonic-3|CHARACTER': 65e-6 };
function fakeDb({ failWrite = false, duplicate = false } = {}) {
  const writes = [];
  return {
    writes,
    rpc: async (fn, a) => {
      assert.equal(fn, 'provider_estimated_cost_usd');
      const r = RATES[`${a.p_provider}|${a.p_model}|${a.p_unit}`];
      return { data: r == null ? null : r * a.p_units, error: null };
    },
    from: (t) => ({
      insert: async (row) => { writes.push({ t, row, mode: 'insert' }); return { error: failWrite ? { message: 'down' } : null }; },
      upsert: async (row, opts) => { if (!duplicate) writes.push({ t, row, mode: 'upsert', opts }); return { error: failWrite ? { message: 'down' } : null }; },
    }),
  };
}

test('tokenUsage reads Chat, Responses and Gemini usage; cached is a subset of input; none → null', () => {
  assert.deepEqual(tokenUsage({ usage: { prompt_tokens: 1991, completion_tokens: 430, prompt_tokens_details: { cached_tokens: 1000 } } }), { input: 1991, cached: 1000, output: 430 });
  assert.deepEqual(tokenUsage({ usage: { input_tokens: 500, output_tokens: 20, input_tokens_details: { cached_tokens: 900 } } }), { input: 500, cached: 500, output: 20 });
  assert.deepEqual(tokenUsage({ usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 40, thoughtsTokenCount: 10 } }), { input: 100, cached: 0, output: 50 });
  assert.equal(tokenUsage({ choices: [] }), null);
});

test('priced model: ESTIMATED; cached tokens priced at the cached rate, never twice', async () => {
  const r = await priceUsage(fakeDb(), { provider: 'OPENAI', operation: 'X', model: 'gpt-4o-mini', tokens: { input: 1991, cached: 1000, output: 430 } });
  assert.equal(r.pricing_state, 'ESTIMATED');
  assert.equal(r.cost_usd, Math.round((991 * 0.15e-6 + 1000 * 0.075e-6 + 430 * 0.6e-6) * 1e6) / 1e6);
});

test('unknown model: UNPRICED with cost 0 placeholder; never an invented estimate', async () => {
  const r = await priceUsage(fakeDb(), { provider: 'GEMINI', operation: 'X', model: 'gemini-2.0-flash', tokens: { input: 100, cached: 0, output: 40 } });
  assert.deepEqual([r.pricing_state, r.cost_usd], ['UNPRICED', 0]);
});

test('some dimensions priced, one not: PARTIAL (a floor, not a total)', async () => {
  const r = await priceUsage(fakeDb(), { provider: 'OPENAI', operation: 'X', model: 'gpt-4o-mini', tokens: { input: 1000, cached: 0, output: 0 }, dimensions: [{ unit: 'WEB_SEARCH_CALL', units: 2 }] });
  assert.equal(r.pricing_state, 'PARTIAL');
  assert.ok(r.cost_usd > 0);
});

test('no usage in the response: UNPRICED with units unknown — never an assumed token count', async () => {
  const r = await priceUsage(fakeDb(), { provider: 'OPENAI', operation: 'X', model: 'gpt-4o-mini', tokens: null });
  assert.deepEqual([r.pricing_state, r.unitsTotal], ['UNPRICED', null]);
});

test('a provider-reported dollar figure is ACTUAL', async () => {
  const r = await priceUsage(fakeDb(), { provider: 'OTHER', operation: 'X', actualUsd: 0.0123 });
  assert.deepEqual([r.pricing_state, r.cost_usd], ['ACTUAL', 0.0123]);
});

test('recordUsageCost: idempotency key → upsert ignoring duplicates; the row carries the evidence', async () => {
  const db = fakeDb();
  await recordUsageCost(db, { provider: 'CARTESIA', operation: 'AI_TALK_SPEAK', service: 'ai_talk', model: 'sonic-3', correlationId: 's1', idempotencyKey: 'aitalk:s1:speak:1', dimensions: [{ unit: 'CHARACTER', units: 400 }] });
  const w = db.writes[0];
  assert.equal(w.mode, 'upsert');
  assert.deepEqual(w.opts, { onConflict: 'idempotency_key', ignoreDuplicates: true });
  assert.equal(w.row.finance_service, 'ai_talk');
  assert.equal(w.row.correlation_id, 's1');
  assert.equal(w.row.pricing_state, 'ESTIMATED');
  assert.equal(w.row.cost_usd, 0.026);
});

test('recordUsageCost never throws: a failed write returns null and the request goes on', async () => {
  assert.equal(await recordUsageCost(fakeDb({ failWrite: true }), { provider: 'OPENAI', operation: 'X', model: 'gpt-4o-mini', tokens: { input: 1, cached: 0, output: 1 } }), null);
  deferCost(Promise.reject(new Error('boom'))); // must not raise an unhandled rejection
});
