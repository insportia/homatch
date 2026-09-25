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

/** The real makeup-gain rule, lifted from the source and run. */
const makeup = (() => {
  const target = /TARGET_SPEECH_RMS_DBFS = (-?[\d.]+)/.exec(CODE);
  const ceiling = /PEAK_CEILING_DBFS = (-?[\d.]+)/.exec(CODE);
  const max = /MAX_MAKEUP_DB = (-?[\d.]+)/.exec(CODE);
  assert.ok(target && ceiling && max, 'the makeup-gain constants are gone');
  const T = Number(target[1]); const C = Number(ceiling[1]); const M = Number(max[1]);
  return {
    T, C, M,
    gain(speechRmsDbFS, sessionPeak) {
      const wanted = T - speechRmsDbFS;
      const headroom = C - (20 * Math.log10(sessionPeak));
      const db = Math.min(wanted, headroom, M);
      return !Number.isFinite(db) || db <= 0 ? 1 : 10 ** (db / 20);
    },
  };
})();

test('THE_DEFAULT_IS_UNITY, and unmeasured audio changes nothing', () => {
  /*
   * The bug this guards is the one the report suspected: an app that quietly
   * starts at 0.5 or 0.7. The node is created and left alone, and a correction
   * is applied only from a measurement of a reply that has actually played.
   */
  assert.match(CODE, /this\.outputGain = this\.audioContext\.createGain\(\);/);
  const at = CODE.indexOf('this.outputGain = this.audioContext.createGain();');
  const after = CODE.slice(at, at + 400);
  assert.ok(!/outputGain\.gain\.value = 0?\.\d/.test(after),
    'the output gain is being initialised below unity');
  const m = CODE.indexOf('private makeupGainFor(');
  const body = CODE.slice(m, CODE.indexOf('private applyMeasuredMakeupGain', m));
  assert.match(body, /report\.measured !== true/);
  assert.match(body, /return \{ gain: 1, reason: `UNITY_NOT_MEASURED/);
});

test('AND_NEVER_BELOW_UNITY, whatever the measurement says', () => {
  // A loud reply asks for negative gain. Attenuating the assistant is the
  // failure being fixed, so the answer is unity, not 0.7.
  assert.equal(makeup.gain(-6, 0.9), 1, 'a loud reply was attenuated');
  assert.equal(makeup.gain(makeup.T, 0.5), 1, 'a reply already at target was touched');
  for (const [rms, peak] of [[-30, 0.99], [-19, 0.5], [-10, 0.95], [-16, 0.891]]) {
    assert.ok(makeup.gain(rms, peak) >= 1, `gain fell below unity at ${rms}dBFS/${peak}`);
  }
});

test('CLIPPING_IS_ARITHMETICALLY_IMPOSSIBLE, not merely avoided', () => {
  /*
   * The cap is derived from the loudest sample MEASURED so far, so the gain can
   * never carry that peak past the ceiling. This is the property that makes
   * this a measured correction rather than the "+6dB and hope" the brief
   * forbids -- and sessionPeak only grows, so the cap only tightens.
   */
  const ceilingLinear = 10 ** (makeup.C / 20);
  for (let peak = 0.05; peak <= 1.0; peak += 0.05) {
    for (const rms of [-35, -30, -27.9, -25.8, -22.8, -21.7, -19, -12]) {
      const g = makeup.gain(rms, peak);
      /*
       * Two different guarantees, and only one of them is about the ceiling.
       *
       * Where a correction is APPLIED it must land under the ceiling -- that is
       * the cap doing its work. Where none is applied the audio is passed
       * through untouched, so a source that already peaks at 0.99 still peaks
       * at 0.99: above the ceiling, and correctly so, because attenuating the
       * assistant is the failure this whole change exists to avoid. What must
       * hold in both cases is that nothing clips.
       */
      if (g > 1) {
        assert.ok(peak * g <= ceilingLinear + 1e-9,
          `peak ${peak} * gain ${g.toFixed(3)} = ${(peak * g).toFixed(4)} exceeds the ceiling`);
      } else {
        assert.equal(g, 1, 'the only alternative to a correction is passing it through');
      }
      assert.ok(peak * g <= 1 + 1e-9, `a sample would have clipped at ${peak}/${rms}`);
    }
  }
});

test('THE_CORRECTION_IS_BOUNDED, so a broken measurement cannot amplify a hiss', () => {
  const maxLinear = 10 ** (makeup.M / 20);
  // Digital silence with a tiny peak asks for an enormous correction.
  assert.ok(makeup.gain(-90, 0.001) <= maxLinear + 1e-9);
  assert.ok(makeup.gain(-60, 0.01) <= maxLinear + 1e-9);
});

test('THE_REAL_MEASUREMENTS_GET_AN_AUDIBLE_BUT_SAFE_CORRECTION', () => {
  /*
   * The three turns from the physical session, with the session peak the client
   * actually reported (0.5907). This is the number that answers "is it worth
   * shipping": about +3.5dB, roughly one and a half times the amplitude, with
   * the loudest sample landing exactly on the ceiling and not past it.
   */
  const sessionPeak = 0.5907;
  for (const rms of [-21.7, -25.8, -22.8]) {
    const g = makeup.gain(rms, sessionPeak);
    const db = 20 * Math.log10(g);
    assert.ok(db > 2.5, `only ${db.toFixed(2)}dB of correction for ${rms}dBFS speech`);
    assert.ok(db <= makeup.M, 'past the bound');
    assert.ok(sessionPeak * g <= 10 ** (makeup.C / 20) + 1e-9);
  }
});

test('THE_GAIN_IS_RAMPED_AND_LANDS_ON_THE_TARGET', () => {
  /*
   * A step change in gain between two samples is a click. A ramp that never
   * arrives is worse: it leaves the reply playing under the gain it was given,
   * which is the "fade that stays below unity" the brief calls out. So the ramp
   * is short and ends AT the value.
   */
  const at = CODE.indexOf('private applyMeasuredMakeupGain(): void {');
  assert.ok(at > 0, 'the gain is no longer applied');
  const body = CODE.slice(at, at + 1100);
  assert.match(body, /cancelScheduledValues\(now\)/);
  assert.match(body, /linearRampToValueAtTime\(gain, now \+ 0\.03\)/);
  assert.match(body, /gainNode\.gain\.value = gain;/, 'no fallback for a context that will not schedule');
});

test('THE_MICROPHONE_MONITOR_STAYS_MUTED, and is not the playback path', () => {
  /*
   * There is one other gain node at zero, and it is the reason a naive grep for
   * "gain 0.x" is misleading: the microphone is routed to a muted sink so the
   * phone does not scream at its owner. It must stay at zero, and it must stay
   * off the playback graph.
   */
  const at = CODE.indexOf('const sink = this.audioContext.createGain();');
  assert.ok(at > 0, 'the microphone sink moved');
  const body = CODE.slice(at, at + 300);
  assert.match(body, /sink\.gain\.value = 0;/);
  assert.match(body, /this\.processor\.connect\(sink\);/);
  // And the assistant's voice goes through the OTHER node.
  assert.match(CODE, /this\.outputGain\.connect\(this\.outputAnalyser\);/);
  assert.match(CODE, /this\.outputAnalyser\.connect\(this\.audioContext\.destination\);/);
});

test('NO_PERSISTED_VOLUME_PREFERENCE can reintroduce a quiet start', () => {
  /*
   * A stale stored preference is the other way "it starts quiet" happens, and
   * the honest answer is that no such preference exists: the gain is derived
   * from this session's own measurements every turn, so a fresh session and a
   * reloaded one start identically.
   */
  assert.ok(!/localStorage|sessionStorage/.test(CODE.slice(
    CODE.indexOf('private makeupGainFor('),
    CODE.indexOf('private stopPlayback('),
  )), 'the playback gain is reading stored state');
});
