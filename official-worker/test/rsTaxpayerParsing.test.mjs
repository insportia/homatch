// rsTaxpayerParsing.test.mjs — workflows/financial/RsTaxpayerParsing.ts, the
// pure result-page parsing and success-evidence gate split out of
// RsTaxpayerWorker.ts (2026-09 "report intelligence v2" mandate, Section
// 7/18: "RS successful verification requires actual parsed taxpayer-result
// fields... never mark RS success merely because the page loaded").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRsTaxpayerFields, hasParsedTaxpayerEvidence } from '../.tstest-build/workflows/financial/RsTaxpayerParsing.js';

test('parseRsTaxpayerFields: extracts real labeled fields from a genuine result page', () => {
  const text = 'დასახელება: შპს მილენიო გრუპი\nსტატუსი: აქტიური\nსაიდენტიფიკაციო კოდი: 404670272\nდღგ გადამხდელი: კი';
  const out = parseRsTaxpayerFields(text, '404670272');
  assert.equal(out.taxpayerName, 'შპს მილენიო გრუპი');
  assert.equal(out.status, 'აქტიური');
  assert.equal(out.identificationCode, '404670272');
});

// The exact production regression this gate exists for: a new page signal
// appeared and no no-result phrase matched, but the page carried no real
// labeled field at all — only the searched ID echoed back somewhere.
test('hasParsedTaxpayerEvidence: false when nothing but the echoed idCode is present (the exact production trace)', () => {
  const text = 'ძებნის შედეგი 404670272 ნაპოვნია გვერდზე, თუმცა სხვა ველები არ არის ცნობილი ფორმატში.';
  const parsed = parseRsTaxpayerFields(text, '404670272');
  assert.equal(parsed.taxpayerName, null);
  assert.equal(hasParsedTaxpayerEvidence(parsed), false);
});
test('hasParsedTaxpayerEvidence: true when at least one real descriptive field parsed', () => {
  assert.equal(hasParsedTaxpayerEvidence({ identificationCode: '404670272', taxpayerName: null, legalForm: null, status: 'აქტიური', registrationDate: null, vatStatus: null, address: null, otherPublicFields: {} }), true);
});
test('hasParsedTaxpayerEvidence: false for null data', () => {
  assert.equal(hasParsedTaxpayerEvidence(null), false);
});
