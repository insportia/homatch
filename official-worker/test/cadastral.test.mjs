// cadastral.test.mjs — workflows/tas/cadastral.ts, ported unchanged from
// the pre-refactor lib/cadastral.js's test suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCadastralCode, cadastralPrefixes, recommendedParentCode, candidateSequence } from '../.tstest-build/workflows/tas/cadastral.js';

test('isCadastralCode: accepts real dot-segmented numeric codes', () => {
  assert.ok(isCadastralCode('01.18.06.019.055.03.01.603'));
  assert.ok(isCadastralCode('01.18'));
});
test('isCadastralCode: rejects non-cadastral text', () => {
  assert.ok(!isCadastralCode('შპს Example'));
  assert.ok(!isCadastralCode(''));
  assert.ok(!isCadastralCode(null));
  assert.ok(!isCadastralCode('01.18.abc'));
});

test('cadastralPrefixes: progressively shorter, longest first, down to minSegments', () => {
  const prefixes = cadastralPrefixes('01.18.06.019.055', { minSegments: 3 });
  assert.deepEqual(prefixes, ['01.18.06.019.055', '01.18.06.019', '01.18.06']);
});
test('cadastralPrefixes: empty for non-cadastral input', () => {
  assert.deepEqual(cadastralPrefixes('not a code'), []);
});

test('recommendedParentCode: the mandate\'s exact regression example', () => {
  assert.equal(recommendedParentCode('01.18.06.019.055.03.01.603'), '01.18.06.019.055');
});
test('recommendedParentCode: null when the code is already at/below 5 segments', () => {
  assert.equal(recommendedParentCode('01.18.06.019.055'), null);
  assert.equal(recommendedParentCode('01.18'), null);
});

test('candidateSequence: tries the FULL/EXACT original code FIRST (2026-09-06 mandate: the base/parent parcel is a fallback, tried only after the full code comes back a confirmed empty), never drops the parent candidate, deduplicated', () => {
  const seq = candidateSequence('01.18.06.019.055.03.01.603');
  assert.equal(seq[0], '01.18.06.019.055.03.01.603');
  assert.ok(seq.includes('01.18.06.019.055'), 'base/parent parcel must still appear in the sequence as a fallback, never dropped');
  assert.equal(new Set(seq).size, seq.length);
});
test('candidateSequence: a non-cadastral query is returned as its own single-element sequence', () => {
  assert.deepEqual(candidateSequence('free text query'), ['free text query']);
});
