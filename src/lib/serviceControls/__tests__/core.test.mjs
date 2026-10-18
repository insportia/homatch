import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createServiceControlStore, RETRY_AFTER_UNREADABLE_MS, toSnapshot, initialSnapshot, liveVisibility, HIDDEN_SNAPSHOT, SERVICE_KEYS,
  PAUSED_BY_DEFAULT, LIVE_BY_DEFAULT, PAID_CLOSED_BY_DEFAULT,
} from '../core.ts';

const row = (k, f, b) => ({ service_key: k, frontend_enabled: f, backend_enabled: b });

test('before any answer: the six are hidden, every live product is shown', () => {
  assert.equal(HIDDEN_SNAPSHOT.loaded, false);
  assert.equal(SERVICE_KEYS.length, PAUSED_BY_DEFAULT.length + LIVE_BY_DEFAULT.length + PAID_CLOSED_BY_DEFAULT.length);
  for (const k of PAID_CLOSED_BY_DEFAULT) assert.deepEqual(HIDDEN_SNAPSHOT.services[k], { frontend: false, backend: false }, `${k}: paid, hidden until proven ON`);
  for (const k of PAUSED_BY_DEFAULT) assert.deepEqual(HIDDEN_SNAPSHOT.services[k], { frontend: false, backend: false }, k);
  for (const k of LIVE_BY_DEFAULT) assert.deepEqual(HIDDEN_SNAPSHOT.services[k], { frontend: true, backend: true }, k);
});

test('only a service that can also run is visible; malformed rows keep their default', () => {
  const s = toSnapshot([row('ai_talk', true, true), row('whatsapp', true, false), row('design_studio', 'true', true), row('verify', false, false), row('billing', true, true), null]);
  assert.equal(s.loaded, true);
  assert.deepEqual(s.services.ai_talk, { frontend: true, backend: true });
  assert.deepEqual(s.services.whatsapp, { frontend: false, backend: false }, 'visible-without-backend is never trusted');
  assert.deepEqual(s.services.design_studio, { frontend: false, backend: true }, 'a non-boolean is not "on"');
  assert.deepEqual(s.services.verify, { frontend: false, backend: false }, 'an explicit OFF hides a live product');
  assert.deepEqual(s.services.find_property, { frontend: true, backend: true }, 'a live product without a row stays shown');
  assert.equal(Object.keys(s.services).length, SERVICE_KEYS.length, 'unrelated keys are ignored');
  for (const junk of [null, {}, 'x', 42]) {
    const j = toSnapshot(junk);
    assert.equal(j.loaded, true, 'a malformed answer still ends the wait');
    assert.ok(PAUSED_BY_DEFAULT.every((k) => !j.services[k].frontend), 'and keeps the six hidden');
    assert.ok(PAID_CLOSED_BY_DEFAULT.every((k) => !j.services[k].frontend), 'and keeps paid Deep Search hidden');
    assert.ok(LIVE_BY_DEFAULT.every((k) => j.services[k].frontend), 'and never hides a live product');
  }
});

test('the store: one shared fetch, subscribers notified, an outage hides the six and keeps the live products as known', async () => {
  let calls = 0;
  let answer = { data: [row('live_chat', true, true), row('meta_ads', false, false)], error: null };
  const remembered = [];
  const store = createServiceControlStore(async () => { calls++; return answer; }, { remember: (s) => remembered.push(liveVisibility(s)) });
  let notified = 0;
  const off = store.subscribe(() => notified++);
  await Promise.all([store.refresh(), store.refresh()]);
  assert.equal(calls, 1, 'concurrent refreshes share one request');
  assert.equal(store.get().services.live_chat.frontend, true);
  assert.equal(store.get().services.meta_ads.frontend, false);
  assert.equal(notified, 1);
  assert.equal(remembered.at(-1).meta_ads, false, 'a fresh answer is remembered');
  answer = { data: null, error: { message: 'down' } };
  await store.refresh();
  assert.equal(store.get().services.live_chat.frontend, false, 'an unreadable answer hides the six again');
  assert.equal(store.get().services.meta_ads.frontend, false, 'and does not bring back a live product the owner paused');
  assert.equal(store.get().services.verify.frontend, true, 'nor hide one that was on');
  const throwing = createServiceControlStore(async () => { throw new Error('network'); });
  await throwing.refresh();
  assert.equal(throwing.get().loaded, true);
  assert.ok(PAUSED_BY_DEFAULT.every((k) => !throwing.get().services[k].frontend));
  assert.ok(PAID_CLOSED_BY_DEFAULT.every((k) => !throwing.get().services[k].frontend), 'a failed read never shows paid Deep Search');
  assert.ok(LIVE_BY_DEFAULT.every((k) => throwing.get().services[k].frontend));
  off();
});

test('the starting snapshot takes only the live products from memory, never the six', () => {
  const s = initialSnapshot({ verify: false, ai_talk: true, live_chat: true, find_property: 'false' });
  assert.equal(s.loaded, false);
  assert.equal(s.services.verify.frontend, false, 'a live product remembered OFF starts hidden: no flash');
  assert.equal(s.services.find_property.frontend, true, 'only a real false hides');
  assert.equal(s.services.ai_talk.frontend, false, 'the six are never shown from memory');
  assert.equal(s.services.live_chat.frontend, false);
  assert.deepEqual(initialSnapshot(null), { ...HIDDEN_SNAPSHOT });
});

test('an unreadable answer is asked again soon, a bounded number of times, and a good one ends the retries', async () => {
  const timers = [];
  const answers = [{ data: null, error: { message: 'down' } }, { data: null, error: { message: 'down' } },
    { data: [{ service_key: 'verify', frontend_enabled: false, backend_enabled: false }], error: null }];
  let calls = 0;
  const store = createServiceControlStore(async () => answers[Math.min(calls++, answers.length - 1)], { schedule: (fn, ms) => timers.push({ fn, ms }) });
  await store.refresh();
  assert.deepEqual(timers.map((x) => x.ms), [RETRY_AFTER_UNREADABLE_MS[0]], 'the first failure schedules a quick retry');
  assert.equal(store.get().services.verify.frontend, true, 'until then the live product keeps what was known');
  await timers.shift().fn(); await new Promise((r) => setImmediate(r));
  assert.deepEqual(timers.map((x) => x.ms), [RETRY_AFTER_UNREADABLE_MS[1]], 'the second failure backs off');
  await timers.shift().fn(); await new Promise((r) => setImmediate(r));
  assert.equal(store.get().services.verify.frontend, false, 'the real answer (paused) arrives within seconds');
  assert.equal(timers.length, 0, 'a good answer schedules nothing more');

  const sched = [];
  const down = createServiceControlStore(async () => ({ data: null, error: { message: 'down' } }), { schedule: (fn, ms) => sched.push({ fn, ms }) });
  await down.refresh();
  for (let i = 0; i < 6 && sched.length; i += 1) { await sched.shift().fn(); await new Promise((r) => setImmediate(r)); }
  assert.equal(calls >= 3, true);
  assert.equal(sched.length, 0, 'a lasting outage stops retrying and leaves it to the regular refresh');
});
