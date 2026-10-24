// The guided journey never destroys what the plan already says.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrivalFor, intentsFor, reasonFromIntents, whenFromArrival, housingFromPlan } from '../journeyAnswers.ts';

const NOW = Date.parse('2026-10-24T12:00:00Z');
const inDays = (d) => new Date(NOW + d * 86_400_000).toISOString().slice(0, 10);

test('an exact arrival date survives re-editing when the timing answer still fits it', () => {
  const exact = inDays(47);
  assert.equal(whenFromArrival(exact, NOW), 'QUARTER');
  assert.equal(arrivalFor('QUARTER', exact, NOW), exact, 'unchanged answer keeps the typed date');
  assert.equal(arrivalFor('MONTH', exact, NOW), inDays(21), 'a changed answer moves it');
});

test('"I am already here" keeps a past arrival date instead of resetting it to today', () => {
  const past = inDays(-120);
  assert.equal(arrivalFor('HERE', past, NOW), past);
  assert.equal(arrivalFor('HERE', null, NOW), new Date(NOW).toISOString().slice(0, 10));
});

test('the journey re-opens with the saved answers', () => {
  assert.equal(reasonFromIntents(['MOVE', 'BUSINESS']), 'WORK');
  assert.equal(reasonFromIntents(['MOVE', 'STUDY']), 'STUDY');
  assert.equal(reasonFromIntents(['INVEST', 'BUY']), 'INVEST');
  assert.equal(reasonFromIntents([]), null);
  assert.equal(housingFromPlan('BUY'), 'BUY');
  assert.equal(housingFromPlan('UNDECIDED'), null);
});

test('an unchanged reason keeps refined intents; a changed one replaces them', () => {
  assert.deepEqual(intentsFor('WORK', ['MOVE', 'BUSINESS', 'BUY']), ['MOVE', 'BUSINESS', 'BUY']);
  assert.deepEqual(intentsFor('STUDY', ['MOVE', 'BUSINESS']), ['MOVE', 'STUDY']);
});
