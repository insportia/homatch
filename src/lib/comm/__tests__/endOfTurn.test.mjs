// Deciding a turn is over, instead of waiting to be told it is.
//
// MEASURED ON THE DEPLOYED PATH, same clips, same session, back to back:
//
//   strategy      p50     p95     failed to finalise
//   endpointer    2237    3132    1 of 6  ("კი." never finalised at all)
//   half-close    1335    1686    0 of 6
//
// and the transcript came back IDENTICAL in every pair, so the latency was
// not bought with accuracy. Asking costs ~600-1100ms; waiting for Chirp 3
// costs 1.8-3.1s and sometimes never returns.
//
// The risk this trades into is the opposite one: ending a turn while somebody
// is still thinking mid-sentence. That is what the adaptive window and the
// refusals in maybeEndLiveTurn are for, and it is what these pin down.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const client = readFileSync('src/lib/comm/voiceClient.ts', 'utf8');
const google = readFileSync('src/lib/comm/googleTranscribe.ts', 'utf8');
const iface = readFileSync('src/lib/comm/liveTranscribe.ts', 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const body = (src, name) => {
  const at = src.indexOf(name);
  assert.ok(at > 0, `${name} is missing`);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return strip(src.slice(open, i + 1));
  }
  throw new Error(`${name} never closes`);
};

// ── Asking, not closing ───────────────────────────────────────────────────

test('finalize asks for the sentence and keeps the socket listening', () => {
  const fn = body(google, 'finalize(): boolean');
  assert.ok(/type: 'close'/.test(fn), 'the worker half-closes on this message');
  // close() would null the socket and stop the answer arriving, which is the
  // entire thing being waited for.
  assert.ok(!/this\.closed = true/.test(fn), 'finalize must not tear the socket down');
  assert.ok(/this\.finalizing = true/.test(fn));
});

test('audio after the turn ends does not leak into the finished stream', () => {
  const fn = body(google, 'append(pcm: Int16Array)');
  assert.ok(/if \(this\.finalizing\) return;/.test(fn),
    'those samples belong to the next utterance, not this one');
});

test('the expected close is not reported as the transport failing', () => {
  // The worker closes the socket once it has handed back the sentence we
  // asked for. Reporting that would drop every turn to the batch path.
  const g = strip(google);
  assert.ok(/!this\.closed && !this\.finalizing && wasReady/.test(g));
});

test('finalize is optional, so a transcriber without a half-close still works', () => {
  assert.ok(/finalize\?\(\): boolean;/.test(iface));
  assert.ok(/readonly isFinalizing\?: boolean;/.test(iface));
  // And the caller must check for it rather than assume it.
  assert.ok(/if \(!live\?\.finalize/.test(strip(client)));
});

// ── ADAPTIVE, and every refusal is a way of being wrong ───────────────────

test('three tiers, because the middle one is genuinely ambiguous', () => {
  /*
   * MEASURED voiced audio: კი 260ms, არა 300ms, ჰო 380ms are one-word
   * answers. კარგი 580ms and დიახ 820ms are ALSO complete answers -- and
   * "მინდა ბინა", an unfinished fragment, is 840ms. The middle of that range
   * cannot be resolved acoustically, so the tier it shares must be patient
   * while the unambiguous short tier need not be.
   */
  const c = client;
  const ack = Number(/END_TURN_ACK_MS = (\d+)/.exec(c)[1]);
  const mid = Number(/END_TURN_SHORT_MS = (\d+)/.exec(c)[1]);
  const long = Number(/END_TURN_LONG_MS = (\d+)/.exec(c)[1]);
  assert.ok(ack < mid && mid <= long, `${ack} < ${mid} <= ${long}`);
  assert.ok(ack >= 200 && ack <= 400, `${ack}ms: brisk, but not inside a word`);
  // Measured: a 700ms window keeps a mid-sentence pause of up to 600ms and
  // ends the turn beyond 750ms.
  assert.ok(mid >= 600, `${mid}ms would cut a normal thinking pause in half`);
  const fn = body(client, 'private maybeEndLiveTurn()');
  assert.ok(/END_TURN_ACK_SPEECH_MS/.test(fn) && /END_TURN_LONG_SPEECH_MS/.test(fn),
    'the tier must be chosen from how much VOICE there has been');
});

test('the gate is not so close to "კი" that it becomes a coin toss', () => {
  // It was 240ms against a measured 260ms, and sonic-3 is stochastic -- so
  // whether the fastest path applied to the shortest word in the language
  // depended on the take.
  const min = Number(/END_TURN_MIN_SPEECH_MS = (\d+)/.exec(client)[1]);
  assert.ok(min <= 180, `${min}ms is within measurement noise of a one-word answer`);
  assert.ok(min >= 80, `${min}ms would let a cough commit a turn`);
});

test('a turn is never ended for silence that was never preceded by speech', () => {
  const fn = body(client, 'private maybeEndLiveTurn()');
  assert.ok(/this\.liveSpeechMs < END_TURN_MIN_SPEECH_MS/.test(fn),
    'a quiet room would otherwise commit empty turns forever');
});

test('a turn is never ended while the assistant holds the floor', () => {
  const fn = body(client, 'private maybeEndLiveTurn()');
  for (const guard of ['this.micGated', 'this.muted', 'this.turnInFlight', 'this.closed']) {
    assert.ok(fn.includes(guard), `${guard} must refuse`);
  }
});

test('a turn is ended once, and a refused request does not strand it', () => {
  const fn = body(client, 'private maybeEndLiveTurn()');
  assert.ok(/this\.liveEnded \|\| live\.isFinalizing/.test(fn), 'must not ask twice');
  // If the socket will not take it, fall back to the provider's endpointer
  // rather than leaving the utterance with nothing to end it.
  assert.ok(/this\.liveEnded = false;/.test(fn));
});

test('speech end is stamped when speech ended, not when we noticed', () => {
  const fn = body(client, 'private maybeEndLiveTurn()');
  assert.ok(/speechEndedAtMs = Date\.now\(\) - silenceMs/.test(fn),
    'measuring from the decision would hide the window from every latency number');
});

// ── The socket is spent, so it is replaced ────────────────────────────────

test('a deliberate turn boundary rotates the recogniser socket', () => {
  const c = strip(client);
  assert.ok(/if \(this\.live\?\.isFinalizing\) void this\.rotateLive\(\);/.test(c),
    'the worker closes that stream once it answers');
  const rot = body(client, 'private async rotateLive()');
  assert.ok(/this\.liveSpeechMs = 0;/.test(rot) && /this\.liveEnded = false;/.test(rot),
    'the new socket starts a new utterance');
  assert.ok(/openLiveTranscription\(\)/.test(rot));
});

test('rotation happens while the reply is still being produced', () => {
  // Opened during the answer, not after it, so the grant round trip lands in
  // time nobody is waiting through.
  const c = strip(client);
  const at = c.indexOf('if (this.live?.isFinalizing) void this.rotateLive();');
  const take = c.indexOf('await this.takeTurn(said)');
  assert.ok(at > 0 && take > at, 'rotation must be started before the turn is taken');
});

test('the deliberate boundary is counted and its evidence kept', () => {
  assert.ok(/turnsEndedLocally/.test(client));
  assert.ok(/lastEndTurnSilenceMs/.test(client) && /lastEndTurnSpeechMs/.test(client),
    'a window that fires wrongly has to be diagnosable from the session');
});
