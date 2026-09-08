import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  crossCheck, numberIn, areasDiffer, namesDiffer, toFindingRows,
} from '../contractCheck.ts';

/*
 * The high-stakes behaviour here is the difference between three things a
 * naive implementation conflates:
 *
 *   CONTRADICTS   the contract and the registry genuinely disagree
 *   UNVERIFIABLE  we never established the registry value, so there is
 *                 nothing to disagree WITH
 *   AGREES        they match within a tolerance that reflects real rounding
 *
 * Reporting the middle case as a contradiction would manufacture a conflict
 * out of our own missing coverage — which is exactly the failure this product
 * exists to avoid.
 */

const fact = (type, value, state = 'CONFIRMED') => ({
  type, subject: null, value, state, sourceCount: 1,
  evidence: [{ source: 'napr.registry', documentRef: null, effectiveDate: null }],
});

const finding = (over = {}) => ({
  type: 'AREA', label: 'Apartment area', value: '94.1',
  quote: 'the total area of the apartment is 94.1 m2', page: 2, ...over,
});

/* ---------------------------------------------------------------- *
 * NO EVIDENCE = NO FACT, applied to documents                       *
 * ---------------------------------------------------------------- */

test('an extraction that cannot quote its source is dropped entirely', () => {
  const out = crossCheck([finding({ quote: null }), finding({ quote: '   ' })], [fact('property.area', '94.1')]);
  assert.equal(out.length, 0, 'an unquotable extraction is not a contract fact');
});

test('an extraction with no label is dropped', () => {
  assert.equal(crossCheck([finding({ label: '' })], []).length, 0);
});

/* ---------------------------------------------------------------- *
 * The three-way distinction                                         *
 * ---------------------------------------------------------------- */

test('a genuine area mismatch is CONTRADICTS and asks a question, not a conclusion', () => {
  const [r] = crossCheck([finding({ value: '94.1' })], [fact('property.area', '88.0')]);
  assert.equal(r.verifyRelation, 'CONTRADICTS');
  assert.equal(r.severity, 'IMPORTANT');
  assert.match(r.question, /Ask which figure/);
  // A legal conclusion must never be produced.
  assert.equal(/invalid|illegal|fraud|void|breach/i.test(r.question), false);
});

test('an unreached registry is UNVERIFIABLE, never CONTRADICTS', () => {
  const [r] = crossCheck([finding({ value: '94.1' })], [fact('property.area', '', 'UNAVAILABLE')]);
  assert.equal(r.verifyRelation, 'UNVERIFIABLE');
  assert.notEqual(r.severity, 'IMPORTANT');
});

test('a fact the sources disagree about is UNVERIFIABLE, not a contract contradiction', () => {
  const [r] = crossCheck([finding({ value: '94.1' })], [fact('property.area', '88.0', 'CONFLICTING')]);
  assert.equal(r.verifyRelation, 'UNVERIFIABLE');
});

test('no matching Verify fact at all yields UNRELATED, reported but not judged', () => {
  const [r] = crossCheck([finding({ value: '94.1' })], []);
  assert.equal(r.verifyRelation, 'UNRELATED');
  assert.equal(r.severity, 'INFO');
});

test('matching values within real-world rounding are AGREES', () => {
  for (const [doc, reg] of [['94.1', '94.1'], ['94.10', '94.1'], ['94.1', '94.14']]) {
    const [r] = crossCheck([finding({ value: doc })], [fact('property.area', reg)]);
    assert.equal(r.verifyRelation, 'AGREES', `${doc} vs ${reg}`);
  }
});

/* ---------------------------------------------------------------- *
 * Tolerance behaviour                                               *
 * ---------------------------------------------------------------- */

test('the area tolerance is relative, with a floor for small properties', () => {
  assert.equal(areasDiffer(94.1, 94.14), false, 'rounding must not be a contradiction');
  assert.equal(areasDiffer(94.1, 88.0), true, 'a 6 m2 gap must be caught');
  // Floor: on a 20 m2 studio, 1% is 0.2 — the floor keeps it from being noisy.
  assert.equal(areasDiffer(20.0, 20.15), false);
  assert.equal(areasDiffer(20.0, 21.0), true);
});

test('numbers are parsed from both decimal conventions and thousands grouping', () => {
  assert.equal(numberIn('94.1 m2'), 94.1);
  assert.equal(numberIn('94,1 კვ.მ'), 94.1);
  assert.equal(numberIn('1 250 000 GEL'), 1250000);
  assert.equal(numberIn('1,250,000'), 1250000);
  assert.equal(numberIn('no digits here'), null);
  assert.equal(numberIn(null), null);
});

/* ---------------------------------------------------------------- *
 * Party comparison                                                  *
 * ---------------------------------------------------------------- */

test('a different seller from the registered owner is flagged as important', () => {
  const [r] = crossCheck(
    [finding({ type: 'PARTY', label: 'Seller', value: 'შპს არტიტექსი', quote: 'Seller: შპს არტიტექსი' })],
    [fact('ownership.owner', 'შპს მილენიო გრუპი')]
  );
  assert.equal(r.verifyRelation, 'CONTRADICTS');
  assert.equal(r.severity, 'IMPORTANT');
});

test('legal-form prefixes, quotes and casing are not treated as different parties', () => {
  assert.equal(namesDiffer('შპს მილენიო გრუპი', 'მილენიო გრუპი'), false);
  assert.equal(namesDiffer('"Milenio Group" LLC', 'milenio group'), false);
  assert.equal(namesDiffer('შპს ალფა', 'შპს ბეტა'), true);
});

test('an empty name never produces a contradiction', () => {
  assert.equal(namesDiffer('', 'anything'), false);
  const [r] = crossCheck(
    [finding({ type: 'PARTY', label: 'Seller', value: null, quote: 'Seller: ' })],
    [fact('ownership.owner', 'შპს ალფა')]
  );
  assert.equal(r.verifyRelation, 'UNVERIFIABLE');
});

/* ---------------------------------------------------------------- *
 * Price and omissions                                               *
 * ---------------------------------------------------------------- */

test('a price difference is informational, never a contradiction', () => {
  // Asking prices legitimately move; a difference is not a property defect.
  const [r] = crossCheck(
    [finding({ type: 'AMOUNT', label: 'Price', value: '250000', quote: 'price: 250000' })],
    [fact('price.asking', '260000')]
  );
  assert.notEqual(r.verifyRelation, 'CONTRADICTS');
  assert.equal(r.severity, 'INFO');
});

test('a missing expected clause becomes a question, never a legal conclusion', () => {
  const [r] = crossCheck(
    [finding({ type: 'MISSING_EXPECTED', label: 'a handover date', value: null, quote: 'n/a' })],
    []
  );
  assert.equal(r.severity, 'ATTENTION');
  assert.match(r.question, /does not appear to cover/);
  assert.equal(/invalid|illegal|must|unlawful/i.test(r.question), false);
});

/* ---------------------------------------------------------------- *
 * Output shape                                                      *
 * ---------------------------------------------------------------- */

test('rows carry ownership and provenance for every finding', () => {
  const checked = crossCheck([finding()], [fact('property.area', '88.0')]);
  const rows = toFindingRows(checked, { documentId: 'd', dealRoomId: 'r', userId: 'u' });
  assert.equal(rows.length, 1);
  for (const r of rows) {
    assert.equal(r.user_id, 'u');
    assert.equal(r.deal_room_id, 'r');
    assert.equal(r.document_id, 'd');
    assert.ok(r.quote, 'a persisted finding must keep the text it came from');
    assert.ok(['UNRELATED', 'AGREES', 'CONTRADICTS', 'UNVERIFIABLE'].includes(r.verify_relation));
    assert.ok(['INFO', 'ATTENTION', 'IMPORTANT'].includes(r.severity));
  }
});

test('document order is preserved', () => {
  const fs = [finding({ label: 'a' }), finding({ label: 'b' }), finding({ label: 'c' })];
  assert.deepEqual(crossCheck(fs, []).map((x) => x.label), ['a', 'b', 'c']);
});

test('an empty document produces no findings rather than an empty-looking report', () => {
  assert.deepEqual(crossCheck([], [fact('property.area', '94.1')]), []);
});
