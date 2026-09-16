// SHORT_KA_UTTERANCES — why "კი" used to disappear.
//
// WHAT WAS MEASURED, AGAINST THE DEPLOYED RECOGNISER
//
// Eleven Georgian clips were synthesised and streamed through the real
// gateway — the live worker, the live Google v2 recogniser, chirp_3, ka-GE,
// region eu — at 20ms real-time pacing, then followed by trailing silence so
// Google's own endpointer had something to end on:
//
//   said            len     final           from         ms after speech
//   კი              0.88s   კი              ENDPOINTER   2119
//   არა             0.33s   არა             HALF_CLOSE   5604
//   დიახ            0.79s   დიახ.           ENDPOINTER   2308
//   კარგი           0.65s   კარგი           ENDPOINTER   2261
//   ჰო              0.51s   ხო              ENDPOINTER   1901
//   არა, მადლობა    1.76s   არა, მადლობა.   ENDPOINTER   1685
//   კი, მაინტერესებს 1.21s  კი, მაინტერესებს. ENDPOINTER 1348
//   გასაგებია       0.79s   გასაგებია.      ENDPOINTER   2537
//   მაჩვენე         1.11s   მაჩვენე.        ENDPOINTER   2302
//   გააგრძელე       0.88s   გააგრძელე.      ENDPOINTER   2936
//   (long control)  2.83s   (exact)         ENDPOINTER   1358
//
// ELEVEN OF ELEVEN were recognised and resolved to ka-GE. Recognition was
// never the problem. Two things in that table are:
//
//   1. A final arrives 1.3–2.9 SECONDS after the speaker stops. Long enough
//      that it routinely lands after the next turn has already started.
//   2. The shortest clip never endpointed at all. It came back only when the
//      audio side half-closed.
//
// So the fix is not in the recogniser. It is in refusing to throw away a
// final that arrives at an inconvenient moment, which is what the client did:
// `if (this.closed || this.turnInFlight) return;`. The visitor said a word,
// the recogniser heard it correctly, and the browser dropped it on the floor.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync('src/lib/comm/voiceClient.ts', 'utf8');
const strip = (s) =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The body of one method, by name, with its comments removed. */
function methodBody(name) {
  const at = src.indexOf(`private async ${name}(`);
  assert.ok(at > 0, `${name} is missing`);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return strip(src.slice(open, i + 1));
  }
  throw new Error(`${name} never closes`);
}

// ── A real transcript is never discarded ───────────────────────────────────

test('a final that arrives mid-turn is held, not dropped', () => {
  const body = methodBody('onLiveFinal');
  // The old shape: one guard that returned for both conditions at once.
  assert.ok(!/if\s*\(this\.closed\s*\|\|\s*this\.turnInFlight\)\s*return/.test(body),
    'a busy turn must not be a reason to lose a sentence the recogniser committed to');
  assert.ok(/this\.pendingFinal\s*=/.test(body), 'it has to be kept somewhere');
});

test('the held sentence is answered once the floor is free', () => {
  const take = methodBody('takeTurn');
  assert.ok(/this\.pendingFinal/.test(take), 'takeTurn must drain what it deferred');
  // Drained AFTER turnInFlight is cleared, or the drain re-defers itself and
  // the sentence is stuck until the call ends.
  const cleared = take.indexOf('this.turnInFlight = false');
  const drained = take.indexOf('this.pendingFinal');
  assert.ok(cleared > -1 && drained > cleared,
    'draining before the flag is cleared would defer it again forever');
});

test('the deferral is counted, because silence used to be its only symptom', () => {
  assert.ok(/finalsDeferred/.test(src),
    'a dropped sentence looked exactly like a broken microphone');
});

test('a closed session still refuses, so teardown cannot start a turn', () => {
  const body = methodBody('onLiveFinal');
  assert.ok(/if\s*\(this\.closed\)\s*return/.test(body));
});

// ── The fix must not be the one we were told not to make ──────────────────

test('nothing partial or invented is ever sent as a turn', () => {
  const body = methodBody('onLiveFinal');
  // onLiveFinal is reached only from the transcriber's onFinal. Partials go to
  // showPartial and are displayed, never committed.
  assert.ok(!/showPartial|onPartial/.test(body),
    'an unstable partial must never become a server turn');
  const partial = src.slice(src.indexOf('private showPartial('));
  assert.ok(/final:\s*false/.test(partial.slice(0, 600)),
    'partial transcript turns must be marked non-final');
});

test('only one sentence is ever held, so a backlog cannot pile up', () => {
  // While a turn runs the microphone is gated and nothing new is transcribed,
  // so a second deferred final would mean a bug elsewhere. Holding a queue
  // would answer stale sentences minutes later.
  assert.ok(/pendingFinal:\s*\{\s*text: string; detected: string \| null \}\s*\| null/.test(src),
    'the holder is one slot, not an array');
});

// ── The stream has to still be alive when they speak ──────────────────────
//
// MEASURED against the deployed worker. A probe streamed Georgian, then sent
// nothing at all — exactly what the client does while the assistant speaks —
// and the recogniser reported:
//
//   code 10, "Stream timed out after receiving no more client requests."
//
// classified as non-retryable, so the socket closed 1011 and the session
// could no longer hear anybody. Nine seconds of quiet was enough. An ordinary
// reply is longer than that, which is why an acknowledgement after a longer
// answer went nowhere: not a recognition failure, a dead stream.

const googleSrc = readFileSync('src/lib/comm/googleTranscribe.ts', 'utf8');
const workerSrc = readFileSync('official-worker/src/speech/GoogleSpeechStream.ts', 'utf8');
const stripped = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('a gated stream is kept alive rather than left to time out', () => {
  const g = stripped(googleSrc);
  assert.ok(/startKeepalive\(\)/.test(g) && /stopKeepalive\(\)/.test(g));
  // Started when gating begins and stopped when it ends — a keepalive that
  // outlives the gate would send silence over the visitor's own speech.
  assert.ok(/if\s*\(gated\)\s*this\.startKeepalive\(\);/.test(g));
  assert.ok(/else\s*this\.stopKeepalive\(\);/.test(g));
  assert.ok(/stopKeepalive\(\);/.test(g.slice(g.indexOf('close(): void'))), 'and stopped on close');
});

test('the keepalive is silence, not audio and not noise', () => {
  const g = stripped(googleSrc);
  const fn = g.slice(g.indexOf('private startKeepalive'), g.indexOf('private stopKeepalive'));
  // A zero-filled buffer. Nothing in it can be transcribed, so it produces no
  // interim, no final and no turn — it only keeps the socket open.
  assert.ok(/new Uint8Array\(samples \* 2\)/.test(fn), 'must be zeroed samples');
  assert.ok(!/Math\.random|noise/i.test(fn), 'never send invented audio to a recogniser');
});

test('the microphone stays gated: echo protection is unchanged', () => {
  const g = stripped(googleSrc);
  const append = g.slice(g.indexOf('append(pcm: Int16Array)'));
  assert.ok(/if\s*\(!this\.isReady \|\| this\.gated \|\| !pcm\.length\) return;/.test(append),
    'gated microphone audio must still be dropped');
});

test('the keepalive is cheap enough to leave on', () => {
  const ms = Number(/GATED_KEEPALIVE_MS = (\d+)/.exec(googleSrc)?.[1]);
  const secs = Number(/KEEPALIVE_SECONDS = ([0-9.]+)/.exec(googleSrc)?.[1]);
  assert.ok(ms >= 1000 && ms <= 5000, `${ms}ms is outside the provider's tolerance or wasteful`);
  // Billed silence: keep the duty cycle small rather than streaming the gap.
  assert.ok((secs * 1000) / ms < 0.1, 'more than a tenth of the gap is not a keepalive');
});

test('an idle abort reopens the stream instead of ending the conversation', () => {
  const w = stripped(workerSrc);
  assert.ok(/code === 10/.test(w), 'ABORTED must be recoverable');
  const line = /const retryable =[\s\S]*?;/.exec(w)?.[0] ?? '';
  for (const code of ['11', '4', '14', '10']) {
    assert.ok(line.includes(`code === ${code}`), `${code} must still be retryable`);
  }
});
