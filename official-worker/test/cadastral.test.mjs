// cadastral.test.mjs — workflows/tas/cadastral.ts, ported unchanged from
// the pre-refactor lib/cadastral.js's test suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isCadastralCode, cadastralPrefixes, recommendedParentCode, candidateSequence, hasMeaningfulTasResults } from '../.tstest-build/workflows/tas/cadastral.js';

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

// SUPERSEDES the 2026-09-06 "full code first" design. 2026-09-07 Verify
// mandate, source-routing rule "TAS=parent/base": TAS's own document/permit
// history is filed at the parcel level, and entering the full apartment/
// unit-level code is a real, observed false-empty-result cause — the
// mandate's own fixture is explicit: full code
// 01.18.06.019.055.03.01.603, required TAS query 01.18.06.019.055.
test('candidateSequence: tries the BASE/PARENT parcel FIRST (2026-09-07 mandate: "TAS=parent/base", never the full apartment/unit-level code), with a broader fallback chain below it, deduplicated', () => {
  const seq = candidateSequence('01.18.06.019.055.03.01.603');
  assert.equal(seq[0], '01.18.06.019.055', "the mandate's own exact fixture: TAS query must be 01.18.06.019.055");
  assert.equal(seq.includes('01.18.06.019.055.03.01.603'), false, 'the full apartment/unit-level code must never be a TAS search candidate');
  assert.equal(new Set(seq).size, seq.length);
});
test('candidateSequence: when the query already IS the base parcel (5 or fewer segments), it is tried exactly as given, not truncated before the first attempt', () => {
  const seq = candidateSequence('01.18.06.019.055');
  assert.equal(seq[0], '01.18.06.019.055');
});
test('candidateSequence: a non-cadastral query is returned as its own single-element sequence', () => {
  assert.deepEqual(candidateSequence('free text query'), ['free text query']);
});

// hasMeaningfulTasResults: real production job 08379309-bb2e-4ac6-9d97-
// 727edb3af2b8 regression — TasPage.searchCadastral() returned
// resultsDiscovered:0 with noResultConfirmed:false, and the OLD fallback
// trigger (`searchRes.noResultConfirmed && candidates.length > 1`) never
// fired because it checked only noResultConfirmed. This is the single
// consistent definition now used for the fallback trigger, the fallback
// loop's break condition, and the final exhaustion decision.
test('hasMeaningfulTasResults: false when resultsDiscovered is 0, even if noResultConfirmed is false (the exact production trace)', () => {
  assert.equal(hasMeaningfulTasResults({ resultsDiscovered: 0, noResultConfirmed: false }), false);
});
test('hasMeaningfulTasResults: false when noResultConfirmed is true regardless of a stray discovered count', () => {
  assert.equal(hasMeaningfulTasResults({ resultsDiscovered: 5, noResultConfirmed: true }), false);
});
test('hasMeaningfulTasResults: false when resultsDiscovered is null/unknown', () => {
  assert.equal(hasMeaningfulTasResults({ resultsDiscovered: null, noResultConfirmed: false }), false);
});
test('hasMeaningfulTasResults: true only for a genuine positive count with no no-result confirmation', () => {
  assert.equal(hasMeaningfulTasResults({ resultsDiscovered: 3, noResultConfirmed: false }), true);
});
