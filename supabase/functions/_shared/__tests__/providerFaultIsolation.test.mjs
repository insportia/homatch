// PROVIDER FAULT ISOLATION — a provider that hangs or fails in transit must end in
// HOMATCH's own error path, never in a duplicate external object or a platform kill.
//
//   - Meta Graph: a write that failed in transit may already exist at Meta, and the
//     creating POSTs are not idempotent, so writes are not retried unless the caller
//     says the write is safe to repeat (a status change, a content-addressed image).
//     Reads keep their retries. Every Graph call is bounded by a timeout.
//   - homatch-ai / homatch-research: the OpenAI call is bounded below the platform's
//     150 s response limit, so a hang reaches the code that gives the credit hold back.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.Deno ??= { env: { get: () => undefined } };
const { graph } = await import('../metaAds.ts');

function stubFetch(responder) {
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', signal: init.signal ?? null });
    return responder(calls.length);
  };
  return calls;
}
const networkError = () => { throw new TypeError('connection reset'); };
const serverError = () => new Response(JSON.stringify({ error: { message: 'Service temporarily unavailable', code: 2, is_transient: true } }), { status: 503 });

test('a creating POST that fails in transit is sent once (no duplicate campaign, ad set, creative or ad)', async () => {
  for (const fail of [networkError, serverError]) {
    const calls = stubFetch(fail);
    await assert.rejects(graph('/act_1/campaigns', { token: 't', method: 'POST', body: { name: 'x' } }));
    assert.equal(calls.length, 1, `${fail.name}: one request only`);
  }
});

test('reads keep their bounded retries', async () => {
  const calls = stubFetch(networkError);
  await assert.rejects(graph('/act_1/campaigns?fields=id', { token: 't' }));
  assert.equal(calls.length, 3);
  const ok = stubFetch((n) => (n < 2 ? serverError() : new Response('{"id":"1"}', { status: 200 })));
  assert.deepEqual(await graph('/1?fields=id', { token: 't' }), { id: '1' });
  assert.equal(ok.length, 2);
});

test('a write the caller marks as safe to repeat is retried', async () => {
  const calls = stubFetch((n) => (n < 3 ? serverError() : new Response('{"success":true}', { status: 200 })));
  assert.deepEqual(await graph('/123', { token: 't', method: 'POST', body: { status: 'ACTIVE' }, attempts: 3 }), { success: true });
  assert.equal(calls.length, 3);
});

test('every Graph request carries a timeout signal', async () => {
  const calls = stubFetch(() => new Response('{}', { status: 200 }));
  await graph('/1?fields=id', { token: 't' });
  await graph('/1', { token: 't', method: 'POST', body: { status: 'PAUSED' } });
  for (const c of calls) assert.ok(c.signal instanceof AbortSignal, `${c.method} has a signal`);
});

test('the idempotent Meta writes keep retries; the creating ones do not', () => {
  const engine = readFileSync(new URL('../../meta-ads-api/engine.ts', import.meta.url), 'utf8');
  assert.match(engine, /body: \{ status: 'ACTIVE' \}, audit: auditCtx, attempts: 3 \}/, 'activation is a status change');
  for (const edge of ['/campaigns`', '/adsets`', '/adcreatives`', '/ads`']) {
    const at = engine.indexOf(edge);
    assert.ok(at > 0, edge);
    assert.doesNotMatch(engine.slice(at, at + 200), /attempts:/, `${edge} uses the write default (one attempt)`);
  }
  const shared = readFileSync(new URL('../metaAds.ts', import.meta.url), 'utf8');
  assert.match(shared, /\/adimages`, \{ \.\.\.opts, method: 'POST', body: \{ bytes: btoa\(binary\), name: filename \}, attempts: opts\.attempts \?\? 3 \}/,
    'image uploads are content-addressed');
  assert.doesNotMatch(shared.slice(shared.indexOf('/advideos`'), shared.indexOf('/advideos`') + 120), /attempts:/, 'a video upload creates a new video');
});

test('the credit-holding OpenAI calls end before the platform does, in the path that releases the hold', () => {
  const ai = readFileSync(new URL('../../homatch-ai/index.ts', import.meta.url), 'utf8');
  assert.match(ai, /const OPENAI_REQUEST_TIMEOUT_MS = 130_000;/);
  const call = ai.slice(ai.indexOf("fetch('https://api.openai.com/v1/responses'"));
  assert.match(call.slice(0, 600), /signal: AbortSignal\.timeout\(OPENAI_REQUEST_TIMEOUT_MS\)/);
  assert.match(call.slice(0, 2500), /catch \(err\) \{[\s\S]{0,300}releaseExecution\(sb, grant, 'PROVIDER_UNREACHABLE'\)/);

  const research = readFileSync(new URL('../../homatch-research/index.ts', import.meta.url), 'utf8');
  assert.match(research, /const PROVIDER_DEADLINE_MS = 130_000;/);
  const fn = research.slice(research.indexOf('async function callResearchProvider'), research.indexOf('serve(async'));
  assert.match(fn, /const deadline = Date\.now\(\) \+ PROVIDER_DEADLINE_MS;/, 'all attempts share one deadline');
  assert.match(fn, /if \(remaining < MIN_ATTEMPT_MS\) break;/);
  assert.match(fn, /signal: AbortSignal\.timeout\(remaining\)/);
  assert.match(research, /releaseExecution\(sb, grant, `provider_error_\$\{providerResult\.status \|\| 'network'\}`\)/, 'a failed call releases the hold');
});
