// LOAD ISOLATION (src/runtime/loadIsolation.ts): while AI TALK speech is open, the verify queue
// starts fewer new Chromium tasks; event-loop delay is measured for /health and session logs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const iso = await import('../.tstest-build/runtime/loadIsolation.js');
const { QueueRunner } = await import('../.tstest-build/queue/QueueRunner.js');

test('browser lanes drop to the speech cap while a session is open; HTTP lanes never do', () => {
  assert.equal(iso.laneSlotsNow('BROWSER', 3, 0, 1), 3);
  assert.equal(iso.laneSlotsNow('BROWSER', 3, 2, 1), 1);
  assert.equal(iso.laneSlotsNow('HTTP', 12, 5, 1), 12);
  assert.equal(iso.browserCapDuringSpeech({}), 1);
  assert.equal(iso.browserCapDuringSpeech({ VERIFY_QUEUE_BROWSER_SLOTS_DURING_SPEECH: '2' }), 2);
  assert.equal(iso.browserCapDuringSpeech({ VERIFY_QUEUE_BROWSER_SLOTS_DURING_SPEECH: 'x' }), 1);
  iso.speechSessionOpened(); iso.speechSessionOpened(); iso.speechSessionClosed();
  assert.equal(iso.speechSessionsOpen(), 1);
  iso.speechSessionClosed(); iso.speechSessionClosed();
  assert.equal(iso.speechSessionsOpen(), 0, 'never negative');
});

test('the runner claims only the slots allowed now and never interrupts running tasks', async () => {
  let speech = 1;
  const asked = [];
  let release;
  const hold = new Promise((r) => { release = r; });
  const gateway = {
    claim: async (_w, lanes, n) => { asked.push(n); return { tasks: Array.from({ length: n }, (_, i) => ({ id: `t${asked.length}-${i}`, lane: lanes[0], attempt: 1, leaseUntil: new Date(Date.now() + 60_000).toISOString() })) }; },
    heartbeat: async () => ({ ok: true }), finish: async () => ({ ok: true }), release: async () => ({ ok: true }),
  };
  const runner = new QueueRunner({ gateway, workerId: 'w', lanes: { BROWSER: 3 }, idleMinMs: 5, idleMaxMs: 10, heartbeatMinMs: 50,
    slotsNow: (lane, slots) => iso.laneSlotsNow(lane, slots, speech, 1),
    executor: async () => { await hold; return { kind: 'DONE', result: {} }; }, log: () => {}, sleep: (ms) => new Promise((r) => setTimeout(r, ms)) });
  runner.start();
  await new Promise((r) => setTimeout(r, 60));
  assert.deepEqual(asked, [1], 'speech open: one browser task');
  speech = 0;
  await new Promise((r) => setTimeout(r, 350));
  assert.equal(asked.reduce((a, b) => a + b, 0), 3, 'speech ended: back to all three slots');
  assert.equal(runner.inFlight('BROWSER'), 3);
  release();
  await runner.stop(1000);
});

test('event-loop delay is reported in ms and wired into /health and session_closed', () => {
  const d = iso.eventLoopDelay();
  for (const k of ['p50Ms', 'p99Ms', 'maxMs', 'windowS']) assert.equal(typeof d.current[k], 'number', k);
  const gw = readFileSync(new URL('../src/speech/SpeechGateway.ts', import.meta.url), 'utf8');
  assert.match(gw, /speechSessionOpened\(\);\s*ws\.once\('close', speechSessionClosed\);/);
  assert.match(gw, /eventLoop: eventLoopDelay\(\)\.current,/);
  const idx = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  assert.match(idx, /eventLoop: eventLoopDelay\(\),/);
  assert.match(readFileSync(new URL('../src/queue/startVerifyQueue.ts', import.meta.url), 'utf8'), /slotsNow: \(lane, slots\) => laneSlotsNow\(lane, slots\),/);
});
