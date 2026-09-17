// The assistant must FINISH what it says -- proven on the real player.
//
// THE REAL WINDOWS/CHROME TURN THIS REPRODUCES (production, 07:59:47Z):
//
//   LLM        259 chars, complete (96 output tokens, llm_incomplete=false)
//   Cartesia   4 requests, 93 chunks, 1,524,756 B @ 48 kHz  =  15.9 s of audio
//   browser    82 sources scheduled, 58 ended naturally
//   heard      the assistant stopped mid-answer; lastBargeStopMs = null
//
// The 24 missing sources were STOPPED: stop() nulls onended before calling
// source.stop(), so a stopped source is never counted as completed. The stop
// came from the mic-gate watchdog, which fired 15 s after the turn was SENT
// -- 4.9 s of that was waiting for the first byte -- while 6 s of audio was
// still scheduled on the clock.
//
// These tests drive the REAL PcmStreamPlayer through a fake AudioContext whose
// clock we advance, and the REAL gate decision with the real numbers.

import test from 'node:test';
import assert from 'node:assert/strict';
import { PcmStreamPlayer } from '../pcmPlayer.ts';
import { gateWatchdog } from '../gateWatchdog.ts';

/* ── A WebAudio clock we can turn by hand ─────────────────────────────── */

class FakeContext {
  constructor(rate = 48000) { this.sampleRate = rate; this.currentTime = 0; this.state = 'running'; this.sources = []; }
  createBuffer(_ch, length, rate) {
    const data = new Float32Array(length);
    return { length, sampleRate: rate, duration: length / rate, copyToChannel: (arr) => data.set(arr), _data: data };
  }
  createBufferSource() {
    const ctx = this;
    const src = {
      buffer: null, onended: null, _startAt: null, _stopped: false, _ended: false,
      connect() {}, disconnect() {},
      start(at) { src._startAt = at; ctx.sources.push(src); },
      stop() { src._stopped = true; },
    };
    return src;
  }
  /** Advance the clock; fire onended for every source whose audio has passed. */
  advance(seconds) {
    this.currentTime += seconds;
    for (const s of this.sources) {
      if (s._ended || s._stopped || s._startAt === null) continue;
      if (this.currentTime >= s._startAt + s.buffer.duration) { s._ended = true; s.onended?.(); }
    }
  }
}

/** `ms` of 48 kHz mono s16le speech-like PCM, base64, the way the server sends it. */
function chunk(ms, rate = 48000) {
  const n = Math.round((ms / 1000) * rate);
  const buf = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin(i / 7) * 6000), i * 2);
  return buf.toString('base64');
}

/**
 * The real turn's shape: 4 TTS requests whose audio arrives as 93 chunks of
 * ~171 ms, totalling 15.9 s. Chunk sizes vary the way a stream's do.
 */
function realTurn(player, ctx, gen, { requests = 4, chunks = 93, totalMs = 15900 } = {}) {
  const per = totalMs / chunks;
  let queued = 0;
  for (let r = 0; r < requests; r++) {
    for (let c = 0; c < chunks / requests; c++) {
      player.push(chunk(per * (0.8 + (c % 3) * 0.2)), 48000, gen);
      queued += 1;
      ctx.advance(per / 1000 * 0.46);     // measured: the real turn's 15.9s arrived in 7.3s
    }
  }
  player.endOfTurn();
  return queued;
}

/* ── The invariant, on the real player ────────────────────────────────── */

test('a 4-request, 93-chunk, 15.9s reply plays to the end and reports drained', () => {
  const ctx = new FakeContext();
  const p = new PcmStreamPlayer(ctx, {});
  p.startTurn(1);
  realTurn(p, ctx, 1);
  const t = p.turnStats();
  assert.ok(t.queued > 0, 'audio was scheduled');
  assert.equal(t.stopped, 0, 'nothing was stopped');
  assert.equal(t.drained, false, 'not drained while audio is still on the clock');
  // Let the clock run past the last scheduled source.
  ctx.advance(20);
  const done = p.turnStats();
  assert.equal(done.completed, done.queued, 'every scheduled source ended naturally');
  assert.equal(done.drained, true, 'PLAYBACK_QUEUE_DRAINED');
  assert.equal(done.stopReason, null, 'no interruption of any kind');
  assert.ok(done.lastChunkEndedAt !== null, 'the moment the last chunk ended is known');
});

test('a substantially longer Georgian reply (3x, 12 requests) also drains completely', () => {
  const ctx = new FakeContext();
  const p = new PcmStreamPlayer(ctx, {});
  p.startTurn(1);
  realTurn(p, ctx, 1, { requests: 12, chunks: 280, totalMs: 47700 });
  ctx.advance(60);
  const t = p.turnStats();
  assert.equal(t.completed, t.queued);
  assert.equal(t.drained, true);
  assert.equal(t.stopped, 0);
});

test('the counters are PER RESPONSE: a second turn starts from zero', () => {
  const ctx = new FakeContext();
  const p = new PcmStreamPlayer(ctx, {});
  p.startTurn(1); realTurn(p, ctx, 1, { requests: 1, chunks: 10, totalMs: 2000 }); ctx.advance(5);
  assert.equal(p.turnStats().drained, true);
  p.startTurn(2);
  const fresh = p.turnStats();
  assert.equal(fresh.queued, 0);
  assert.equal(fresh.completed, 0);
  assert.equal(fresh.drained, false, 'an empty turn is not "drained", it is not started');
});

/* ── The stop that cut the real reply, and the one that is allowed to ─── */

test('a stop mid-reply is recorded as such: stopped sources, not completed, not drained', () => {
  const ctx = new FakeContext();
  const p = new PcmStreamPlayer(ctx, {});
  p.startTurn(1);
  realTurn(p, ctx, 1);
  ctx.advance(6);                               // ~10 s in, ~6 s still scheduled
  const before = p.turnStats();
  p.stop('USER_BARGE_IN');
  const after = p.turnStats();
  assert.ok(after.stopped > 0, 'the remaining sources were stopped');
  assert.equal(after.completed, before.completed, 'a stopped source never counts as completed');
  assert.equal(after.drained, false, 'and the response is NOT audibly complete');
  assert.equal(after.stopReason, 'USER_BARGE_IN', 'and the trace says who stopped it');
  assert.equal(after.queued, after.completed + after.stopped, 'every queued source is accounted for');
});

test('legitimate barge-in stops the remaining audio immediately', () => {
  const ctx = new FakeContext();
  const p = new PcmStreamPlayer(ctx, {});
  p.startTurn(1);
  realTurn(p, ctx, 1);
  assert.ok(p.pendingSeconds > 5, 'plenty still scheduled');
  p.stop('USER_BARGE_IN');
  assert.equal(p.pendingSeconds, 0, 'nothing left on the clock');
  assert.equal(p.playing, false);
  ctx.advance(30);
  assert.equal(p.turnStats().completed, p.turnStats().queued - p.turnStats().stopped,
    'stopped sources stay stopped; the clock passing them changes nothing');
});

/* ── The watchdog decision, with the real numbers ─────────────────────── */

const LIMITS = { idleMs: 15_000, hardMs: 120_000 };

test('the real Windows turn: 15s after gating, 6s of audio still scheduled -> HOLD', () => {
  // This is the exact state the old watchdog fired in.
  const v = gateWatchdog({ gated: true, gatedForMs: 15_100, turnInFlight: false, pendingSeconds: 5.8, playing: true }, LIMITS);
  assert.equal(v, 'HOLD', 'audio on the clock is not a stuck gate');
});

test('a reply still being produced holds the gate however slow the model is', () => {
  const v = gateWatchdog({ gated: true, gatedForMs: 40_000, turnInFlight: true, pendingSeconds: 0, playing: false }, LIMITS);
  assert.equal(v, 'HOLD');
});

test('the case the watchdog exists for: gated, nothing in flight, nothing playing -> RELEASE', () => {
  // The barge-in that relabelled the state without ungating: this is what a
  // stuck gate actually looks like, and it is released within seconds.
  const v = gateWatchdog({ gated: true, gatedForMs: 15_100, turnInFlight: false, pendingSeconds: 0, playing: false }, LIMITS);
  assert.equal(v, 'RELEASE_IDLE');
});

test('an idle gate inside the idle window is left alone', () => {
  const v = gateWatchdog({ gated: true, gatedForMs: 3_000, turnInFlight: false, pendingSeconds: 0, playing: false }, LIMITS);
  assert.equal(v, 'HOLD');
});

test('the hard ceiling releases regardless, so a state nobody can explain cannot last for ever', () => {
  const v = gateWatchdog({ gated: true, gatedForMs: 121_000, turnInFlight: true, pendingSeconds: 3, playing: true }, LIMITS);
  assert.equal(v, 'RELEASE_HARD');
});

test('an open gate is never "released"', () => {
  const v = gateWatchdog({ gated: false, gatedForMs: 999_999, turnInFlight: false, pendingSeconds: 0, playing: false }, LIMITS);
  assert.equal(v, 'HOLD');
});
