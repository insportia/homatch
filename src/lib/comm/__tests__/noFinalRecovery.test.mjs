// One empty STT turn must never kill the session.
//
// THE REAL ANDROID SESSION THIS REPRODUCES (production, 05:09:21Z):
//
//   microphone captured           43,690 B of ka-GE PCM reached the worker
//   socket half-closed for final  5.56s, no upstream error
//   final delivered               NONE
//   client rotation               NONE      <- rotation only ran on a final
//   turns                         0
//   session                       dead, panel still reading as alive
//
// That path was byte-identical in the last known-good build; it had simply
// never been hit. These tests DRIVE the decision that now exists, rather than
// reading its source -- the class is the one the session delegates to.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FinalWatch } from '../finalWatch.ts';

const make = () => new FinalWatch({ timeoutMs: 6000, maxConsecutive: 3 });

/**
 * A minimal session driven the way VoiceSession drives the watch, so a test
 * can say what the SESSION did -- rotated, listened again, called the model.
 */
function session() {
  const w = make();
  const log = [];
  const s = {
    phase: 'READY', state: 'LISTENING', liveEnded: false, sockets: 1, modelCalls: 0, log,
    finalize(now) { s.liveEnded = true; s.state = 'UNDERSTANDING'; w.requested(now); log.push('finalize'); },
    final(text, now) {
      if (text.trim()) { w.arrived(); s.modelCalls += 1; s.rotate(); log.push('turn'); }
      else s.miss('EMPTY_FINAL', now);
    },
    closeWithoutFinal(now) { s.miss('CLOSED_WITHOUT_FINAL', now); },
    tick(now) { const d = w.tick(now); if (d) s.apply(d); },
    miss(reason, now) { const d = w.missed(reason, now); if (d) s.apply(d); },
    apply(d) {
      s.liveEnded = false;
      if (d.kind === 'GIVE_UP') { s.phase = 'FAILED'; s.state = 'LISTENING'; log.push('give_up'); return; }
      s.rotate(); s.state = 'LISTENING'; log.push(`recover:${d.reason}`);
    },
    rotate() { s.sockets += 1; s.liveEnded = false; s.phase = 'READY'; },
    canEndTurn() { return !s.liveEnded && s.phase === 'READY'; },
  };
  return { s, w };
}

test('socket closes without a final → recovery → second utterance completes', () => {
  const { s, w } = session();
  s.finalize(1000);                         // user spoke, end of turn
  assert.equal(s.canEndTurn(), false, 'a final is owed');
  s.closeWithoutFinal(1600);                // the Android case
  assert.deepEqual(s.log, ['finalize', 'recover:CLOSED_WITHOUT_FINAL'], 'NO_FINAL_RECOVERY');
  assert.equal(s.modelCalls, 0, 'EMPTY_FINAL_NOT_SENT_TO_LUNA');
  assert.equal(s.sockets, 2, 'FRESH_SOCKET_READY');
  assert.equal(s.phase, 'READY');
  assert.equal(s.state, 'LISTENING', 'MIC_REOPENS: the session is listening again');
  assert.equal(s.canEndTurn(), true, 'the end-of-turn latch is released');
  // The visitor repeats the sentence, and this time the recogniser answers.
  s.finalize(5000);
  s.final('ვაკეში ბინა მაინტერესებს', 5600);
  assert.equal(s.modelCalls, 1, 'SECOND_UTTERANCE_COMPLETES');
  assert.equal(w.consecutiveNoFinals, 0, 'a success resets the streak');
  assert.equal(w.noFinalCount, 1);
  assert.equal(w.noFinalRecoveries, 1);
});

test('an EMPTY final is a miss, not a turn', () => {
  const { s } = session();
  s.finalize(1000);
  s.final('', 1500);
  assert.equal(s.modelCalls, 0, 'nothing is sent to the model for nothing');
  assert.equal(s.sockets, 2, 'and a fresh socket is opened');
  assert.equal(s.state, 'LISTENING');
});

test('a final that never comes AND a socket that never closes still recovers', () => {
  // The third shape: silence from both. The session clock resolves it.
  const { s, w } = session();
  s.finalize(1000);
  s.tick(4000);
  assert.equal(s.sockets, 1, 'not yet: inside the window');
  s.tick(7100);
  assert.equal(s.sockets, 2, 'NO_SILENT_FREEZE: a final owed for 6s is a miss');
  assert.equal(w.lastNoFinalReason, 'FINAL_TIMEOUT');
});

test('one miss decides once: a late close after a timeout is not a second recovery', () => {
  const { s } = session();
  s.finalize(1000);
  s.tick(7100);                              // timeout → recover (socket 2)
  s.closeWithoutFinal(7200);                 // the old socket finally closes
  assert.equal(s.sockets, 2, 'the same miss must not rotate twice');
});

test('three consecutive no-finals are bounded: an explicit state, not a loop', () => {
  const { s, w } = session();
  for (const t of [1000, 3000, 5000]) { s.finalize(t); s.closeWithoutFinal(t + 500); }
  assert.deepEqual(s.log.filter((l) => l !== 'finalize'),
    ['recover:CLOSED_WITHOUT_FINAL', 'recover:CLOSED_WITHOUT_FINAL', 'give_up'],
    'THREE_NO_FINALS_BOUNDED');
  assert.equal(s.phase, 'FAILED', 'an explicit failure state');
  assert.equal(s.sockets, 3, 'exactly two reconnects, never a third');
  assert.equal(w.noFinalRecoveries, 2);
  assert.equal(w.consecutiveNoFinals, 3);
  assert.equal(s.state, 'LISTENING', 'and the session is still usable on the batch path');
});

test('a success between misses resets the bound', () => {
  const { s, w } = session();
  s.finalize(1000); s.closeWithoutFinal(1500);
  s.finalize(3000); s.closeWithoutFinal(3500);
  s.finalize(5000); s.final('კი', 5500);          // success
  s.finalize(7000); s.closeWithoutFinal(7500);
  assert.equal(w.consecutiveNoFinals, 1, 'the streak restarted after the success');
  assert.notEqual(s.phase, 'FAILED', 'three misses that were not consecutive do not give up');
});

test('the trace can tell the four outcomes apart', () => {
  const { s, w } = session();
  s.finalize(1000); s.final('კი', 1400);
  assert.equal(w.socketCloseHadFinal, true, 'successful final');
  s.finalize(2000); s.closeWithoutFinal(2500);
  assert.equal(w.socketCloseHadFinal, false, 'no-final recovered');
  assert.equal(w.socketCloseReason, 'CLOSED_WITHOUT_FINAL');
  assert.equal(w.lastNoFinalAt, 2500);
  // provider/socket error is a different path (onUnavailable → abandonLive)
  // and is not counted here: the watch only counts finals that were owed.
});

// ── The session delegates to the tested class ─────────────────────────────

const client = readFileSync('src/lib/comm/voiceClient.ts', 'utf8');
const google = readFileSync('src/lib/comm/googleTranscribe.ts', 'utf8');
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('the session watches every finalize and acts on every miss', () => {
  const c = strip(client);
  assert.match(c, /this\.finalWatch\.requested\(Date\.now\(\)\)/, 'finalize must start the watch');
  assert.match(c, /if \(said\) this\.finalWatch\.arrived\(\)/, 'a usable final must settle it');
  assert.match(c, /onNoFinal: \(reason\) => \{/, 'the socket must be able to report a miss');
  assert.match(c, /this\.finalWatch\.tick\(Date\.now\(\)\)/, 'and the clock must catch the silent case');
  assert.match(c, /void this\.rotateLive\(\);\s*\n\s*if \(this\.state === 'UNDERSTANDING'\) this\.setState\('LISTENING'\)/,
    'recovery is a rotation plus a return to listening');
});

test('the Google socket reports the two silences the session could not see', () => {
  const g = strip(google);
  assert.match(g, /this\.finalizing && !this\.deliveredFinal\) this\.cb\.onNoFinal\?\.\('CLOSED_WITHOUT_FINAL'\)/,
    'close-while-finalising with nothing delivered must be reported');
  assert.match(g, /else if \(this\.finalizing\) \{[\s\S]{0,300}?onNoFinal\?\.\('EMPTY_FINAL'\)/,
    'an empty final must be reported');
  assert.match(g, /if \(text\) \{\s*\n\s*this\.deliveredFinal = true;\s*\n\s*this\.cb\.onFinal\(text, heard\)/,
    'and only a NON-EMPTY final ever reaches onFinal -- nothing empty goes to the model');
});
