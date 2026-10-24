// liveReportBugs.test.mjs — what live test 307a60b1 (2026-10-24, a 19.7 m² parking space) exposed in the report text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sentences } from '../dedupe.ts';
import { headlineFromDetail } from '../report.ts';

test('a number is never split as a sentence: "19.7 მ²" stays "19.7 მ²"', () => {
  assert.deepEqual(sentences('ეს არის 19.7 მ² ავტოსადგომი N15. კოდი 01.15.01.004.070 არის! ფასი 2.5%-ით მეტია?'), [
    'ეს არის 19.7 მ² ავტოსადგომი N15.',
    'კოდი 01.15.01.004.070 არის!',
    'ფასი 2.5%-ით მეტია?',
  ]);
  assert.deepEqual(sentences('პირველი.\nმეორე'), ['პირველი.', 'მეორე']);
  assert.equal(sentences('ბოლო.').length, 1);
});

test('a highlight whose headline was cleaned away gets the first clause of its detail', () => {
  assert.equal(headlineFromDetail('ამონაწერში ამ ავტოსადგომზე საგადასახადო გირავნობა, ყადაღა და აკრძალვა რეგისტრირებული არ არის.'), 'ამონაწერში ამ ავტოსადგომზე საგადასახადო გირავნობა');
  assert.equal(headlineFromDetail('მოკლე ფაქტი.'), 'მოკლე ფაქტი');
  assert.equal(headlineFromDetail('ერთი ორი სამი ოთხი ხუთი ექვსი შვიდი რვა'), 'ერთი ორი სამი ოთხი ხუთი ექვსი');
});
