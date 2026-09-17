// One multilingual assistant, not six scripted ones.
//
// The failure these guard against is specific and was live: a visitor asking,
// in Georgian, to be answered in English. Every language signal agreed the
// turn was Georgian — correctly, it IS a Georgian sentence — so the model was
// told to answer in Georgian, and on the one occasion it obeyed the visitor
// instead, the reply-language guard threw that answer away and retried it in
// Georgian. The system was built to prevent the thing that was asked for.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  detectLanguageRequest, TALK_LANGUAGES, normaliseLanguage,
} from '../talkLanguage.ts';

const edge = readFileSync('supabase/functions/ai-talk-session/index.ts', 'utf8');
const client = readFileSync('src/lib/comm/voiceClient.ts', 'utf8');
const worker = readFileSync('official-worker/src/speech/GoogleSpeechStream.ts', 'utf8');
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** One method's body, so an assertion cannot drift onto a neighbour. */
const body = (src, name) => {
  const at = src.indexOf(name);
  if (at < 0) throw new Error(`${name} is missing`);
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return strip(src.slice(open, i + 1));
  }
  throw new Error(`${name} never closes`);
};

// ── LANGUAGE_SWITCHING ────────────────────────────────────────────────────

test('a request to switch is read in whatever language it is asked in', () => {
  const asked = [
    ['ინგლისურად მელაპარაკე.', 'en'],
    ["Let's continue in English.", 'en'],
    ['Давай по-русски.', 'ru'],
    ['Türkçe konuşalım.', 'tr'],
    ['تحدث بالعربية من فضلك.', 'ar'],
    ['בוא נדבר בעברית.', 'he'],
    ['ქართულად გავაგრძელოთ.', 'ka'],
  ];
  for (const [text, want] of asked) {
    const from = want === 'ka' ? 'en' : 'ka';
    assert.equal(detectLanguageRequest(text, from), want, text);
  }
});

test('an ordinary sentence never switches language', () => {
  for (const text of [
    'ვაკეში ორსართულიანი ბინა მაინტერესებს.',
    'What is the price per square metre?',
    'Сколько стоит эта квартира?',
    'გამარჯობა, როგორ ხართ?',
  ]) {
    assert.equal(detectLanguageRequest(text, 'ka'), null, text);
  }
});

test('mentioning a language is not asking for it', () => {
  // A comparison names two and means neither as an instruction.
  assert.equal(detectLanguageRequest('Do you have listings in English or Russian?', 'ka'), null);
  // And a long sentence that happens to contain the word is about something else.
  const essay = 'I was reading an article in English about the Georgian property market '
    + 'and it mentioned that prices in Vake have risen quite a lot recently, is that right?';
  assert.equal(detectLanguageRequest(essay, 'ka'), null);
});

test('asking for the language already being spoken is not a switch', () => {
  // Acting on it would replace a working recogniser for nothing.
  assert.equal(detectLanguageRequest('ინგლისურად მელაპარაკე.', 'en'), null);
  assert.equal(detectLanguageRequest("Let's speak English.", 'en'), null);
});

test('every supported language can be both asked for and asked in', () => {
  for (const lang of TALK_LANGUAGES) {
    const from = lang === 'ka' ? 'en' : 'ka';
    const found = TALK_LANGUAGES.some((other) => other !== lang
      && detectLanguageRequest(`speak ${lang === 'en' ? 'english' : lang}`, from) !== undefined);
    assert.ok(found, lang);
  }
  assert.equal(normaliseLanguage('en'), 'en');
});

// ── The switch has to reach all four places ───────────────────────────────

test('the switch is decided before the reply is generated, not after', () => {
  const e = strip(edge);
  const at = e.indexOf('const requested = detectLanguageRequest(');
  assert.ok(at > 0, 'the request must be read from the transcript');
  const reply = e.indexOf('const replyLanguage');
  assert.ok(reply > at, 'replyLanguage must be decided from it');
  // And it must outrank the resolver, not be averaged with it.
  assert.ok(/requested \?\? resolution\.resolvedLanguage/.test(e));
});

test('the guard checks the language the visitor asked for', () => {
  // textMatchesLanguage is called against replyLanguage, which is now the
  // requested one — so an English answer to an English request passes.
  assert.ok(/textMatchesLanguage\(shown, replyLanguage\)/.test(edge));
});

test('the browser adopts the server language and reopens the recogniser', () => {
  const c = strip(client);
  assert.ok(/adoptLanguage\(event\.language\)/.test(c), 'the reply carries the decision');
  assert.ok(/private async relisten\(\)/.test(c), 'the socket must be replaced');
  /*
   * The recogniser's language is fixed when its socket is granted, so
   * adopting the label without reopening would be half a switch. The
   * replacement is now one shared path -- rotateLive -- because a deliberate
   * turn boundary spends a socket for exactly the same reason a language
   * switch does, and two copies of "close it and open another" is how one of
   * them gets a fix the other does not.
   */
  assert.ok(/await this\.rotateLive\(\)/.test(c), 'relisten must rotate the socket');
  assert.ok(/openLiveTranscription\(\)/.test(body(client, 'private async rotateLive()')));
  // Not mid-reply: that would tear down the socket while it is still needed.
  const resume = c.slice(c.indexOf('private resumeListening'));
  assert.ok(/relistenLanguage/.test(resume.slice(0, 400)), 'reopened when the floor is free');
});

// ── CARTESIA_ONLY_TTS / the requested voice ───────────────────────────────

test('AI TALK refuses any TTS provider that is not Cartesia', () => {
  // Not a ladder. A fallback between providers is a fallback between voices,
  // and the assistant changing voice mid-conversation is worse than a pause.
  assert.ok(/PROVIDER_NOT_SUPPORTED_ON_AI_TALK/.test(edge));
  const e = strip(edge);
  assert.ok(/voice\.provider !== 'CARTESIA'/.test(e));
  assert.ok(!/elevenLabs.*speakPhraseStreaming|speakPhraseStreaming.*elevenLabs/i.test(e));
});

// ── Fast turn boundary ────────────────────────────────────────────────────

test('the voice-activity timeout is wired, clamped, and OFF by default', () => {
  // It was deployed and measured to change nothing on chirp_3: finals at
  // 1633/1710/2009/2828ms against 1348-2936ms before, the 0.33s clip still
  // never finalising, and zero stream restarts — which is the decisive part,
  // because an enforced timeout ends the stream and this class restarts it on
  // every turn. Kept, off, so the day Google implements it it is already
  // there; default-on would be shipping a fix that does not fix anything.
  const w = strip(worker);
  assert.ok(/voiceActivityTimeout/.test(w));
  assert.ok(/Math\.max\(\s*500,/.test(w), 'never below the documented floor');
  assert.ok(/enableVoiceActivityEvents: true/.test(w), 'the timeout requires the events');
  assert.ok(/GOOGLE_SPEECH_FAST_ENDPOINT \?\? '0'/.test(w),
    'default must be off until it is measured to do something');
});

test('the code does not claim the endpointing is fixed', () => {
  // A comment asserting a repair that measurement disproved is how folklore
  // gets into a codebase, and this one was caught once already.
  assert.ok(/DOES NOT WORK ON THIS MODEL/.test(worker));
  assert.ok(/GOOGLE_SPEECH_END_TIMEOUT_MS/.test(worker));
});

// ── CONTEXT_SIZE_BOUNDED ──────────────────────────────────────────────────

test('history is bounded, so a long conversation cannot get slower', () => {
  const m = /body\.history\.slice\(-(\d+)\)/.exec(edge);
  assert.ok(m, 'history must be sliced');
  const kept = Number(m[1]);
  assert.ok(kept >= 8, 'too few turns cannot resolve a follow-up like "and under 160?"');
  assert.ok(kept <= 20, 'the prompt must not grow with the session');
});

test('the reply length is not a fixed budget any more', () => {
  // A hard "two sentences, thirty words, every time" is what made every
  // answer the same size and made the assistant sound like a recording.
  assert.ok(!/at most two sentences and at most 30 words/.test(edge));
  assert.ok(/LENGTH FOLLOWS THE QUESTION/.test(edge));
});

// ── Somebody simply starts talking ────────────────────────────────────────
//
// MEASURED against the deployed recogniser on `auto`, every supported
// language, a bare greeting and a full sentence:
//
//   en ru tr ar   correct on both, short and long
//   ka            correct on a sentence; a bare "გამარჯობა" returns Javanese,
//                 transcribed "gamarjoba" in Latin letters
//   he            correct on a sentence, reported as `iw` (the legacy code
//                 this product already aliases); a bare "שלום" returns
//                 hi-Latn, "Shalom"
//
// Eleven of twelve transcripts were correct. So detection is good enough to
// ESTABLISH a language and not good enough to run a settled conversation on,
// which is exactly how it is used.

import { resolveTurnLanguage } from '../talkLanguage.ts';

test('a first utterance in any language settles the session, whatever the page says', () => {
  // The page locale is where somebody arrived, not what they speak.
  const first = (transcript, providerLanguage) => resolveTurnLanguage({
    transcript, providerLanguage, previousSessionLanguage: null, pageLocale: 'ka',
  });
  assert.equal(first('Hello, can you help me find an apartment?', 'en').resolvedLanguage, 'en');
  assert.equal(first('Здравствуйте, я ищу двухкомнатную квартиру.', 'ru').resolvedLanguage, 'ru');
  assert.equal(first('Merhaba, bir daire arıyorum.', 'tr').resolvedLanguage, 'tr');
  assert.equal(first('مرحبا ابحث عن شقه في تبليسي.', 'ar').resolvedLanguage, 'ar');
  // Hebrew comes back as `iw`, which ISO renamed to `he` in 1989.
  assert.equal(first('שלום, אני מחפש דירה בטביליסי.', 'iw').resolvedLanguage, 'he');
  for (const t of ['Hello, can you help me find an apartment?', 'Привет']) {
    assert.ok(first(t, t === 'Привет' ? 'ru' : 'en').confidence >= 0.6, 'must settle, not dither');
  }
});

test('a mis-detected short greeting cannot hijack the session', () => {
  // This is the one the measurement says will happen: a bare Georgian
  // greeting on `auto` comes back as Javanese with a Latin transcript. An
  // unsupported label contributes nothing, and one short Latin word is not
  // enough evidence to leave a non-Latin session.
  const r = resolveTurnLanguage({
    transcript: 'gamarjoba', providerLanguage: 'jv',
    previousSessionLanguage: 'ka', pageLocale: 'ka',
  });
  assert.equal(r.resolvedLanguage, 'ka');
  assert.ok(r.confidence < 0.6, 'and it must not lock on that evidence');

  const he = resolveTurnLanguage({
    transcript: 'Shalom', providerLanguage: 'hi-Latn',
    previousSessionLanguage: 'ka', pageLocale: 'ka',
  });
  assert.equal(he.resolvedLanguage, 'ka');
  assert.ok(he.confidence < 0.6);
});

test('detection is earned by evidence, never spent on the deciding turn', () => {
  /*
   * THIS TEST USED TO ASSERT THE OPPOSITE, and the reason it gave was that
   * detection is "a startup cost and not a running one" -- pay it while the
   * session settles, stop once it locks.
   *
   * The first real Android trace disproved the premise. The startup turn IS
   * the deciding turn: it is the one that sets the language every later turn
   * inherits. Spending `auto` on it meant a clipped Georgian word came back
   * as "Abba" and took the conversation to English with it. A cost paid on
   * the deciding turn is not a startup cost.
   *
   * So the prior is the configuration, and `auto` has to be earned.
   */
  const c = strip(client);
  assert.ok(!/detect: !this\.language\.locked/.test(c),
    'an unlocked session is a new session; it must not be handed to `auto`');
  assert.ok(/detect: probing/.test(c),
    'the socket asks for detection only when sustained speech earned a probe');
  const g = strip(readFileSync('src/lib/comm/googleTranscribe.ts', 'utf8'));
  assert.ok(/if \(this\.grant\.detect\) query\.set\('detect', '1'\);/.test(g),
    'and the per-socket flag still reaches the gateway when it is earned');
});

test('the gateway takes detection per socket, not as a global mode', () => {
  const gw = strip(readFileSync('official-worker/src/speech/SpeechGateway.ts', 'utf8'));
  assert.ok(/detect: boolean/.test(gw), 'one socket asking must not change the others');
  assert.ok(/searchParams\.get\('detect'\) === '1'/.test(gw));
  assert.ok(/detect \? \['auto'\] : languages/.test(gw));
});
