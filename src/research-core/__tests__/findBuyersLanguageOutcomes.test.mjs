// FIND BUYERS — per-language truth (2026-10-16): why Arabic / Turkish / Hebrew results are
// absent is a stated outcome, never a silence. Pure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { languageOutcomes } from '../findBuyers/languageOutcomes.ts';

test('each language says what actually happened to it', () => {
  const queue = [
    { language: 'ka', status: 'DONE', result_count: 20 }, { language: 'ka', status: 'DONE', result_count: 8 },
    { language: 'ru', status: 'DONE', result_count: 20 },
    { language: 'en', status: 'DONE', result_count: 0 },
    { language: 'ar', status: 'CANCELLED', cancel_reason: 'PHASE1_BUDGET' },
    { language: 'he', status: 'FAILED', result_count: 0 },
  ];
  const leads = [{ language: 'ka' }, { language: 'ka' }];
  const by = Object.fromEntries(languageOutcomes(queue, leads).map((r) => [r.language, r]));
  assert.equal(by.ka.outcome, 'RESULTS'); assert.equal(by.ka.people, 2); assert.equal(by.ka.items, 28);
  assert.equal(by.ru.outcome, 'RESULTS_FILTERED', 'content came back; the gates kept no one');
  assert.equal(by.en.outcome, 'SEARCHED_NO_RESULTS');
  assert.equal(by.ar.outcome, 'NOT_RUN'); assert.equal(by.ar.notRunReason, 'PHASE1_BUDGET');
  assert.equal(by.he.outcome, 'SOURCE_UNAVAILABLE');
  assert.equal(by.tr.outcome, 'NOT_PLANNED');
  assert.deepEqual(Object.keys(by).sort(), ['ar', 'en', 'he', 'ka', 'ru', 'tr']);
});
