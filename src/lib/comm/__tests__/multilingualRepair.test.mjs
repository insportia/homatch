// The multilingual understanding repair, pinned to what production actually
// did on 2026-09-18 -- every transcript below is what a real chirp_3 socket,
// the real batch recogniser, or the owner's own session produced.
//
//   a ka-GE socket returned NOTHING for Hebrew and Ukrainian speech
//   a ka-GE socket wrote Turkish speech in Arabic letters
//   an en-US socket wrote Georgian in Latin letters and Hebrew as an English
//     translation, and Spanish, French, German, Italian and Turkish correctly
//     -- labelled en-US every time
//   the batch recogniser, HINTED "ka", translated English and Hindi into
//     Georgian; asked with no hint it kept the language
//   "Shalom" after a Georgian conversation came back as "შალომ"
//
// So: the pinned socket stays authoritative for its own language, an `auto`
// second opinion decides the rest, recovery asks for no language, the words
// separate Latin languages, and the model is told previous language, current
// language and how strong the evidence was.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LANGUAGE_REGISTRY, LANGUAGE_CODES, latinLanguageAgainst, guessCyrillicLanguage, scoreLatinLanguages,
} from '../languageRegistry.ts';
import { resolveTurnLanguage, normaliseLanguage, textMatchesLanguage, detectLanguageRequest } from '../talkLanguage.ts';
import { planRecovery, consistentWith, hasAnyFunctionWord, RECOVERY_MAX_PER_SESSION } from '../sameTurnRecovery.ts';

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const r = (transcript, providerLanguage, previous, locale = 'ka') =>
  resolveTurnLanguage({ transcript, providerLanguage, previousSessionLanguage: previous, pageLocale: locale });

/* ── The Shalom case ─────────────────────────────────────────────────── */

test('Shalom after Georgian: held as Georgian but flagged weak, never a switch, never certain', () => {
  const t1 = r('გამარჯობა, როგორ ხარ?', 'ka-GE', null);
  assert.equal(t1.resolvedLanguage, 'ka');
  // What the ka-GE socket actually wrote for "Shalom" (measured): Georgian letters.
  const t2 = r('შალომ', 'ka-GE', 'ka');
  assert.equal(t2.resolvedLanguage, 'ka', 'one word cannot move a conversation');
  assert.equal(t2.weakEvidence, true, 'but the model must be told it was one word');
  // The same word as the `auto` socket labelled it: hi-Latn, "Shalom".
  const t2b = r('Shalom', 'hi-Latn', 'ka');
  assert.equal(t2b.resolvedLanguage, 'ka');
  assert.equal(t2b.weakEvidence, true);
  // A clear Hebrew sentence right after, as the second opinion labels it.
  const t3 = r('שלום, קוראים לי טל ואני מחפש דירת שני חדרים בתל אביב.', 'iw', 'ka');
  assert.equal(t3.resolvedLanguage, 'he');
  assert.equal(t3.switched, true);
  assert.equal(t3.weakEvidence, false);
});

/* ── Clear switches, same turn, from what the sockets really wrote ────── */

test('every clear utterance resolves to its own language on the same turn', () => {
  const cases = [
    // [transcript as the socket wrote it, label, previous, expected]
    ['Hello, my name is Tarieli and I am looking for a two-bedroom flat in Wake.', 'ka-GE', 'ka', 'en'],
    ['Здравствуйте, меня зовут Тариэль, я ищу двухкомнатную квартиру в Ваке.', 'ka-GE', 'ka', 'ru'],
    ['مرحبا اسمي طارق وابحث عن شقه بغرفه نوم في تبليسي.', 'ka-GE', 'ka', 'ar'],
    ['नमस्ते, मेरा नाम राहुल है और मुझे त्बिलिसी में दो बेडरूम वाला फ्लैट चाहिए।', 'ka-GE', 'ka', 'hi'],
    ['Hola, me llamo Tariel y busco un piso de dos habitaciones en Vake.', 'ka-GE', 'ka', 'es'],
    ["Bonjour, je m'appelle Tariel et je cherche un appartement de deux chambres à vac.", 'ka-GE', 'ka', 'fr'],
    ['Hallo, ich heiße Tariel und suche eine Wohnung mit zwei Schlafzimmern in Wacke.', 'ka-GE', 'ka', 'de'],
    ['Ciao, mi chiamo Tariel e cerco un appartamento con due camere da letto a Vec.', 'ka-GE', 'ka', 'it'],
    // the second opinion's label carries the ones the pinned socket could not write
    ['שלום, קוראים לי טל ואני מחפש דירת שני חדרים בתל אביב.', 'iw', 'ka', 'he'],
    ['Привіт, мене звати Таріел, я шукаю двокімнатну квартиру у Ваке.', 'uk', 'ka', 'uk'],
    ['Merhaba, benim adım Tarık ve Vake semtinde iki yatak odalı bir daire arıyorum.', 'tr', 'ka', 'tr'],
    // an English session: what an en-US socket wrote, labelled en-US every time
    ['Hola, me llamo Tariel y busco un piso de dos habitaciones en Vake.', 'en-US', 'en', 'es'],
    ["Bonjour, je m'appelle Tariel et je cherche un appartement de deux chambres à Vake.", 'en-US', 'en', 'fr'],
    ['Hallo, ich heiße Tarjan und suche eine Wohnung mit zwei Schlafzimmern in Wacke.', 'en-US', 'en', 'de'],
    ['Ciao, mi chiamo Tariel e cerco un appartamento con due camere da letto a Vake.', 'en-US', 'en', 'it'],
    ['Merhaba, benim adım Tarık ve Vake semtinde iki yatak odalı bir daire arıyorum.', 'en-US', 'en', 'tr'],
    ['Здравствуйте, меня зовут Тариэль, я ищу двухкомнатную квартиру в Ваке.', 'en-US', 'en', 'ru'],
    ['مرحبا, اسمي طارق وابحث عن شقه بغرفه نوم في تبليسي.', 'en-US', 'en', 'ar'],
    ['नमस्ते, मेरा नाम राहुल है और मुझे त्बिलिसी में दो बेडरूम वाला फ्लैट चाहिए।', 'en-US', 'en', 'hi'],
    ['გამარჯობა, მე ტარიელი მქვია და ვაკეში ორსაძინებლიან ბინას ვეძებ.', 'ka', 'en', 'ka'],
    // and English itself, in an English session, must not be pushed anywhere by the words
    ['Hello, my name is Tarieli and I am looking for a two-bedroom flat in Wake.', 'en-US', 'en', 'en'],
  ];
  for (const [text, label, previous, want] of cases) {
    const res = r(text, label, previous);
    assert.equal(res.resolvedLanguage, want, `${label}/${previous}: "${text.slice(0, 40)}" -> ${res.resolvedLanguage} (${res.resolutionReason})`);
    assert.equal(res.weakEvidence, false);
  }
});

test('Ukrainian is told from Russian by its own letters when the label is no help', () => {
  assert.equal(guessCyrillicLanguage('Привіт, мене звати Таріел'), 'uk');
  assert.equal(guessCyrillicLanguage('Привет, меня зовут Тариэль'), 'ru');
  assert.equal(r('Привіт, мене звати Таріел, я шукаю двокімнатну квартиру у Ваке.', 'en-US', 'en').resolvedLanguage, 'uk');
  assert.equal(r('Здравствуйте, меня зовут Тариэль, я ищу квартиру.', 'ru-RU', 'ru').resolvedLanguage, 'ru');
});

test('the words separate Latin languages, at a bar names and brands cannot reach', () => {
  assert.equal(latinLanguageAgainst('Hola, me llamo Tariel y busco un piso de dos habitaciones en Vake.', 'en'), 'es');
  assert.equal(latinLanguageAgainst('Hello, my name is Tarieli and I am looking for a flat in Vake.', 'en'), null);
  assert.equal(latinLanguageAgainst('Homatch Vake ROI', 'en'), null, 'a brand and a district are not a language');
  assert.equal(latinLanguageAgainst('Okay, sure.', 'en'), null);
  assert.equal(latinLanguageAgainst('Merhaba, benim adım Tarık ve Vake semtinde bir daire arıyorum.', 'en'), 'tr');
  assert.ok(scoreLatinLanguages('the flat is in Vake and the price is high').some((s) => s.code === 'en'));
});

/* ── Georgian protection, kept ───────────────────────────────────────── */

test('short Georgian answers mislabelled by auto do not move anything', () => {
  // Measured: `auto` wrote "კი, კარგი" as hi-Latn "Ki, kargi."
  const res = r('Ki, kargi.', 'hi-Latn', 'ka');
  assert.equal(res.resolvedLanguage, 'ka');
  assert.equal(res.switched, false);
  // and "Okay, sure." through a ka-GE socket stays a weak Georgian-held turn
  const ok = r('Okay, sure.', 'ka-GE', 'ka');
  assert.equal(ok.resolvedLanguage, 'ka');
  assert.equal(ok.weakEvidence, false, 'two words are not one word');
  assert.equal(ok.resolutionReason, 'STICKY_HELD');
});

test('the captured Georgian corruptions still stay Georgian with the new evidence rules', () => {
  for (const [t, label] of [['dir', 'lb'], ['아, 고맙습니다.', 'ko'], ['Karki', 'ha'], ['Wackisch', 'en'], ['Ki, ma interesas.', 'lt']]) {
    assert.equal(r(t, label, 'ka').resolvedLanguage, 'ka', `${t}/${label}`);
  }
});

/* ── Is the pinned socket's sentence believable? ─────────────────────── */

test('consistency: what the pinned socket wrote is judged against its own language', () => {
  // ka-GE socket, Turkish speech: Arabic letters, none of the Arabic function words
  assert.equal(consistentWith('مرحبا. بنم ادم تارك وواكه سيمتندي 2 ياتاك اودالي بير دايري اريورم.', 'ar'), false);
  assert.equal(consistentWith('مرحبا، اسمي طارق وابحث عن شقة بغرفة نوم في تبليسي.', 'ar'), true);
  // en-US socket, Georgian speech: Latin transliteration
  assert.equal(consistentWith('Gamarjoba, me Tarieli mkhvia da Vake-shi or sadzineblian binas vedzeb.', 'en'), false);
  assert.equal(consistentWith('Hello, my name is Tarieli and I am looking for a two-bedroom flat in Wake.', 'en'), true);
  // Georgian, real, through its own socket -- never overridable on this ground
  assert.equal(consistentWith('გამარჯობა, მე ტარიელი მქვია და ვაკეში ორსაძინებლიან ბინას ვეძებ.', 'ka'), true);
  assert.equal(consistentWith('ვაკეში ორსაძინებლიანი ბინა ას ორმოცდაათი ათასი', 'ka'), true, 'a listing-like Georgian sentence carries ბინა');
  // nothing, and too little to judge
  assert.equal(consistentWith('', 'ka'), false);
  assert.equal(consistentWith('privit', 'en'), true);
  // the case text cannot see -- which is why the second opinion exists at all
  assert.equal(consistentWith("Shalom, call me Tal and I'm looking for a 2-room apartment in Tel Aviv.", 'en'), true);
});

test('recovery asks for no language and names why it fired', () => {
  const base = { speechMs: 2000, spent: 0 };
  const mismatch = planRecovery({ ...base, pinned: 'ka', transcript: 'مرحبا. بنم ادم تارك وواكه سيمتندي 2 ياتاك اودالي بير دايري اريورم.' });
  assert.ok(mismatch); assert.equal(mismatch.reason, 'SCRIPT_MISMATCH'); assert.equal(mismatch.hint, null);
  const nofw = planRecovery({ ...base, pinned: 'en', transcript: 'Gamarjoba, me Tarieli mkhvia da Vake-shi or sadzineblian binas vedzeb.' });
  assert.ok(nofw); assert.equal(nofw.reason, 'NO_FUNCTION_WORDS'); assert.equal(nofw.hint, null);
  assert.equal(planRecovery({ ...base, pinned: 'en', transcript: 'Hello, my name is Tarieli and I am looking for a flat.' }), null);
  assert.equal(planRecovery({ ...base, pinned: 'ka', transcript: 'კი, კარგი.' }), null, 'short Georgian never recovers');
  assert.equal(planRecovery({ ...base, pinned: 'en', transcript: 'Gamarjoba, me Tarieli mkhvia da Vake-shi or sadzineblian binas vedzeb.', spent: RECOVERY_MAX_PER_SESSION }), null);
});

/* ── The second opinion, as wired ────────────────────────────────────── */

test('every turn is heard twice; the pinned socket stays authoritative for its own language', () => {
  const c = strip(readFileSync('src/lib/comm/voiceClient.ts', 'utf8'));
  assert.match(c, /createTranscriber\(\{ \.\.\.grant, detect: true \}/, 'the second socket is `auto`');
  assert.match(c, /this\.feedShadow\(pcm\)/, 'and hears the same bytes');
  assert.match(c, /this\.shadow\?\.finalize\?\.\(\)/, 'and is finalised with the primary');
  assert.match(c, /if \(!live\.trim\(\)\) return \{ use: true, why: 'LIVE_EMPTY' \}/, 'an empty primary is replaced');
  assert.match(c, /if \(!consistentWith\(live, pinned\)\) return \{ use: true, why: 'LIVE_INCONSISTENT' \}/, 'an inconsistent one is replaced');
  assert.match(c, /if \(pinnedLatin && !opinionLatin\) return \{ use: true, why: 'LATIN_SOCKET_TRANSLATED' \}/, 'a Latin socket contradicted by a non-Latin opinion is replaced');
  assert.match(c, /return \{ use: false, why: 'LIVE_CONSISTENT' \}/, 'and a consistent Georgian sentence is never overridden');
  assert.match(c, /if \(!substantial\) return \{ use: false, why: 'OPINION_TOO_SHORT' \}/, 'short opinions change nothing');
  assert.match(c, /this\.producedEpoch === this\.utteranceEpoch/, 'a late primary final for a carried turn is dropped');
  assert.match(c, /await this\.cb\.onTranscribe\(wav, null\)/, 'the batch fallback is asked with NO hint');
  assert.doesNotMatch(c, /onTranscribe\(wav, plan\.hint\)/, 'the hinted call that translated is gone');
});

test('the previous language and the strength of the evidence reach the server, and the server states them', () => {
  const p = strip(readFileSync('src/components/home/AiTalkPanel.tsx', 'utf8'));
  assert.match(p, /previousLanguage: sessionRef\.current\.languageTrace\.previousLanguage/);
  assert.match(p, /turnLanguageReason:/);
  assert.match(p, /turnLanguageConfidence:/);
  const e = readFileSync('supabase/functions/ai-talk-session/index.ts', 'utf8');
  for (const s of ['CURRENT USER TURN LANGUAGE:', 'RESPOND IN:', 'PREVIOUS CONVERSATION LANGUAGE:',
    'LANGUAGE EVIDENCE FOR THIS TURN IS WEAK', 'do not', 'repeat their word back to them twice',
    'CONVERSATION CONTEXT: the recent turns above are still the conversation']) {
    assert.ok(e.includes(s), s);
  }
  assert.match(e, /previous_conversation_language: body\.previousLanguage \?\? null/, 'and traces it');
});

/* ── The prompt: hear, understand, answer directly, know your languages ── */

test('the prompt answers directly, bans the narrated-thinking openers and stops claiming three languages', () => {
  const e = readFileSync('supabase/functions/ai-talk-session/index.ts', 'utf8');
  assert.match(e, /FIRST HEAR THEM, THEN UNDERSTAND THEM, THEN ANSWER/);
  assert.match(e, /ANSWER DIRECTLY\. Start with the substance/);
  for (const banned of ['ვფიქრობ', 'მოდი ვიფიქროთ', 'როგორც AI', 'я думаю', '"I think"', '"as an AI"', '"based on my analysis"']) {
    assert.ok(e.includes(banned), `${banned} is named as a banned opening`);
  }
  assert.match(e, /YOU SPEAK MANY LANGUAGES/);
  assert.match(e, /Never say you only know two or three languages/);
  assert.match(e, /never the opening words, never "as an AI"/, 'the AI mention is no longer an opener');
  assert.doesNotMatch(e, /Say you are an AI assistant in your FIRST reply only, briefly/);
});

test('the public copy no longer lists three languages, in every locale', () => {
  const t = readFileSync('src/i18n/translations.ts', 'utf8');
  assert.doesNotMatch(t, /talk_languages: 'ქართული, ინგლისური, რუსული'/);
  assert.doesNotMatch(t, /talk_languages: 'Georgian, English, Russian'/);
  const rows = t.match(/^  talk_languages: '.*',$/gm) ?? [];
  assert.equal(rows.length, 6, 'six locales');
  for (const row of rows) assert.match(row, /AI Talk/, row);
  assert.doesNotMatch(t, /home_works_in_langs: 'Works in Georgian, English, Russian, Turkish, Arabic & Hebrew'/);
});

/* ── The registry, corrected against the gateway ─────────────────────── */

test('every live tag is one the gateway actually forwards, and the count is honest', () => {
  for (const l of LANGUAGE_REGISTRY) {
    assert.match(l.sttTag, /^[a-z]{2}-[A-Z]{2}$/, `${l.code}: ${l.sttTag} would silently fall back to the session default`);
  }
  assert.equal(LANGUAGE_CODES.includes('zh'), false);
  assert.equal(LANGUAGE_CODES.includes('tl'), false);
  assert.equal(LANGUAGE_CODES.length, 41);
  assert.equal(normaliseLanguage('cmn-Hans-CN'), null);
  assert.equal(normaliseLanguage('hi-Latn'), 'hi');
  assert.equal(normaliseLanguage('iw'), 'he');
});

/* ── The reply-language guard knows every script, not four ───────────── */

test("a reply in the language's own script passes the guard for every registry language", () => {
  const samples = {
    hi: 'नमस्ते! आपका नाम राहुल है और आप त्बिलिसी में फ्लैट ढूंढ रहे हैं।',
    he: 'שלום טל, שתיים ועוד שתיים זה ארבע.',
    ar: 'مرحبا طارق، ثلاثة زائد اثنين يساوي خمسة.',
    uk: 'Привіт, Тарієл. Два плюс три буде пʼять.',
    ru: 'Привет, Тариэль. Два плюс три будет пять.',
    el: 'Γεια σου, δύο συν δύο κάνει τέσσερα.',
    th: 'สวัสดีครับ สองบวกสองเท่ากับสี่',
    ko: '안녕하세요, 이 더하기 이는 사입니다.',
    ja: 'こんにちは、二足す二は四です。',
    ka: 'გამარჯობა, ორს დამატებული სამი ხუთია.',
    en: 'Hello Tarieli, two plus three is five.',
    tr: 'Merhaba Tarık, üç artı üç altı eder.',
    es: 'Hola Tariel, dos más dos son cuatro.',
  };
  for (const [lang, text] of Object.entries(samples)) assert.equal(textMatchesLanguage(text, lang), true, lang);
  assert.equal(textMatchesLanguage('Hello Tarieli, two plus three is five.', 'hi'), false, 'English is not a Hindi reply');
  assert.equal(textMatchesLanguage('नमस्ते! आपका नाम राहुल है।', 'en'), false, 'and Devanagari is not an English one');
});

test('"English, please." is a request to switch', () => {
  assert.equal(detectLanguageRequest('English, please.', 'ka'), 'en');
  assert.equal(detectLanguageRequest('ინგლისურად, თუ შეიძლება', 'ka'), null, 'without a cue word it is not one (kept as before)');
  assert.equal(detectLanguageRequest('Do you speak English?', 'ka'), 'en', 'pre-existing behaviour, unchanged');
});

/* ── A fallback is a moment, not a verdict ───────────────────────────── */

test('after a fallback to batch the live path is retried, bounded, between turns; and batch keeps the language trace', () => {
  const c = strip(readFileSync('src/lib/comm/voiceClient.ts', 'utf8'));
  assert.match(c, /const LIVE_RETRY_MAX = 3;/);
  assert.match(c, /this\.scheduleLiveRetry\(\);/, 'every abandon schedules a retry');
  assert.match(c, /if \(this\.liveRetries >= LIVE_RETRY_MAX\) return;/, 'bounded');
  assert.match(c, /if \(\/no grant source\|session closed\/\.test\(why\)\) return;/, 'not for reasons that will not change');
  assert.match(c, /if \(this\.turnInFlight \|\| this\.transcribing \|\| this\.state === 'RESPONDING'\)/, 'never under a turn');
  assert.match(c, /window\.clearTimeout\(this\.liveRetryTimer\)/, 'and stopped with the session');
  const resolutions = c.match(/resolveTurnLanguage\(\{/g) ?? [];
  assert.ok(resolutions.length >= 2, 'the live path and the batch path both resolve the turn');
  assert.match(c, /this\.lastResolution = resolveTurnLanguage\(\{/, 'and the batch path keeps what the server is told');
});

/* ── Fragments and greetings ─────────────────────────────────────────── */

test('two words of Arabic letters for a Hebrew sentence are a fragment the opinion may replace', () => {
  // Measured on chain B: an ar-XA socket wrote "خرم كرميتال" for Hebrew speech.
  assert.equal(hasAnyFunctionWord('خرم كرميتال', 'ar'), false);
  assert.equal(hasAnyFunctionWord('مرحبا، اسمي طارق.', 'ar'), true, 'a real short Arabic sentence has one');
  assert.equal(hasAnyFunctionWord('კი, კარგი.', 'ka'), true, 'a real short Georgian answer has one');
  assert.equal(hasAnyFunctionWord('ვაკეში ბინა', 'ka'), true);
  assert.equal(hasAnyFunctionWord('anything', 'ja'), true, 'unjudgeable languages are never fragments');
  const c = strip(readFileSync('src/lib/comm/voiceClient.ts', 'utf8'));
  assert.match(c, /if \(liveWords < RECOVERY_MIN_WORDS && !hasAnyFunctionWord\(live, pinned\)\)/);
  assert.match(c, /why: 'LIVE_FRAGMENT'/);
});

test('the pause after a greeting gets the patience of a composed sentence, and nothing else does', () => {
  const c = strip(readFileSync('src/lib/comm/voiceClient.ts', 'utf8'));
  assert.match(c, /const END_TURN_GREETING_MS = 900;/);
  assert.match(c, /this\.livePartialWords > 0 && this\.livePartialWords <= 2 && this\.liveSpeechMs >= END_TURN_ACK_SPEECH_MS/);
  assert.match(c, /window = Math\.max\(window, END_TURN_GREETING_MS\)/);
  assert.match(c, /const END_TURN_SHORT_MS = 600;/, 'the measured mid window is untouched');
});

/* ── A detected label is evidence; a configured one is not ───────────── */

test('a short clear switch out of a non-Latin session is accepted when the label was DETECTED', () => {
  // Measured on chain A: "Benim adım ne?" after an Arabic turn. Three words,
  // twelve letters -- under the bar written for corrupted transcripts -- and
  // it was held in Arabic, so a Turkish question got an Arabic answer.
  const configured = resolveTurnLanguage({
    transcript: 'Benim adım ne?', providerLanguage: 'tr',
    previousSessionLanguage: 'ar', pageLocale: 'ka',
  });
  assert.equal(configured.resolvedLanguage, 'ar', 'an unexplained label still cannot move it');
  const detected = resolveTurnLanguage({
    transcript: 'Benim adım ne?', providerLanguage: 'tr', providerDetected: true,
    previousSessionLanguage: 'ar', pageLocale: 'ka',
  });
  assert.equal(detected.resolvedLanguage, 'tr', 'the auto socket actually identified it');
  assert.equal(detected.resolutionReason, 'PROVIDER_LATIN');
  // One word is still one word, however it was labelled.
  assert.equal(resolveTurnLanguage({
    transcript: 'Shalom', providerLanguage: 'tr', providerDetected: true,
    previousSessionLanguage: 'ka', pageLocale: 'ka',
  }).resolvedLanguage, 'ka');
  // And a pinned socket's own label is never promoted by this.
  assert.equal(resolveTurnLanguage({
    transcript: 'Karki', providerLanguage: 'en', providerDetected: true,
    previousSessionLanguage: 'ka', pageLocale: 'ka',
  }).resolvedLanguage, 'ka', 'a one-word mis-hearing cannot switch a session');
});

test('the client says which kind of label it is, and the server is told', () => {
  const c = strip(readFileSync('src/lib/comm/voiceClient.ts', 'utf8'));
  assert.match(c, /let heardByDetected = false;/);
  assert.match(c, /heardByDetected = Boolean\(opinionLang\);/, 'the opinion is a detection');
  assert.match(c, /heardByDetected = Boolean\(outcome\.language\);/, 'so is the recovery');
  assert.match(c, /providerDetected: heardByDetected,/, 'and the resolver is told which it was');
  const p = strip(readFileSync('src/components/home/AiTalkPanel.tsx', 'utf8'));
  assert.match(p, /providerDetected: sessionRef\.current\.languageTrace\.providerDetected,/);
  const e = readFileSync('supabase/functions/ai-talk-session/index.ts', 'utf8');
  assert.match(e, /providerDetected: body\.providerDetected === true,/);
});

test('two words of another script are enough for the opinion to be heard', () => {
  const c = strip(readFileSync('src/lib/comm/voiceClient.ts', 'utf8'));
  assert.match(c, /const substantial = evidence\.letters >= minLetters && \(!spaced \|\| words >= 2\);/);
  // "მადლობა, ნახვამდის." out of a Spanish-pinned socket came back as
  // "Madoba, najuandis." -- two words each, and only the script tells them apart.
  assert.equal(consistentWith('Madoba, najuandis.', 'es'), true, 'the fragment itself looks Spanish enough');
  assert.equal(hasAnyFunctionWord('Madoba, najuandis.', 'es'), false, 'but carries no Spanish');
});

test('a discredited transcript is replaced even by a short opinion, and a credible one is not', () => {
  const c = strip(readFileSync('src/lib/comm/voiceClient.ts', 'utf8'));
  const judge = c.slice(c.indexOf('private judgeSecondOpinion('), c.indexOf('private async recoverUtterance('));
  const at = (s) => judge.indexOf(s);
  assert.ok(at("why: 'LIVE_INCONSISTENT'") > 0 && at("why: 'OPINION_TOO_SHORT'") > 0);
  assert.ok(at("why: 'LIVE_INCONSISTENT'") < at("why: 'OPINION_TOO_SHORT'"),
    'a transcript in the wrong script loses before the opinion is measured');
  assert.ok(at("why: 'LIVE_FRAGMENT'") < at("why: 'OPINION_TOO_SHORT'"),
    'and so does a fragment with none of its own language in it');
  assert.ok(at("why: 'OPINION_TOO_SHORT'") < at("why: 'LIVE_CONSISTENT'"),
    'but a credible transcript is only overturned by a substantial opinion');
});

test('a wrong-script fragment earns a recovery even below the function-word floor', () => {
  // "RAM x 6Y" -- what a ru-RU socket wrote for a short Georgian question.
  const plan = planRecovery({ pinned: 'ru', transcript: 'RAM x 6Y', speechMs: 1500, spent: 0 });
  assert.ok(plan); assert.equal(plan.reason, 'SCRIPT_MISMATCH'); assert.equal(plan.hint, null);
  assert.equal(planRecovery({ pinned: 'ru', transcript: 'RAM', speechMs: 1500, spent: 0 }), null,
    'one word is still not enough to pay for a batch call');
  assert.equal(planRecovery({ pinned: 'ru', transcript: 'Да, хорошо.', speechMs: 1500, spent: 0 }), null,
    'and a real short Russian answer is left alone');
});

/* ── A question about numbers has few letters ────────────────────────── */

test('a short Hebrew question full of digits still switches, and the corruptions still do not', () => {
  // Measured on chain B: "כמה זה 2 + 2?" -- five Hebrew letters, because the
  // digits and the plus are not letters -- was held in Russian.
  const he = r('כמה זה 2 + 2?', 'he', 'ru');
  assert.equal(he.resolvedLanguage, 'he');
  assert.equal(he.switched, true);
  // One word of it is still one word.
  assert.equal(r('שלום', 'he', 'ka').resolvedLanguage, 'ka');
  // And the Korean regression v87 fixed stays fixed: two words, six blocks.
  assert.equal(r('아, 고맙습니다.', 'ko', 'ka').resolvedLanguage, 'ka');
  // The captured Latin corruptions are held by confidence, not by the floor.
  for (const [t2, label] of [['dir', 'lb'], ['Karki', 'ha'], ['Wackisch', 'en'], ['Ki, ma interesas.', 'lt']]) {
    assert.equal(r(t2, label, 'ka').resolvedLanguage, 'ka', `${t2}/${label}`);
  }
});

test('the conversation the model is told about is eight turns deep', () => {
  const p = readFileSync('src/components/home/AiTalkPanel.tsx', 'utf8');
  assert.match(p, /history: historyRef\.current\.slice\(-16\)/);
  const e = readFileSync('supabase/functions/ai-talk-session/index.ts', 'utf8');
  assert.match(e, /body\.history\.slice\(-16\)/, 'and the server accepts all of it');
});

test('a turn the second opinion carried is never re-transcribed on top', () => {
  const c = strip(readFileSync('src/lib/comm/voiceClient.ts', 'utf8'));
  assert.match(c, /const plan = \(opinion \|\| origin === 'SHADOW'\) \? null/);
});

/* ── Courtesy words are words ────────────────────────────────────────── */

test('an ordinary thank-you is never mistaken for gibberish, in any supported language', () => {
  // Measured on the same-language controls: "მადლობა." and "Спасибо." carried
  // no listed word, so the fragment rule replaced a correct transcript with a
  // foreign-script guess. The language still held, but the visitor saw their
  // own word written back in the wrong alphabet.
  const courtesy = [
    ['მადლობა.', 'ka'], ['გმადლობთ.', 'ka'], ['ნახვამდის.', 'ka'], ['გამარჯობა.', 'ka'],
    ['Спасибо.', 'ru'], ['Привет.', 'ru'], ['Thanks.', 'en'], ['Hello.', 'en'],
    ['Merhaba.', 'tr'], ['Teşekkürler.', 'tr'], ['Gracias.', 'es'], ['Hola.', 'es'],
    ['Merci.', 'fr'], ['Danke.', 'de'], ['Grazie.', 'it'], ['Obrigado.', 'pt'],
    ['תודה.', 'he'], ['שלום.', 'he'], ['شكرا.', 'ar'], ['مرحبا.', 'ar'],
    ['धन्यवाद।', 'hi'], ['नमस्ते।', 'hi'], ['Дякую.', 'uk'],
  ];
  for (const [text, lang] of courtesy) {
    assert.equal(hasAnyFunctionWord(text, lang), true, `${text} (${lang})`);
  }
  // And the transliterations still carry none of the language they claim.
  assert.equal(hasAnyFunctionWord('Madoba, najuandis.', 'es'), false);
  assert.equal(hasAnyFunctionWord('خرم كرميتال', 'ar'), false);
  assert.equal(hasAnyFunctionWord('машин шили', 'ru'), false);
});
