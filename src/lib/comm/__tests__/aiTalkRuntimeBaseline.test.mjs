/*
 * THE AI TALK RUNTIME CONTRACT, AND THE ONE FIELD THAT IS MEANT TO CHANGE.
 *
 * Mariam's voice has been replaced three times in one day. Each swap was
 * supposed to be a uuid and nothing else, and each one arrived in the middle
 * of work on the recogniser, the resolver, the prompt and the deployment
 * pipeline -- so "is the voice different, or is the whole speech path
 * different?" could only be answered by reading four commits.
 *
 * This is the answer, as a test. Every behaviour-critical setting below is
 * pinned. VOICE_ID is deliberately NOT pinned: it is the replaceable field,
 * and the whole point is that changing it cannot drag anything else with it.
 *
 * A future "voice-only" change that also moves the STT model, the sample
 * rate, the language rules, the endpointing, the phrase policy or the
 * cancellation behaviour fails here, by name, with the field that moved.
 *
 * PHYSICAL_ACCEPTANCE = PENDING.
 *
 * This is NOT yet a known-good baseline. It records what production runs as
 * of 2026-09-19 so that a swap cannot change it silently. The owner has not
 * confirmed the physical iPhone experience is good, and until they do these
 * values are "what we ship", not "what we know works". Nothing in this file
 * should be cited as proof that AI Talk sounds right.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');

const EDGE = read('supabase/functions/ai-talk-session/index.ts');
const CARTESIA = read('supabase/functions/_shared/comm/cartesia.ts');
const CLIENT = read('src/lib/comm/voiceClient.ts');
const GOOGLE = read('src/lib/comm/googleTranscribe.ts');
const REGISTRY = read('src/lib/comm/languageRegistry.ts');

/** The field a voice swap is allowed to change, and the only one. */
export const REPLACEABLE = ['VOICE_ID'];

test('PHYSICAL_ACCEPTANCE is still pending, and says so', () => {
  const self = read('src/lib/comm/__tests__/aiTalkRuntimeBaseline.test.mjs');
  assert.match(
    self, /PHYSICAL_ACCEPTANCE = PENDING/,
    'the baseline may only be marked approved after the owner confirms a real iPhone test',
  );
});

test('speech recognition: provider, model and rate are unchanged', () => {
  assert.match(EDGE, /const GOOGLE_STT_MODEL = 'chirp_3';/);
  // Capture is resampled to 16 kHz for the recogniser; the live socket's
  // own rate is its provider's business and lives beside it.
  assert.match(read('src/lib/comm/audio.ts'), /export const TARGET_SAMPLE_RATE = 16_000;/);
  assert.match(read('src/lib/comm/liveTranscribe.ts'), /export const LIVE_SAMPLE_RATE = 24_000;/);
  // The pinned socket takes one language; `auto` stays a bounded probe.
  assert.match(GOOGLE, /if \(this\.grant\.detect\) query\.set\('detect', '1'\);/);
  assert.match(GOOGLE, /query\.set\('language', tag\)/);
  assert.match(CLIENT, /const MAX_UNSUPPORTED_PROBES = 2;/);
});

test('language: six spoken, and one authority deciding', () => {
  assert.match(REGISTRY, /ka: 'ka-GE', en: 'en-US', ru: 'ru-RU', tr: 'tr-TR', ar: 'ar-XA', he: 'iw-IL',/);
  const lang = read('src/lib/comm/talkLanguage.ts');
  assert.match(lang, /export const SPOKEN_LANGUAGES: readonly TalkLanguage\[\] = LISTENING_LANGUAGES;/);
  assert.match(lang, /'UNSUPPORTED_LANGUAGE'/);
  /*
   * The batch path used to set the session language from stabiliseLanguage(),
   * which reads the provider's raw label and has no allowlist. Production
   * session fd811a22 went ka -> en -> ru between committed turns because of
   * it. resolveTurnLanguage is the only authority now.
   */
  assert.ok(
    !/this\.language = stabiliseLanguage\(/.test(CLIENT),
    'a second language authority is back on the deciding path',
  );
  assert.match(read('src/lib/comm/transcript.ts'), /SPOKEN_LANGUAGES\.includes\(named\)/);
});

test('endpointing and turn commit are unchanged', () => {
  assert.match(CLIENT, /const SWITCH_PROBE_SPEECH_MS = 900;/);
  // THINKING is entered by the turn, never by the endpointer firing.
  assert.ok(
    !/onSpeechEnd:[\s\S]{0,200}setState\('UNDERSTANDING'\)/.test(CLIENT),
    'the endpointer sets THINKING again, before any turn is committed',
  );
});

test('the model and the response-length policy are unchanged', () => {
  assert.match(read('supabase/functions/_shared/comm/llm.ts'), /'gpt-5\.6-luna'/);
  assert.match(EDGE, /A real question gets TWO spoken sentences, three at the most/);
  assert.match(EDGE, /You are Mariam, Homatch's AI assistant/);
});

test('speech synthesis: model, streaming shape and rates are unchanged', () => {
  assert.match(CARTESIA, /const TTS_MODELS = \['sonic-3', 'sonic-2', 'sonic-english', 'sonic'\];/);
  assert.match(CARTESIA, /\/tts\/sse/);
  assert.match(CARTESIA, /container: 'raw', encoding: 'pcm_s16le'/);
  assert.match(CARTESIA, /export const CARTESIA_OUTPUT_RATES = \[8000, 16000, 22050, 24000, 44100, 48000\] as const;/);
  assert.match(CARTESIA, /export const CARTESIA_SPEED_RANGE = \{ min: 0\.6, max: 1\.5 \} as const;/);
  // Speed is an operator setting; 1.0 means "send nothing and keep the
  // voice's own pace".
  assert.match(EDGE, /const CARTESIA_DEFAULT_SPEED = 1\.0;/);
});

test('the voice is configured, never hardcoded into the decision', () => {
  // THE REPLACEABLE FIELD. Deliberately not pinned to a value: an operator
  // changes it in Admin, and that must not require touching this file.
  assert.match(EDGE, /async function configuredVoice\(sb: Sb\)/);
  assert.match(EDGE, /\.eq\('key', 'ai_talk_voice'\)/);
  const resolver = EDGE.slice(EDGE.indexOf('async function aiTalkVoice'), EDGE.indexOf('async function aiTalkVoice') + 2200);
  assert.ok(!/MARIAM_VOICE_ID/.test(resolver), 'a constant outranks the configured voice again');
  assert.deepEqual(REPLACEABLE, ['VOICE_ID']);
});

test('cancellation and barge-in are unchanged', () => {
  assert.match(EDGE, /abandon\(/);
  assert.match(EDGE, /signal\.aborted/);
  assert.match(CLIENT, /decideBargeIn/);
  assert.match(CLIENT, /turnAbort/);
  const bargeIn = read('src/lib/comm/transcript.ts');
  assert.match(bargeIn, /sustainMs/);
  assert.match(bargeIn, /assertiveEnergy/);
});

test('metering and limits are unchanged', () => {
  assert.match(EDGE, /recordTurnUsage/);
  assert.match(EDGE, /costBasis: 'CALCULATED'/);
  assert.match(EDGE, /decideGrant\(/);
  assert.match(EDGE, /rpc\('is_admin'\)/);
  assert.match(EDGE, /window: 'ROLLING_24H'/);
});

test('the evidence needed to diagnose the next failure is collected', () => {
  // Every one of these exists because a real session could not be explained
  // without it.
  for (const field of [
    'tts_max_chunk_gap_ms',   // choppy audio: did the stream starve upstream?
    'tts_phrase_seam_ms',     // or is the silence our own phrase boundary?
    'refused_shapes',         // which refused turn moved the language?
    'resolution_reason',
    'tts_request_language',
  ]) {
    assert.ok(EDGE.includes(field), `${field} is no longer traced`);
  }
});
