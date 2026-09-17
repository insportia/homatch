// Six languages through one recogniser that only takes one at a time.
//
// MEASURED against the deployed worker (chirp_3, v2, eu endpoint), one live
// socket per code, real PCM, 2026-09-17: every tag the client can send is
// ACCEPTED -- ka-GE, en-US, ru-RU, tr-TR, ar-XA, iw-IL, and also ar-EG,
// ar-SA, he-IL. So Arabic not working was never the recogniser refusing the
// configuration, and the fix is not a different language code.
//
// (The first run of that probe reported BAD_CONFIG for all nine, including
// Georgian, which works in production every day. The probe was sending a
// whole second in one message, over Google's per-request ceiling. A harness
// that fails identically for every input is measuring itself.)
//
// What remains is routing: the recogniser is configured with ONE language,
// so the question is which, and how a session may change its mind.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTurnLanguage } from '../talkLanguage.ts';

const SIX = ['ka', 'en', 'ru', 'ar', 'tr', 'he'];

/** What the client maps our languages onto, and what the socket carries. */
const TAGS = { ka: 'ka-GE', en: 'en-US', ru: 'ru-RU', tr: 'tr-TR', ar: 'ar-XA', he: 'iw-IL' };

const SENTENCES = {
  ka: ['გამარჯობა, ვაკეში ბინა მაინტერესებს.', 'რამდენი ღირს კვადრატული მეტრი ვაკეში?'],
  en: ['Hello, I am looking for a two bedroom apartment.', 'What does a square metre cost in Vake?'],
  ru: ['Здравствуйте, я ищу двухкомнатную квартиру.', 'Сколько стоит квадратный метр в Ваке?'],
  ar: ['مرحبا، أبحث عن شقة في تبليسي.', 'كم سعر المتر المربع في فاكي؟'],
  tr: ['Merhaba, Tiflis\'te bir daire arıyorum.', 'Vake\'de metrekare fiyatı nedir?'],
  he: ['שלום, אני מחפש דירה בטביליסי.', 'כמה עולה מטר מרובע בוואקה?'],
};

/** The provider tag Google returns for each, as it actually labels them. */
const HEARD = { ka: 'ka', en: 'en', ru: 'ru', ar: 'ar', tr: 'tr', he: 'iw' };

test('every supported language has a tag the live recogniser accepts', () => {
  for (const code of SIX) {
    assert.ok(TAGS[code], `${code} has no BCP-47 tag`);
    assert.match(TAGS[code], /^[a-z]{2,3}-[A-Z]{2}$/,
      `${TAGS[code]} would fail the gateway's own validation and fall back to the default`);
  }
});

test('a real sentence in each of the six resolves to that language', () => {
  for (const code of SIX) {
    for (const said of SENTENCES[code]) {
      const r = resolveTurnLanguage({
        transcript: said, providerLanguage: HEARD[code],
        previousSessionLanguage: null, pageLocale: 'ka',
      });
      assert.equal(r.resolvedLanguage, code, `"${said}" resolved to ${r.resolvedLanguage}`);
    }
  }
});

test('a deliberate switch is honoured in both directions', () => {
  for (const code of SIX.filter((c) => c !== 'ka')) {
    // Georgian session, a whole sentence in another language.
    const away = resolveTurnLanguage({
      transcript: SENTENCES[code][0], providerLanguage: HEARD[code],
      previousSessionLanguage: 'ka', pageLocale: 'ka',
    });
    assert.equal(away.resolvedLanguage, code, `ka -> ${code} did not switch`);

    // And back again.
    const home = resolveTurnLanguage({
      transcript: SENTENCES.ka[0], providerLanguage: 'ka',
      previousSessionLanguage: code, pageLocale: 'ka',
    });
    assert.equal(home.resolvedLanguage, 'ka', `${code} -> ka did not switch back`);
  }
});

test('a single weak token NEVER moves an established session', () => {
  /*
   * The one that started all of this: "Abba", four Latin letters from a
   * clipped Georgian word, took a whole session to English. Every token
   * below is a real thing people say mid-conversation.
   */
  const weak = ['ok', 'yes', 'no', 'да', 'нет', 'არა', 'კი', 'ჰო', 'Abba', 'ok.', 'mm'];
  /*
   * Two different claims, and only one of them is about every token.
   *
   * NOT MOVING is universal: no single weak word may redirect a conversation.
   * NOT LOCKING applies only where the token is FOREIGN to the session -- a
   * Georgian "არა" in a Georgian session is unambiguous evidence FOR Georgian,
   * and treating that as suspicious would be the wrong lesson to draw from
   * "Abba", which was foreign to its session and four letters long.
   */
  // Ranges built from code points, so no escape can become a literal byte.
  const inScript = (text, lo, hi) => [...text].some((ch) => ch.codePointAt(0) >= lo && ch.codePointAt(0) <= hi);
  const isNative = (session, text) => {
    if (session === 'ka') return inScript(text, 0x10A0, 0x10FF);
    if (session === 'ru') return inScript(text, 0x0400, 0x04FF);
    if (session === 'he') return inScript(text, 0x0590, 0x05FF);
    if (session === 'ar') return inScript(text, 0x0600, 0x06FF);
    return !inScript(text, 0x0080, 0x10FFFF);   // en and tr: plain ASCII
  };
  for (const session of SIX) {
    for (const token of weak) {
      const r = resolveTurnLanguage({
        transcript: token, providerLanguage: 'en',
        previousSessionLanguage: session, pageLocale: session,
      });
      assert.equal(r.resolvedLanguage, session,
        `"${token}" moved a ${session} session to ${r.resolvedLanguage}`);
      if (!isNative(session, token)) {
        assert.ok(r.confidence < 0.6,
          `"${token}" is foreign to a ${session} session and must not lock it`);
      }
    }
  }
});

test('short answers in the session language stay in it', () => {
  // The other half of the same rule: being short must not be treated as
  // being foreign. These are complete answers, not fragments.
  const shorts = {
    ka: ['კი', 'არა', 'ჰო', 'დიახ', 'კარგი', 'გასაგებია'],
    ru: ['да', 'нет', 'хорошо'],
    en: ['yes', 'no', 'sure'],
  };
  for (const [code, list] of Object.entries(shorts)) {
    for (const said of list) {
      const r = resolveTurnLanguage({
        transcript: said, providerLanguage: HEARD[code],
        previousSessionLanguage: code, pageLocale: code,
      });
      assert.equal(r.resolvedLanguage, code, `"${said}" left its own ${code} session`);
    }
  }
});

test('the page locale is the prior on the very first turn', () => {
  // No previous language at all: whichever page they opened is the guess,
  // and it must not be overridden by one weak token.
  for (const code of SIX) {
    const r = resolveTurnLanguage({
      transcript: 'ok', providerLanguage: 'en',
      previousSessionLanguage: null, pageLocale: code,
    });
    assert.equal(r.resolvedLanguage, code, `a ${code} page was abandoned on "ok"`);
  }
});
