// Verify report CONTENT translation (owner P0, 2026-10-12): the shared core
// (eligibility, what a translation must keep, the prompt, the parser, the
// request limits) and the browser translator (memory + sessionStorage cache,
// debounced batching, failure and retry). The DOM layer is proven in a real
// browser by tests/mobile/verifyReportTranslation.test.mjs.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  hasGeorgian, isTranslatable, splitEdges, lostTokens, acceptTranslation, buildTranslationPrompt,
  parseTranslationOutput, chunkTexts, parseTranslateRequest, sourceHash, collectGeorgianTexts,
  MAX_TEXTS_PER_CALL, MAX_TEXT_CHARS, MAX_CALL_CHARS, TRANSLATION_LANGS,
} from '../translation/textTranslation.ts';
import { ReportTranslator, resetTranslationMemory, STORAGE_PREFIX } from '../translation/translator.ts';
import { STORED_SYNTHESIS } from './fixtures/job601Synthesis.mjs';

const JOB = '8ba97da9-0000-4000-8000-000000000601';

test('Georgian detection and eligibility', () => {
  assert.equal(hasGeorgian('თბილისი'), true);
  assert.equal(hasGeorgian('Tbilisi 2024'), false);
  assert.equal(isTranslatable('  საკადასტრო კოდი  '), true);
  assert.equal(isTranslatable('01.18.06.019.055'), false);
  assert.equal(isTranslatable('ა'.repeat(MAX_TEXT_CHARS + 1)), false);
  // A personal number never leaves the browser for a model or the cache.
  assert.equal(isTranslatable('მესაკუთრე 01234567890'), false);
  assert.deepEqual(splitEdges('  ბინა \n'), { lead: '  ', core: 'ბინა', trail: ' \n' });
});

test('a translation must keep numbers, codes, case numbers, URLs and placeholders', () => {
  const src = '2024 წლის 12 მარტს საქმე AR1234567 (01.18.06.019.055) — 1 670 აშშ დოლარი კვ.მ-ზე, {{count}} ბინა, https://napr.gov.ge/x';
  const good = 'On 12 March 2024 case AR1234567 (01.18.06.019.055) — USD 1,670 per sq m, {{count}} apartments, https://napr.gov.ge/x';
  assert.deepEqual(lostTokens(src, good), []);
  assert.equal(acceptTranslation(src, good), true);
  assert.ok(lostTokens(src, good.replace('2024', 'last year')).includes('2024'));
  assert.ok(lostTokens(src, good.replace('{{count}}', 'several')).includes('{{count}}'));
  assert.ok(lostTokens(src, good.replace('AR1234567', 'a case')).includes('AR1234567'));
  assert.ok(lostTokens(src, good.replace('01.18.06.019.055', 'the parcel')).includes('01.18.06.019.055'));
  assert.ok(lostTokens(src, good.replace(' https://napr.gov.ge/x', '')).length > 0);
  // Untranslated, empty, identical or wildly longer answers are refused.
  assert.equal(acceptTranslation('ბინა მშენებარეა', 'ბინა მშენებარეა'), false);
  assert.equal(acceptTranslation('ბინა მშენებარეა', ''), false);
  assert.equal(acceptTranslation('ბინა მშენებარეა', 'x'.repeat(500)), false);
  assert.equal(acceptTranslation('ბინა მშენებარეა', 'The apartment is under construction'), true);
});

test('the prompt carries the product terminology and the keep-exact rules for every language', () => {
  for (const lang of TRANSLATION_LANGS) {
    const { system, user } = buildTranslationPrompt(lang, ['დამთხვევა', 'მოიჯარე']);
    assert.match(system, /cadastral codes/);
    assert.match(system, /\{\{placeholders\}\}/);
    assert.match(system, /potentially interested person/);
    assert.match(system, /"დამთხვევა" =/);
    assert.match(system, /"მოიჯარე" =/);
    assert.deepEqual(JSON.parse(user), { t0: 'დამთხვევა', t1: 'მოიჯარე' });
  }
  assert.match(buildTranslationPrompt('en', ['x']).system, /"დამთხვევა" = "match"; "მოიჯარე" = "tenant"/);
});

test('the model answer is mapped back by id; unusable items are dropped', () => {
  const texts = ['ბინა 12', 'სართული 5', 'ფართი 80 კვ.მ'];
  const raw = '```json\n{"t0":"Apartment 12","t1":"სართული 5","t2":"Area 81 sq m"}\n```';
  assert.deepEqual(parseTranslationOutput(raw, texts), { 'ბინა 12': 'Apartment 12' });
  assert.deepEqual(parseTranslationOutput('not json', texts), {});
});

test('chunks respect characters and item counts, in order', () => {
  const texts = Array.from({ length: 10 }, (_, i) => `${'ა'.repeat(30)}${i}`);
  const chunks = chunkTexts(texts, 100, 4);
  assert.deepEqual(chunks.flat(), texts);
  assert.ok(chunks.every((c) => c.length <= 4 && c.reduce((a, t) => a + t.length, 0) <= 100));
});

test('the translate request is validated and capped', () => {
  assert.equal(parseTranslateRequest({ jobId: 'x', lang: 'en', texts: [] }).ok, false);
  assert.equal(parseTranslateRequest({ jobId: JOB, lang: 'ka', texts: [] }).ok, false);
  assert.equal(parseTranslateRequest({ jobId: JOB, lang: 'en', texts: Array(MAX_TEXTS_PER_CALL + 1).fill('ა') }).status, 413);
  assert.equal(parseTranslateRequest({ jobId: JOB, lang: 'en', texts: Array(20).fill(0).map((_, i) => 'ა'.repeat(3990) + i) }).status, 413);
  const ok = parseTranslateRequest({ jobId: JOB, lang: 'he', texts: ['ბინა', ' ბინა ', 'Apartment', 42, 'ბინა 01234567890'] });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.request.texts, ['ბინა']);
  assert.equal(ok.skipped, 3);
  assert.ok(MAX_CALL_CHARS >= 16000);
});

test('the cache key is the canonical text', async () => {
  const a = await sourceHash('ბინა');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.equal(await sourceHash('  ბინა '), a);
  assert.notEqual(await sourceHash('ბინები'), a);
});

test('prefetch collects the rendered prose of a real report, de-duplicated and eligible', () => {
  const texts = collectGeorgianTexts(STORED_SYNTHESIS.report, (s) => s.split(/\n{2,}/));
  assert.ok(texts.length > 20, `only ${texts.length} prose texts`);
  assert.ok(texts.every((t) => isTranslatable(t)));
  assert.equal(new Set(texts).size, texts.length);
  assert.ok(collectGeorgianTexts(STORED_SYNTHESIS.report, undefined, 5).length <= 5);
});

/* ------------------------------------------------------------------ *
 * The browser translator.
 * ------------------------------------------------------------------ */
function harness({ send, storage = null, ...o } = {}) {
  const timers = [];
  const calls = [];
  const tr = new ReportTranslator({
    lang: 'en',
    storage,
    send: async (texts) => { calls.push(texts); return send ? send(texts) : Object.fromEntries(texts.map((t) => [t, `EN:${t}`])); },
    setTimer: (fn) => { timers.push(fn); },
    now: () => o.now?.() ?? 0,
    ...o,
  });
  const tick = async () => { while (timers.length) { timers.shift()(); await new Promise((r) => setImmediate(r)); } };
  return { tr, calls, tick };
}

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), removeItem: (k) => m.delete(k), m };
}

test('unknown text: the original now, one batched request, the translation after', async () => {
  resetTranslationMemory();
  const { tr, calls, tick } = harness();
  let landed = 0;
  tr.subscribe(() => landed++);
  assert.equal(tr.tr('ბინა'), 'ბინა');
  assert.equal(tr.tr(' სართული '), ' სართული ');
  tr.request('ბინა');
  assert.equal(tr.tr('Apartment'), 'Apartment');
  assert.equal(tr.pending, 2);
  await tick();
  assert.deepEqual(calls, [['ბინა', 'სართული']]);
  assert.equal(tr.tr('ბინა'), 'EN:ბინა');
  // Edge whitespace stays where it was.
  assert.equal(tr.tr(' სართული '), ' EN:სართული ');
  assert.equal(landed, 1);
  assert.equal(tr.pending, 0);
  // Known now: no second request.
  tr.request('ბინა');
  await tick();
  assert.equal(calls.length, 1);
});

test('batches are capped by count and characters', async () => {
  resetTranslationMemory();
  const { tr, calls, tick } = harness({ maxBatchTexts: 3, maxBatchChars: 1000, concurrency: 1 });
  tr.prefetch(Array.from({ length: 7 }, (_, i) => `ტექსტი ${i}`));
  await tick();
  assert.deepEqual(calls.map((c) => c.length), [3, 3, 1]);
  assert.equal(tr.lookup('ტექსტი 6'), 'EN:ტექსტი 6');
});

test('a failed request is not retried at once, and is retried later', async () => {
  resetTranslationMemory();
  let now = 0;
  let fail = true;
  const { tr, calls, tick } = harness({ now: () => now, retryAfterMs: 1000, send: (texts) => { if (fail) throw new Error('offline'); return Object.fromEntries(texts.map((t) => [t, `EN:${t}`])); } });
  tr.request('ბინა');
  await tick();
  assert.equal(calls.length, 1);
  tr.request('ბინა');
  await tick();
  assert.equal(calls.length, 1, 'retried immediately');
  now = 2000; fail = false;
  tr.request('ბინა');
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(tr.lookup('ბინა'), 'EN:ბინა');
});

test('translations persist per language in sessionStorage and seed a new page', async () => {
  resetTranslationMemory();
  const storage = memoryStorage();
  const { tr, tick } = harness({ storage });
  tr.request('ბინა');
  await tick();
  assert.deepEqual(JSON.parse(storage.m.get(`${STORAGE_PREFIX}en`)), { 'ბინა': 'EN:ბინა' });
  resetTranslationMemory();
  const next = harness({ storage });
  assert.equal(next.tr.tr('ბინა'), 'EN:ბინა');
  assert.equal(next.calls.length, 0);
  // Broken storage is an empty cache, never an error.
  resetTranslationMemory();
  const broken = { getItem: () => '{not json', setItem: () => { throw new Error('quota'); }, removeItem() {} };
  const b = harness({ storage: broken });
  b.tr.request('ბინა');
  await b.tick();
  assert.equal(b.tr.lookup('ბინა'), 'EN:ბინა');
});

/* ------------------------------------------------------------------ *
 * The wiring, read from source.
 * ------------------------------------------------------------------ */
const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('VerifyReport renders inside ReportTranslation, and the pages mark their translation root', () => {
  const report = read('src/components/verify/VerifyReport.tsx');
  assert.match(report, /<ReportTranslation jobId=\{jobId\} prefetch=\{prefetch\}>\s*<VerifyReportBody/);
  assert.match(read('src/pages/VerifyPage.tsx'), /className="verify-report space-y-4" data-report-translation-root=""/);
  assert.match(read('src/components/verify/VerifyResultView.tsx'), /data-report-translation-root=""/);
  // The gallery lightbox renders through a portal and is marked as report content.
  assert.match(read('src/components/verify/VisualExplorer.tsx'), /data-report-portal=""/);
  const comp = read('src/components/verify/ReportTranslation.tsx');
  assert.match(comp, /attachDomTranslation\(root, translator\)/);
  assert.match(comp, /attachPortalTranslation\(/);
  assert.match(comp, /action: 'translate'/);
  assert.match(comp, /t\('verify_tr_translating'\)/);
});
