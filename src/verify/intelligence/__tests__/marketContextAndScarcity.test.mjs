import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildMarketIntelligence } from '../marketIntelligence.ts';
import { stripFalseScarcity } from '../report.ts';

/*
 * MARKET CONTEXT IS NOT SUBJECT VALUATION, AND AN UNRUN SOURCE IS NOT AN
 * ABSENCE OF EVIDENCE.
 *
 * Both of these reached customers. One real report carried 43 comparables,
 * 32 of them active, and a median around $1,700/m^2 — and told the reader
 * there was not enough data to assess. Another said no shareholder
 * information was found on a run where the registry check never executed.
 *
 * The prompt asks the model to avoid both. These tests cover what happens
 * when it does not, because a rule that lives only in a prompt is a
 * suggestion.
 */

const comps = (n, price) =>
  Array.from({ length: n }, (_, i) => ({
    pricePerSqm: price + i * 10,
    currency: 'USD',
    area: 60,
    reasons: ['same district'],
    state: 'ACTIVE',
  }));

test('a real comparable set is market context even when the subject has no price', () => {
  const m = buildMarketIntelligence({ area: 60 }, comps(32, 1700));
  assert.ok(m, 'a market with 32 comparables must produce intelligence');
  assert.equal(m.contextAvailable, true, 'MARKET CONTEXT = AVAILABLE');
  assert.equal(m.subjectValuation, 'NO_SUBJECT_PRICE', 'SUBJECT VALUATION = NOT CALCULABLE');
  assert.equal(m.positioning, undefined, 'no position may be invented without a subject price');
  assert.ok(m.median > 0, 'the median is real and usable');
});

test('a subject with its own price is positioned, and both answers are AVAILABLE', () => {
  const m = buildMarketIntelligence({ area: 60, pricePerSqm: 2200 }, comps(32, 1700));
  assert.equal(m.contextAvailable, true);
  assert.equal(m.subjectValuation, 'AVAILABLE');
  assert.ok(typeof m.deltaFromMedianPct === 'number');
  assert.ok(m.positioning);
});

test('no comparables is the only case that is genuinely insufficient', () => {
  const m = buildMarketIntelligence({ area: 60 }, []);
  if (m) {
    assert.equal(m.contextAvailable, false);
    assert.equal(m.subjectValuation, 'NO_COMPARABLE_BASIS');
  }
});

/* ------------------------------------------------------------------ *
 * The enforcement.                                                    *
 * ------------------------------------------------------------------ */

const reportWith = (statement, finding) => ({
  summary: { label: 'BALANCED', statement, highlights: [] },
  keyFindings: [{ finding, whyItMatters: '', sentiment: 'BALANCED', cites: [] }],
  sections: [],
  attentionPoints: [],
  nextSteps: [],
  finalView: '',
  contractUpload: { recommend: true, text: '' },
  mode: 'MODEL',
  rejectedBecause: [],
  evidenceUsed: [],
});

const marketBundle = { market: { contextAvailable: true }, company: null };

test('a claim of insufficient market data is dropped when comparables demonstrably exist', () => {
  for (const phrase of [
    'შესაფასებლად საკმარისი მონაცემი არ არის',
    'There is insufficient market data for this property.',
    'Not enough market data to assess.',
    'Недостаточно данных для оценки.',
  ]) {
    const out = stripFalseScarcity(reportWith(phrase, phrase), marketBundle);
    assert.equal(out.summary.statement, '', `summary must drop: ${phrase}`);
    assert.equal(out.keyFindings.length, 0, `key finding must drop: ${phrase}`);
    assert.ok(out.rejectedBecause.length > 0, 'the removal is recorded, not hidden');
  }
});

test('genuine scarcity survives untouched when nothing contradicts it', () => {
  const phrase = 'შესაფასებლად საკმარისი მონაცემი არ არის';
  const out = stripFalseScarcity(reportWith(phrase, phrase), {
    market: { contextAvailable: false },
    company: null,
  });
  assert.equal(out.summary.statement, phrase, 'a true statement must never be scrubbed');
  assert.equal(out.keyFindings.length, 1);
});

test('an unrun registry check never renders as "no shareholders were found"', () => {
  const bundle = { market: null, company: { status: 'SOURCE_UNAVAILABLE' } };
  for (const phrase of [
    'No shareholder information was found for the developer.',
    'წილის მფლობელები ვერ დადგინდა.',
  ]) {
    const out = stripFalseScarcity(reportWith(phrase, phrase), bundle);
    assert.equal(out.keyFindings.length, 0, `must drop: ${phrase}`);
  }
});

test('the same sentence is allowed when the registry actually ran and found nothing', () => {
  const bundle = { market: null, company: { status: 'REGISTRY_CONFIRMED' } };
  const phrase = 'No shareholder information was found for the developer.';
  const out = stripFalseScarcity(reportWith(phrase, phrase), bundle);
  assert.equal(out.keyFindings.length, 1, 'a real negative finding must survive');
});

test('material negative evidence is never touched by the scarcity filter', () => {
  // The exact class of statement the suppression rule must not reach.
  const phrase = 'კომპანიაზე რეგისტრირებულია გირავნობა R23757008, სს საქართველოს ბანკი.';
  const out = stripFalseScarcity(reportWith(phrase, phrase), {
    market: { contextAvailable: true },
    company: { status: 'REGISTRY_CONFIRMED' },
  });
  assert.equal(out.keyFindings.length, 1, 'a registered pledge is a finding, not scarcity');
  assert.equal(out.summary.statement, phrase);
});

test('no bundle means no enforcement, and the report passes through unchanged', () => {
  const r = reportWith('anything at all', 'anything at all');
  assert.deepEqual(stripFalseScarcity(r, null), r);
});
