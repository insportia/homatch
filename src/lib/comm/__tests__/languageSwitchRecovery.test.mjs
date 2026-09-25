/*
 * THE SENTENCE THE VISITOR HAD TO SAY TWICE, AND THE COUNTER THAT WAS NEVER WRITTEN.
 *
 * MEASURED, production session 65bd451d, 2026-09-25T07:31:54Z, one Android
 * device, ONE session (the duplicate-session backstop held). Turn ids ran:
 *
 *   t1 t2 t3 t4  __  t6 t7 t8 t9
 *
 * t5 is missing. It sits exactly at the Georgian-to-Russian switch and never
 * reached the model: `refused_before` on t6 is 0, so it was not refused as
 * gibberish. Russian spoken into a ka-GE socket produces an EMPTY final --
 * nothing, rather than something wrong -- and the client returned to
 * LISTENING. That is the owner's report exactly: the panel says it is
 * listening again and the sentence has to be repeated. The repeat works
 * because the empty final armed the second opinion, so t6 had the `auto`
 * socket running and it heard the Russian.
 *
 * AND THE REASON NOTHING RESCUED IT.
 *
 *   turns_ended_locally        0 on every turn of every session
 *   last_end_turn_speech_ms    0 on every turn of every session
 *   batch_final_chars          0 on all 17 turns across two sessions
 *
 * lastEndTurnSpeechMs is written in exactly one place -- inside
 * maybeEndLiveTurn, on the LOCAL endpoint path. Google's endpointer ends
 * these turns, so that line never runs and the field stays null. Two
 * decisions read it as "speech in this turn":
 *
 *   planRecovery / planFragmentRecovery    if (speechMs < 900) return null
 *   the language probe                     sustained = speechMs >= ...
 *
 * Both therefore returned null on every turn ever recorded. The same-audio
 * recovery path and the switch probe were not unlucky, they were unreachable.
 *
 * t8 is the proof that the exemption was NOT the live root cause: it fired
 * UNSUPPORTED_LANGUAGE at confidence 0.3 with a Devanagari transcript labelled
 * `hi` on an en-pinned socket -- the exemption lifted correctly -- and
 * batch_final_chars was still 0, because the planner had already returned null
 * on the speech floor.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  planRecovery, planFragmentRecovery, consistentWith,
  RECOVERY_MIN_SPEECH_MS, RECOVERY_MIN_WORDS, RECOVERY_MAX_PER_SESSION,
} from '../sameTurnRecovery.ts';

const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');
const CLIENT = read('src/lib/comm/voiceClient.ts');

/** A turn as the planners receive it. */
const turn = (over = {}) => ({
  pinned: 'ka', transcript: '', speechMs: 2_000, spent: 0, ...over,
});

/* ── The dead counter ────────────────────────────────────────────────────*/

test('THE_PRODUCTION_SHAPE: speechMs 0 made every recovery unreachable', () => {
  /*
   * Replaying what production actually passed in. Devanagari on an en-pinned
   * socket is the strongest mismatch the planner recognises, and with the
   * speech duration reading 0 it still declines -- which is what happened on
   * t8 and t9 and why the return to Georgian never recovered.
   */
  const devanagari = 'मुझे एक अपार्टमेंट चाहिए बटुमी में';
  assert.equal(planRecovery(turn({ pinned: 'en', transcript: devanagari, speechMs: 0 })), null);
  assert.equal(planFragmentRecovery(turn({ pinned: 'en', transcript: devanagari, speechMs: 0 })), null);

  // The same turn with its real duration is recognised immediately.
  const plan = planRecovery(turn({ pinned: 'en', transcript: devanagari, speechMs: 2_000 }));
  assert.equal(plan?.reason, 'SCRIPT_MISMATCH');
});

test('THE_CLIENT_NOW_CAPTURES_IT_ON_EVERY_PATH, not only the local endpoint', () => {
  // Written before liveSpeechMs is reset, so whichever endpointer ended the
  // turn, the duration survives it.
  /*
   * REPOINTED AFTER THE FIX, AND THIS IS THE ASSERTION THAT MATTERS.
   *
   * The first version of this pinned the capture as sitting immediately
   * before `this.liveSpeechMs = 0` -- which it did, and which was still
   * wrong: `void this.rotateLive()` six lines earlier zeroes the same counter
   * synchronously, because rotateLive has no await before its own reset. The
   * capture read 0 on every turn ever recorded and the test passed happily.
   *
   * So the property is no longer "next to the reset" but "BEFORE the
   * rotation", which is the thing that was actually broken.
   */
  const final = CLIENT.slice(CLIENT.indexOf('private async onLiveFinal('));
  const capture = final.indexOf('this.lastTurnSpeechMs = Math.round(this.liveSpeechMs);');
  const rotate = final.indexOf('void this.rotateLive();');
  assert.ok(capture > 0, 'the speech duration is never captured');
  assert.ok(rotate > 0, 'the rotation moved; re-check this ordering');
  assert.ok(capture < rotate,
    'the speech duration is captured after rotateLive(), which zeroes it synchronously');
  // Both consumers read the honest number, preferring it over the
  // local-only field that production proved is always null.
  assert.match(CLIENT, /speechMs: this\.lastTurnSpeechMs \|\| \(this\.diag\.lastEndTurnSpeechMs \?\? 0\),/);
  assert.match(CLIENT, /const sustained = \(this\.lastTurnSpeechMs \|\| \(this\.diag\.lastEndTurnSpeechMs \?\? 0\)\)/);
});

/* ── The first utterance after a switch ──────────────────────────────────*/

test('EMPTY_FINAL_AFTER_SPEECH earns a re-read instead of silently resuming', () => {
  /*
   * t5's exact path. The old line returned to LISTENING and threw the
   * utterance away while its audio was still retained; now the retained audio
   * is re-read from the beginning and the turn continues if words come back.
   */
  const block = CLIENT.slice(
    CLIENT.indexOf('if (!said) {'),
    CLIENT.indexOf('this.diag.sttOk += 1;'),
  );
  assert.match(block, /const recovered = await this\.recoverFromEmptyFinal\(\);/);
  assert.match(block, /if \(!recovered\) \{ this\.resumeListening\(\); return; \}/);
  assert.match(block, /said = recovered\.text;/);
  assert.match(block, /detected = recovered\.language \?\? detected;/);
  /*
   * The recovered turn must count as produced, or the socket stays owed a
   * final for ever and the next turn inherits a pending watch. Asserted as
   * facts about the block rather than as one contiguous pattern -- the first
   * version of this pinned the exact line spacing and broke on a comment.
   */
  assert.match(block, /this\.finalWatch\.arrived\(\);/);
  assert.match(block, /this\.producedEpoch = this\.utteranceEpoch;/);
  assert.ok(block.indexOf('recoverFromEmptyFinal') < block.indexOf('resumeListening'),
    'the re-read is attempted after giving up');
});

test('and it is narrow: silence, a cough and a spent budget all decline', () => {
  const fn = CLIENT.slice(
    CLIENT.indexOf('private async recoverFromEmptyFinal'),
    CLIENT.indexOf('private async recoverUtterance'),
  );
  // Real sustained speech only -- the shared floor, imported not restated.
  assert.match(fn, /if \(this\.lastTurnSpeechMs < RECOVERY_MIN_SPEECH_MS\) return null;/);
  // Retained audio only.
  assert.match(fn, /if \(!this\.utterancePcm\.length \|\| !this\.utteranceSamples\) return null;/);
  // Bounded by the same per-session ceiling as every other recovery.
  assert.match(fn, /if \(this\.sameTurnRecoveries >= RECOVERY_MAX_PER_SESSION\) return null;/);
  // A re-read that produces nothing usable changes nothing.
  assert.match(fn, /if \(!text\) return null;/);
});

test('the floor is the shared constant, not a second copy of 900', () => {
  assert.ok(!/EMPTY_FINAL_MIN_SPEECH_MS/.test(CLIENT), 'a duplicate speech floor was reintroduced');
  assert.equal(RECOVERY_MIN_SPEECH_MS, 900);
});

/* ── The four switches, as the planners see them ─────────────────────────*/

test('KA_TO_RU: Cyrillic on a ka-pinned socket is a recognised mismatch', () => {
  const plan = planRecovery(turn({ pinned: 'ka', transcript: 'Мне нужна квартира в Батуми' }));
  assert.equal(plan?.reason, 'SCRIPT_MISMATCH');
});

test('RU_TO_EN: Latin on a ru-pinned socket is a recognised mismatch', () => {
  const plan = planRecovery(turn({ pinned: 'ru', transcript: 'I am looking for a flat by the sea' }));
  assert.equal(plan?.reason, 'SCRIPT_MISMATCH');
});

test('EN_TO_KA: the return that production got stuck on', () => {
  // Georgian spoken into an en-pinned socket comes back as Latin nonsense or,
  // as on t8, as Devanagari. Both are mismatches against the pinned script.
  for (const transcript of ['მინდა ბინა ბათუმში ზღვის ხედით', 'मुझे एक अपार्टमेंट चाहिए']) {
    const plan = planRecovery(turn({ pinned: 'en', transcript }));
    assert.equal(plan?.reason, 'SCRIPT_MISMATCH', `no recovery planned for ${transcript.slice(0, 12)}`);
  }
});

test('KA_RU_EN_KA: every hop in the full sequence plans a recovery', () => {
  const hops = [
    ['ka', 'Мне нужна квартира'],
    ['ru', 'I want a flat near the sea'],
    ['en', 'მინდა ბინა ბათუმში'],
  ];
  hops.forEach(([pinned, transcript], i) => {
    const plan = planRecovery(turn({ pinned, transcript, spent: i }));
    assert.ok(plan, `hop ${i} planned nothing`);
  });
});

/* ── The fast path is not disturbed ──────────────────────────────────────*/

test('HEALTHY_GEORGIAN plans no recovery and stays on the one-stream path', () => {
  /*
   * The whole point of not fixing this with an unconditional second opinion.
   * A real Georgian sentence on a ka socket is in the right script and full of
   * Georgian function words, so both planners decline and the turn costs one
   * stream and no batch call -- exactly as t1 to t4 did in production.
   */
  const said = 'მინდა ბინა ბათუმში ზღვის ხედით და ორი საძინებლით';
  assert.equal(planRecovery(turn({ pinned: 'ka', transcript: said })), null);
  assert.equal(planFragmentRecovery(turn({ pinned: 'ka', transcript: said })), null);
  assert.equal(consistentWith(said, 'ka'), true);
  // And the conditional shadow is still conditional.
  assert.match(CLIENT, /if \(!this\.secondOpinionArmed\) \{/);
  assert.match(CLIENT, /const SECOND_OPINION = true;/);
});

test('SHORT_LEGITIMATE_UTTERANCE is not destroyed for being short', () => {
  // "კი" -- one word, right script. Neither planner touches it, and the
  // empty-final path never sees it because it produced a transcript.
  assert.equal(planRecovery(turn({ pinned: 'ka', transcript: 'კი', speechMs: 400 })), null);
  assert.equal(planFragmentRecovery(turn({ pinned: 'ka', transcript: 'კი', speechMs: 400 })), null);
  assert.equal(consistentWith('კი', 'ka'), true);
});

test('NOISE cannot make the session flap: below the floor nothing is planned', () => {
  for (const speechMs of [0, 200, RECOVERY_MIN_SPEECH_MS - 1]) {
    assert.equal(planRecovery(turn({ pinned: 'ka', transcript: 'ppp qqq', speechMs })), null);
    assert.equal(planFragmentRecovery(turn({ pinned: 'ka', transcript: 'ppp qqq', speechMs })), null);
  }
  // And a session cannot spend more than its ceiling however bad the room is.
  assert.equal(
    planRecovery(turn({ pinned: 'ka', transcript: 'Мне нужна квартира', spent: RECOVERY_MAX_PER_SESSION })),
    null,
  );
});

test('STALE_FINAL protection and the 2500 ms deadline are untouched', () => {
  assert.match(CLIENT, /if \(origin === 'LIVE' && from && from !== this\.live && from !== this\.finalOwedFrom\) \{/);
  assert.match(CLIENT, /const NO_FINAL_TIMEOUT_MS = 2_500;/);
  assert.match(CLIENT, /private get safeToListen\(\): boolean \{/);
  for (const line of [
    'const END_TURN_ACK_MS = 300;',
    'const END_TURN_SHORT_MS = 600;',
    'const END_TURN_LONG_MS = 900;',
  ]) assert.ok(CLIENT.includes(line), `${line} was changed`);
});

test('EMPTY_FINAL is told apart from NO_FINAL in the trace', () => {
  const RECOVERY = read('src/lib/comm/sameTurnRecovery.ts');
  assert.match(RECOVERY, /'NO_FUNCTION_WORDS' \| 'SCRIPT_MISMATCH' \| 'FRAGMENT' \| 'NO_FINAL' \| 'EMPTY_FINAL'/);
  assert.match(CLIENT, /reason: 'EMPTY_FINAL',/);
  assert.match(CLIENT, /'empty_final_recovered'/);
});

/* ── Text must never gate voice ──────────────────────────────────────────*/

test('TEXT_ANIMATION_DOES_NOT_GATE_PLAYBACK', () => {
  /*
   * The owner perceives speech, then animated text, then voice. It is not a
   * frontend gate: the audio branch queues immediately and refers to nothing
   * the text branch produces. Kept as a test because a "wait for the sentence
   * to finish rendering" is the obvious thing for somebody to add later.
   */
  const audio = CLIENT.slice(CLIENT.indexOf("case 'audio': {"), CLIENT.indexOf("case 'action':"));
  assert.match(audio, /this\.enqueuePcm\(event\.pcmBase64, event\.sampleRate\);/);
  // No dependency on the accumulating text, and no await before the enqueue.
  assert.ok(!/\btext\b/.test(audio.slice(0, audio.indexOf('enqueuePcm'))),
    'the audio branch reads the streamed text before queueing audio');
  assert.ok(!/await/.test(audio), 'the audio branch awaits something before playing');
  // The state change follows the enqueue rather than gating it.
  assert.ok(audio.indexOf('enqueuePcm') < audio.indexOf("setState('RESPONDING')"));
});
