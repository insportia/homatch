// The rotation gap, driven rather than read.
//
// Every previous test of the voice client reads its source and asserts on
// text. That is why a defect that made the session stop completing turns
// shipped with 2,582 tests passing: the branch was present, spelled the way
// the tests expected, and wrong.
//
// THE REAL ANDROID TRACE THAT THIS REPRODUCES:
//
//   voicedBeforeReadyMs   4011
//   droppedPreReadyBytes  688128      (21.5s of 16kHz mono Int16)
//   turns                 []          <- zero completed turns
//
// The synthetic fixtures never caught it because they left eleven seconds of
// silence between utterances, so a rotation always finished before anybody
// spoke again. These tests speak immediately, which is what a person does.

import test from 'node:test';
import assert from 'node:assert/strict';
import { LiveAudioRouter } from '../liveAudioRouter.ts';

const RATE = 16000;
/** 20ms of canonical PCM, valued so chunks can be told apart in order. */
const block = (seq) => {
  const n = (RATE / 1000) * 20;
  const a = new Int16Array(n);
  a.fill(seq);
  return a;
};

const makeRouter = (clock) => new LiveAudioRouter({
  sampleRate: RATE, maxBufferMs: 3000, maxWaitMs: 2500, now: () => clock.t,
});

test('a turn, an immediate rotation, and the next utterance starts at once', () => {
  const clock = { t: 0 };
  const r = makeRouter(clock);
  const sent = [];

  r.expect('CONNECTING');
  assert.equal(r.route(block(1), false).kind, 'HELD');
  for (const c of r.ready()) sent.push(c);          // socket opens, flush

  // First utterance, live.
  for (let i = 2; i <= 6; i++) {
    clock.t += 20;
    assert.equal(r.route(block(i), true).kind, 'SEND');
    sent.push(block(i));
  }

  // Turn finalises; the socket rotates. The speaker does NOT wait.
  r.expect('ROTATING');
  const heldSeqs = [];
  for (let i = 7; i <= 12; i++) {
    clock.t += 20;
    assert.equal(r.route(block(i), false).kind, 'HELD',
      'speech during a rotation must be held, not dropped');
    heldSeqs.push(i);
  }

  // New socket ready, 120ms later. Everything held goes first, in order.
  const flushed = r.ready();
  assert.deepEqual(flushed.map((c) => c[0]), heldSeqs, 'ORDERING');
  for (const c of flushed) sent.push(c);

  // Live PCM continues, and the second utterance completes.
  for (let i = 13; i <= 16; i++) {
    clock.t += 20;
    assert.equal(r.route(block(i), true).kind, 'SEND');
    sent.push(block(i));
  }

  assert.deepEqual(sent.map((c) => c[0]), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
    'PCM_ORDER_PRESERVED, with nothing duplicated and nothing missing');
  assert.equal(r.droppedPcmBytes, 0, 'DROPPED_PCM_BYTES');
  assert.ok(r.accountsBalance(), 'every byte in exactly one category');
});

test('three rapid rotations in a row lose nothing', () => {
  const clock = { t: 0 };
  const r = makeRouter(clock);
  const sent = [];
  let seq = 0;

  r.expect('CONNECTING');
  for (const c of r.ready()) sent.push(c);

  for (let rot = 0; rot < 3; rot++) {
    for (let i = 0; i < 4; i++) {
      clock.t += 20; seq++;
      assert.equal(r.route(block(seq), true).kind, 'SEND');
      sent.push(block(seq));
    }
    r.expect('ROTATING');
    for (let i = 0; i < 5; i++) {        // speaking straight through it
      clock.t += 20; seq++;
      assert.equal(r.route(block(seq), false).kind, 'HELD');
    }
    for (const c of r.ready()) sent.push(c);
  }

  assert.deepEqual(sent.map((c) => c[0]), Array.from({ length: seq }, (_, i) => i + 1),
    'THREE_RAPID_ROTATIONS: order preserved across all three');
  assert.equal(r.droppedPcmBytes, 0, 'DROPPED_PCM_BYTES');
  assert.equal(r.flushes, 3, 'BUFFER_FLUSH_EXACTLY_ONCE, once per rotation');
  assert.ok(r.accountsBalance());
});

test('the buffer is handed over exactly once', () => {
  const clock = { t: 0 };
  const r = makeRouter(clock);
  r.expect('ROTATING');
  r.route(block(1), false);
  r.route(block(2), false);

  const first = r.ready();
  assert.equal(first.length, 2);
  // A second readiness with nothing new must not replay the same audio into
  // a new recogniser -- that is how a sentence gets transcribed twice.
  assert.deepEqual(r.ready(), [], 'NO_STALE_AUDIO across sockets');
  assert.equal(r.bufferedBytes, 0);
});

// ── The regression itself ─────────────────────────────────────────────────

test('a grant that never arrives does NOT stop the session taking turns', () => {
  // This is the Android failure, exactly: a socket was expected, it never
  // came, and every block afterwards was held instead of reaching the batch
  // path. The session showed itself as listening and completed no turns.
  const clock = { t: 0 };
  const r = makeRouter(clock);

  r.expect('ROTATING');
  assert.equal(r.route(block(1), false).kind, 'HELD');

  clock.t += 2600;                        // past maxWaitMs, nothing arrived
  const verdict = r.route(block(2), false);
  assert.equal(verdict.kind, 'BATCH',
    'past the deadline the batch path must take the audio, so turns complete');
  assert.equal(r.currentPhase, 'FAILED');
  assert.ok(r.lastFellBack, 'and it must say why');

  // And it must STAY on the batch path rather than silently resuming holds.
  clock.t += 20;
  assert.equal(r.route(block(3), false).kind, 'BATCH');
  assert.ok(r.accountsBalance());
});

test('a socket that goes away mid-session releases the microphone', () => {
  const clock = { t: 0 };
  const r = makeRouter(clock);
  r.expect('CONNECTING');
  r.ready();
  assert.equal(r.route(block(1), true).kind, 'SEND');

  r.abandon('provider unavailable');      // what onUnavailable must call
  assert.equal(r.route(block(2), false).kind, 'BATCH',
    'falling back to batch must actually reach the batch path');
  assert.ok(r.accountsBalance());
});

test('holding is bounded in TIME, so a buffer can never grow without end', () => {
  const clock = { t: 0 };
  const r = makeRouter(clock);
  r.expect('CONNECTING');
  for (let i = 0; i < 2000; i++) {
    clock.t += 20;
    r.route(block(1), false);
  }
  assert.equal(r.currentPhase, 'FAILED', 'NO_UNBOUNDED_BUFFER');
  assert.ok(r.bufferedBytes === 0);
  // 2500ms of patience at 32,000 B/s is ~80kB; the shipped build reached
  // 688,128 because there was no deadline at all.
  assert.ok(r.maxBufferedBytes <= 3000 / 1000 * RATE * 2,
    'and never beyond the stated capacity');
  assert.ok(r.accountsBalance());
});

test('no byte is ever counted twice or lost, whatever the path', () => {
  const clock = { t: 0 };
  const r = makeRouter(clock);
  r.expect('CONNECTING');
  r.route(block(1), false);
  r.ready();
  r.route(block(2), true);
  r.expect('ROTATING');
  r.route(block(3), false);
  clock.t += 3000;
  r.route(block(4), false);               // abandons, goes to batch
  assert.ok(r.accountsBalance(),
    `POST_RESAMPLE_BYTES must equal sent + flushed + buffered + dropped`);
});
