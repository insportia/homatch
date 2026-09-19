/*
 * THE LANGUAGE SOMEBODY SPEAKS DECIDES THE CONVERSATION. THE WEBSITE DOES NOT.
 *
 * MEASURED, production session caeddb62-6392-42ba-a764-169459d5c5fc,
 * 2026-09-19 16:01:07 UTC. Page English, visitor speaking Georgian, recogniser
 * pinned ka-GE -- and Google returned a Devanagari transcript labelled `hi`.
 * The turn trace is unambiguous:
 *
 *   ui_locale                  en
 *   provider_language          hi
 *   transcript_script          devanagari
 *   previous_session_language  hi
 *   resolved_language          hi     reason SCRIPT, confidence 1
 *   reply_language_guard       OK
 *   tts_request_language       hi
 *
 * Every layer did what it was told. Hindi was in the forty-four-language
 * registry, so it was "supported"; Devanagari belongs to one language, so
 * script settled it at confidence 1; and Luna was then instructed to answer
 * in Hindi and Cartesia was sent `hi`. The allowlist was the bug.
 *
 * These tests are the allowlist, the six languages a conversation may be in,
 * and the symmetry that makes returning to Georgian as easy as leaving it.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveTurnLanguage, detectLanguageRequest, SPOKEN_LANGUAGES, spokenLanguageOrNull,
  textMatchesLanguage,
} from '../talkLanguage.ts';

const SIX = ['ka', 'en', 'ru', 'tr', 'ar', 'he'];

/** A committed turn, as the resolver sees one. */
const turn = (over = {}) => resolveTurnLanguage({
  transcript: '',
  providerLanguage: null,
  providerDetected: true,
  previousSessionLanguage: null,
  pageLocale: 'en',
  sessionLanguages: [],
  unconfirmedLanguage: null,
  firstTurn: false,
  ...over,
});

/* Real sentences, because the resolver reads words as well as letters. */
const SAID = {
  ka: 'გამარჯობა, ვეძებ ბინას ვაკეში და მაინტერესებს ფასი',
  en: 'Hello, I am looking for a two bedroom flat in Vake and I want to know the price',
  ru: 'Здравствуйте, я ищу двухкомнатную квартиру в Ваке и хочу узнать цену',
  tr: 'Merhaba, Vake bölgesinde iki odalı bir daire arıyorum ve fiyatını öğrenmek istiyorum',
  ar: 'مرحبا، أبحث عن شقة بغرفتين في فاكي وأريد أن أعرف السعر',
  he: 'שלום, אני מחפש דירת שני חדרים בוואקה ורוצה לדעת את המחיר',
  hi: 'नमस्ते, मैं वाके में दो कमरों का फ्लैट ढूंढ रहा हूं और कीमत जानना चाहता हूं',
};

/* ── The allowlist itself ────────────────────────────────────────────────*/

test('a conversation may be held in exactly six languages', () => {
  assert.deepEqual([...SPOKEN_LANGUAGES].sort(), [...SIX].sort());
  for (const code of SIX) assert.equal(spokenLanguageOrNull(code), code);
  for (const code of ['hi', 'te', 'ur', 'fa', 'az', 'hy', 'el', 'mr', 'es', 'de']) {
    assert.equal(spokenLanguageOrNull(code), null, `${code} may not carry a conversation`);
  }
});

/* ── The incident, reproduced ────────────────────────────────────────────*/

test('the production incident: Devanagari at confidence 1 cannot take the session', () => {
  // Exactly the trace: English page, a Devanagari transcript labelled hi.
  const r = turn({
    transcript: SAID.hi,
    providerLanguage: 'hi',
    pageLocale: 'en',
    previousSessionLanguage: null,
  });
  assert.equal(r.resolvedLanguage, 'en', 'Hindi became the conversation again');
  assert.equal(r.resolutionReason, 'UNSUPPORTED_LANGUAGE');
  assert.ok(SPOKEN_LANGUAGES.includes(r.resolvedLanguage));
});

test('a session already captured by an unsupported language can come home', () => {
  // previous_session_language was `hi` on the very first traced turn, and
  // every later Hindi turn then counted as "already spoken here".
  const r = turn({
    transcript: SAID.ka,
    providerLanguage: 'ka',
    pageLocale: 'en',
    previousSessionLanguage: 'hi',
  });
  assert.equal(r.resolvedLanguage, 'ka');
});

test('an unsupported language never mutates the session, from any previous state', () => {
  for (const previous of [...SIX, null]) {
    for (const bad of ['hi', 'te', 'ur', 'el']) {
      const r = turn({
        transcript: bad === 'hi' ? SAID.hi : 'ಇದು ಬೇರೊಂದು ಭಾಷೆ',
        providerLanguage: bad,
        pageLocale: 'en',
        previousSessionLanguage: previous,
      });
      assert.ok(
        SPOKEN_LANGUAGES.includes(r.resolvedLanguage),
        `previous=${previous} detector=${bad} gave ${r.resolvedLanguage}`,
      );
      if (previous) assert.equal(r.resolvedLanguage, previous, `previous=${previous} was lost to ${bad}`);
    }
  }
});

/* ── The page is a prior, never an authority ─────────────────────────────*/

test('any UI language plus strong Georgian speech gives Georgian', () => {
  for (const ui of SIX) {
    const r = turn({
      transcript: SAID.ka,
      providerLanguage: 'ka',
      pageLocale: ui,
      previousSessionLanguage: ui === 'ka' ? 'ka' : ui,
    });
    assert.equal(r.resolvedLanguage, 'ka', `UI=${ui} did not yield Georgian`);
  }
});

test('a Georgian page plus strong speech in each of the other five follows the speech', () => {
  for (const spoken of ['en', 'ru', 'tr', 'ar', 'he']) {
    const r = turn({
      transcript: SAID[spoken],
      providerLanguage: spoken,
      pageLocale: 'ka',
      previousSessionLanguage: 'ka',
      sessionLanguages: ['ka'],
    });
    assert.equal(r.resolvedLanguage, spoken, `KA page did not follow ${spoken}`);
  }
});

/* ── Round trips, in both directions, at the same cost ───────────────────*/

test('every supported language returns to Georgian on the turn that asks', () => {
  for (const away of ['en', 'ru', 'tr', 'ar', 'he']) {
    const back = turn({
      transcript: SAID.ka,
      providerLanguage: 'ka',
      pageLocale: away,
      previousSessionLanguage: away,
      sessionLanguages: ['ka', away],
    });
    assert.equal(back.resolvedLanguage, 'ka', `KA -> ${away} -> KA failed to come back`);
  }
});

test('an English page, Georgian, English, Georgian again', () => {
  const one = turn({ transcript: SAID.ka, providerLanguage: 'ka', pageLocale: 'en', previousSessionLanguage: null });
  assert.equal(one.resolvedLanguage, 'ka');

  const two = turn({
    transcript: SAID.en, providerLanguage: 'en', pageLocale: 'en',
    previousSessionLanguage: 'ka', sessionLanguages: ['ka'],
  });
  assert.equal(two.resolvedLanguage, 'en');

  const three = turn({
    transcript: SAID.ka, providerLanguage: 'ka', pageLocale: 'en',
    previousSessionLanguage: 'en', sessionLanguages: ['ka', 'en'],
  });
  assert.equal(three.resolvedLanguage, 'ka', 'the session could not get home');
});

test('a Russian page, Georgian, Russian, Georgian again', () => {
  const one = turn({ transcript: SAID.ka, providerLanguage: 'ka', pageLocale: 'ru', previousSessionLanguage: null });
  assert.equal(one.resolvedLanguage, 'ka');

  const two = turn({
    transcript: SAID.ru, providerLanguage: 'ru', pageLocale: 'ru',
    previousSessionLanguage: 'ka', sessionLanguages: ['ka'],
  });
  assert.equal(two.resolvedLanguage, 'ru');

  const three = turn({
    transcript: SAID.ka, providerLanguage: 'ka', pageLocale: 'ru',
    previousSessionLanguage: 'ru', sessionLanguages: ['ka', 'ru'],
  });
  assert.equal(three.resolvedLanguage, 'ka');
});

/* ── What must never move a conversation ─────────────────────────────────*/

test('noise, gibberish and a bare proper noun leave the language alone', () => {
  const held = ['ka', 'en'];
  for (const previous of held) {
    for (const junk of ['', '...', 'Villion', 'Abba', 'mhm']) {
      const r = turn({
        transcript: junk, providerLanguage: null,
        pageLocale: previous, previousSessionLanguage: previous,
      });
      assert.equal(r.resolvedLanguage, previous, `"${junk}" moved a ${previous} session`);
    }
  }
});

test('one foreign name inside a sentence does not change the sentence', () => {
  const withName = turn({
    transcript: 'გამარჯობა, მაინტერესებს პროექტი Villion Residence ვაკეში და მისი ფასი',
    providerLanguage: 'ka', pageLocale: 'en',
    previousSessionLanguage: 'ka', sessionLanguages: ['ka'],
  });
  assert.equal(withName.resolvedLanguage, 'ka');

  const dubai = turn({
    transcript: 'ვფიქრობ Dubai-ში ინვესტიციაზე, რას მირჩევ ამ შემთხვევაში',
    providerLanguage: 'ka', pageLocale: 'en',
    previousSessionLanguage: 'ka', sessionLanguages: ['ka'],
  });
  assert.equal(dubai.resolvedLanguage, 'ka');

  const tbilisi = turn({
    transcript: 'I am looking for an apartment in თბილისი and I want to know the price range',
    providerLanguage: 'en', pageLocale: 'en',
    previousSessionLanguage: 'en', sessionLanguages: ['en'],
  });
  assert.equal(tbilisi.resolvedLanguage, 'en', 'one Georgian place name flipped an English sentence');
});

/* ── Asking for a language out loud ──────────────────────────────────────*/

test('a visitor may ask for one of the six, and only one of the six', () => {
  assert.equal(detectLanguageRequest('ინგლისურად დამელაპარაკე', 'ka'), 'en');
  assert.equal(detectLanguageRequest('speak to me in georgian please', 'en'), 'ka');
  // Not a language this product holds conversations in, however clearly asked.
  assert.equal(detectLanguageRequest('speak to me in hindi please', 'en'), null);
  assert.equal(detectLanguageRequest('please speak spanish', 'en'), null);
});

/* ── The invariant, over every combination ───────────────────────────────*/

test('the resolver cannot name a language outside the six, whatever it is given', () => {
  const detectors = [...SIX, 'hi', 'te', 'ur', 'el', 'mr', 'es', 'de', 'zz', null];
  const transcripts = Object.values(SAID).concat(['', 'Abba', '???']);
  for (const providerLanguage of detectors) {
    for (const transcript of transcripts) {
      for (const previousSessionLanguage of ['ka', 'en', 'hi', null]) {
        const r = turn({ transcript, providerLanguage, previousSessionLanguage, pageLocale: 'en' });
        assert.ok(
          SPOKEN_LANGUAGES.includes(r.resolvedLanguage),
          `detector=${providerLanguage} previous=${previousSessionLanguage} gave ${r.resolvedLanguage}`,
        );
      }
    }
  }
});

/* ── The last gate before a visitor hears it ───────────────────────*/

test('an answer in the wrong language is caught before it reaches the voice', () => {
  // The guard was never broken. It was handed the wrong expectation: in the
  // incident it was asked whether a Hindi answer matched Hindi, and it did.
  assert.equal(textMatchesLanguage(SAID.hi, 'ka'), false, 'a Devanagari answer passed as Georgian');
  assert.equal(textMatchesLanguage(SAID.hi, 'en'), false);
  assert.equal(textMatchesLanguage(SAID.en, 'ka'), false);
  assert.equal(textMatchesLanguage(SAID.ka, 'en'), false);
});

test('a correct answer in each of the six passes the guard', () => {
  for (const code of SIX) {
    assert.equal(textMatchesLanguage(SAID[code], code), true, `a real ${code} answer was rejected`);
  }
});

/* ── The probe that corrupted Georgian, and the loop it ran in ───────────*/

import { readFileSync } from 'node:fs';
const CLIENT = readFileSync('src/lib/comm/voiceClient.ts', 'utf8')
  .split(String.fromCharCode(13)).join('');
const CLIENT_CODE = CLIENT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('an unsupported probe result is not evidence that the probe is needed', () => {
  /*
   * Production session a266de0d, 2026-09-19 16:22, Georgian page, Georgian
   * speaker: t1 three characters and provider `und` armed the probe; t3 ran
   * with `auto` and came back DEVANAGARI, provider `hi`.
   *
   * The allowlist then resolved that at 0.3 -- below the 0.5 floor -- which
   * counted the turn as unresolved and armed the probe again. Every fix to
   * the resolver made this tighter, because every unsupported label lands
   * under the floor.
   */
  assert.match(CLIENT_CODE, /const unsupported = resolution\.resolutionReason === 'UNSUPPORTED_LANGUAGE';/);
  assert.match(
    CLIENT_CODE,
    /const unresolved = !unsupported\s*&&\s*\(resolution\.resolutionReason === 'STICKY_HELD' \|\| resolution\.confidence < 0\.5\);/,
    'an unsupported result counts as a weak turn again, which re-arms the probe',
  );
});

test('the probe is retired once it has named a language we do not speak', () => {
  assert.match(CLIENT_CODE, /const MAX_UNSUPPORTED_PROBES = 2;/);
  assert.match(
    CLIENT_CODE,
    /this\.weakTurns >= needed && this\.unsupportedProbeResults < MAX_UNSUPPORTED_PROBES/,
    'the probe can be armed forever regardless of how often auto fails',
  );
  assert.match(CLIENT_CODE, /this\.unsupportedProbeResults \+= 1;/);
});

test('the pinned prior, not auto, configures the deciding socket', () => {
  // `auto` is measured in googleTranscribe.ts to damage short supported
  // speech. It stays a bounded probe rather than the default configuration.
  assert.match(CLIENT_CODE, /const probing = this\.probeLanguageNext;/);
  assert.match(CLIENT_CODE, /detect: probing/);
  const google = readFileSync('src/lib/comm/googleTranscribe.ts', 'utf8');
  assert.match(google, /if \(this\.grant\.detect\) query\.set\('detect', '1'\);/);
  // And the established language is still sent as its own parameter.
  assert.match(google, /query\.set\('language', tag\)/);
});
