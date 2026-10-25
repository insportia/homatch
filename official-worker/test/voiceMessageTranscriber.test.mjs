// HOMI voice messages: the worker half. No network: Google's unary Recognize
// is injected, so these prove what the worker SENDS (one language code, the
// browser's container decoded by Google, the regional recognizer path) and how
// it READS the answer (text in order, billed seconds, detected language), and
// that a refused language tag is retried once with `auto` instead of losing
// the message.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const {
  transcribeVoiceMessage, speechLanguageFor, localeForSpeechTag, sniffContainer, clipProblem,
  durationSeconds, readRecognizeResponse, buildRecognizeRequest, MAX_CLIP_BYTES, LOCALE_TO_SPEECH,
} = await import('../.tstest-build/speech/VoiceMessageTranscriber.js');

const CFG = { projectId: 'proj-123', region: 'eu', languageCode: 'ka-GE', languageCodes: ['ka-GE'], model: 'chirp_3', sampleRate: 16000 };

function webm(size = 4096) {
  const b = new Uint8Array(size);
  b.set([0x1a, 0x45, 0xdf, 0xa3]);
  return b;
}
function ogg(size = 4096) {
  const b = new Uint8Array(size);
  b.set([0x4f, 0x67, 0x67, 0x53]);
  return b;
}
function mp4(size = 4096) {
  const b = new Uint8Array(size);
  b.set([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70]);
  return b;
}

test('every interface locale maps to a tag AI TALK proved chirp_3 accepts', () => {
  assert.deepEqual(LOCALE_TO_SPEECH, { ka: 'ka-GE', en: 'en-US', ru: 'ru-RU', tr: 'tr-TR', ar: 'ar-XA', he: 'iw-IL' });
  // The same tags the live language registry opened sockets with.
  const registry = readFileSync(new URL('../../src/lib/comm/languageRegistry.ts', import.meta.url), 'utf8');
  for (const [locale, tag] of Object.entries(LOCALE_TO_SPEECH)) {
    assert.match(registry, new RegExp(`code: '${locale}', sttTag: '${tag}'`), `${locale} → ${tag} must match languageRegistry.ts`);
  }
  assert.equal(speechLanguageFor('he'), 'iw-IL');
  assert.equal(speechLanguageFor('AR'), 'ar-XA');
  assert.equal(speechLanguageFor('xx'), 'ka-GE', 'unknown locale falls back to Georgian');
  assert.equal(speechLanguageFor(undefined), 'ka-GE');
});

test('a recogniser tag reads back as an interface locale', () => {
  assert.equal(localeForSpeechTag('ka-GE'), 'ka');
  assert.equal(localeForSpeechTag('iw-il'), 'he');
  assert.equal(localeForSpeechTag('ar-EG'), 'ar');
  assert.equal(localeForSpeechTag('de-DE'), null);
  assert.equal(localeForSpeechTag('auto'), null);
});

test('the container is read from the bytes, not from a content type', () => {
  assert.equal(sniffContainer(webm()), 'WEBM');
  assert.equal(sniffContainer(ogg()), 'OGG');
  assert.equal(sniffContainer(mp4()), 'MP4');
  assert.equal(sniffContainer(new Uint8Array(4096)), null);
  assert.equal(clipProblem(new Uint8Array(10)), 'EMPTY');
  assert.equal(clipProblem(webm(MAX_CLIP_BYTES + 1)), 'TOO_LARGE');
  assert.equal(clipProblem(new Uint8Array(4096)), 'UNSUPPORTED_FORMAT');
  assert.equal(clipProblem(webm()), null);
});

test('the request is v2 unary: regional recognizer, auto decoding, ONE language', () => {
  const req = buildRecognizeRequest(CFG, webm(), 'ru-RU');
  assert.equal(req.recognizer, 'projects/proj-123/locations/eu/recognizers/_');
  assert.deepEqual(req.config.autoDecodingConfig, {});
  assert.deepEqual(req.config.languageCodes, ['ru-RU'], 'chirp_3 refuses a list');
  assert.equal(req.config.model, 'chirp_3');
  assert.ok(req.content instanceof Uint8Array && req.content.length === 4096);
});

test('durations and the answer are read the way Google writes them', () => {
  assert.equal(durationSeconds({ seconds: '12', nanos: 500_000_000 }), 12.5);
  assert.equal(durationSeconds({ seconds: 3 }), 3);
  assert.equal(durationSeconds(null), null);
  assert.equal(durationSeconds({}), null, 'absent is unknown, not zero');

  const read = readRecognizeResponse({
    results: [
      { alternatives: [{ transcript: 'გამარჯობა,', confidence: 0.9 }], languageCode: 'ka-ge', resultEndOffset: { seconds: 2 } },
      { alternatives: [{ transcript: '' }] },
      { alternatives: [{ transcript: 'ბინა მინდა ვაკეში.', confidence: 0.7 }], resultEndOffset: { seconds: 5, nanos: 200_000_000 } },
    ],
    metadata: { totalBilledDuration: { seconds: 6 } },
  }, 'ka-GE');
  assert.equal(read.transcript, 'გამარჯობა, ბინა მინდა ვაკეში.');
  assert.equal(read.languageCode, 'ka-ge');
  assert.equal(read.billedSeconds, 6);
  assert.equal(read.audioSeconds, 5.2);
  assert.equal(read.confidence, 0.8);
});

test('a clip is transcribed in the person’s interface language', async () => {
  const calls = [];
  const out = await transcribeVoiceMessage(webm(), { locale: 'en' }, CFG, async (req) => {
    calls.push(req);
    return { results: [{ alternatives: [{ transcript: 'Hello there' }], languageCode: 'en-us' }], metadata: { totalBilledDuration: { seconds: 4 } } };
  });
  assert.equal(out.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].config.languageCodes, ['en-US']);
  assert.equal(out.transcript, 'Hello there');
  assert.equal(out.locale, 'en');
  assert.equal(out.billedSeconds, 4);
  assert.equal(out.attempts, 1);
  assert.equal(out.container, 'WEBM');
});

test('a refused language is retried once with auto, and both calls are counted', async () => {
  const asked = [];
  const out = await transcribeVoiceMessage(ogg(), { locale: 'he' }, CFG, async (req) => {
    asked.push(req.config.languageCodes[0]);
    if (asked.length === 1) throw Object.assign(new Error('Invalid language'), { code: 3 });
    return { results: [{ alternatives: [{ transcript: 'שלום' }], languageCode: 'iw-il' }], metadata: { totalBilledDuration: { seconds: 3 } } };
  });
  assert.deepEqual(asked, ['iw-IL', 'auto']);
  assert.equal(out.ok, true);
  assert.equal(out.autoFallback, true);
  assert.equal(out.attempts, 2);
  assert.equal(out.locale, 'he');
});

test('other provider failures are reported, never retried, never turned into text', async () => {
  let n = 0;
  const out = await transcribeVoiceMessage(webm(), { locale: 'ka' }, CFG, async () => {
    n += 1; throw Object.assign(new Error('deadline'), { code: 4 });
  });
  assert.equal(n, 1);
  assert.deepEqual(out, { ok: false, reason: 'TIMEOUT', code: 4 });

  const unavailable = await transcribeVoiceMessage(webm(), { locale: 'ka' }, CFG, async () => {
    throw Object.assign(new Error('unavailable'), { code: 14 });
  });
  assert.equal(unavailable.reason, 'PROVIDER_FAILED');
});

test('without configuration or with a bad clip, Google is never called', async () => {
  let called = false;
  const spy = async () => { called = true; return {}; };
  assert.equal((await transcribeVoiceMessage(webm(), {}, null, spy)).reason, 'NOT_CONFIGURED');
  assert.equal((await transcribeVoiceMessage(new Uint8Array(4096), {}, CFG, spy)).reason, 'UNSUPPORTED_FORMAT');
  assert.equal((await transcribeVoiceMessage(webm(MAX_CLIP_BYTES + 10), {}, CFG, spy)).reason, 'TOO_LARGE');
  assert.equal(called, false);
});

test('the route is token-only and never logs audio or transcript', () => {
  const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
  const route = src.slice(src.indexOf("app.post('/speech/transcribe'"), src.indexOf("app.get('/health/speech-config'"));
  assert.match(route, /app\.post\('\/speech\/transcribe', auth,/, 'behind the WORKER_TOKEN bearer');
  const log = route.slice(route.indexOf('console.log'), route.indexOf('}));') + 4);
  assert.doesNotMatch(log, /transcript/, 'the transcript is what a customer said');
  assert.doesNotMatch(log, /audio[,\s}]/, 'the audio is never logged');
});
