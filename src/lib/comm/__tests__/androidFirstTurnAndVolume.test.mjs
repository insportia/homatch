/*
 * THE THREE THINGS A PHYSICAL ANDROID TEST FOUND, AND WHAT EACH ONE WAS.
 *
 * Session 43b3c3ea, 2026-09-25 20:45 UTC, Georgian page, owner speaking
 * Georgian on a real phone. The report was "the beginning is swallowed,
 * Georgian stops working, and it plays at about half volume". Three separate
 * causes, and two of them are not what the symptom sounded like.
 *
 *   THE BEGINNING. Held audio -- the blocks captured while a socket is
 *   connecting or rotating -- IS flushed to the recogniser in order, and the
 *   byte accounting proves nothing was dropped: droppedPcmBytes 0,
 *   voicedWithoutDestinationMs 0, flushedBufferedBytes 38,230 which is 1,195ms
 *   at 16kHz against 768ms of voiced audio. What the held branch did NOT do was
 *   count that speech or retain it. So `liveSpeechMs` read 256ms for an
 *   utterance carrying six seconds of audio, and every recovery gated on
 *   RECOVERY_MIN_SPEECH_MS declined it as too short to be worth re-reading.
 *
 *   GEORGIAN. The ka-GE grant carries candidates ka-GE, en-US, ru-RU, tr-TR, so
 *   Chirp may relabel. It called one Georgian turn `ar-Latn` and the next `en`.
 *   PROVIDER_LATIN took the `en` at 0.7 -- above the locking threshold -- and
 *   the socket was repinned to en-US, which cannot emit Georgian letters, so
 *   SCRIPT evidence could never bring the session back.
 *
 *   THE VOLUME. Nothing in the browser attenuates anything: outputGainValue 1,
 *   AudioContext running, and the client's decode matching the server's meter
 *   to the decibel (-4.6 against -4.6, -8.2 against -8.2). Cartesia's speech
 *   arrives at -21.7, -25.8 and -22.8 dBFS RMS where ordinary speech is about
 *   -16 to -20. The quiet is at the source.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveTurnLanguage } from '../talkLanguage.ts';
import { functionWordHits } from '../languageRegistry.ts';
import { RECOVERY_MIN_SPEECH_MS } from '../sameTurnRecovery.ts';

const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');
const CLIENT = read('src/lib/comm/voiceClient.ts');

/** Source with comments stripped, so an absence test cannot pass by reading prose. */
const CODE = CLIENT
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((l) => (l.trimStart().startsWith('//') ? '' : l))
  .join('\n');

/* ── T. The first turn ───────────────────────────────────────────────────*/

test('HELD_AUDIO_IS_COUNTED_AS_SPEECH, because the recogniser was given it', () => {
  /*
   * The defect, stated as the two lines that caused it: the HELD branch
   * returned at the top, and the speech clock was grown below it under
   * `if (liveReady)`. So audio that WAS sent -- flushed in order on ready() --
   * contributed nothing to the duration every recovery gate is judged on.
   */
  assert.match(CODE, /if \(route\.kind === 'HELD'\) \{/);
  const heldAt = CODE.indexOf("if (route.kind === 'HELD') {");
  const branch = CODE.slice(heldAt, CODE.indexOf('if (liveReady)', heldAt));
  assert.match(branch, /this\.heldVoicedMs \+= blockMs;/,
    'held voiced audio is not being counted');
  assert.match(branch, /\breturn;/, 'the HELD branch must still not reach batch capture');
});

test('AND_HANDED_TO_THE_SPEECH_CLOCK_AT_THE_FLUSH, where it provably arrived', () => {
  // Credited at the flush and nowhere else: that is the moment the held bytes
  // reach a socket, so it is the only moment the credit is honest.
  const flushAt = CODE.indexOf('const held = this.router.ready();');
  assert.ok(flushAt > 0, 'the flush moved or was renamed');
  const flush = CODE.slice(flushAt, flushAt + 1400);
  assert.match(flush, /this\.liveSpeechMs \+= this\.heldVoicedMs;/);
  assert.match(flush, /this\.heldVoicedMs = 0;/, 'the credit must be spent exactly once');
});

test('AND_RETAINED, so a recovery re-reads the opening rather than the tail', () => {
  /*
   * utterancePcm is the audio a same-turn recovery re-reads. The HELD branch
   * returned before it, so the recovery -- the thing that makes abandoning a
   * slow socket safe -- worked from an utterance with its first syllable
   * missing. That is the swallowed beginning, and it is a defect rather than a
   * provider's fault.
   */
  const flushAt = CODE.indexOf('const held = this.router.ready();');
  const flush = CODE.slice(flushAt, flushAt + 1400);
  assert.match(flush, /this\.utterancePcm\.push\(chunk\);/);
  assert.match(flush, /this\.utteranceSamples \+= chunk\.length;/);
  // Still bounded. An unbounded retained utterance is a memory leak wearing a
  // bug fix, on a path that runs for every rotation of every session.
  assert.match(flush, /UTTERANCE_KEEP_MS/, 'the retained utterance is no longer bounded');
  assert.match(flush, /this\.utterancePcm\.shift\(\)!/);
});

test('ABANDONED_HELD_AUDIO_IS_NOT_CREDITED, because nothing received it', () => {
  /*
   * When the router gives up, what it was holding is discarded. Crediting it
   * afterwards would claim the visitor had been heard for longer than any
   * recogniser was ever given -- the opposite error, and a worse one, because
   * it would make a recovery re-read audio that is not there.
   */
  const at = CODE.indexOf('private noteLiveAbandoned(): void {');
  assert.ok(at > 0, 'noteLiveAbandoned was renamed');
  const body = CODE.slice(at, at + 700);
  assert.match(body, /this\.heldVoicedMs = 0;/);
});

test('THE_NO_FINAL_READ_BACK_EXISTS, which the shorter deadline assumed', () => {
  /*
   * NO_FINAL_TIMEOUT_MS was cut from 6,000ms to 2,500ms on the stated grounds
   * that "recovery ... re-reads the RETAINED AUDIO of this same utterance
   * through the batch recogniser". RecoveryReason declares 'NO_FINAL' and
   * recoverUtterance's `used` rule handles it -- and nothing ever passed it.
   * The timeout rotated instead, handing the next socket the tail of a sentence
   * whose beginning went to the one just abandoned.
   */
  assert.match(CODE, /private async readBackAfterNoFinal\(/);
  assert.match(CODE, /void this\.readBackAfterNoFinal\(decision\.reason\);/);
  assert.match(CODE, /this\.recoverUtterance\('NO_FINAL', this\.language\.current, ''\)/);
  // The deadline itself is unchanged: this restores the safety case that was
  // used to justify it rather than quietly widening it back out.
  assert.match(CODE, /const NO_FINAL_TIMEOUT_MS = 2_500;/);
});

test('and it cannot answer a turn that something else already answered', () => {
  const at = CODE.indexOf('private async readBackAfterNoFinal(');
  const body = CODE.slice(at, CODE.indexOf('private async recoverUtterance(', at));
  // The epoch is captured before the batch call and re-checked after it: a
  // visitor who spoke again has opened a new utterance, and an answer to the
  // previous one must not land on top of it.
  assert.match(body, /const epoch = this\.utteranceEpoch;/);
  assert.match(body, /epoch !== this\.utteranceEpoch/);
  assert.match(body, /this\.producedEpoch === epoch/);
  // Bounded by the same session budget as every other recovery.
  assert.match(body, /RECOVERY_MAX_PER_SESSION/);
  assert.match(body, /RECOVERY_MIN_SPEECH_MS/);
});

test('A_SHORT_FIRST_UTTERANCE_CLEARS_THE_RECOVERY_FLOOR once held speech counts', () => {
  /*
   * The arithmetic that decided this, from the real session: 768ms of voiced
   * audio arrived before the socket was ready and 256ms after it. Judged on the
   * 256 the utterance is below the floor and no recovery is even attempted;
   * judged on what the recogniser was actually given, it is above it.
   */
  const heldVoicedMs = 768;
  const afterReadyMs = 256;
  assert.ok(afterReadyMs < RECOVERY_MIN_SPEECH_MS,
    'the old accounting must be the one that declined');
  assert.ok(heldVoicedMs + afterReadyMs >= RECOVERY_MIN_SPEECH_MS,
    `${heldVoicedMs + afterReadyMs}ms should clear the ${RECOVERY_MIN_SPEECH_MS}ms floor`);
});

test('A_DROPPED_TURN_DOES_NOT_MOVE_THE_SESSION_LANGUAGE', () => {
  /*
   * takeTurn opens `if (this.closed || this.turnInFlight || !said.trim())
   * return;` -- a silent drop. It used to happen AFTER the language had been
   * committed, so an utterance that was never sent, never answered and never
   * shown still decided what language the rest of the session was heard in.
   * The refusal branch beside it already states the rule: a turn we will not
   * send to the model is a turn we did not understand.
   */
  const commitAt = CODE.indexOf('const before = this.language.current;');
  assert.ok(commitAt > 0, 'the language commit moved');
  const guardAt = CODE.indexOf('if (this.turnInFlight) {');
  assert.ok(guardAt > 0, 'the in-flight drop is not guarded');
  assert.ok(guardAt < commitAt, 'the language is still committed before the drop');
  const guard = CODE.slice(guardAt, commitAt);
  assert.match(guard, /turnsDroppedInFlight/, 'the drop is still invisible');
  assert.match(guard, /this\.resumeListening\(\);/,
    'a dropped turn must not leave the session waiting for an answer');
  assert.match(guard, /return;/);
});

/* ── U. Language ─────────────────────────────────────────────────────────*/

const resolve = (over) => resolveTurnLanguage({
  transcript: '', providerLanguage: null, providerDetected: false, firstTurn: false,
  sessionLanguages: ['ka'], unconfirmedLanguage: null,
  previousSessionLanguage: 'ka', pageLocale: 'ka', ...over,
});

test('GEORGIAN_STAYS_GEORGIAN when it is written in Georgian', () => {
  const r = resolve({ transcript: 'ვაკეში ორ საძინებლიან ბინას ვეძებ', providerLanguage: 'ka' });
  assert.equal(r.resolvedLanguage, 'ka');
  assert.equal(r.resolutionReason, 'SCRIPT');
});

test('LATIN_ENTITIES_INSIDE_GEORGIAN_ARE_NOT_A_SWITCH', () => {
  // The case named in the report, verbatim. Georgian letters dominate, so the
  // brand, the city and the currency never get a vote.
  for (const said of [
    'Homatch-ზე ვეძებ ბინას თბილისში 150,000 USD-მდე',
    'ბათუმში ვეძებ ბინას 200,000 USD-მდე',
    'Homatch ROI რამდენია ვაკეში',
  ]) {
    const r = resolve({ transcript: said, providerLanguage: 'ka' });
    assert.equal(r.resolvedLanguage, 'ka', `${said} left Georgian`);
  }
});

test('ONE_BORROWED_WORD_CANNOT_TAKE_A_GEORGIAN_SESSION_TO_ENGLISH', () => {
  /*
   * The regression itself. A transliterated Georgian sentence is Latin, long,
   * and reaches one English function word by accident -- `me` is a Georgian
   * word too. `hasAnyFunctionWord` asked only whether ANY was present, so one
   * accident was enough to leave the session's own alphabet.
   */
  const transliterated = 'me vedzeb bina vakeshi ormocdaati ათas dolarshi';
  assert.ok(functionWordHits(transliterated, 'en') < 2,
    'this fixture must carry at most one English function word to be the case at issue');
  const r = resolve({
    transcript: transliterated, providerLanguage: 'en', providerDetected: true,
  });
  assert.notEqual(r.resolvedLanguage, 'en',
    'a transliteration with one borrowed word took the session to English');
  assert.equal(r.resolvedLanguage, 'ka');
});

test('A_REAL_ENGLISH_SENTENCE_STILL_SWITCHES, so this is not deafness', () => {
  /*
   * The other direction, which matters just as much: somebody who genuinely
   * changes language must be heard the first time. A real English sentence
   * carries several of its own function words without trying.
   */
  const english = 'I am looking for a two bedroom flat in Vake up to 160 thousand dollars';
  assert.ok(functionWordHits(english, 'en') >= 2, 'fixture is not recognisably English');
  const r = resolve({ transcript: english, providerLanguage: 'en', providerDetected: true });
  assert.equal(r.resolvedLanguage, 'en');
});

test('AN_EXPLICIT_REQUEST_STILL_SWITCHES', () => {
  const ru = resolve({
    transcript: 'Давайте по-русски, я ищу квартиру в Вакe',
    providerLanguage: 'ru', providerDetected: true,
  });
  assert.equal(ru.resolvedLanguage, 'ru', 'Cyrillic is decisive and must stay decisive');
});

test('A_NOISY_TOKEN_NEVER_MUTATES_THE_SESSION_LANGUAGE', () => {
  // The shapes Chirp actually produced for Georgian: short Latin nonsense.
  for (const noise of ['Wackisch', 'Karki', 'dir', 'Ki, ma interesas.']) {
    const r = resolve({ transcript: noise, providerLanguage: 'en', providerDetected: true });
    assert.equal(r.resolvedLanguage, 'ka', `${noise} moved the session`);
  }
});

test('THE_SESSION_IS_NOT_STICKY_FOREVER: Georgian can be returned to', () => {
  // Leaving is now harder; coming back must not be. Georgian letters resolve by
  // SCRIPT at confidence 1 from an English session, as they always did.
  const r = resolve({
    transcript: 'კარგი, მაშინ ვაკეში ვეძებ', providerLanguage: 'ka',
    previousSessionLanguage: 'en', sessionLanguages: ['ka', 'en'], pageLocale: 'ka',
  });
  assert.equal(r.resolvedLanguage, 'ka');
});

/* ── V. Volume ───────────────────────────────────────────────────────────*/

/*
 * THE VOLUME SECTION MOVED, AND SO DID THE MECHANISM IT GUARDED.
 *
 * This file's volume tests originally held a client-side makeup gain on the
 * output GainNode, computed from the previous turn's measurement. Production
 * then showed that design could not work: turn 1 of every session reported
 * `outputGainReason UNITY_NOT_MEASURED:NO_PREVIOUS_TURN`, gain 1, so the first
 * reply -- the one the owner judges, and the one they described as starting
 * quiet -- always played at the provider's level. It was also capped by the
 * peak at about 3dB against a measured 6.3dB deficit.
 *
 * Loudness is now settled at the source, before the bytes are sent, and is
 * tested in loudnessNormalisation.test.mjs where the real limiter is run over
 * real signals. What remains here is the part this file is still the right home
 * for: that the browser does not attenuate, and does not try to correct either.
 */

test('THE_CLIENT_DOES_NOT_TOUCH_PLAYBACK_GAIN, in either direction', () => {
  // Two corrections in two places is how a product ends up quiet with every
  // metric green. There is exactly one now, and it is not here.
  assert.ok(!/applyMeasuredMakeupGain|makeupGainFor/.test(CODE),
    'the client is correcting loudness again');
  assert.ok(!/outputGain\.gain\.value = /.test(CODE),
    'something assigns the output gain directly');
  assert.ok(!/outputGain\.gain\.(setValueAtTime|linearRampToValueAtTime)/.test(CODE),
    'something schedules the output gain');
});

test('AND_THE_NODE_IS_STILL_THERE, because two other things need it', () => {
  // The visualiser reads the analyser behind it and barge-in ducks through it.
  assert.match(CODE, /this\.outputGain = this\.audioContext\.createGain\(\);/);
  assert.match(CODE, /this\.outputGain\.connect\(this\.outputAnalyser\);/);
  assert.match(CODE, /this\.outputAnalyser\.connect\(this\.audioContext\.destination\);/);
  // And it is reported, so "nothing here is attenuating" stays checkable.
  assert.match(CODE, /outputGainValue: this\.outputGain\?\.gain\.value \?\? null,/);
});

test('THE_PLAYER_PLAYS_THROUGH_THAT_NODE, not straight at the destination', () => {
  /*
   * The question the owner was right to insist on: a gain node nothing plays
   * through proves nothing. The player is constructed with it as its
   * destination, and pcmPlayer connects every source to that destination -- so
   * there is one graph and the assistant's voice is inside it.
   */
  assert.match(CODE, /this\.player = new PcmStreamPlayer\(this\.audioContext, this\.outputGain\);/);
  const PLAYER = read('src/lib/comm/pcmPlayer.ts');
  assert.match(PLAYER, /constructor\(ctx: AudioContext, destination: AudioNode\)/);
  assert.match(PLAYER, /source\.connect\(this\.destination\);/);
  assert.ok(!/connect\(this\.ctx\.destination\)/.test(PLAYER),
    'a source bypasses the gain node and goes straight to the destination');
});

test('THE_MICROPHONE_MONITOR_STAYS_MUTED, and is not the playback path', () => {
  /*
   * There is one other gain node at zero, and it is why a naive grep for a low
   * gain misleads: the microphone is routed to a muted sink so the phone does
   * not scream at its owner. It must stay at zero and stay off the playback graph.
   */
  const at = CODE.indexOf('const sink = this.audioContext.createGain();');
  assert.ok(at > 0, 'the microphone sink moved');
  const body = CODE.slice(at, at + 300);
  assert.match(body, /sink\.gain\.value = 0;/);
  assert.match(body, /this\.processor\.connect\(sink\);/);
});

test('NO_PERSISTED_VOLUME_PREFERENCE can reintroduce a quiet start', () => {
  // A stale stored preference is the other way "it starts quiet" happens. There
  // is no such preference: loudness is decided server-side, per phrase.
  assert.ok(!/localStorage|sessionStorage/.test(CODE), 'the client stores audio state');
});
