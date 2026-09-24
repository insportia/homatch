/*
 * THE WAY HOME, AND THE CONVERSATION THAT WOULD NOT COME BACK TO PROPERTY.
 *
 * Physical iPhone test on v109, production session
 * 4be2bc31-b153-46a1-b3ca-b3d7aa25a2ff, 2026-09-20 01:25:43Z, eight turns.
 * The owner spoke Georgian, switched to English, then Russian, then returned
 * to Georgian — and Mariam answered the return in Russian.
 *
 * THE TELEMETRY SAYS THE RESOLVER WAS RIGHT.
 *
 *   t1-t3  ka-GE, georgian script, SCRIPT, confidence 1.0
 *   t4     provider `es`, latin        -> held ka, UNSUPPORTED_LANGUAGE, 0.3
 *   t5     provider `en`, latin        -> en, PROVIDER_LATIN, 0.7
 *   t7-t8  provider `ru`, cyrillic     -> ru, SCRIPT, confidence 1.0
 *   t9     provider `bho`, DEVANAGARI  -> held ru, UNSUPPORTED_LANGUAGE, 0.3
 *
 * t9 is the return. Forty-five characters over ten words of Georgian speech
 * came back in Devanagari labelled Bhojpuri, and refusing to hold a
 * conversation in Bhojpuri is exactly what the single authority is for. The
 * resolver never saw Georgian. `batch_final_chars` was 0: the one recogniser
 * that could have read that sentence was never asked, because the turn had
 * arrived through the `auto` socket and `auto` is trusted to have heard what
 * it heard.
 *
 * An unsupported label is the case where it plainly has not. So the fix
 * obtains the evidence rather than lowering the bar for it — the resolver is
 * untouched, and it is still the only thing that decides a language.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { resolveTurnLanguage } from '../talkLanguage.ts';

const CR = String.fromCharCode(13);
const read = (p) => readFileSync(p, 'utf8').split(CR).join('');
const CLIENT = read('src/lib/comm/voiceClient.ts');
const EDGE = read('supabase/functions/ai-talk-session/index.ts');

/** A real Georgian sentence: the kind of return t9 was. */
const KA = 'კარგი, მაშინ ვნახოთ რა ბინები არის ვაკეში ამ ფასად';

const resolve = (transcript, providerLanguage, previous, extra = {}) => resolveTurnLanguage({
  transcript,
  providerLanguage,
  providerDetected: true,
  previousSessionLanguage: previous,
  pageLocale: 'ka',
  sessionLanguages: extra.spoken ?? ['ka', previous].filter(Boolean),
  ...extra,
});

/* ── Coming home from each of the five ───────────────────────────────────*/

for (const [name, from] of [
  ['KA_EN_KA_RETURN', 'en'], ['KA_RU_KA_RETURN', 'ru'], ['KA_TR_KA_RETURN', 'tr'],
  ['KA_AR_KA_RETURN', 'ar'], ['KA_HE_KA_RETURN', 'he'],
]) {
  test(`${name}: clear Georgian returns to Georgian from ${from}`, () => {
    const r = resolve(KA, 'ka-GE', from);
    assert.equal(r.resolvedLanguage, 'ka', `a plain Georgian sentence stayed in ${from}`);
    assert.ok(r.confidence >= 0.6, `returned to ka but only at ${r.confidence}`);
  });
}

test('STRONG_CURRENT_SCRIPT_BEATS_PREVIOUS_LANGUAGE', () => {
  // Georgian script is not a shared alphabet: a Russian-pinned socket cannot
  // invent it, so its presence is somebody having said it.
  const r = resolve(KA, 'ka-GE', 'ru');
  assert.equal(r.resolvedLanguage, 'ka');
  assert.notEqual(r.resolutionReason, 'STICKY_HELD');
});

/* ── ...without making short noise able to move a session ────────────────*/

test('AMBIGUOUS_SHORT_TURN_HYSTERESIS: one weak token still moves nothing', () => {
  for (const prev of ['ka', 'ru', 'en']) {
    const r = resolve('Abba', 'en', prev);
    assert.equal(r.resolvedLanguage, prev,
      `a four-letter mis-hearing redefined a ${prev} conversation`);
  }
});

test('an unsupported language is still never spoken, however clear it looks', () => {
  // t9 exactly: perfect Devanagari, confidently labelled, ten words.
  const r = resolve('कितने का है यह अपार्टमेंट वाके में', 'bho', 'ru');
  assert.equal(r.resolvedLanguage, 'ru');
  assert.equal(r.resolutionReason, 'UNSUPPORTED_LANGUAGE');
  assert.equal(r.proposedLanguage, 'hi');
});

/* ── The actual repair: the evidence gets fetched ────────────────────────*/

test('RETURN_TO_KA_ROOT_CAUSE: an unsupported label lifts the auto-socket exemption', () => {
  /*
   * The exemption is right whenever `auto` HEARD the utterance, and wrong in
   * the one case where it demonstrably did not. Narrow on purpose: it fires
   * only on a language this product does not speak.
   */
  assert.match(CLIENT, /const heardUnsupported = Boolean\(heardLanguage\) && !SPOKEN_LANGUAGES\.includes/);
  assert.match(CLIENT, /const exempt = \(opinion \|\| origin === 'SHADOW'\) && !heardUnsupported;/);
  assert.match(CLIENT, /const plan = exempt \? null/);
  // The evidence is fetched; it is not allowed to decide anything itself.
  assert.ok(!/heardUnsupported[\s\S]{0,400}this\.language\s*=/.test(CLIENT),
    'the recovery path started setting the session language');
});

test('SINGLE_LANGUAGE_AUTHORITY preserved, OLD_STABILISE_MUTATION absent', () => {
  assert.match(CLIENT, /current: this\.lastResolution\.resolvedLanguage/);
  assert.ok(!/this\.language = stabiliseLanguage\(/.test(CLIENT));
  assert.match(read('src/lib/comm/transcript.ts'), /SPOKEN_LANGUAGES\.includes\(named\)/);
  // One resolver, and the recovery feeds it rather than competing with it.
  assert.equal((CLIENT.match(/resolveTurnLanguage\(/g) || []).length >= 1, true);
});

/* ── Real-estate gravity ─────────────────────────────────────────────────*/

/*
 * The prompt as the MODEL receives it, not as the file lays it out.
 *
 * It is a TypeScript array of string literals, so a sentence can be split
 * across two elements by nothing more than a re-wrap. Asserting on the source
 * layout means a reformat looks like a policy change.
 */
const prompt = () => {
  const at = EDGE.indexOf("You are Mariam, Homatch's AI assistant");
  assert.ok(at > 0, 'the prompt moved');
  return EDGE.slice(at, at + 14000)
    .split(String.fromCharCode(10))
    .map((l) => l.trim().replace(/^['`]|['`],?$/g, ''))
    .join(' ')
    .replace(/\s+/g, ' ');
};

test('IN_DOMAIN_STAYS_IN_DOMAIN and ADJACENT_SMALL_TALK_ALLOWED', () => {
  const p = prompt();
  // Small talk is the conversation, not a deviation to be corrected.
  assert.match(p, /AROUND IT[\s\S]{0,400}This IS the/);
  assert.match(p, /answer like a person and steer nowhere/);
});

test('CLEARLY_OFF_TOPIC_SHORT_RESPONSE and PIVOTS_BACK', () => {
  const p = prompt();
  assert.match(p, /One to three sentences/);
  assert.match(p, /land back/);
  assert.match(p, /The landing is not optional/);
});

test('OFF_TOPIC_DOES_NOT_BECOME_GENERAL_CHAT', () => {
  const p = prompt();
  assert.match(p, /THIS TOPIC DOES NOT GET A SECOND EXCHANGE/);
  assert.match(p, /not a general-purpose one/);
  // And the instruction that used to cancel the pivot is gone.
  assert.ok(!/Do NOT end every joke by steering back to Homatch\./.test(p),
    'the line that cancelled the landing is back');
});

test('the refusal voice is still forbidden — she is not a refusal bot', () => {
  const p = prompt();
  assert.match(p, /Never a refusal, "I cannot discuss", "my scope", a policy line/);
  assert.match(p, /never the same line twice/);
});

/* ── Personality ─────────────────────────────────────────────────────────*/

test('PERSONALITY_PLAYFUL_WHEN_APPROPRIATE', () => {
  const p = prompt();
  assert.match(p, /Be good company\. Lively, warm, quick, a little playful/);
  assert.match(p, /Tease the apartment hunt itself/);
  // The line that told her most replies have no wit in them is gone.
  assert.ok(!/and most replies have none in them/.test(p),
    'the instruction that made her dry is back');
});

test('PERSONALITY_NOT_CANNED: no fixed joke or pivot sentence is pinned', () => {
  const p = prompt();
  assert.match(p, /Never reuse a joke or a line/);
  assert.match(p, /Built from what they just said/);
  // The example pivot from the brief must NOT be hardcoded anywhere.
  assert.ok(!EDGE.includes('ბინამდე ვეღარ მივალთ'), 'an example sentence was hardcoded');
  assert.match(p, /native to the language/);
});

test('SERIOUS_CONTEXT_DISALLOWS_FLIPPANT_HUMOR', () => {
  const p = prompt();
  assert.match(p, /SERIOUS -- money at risk, contracts, legal trouble/);
  assert.match(p, /no joke anywhere in it including the opening/);
  assert.match(p, /READ THE ROOM[\s\S]{0,300}the lightness/);
});

/* ── v109 must survive ───────────────────────────────────────────────────*/

test('the v109 fixes and the runtime contract are untouched', () => {
  // The one-activation-one-session guard, now module-scope rather than a ref
  // on one component instance. Same claim, enforced where two instances
  // cannot each hold their own copy of it. See talkOwnership.test.mjs.
  assert.match(read('src/components/home/AiTalkPanel.tsx'), /claimActivation\(\(\) => startOnce\(\)\)/);
  assert.match(CLIENT, /const choice = chooseTranscript\(liveTranscript, text\);/);
  assert.match(CLIENT, /routerPhaseAtSpeechStart: this\.routerPhaseAtSpeechStart/);
  assert.match(CLIENT, /playback: this\.player\?\.playbackStats\(\)/);
  assert.match(EDGE, /const GOOGLE_STT_MODEL = 'chirp_3';/);
  assert.match(read('supabase/functions/_shared/comm/llm.ts'), /'gpt-5\.6-luna'/);
  assert.match(read('supabase/functions/_shared/comm/cartesia.ts'), /const TTS_MODELS = \['sonic-3'/);
  assert.match(EDGE, /async function configuredVoice\(sb: Sb\)/);
  assert.match(EDGE, /recordTurnUsage/);
  assert.match(EDGE, /rpc\('is_admin'\)/);
  assert.match(EDGE, /tts_phrase_seam_ms/);
  assert.match(CLIENT, /decideBargeIn/);
});
