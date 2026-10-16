import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServiceControlStore, toSnapshot, HIDDEN_SNAPSHOT, SERVICE_KEYS } from '../core.ts';

const row = (k, f, b) => ({ service_key: k, frontend_enabled: f, backend_enabled: b });

test('hidden until proven visible: the initial snapshot hides all six', () => {
  assert.equal(HIDDEN_SNAPSHOT.loaded, false);
  for (const k of SERVICE_KEYS) assert.deepEqual(HIDDEN_SNAPSHOT.services[k], { frontend: false, backend: false });
});

test('only a service that can also run is visible; malformed rows stay hidden', () => {
  const s = toSnapshot([row('ai_talk', true, true), row('whatsapp', true, false), row('design_studio', 'true', true), row('find_property', true, true), null]);
  assert.equal(s.loaded, true);
  assert.deepEqual(s.services.ai_talk, { frontend: true, backend: true });
  assert.deepEqual(s.services.whatsapp, { frontend: false, backend: false }, 'visible-without-backend is never trusted');
  assert.deepEqual(s.services.design_studio, { frontend: false, backend: true }, 'a non-boolean is not "on"');
  assert.equal(Object.keys(s.services).length, 6, 'unrelated keys are ignored');
  for (const junk of [null, {}, 'x', 42]) {
    const j = toSnapshot(junk);
    assert.equal(j.loaded, true, 'a malformed answer still ends the wait');
    assert.ok(SERVICE_KEYS.every((k) => !j.services[k].frontend), 'and keeps all six hidden');
  }
});

test('the store: one shared fetch, subscribers notified, errors keep everything hidden', async () => {
  let calls = 0;
  let answer = { data: [row('live_chat', true, true)], error: null };
  const store = createServiceControlStore(async () => { calls++; return answer; });
  let notified = 0;
  const off = store.subscribe(() => notified++);
  await Promise.all([store.refresh(), store.refresh()]);
  assert.equal(calls, 1, 'concurrent refreshes share one request');
  assert.equal(store.get().services.live_chat.frontend, true);
  assert.equal(notified, 1);
  answer = { data: null, error: { message: 'down' } };
  await store.refresh();
  assert.equal(store.get().services.live_chat.frontend, false, 'an unreadable answer hides it again');
  const throwing = createServiceControlStore(async () => { throw new Error('network'); });
  await throwing.refresh();
  assert.equal(throwing.get().loaded, true);
  assert.ok(SERVICE_KEYS.every((k) => !throwing.get().services[k].frontend));
  off();
});
