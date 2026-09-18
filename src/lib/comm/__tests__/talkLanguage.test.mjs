// The language resolver, tested against what production actually did.
//
// Every case in the first block is a real transcript captured from the
// deployed path on 2026-09-15, when Chirp's unrestricted `auto` detection was
// fed short Georgian and answered in Korean, Luxembourgish, Hausa and
// Lithuanian. The owner saw the result on a phone: one session containing
// Georgian, Hangul and Devanagari, and turns with no audio at all.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TALK_LANGUAGES, normaliseLanguage, scriptEvidence, resolveTurnLanguage,
  textMatchesLanguage, SWITCH_MIN_CONFIDENCE,
} from '../talkLanguage.ts';

// ── Nothing outside the registry may exist ──────────────────────────────────────

test('an unsupported provider label does not resolve to anything', () => {
  // Persian, Azerbaijani, Armenian and Kazakh are what the voice cannot speak;
  // the rest are labels the recogniser has actually hallucinated.
  for (const tag of ['fa', 'az', 'hy', 'kk', 'lb', 'ha', 'lt', 'pa', 'am', 'sw']) {
    assert.equal(normaliseLanguage(tag), null, `${tag} must not be a language AI TALK speaks`);
  }
});

test('the six resolve, in every spelling a provider has used', () => {
  assert.equal(normaliseLanguage('ka-GE'), 'ka');
  assert.equal(normaliseLanguage('ka'), 'ka');
  assert.equal(normaliseLanguage('en-US'), 'en');
  assert.equal(normaliseLanguage('en-GB'), 'en');
  assert.equal(normaliseLanguage('ru-RU'), 'ru');
  assert.equal(normaliseLanguage('tr-TR'), 'tr');
  assert.equal(normaliseLanguage('ar-XA'), 'ar');
  assert.equal(normaliseLanguage('ar-SA'), 'ar');
  // ISO renamed this in 1989 and Google still emits the old code.
  assert.equal(normaliseLanguage('iw'), 'he');
  assert.equal(normaliseLanguage('iw-IL'), 'he');
  assert.equal(normaliseLanguage('he-IL'), 'he');
});

test('the resolver can only ever return one of the six', () => {
  const nonsense = [
    { transcript: '아, 고맙습니다.', providerLanguage: 'ko' },
    { transcript: 'नमस्ते', providerLanguage: 'hi' },
    { transcript: '你好', providerLanguage: 'zh' },
    { transcript: '', providerLanguage: 'ko' },
    { transcript: '???', providerLanguage: null },
  ];
  for (const input of nonsense) {
    const r = resolveTurnLanguage({ ...input, previousSessionLanguage: 'ka', pageLocale: 'ka' });
    assert.ok(TALK_LANGUAGES.includes(r.resolvedLanguage),
      `resolved ${r.resolvedLanguage} for ${JSON.stringify(input)}`);
  }
});

// ── The exact live failures ────────────────────────────────────────────────

test('the captured production corruptions all stay Georgian', () => {
  /*
   * Real rows. A Georgian UI, a Georgian speaker, and a recogniser answering
   * in somebody else's alphabet. None of these may move the session.
   */
  const captured = [
    { said: 'დიახ.', transcript: 'dir', providerLanguage: 'lb' },
    { said: 'არა, გმადლობთ.', transcript: '아, 고맙습니다.', providerLanguage: 'ko' },
    { said: 'კარგი.', transcript: 'Karki', providerLanguage: 'ha' },
    { said: 'ვაკეში.', transcript: 'Wackisch', providerLanguage: 'en' },
    { said: 'კი, მაინტერესებს.', transcript: 'Ki, ma interesas.', providerLanguage: 'lt' },
  ];
  for (const row of captured) {
    const r = resolveTurnLanguage({
      transcript: row.transcript,
      providerLanguage: row.providerLanguage,
      previousSessionLanguage: 'ka',
      pageLocale: 'ka',
    });
    assert.equal(r.resolvedLanguage, 'ka',
      `"${row.said}" heard as "${row.transcript}" (${row.providerLanguage}) became ${r.resolvedLanguage}`);
    assert.equal(r.switched, false);
  }
});

test('Armenian text cannot enter session state even when the provider insists', () => {
  // Korean used to play this part; it is supported now. Armenian is what the
  // voice still cannot speak, so it is what must still bounce.
  const r = resolveTurnLanguage({
    transcript: 'Այո, շնորհակալություն, խնդրում եմ շարունակեք։',
    providerLanguage: 'hy',
    previousSessionLanguage: 'ka',
    pageLocale: 'ka',
  });
  assert.equal(r.resolvedLanguage, 'ka');
  assert.equal(r.normalizedProviderLanguage, null, 'an unsupported label must normalise to nothing');
});

test('with no session yet, an unsupported label still cannot win', () => {
  // The first turn of a call is the one with the least to go on, and it is
  // where a bad label would do the most damage.
  const r = resolveTurnLanguage({
    transcript: 'Այո, շնորհակալություն։',
    providerLanguage: 'hy',
    previousSessionLanguage: null,
    pageLocale: 'ka',
  });
  assert.equal(r.resolvedLanguage, 'ka');
  assert.equal(r.resolutionReason, 'LOCALE');
});

// ── Script is decisive ─────────────────────────────────────────────────────

test('script settles the four languages that have their own alphabet', () => {
  const cases = [
    ['გამარჯობა, ბინას ვეძებ ვაკეში', 'ka'],
    ['Здравствуйте, я ищу квартиру', 'ru'],
    ['مرحبا، أبحث عن شقة في تبليسي', 'ar'],
    ['שלום, אני מחפש דירה בתל אביב', 'he'],
  ];
  for (const [text, want] of cases) {
    // Provider deliberately wrong, to prove the alphabet outranks it.
    const r = resolveTurnLanguage({
      transcript: text, providerLanguage: 'en',
      previousSessionLanguage: 'en', pageLocale: 'en',
    });
    assert.equal(r.resolvedLanguage, want, `${text} resolved ${r.resolvedLanguage}`);
    assert.equal(r.resolutionReason, 'SCRIPT');
    assert.ok(r.confidence >= SWITCH_MIN_CONFIDENCE, 'script evidence must be strong enough to switch');
  }
});

test('a provider label that contradicts the script loses', () => {
  // Measured in production: correct English, labelled ka-GE.
  const r = resolveTurnLanguage({
    transcript: 'Hello, I am looking for a two bedroom flat in Vake',
    providerLanguage: 'ka-GE',
    previousSessionLanguage: 'en',
    pageLocale: 'en',
  });
  assert.equal(r.resolvedLanguage, 'en');
});

// ── English and Turkish, which the alphabet cannot separate ────────────────

test('Latin script defers to the provider, since nothing else can tell en from tr', () => {
  const tr = resolveTurnLanguage({
    transcript: 'Merhaba, Vake semtinde iki odali bir daire ariyorum',
    providerLanguage: 'tr', previousSessionLanguage: 'en', pageLocale: 'en',
  });
  assert.equal(tr.resolvedLanguage, 'tr');
  assert.equal(tr.resolutionReason, 'PROVIDER_LATIN');

  const en = resolveTurnLanguage({
    transcript: 'Hello, I am looking for an apartment in Vake please',
    providerLanguage: 'en', previousSessionLanguage: 'tr', pageLocale: 'tr',
  });
  assert.equal(en.resolvedLanguage, 'en');
});

test('Latin text in a Georgian session is held, not obeyed', () => {
  /*
   * This is the corruption in its most dangerous form: the recogniser
   * mis-transcribes Georgian into Latin letters AND labels it something
   * unsupported. Both signals are wrong and the session must not move.
   */
  const r = resolveTurnLanguage({
    transcript: 'Ki, ma interesas.', providerLanguage: 'lt',
    previousSessionLanguage: 'ka', pageLocale: 'ka',
  });
  assert.equal(r.resolvedLanguage, 'ka');
  assert.equal(r.resolutionReason, 'STICKY_HELD');
});

// ── Stickiness, and genuine switches ───────────────────────────────────────

test('a settled session is not moved by a short or weak turn', () => {
  for (const transcript of ['ok', 'da', 'hmm', 'yes']) {
    const r = resolveTurnLanguage({
      transcript, providerLanguage: 'en',
      previousSessionLanguage: 'ka', pageLocale: 'ka',
    });
    assert.equal(r.resolvedLanguage, 'ka', `"${transcript}" moved the session`);
  }
});

test('a caller who genuinely switches language is followed', () => {
  const r = resolveTurnLanguage({
    transcript: 'Извините, давайте продолжим по-русски, я ищу квартиру',
    providerLanguage: 'ru',
    previousSessionLanguage: 'ka', pageLocale: 'ka',
  });
  assert.equal(r.resolvedLanguage, 'ru');
  assert.equal(r.switched, true);
  assert.equal(r.resolutionReason, 'SCRIPT');
});

test('switching to English from Georgian needs the provider to say so', () => {
  const r = resolveTurnLanguage({
    transcript: 'Actually can we continue in English please, I am looking for a flat',
    providerLanguage: 'en',
    previousSessionLanguage: 'ka', pageLocale: 'ka',
  });
  assert.equal(r.resolvedLanguage, 'en');
  assert.equal(r.switched, true);
});

test('every resolution carries the trace needed to explain it afterwards', () => {
  const r = resolveTurnLanguage({
    transcript: 'Karki', providerLanguage: 'ha',
    previousSessionLanguage: 'ka', pageLocale: 'ka',
  });
  assert.equal(r.providerLanguage, 'ha', 'the raw label is kept for the trace');
  assert.equal(r.normalizedProviderLanguage, null);
  assert.equal(r.transcriptScript, 'latin');
  assert.equal(r.previousSessionLanguage, 'ka');
  assert.equal(r.pageLocale, 'ka');
  assert.equal(r.resolvedLanguage, 'ka');
  assert.ok(r.resolutionReason);
  assert.ok(typeof r.confidence === 'number');
});

// ── What the model is allowed to have written ──────────────────────────────

test('a reply in the wrong script is caught before anybody hears it', () => {
  assert.equal(textMatchesLanguage('გამარჯობა, რით შემიძლია დაგეხმაროთ?', 'ka'), true);
  assert.equal(textMatchesLanguage('Hello, how can I help you today?', 'ka'), false);
  assert.equal(textMatchesLanguage('아, 고맙습니다. 잘 부탁드립니다.', 'ka'), false);
  assert.equal(textMatchesLanguage('नमस्ते, मैं आपकी मदद कर सकता हूँ', 'ka'), false);

  assert.equal(textMatchesLanguage('Здравствуйте, чем могу помочь?', 'ru'), true);
  assert.equal(textMatchesLanguage('გამარჯობა', 'ru'), false);

  assert.equal(textMatchesLanguage('Hello, how can I help?', 'en'), true);
  // en and tr share an alphabet, so this check cannot separate them and does
  // not pretend to.
  assert.equal(textMatchesLanguage('Merhaba, nasil yardimci olabilirim?', 'en'), true);
});

test('a very short reply is never called a language violation', () => {
  // "Yes." in a Georgian conversation is not corruption.
  assert.equal(textMatchesLanguage('OK', 'ka'), true);
  assert.equal(textMatchesLanguage('დიახ', 'en'), true);
});

test('script evidence counts letters, not punctuation or digits', () => {
  const e = scriptEvidence('150,000 — ₾ !!!  ვაკე');
  assert.equal(e.script, 'georgian');
  assert.ok(e.ratio > 0.9, 'digits and punctuation must not dilute the script');
});
