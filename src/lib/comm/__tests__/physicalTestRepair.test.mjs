/*
 * THE SECOND PHYSICAL IPHONE TEST, AS TESTS.
 *
 * Production session 6a16165f-065a-4dbe-9325-bf3ed304d23c, 2026-09-19
 * 20:56:11Z. The owner reported: the first utterance was not recognised at
 * all, many words were swallowed, playback was choppy, and Mariam was too
 * quiet. The forensics found two defects with evidence and two symptoms
 * without enough telemetry to explain them.
 *
 *   THE FIRST UTTERANCE. Two `start` actions 1.56 seconds apart. A Google
 *   socket was granted to the first session at 20:56:11.474 and that whole
 *   session was superseded 316ms later. The first turn committed FOUR
 *   CHARACTERS and took 8,634ms from speech end to final, against ~1,500ms
 *   for every later turn in the same call.
 *
 *   THE SWALLOWED WORDS. Turn t5: the batch recogniser was handed 8.2
 *   seconds of Georgian and returned 76 characters. The turn committed 16.
 *
 * The other two symptoms are instrumented rather than guessed at, because
 * the server's own cadence was healthy on all four turns and nothing in the
 * browser was being reported.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { chooseTranscript, comparable, containment } from '../transcriptChoice.ts';

const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');
const PANEL = read('src/components/home/AiTalkPanel.tsx');
const CLIENT = read('src/lib/comm/voiceClient.ts');
const PLAYER = read('src/lib/comm/pcmPlayer.ts');
const EDGE = read('supabase/functions/ai-talk-session/index.ts');

/* ── The first turn ──────────────────────────────────────────────────────*/

test('DOUBLE_START_SINGLE_SESSION: a re-entrant start joins the first attempt', async () => {
  /*
   * The guard, as the panel implements it. A boolean would send the second
   * caller away with nothing; the promise makes it await the activation the
   * first caller started, so both get a session and only one exists.
   */
  let started = 0;
  let resolveIt;
  const inFlight = { current: null };
  const startOnce = () => { started += 1; return new Promise((r) => { resolveIt = r; }); };
  const start = () => {
    if (inFlight.current) return inFlight.current;
    const attempt = startOnce().finally(() => { inFlight.current = null; });
    inFlight.current = attempt;
    return attempt;
  };

  const a = start();
  const b = start();
  const c = start();
  assert.equal(started, 1, 'a second tap created a second session');
  resolveIt();
  await Promise.all([a, b, c]);

  // ...and a genuinely later activation is still allowed its own session.
  const d = start();
  assert.equal(started, 2, 'the guard latched and refused a real second activation');
  resolveIt();
  await d;
});

test('DOUBLE_START_SINGLE_SESSION: the panel actually uses that guard', () => {
  assert.match(PANEL, /const startInFlight = useRef<Promise<void> \| null>\(null\);/);
  assert.match(PANEL, /if \(startInFlight\.current\) return startInFlight\.current;/);
  // The guard must wrap the real thing, not sit beside it.
  assert.match(PANEL, /const attempt = startOnce\(\)\.finally\(\(\) => \{ startInFlight\.current = null; \}\);/);
  // And the button still calls the guarded entry point.
  assert.match(PANEL, /onClick=\{\(\) => void start\(\)\}/);
});

test('SUPERSEDED_SESSION_CANNOT_RECEIVE_NEW_STT: one activation asks for one grant', () => {
  /*
   * The socket granted to session a573f863 at 20:56:11.474 existed because a
   * second `start` had been allowed to run at all. With one activation
   * producing one session, there is no superseded session to grant to: the
   * `listen` action is keyed to sessionIdRef, which only the surviving
   * session ever sets.
   */
  assert.match(PANEL, /action: 'listen',\s*\n\s*sessionId: sessionIdRef\.current,/);
  assert.match(PANEL, /onListenGrant: async \(\) => \{\s*\n\s*if \(!sessionIdRef\.current\) return null;/);
});

test('FIRST_TURN_CAPTURE_NOT_ORPHANED: pre-socket audio is still held and now reported', () => {
  // The buffering that already existed must survive this change...
  assert.match(CLIENT, /this\.voicedBeforeReadyMs \+= blockMs;/);
  assert.match(CLIENT, /currentPhase === 'CONNECTING'/);
  // ...and the counters must now leave the browser, which is what makes
  // "was the first syllable lost" answerable at all.
  assert.match(CLIENT, /voicedBeforeReadyMs: Math\.round\(this\.voicedBeforeReadyMs\)/);
  assert.match(CLIENT, /preReadyVoicedMs: Math\.round\(this\.preReadyVoicedMs\)/);
  assert.match(CLIENT, /routerPhaseAtSpeechStart: this\.routerPhaseAtSpeechStart/);
});

/* ── The swallowed words ─────────────────────────────────────────────────*/

test('BATCH_76_VS_LIVE_16_SELECTION: the observed loss is repaired', () => {
  /*
   * The real shape of t5: the live socket caught the opening of the sentence
   * and stopped; the batch heard all of it.
   */
  const live = 'რამდენი ღირს';
  const batch = 'რამდენი ღირს ბინა ვაკეში და რა არის წინასწარი გადასახადი';
  const r = chooseTranscript(live, batch);
  assert.equal(r.source, 'BATCH');
  assert.equal(r.reason, 'BATCH_EXTENDS_LIVE');
  assert.equal(r.text, batch);
  assert.equal(r.liveChars, live.length);
  assert.equal(r.batchChars, batch.length);
  // The shape of the real loss: the batch heard several times as much.
  assert.ok(r.batchChars > r.liveChars * 3, 'the fixture no longer reproduces a substantial loss');
});

test('LEGITIMATE_SHORTER_CORRECTION: a tidier final is not overruled by a longer one', () => {
  /*
   * A recogniser correcting itself usually gets SHORTER. A length rule would
   * reject the correction and keep the stutter, which is the bug the naive
   * fix would have introduced.
   */
  const live = 'how much is the deposit';
  const batch = 'how how much is is the deposit';
  const r = chooseTranscript(live, batch);
  assert.equal(r.source, 'LIVE', 'a stuttering re-transcription overruled the clean final');
  assert.notEqual(r.reason, 'BATCH_EXTENDS_LIVE');

  // And a strictly shorter batch never wins.
  const shorter = chooseTranscript('the full sentence they said', 'the full');
  assert.equal(shorter.source, 'LIVE');
  assert.equal(shorter.reason, 'LIVE_KEPT_LONGER');
});

test('BATCH_MUST_CARRY_THE_LIVE_WORDS: longer but different is refused', () => {
  // Two recognisers that disagree about the WORDS are not a correction.
  // Committing the longer of two different sentences says something nobody
  // said, which is worse than losing a few words.
  const r = chooseTranscript('I want to sell my flat', 'the weather in Tbilisi is quite cold today honestly');
  assert.equal(r.source, 'LIVE');
  assert.equal(r.reason, 'LIVE_KEPT_DIVERGENT');
});

test('TRANSCRIPT_SELECTION_CANNOT_SWITCH_LANGUAGE', () => {
  /*
   * chooseTranscript returns text and never a language. The resolver keeps
   * sole authority, which is the invariant three separate incidents were
   * about.
   */
  const r = chooseTranscript('გამარჯობა', 'გამარჯობა როგორ ხართ დღეს');
  assert.deepEqual(Object.keys(r).sort(), ['batchChars', 'liveChars', 'reason', 'source', 'text'].sort());
  assert.ok(!('language' in r));
  const src = read('src/lib/comm/transcriptChoice.ts');
  assert.ok(!/normaliseLanguage|resolveTurnLanguage|SPOKEN_LANGUAGES/.test(src),
    'the selector reached for the language resolver');
});

test('the selector is wired into the arbitration that dropped the words', () => {
  assert.match(CLIENT, /const choice = chooseTranscript\(liveTranscript, text\);/);
  assert.match(CLIENT, /\|\| choice\.source === 'BATCH'\);/);
  // The original three clauses must survive: each carries a case of its own.
  assert.match(CLIENT, /reason === 'NO_FINAL'/);
  assert.match(CLIENT, /!consistentWith\(liveTranscript, pinned\)/);
});

test('comparable() and containment() forgive writing, never words', () => {
  assert.equal(comparable('Hello,  WORLD!'), 'hello world');
  assert.equal(comparable('გამარჯობა, როგორ ხართ?'), 'გამარჯობა როგორ ხართ');
  assert.equal(containment(['a', 'b'], ['a', 'x', 'b']), 1);
  assert.equal(containment(['a', 'b'], ['b', 'a']), 0.5, 'order stopped mattering');
});

/* ── The telemetry the other two symptoms need ───────────────────────────*/

test('CAPTURE_TELEMETRY_PRESENT: end to end, browser to trace', () => {
  for (const field of [
    'samplesCaptured', 'bytesSent', 'voicedBeforeReadyMs', 'preReadyVoicedMs',
    'routerPhaseAtSpeechStart', 'socketRotations',
    'audioContextStateAtSpeechStart', 'audioContextStateAtSpeechEnd',
    'gateReleases', 'utteranceMs',
  ]) {
    assert.ok(CLIENT.includes(field), `${field} is not reported by turnShape`);
  }
  for (const field of [
    'capture_samples', 'capture_bytes_sent', 'voiced_before_ready_ms', 'pre_ready_voiced_ms',
    'router_phase_at_speech_start', 'socket_rotations',
    'audio_context_at_speech_start', 'audio_context_at_speech_end',
    'gate_releases', 'utterance_ms',
  ]) {
    assert.ok(EDGE.includes(field), `${field} never reaches turn_trace`);
  }
  // A rotation mid-utterance is the suspect in turn 1; it has to be counted.
  assert.match(CLIENT, /this\.socketRotations \+= 1;/);
});

test('PLAYBACK_TELEMETRY_PRESENT: the scheduler reports what it did', () => {
  for (const field of [
    'receivedChunks', 'receivedBytes', 'scheduled', 'startDelayMs',
    'minAheadMs', 'p50AheadMs', 'p95AheadMs',
    'underruns', 'maxUnderrunMs', 'contextStateAtStart', 'contextStateChanges',
    'queueResets', 'scheduleCorrections',
  ]) {
    assert.ok(PLAYER.includes(field), `${field} is not measured by the player`);
  }
  assert.match(CLIENT, /playback: this\.player\?\.playbackStats\(\)/);
  assert.match(EDGE, /playback: body\.turnShape\?\.playback \?\? null,/);
});

test('the selection is traceable per turn, which is how t5 was found', () => {
  for (const f of ['liveFinalChars', 'batchFinalChars', 'selectedChars', 'selectedSource', 'selectionReason']) {
    assert.ok(CLIENT.includes(f), `${f} missing from turnShape`);
  }
  for (const f of ['live_final_chars', 'batch_final_chars', 'selected_chars', 'selected_source', 'selection_reason']) {
    assert.ok(EDGE.includes(f), `${f} missing from turn_trace`);
  }
});

/* ── Everything that works must keep working ─────────────────────────────*/

test('LANGUAGE_SINGLE_AUTHORITY and the runtime contract are untouched', () => {
  assert.match(CLIENT, /current: this\.lastResolution\.resolvedLanguage/);
  assert.ok(!/this\.language = stabiliseLanguage\(/.test(CLIENT), 'OLD_STABILISE_MUTATION is back');
  assert.match(read('src/lib/comm/transcript.ts'), /SPOKEN_LANGUAGES\.includes\(named\)/);
  // Models, voice and gain: none of this pass may move them.
  assert.match(EDGE, /const GOOGLE_STT_MODEL = 'chirp_3';/);
  assert.match(read('supabase/functions/_shared/comm/llm.ts'), /'gpt-5\.6-luna'/);
  assert.match(read('supabase/functions/_shared/comm/cartesia.ts'), /const TTS_MODELS = \['sonic-3'/);
  assert.match(EDGE, /async function configuredVoice\(sb: Sb\)/);
  assert.match(EDGE, /recordTurnUsage/);
  assert.match(EDGE, /rpc\('is_admin'\)/);
  assert.match(CLIENT, /decideBargeIn/);
});

test('HOMATCH_APPLICATION_GAIN is unity and nothing here changed that', () => {
  /*
   * The audit found no attenuation anywhere: createGain() defaults to 1.0
   * and .gain is never assigned, the int16 conversion is the exact unity
   * /0x8000, and duckPlayback truncates scheduling time rather than volume.
   * Boosting above unity would clip, so the requirement "Homatch applies no
   * attenuation" is met by there being no gain assignment at all.
   */
  assert.match(CLIENT, /this\.outputGain = this\.audioContext\.createGain\(\);/);
  assert.ok(!/outputGain\.gain\.value\s*=/.test(CLIENT), 'something now sets the output gain');
  assert.ok(!/outputGain\.gain\.setValueAtTime|outputGain\.gain\.linearRamp/.test(CLIENT));
  assert.match(PLAYER, /view\.getInt16\(i \* 2, true\) \/ 0x8000;/);
});
