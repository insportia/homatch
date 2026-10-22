import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createServiceControlStore, RETRY_AFTER_UNREADABLE_MS, toSnapshot, initialSnapshot, liveVisibility, HIDDEN_SNAPSHOT, SERVICE_KEYS,
  PAUSED_BY_DEFAULT, LIVE_BY_DEFAULT, PAID_CLOSED_BY_DEFAULT, HIDDEN_UNTIL_ANSWERED, shownBeforeAnswer,
} from '../core.ts';

const SHOWN_EARLY = LIVE_BY_DEFAULT.filter(shownBeforeAnswer);

const row = (k, f, b) => ({ service_key: k, frontend_enabled: f, backend_enabled: b });

test('before any answer: the six and the two broker services are hidden, every other live product is shown', () => {
  assert.equal(HIDDEN_SNAPSHOT.loaded, false);
  assert.equal(SERVICE_KEYS.length, PAUSED_BY_DEFAULT.length + LIVE_BY_DEFAULT.length + PAID_CLOSED_BY_DEFAULT.length);
  for (const k of PAID_CLOSED_BY_DEFAULT) assert.deepEqual(HIDDEN_SNAPSHOT.services[k], { frontend: false, backend: false }, `${k}: paid, hidden until proven ON`);
  for (const k of PAUSED_BY_DEFAULT) assert.deepEqual(HIDDEN_SNAPSHOT.services[k], { frontend: false, backend: false }, k);
  for (const k of SHOWN_EARLY) assert.deepEqual(HIDDEN_SNAPSHOT.services[k], { frontend: true, backend: true }, k);
  assert.deepEqual([...HIDDEN_UNTIL_ANSWERED], ['brokers_directory', 'broker_desk']);
  for (const k of HIDDEN_UNTIL_ANSWERED) {
    assert.ok(LIVE_BY_DEFAULT.includes(k), `${k}: the backend fail mode is unchanged`);
    assert.equal(HIDDEN_SNAPSHOT.services[k].frontend, false, k);
  }
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
    assert.ok(SHOWN_EARLY.every((k) => j.services[k].frontend), 'and never hides a live product');
    assert.ok(HIDDEN_UNTIL_ANSWERED.every((k) => !j.services[k].frontend), 'and never shows a broker service it was not told about');
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
  assert.ok(SHOWN_EARLY.every((k) => throwing.get().services[k].frontend));
  assert.ok(HIDDEN_UNTIL_ANSWERED.every((k) => !throwing.get().services[k].frontend), 'an outage before any answer keeps the broker services hidden');
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

const brokers = (dir, desk) => [row('brokers_directory', dir, dir), row('broker_desk', desk, desk)];
const vis = (s) => [s.services.brokers_directory.frontend, s.services.broker_desk.frontend];

test('broker services: both OFF, each independently ON, both ON', () => {
  assert.deepEqual(vis(toSnapshot(brokers(false, false))), [false, false]);
  assert.deepEqual(vis(toSnapshot(brokers(true, false))), [true, false]);
  assert.deepEqual(vis(toSnapshot(brokers(false, true))), [false, true]);
  assert.deepEqual(vis(toSnapshot(brokers(true, true))), [true, true]);
  assert.deepEqual(vis(toSnapshot([])), [true, true], 'a real answer without their rows (before the migration): live, as today');
  // frontend_enabled is visibility; it never shows a service whose backend_enabled is off,
  // and backend_enabled alone never shows it.
  assert.deepEqual(vis(toSnapshot([row('brokers_directory', false, true), row('broker_desk', true, false)])), [false, false]);
  assert.deepEqual(toSnapshot([row('brokers_directory', false, true)]).services.brokers_directory, { frontend: false, backend: true });
});

test('broker services after refresh or re-login: memory never shows them, an outage never brings them back', async () => {
  // A browser that last saw them ON (or a forged memory) still starts with them hidden.
  const start = initialSnapshot({ brokers_directory: true, broker_desk: true, verify: true });
  assert.deepEqual(vis(start), [false, false]);
  assert.equal('brokers_directory' in liveVisibility(toSnapshot(brokers(true, true))), false, 'their state is not even remembered');
  // The owner paused both: answered OFF, then the next read fails: still OFF.
  let answer = { data: brokers(false, false), error: null };
  const store = createServiceControlStore(async () => answer, { initial: start, schedule: () => {} });
  await store.refresh();
  assert.deepEqual(vis(store.get()), [false, false]);
  answer = { data: null, error: { message: 'down' } };
  await store.refresh();
  assert.deepEqual(vis(store.get()), [false, false], 'a failed read does not resurrect a paused broker service');
  // Switched back ON: shown after the next answer, and kept through a transient failure.
  answer = { data: brokers(true, false), error: null };
  await store.refresh();
  assert.deepEqual(vis(store.get()), [true, false]);
  answer = { data: null, error: { message: 'down' } };
  await store.refresh();
  assert.deepEqual(vis(store.get()), [true, false], 'an outage does not hide one the owner turned on');
});
