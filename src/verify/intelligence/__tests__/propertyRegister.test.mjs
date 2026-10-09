import { test } from 'node:test';
import assert from 'node:assert/strict';

import { decodeGeorgianLegacy, looksLegacyGeorgian } from '../georgianLegacyText.ts';
import {
  buildPropertyRegister, parseRegisterExtract, registerPromptFacts, reconcileReport, reconcileText, rulesFrom, sentences,
} from '../propertyRegister.ts';
import { browserOfficial, EXTRACT_0209, EXTRACT_2209, toLegacy } from './fixtures/propertyRegisterFixture.mjs';

/*
 * REGRESSION: job c80f7237 (01.18.06.019.055.03.01.503, Villion apt 503).
 * The NAPR extracts were never decoded, so the report named the developer as
 * owner and said the termination "does not specify" which mortgage ended.
 */

test('legacy-encoded extract text decodes to Georgian; Unicode and Latin text are untouched', () => {
  assert.equal(decodeGeorgianLegacy(toLegacy('ამონაწერი საჯარო რეესტრიდან — ამონაწერი საჯარო რეესტრიდან')), 'ამონაწერი საჯარო რეესტრიდან — ამონაწერი საჯარო რეესტრიდან');
  assert.ok(looksLegacyGeorgian(EXTRACT_2209));
  const unicode = 'გადაწყვეტილება # 882026834519-03 (22.09.2026)';
  assert.equal(decodeGeorgianLegacy(unicode), unicode);
  const french = 'Résumé du café élégant à Tbilissi';
  assert.equal(decodeGeorgianLegacy(french), french);
  // Digits, agreement numbers and dates survive decoding unchanged.
  assert.match(decodeGeorgianLegacy(EXTRACT_2209), /NMA0003673681/);
});

test('extract: owner is a private person (never named), with purchase basis and rights date', () => {
  const e = parseRegisterExtract(EXTRACT_2209, '35489011');
  assert.deepEqual(e.owners, [{ kind: 'PERSON' }]);
  assert.equal(e.ownershipRegisteredOn, '2026-05-27');
  assert.equal(e.ownershipBasis, 'PURCHASE');
  assert.equal(e.issuedAt, '2026-09-22T09:47:44');
  const json = JSON.stringify(e);
  assert.ok(!json.includes('00000000000'), 'personal number never leaves the parser');
  assert.ok(!json.includes('სატესტო'), 'a private owner is never named');
});

test('extract: company owner is named with its public id', () => {
  const text = EXTRACT_2209.replace(toLegacy('სატესტო მესაკუთრე ,P/N: 00000000000'), toLegacy('შპს მილენიო გრუპი ,ს/ნ: 404670272'));
  const e = parseRegisterExtract(text, 'x');
  assert.equal(e.owners[0].kind, 'COMPANY');
  assert.equal(e.owners[0].companyId, '404670272');
  assert.match(e.owners[0].name, /მილენიო/);
});

test('extract: mortgages, liens, seizure, debtor registry, land function and construction state', () => {
  const e = parseRegisterExtract(EXTRACT_0209, '35433671');
  assert.equal(e.mortgages.length, 2);
  assert.deepEqual(e.mortgages.map((m) => m.agreementNumber), ['NCAH000744921', 'NMA0003673681']);
  assert.equal(e.mortgages[0].registeredOn, '2024-09-09');
  assert.equal(e.mortgages[0].agreementDate, '2023-12-19');
  assert.equal(e.mortgages[1].creditorId, '204378869');
  assert.match(e.mortgages[1].creditor, /საქართველოს ბანკი/);
  assert.equal(e.taxLien, 'NONE');
  assert.equal(e.seizure, 'NONE');
  assert.equal(e.debtorRegistry, 'NONE');
  assert.equal(e.landFunction, 'არასასოფლო სამეურნეო');
  assert.equal(e.buildingsUnderConstruction, true);
  assert.equal(e.unitUnderConstruction, true);
  assert.equal(e.unitAreaSqm, 83.2);
});

test('termination resolved by comparing extracts: 2024 mortgage removed, 2026 mortgage current', () => {
  const reg = buildPropertyRegister(browserOfficial());
  assert.equal(reg.latest.issuedAt.slice(0, 10), '2026-09-22');
  assert.deepEqual(reg.currentMortgages.map((m) => m.agreementNumber), ['NMA0003673681']);
  assert.equal(reg.removedMortgages.length, 1);
  assert.equal(reg.removedMortgages[0].agreementNumber, 'NCAH000744921');
  assert.equal(reg.removedMortgages[0].removedBy.decisionNumber, '882026834519-03');
  assert.equal(reg.removedMortgages[0].removedBy.decisionDate, '2026-09-22');
});

test('partial coverage: 4 found, 2 read, 2 not opened — and the unopened ones are still described', () => {
  const reg = buildPropertyRegister(browserOfficial());
  assert.deepEqual(reg.coverage, { found: 4, read: 2, documents: 4, notOpened: 2 });
  const unopened = reg.proceedings.filter((p) => !p.read);
  assert.deepEqual(unopened.map((p) => p.kind).sort(), ['OWNERSHIP_TRANSFER', 'PARTNERSHIP_OWNERSHIP']);
  assert.ok(unopened.every((p) => p.filedOn && p.completedOn));
  // No applicant or representative name is carried.
  assert.ok(!JSON.stringify(reg).includes('REDACTED'));
});

test('no Service 176 result → no register (absence is never invented)', () => {
  assert.equal(buildPropertyRegister({ results: [{ source: 'tas' }] }), null);
  assert.equal(buildPropertyRegister(null), null);
});

test('documents for another cadastral code are ignored', () => {
  const b = browserOfficial();
  for (const d of b.results[1].documents) d.sourceReference.cadastralCode = '01.00.00.000.000';
  const reg = buildPropertyRegister(b);
  assert.equal(reg.latest, null);
  assert.equal(reg.coverage.read, 0);
});

test('prompt facts are authoritative, dated, and carry no personal data', () => {
  const block = registerPromptFacts(buildPropertyRegister(browserOfficial()));
  assert.match(block, /AUTHORITATIVE/);
  assert.match(block, /2026-09-22/);
  assert.match(block, /private individual/);
  assert.match(block, /NCAH000744921/);
  assert.ok(!block.includes('00000000000'));
  assert.equal(registerPromptFacts(null), '');
});

/* ---- reconciliation of the persisted c80f7237 prose ---- */

const REPORT = {
  summary: { statement: 'Villion Krtsanisi Homes-ის ეს ბინა კარგ მიკროლოკაციასა და დაბალი სიმჭიდროვის პროექტს აერთიანებს.', highlights: [
    { headline: 'ბინაზე იპოთეკა ფიქსირდება', detail: 'ბინა N503-ზე 2026 წლის 2 სექტემბერს საქართველოს ბანკის სასარგებლოდ დარეგისტრირდა იპოთეკა, ხოლო შემდგომი შეწყვეტის ჩანაწერი კონკრეტულად არ ასახელებს, რომელი იპოთეკა გაუქმდა.' },
  ] },
  sections: [{ key: 'SNAPSHOT', body: 'რეესტრში ეს ქონება რეგისტრირებულია როგორც ბინა N503, „ც“ ბლოკის მე-5 სართულზე, მისამართით თბილისი, კრწანისის ქ. 6. მესაკუთრედ მითითებულია შპს „მილენიო გრუპი“. 2026 წლის 2 სექტემბერს ამ კონკრეტულ ბინაზე საქართველოს ბანკის სასარგებლოდ იპოთეკა დარეგისტრირდა, ხოლო 22 სექტემბრის ამონაწერში ის კვლავ ფიქსირდება. ამავე პერიოდში იპოთეკის შეწყვეტის წარმოება დასრულებულად არის აღწერილი, მაგრამ გადაწყვეტილება არ ამბობს, რომელი იპოთეკა შეწყდა.' }],
  keyFindings: [
    { finding: 'ბინა N503-ზე 2026 წლის 2 სექტემბერს საქართველოს ბანკის სასარგებლოდ იპოთეკა დარეგისტრირდა; 22 სექტემბრის ამონაწერში ეს ჩანაწერი კვლავ ჩანს.', whyItMatters: 'x' },
    { finding: 'იპოთეკის შეწყვეტის რეგისტრაციის წარმოება დასრულებულად არის მითითებული, თუმცა გადაწყვეტილების ტექსტი არ აკონკრეტებს, რომელი იპოთეკის ჩანაწერი შეწყდა.', whyItMatters: 'y' },
  ],
  attentionPoints: [{ point: 'ბინა N503-ზე იპოთეკის ჩანაწერი 2026 წლის 22 სექტემბრის ამონაწერშიც ჩანს, მაშინ როცა იპოთეკის შეწყვეტის წარმოების დასრულების ჩანაწერი არ აკონკრეტებს, რომელი იპოთეკა შეწყდა.', why: 'z' }],
  currentStatus: { items: [
    { label: 'იპოთეკის შეწყვეტის წარმოება', value: 'წარმოება დასრულებულია; ჩანაწერი არ აკონკრეტებს შეწყვეტილ იპოთეკას' },
  ] },
  propertyStory: { chapters: [
    { key: 'CHANGES', body: 'ოფიციალურ დოკუმენტებში დანიშნულება თავდაპირველად „ფართობად“ არის ნაჩვენები, მოგვიანებით კი „არასასოფლო-სამეურნეოდ“ შეიცვალა. ეს ცვლილება მნიშვნელოვანია.' },
    { key: 'TODAY', body: 'დღეს ქონება კონკრეტულ, რეგისტრირებულ ბინად არის იდენტიფიცირებული.' },
  ] },
};

test('reconcile: company-as-owner and "termination does not specify" are removed; true sentences stay', () => {
  const reg = buildPropertyRegister(browserOfficial());
  const out = reconcileReport(REPORT, reg);
  const all = JSON.stringify(out);
  assert.ok(!all.includes('მესაკუთრედ მითითებულია შპს'));
  assert.ok(!/არ\s+(აკონკრეტებს|ასახელებს|ამბობს)/.test(all));
  assert.match(out.sections[0].body, /22 სექტემბრის ამონაწერში ის კვლავ ფიქსირდება/);
  assert.match(out.sections[0].body, /კრწანისის ქ\. 6\./, 'an abbreviation is not a sentence end');
  assert.equal(out.keyFindings.length, 1);
  assert.equal(out.attentionPoints.length, 0);
  assert.equal(out.currentStatus.items[0].value, 'წარმოება დასრულებულია');
  assert.deepEqual(out.propertyStory.chapters.map((c) => c.key), ['TODAY'], 'malformed purpose-change chapter removed whole');
  // The highlight was one sentence built on the false claim; the register card states the mortgage instead.
  assert.equal(out.summary.highlights.length, 0);
});

test('reconcile without a register only removes the malformed purpose change', () => {
  const out = reconcileReport(REPORT, null);
  assert.match(JSON.stringify(out), /მესაკუთრედ მითითებულია შპს/);
  assert.equal(out.keyFindings.length, 2);
  assert.deepEqual(out.propertyStory.chapters.map((c) => c.key), ['TODAY']);
});

test('reconcile leaves a company owner claim alone when the register owner IS a company', () => {
  const rules = { ownerIsPrivate: false, terminationResolved: false };
  const s = 'მესაკუთრედ მითითებულია შპს „მილენიო გრუპი“.';
  assert.equal(reconcileText(s, rules), s);
  assert.deepEqual(rulesFrom(null), { ownerIsPrivate: false, terminationResolved: false });
});

test('sentence splitter keeps cadastral codes and street abbreviations intact', () => {
  assert.equal(sentences('კოდით 01. 18. 06. 019. ბინა. შემდეგი.').length, 3);
  assert.equal(sentences('კრწანისის ქ. 6. მესაკუთრე.').length, 2);
});

test('text for a model is decoded and carries no private name or personal number', async () => {
  const { redactRegisterText } = await import('../propertyRegister.ts');
  const { DECISION_TERMINATION } = await import('./fixtures/propertyRegisterFixture.mjs');
  const out = redactRegisterText(EXTRACT_2209);
  assert.match(out, /ამონაწერი საჯარო რეესტრიდან/);
  assert.ok(!out.includes('სატესტო'));
  assert.ok(!out.includes('00000000000'));
  assert.match(out, /ფიზიკური პირი/);
  assert.match(out, /204378869/, 'a company code is public and stays');
  const decision = redactRegisterText(DECISION_TERMINATION.replace('[REDACTED]', 'სახელი გვარი (12345678901)'));
  assert.ok(!decision.includes('12345678901'));
  assert.ok(!decision.includes('სახელი გვარი'));
});
