// Privileged worker routes are server-to-server only (capacity audit
// 2026-10-18, P1 #1). Before this, any signed-in HOMATCH user's Supabase
// session was accepted, so a customer could start a Verify run on the public
// Railway domain without research-agent's wallet reservation, the `verify`
// service switch, the anonymous/IP limits or job admission.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { bearerMatches, createWorkerAuth } = await import('../.tstest-build/http/workerAuth.js');

const TOKEN = 'a-worker-token-like-the-real-one';

function run(mw, headers) {
  let status = 200;
  let body = null;
  let passed = false;
  const res = { status(c) { status = c; return this; }, json(b) { body = b; return this; } };
  mw({ headers }, res, () => { passed = true; });
  return { status, body, passed };
}

test('the worker token passes', () => {
  const r = run(createWorkerAuth(TOKEN), { authorization: `Bearer ${TOKEN}` });
  assert.equal(r.passed, true);
});

test('a Supabase user session (JWT + apikey) is refused before any work starts', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyIn0.sig';
  const r = run(createWorkerAuth(TOKEN), { authorization: `Bearer ${jwt}`, apikey: 'anon-key' });
  assert.equal(r.passed, false);
  assert.equal(r.status, 401);
  assert.deepEqual(r.body, { error: 'unauthorized' });
});

test('missing, malformed, prefixed or suffixed tokens are refused', () => {
  const mw = createWorkerAuth(TOKEN);
  for (const authorization of [undefined, '', TOKEN, `bearer ${TOKEN}`, `Bearer ${TOKEN} `, `Bearer ${TOKEN}x`, `Bearer ${TOKEN.slice(1)}`, 'Bearer ']) {
    const r = run(mw, authorization === undefined ? {} : { authorization });
    assert.equal(r.passed, false, String(authorization));
    assert.equal(r.status, 401);
  }
});

test('fails closed when the worker has no token configured', () => {
  const r = run(createWorkerAuth(''), { authorization: 'Bearer ' });
  assert.equal(r.passed, false);
  assert.equal(r.status, 503);
  assert.equal(bearerMatches('Bearer ', ''), false);
});

test('the refusal never echoes the presented credential', () => {
  const r = run(createWorkerAuth(TOKEN), { authorization: 'Bearer secret-guess-123' });
  assert.ok(!JSON.stringify(r.body).includes('secret-guess-123'));
});

test('index.ts uses the token-only middleware and no longer asks Supabase who the caller is', () => {
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(src, /const auth = createWorkerAuth\(TOKEN\);/);
  assert.doesNotMatch(src, /auth\/v1\/user/);
  // every privileged Verify route still goes through it
  for (const route of ["app.post('/research', auth", "app.post('/verify/market', auth", "app.post('/tas/test', auth", "app.post('/verify/tas-files', auth", "app.post('/research/enreg-entity', auth", "app.get('/health/captcha', auth"]) {
    assert.ok(src.includes(route), route);
  }
});
