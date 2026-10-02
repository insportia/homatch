// The render quote: computed by the server, signed, bound to its caller and
// request, refused when tampered with or expired; idempotency keys are stable.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  QUOTE_TTL_MS, quoteCredits, quoteMatches, quoteSecret, RENDER_PRICING, renderRowKey, reservationKey, signQuote, validIdempotencyKey, verifyQuote,
} from '../renderPricing.ts';

const SECRET = 'x'.repeat(48);
const claims = (over = {}) => ({
  v: 1, u: 'user-1', p: 'proj-1', ver: 'ver-1', product: 'DS_ROOM_RENDER', views: 3, credits: quoteCredits('DS_ROOM_RENDER', 3),
  charged: false, exp: Date.now() + QUOTE_TTL_MS, n: 'nonce', ...over,
});

test('prices are proposed, positive and per view; out-of-bounds view counts are refused', () => {
  assert.equal(RENDER_PRICING.status, 'PROPOSED');
  for (const p of ['DS_MASTER_RENDER', 'DS_ROOM_RENDER', 'DS_RENDER_EDIT']) assert.ok(RENDER_PRICING.creditsPerView[p] > 0, `${p} is never zero`);
  assert.equal(quoteCredits('DS_ROOM_RENDER', 3), RENDER_PRICING.creditsPerView.DS_ROOM_RENDER * 3);
  assert.equal(quoteCredits('DS_ROOM_RENDER', 0), null);
  assert.equal(quoteCredits('DS_RENDER_EDIT', 2), null);
  assert.equal(quoteCredits('DS_MASTER_RENDER', 1.5), null);
});

test('a signed quote verifies and round-trips its claims', async () => {
  const c = claims();
  const token = await signQuote(c, SECRET);
  const r = await verifyQuote(token, SECRET);
  assert.equal(r.ok, true);
  assert.deepEqual(r.claims, c);
});

test('a tampered quote is invalid (credits lowered by the browser)', async () => {
  const token = await signQuote(claims(), SECRET);
  const [body, sig] = token.split('.');
  const forged = JSON.parse(Buffer.from(body, 'base64url').toString());
  forged.credits = 1;
  const tampered = `${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${sig}`;
  assert.deepEqual(await verifyQuote(tampered, SECRET), { ok: false, reason: 'QUOTE_INVALID' });
});

test('a quote signed with another secret is invalid; garbage is malformed', async () => {
  const token = await signQuote(claims(), 'y'.repeat(48));
  assert.equal((await verifyQuote(token, SECRET)).reason, 'QUOTE_INVALID');
  for (const bad of [null, '', 'abc', 'a.b.c', '!!.??', 42]) assert.equal((await verifyQuote(bad, SECRET)).reason, 'QUOTE_MALFORMED');
});

test('a quote expires after its ten minutes', async () => {
  const c = claims({ exp: 1_000 });
  const token = await signQuote(c, SECRET);
  assert.equal((await verifyQuote(token, SECRET, 999)).ok, true);
  assert.deepEqual(await verifyQuote(token, SECRET, 1_001), { ok: false, reason: 'QUOTE_EXPIRED' });
  assert.equal(QUOTE_TTL_MS, 600_000);
});

test('a quote matches only its own caller, project, version, product and view count', () => {
  const c = claims();
  const want = { userId: 'user-1', projectId: 'proj-1', versionId: 'ver-1', product: 'DS_ROOM_RENDER', views: 3 };
  assert.equal(quoteMatches(c, want), true);
  assert.equal(quoteMatches(c, { ...want, userId: 'user-2' }), false);
  assert.equal(quoteMatches(c, { ...want, versionId: 'ver-2' }), false);
  assert.equal(quoteMatches(c, { ...want, product: 'DS_MASTER_RENDER' }), false);
  assert.equal(quoteMatches(c, { ...want, views: 2 }), false);
  // A quote whose credits disagree with the server's table (an old price) does not match.
  assert.equal(quoteMatches({ ...c, credits: 1 }, want), false);
});

test('the quote secret is its own env var, else derived from the service key (never the key itself)', async () => {
  const own = 'z'.repeat(40);
  assert.equal(await quoteSecret((k) => (k === 'DS_RENDER_QUOTE_SECRET' ? own : 'svc-key')), own);
  const derived = await quoteSecret((k) => (k === 'SUPABASE_SERVICE_ROLE_KEY' ? 'svc-key' : undefined));
  assert.ok(derived && derived !== 'svc-key' && !derived.includes('svc-key'));
  assert.equal(derived, await quoteSecret((k) => (k === 'SUPABASE_SERVICE_ROLE_KEY' ? 'svc-key' : undefined)), 'stable');
  assert.equal(await quoteSecret(() => undefined), null);
  // A short own secret is not trusted: the derivation is used instead.
  assert.equal(await quoteSecret((k) => (k === 'DS_RENDER_QUOTE_SECRET' ? 'short' : k === 'SUPABASE_SERVICE_ROLE_KEY' ? 'svc-key' : undefined)), derived);
});

test('row keys: the same request and view is the same row; views, scopes and callers never collide', async () => {
  const a = await renderRowKey('u1', 'req-12345', 'START', 'v1');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(a, await renderRowKey('u1', 'req-12345', 'START', 'v1'));
  const others = await Promise.all([
    renderRowKey('u1', 'req-12345', 'START', 'v2'), renderRowKey('u1', 'req-12345', 'EDIT', 'v1'),
    renderRowKey('u2', 'req-12345', 'START', 'v1'), renderRowKey('u1', 'req-12346', 'START', 'v1'),
  ]);
  assert.equal(new Set([a, ...others]).size, 5);
  assert.equal(reservationKey(a), `ds-render:${a}`);
});

test('client idempotency keys are bounded and plain', () => {
  assert.equal(validIdempotencyKey('render-2026-10-02-abc'), true);
  for (const bad of ['short', 'x'.repeat(129), 'has space here', '<script>', null, 12345678]) assert.equal(validIdempotencyKey(bad), false);
});
