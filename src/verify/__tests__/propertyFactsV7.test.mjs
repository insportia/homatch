import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseRegisterExtract, parseUnitRow, buildPropertyRegister, officialExtractUrl } from '../intelligence/propertyRegister.ts';
import { buildUnitIdentity } from '../intelligence/unitIdentity.ts';
import { classifyPropertyKind, propertyKindFromResult, propertyKindFromRegister, sectionsFor, kindsIn } from '../intelligence/propertyKind.ts';
import { withPropertyRegister } from '../intelligence/registerEnrichment.ts';
import { resolveAssetClass } from '../researchPlan.ts';
import { buildPropertyFacts, extractLink } from '../propertyFacts.ts';
import { safeHref } from '../reportPresentation.ts';
import { toLegacy } from '../intelligence/__tests__/fixtures/propertyRegisterFixture.mjs';
import {
  EXTRACT_EEEFADA9, EXTRACT_8BA97DA9, DOC_URL_EEEFADA9, ADDRESS_EEEFADA9, ADDRESS_8BA97DA9,
} from '../intelligence/__tests__/fixtures/registerExtractsV7Fixture.mjs';

/*
 * v7 (owner, 2026-10-11): ALWAYS show the exact property area and the latest
 * extract; the property type comes from the registry's own wording.
 * Fixtures are the real extracts of jobs eeefada9 and 8ba97da9 with the
 * owners' personal numbers redacted.
 */

const CODE_E = '01.72.14.040.030.01.01.004';
const CODE_V = '01.18.06.019.055.03.01.601';

/* ───────────── parser: both layouts ───────────── */

test('eeefada9: collapsed owners row → 79.5 m², floor 2, apt 4, "ფართი (მშენებარე)", 22.06.2026, owner', () => {
  for (const raw of [EXTRACT_EEEFADA9, toLegacy(EXTRACT_EEEFADA9)]) {
    const e = parseRegisterExtract(raw, '35092451');
    assert.equal(e.unitAreaSqm, 79.5);
    assert.equal(e.unitFloor, '2');
    assert.equal(e.unitNumber, '4');
    assert.equal(e.unitBlock, null);
    assert.equal(e.unitDescription, 'ფართი (მშენებარე)');
    assert.equal(e.unitRowFound, true);
    assert.equal(e.issuedAt, '2026-06-22T11:58:07');
    assert.deepEqual(e.owners, [{ kind: 'PERSON', name: 'გიორგი ბლიაძე' }]);
    // Parcel and building totals are read as what they are — never as the unit's area.
    assert.equal(e.landAreaSqm, 1400);
    assert.equal(e.buildingsTotalAreaSqm, 3711.2);
  }
});

test('8ba97da9: wrapped owners row → 94.1 m², block ც, floor 6, apt 601, 24.08.2026, owner', () => {
  for (const raw of [EXTRACT_8BA97DA9, toLegacy(EXTRACT_8BA97DA9)]) {
    const e = parseRegisterExtract(raw, '35356992');
    assert.equal(e.unitAreaSqm, 94.1);
    assert.equal(e.unitBlock, 'ც');
    assert.equal(e.unitFloor, '6');
    assert.equal(e.unitNumber, '601');
    assert.equal(e.unitDescription, 'ფართი (მშენებარე)');
    assert.equal(e.issuedAt, '2026-08-24T08:35:20');
    assert.deepEqual(e.owners, [{ kind: 'PERSON', name: 'მარიამი აბციაური' }]);
    assert.equal(e.landAreaSqm, 2145);
    assert.equal(e.buildingsTotalAreaSqm, 6946.6);
  }
});

test('no 11-digit personal number survives parsing', () => {
  const withNumber = EXTRACT_EEEFADA9.replace('P/N: 00000000000', 'P/N: 01001012345');
  const e = parseRegisterExtract(withNumber, '1');
  assert.doesNotMatch(JSON.stringify(e), /(?<!\d)\d{11}(?!\d)/);
});

test('unit row: parking, comma decimals and a parcel-only extract', () => {
  const parking = parseUnitRow('\nმესაკუთრე:\nსაკუთრება:ფართი:წილი:\nსატესტო პირისაკუთრებაავტოსადგომი N12, სართული -1\n13,50 კვ.მ.\n');
  assert.equal(parking.areaSqm, 13.5);
  assert.equal(parking.number, '12');
  assert.equal(parking.floor, '-1');
  assert.match(parking.itemText, /ავტოსადგომი/);
  assert.equal(parseUnitRow('\nმესაკუთრე:\nსატესტო პირი\n'), null);
});

/* ───────────── carried server-side: the extract link ───────────── */

function browserOfficialFor(code, appID, raw, url) {
  return {
    results: [{
      source: 'mygov',
      retrievedAt: '2026-10-11T14:21:20.232Z',
      traversal: { search: { cadastralCode: code, records: [{ appID, regNumber: '882026515135', webTransact: 'იპოთეკის შეწყვეტის რეგისტრაცია უძრავ ნივთზე', appRegDate: 1781600000, lastActDate: 1782100000 }] } },
      documents: [{ url, rawText: raw, sourceReference: { recordId: appID, cadastralCode: code, url } }],
    }],
  };
}
const resultE = (extra = {}) => ({
  assetClass: 'MIXED_OR_UNKNOWN',
  projectProfile: { name: 'Kristian Stiven Street, 18', developer: 'შპს „ჯეო სითი დიღომი“' },
  landProfile: { landAreaSqm: 1400 },
  exactUnit: { code: CODE_E, verified: false },
  service176Evidence: [{ field: 'ADDRESS', value: ADDRESS_EEEFADA9, provenance: { cadastralCode: CODE_E, appID: '35092451' } }],
  browserOfficial: browserOfficialFor(CODE_E, '35092451', toLegacy(EXTRACT_EEEFADA9), DOC_URL_EEEFADA9),
  ...extra,
});

test('the latest extract carries its official NAPR document and record links', () => {
  const reg = buildPropertyRegister(resultE().browserOfficial);
  assert.equal(reg.latest.documentUrl, DOC_URL_EEEFADA9);
  assert.equal(reg.latest.recordUrl, 'https://naprweb.reestri.gov.ge/_dea/#/view/35092451');
  assert.equal(reg.latest.unitAreaSqm, 79.5);
  // Anything but NAPR's https blob service is refused.
  for (const bad of ['http://bs.napr.gov.ge/GetBlob?pid=1', 'https://evil.example/GetBlob?x', 'javascript:alert(1)', 'https://bs.napr.gov.ge.evil.io/GetBlob', 'https://u:p@bs.napr.gov.ge/GetBlob']) {
    assert.equal(officialExtractUrl(bad), null, bad);
  }
});

test('unitIdentity: area filled from the collapsed row; floor/apartment from the address', () => {
  const ui = buildUnitIdentity(resultE(), CODE_E);
  assert.equal(ui.exactUnit.areaSqm, 79.5);
  assert.equal(ui.exactUnit.floor, '2');
  assert.equal(ui.exactUnit.apartment, '4');
  assert.equal(ui.exactUnit.description, 'ფართი (მშენებარე)');
  assert.equal(ui.parentParcel.landAreaSqm, 1400);
});

/* ───────────── property kind ───────────── */

test('eeefada9 resolves APARTMENT_IN_PROJECT from the register (raw and sanitized result)', () => {
  assert.equal(propertyKindFromResult(resultE()).kind, 'APARTMENT');
  assert.equal(resolveAssetClass(resultE()), 'APARTMENT_IN_PROJECT');
  // The customer copy has no browserOfficial: the registered address alone decides.
  const { browserOfficial: _b, ...sanitized } = resultE();
  assert.equal(resolveAssetClass(sanitized), 'APARTMENT_IN_PROJECT');
  // A declared class the register agrees with stays (Villion).
  assert.equal(resolveAssetClass({ ...resultE(), assetClass: 'RENTAL' }), 'RENTAL');
  // A declared class the register contradicts gives way.
  assert.equal(resolveAssetClass({ ...resultE(), assetClass: 'LAND' }), 'APARTMENT_IN_PROJECT');
});

test('read path: propertyKind attached and synthesis propertyType corrected from UNKNOWN', () => {
  const out = withPropertyRegister({ propertyType: 'UNKNOWN', report: null }, resultE());
  assert.equal(out.propertyKind.kind, 'APARTMENT');
  assert.equal(out.propertyType, 'PRIVATE_APARTMENT');
  assert.equal(out.propertyRegister.latest.unitAreaSqm, 79.5);
  assert.equal(out.unitIdentity.exactUnit.areaSqm, 79.5);
  // A known type is never overwritten.
  assert.equal(withPropertyRegister({ propertyType: 'DEVELOPER_APARTMENT', report: null }, resultE()).propertyType, 'DEVELOPER_APARTMENT');
});

test('property kind is never derived from the cadastral code length or shape', () => {
  for (const code of [CODE_E, CODE_V, '01.72.14.040.030', '72.14.40.30']) {
    assert.equal(classifyPropertyKind({ registeredAddress: code }).kind, 'UNKNOWN', code);
    assert.equal(propertyKindFromResult({ exactUnit: { code }, query: code }).kind, 'UNKNOWN', code);
    assert.equal(resolveAssetClass({ exactUnit: { code } }), 'MIXED_OR_UNKNOWN', code);
  }
});

const KIND_FIXTURES = [
  ['APARTMENT', { unitRowFound: true, unitItemText: 'ფართი (მშენებარე) სართული 6, ბინა N601, ბლოკი "ც"', registeredAddress: ADDRESS_8BA97DA9 }],
  ['PARKING', { unitRowFound: true, unitItemText: 'ავტოსადგომი N12, სართული -1 (სარდაფი)', registeredAddress: 'ქალაქი თბილისი, ქუჩა ა, N 1, ავტოსადგომი N12' }],
  ['STORAGE', { unitRowFound: true, unitItemText: 'სათავსო N3, სართული -1' }],
  ['OFFICE', { unitRowFound: true, unitItemText: 'ოფისი N5, სართული 3' }],
  ['COMMERCIAL', { unitRowFound: true, unitItemText: 'არასაცხოვრებელი ფართი, მაღაზია N2, სართული 1' }],
  ['LAND', { unitRowFound: false, buildingsText: null }],
  ['PRIVATE_HOUSE', { unitRowFound: false, buildingsText: 'N1 ინდივიდუალური საცხოვრებელი სახლი' }],
  ['OTHER', { unitRowFound: true, unitItemText: 'ფართი (მშენებარე)' }],
  ['AMBIGUOUS', { unitRowFound: true, unitItemText: 'ავტოსადგომი N4', registeredAddress: 'ქალაქი თბილისი, ქუჩა ა, N 1, სართული 2, ბინა N4' }],
];

test('kinds: apartment, parking, storage, office, commercial, land, house, other, ambiguous', () => {
  for (const [kind, input] of KIND_FIXTURES) {
    const r = classifyPropertyKind(input);
    assert.equal(r.kind, kind, JSON.stringify(input));
    if (kind === 'AMBIGUOUS') {
      assert.ok(r.conflicts.length >= 2);
      assert.match(r.explanation, /PARKING.*APARTMENT|APARTMENT.*PARKING/);
    }
  }
  // A multi-apartment residential building on the parcel is not a private house.
  assert.notEqual(classifyPropertyKind({ unitRowFound: false, buildingsText: 'მრავალბინიანი საცხოვრებელი სახლი' }).kind, 'PRIVATE_HOUSE');
  // "სარდაფი" next to a parking word is its level, not a storeroom.
  assert.deepEqual(kindsIn('ავტოსადგომი N12, სარდაფი', 'UNIT_ROW').map((s) => s.kind), ['PARKING']);
});

test('sectionsFor: land has no building specs, unit utilities or apartment market; parking no living location', () => {
  const land = sectionsFor('LAND');
  assert.equal(land.buildingSpecs, false);
  assert.equal(land.unitUtilities, false);
  assert.equal(land.apartmentMarket, false);
  assert.equal(sectionsFor('PARKING').livingLocation, false);
  assert.equal(sectionsFor('PARKING').unitUtilities, false);
  for (const k of ['APARTMENT', 'OTHER', 'AMBIGUOUS', 'UNKNOWN']) {
    const s = sectionsFor(k);
    assert.ok(s.buildingSpecs && s.unitUtilities && s.apartmentMarket && s.livingLocation, k);
  }
});

/* ───────────── the facts card model ───────────── */

const labels = (m) => m.rows.map((r) => r.key);
const value = (m, key) => m.rows.find((r) => r.key === key)?.value ?? null;

test('facts card for eeefada9 as stored TODAY (before rebuild): no invented area, floor/apt/owner/date shown', () => {
  // The production synthesis as persisted: unitAreaSqm null, no unit row fields, no link.
  const stored = {
    propertyRegister: { cadastralCode: CODE_E, latest: { recordId: '35092451', issuedAt: '2026-06-22T11:58:07', owners: [{ kind: 'PERSON', name: 'გიორგი ბლიაძე' }], unitAreaSqm: null, landAreaSqm: 1400, unitUnderConstruction: true, buildingsUnderConstruction: true } },
    unitIdentity: { exactUnit: { code: CODE_E, floor: '2', apartment: '4', block: null, areaSqm: null, registeredAddress: ADDRESS_EEEFADA9, evidenceDate: '2026-06-22T11:58:07', underConstruction: true }, parentParcel: { landAreaSqm: 1400 } },
  };
  const m = buildPropertyFacts(stored);
  assert.equal(m.kind, 'APARTMENT');
  assert.equal(value(m, 'floor'), '2');
  assert.equal(value(m, 'unitNumber'), '4');
  assert.equal(value(m, 'owner'), 'გიორგი ბლიაძე');
  assert.equal(value(m, 'extractDate'), '22.06.2026');
  assert.equal(value(m, 'cadastral'), CODE_E);
  // No area row rather than the parcel's 1400.
  assert.ok(!labels(m).includes('area'));
  assert.equal(m.rows.find((r) => r.key === 'registeredState').valueKey, 'verify_v7_facts_state_under_construction');
  assert.equal(m.secondary.find((r) => r.key === 'parcelTotal').value, '1400');
  assert.equal(m.link, null);
});

test('facts card for eeefada9 after the read path: 79.5 m², ფართი (მშენებარე), extract link', () => {
  const read = withPropertyRegister({ propertyType: 'UNKNOWN', report: null }, resultE());
  const m = buildPropertyFacts(read);
  assert.equal(value(m, 'area'), '79.5');
  assert.equal(value(m, 'registeredState'), 'ფართი (მშენებარე)');
  assert.equal(value(m, 'extractDate'), '22.06.2026');
  assert.deepEqual(m.secondary.map((r) => [r.key, r.value]), [['parcelTotal', '1400'], ['buildingTotal', '3711.2']]);
  assert.equal(m.link.kind, 'DOCUMENT');
  assert.equal(m.link.href, DOC_URL_EEEFADA9);
  assert.ok(safeHref(m.link.href), 'the link passes the report-wide safeHref');
  assert.equal(m.rows.find((r) => r.key === 'kind').valueKey, 'verify_v7_facts_kind_apartment');
});

test('facts card for 8ba97da9: 94.1 m², block ც, floor 6, apt 601, 24.08.2026', () => {
  const synthesis = {
    propertyRegister: { cadastralCode: CODE_V, latest: { ...parseRegisterExtract(EXTRACT_8BA97DA9, '35356992'), recordUrl: 'https://naprweb.reestri.gov.ge/_dea/#/view/35356992' } },
    unitIdentity: { exactUnit: { code: CODE_V, block: 'ც', floor: '6', apartment: '601', areaSqm: 94.1, registeredAddress: ADDRESS_8BA97DA9 } },
  };
  const m = buildPropertyFacts(synthesis);
  assert.equal(value(m, 'area'), '94.1');
  assert.equal(value(m, 'block'), 'ც');
  assert.equal(value(m, 'floor'), '6');
  assert.equal(value(m, 'unitNumber'), '601');
  assert.equal(value(m, 'owner'), 'მარიამი აბციაური');
  assert.equal(value(m, 'extractDate'), '24.08.2026');
  // No document URL: the official record page.
  assert.equal(m.link.kind, 'RECORD');
  assert.equal(m.link.href, 'https://naprweb.reestri.gov.ge/_dea/#/view/35356992');
});

test('area is never the parcel or the building total, for every kind', () => {
  const latest = { recordId: '1', issuedAt: '2026-01-02T00:00:00', owners: [], unitAreaSqm: null, landAreaSqm: 2145, buildingsTotalAreaSqm: 3711.2 };
  for (const [kind, input] of KIND_FIXTURES.filter(([k]) => k !== 'LAND')) {
    const m = buildPropertyFacts({ propertyRegister: { latest: { ...latest, unitItemText: input.unitItemText, unitRowFound: input.unitRowFound, buildingsText: input.buildingsText } }, unitIdentity: { exactUnit: { code: CODE_V, registeredAddress: input.registeredAddress ?? null } } });
    const area = value(m, 'area');
    assert.ok(area !== '2145' && area !== '3711.2', `${kind}: ${area}`);
  }
});

const facts = (latest, address) => buildPropertyFacts({
  propertyRegister: { latest: { recordId: '1', issuedAt: '2026-05-01T10:00:00', owners: [{ kind: 'PERSON', name: 'სატესტო პირი' }], ...latest } },
  unitIdentity: { exactUnit: { code: '01.01.01.001.001.01.01.001', registeredAddress: address ?? null } },
});

test('type-specific fields: parking, land, house, commercial, office, storage, ambiguous', () => {
  const parking = facts({ unitRowFound: true, unitItemText: 'ავტოსადგომი N12, სართული -1', unitNumber: '12', unitFloor: '-1', unitAreaSqm: 13.5 });
  assert.equal(parking.kind, 'PARKING');
  assert.deepEqual(labels(parking), ['kind', 'cadastral', 'area', 'level', 'unitNumber', 'owner', 'extractDate']);

  const land = facts({ unitRowFound: false, landAreaSqm: 600, landFunction: 'სასოფლო სამეურნეო', parcelAddress: 'სოფელი ა' });
  assert.equal(land.kind, 'LAND');
  assert.equal(value(land, 'area'), '600');
  assert.equal(value(land, 'landFunction'), 'სასოფლო სამეურნეო');
  assert.ok(!labels(land).some((k) => ['floor', 'block', 'unitNumber', 'level'].includes(k)));

  const house = facts({ unitRowFound: false, buildingsText: 'N1 საცხოვრებელი სახლი', unitAreaSqm: 180, landAreaSqm: 650 });
  assert.equal(house.kind, 'PRIVATE_HOUSE');
  assert.equal(value(house, 'area'), '180');
  assert.equal(value(house, 'landArea'), '650');
  assert.ok(!labels(house).includes('floor'));

  for (const [text, kind] of [['არასაცხოვრებელი ფართი, მაღაზია N2', 'COMMERCIAL'], ['ოფისი N5, სართული 3', 'OFFICE'], ['სათავსო N3, სართული -1', 'STORAGE']]) {
    const m = facts({ unitRowFound: true, unitItemText: text, unitDescription: text.split(',')[0], unitAreaSqm: 40 });
    assert.equal(m.kind, kind);
    assert.equal(value(m, 'area'), '40');
    assert.ok(labels(m).includes('registeredState'));
  }

  const amb = facts({ unitRowFound: true, unitItemText: 'ავტოსადგომი N4' }, 'ქუჩა ა, N 1, სართული 2, ბინა N4');
  assert.equal(amb.kind, 'AMBIGUOUS');
  assert.equal(amb.ambiguityKey, 'verify_v7_facts_ambiguous_note');
  assert.equal(amb.sections.apartmentMarket, true, 'nothing is hidden on an ambiguous kind');
});

test('extract link: only official https NAPR links render', () => {
  assert.equal(extractLink({ documentUrl: 'javascript:alert(1)', recordUrl: 'https://evil.example/#/view/1' }), null);
  assert.equal(extractLink({ recordUrl: 'https://naprweb.reestri.gov.ge/_dea/#/view/35092451' }).kind, 'RECORD');
  assert.equal(extractLink({ documentUrl: DOC_URL_EEEFADA9, recordUrl: 'https://naprweb.reestri.gov.ge/_dea/#/view/35092451' }).kind, 'DOCUMENT');
  // The URL carries no personal data: no 11-digit number.
  assert.doesNotMatch(DOC_URL_EEEFADA9, /\d{11}/);
});

test('owner text never prints a personal number', () => {
  const m = facts({ owners: [{ kind: 'PERSON', name: 'სატესტო პირი ,P/N: 01001012345' }], unitRowFound: true, unitItemText: 'ბინა N1', unitAreaSqm: 50 });
  assert.equal(value(m, 'owner'), 'სატესტო პირი');
});

test('stored propertyKind from an older payload without unitRowFound still classifies from the address', () => {
  const r = propertyKindFromRegister({ recordId: '1', issuedAt: '2026-06-22T11:58:07', unitUnderConstruction: true }, ADDRESS_EEEFADA9);
  assert.equal(r.kind, 'APARTMENT');
});
