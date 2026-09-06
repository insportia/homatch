// entityValidation.test.mjs — entities/EntityValidation.ts's looksLikeCompanyId(),
// the core invariant behind the real production job 08379309-bb2e-4ac6-9d97-
// 727edb3af2b8 ENREG fix ("a company name must NEVER be copied into idCode").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeCompanyId, isValidCompanyCandidate, LEGAL_FORM_RE } from '../.tstest-build/entities/EntityValidation.js';

test('looksLikeCompanyId: accepts a real 9-11 digit registry id', () => {
  assert.ok(looksLikeCompanyId('404670272'));
  assert.ok(looksLikeCompanyId('405123456'));
});
test('looksLikeCompanyId: rejects a company NAME — the exact production bug value', () => {
  assert.ok(!looksLikeCompanyId('Millenio Group'));
});
test('looksLikeCompanyId: rejects null/undefined/empty', () => {
  assert.ok(!looksLikeCompanyId(null));
  assert.ok(!looksLikeCompanyId(undefined));
  assert.ok(!looksLikeCompanyId(''));
});
test('looksLikeCompanyId: rejects too-short/too-long digit runs', () => {
  assert.ok(!looksLikeCompanyId('12345'));
  assert.ok(!looksLikeCompanyId('123456789012'));
});

// Real production job 1aa45cdf-a5cf-4dcc-b7a9-524cedb596ae regression: the
// individual-entrepreneur marker matched the bare adjective "ინდივიდუალური"
// ("individual") without requiring "მეწარმე" ("entrepreneur"), so a
// construction-permit phrase was misread as a company name.
test('LEGAL_FORM_RE: does NOT match the bare adjective "ინდივიდუალური" alone', () => {
  assert.equal(LEGAL_FORM_RE.test('ინდივიდუალური საცხოვრებელი სახლის მშენებლობისა'), false);
});
test('LEGAL_FORM_RE: DOES match "ინდივიდუალური მეწარმე" (individual entrepreneur)', () => {
  assert.equal(LEGAL_FORM_RE.test('ინდივიდუალური მეწარმე გიორგი გიორგაძე'), true);
});

test('isValidCompanyCandidate: the exact production false positive is rejected', () => {
  assert.equal(isValidCompanyCandidate('ინდივიდუალური საცხოვრებელი სახლის მშენებლობისა', null, 'ნებართვა გაიცა ინდივიდუალური საცხოვრებელი სახლის მშენებლობისათვის'), false);
});
test('isValidCompanyCandidate: a real numeric id code is decisive on its own', () => {
  assert.equal(isValidCompanyCandidate('რაიმე სახელი', '404670272'), true);
});
test('isValidCompanyCandidate: a real legal-form name is accepted without an id code', () => {
  assert.equal(isValidCompanyCandidate('შპს მილენიო გრუპი', null), true);
});
test('isValidCompanyCandidate: a bare name with no legal-form marker and no id code is rejected even with weak context', () => {
  assert.equal(isValidCompanyCandidate('რაღაც სიტყვები', null, 'უბრალო წინადადება არაფრის შესახებ'), false);
});
