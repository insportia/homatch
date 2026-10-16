import { test } from 'node:test';
import assert from 'node:assert/strict';
import { serviceBackendEnabled, serviceState, resetServiceControlCache, serviceDisabledResponse, SERVICE_KEYS, CACHE_MS, ERROR_CACHE_MS } from '../serviceControl.ts';

const dbWith = (result) => {
  const calls = { n: 0 };
  return { calls, from: (t) => { assert.equal(t, 'service_controls'); return { select: async () => { calls.n++; return typeof result === 'function' ? result() : result; } }; } };
};
const rows = (over = {}) => ({ data: SERVICE_KEYS.map((k) => ({ service_key: k, frontend_enabled: false, backend_enabled: false, ...(over[k] ?? {}) })), error: null });

test('all six OFF → every service refuses new work', async () => {
  resetServiceControlCache();
  const db = dbWith(rows());
  for (const k of SERVICE_KEYS) assert.equal(await serviceBackendEnabled(db, k, 1000), false, k);
  assert.equal(db.calls.n, 1, 'one query serves every check in the window');
});

test('a service whose backend is ON may run; the others stay off', async () => {
  resetServiceControlCache();
  const db = dbWith(rows({ ai_talk: { backend_enabled: true } }));
  assert.equal(await serviceBackendEnabled(db, 'ai_talk', 1000), true);
  assert.equal(await serviceBackendEnabled(db, 'whatsapp', 1000), false);
  assert.deepEqual(await serviceState(db, 'ai_talk', 1000), { frontend: false, backend: true });
});

test('fail closed: a read error, an exception, a missing row or a non-boolean value means OFF', async () => {
  for (const result of [{ data: null, error: { code: '42P01' } }, () => { throw new Error('network'); }, { data: [], error: null }, { data: [{ service_key: 'ai_talk', backend_enabled: 'true' }], error: null }]) {
    resetServiceControlCache();
    const errors = [];
    const orig = console.error; console.error = (...a) => errors.push(a.join(' '));
    try { assert.equal(await serviceBackendEnabled(dbWith(result), 'ai_talk', 1000), false); } finally { console.error = orig; }
  }
});

test('propagation: an Admin change is seen within CACHE_MS; an error is retried after ERROR_CACHE_MS', async () => {
  resetServiceControlCache();
  let on = false;
  const db = dbWith(() => rows({ design_studio: { backend_enabled: on } }));
  assert.equal(await serviceBackendEnabled(db, 'design_studio', 0), false);
  on = true;
  assert.equal(await serviceBackendEnabled(db, 'design_studio', CACHE_MS - 1), false, 'still the cached snapshot');
  assert.equal(await serviceBackendEnabled(db, 'design_studio', CACHE_MS), true, 'seen once the window ends');
  assert.equal(db.calls.n, 2);

  resetServiceControlCache();
  let fail = true;
  const flaky = dbWith(() => (fail ? { data: null, error: { code: 'x' } } : rows({ live_chat: { backend_enabled: true } })));
  const orig = console.error; console.error = () => {};
  try {
    assert.equal(await serviceBackendEnabled(flaky, 'live_chat', 0), false);
    fail = false;
    assert.equal(await serviceBackendEnabled(flaky, 'live_chat', ERROR_CACHE_MS - 1), false, 'no query storm during an outage');
    assert.equal(await serviceBackendEnabled(flaky, 'live_chat', ERROR_CACHE_MS), true, 'recovers after the short error window');
  } finally { console.error = orig; }
});

test('the refusal is a 503 SERVICE_DISABLED naming the service, never cached', async () => {
  const res = serviceDisabledResponse('publishing', { 'Access-Control-Allow-Origin': 'https://homatch.live' });
  assert.equal(res.status, 503);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('access-control-allow-origin'), 'https://homatch.live');
  assert.deepEqual(await res.json(), { code: 'SERVICE_DISABLED', error: 'SERVICE_DISABLED', service: 'publishing' });
});
