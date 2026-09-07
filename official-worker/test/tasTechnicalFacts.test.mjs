// tasTechnicalFacts.test.mjs — TAS DOCUMENT INTELLIGENCE mandate. Every
// fixture here uses GENERIC/synthetic project data (never Villion, never any
// real cadastral code) specifically to prove the extractor is generic
// across projects, not tuned to one fixture.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractTasTechnicalFacts, dedupeTasTechnicalFacts } from '../.tstest-build/documents/TasTechnicalFacts.js';

test('extractTasTechnicalFacts: empty/whitespace-only text returns [], never a guessed fact', () => {
  assert.deepEqual(extractTasTechnicalFacts(''), []);
  assert.deepEqual(extractTasTechnicalFacts('   \n  \n '), []);
  assert.deepEqual(extractTasTechnicalFacts(null), []);
  assert.deepEqual(extractTasTechnicalFacts(undefined), []);
});

test('extractTasTechnicalFacts: a blank form label with no value produces NO fact ("do not treat blank official form labels as evidence")', () => {
  const text = 'მთავარი არქიტექტორის სახელი და გვარი:\n\nსაცხოვრებელი ფართი:\n';
  const facts = extractTasTechnicalFacts(text);
  assert.equal(facts.some((f) => f.key === 'mainArchitectName'), false);
  assert.equal(facts.some((f) => f.key === 'residentialArea'), false);
});

test('extractTasTechnicalFacts: an inline same-line value is extracted at HIGH confidence, with a synthetic (non-Villion) architect name', () => {
  const text = 'მთავარი არქიტექტორის სახელი და გვარი: ნინო ხაზარაძე';
  const facts = extractTasTechnicalFacts(text);
  const f = facts.find((x) => x.key === 'mainArchitectName');
  assert.ok(f, 'expected an architect fact');
  assert.equal(f.category, 'ARCHITECT');
  assert.equal(f.value, 'ნინო ხაზარაძე');
  assert.equal(f.confidence, 'HIGH');
});

test('extractTasTechnicalFacts: a label on its own line with the value on the NEXT line (separate DOM nodes/table cells) is extracted at MEDIUM confidence', () => {
  const text = ['მთავარი არქიტექტორის სახელი და გვარი', 'დავით მჭედლიშვილი', 'შემდეგი ველი'].join('\n');
  const facts = extractTasTechnicalFacts(text);
  const f = facts.find((x) => x.key === 'mainArchitectName');
  assert.ok(f);
  assert.equal(f.value, 'დავით მჭედლიშვილი');
  assert.equal(f.confidence, 'MEDIUM');
});

test('extractTasTechnicalFacts: a look-ahead value search never consumes the NEXT field\'s own label as this field\'s value', () => {
  const text = ['მთავარი არქიტექტორის სახელი და გვარი', '', 'კონსტრუქციული დასკვნის სპეციალისტი', 'ლევან წიკლაური'].join('\n');
  const facts = extractTasTechnicalFacts(text);
  assert.equal(facts.some((f) => f.key === 'mainArchitectName'), false, 'architect had no real value, must not fabricate one from the next label');
  const structural = facts.find((f) => f.key === 'structuralReviewSpecialist');
  assert.ok(structural);
  assert.equal(structural.value, 'ლევან წიკლაური');
});

test('extractTasTechnicalFacts: generic ორგანიზაცია/საიდენტიფიკაციო კოდი attributes are tagged with the CURRENTLY ACTIVE role context, not a meaningless top-level bucket', () => {
  const text = [
    'მთავარი არქიტექტორის სახელი და გვარი: ხატია ბერიძე',
    'ორგანიზაცია: შპს არქისტუდიო ერთი',
    'საიდენტიფიკაციო კოდი: 405111222',
    'საინჟინრო-გეოლოგიური კვლევის სპეციალისტი: ზურაბ კახიძე',
    'ორგანიზაცია: შპს გეოტესტი',
  ].join('\n');
  const facts = extractTasTechnicalFacts(text);
  const archOrg = facts.find((f) => f.category === 'ARCHITECT' && f.key === 'organization');
  const archId = facts.find((f) => f.category === 'ARCHITECT' && f.key === 'idCode');
  const geoOrg = facts.find((f) => f.category === 'GEOTECHNICAL' && f.key === 'organization');
  assert.ok(archOrg && archOrg.value === 'შპს არქისტუდიო ერთი');
  assert.ok(archId && archId.value === '405111222');
  assert.ok(geoOrg && geoOrg.value === 'შპს გეოტესტი');
  // The geotechnical organization must never leak into the architect
  // category just because both used the same generic "ორგანიზაცია" label.
  assert.notEqual(archOrg.value, geoOrg.value);
});

test('extractTasTechnicalFacts: role context resets after too many lines with no reinforcing label — a distant unrelated ორგანიზაცია line is never mis-attributed', () => {
  const filler = Array.from({ length: 8 }, (_, i) => `უცნობი ველი ${i}`).join('\n');
  const text = `მთავარი არქიტექტორის სახელი და გვარი: სოფო გელაშვილი\n${filler}\nორგანიზაცია: შპს რაღაცა`;
  const facts = extractTasTechnicalFacts(text);
  const org = facts.find((f) => f.key === 'organization');
  assert.equal(org, undefined, 'context should have expired long before this line');
});

test('extractTasTechnicalFacts: foundation/pile-related labels are recognized generically, without any hardcoded pile count — the VALUE always comes from the text, never invented', () => {
  const withPiles = extractTasTechnicalFacts('ხიმინჯების რაოდენობა: 45');
  assert.ok(withPiles.some((f) => f.category === 'FOUNDATION' && f.key === 'piles' && f.value.includes('45')));
  const noPiles = extractTasTechnicalFacts('საერთო ფართი: 3500 კვ.მ.');
  assert.equal(noPiles.some((f) => f.key === 'piles'), false, 'a document with no pile information must never get a fabricated piles fact');
});

test('extractTasTechnicalFacts: K1/K2/K3 and other numeric project fields on one compact line are all captured independently', () => {
  const facts = extractTasTechnicalFacts('K1: 2.5  K2: 1.8  K3: 3.0');
  assert.ok(facts.find((f) => f.key === 'K1' && f.value.startsWith('2.5')));
  assert.ok(facts.find((f) => f.key === 'K2' && f.value.startsWith('1.8')));
  assert.ok(facts.find((f) => f.key === 'K3' && f.value.startsWith('3.0')));
});

test('extractTasTechnicalFacts: a value that is just a placeholder dash/underscore/N-A never becomes a fact', () => {
  const text = ['განმცხადებელი: -', 'ნაკვეთის მესაკუთრე: N/A', 'პროექტის რედაქცია: ___'].join('\n');
  const facts = extractTasTechnicalFacts(text);
  assert.equal(facts.length, 0);
});

test('extractTasTechnicalFacts: works identically for a completely different (non-Villion, non-residential) document — proves genericity across projects/asset types', () => {
  const text = [
    'განმცხადებელი: ფიზიკური პირი გიორგი მაისურაძე',
    'ნაკვეთის მესაკუთრე: იგივე განმცხადებელი',
    'შენობის ფუნქცია: კომერციული დანიშნულების ობიექტი',
    'საძირკვლის ტიპი: ზოლური საძირკველი',
  ].join('\n');
  const facts = extractTasTechnicalFacts(text);
  assert.ok(facts.find((f) => f.category === 'APPLICANT' && f.key === 'applicant'));
  assert.ok(facts.find((f) => f.category === 'OWNER' && f.key === 'parcelOwner'));
  assert.ok(facts.find((f) => f.category === 'PROJECT' && f.key === 'buildingFunction' && f.value.includes('კომერციული')));
  assert.ok(facts.find((f) => f.category === 'FOUNDATION' && f.key === 'foundationType'));
});

test('dedupeTasTechnicalFacts: identical category+key+value pairs collapse to one, keeping the higher-confidence occurrence', () => {
  const facts = [
    { category: 'ARCHITECT', key: 'mainArchitectName', value: 'ნინო ხაზარაძე', confidence: 'MEDIUM', rawLabel: 'x' },
    { category: 'ARCHITECT', key: 'mainArchitectName', value: 'ნინო ხაზარაძე', confidence: 'HIGH', rawLabel: 'x' },
    { category: 'FOUNDATION', key: 'piles', value: '45', confidence: 'HIGH', rawLabel: 'y' },
  ];
  const out = dedupeTasTechnicalFacts(facts);
  assert.equal(out.length, 2);
  const arch = out.find((f) => f.key === 'mainArchitectName');
  assert.equal(arch.confidence, 'HIGH');
});
