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

test('the six fail closed, the live products fail open — and an explicit OFF is honoured by both', async () => {
  const { PAUSED_BY_DEFAULT, LIVE_BY_DEFAULT } = await import('../serviceControl.ts');
  assert.equal(PAUSED_BY_DEFAULT.length, 6);
  assert.equal(new Set([...PAUSED_BY_DEFAULT, ...LIVE_BY_DEFAULT]).size, SERVICE_KEYS.length, 'every key is in exactly one mode');
  const quiet = console.error; console.error = () => {};
  try {
    for (const unreadable of [{ data: null, error: { code: '42P01' } }, () => { throw new Error('network'); }, { data: [], error: null }]) {
      resetServiceControlCache();
      const db = dbWith(unreadable);
      for (const k of PAUSED_BY_DEFAULT) assert.equal(await serviceBackendEnabled(db, k, 1000), false, `${k} must fail closed`);
      for (const k of LIVE_BY_DEFAULT) assert.equal(await serviceBackendEnabled(db, k, 1000), true, `${k} must keep running when the control is unreadable`);
    }
  } finally { console.error = quiet; }
  resetServiceControlCache();
  const db = dbWith({ data: [{ service_key: 'verify', frontend_enabled: false, backend_enabled: false }], error: null });
  assert.equal(await serviceBackendEnabled(db, 'verify', 1000), false, 'an explicit OFF row stops a live product');
  assert.equal(await serviceBackendEnabled(db, 'find_property', 1000), true, 'a live product without a row keeps running');
});
