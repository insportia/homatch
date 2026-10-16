import test from 'node:test';
import assert from 'node:assert/strict';
import { parseLanguageOutcomes, searchedIn } from '../languageOutcomes.ts';

test('per-language outcomes: optional, validated, never imply a language was searched when it was not', () => {
  assert.deepEqual(parseLanguageOutcomes(null), []);
  assert.deepEqual(parseLanguageOutcomes({}), []);
  const rows = parseLanguageOutcomes({ languageOutcomes: [
    { language: 'ru', outcome: 'RESULTS', people: 3 }, { language: 'ka', outcome: 'SEARCHED_NO_RESULTS', people: 0 },
    { language: 'he', outcome: 'NOT_RUN' }, { language: 'ar', outcome: 'WHATEVER' }, { language: 'xx', outcome: 'RESULTS' },
    { language: 'ru', outcome: 'NOT_RUN' },
  ] });
  assert.deepEqual(rows.map((r) => [r.language, r.outcome, r.people]), [['ka', 'SEARCHED_NO_RESULTS', 0], ['ru', 'RESULTS', 3], ['he', 'NOT_RUN', 0]]);
  assert.equal(searchedIn('NOT_RUN'), false);
  assert.equal(searchedIn('NOT_PLANNED'), false);
  assert.equal(searchedIn('SOURCE_UNAVAILABLE'), false);
  assert.equal(searchedIn('RESULTS'), true);
});
