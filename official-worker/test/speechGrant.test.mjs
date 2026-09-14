// The grant is the only thing standing between a public WebSocket and a paid
// Google stream, and the two halves of it are written in different languages
// on different machines. A mismatch between them would not be a compile error
// or a failed test anywhere — it would be a socket that always returns 401,
// discovered by somebody speaking Georgian into a page that never answers.
//
// So this mints a grant the way the Deno edge function mints one, verifies it
// the way the worker verifies one, and checks the edge function's source still
// produces that shape.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';

const { verifyGrant } = await import('../.tstest-build/speech/SpeechGateway.js');

const SECRET = 'a-worker-token-like-the-real-one';

/** Exactly what the edge function does, in Node. */
function mint(sessionId, expiresAt, secret = SECRET) {
  const payload = `${sessionId}.${expiresAt}`;
  const hex = createHmac('sha256', secret).update(payload).digest('hex');
  return `${payload}.${hex}`;
}

test('a grant minted the way the edge function mints one is accepted', () => {
  const sessionId = '7c65329a-875b-4f90-8b68-444cd7921c81';
  const expiresAt = Date.now() + 5 * 60_000;
  const grant = verifyGrant(mint(sessionId, expiresAt), SECRET);

  assert.ok(grant, 'the worker must accept what the edge function produces');
  assert.equal(grant.sessionId, sessionId,
    'the session the socket serves must be the session the grant names');
});

test('an expired grant is refused even though its signature is perfect', () => {
  const grant = mint('s', Date.now() - 1000);
  assert.equal(verifyGrant(grant, SECRET), null);
});

test('a grant good for longer than the window is refused', () => {
  // Otherwise a grant minted with a year's expiry would be a permanent key to
  // a paid stream, and the signature would say it was fine.
  const grant = mint('s', Date.now() + 365 * 24 * 60 * 60_000);
  assert.equal(verifyGrant(grant, SECRET), null);
});

test('a payload edited after signing is refused', () => {
  const expiresAt = Date.now() + 60_000;
  const real = mint('session-a', expiresAt);
  const sig = real.split('.')[2];
  // Same signature, different session: the whole point of signing the pair.
  assert.equal(verifyGrant(`session-b.${expiresAt}.${sig}`, SECRET), null);
  assert.equal(verifyGrant(`session-a.${expiresAt + 1}.${sig}`, SECRET), null);
});

test('another secret does not open this socket', () => {
  const grant = mint('s', Date.now() + 60_000, 'somebody-elses-token');
  assert.equal(verifyGrant(grant, SECRET), null);
});

test('a worker with no secret accepts nothing at all', () => {
  // Fail closed. An unset WORKER_TOKEN must not mean "let everybody in".
  assert.equal(verifyGrant(mint('s', Date.now() + 60_000), ''), null);
});

test('malformed grants are refused rather than throwing', () => {
  for (const bad of ['', 'x', 'a.b', 'a.b.c.d', 'a.notanumber.ff', '..']) {
    assert.equal(verifyGrant(bad, SECRET), null, `refused: ${JSON.stringify(bad)}`);
  }
});

test('the edge function still mints the shape this worker verifies', () => {
  /*
   * Reading the shipped source rather than trusting that the two stayed in
   * step. If somebody changes the separator, the hash, or the order of the
   * payload on one side, this fails here instead of in production.
   */
  const src = readFileSync(
    new URL('../../supabase/functions/ai-talk-session/index.ts', import.meta.url),
    'utf8',
  );
  const at = src.indexOf('async function mintSpeechGrant(');
  assert.ok(at > 0, 'the edge function no longer mints a speech grant');
  const body = src.slice(at, src.indexOf('\n}\n', at));

  assert.ok(/\$\{sessionId\}\.\$\{expiresAt\}/.test(body),
    'the signed payload must still be sessionId.expiresAt');
  assert.ok(/'SHA-256'/.test(body), 'the digest must still be SHA-256');
  assert.ok(/name: 'HMAC'/.test(body), 'it must still be an HMAC');
  assert.ok(/\$\{payload\}\.\$\{hex\}/.test(body),
    'the grant must still be payload.signature');
  assert.ok(/WORKER_TOKEN/.test(body),
    'it must still be signed with the secret the worker has');
});
