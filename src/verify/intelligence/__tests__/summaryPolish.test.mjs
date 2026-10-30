import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { applySummaryPolish, summaryNeedsPolish, summaryPolishPrompt } from '../summaryPolish.ts';

/* Production job f2f38881 (2026-10-29): the date forms the owner saw. */
const SUMMARY = {
  label: 'BALANCED',
  statement: 'მოსაშვილის ქუჩა N 24-ში მდებარე 1,078 მ² სასოფლო-სამეურნეო მიწის ნაკვეთი ზუგდიდის ფარგლებშია რეგისტრირებული.',
  highlights: [
    { dimension: 'LEGAL_CONTEXT', sentiment: 'POSITIVE', cites: ['e7'], headline: 'რეგისტრირებული შეზღუდვები არ ჩანს',
      detail: '22 ივნისი, 2017-ის ამონაწერში საგადასახადო გირავნობა, ყადაღა და აკრძალვა რეგისტრირებული არ არის.' },
    { dimension: 'DEVELOPER', sentiment: 'POSITIVE', cites: ['e9'], headline: 'კომპანია აქტიური გადამხდელია',
      detail: 'შპს „ჯითიჯი დეველოპმენტი“ აქტიური, დღგ-ის გადამხდელი კომპანიაა.' },
  ],
};
const EVIDENCE = [
  { id: 'e7', claim: 'ამონაწერში შეზღუდვა არ ფიქსირდება', date: '2017-06-22' },
  { id: 'e9', claim: 'შპს „ჯითიჯი დეველოპმენტი“ — აქტიური, დღგ-ის გადამხდელი; ს/ნ 405123456' },
  { id: 'e50', claim: 'not cited by any highlight 999' },
];
const answer = (o) => JSON.stringify(o);

test('a corrected date form is taken; label, dimensions, sentiments and citations stay', () => {
  const fixed = '2017 წლის 22 ივნისის ამონაწერში საგადასახადო გირავნობა, ყადაღა და აკრძალვა რეგისტრირებული არ არის.';
  const r = applySummaryPolish(SUMMARY, answer({ statement: SUMMARY.statement, highlights: [
    { headline: SUMMARY.highlights[0].headline, detail: fixed },
    { headline: SUMMARY.highlights[1].headline, detail: SUMMARY.highlights[1].detail },
  ] }), EVIDENCE);
  assert.equal(r.changed, 1);
  assert.deepEqual(r.rejected, []);
  assert.equal(r.summary.highlights[0].detail, fixed);
  assert.equal(r.summary.label, 'BALANCED');
  assert.deepEqual(r.summary.highlights.map((h) => [h.dimension, h.sentiment, h.cites]), SUMMARY.highlights.map((h) => [h.dimension, h.sentiment, h.cites]));
});

test('a number, a Latin name or a quoted name from nowhere keeps the original text', () => {
  const r = applySummaryPolish(SUMMARY, answer({
    statement: 'მოსაშვილის ქუჩა N 24-ში მდებარე 2,500 მ² სასოფლო-სამეურნეო მიწის ნაკვეთი ზუგდიდის ფარგლებშია რეგისტრირებული.',
    highlights: [
      { headline: 'შეზღუდვები არ ჩანს Bank', detail: SUMMARY.highlights[0].detail },
      { headline: SUMMARY.highlights[1].headline, detail: 'შპს „სხვა კომპანია“ აქტიური, დღგ-ის გადამხდელი კომპანიაა.' },
    ],
  }), EVIDENCE);
  assert.equal(r.summary.statement, SUMMARY.statement);
  assert.equal(r.summary.highlights[0].headline, SUMMARY.highlights[0].headline);
  assert.equal(r.summary.highlights[1].detail, SUMMARY.highlights[1].detail);
  assert.deepEqual(r.rejected, ['statement: number 2', 'highlights.0.headline: name bank', 'highlights.1.detail: quoted სხვა კომპანია']);
});

test('a number the cited evidence holds may come in; one only uncited evidence holds may not', () => {
  const withId = 'შპს „ჯითიჯი დეველოპმენტი“ (ს/ნ 405123456) აქტიური, დღგ-ის გადამხდელი კომპანიაა.';
  const r = applySummaryPolish(SUMMARY, answer({ statement: SUMMARY.statement, highlights: [
    { headline: SUMMARY.highlights[0].headline, detail: SUMMARY.highlights[0].detail.replace('ამონაწერში', 'ამონაწერში (999)') },
    { headline: SUMMARY.highlights[1].headline, detail: withId },
  ] }), EVIDENCE);
  assert.equal(r.summary.highlights[1].detail, withId);
  assert.equal(r.summary.highlights[0].detail, SUMMARY.highlights[0].detail);
  assert.deepEqual(r.rejected, ['highlights.0.detail: number 999']);
});

test('an unusable answer changes nothing', () => {
  for (const raw of [null, 'not json', answer({ statement: 'x', highlights: [] }), answer({ statement: 'გამარჯობა', highlights: [{}, {}] })]) {
    const r = applySummaryPolish(SUMMARY, raw, EVIDENCE);
    assert.deepEqual(r.summary, SUMMARY);
    assert.equal(r.changed, 0);
  }
  // Fenced JSON is still read.
  const fenced = applySummaryPolish(SUMMARY, '```json\n' + answer({ statement: SUMMARY.statement, highlights: SUMMARY.highlights.map(({ headline, detail }) => ({ headline, detail })) }) + '\n```', EVIDENCE);
  assert.deepEqual(fenced.rejected, []);
});

test('the prompt carries only the cited evidence, and only Georgian prose is sent', () => {
  const { system, user } = summaryPolishPrompt(SUMMARY, EVIDENCE);
  assert.match(system, /2017 წლის 22 ივნისის ამონაწერში/);
  const sent = JSON.parse(user);
  assert.deepEqual(sent.highlights.map((h) => h.evidence.map((e) => e.id)), [['e7'], ['e9']]);
  assert.ok(!user.includes('e50'));
  assert.equal(summaryNeedsPolish(SUMMARY), true);
  assert.equal(summaryNeedsPolish({ label: 'BALANCED', statement: 'English only.', highlights: [] }), false);
  assert.equal(summaryNeedsPolish({ label: 'BALANCED', statement: '', highlights: [] }), false);
});

test('verify-synthesis runs the rewrite after the report is final and records its cost', () => {
  const src = fs.readFileSync(new URL('../../../../supabase/functions/verify-synthesis/index.ts', import.meta.url), 'utf8');
  const polish = src.indexOf('applySummaryPolish(final.summary');
  assert.ok(polish > src.indexOf("recordCall('escalation'"), 'after the escalation');
  assert.ok(polish < src.indexOf('const built = {'), 'before the report is assembled');
  assert.match(src, /recordCall\('polish', STRONG_MODEL/);
  assert.match(src, /recordReportCost\(writer, jobId, polishUsage/);
});
