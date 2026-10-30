import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildPropertyRegister, registerModelFacts } from '../intelligence/propertyRegister.ts';
import { propertyKindFromResult, sectionsFor } from '../intelligence/propertyKind.ts';
import { withPropertyRegister } from '../intelligence/registerEnrichment.ts';
import { buildPropertyFacts } from '../propertyFacts.ts';
import { legalFindings } from '../intelligence/legalStatus.ts';
import { buildBuyerAssessment, finalBuyerAssessment, finalConclusion } from '../intelligence/buyerAssessment.ts';
import { keepStoryOnRebuild } from '../intelligence/storyGuard.ts';
import { subjectMarketFacts } from '../intelligence/marketHierarchy.ts';
import { buildEvidencePackage } from '../intelligence/evidencePackage.ts';
import { buildIntelligencePrompt } from '../intelligence/prompt.ts';
import {
  subjectNoun, copyKindOf, guardKindText, guardReportForKind, storyFitsKind, kindPromptBlock,
  marketPlanForKind, kindCopyKey, kindT, nounKey, isGuardedKind,
} from '../intelligence/kindGuard.ts';
import { VERIFY_V7_KIND_STRINGS } from '../../../scripts/verify-v7-kind-i18n-data.mjs';
import { toLegacy } from '../intelligence/__tests__/fixtures/propertyRegisterFixture.mjs';
import {
  EXTRACT_DBF04E48, EXTRACT_LAND, CODE_DBF04E48, ADDRESS_DBF04E48, ADDRESS_DBF04E48_OLDER, DOC_URL_DBF04E48,
} from '../intelligence/__tests__/fixtures/registerExtractParkingFixture.mjs';
import { EXTRACT_EEEFADA9, ADDRESS_EEEFADA9 } from '../intelligence/__tests__/fixtures/registerExtractsV7Fixture.mjs';

/*
 * v7 (owner, 2026-10-11): "the same approach must work identically for
 * ABSOLUTELY ALL Verify reports … differing by whether the property is a
 * parking space, a land parcel or an apartment." Anchored on production job
 * dbf04e48 (a 12 m² parking space, ავტოსადგომი N17, level 1) and, for the
 * apartment baseline, eeefada9 (79.5 m², apt N4, floor 2).
 */

const browserOfficialFor = (code, appID, raw, url) => ({
  results: [{
    source: 'mygov',
    retrievedAt: '2026-10-11T14:21:20.232Z',
    traversal: { search: { cadastralCode: code, records: [
      { appID, regNumber: '882026631307', webTransact: 'საკუთრების უფლების რეგისტრაცია გარიგების საფუძველზე უძრავ ნივთზე', appRegDate: 1784297143, lastActDate: 1784738347 },
    ] } },
    documents: [{ url, rawText: raw, sourceReference: { recordId: appID, cadastralCode: code, url } }],
  }],
});

/** The parking job's result_json, as stored (the fields the read path uses). */
const parkingResult = () => ({
  assetClass: 'MIXED_OR_UNKNOWN',
  entityType: 'ავტოსადგომი',
  exactUnit: { code: CODE_DBF04E48, verified: false },
  projectProfile: { name: 'Kristian Stiven Street, 18', developer: 'შპს „ჯეო სითი დიღომი“' },
  service176Evidence: [
    { field: 'CADCODE', value: CODE_DBF04E48, provenance: { cadastralCode: CODE_DBF04E48, appID: '35246167' } },
    { field: 'ADDRESS', value: ADDRESS_DBF04E48, provenance: { cadastralCode: CODE_DBF04E48, appID: '35246167' } },
    { field: 'ADDRESS', value: ADDRESS_DBF04E48_OLDER, provenance: { cadastralCode: CODE_DBF04E48, appID: '32012572' } },
  ],
  browserOfficial: browserOfficialFor(CODE_DBF04E48, '35246167', toLegacy(EXTRACT_DBF04E48), DOC_URL_DBF04E48),
});

/* The production report prose of dbf04e48 (logic v5, stored), abridged sentence for sentence. */
const PARKING_SECTIONS = [
  { key: 'SNAPSHOT', title: 'მოკლედ', body: 'თქვენი ზუსტი ობიექტი არის ავტოსადგომი N17, კრისტიან სტივენის ქუჩა N18-ში, პირველ სართულზე. 2026 წლის 22 ივლისის ამონაწერში მესაკუთრედ გიორგი ბლიაძეა მითითებული და საკუთრება ნასყიდობის საფუძველზეა რეგისტრირებული. იმავე ამონაწერში ამ ერთეულზე იპოთეკა, საგადასახადო გირავნობა, ყადაღა, აკრძალვა და მოვალეთა რეესტრის ჩანაწერი რეგისტრირებული არ არის.' },
  { key: 'PROJECT', title: 'პროექტი', body: 'კრისტიან სტივენის ქუჩა N18 ოფიციალურ დოკუმენტებში IV კლასის მრავალბინიან საცხოვრებელ სახლად არის ჩამოყალიბებული. დეველოპერის აღწერით, პროექტში შედის ლიფტი, მიწისზედა პარკინგი, თეთრი კარკასის ბინები, დომოფონი და გამწვანებული ეზო.' },
  { key: 'MARKET', title: 'ბაზარი', body: 'ამ პროექტის, იმავე მისამართისა და იმავე ქუჩის პირდაპირი აქტიური შედარებები საკმარისი რაოდენობით არ ჩანს. ხელმისაწვდომი უახლოესი კონტექსტი მხოლოდ საბურთალოს სხვა მისამართებიდან მოდის და მოიცავს როგორც დიდი ფართობის, ხუთოთახიან ბინას მაღალ სართულზე, ისე საშუალო ზომის სამოთახიან ბინას. ხარისხის მიხედვით განსხვავება აქ მნიშვნელოვანია: დასრულებული და რემონტირებული ბინა, თეთრი ან შავი კარკასი, სართული და ხედი ფასს ცვლის.' },
];
/* What an apartment-template model wrote for parking (the failure the guard exists for). */
const APARTMENT_FLAVOURED = [
  'თქვენი ბინა 12 კვ.მ ფართობისაა და მშენებარე შენობაში მდებარეობს.',
  'ბინის ორი საძინებელი ოთახი ეზოს გადაჰყურებს.',
  'საცხოვრებელი კომფორტი აქ მაღალია.',
];

const parkingPayload = () => ({
  propertyType: 'UNKNOWN',
  report: {
    summary: { label: 'BALANCED', statement: `ავტოსადგომი რეგისტრირებულია მყიდველზე. ${APARTMENT_FLAVOURED[0]}`, highlights: [{ dimension: 'LEGAL_CONTEXT', headline: 'სუფთა რეესტრი', detail: 'ამონაწერში ავტოსადგომზე იპოთეკა არ ფიქსირდება.' }] },
    keyFindings: [
      { finding: 'ზუსტი ერთეული არის ავტოსადგომი N17, პირველი სართული.', whyItMatters: 'ხელშეკრულებაში ეს აღწერა უნდა დარჩეს.' },
      { finding: APARTMENT_FLAVOURED[1], whyItMatters: 'ოჯახისთვის მოსახერხებელია.' },
    ],
    sections: PARKING_SECTIONS,
    finalView: `${APARTMENT_FLAVOURED[2]} ავტოსადგომის სამართლებრივი მდგომარეობა სუფთაა.`,
    propertyStory: { chapters: [{ key: 'TODAY', title: 'დღეს', body: `შენობა მშენებარეა. ${APARTMENT_FLAVOURED[0]}` }] },
  },
});

/* ───────────── the kind, from the register ───────────── */

test('dbf04e48 resolves PARKING from its own register (raw result and sanitized copy), never from the code', () => {
  const k = propertyKindFromResult(parkingResult());
  assert.equal(k.kind, 'PARKING');
  assert.ok(k.basis.some((b) => b.source === 'UNIT_ROW'));
  const { browserOfficial: _b, ...sanitized } = parkingResult();
  assert.equal(propertyKindFromResult(sanitized).kind, 'PARKING');
  const reg = buildPropertyRegister(parkingResult().browserOfficial);
  assert.equal(reg.latest.unitAreaSqm, 12);
  assert.equal(reg.latest.unitFloor, '1');
  assert.equal(reg.latest.unitNumber, '17');
});

/* ───────────── gap 1: the model is told what the property is ───────────── */

test('register facts and the prompt carry the registry kind, the unit area and the parking rules', () => {
  const facts = registerModelFacts(buildPropertyRegister(parkingResult().browserOfficial));
  assert.equal(facts.unitAreaSqm, 12);
  assert.match(facts.unitItemText, /ავტოსადგომი N17/);
  assert.equal(facts.unitFloorOrLevel, '1');
  assert.equal(facts.parcelLandAreaSqm, 1400);

  const rj = parkingResult();
  const kind = propertyKindFromResult(rj);
  const { system, user } = buildIntelligencePrompt(buildEvidencePackage(rj), { register: buildPropertyRegister(rj.browserOfficial) }, 'MIXED_OR_UNKNOWN', { propertyKind: kind });
  assert.match(system, /PROPERTY KIND — REGISTRY-VERIFIED/);
  assert.match(system, /kind=PARKING/);
  assert.match(system, /unitAreaSqm=12/);
  assert.match(system, /level=1/);
  assert.match(system, /Never write ბინა/);
  assert.match(system, /no bedrooms|never mention bedrooms/i);
  assert.equal(JSON.parse(user).propertyKind.kind, 'PARKING');

  // Land, house, commercial, office and ambiguous each get their own rules; an unknown kind asserts nothing.
  assert.match(kindPromptBlock({ kind: 'LAND' }, { landAreaSqm: 850, landFunction: 'არასასოფლო სამეურნეო' }), /LAND PLOT[\s\S]*no building quality[\s\S]*landAreaSqm=850|landAreaSqm=850[\s\S]*LAND PLOT/);
  assert.match(kindPromptBlock({ kind: 'PRIVATE_HOUSE' }), /house and the land separately/i);
  assert.match(kindPromptBlock({ kind: 'COMMERCIAL' }), /commercial use/i);
  assert.match(kindPromptBlock({ kind: 'OFFICE' }), /office use/i);
  assert.match(kindPromptBlock({ kind: 'AMBIGUOUS', explanation: 'PARKING vs APARTMENT' }), /different kinds[\s\S]*PARKING vs APARTMENT|PARKING vs APARTMENT[\s\S]*different kinds/);
  assert.equal(kindPromptBlock({ kind: 'UNKNOWN' }), '');
  assert.equal(kindPromptBlock(null), '');
});

/* ───────────── gap 2: the deterministic post-model guard ───────────── */

test('guard on real parking prose: apartment sentences go, the building\'s flats and the register stay', () => {
  const snapshot = guardKindText(PARKING_SECTIONS[0].body, 'PARKING', 'SNAPSHOT');
  assert.equal(snapshot, PARKING_SECTIONS[0].body, 'nothing apartment-like in the snapshot');
  const project = guardKindText(PARKING_SECTIONS[1].body, 'PARKING', 'PROJECT');
  assert.equal(project, PARKING_SECTIONS[1].body, '"მრავალბინიან" and "თეთრი კარკასის ბინები" describe the building');
  const market = guardKindText(PARKING_SECTIONS[2].body, 'PARKING', 'MARKET');
  assert.doesNotMatch(market, /ბინ|ოთახ/);
  assert.match(market, /პირდაპირი აქტიური შედარებები/);
  for (const s of APARTMENT_FLAVOURED) assert.equal(guardKindText(s, 'PARKING'), '', s);
  // A registered address with a "ბინა N" of ANOTHER unit is not this sentence's subject only when it says so.
  assert.equal(guardKindText('მეზობელი ბინა N4 ამავე სართულზეა.', 'PARKING'), 'მეზობელი ბინა N4 ამავე სართულზეა.');
  // Idempotent.
  assert.equal(guardKindText(market, 'PARKING', 'MARKET'), market);
});

test('guard leaves an apartment and an unsettled kind untouched (the same object)', () => {
  const r = parkingPayload().report;
  for (const k of ['APARTMENT', 'OTHER', 'AMBIGUOUS', 'UNKNOWN', undefined]) {
    assert.equal(guardReportForKind(r, k), r, String(k));
    assert.equal(guardKindText(APARTMENT_FLAVOURED[0], k), APARTMENT_FLAVOURED[0]);
  }
  for (const k of ['PARKING', 'LAND', 'PRIVATE_HOUSE', 'COMMERCIAL', 'OFFICE', 'STORAGE']) assert.ok(isGuardedKind(k), k);
  // A house may have bedrooms; it is still never an apartment.
  assert.equal(guardKindText('სახლს სამი საძინებელი აქვს.', 'PRIVATE_HOUSE'), 'სახლს სამი საძინებელი აქვს.');
  assert.equal(guardKindText('თქვენი ბინა მესამე სართულზეა.', 'PRIVATE_HOUSE'), '');
});

test('read path (stored report): dbf04e48 gets PARKING and a report with no apartment wording about the subject', () => {
  const out = withPropertyRegister(parkingPayload(), parkingResult());
  assert.equal(out.propertyKind.kind, 'PARKING');
  const r = out.report;
  const all = JSON.stringify(r);
  for (const s of APARTMENT_FLAVOURED) assert.ok(!all.includes(s), s);
  assert.equal(r.keyFindings.length, 1);
  assert.match(r.summary.statement, /^ავტოსადგომი რეგისტრირებულია მყიდველზე\.$/);
  assert.equal(r.finalView, 'ავტოსადგომის სამართლებრივი მდგომარეობა სუფთაა.');
  assert.equal(r.propertyStory.chapters[0].body, 'შენობა მშენებარეა.');
  assert.ok(r.sections.find((s) => s.key === 'PROJECT').body.includes('თეთრი კარკასის ბინები'));
  // Re-reading changes nothing (idempotent).
  assert.deepEqual(withPropertyRegister(out, parkingResult()).report, r);
});

/* ───────────── gap 3: deterministic copy names the kind ───────────── */

test('subjectNoun: every kind by case; the apartment forms are the approved ones', () => {
  assert.deepEqual(['nom', 'gen', 'dat', 'on', 'in'].map((c) => subjectNoun('APARTMENT', c)), ['ბინა', 'ბინის', 'ბინას', 'ბინაზე', 'ბინაში']);
  assert.deepEqual(['nom', 'gen', 'on'].map((c) => subjectNoun('PARKING', c)), ['ავტოსადგომი', 'ავტოსადგომის', 'ავტოსადგომზე']);
  assert.deepEqual(['nom', 'gen'].map((c) => subjectNoun('LAND', c)), ['მიწის ნაკვეთი', 'მიწის ნაკვეთის']);
  assert.deepEqual(['nom', 'gen'].map((c) => subjectNoun('PRIVATE_HOUSE', c)), ['სახლი', 'სახლის']);
  assert.equal(subjectNoun('COMMERCIAL', 'on'), 'კომერციულ ფართზე');
  assert.deepEqual(['nom', 'gen'].map((c) => subjectNoun('OFFICE', c)), ['ოფისი', 'ოფისის']);
  assert.deepEqual(['nom', 'gen'].map((c) => subjectNoun('STORAGE', c)), ['სათავსო', 'სათავსოს']);
  for (const k of ['OTHER', 'AMBIGUOUS', 'UNKNOWN']) assert.deepEqual([subjectNoun(k), subjectNoun(k, 'gen')], ['ქონება', 'ქონების']);
  // A report with no registry kind keeps the apartment copy (nothing changes on a guess).
  assert.equal(copyKindOf({}), 'APARTMENT');
  assert.equal(copyKindOf({ propertyKind: { kind: 'PARKING' } }), 'PARKING');
});

test('legal findings: the parking space is named as one, the apartment text is byte-identical', () => {
  const s = withPropertyRegister(parkingPayload(), parkingResult());
  const input = { unitLegalPosition: s.unitLegalPosition, unitIdentity: s.unitIdentity };
  const parking = legalFindings({ ...input, kind: copyKindOf(s) });
  const text = JSON.stringify(parking);
  assert.doesNotMatch(text, /ბინ/);
  assert.match(text, /ავტოსადგომი N17/);
  assert.match(text, /ამ ავტოსადგომს ეხება/);
  assert.match(parking.freshnessNote, /^ავტოსადგომის მონაცემები/);
  // Same input as an apartment: without a kind and with APARTMENT, the output is identical and says ბინა.
  assert.deepEqual(legalFindings(input), legalFindings({ ...input, kind: 'APARTMENT' }));
  assert.match(JSON.stringify(legalFindings(input)), /ბინა N17/);
});

test('buyer assessment: kind-aware for parking, unchanged for an apartment', () => {
  const s = withPropertyRegister(parkingPayload(), parkingResult());
  const a = buildBuyerAssessment(s);
  assert.doesNotMatch(JSON.stringify(a), /ბინ/);
  assert.ok(a.strengths.some((x) => x.startsWith('ავტოსადგომის სამართლებრივი მდგომარეობა')));
  const asApartment = { ...s, propertyKind: undefined };
  const b = buildBuyerAssessment(asApartment);
  assert.ok(b.strengths.includes('ბინის სამართლებრივი მდგომარეობა ამონაწერის თარიღისთვის დატვირთვისგან თავისუფალია.'));
  assert.deepEqual(buildBuyerAssessment({ ...s, propertyKind: { kind: 'APARTMENT', basis: [] } }), b);
  // The model's draft passes the guard too.
  const f = finalBuyerAssessment({ narrative: 'ავტოსადგომი რეესტრში სუფთაა. თქვენი ბინა კომფორტულია.', strengths: ['ბინის ორი საძინებელი'], concerns: [], checks: [] }, s);
  assert.doesNotMatch(JSON.stringify(f), /ბინ|საძინებ/);
  // The cautious stance names the kind; an apartment's stays as approved.
  assert.match(finalConclusion({ strengths: [], concerns: ['x'] }, 'PARKING').stanceText, /ავტოსადგომის სამართლებრივ/);
  assert.match(finalConclusion({ strengths: [], concerns: ['x'] }).stanceText, /ბინის სამართლებრივ/);
  assert.equal(finalConclusion({ strengths: ['a'], concerns: ['ამონაწერში ავტოსადგომზე იპოთეკა ჯერ კიდევ რეგისტრირებულია.'] }, 'PARKING').stance, 'CAUTIOUS');
});

test('i18n: an apartment renders the original key; other kinds a {{noun}} variant in all six locales', () => {
  assert.deepEqual(kindCopyKey('verify_v6s_legal_body', 'APARTMENT'), { key: 'verify_v6s_legal_body', nounKey: null });
  assert.deepEqual(kindCopyKey('verify_v6s_legal_body', 'PARKING'), { key: 'verify_v6s_legal_body_kind', nounKey: 'verify_v7_noun_parking_gen' });
  assert.deepEqual(kindCopyKey('vrx_identity_title', 'LAND'), { key: 'vrx_identity_title_kind', nounKey: null });
  assert.equal(kindCopyKey('some_other_key', 'LAND').key, 'some_other_key');
  const t = (k, v) => `${k}${v ? JSON.stringify(v) : ''}`;
  assert.equal(kindT(t, 'verify_v3_reg_unit_mortgage', 'APARTMENT'), 'verify_v3_reg_unit_mortgage');
  assert.equal(kindT(t, 'verify_v3_reg_unit_mortgage', 'PARKING'), 'verify_v3_reg_unit_mortgage_kind{"noun":"verify_v7_noun_parking_on"}');

  const bundle = readFileSync(new URL('../../i18n/translations.ts', import.meta.url), 'utf8');
  for (const [key, values] of Object.entries(VERIFY_V7_KIND_STRINGS)) {
    assert.equal(values.length, 6, key);
    const holes = (v) => (v.match(/\{\{\w+\}\}/g) ?? []).sort().join(',');
    for (const v of values) assert.equal(holes(v), holes(values[0]), `${key}: ${v}`);
    assert.ok(bundle.includes(`  ${key}: `), `${key} applied to the bundle`);
  }
  for (const g of ['PARKING', 'LAND', 'PRIVATE_HOUSE', 'COMMERCIAL', 'OFFICE', 'STORAGE', 'OTHER']) {
    for (const slot of ['scope', 'gen', 'on']) assert.ok(VERIFY_V7_KIND_STRINGS[nounKey(g, slot)], `${g} ${slot}`);
  }
  assert.equal(VERIFY_V7_KIND_STRINGS.verify_v7_noun_parking_gen[1], 'ავტოსადგომის');
  assert.match(VERIFY_V7_KIND_STRINGS.verify_v6s_legal_body_kind[1], /^\{\{noun\}\} შეძენამდე/);
});

/* ───────────── gap 4: a market of the subject's own kind, or one honest sentence ───────────── */

test('market: apartment default; parking without a parking sample → the honest note; with one → its own market', () => {
  assert.deepEqual(marketPlanForKind('APARTMENT', {}), { mode: 'DEFAULT' });
  assert.deepEqual(marketPlanForKind('UNKNOWN', {}), { mode: 'DEFAULT' });
  // dbf04e48 as stored: 144 RESIDENTIAL listings, no kind gate → never an apartment market.
  const stored = { median: 1500, valuation: { state: 'INSUFFICIENT_EVIDENCE' }, hierarchy: { comparables: [{ pricePerSqm: 1500 }] } };
  assert.deepEqual(marketPlanForKind('PARKING', stored), { mode: 'NOTE', noteKey: 'verify_v7_market_kind_none' });
  const gated = { valuation: { subjectKind: 'PARKING', state: 'INSUFFICIENT_EVIDENCE' }, hierarchy: { comparables: [{ pricePerSqm: 1100 }, { pricePerSqm: 1250 }] } };
  assert.deepEqual(marketPlanForKind('PARKING', gated), { mode: 'MARKET', marketKind: 'PARKING', comparables: 2 });
  assert.equal(marketPlanForKind('LAND', { ...gated, valuation: { subjectKind: 'PARKING' } }).mode, 'NOTE');
  assert.equal(marketPlanForKind('OFFICE', { valuation: { subjectKind: 'COMMERCIAL' }, hierarchy: { comparables: [{}] } }).mode, 'MARKET');
  // The market gate reads the register's kind when no text names it.
  const { entityType: _e, ...noText } = parkingResult();
  assert.equal(subjectMarketFacts(noText).propertyKind, 'PARKING');
  // An apartment keeps the text-based gate (no registry fallback for APARTMENT).
  const apt = { exactUnit: { code: '01.72.14.040.030.01.01.004' }, service176Evidence: [{ field: 'ADDRESS', value: ADDRESS_EEEFADA9, provenance: { cadastralCode: '01.72.14.040.030.01.01.004', appID: '35092451' } }], browserOfficial: browserOfficialFor('01.72.14.040.030.01.01.004', '35092451', toLegacy(EXTRACT_EEEFADA9), null) };
  assert.equal(subjectMarketFacts(apt).propertyKind, undefined);
});

/* ───────────── gap 5: facts card and chapter gating ───────────── */

test('dbf04e48 facts card: parking fields only (area, number, level, owner, extract), no apartment fields', () => {
  const s = withPropertyRegister(parkingPayload(), parkingResult());
  const m = buildPropertyFacts(s);
  assert.equal(m.kind, 'PARKING');
  const keys = m.rows.map((r) => r.key);
  assert.deepEqual(keys.filter((k) => ['kind', 'area', 'unitNumber', 'level', 'owner', 'extractDate'].includes(k)), ['kind', 'area', 'level', 'unitNumber', 'owner', 'extractDate']);
  for (const k of ['floor', 'rooms', 'bedrooms', 'landFunction']) assert.ok(!keys.includes(k), k);
  const v = (k) => m.rows.find((r) => r.key === k)?.value;
  assert.equal(v('area'), '12');
  assert.equal(v('unitNumber'), '17');
  assert.equal(v('level'), '1');
  assert.equal(v('owner'), 'გიორგი ბლიაძე');
  assert.equal(v('extractDate'), '22.07.2026');
  assert.equal(m.rows.find((r) => r.key === 'kind').valueKey, 'verify_v7_facts_kind_parking');
  assert.equal(m.link.kind, 'DOCUMENT');
  assert.doesNotMatch(JSON.stringify(m), /(?<!\d)\d{11}(?!\d)/);
});

test('land facts card: the parcel only; chapters gated for PARKING and LAND', () => {
  const land = withPropertyRegister({ propertyType: 'UNKNOWN', report: null }, {
    exactUnit: { code: '01.00.00.000.000' },
    browserOfficial: browserOfficialFor('01.00.00.000.000', '1', EXTRACT_LAND, null),
  });
  assert.equal(land.propertyKind.kind, 'LAND');
  assert.equal(land.propertyType, 'LAND');
  const m = buildPropertyFacts(land);
  const keys = m.rows.map((r) => r.key);
  assert.ok(keys.includes('landFunction'));
  for (const k of ['floor', 'level', 'unitNumber', 'block', 'registeredState']) assert.ok(!keys.includes(k), k);
  assert.equal(m.rows.find((r) => r.key === 'area').value, '850');

  const p = sectionsFor('PARKING');
  assert.equal(p.apartmentMarket, false);
  assert.equal(p.unitUtilities, false);
  assert.equal(p.livingLocation, false);
  const l = sectionsFor('LAND');
  assert.equal(l.buildingSpecs, false);
  assert.equal(l.projectTeam, false);
  // The report wires every gate (source premise: VerifyReport.tsx).
  const src = readFileSync(new URL('../../components/verify/VerifyReport.tsx', import.meta.url), 'utf8');
  for (const needle of ['ks.unitUtilities ? <UtilitiesCard', 'ks.buildingSpecs && specGroups', 'ks.livingLocation ? <LocationLiving', 'people: showTeam && !!(', 'marketPlanForKind(', "marketPlan.mode === 'NOTE'", 'kind={copyKind}']) {
    assert.ok(src.includes(needle), needle);
  }
  // The team chapter follows the kind (a plot has none of its own), except that official TAS
  // cases naming a project team on the plot always show it (prod 9d96c8a7, LAND, 16 participants).
  assert.match(src, /const showTeam = ks\.projectTeam \|\| teamV2Groups\.length > 0;/);
  assert.ok(src.indexOf('const teamV2Groups = teamGroupsV2(synthesis.projectTeamV2);') < src.indexOf('const showTeam ='), 'the team groups exist before the gate reads them');
});

/* ───────────── gap 6: the stored story on rebuild ───────────── */

test('keepStoryOnRebuild: a parking space keeps only a story that fits its kind', () => {
  const chapters = (extra) => [
    { key: 'EARLIEST', title: 'დასაწყისი', body: 'ნაკვეთზე პირველი საქმე 2012 წელს შევიდა.' },
    { key: 'APPROVALS', title: 'ნებართვები', body: 'მრავალბინიანი სახლის პროექტი 2023 წელს შეთანხმდა.' },
    { key: 'TODAY', title: 'დღეს', body: `შენობა მშენებარეა.${extra}` },
  ];
  const prev = (extra) => ({ _logicVersion: 6, report: { propertyStory: { chapters: chapters(extra) } } });
  const fresh = { chapters: [{ key: 'TODAY', title: 'დღეს', body: 'ავტოსადგომი N17 პირველ სართულზეა.' }] };
  const opts = (kind) => ({ autoUpgrade: true, evolution: [], kind });

  // Apartment-flavoured stored story of a parking space: the fresh, kind-aware one wins.
  assert.equal(keepStoryOnRebuild(prev(' თქვენი ბინა მესამე სართულზეა.'), fresh, opts('PARKING')).chapters[0].body, 'ავტოსადგომი N17 პირველ სართულზეა.');
  assert.equal(storyFitsKind(chapters(' თქვენი ბინა მესამე სართულზეა.'), 'PARKING'), false);
  // A story that fits is kept.
  assert.equal(keepStoryOnRebuild(prev(''), fresh, opts('PARKING')).chapters.length, 3);
  // An apartment, and an unknown kind, keep the stored story as before.
  assert.equal(keepStoryOnRebuild(prev(' თქვენი ბინა მესამე სართულზეა.'), fresh, opts('APARTMENT')).chapters.length, 3);
  assert.equal(keepStoryOnRebuild(prev(' თქვენი ბინა მესამე სართულზეა.'), fresh, { autoUpgrade: true, evolution: [] }).chapters.length, 3);
});
