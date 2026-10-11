// P0 regression, job 8ba97da9 (01.18.06.019.055.03.01.601) — SANITIZED fixture.
//
//   (a) identity: the NAPR extract for the exact unit verifies it; the unit,
//       its parent parcel, building/block, project and ownership stay apart;
//       verified unit-level evidence is never downgraded.
//   (b) register: an application to terminate a mortgage is not a registered
//       cancellation; a suspension is not a grant; every conclusion is as of
//       its extract's date, scoped to the exact unit.
//   (c) TAS: cases in FILING order; the two newest cases; a permit (even an
//       amended one) is never commissioning; decision 7839183 is dated and read
//       from its own record, never from another case's reference.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CODE, PARCEL, unit601Result, mygovResult, DECISION_SUSPENDED, EXTRACT_1708, EXTRACT_2408 } from '../intelligence/__tests__/fixtures/unit601Fixture.mjs';
import { buildPropertyRegister, parseDecision, unitLegalPosition, reconcileText, rulesFrom, registerModelFacts } from '../intelligence/propertyRegister.ts';
import { buildUnitIdentity, unitVerification, effectiveExactUnit, officialUnitOverlay } from '../intelligence/unitIdentity.ts';
import { buildTasIntelligence, officialHistoryView } from '../intelligence/tasIntelligence.ts';
import { buildCaseChronology, latestCasesByFiling, permitTerm, plausibleBlock, actIssueDates } from '../intelligence/tasChronology.ts';
import { withPropertyRegister } from '../intelligence/registerEnrichment.ts';
import { computeSections } from '../sections.ts';
import { parcelRelation } from '../cadastral.ts';
import { buildIntelligencePrompt } from '../intelligence/prompt.ts';
import { buildEvidencePackage } from '../intelligence/evidencePackage.ts';

const NOW = '2026-10-11T07:07:57.383Z';
const find = (snap, id) => snap.sections.find((s) => s.id === id);

/* ───────────── (a) exact unit vs parent parcel ───────────── */

test('identity: the NAPR extract for the exact code verifies the unit; parcel, building, project and ownership stay apart', () => {
  const r = unit601Result();
  const id = buildUnitIdentity(r);
  assert.equal(id.exactUnit.code, CODE);
  assert.equal(id.exactUnit.verified, true);
  assert.equal(id.exactUnit.basis, 'NAPR_EXTRACT');
  assert.equal(id.exactUnit.scope, 'EXACT_UNIT');
  assert.deepEqual([id.exactUnit.block, id.exactUnit.floor, id.exactUnit.apartment, id.exactUnit.areaSqm], ['ც', '6', '601', 94.1]);
  assert.equal(id.exactUnit.evidenceDate, '2026-08-24T08:35:20');
  assert.equal(id.exactUnit.observedAt, '2026-10-11T06:41:47.972Z');
  // The parcel is the code's first five groups; land area/function are the PARCEL's.
  assert.equal(id.parentParcel.code, PARCEL);
  assert.equal(id.parentParcel.scope, 'PARENT_PARCEL');
  assert.equal(id.parentParcel.landAreaSqm, 2145);
  assert.deepEqual([id.building.groupCode, id.building.block], ['03', 'ც']);
  // Project/developer are research identity, never registry facts.
  assert.equal(id.project.source, 'RESEARCH_IDENTITY');
  // Ownership: current as of the extract, history with its own dates.
  assert.equal(id.ownership.current.asOf, '2026-08-24T08:35:20');
  assert.equal(id.ownership.current.registeredOn, '2026-08-17');
  assert.deepEqual(id.ownership.history.map((h) => [h.owners[0].kind, h.registeredOn]), [['COMPANY', '2024-09-09'], ['PERSON', '2026-08-17']]);
  assert.equal(id.ownership.history[0].owners[0].companyId, '404670272');
  assert.ok(!JSON.stringify(id).includes('00000000000'), 'no personal number');
});

test('identity: PROPERTY section is VERIFIED and never notes UNIT_NOT_INDEPENDENTLY_CONFIRMED when the extract was read', () => {
  const snap = computeSections({ result: unit601Result(), status: 'COMPLETE', stage: 'COMPLETE', now: () => Date.parse(NOW) });
  const p = find(snap, 'PROPERTY');
  assert.equal(p.maturity, 'VERIFIED');
  assert.ok(!p.notes.includes('UNIT_NOT_INDEPENDENTLY_CONFIRMED'));
});

test('identity: the customer report (no browserOfficial) still shows the unit as verified, so its rights are not parcel-level', () => {
  const { browserOfficial: _b, ...customer } = unit601Result();
  const rel = parcelRelation(customer);
  assert.equal(rel.unitCode, CODE);
  assert.equal(rel.parcelCode, PARCEL);
  assert.equal(rel.unitVerified, true);
});

test('identity: verified evidence is never downgraded, and nothing official means not verified', () => {
  const bare = { exactUnit: { code: CODE, verified: true } };
  assert.equal(unitVerification(bare).verified, true);
  assert.equal(effectiveExactUnit(bare).verified, true);
  assert.equal(unitVerification({ exactUnit: { code: CODE, verified: false } }).verified, false);
  // A record for ANOTHER building's unit 601 of the same parcel is not this unit.
  const near = { exactUnit: { code: CODE, verified: false }, service176Evidence: [{ field: 'CADCODE', value: '01.18.06.019.055.01.01.601' }] };
  assert.equal(unitVerification(near).verified, false);
  assert.equal(parcelRelation(near).unitVerified, false);
});

/* ───────────── (b) ownership + mortgage chronology ───────────── */

test('register: a suspension that names what is needed "for the request to be satisfied" is a SUSPENSION', () => {
  const d = parseDecision(DECISION_SUSPENDED, '35356992');
  assert.equal(d.outcome, 'SUSPENDED');
  assert.equal(d.number, '882026724195-03');
  assert.equal(d.date, '2026-08-18');
});

test('register: termination 882026724195 — filed 13.08, suspended 18.08, registered 24.08; the mortgage was last listed 17.08', () => {
  const reg = buildPropertyRegister(unit601Result().browserOfficial);
  const t = reg.proceedings.find((p) => p.applicationNumber === '882026724195');
  assert.deepEqual(t.decisions.map((d) => [d.number, d.date, d.outcome]), [
    ['882026724195-03', '2026-08-18', 'SUSPENDED'],
    ['882026724195-06', '2026-08-24', 'SATISFIED'],
  ]);
  assert.equal(t.decisionNumber, '882026724195-06', 'the FINAL decision, never the suspension');
  assert.equal(reg.removedMortgages.length, 1);
  const m = reg.removedMortgages[0];
  assert.equal(m.agreementNumber, 'NCAH000744921');
  assert.equal(m.lastSeenAt, '2026-08-17T15:59:48', 'the LAST extract listing it, not the first');
  assert.deepEqual(m.removedBy, { applicationNumber: '882026724195', decisionNumber: '882026724195-06', decisionDate: '2026-08-24' });

  const pos = unitLegalPosition(reg);
  assert.equal(pos.scope, 'EXACT_UNIT');
  assert.equal(pos.evidence.extractIssuedAt, '2026-08-24T08:35:20');
  assert.equal(pos.mortgages.state, 'NONE_REGISTERED');
  assert.equal(pos.mortgages.asOf, '2026-08-24T08:35:20');
  const h = pos.mortgages.history[0];
  assert.equal(h.lifecycle, 'CANCELLATION_REGISTERED');
  assert.deepEqual(h.steps.map((s) => [s.date, s.step]), [
    ['2023-12-19', 'MORTGAGE_REGISTERED'],
    ['2026-08-13', 'TERMINATION_APPLIED'],
    ['2026-08-18', 'SUSPENDED'],
    ['2026-08-24', 'CANCELLATION_REGISTERED'],
  ]);
  assert.equal(h.lastSeenInExtractOf, '2026-08-17T15:59:48');
  assert.equal(h.absentFromExtractOf, '2026-08-24T08:35:20');
  assert.deepEqual(pos.restrictions, { taxLien: 'NONE', seizure: 'NONE', debtorRegistry: 'NONE', asOf: '2026-08-24T08:35:20' });
  assert.deepEqual(pos.ownershipHistory.map((o) => o.registeredOn), ['2024-09-09', '2026-08-17']);
  assert.deepEqual(pos.notCovered, ['COMPANY_OBLIGATIONS', 'PROJECT_FINANCING', 'PARENT_PARCEL_ENCUMBRANCES']);
  // The model receives the chronology, scoped.
  const facts = registerModelFacts(reg);
  assert.equal(facts.scope, 'EXACT_UNIT');
  assert.equal(facts.mortgageChronology[0].lifecycle, 'CANCELLATION_REGISTERED');
});

test('register: an application (even a suspended one) is not a cancellation — the mortgage is still registered', () => {
  // Only the 17.08 extract and the suspension are held: no grant, no later extract.
  const bo = { results: [{ ...mygovResult(), documents: mygovResult().documents.filter((d) => d.rawText === EXTRACT_1708 || d.rawText === DECISION_SUSPENDED) }] };
  const reg = buildPropertyRegister(bo);
  assert.equal(reg.latest.issuedAt, '2026-08-17T15:59:48');
  assert.equal(reg.currentMortgages.length, 1);
  const pos = unitLegalPosition(reg);
  assert.equal(pos.mortgages.state, 'ACTIVE');
  assert.equal(pos.mortgages.history[0].lifecycle, 'TERMINATION_SUSPENDED');
  assert.ok(!pos.mortgages.history[0].steps.some((s) => s.step === 'CANCELLATION_REGISTERED'));
  assert.deepEqual(pos.openProceedings.map((p) => [p.applicationNumber, p.lastOutcome]), [['882026724195', 'SUSPENDED']]);
  // Prose claiming it ended is removed; prose saying an application was filed stays.
  const rules = rulesFrom(reg);
  assert.equal(reconcileText('საქართველოს ბანკის იპოთეკა შეწყდა 2026 წლის აგვისტოში.', rules), '');
  const filed = 'ბანკმა 2026 წლის 13 აგვისტოს იპოთეკის შეწყვეტის განცხადება შეიტანა.';
  assert.equal(reconcileText(filed, rules), filed);
});

test('register: a grant after the extract is said with both dates, never as "no mortgage in the extract"', () => {
  // Every decision held, but the 24.08 extract not (and the 2024 one, which is older anyway).
  const bo = { results: [{ ...mygovResult(), documents: mygovResult().documents.filter((d) => d.rawText !== EXTRACT_2408) }] };
  const reg = buildPropertyRegister(bo);
  assert.equal(reg.latest.issuedAt, '2026-08-17T15:59:48');
  const pos = unitLegalPosition(reg);
  assert.equal(pos.mortgages.state, 'ACTIVE', 'as of the 17.08 extract');
  assert.equal(pos.mortgages.history[0].lifecycle, 'CANCELLATION_REGISTERED_AFTER_EXTRACT');
  assert.equal(pos.freshExtractAdvised, true);
});

test('rights statement is dated by the extract (2026-08-24) and scoped to the exact unit, never by when the job ran', () => {
  const o = officialUnitOverlay(unit601Result());
  assert.equal(o.exactUnit.verified, true);
  assert.equal(o.rightsAndRestrictions.asOf, '2026-08-24T08:35:20');
  assert.equal(o.rightsAndRestrictions.observedAt, '2026-10-11T07:07:56.134Z');
  assert.deepEqual(o.rightsAndRestrictions.scope, { level: 'EXACT_UNIT', cadastralCode: CODE });
  assert.match(o.rightsAndRestrictions.statement, /2026-08-24/);
  assert.match(o.rightsAndRestrictions.statement, /01\.18\.06\.019\.055\.03\.01\.601/);
  assert.ok(!o.rightsAndRestrictions.statement.includes('2026-10-11'));
  assert.ok(!/მიმდინარე/.test(o.rightsAndRestrictions.statement), 'never "current"');
  // With only the 17.08 extract (mortgage listed), "none found" is a contradiction.
  const older = unit601Result();
  older.browserOfficial.results[1].documents = older.browserOfficial.results[1].documents.filter((d) => d.title !== 'ამონაწერი საჯარო რეესტრიდან' || d.rawText === EXTRACT_1708);
  assert.equal(officialUnitOverlay(older).rightsAndRestrictions.status, 'RESTRICTION_IDENTIFIED');
});

test('reconcile: "the unit was not independently verified" is removed once its extract was read', () => {
  const rules = rulesFrom(buildPropertyRegister(unit601Result().browserOfficial));
  assert.equal(reconcileText('კონკრეტული ბინა დამოუკიდებლად ვერ დადასტურდა.', rules), '');
  assert.equal(reconcileText('The exact unit has not been independently verified.', rules), '');
  const commissioning = 'ბინის ექსპლუატაციაში მიღება ვერ დადასტურდა.';
  assert.equal(reconcileText(commissioning, rules), commissioning, 'an unrelated "could not be confirmed" stays');
});

/* ───────────── (c) TAS chronology ───────────── */

test('TAS: cases are ordered by FILING date whatever their list order or id; the two newest are AR11161121 and AR11148112', () => {
  const chron = buildCaseChronology(unit601Result(), NOW);
  assert.deepEqual(chron.map((c) => [c.caseRef, c.filedOn]), [
    ['AR11034439', '2024-05-14'], ['AR11084312', '2025-04-03'], ['AR11101896', '2025-07-29'], ['AR11148112', '2026-06-17'], ['AR11161121', '2026-09-17'],
  ]);
  const [newest, second] = latestCasesByFiling(chron, 2);
  assert.equal(newest.caseRef, 'AR11161121');
  assert.equal(newest.stage, 'SUBMITTED', 'filed, no response yet — never "approved"');
  assert.equal(newest.scope, 'PARENT_PARCEL');
  assert.deepEqual(newest.attachments, { total: 4, read: 2, scanOnly: 1, unsupported: 1 });
  assert.deepEqual(newest.metrics.map((m) => m.value), ['5242.3', '22.75']);
  assert.equal(newest.deadline, null, 'no deadline is invented');
  assert.equal(second.caseRef, 'AR11148112');
  assert.equal(second.stage, 'RESPONSE_UNREAD');
  assert.deepEqual(second.unreadResponses, [{ number: '7971330', publishedOn: '2026-06-22' }]);
  // A lower id filed later still sorts by its filing date.
  const r = unit601Result();
  r.browserOfficial.results[0].tasApi.cases.push({ documentId: '1000001', registrationNumber: 'AR11000001', date: '2026-10-01T00:00:00.000Z', motions: [], attachments: [], values: [] });
  assert.equal(latestCasesByFiling(buildCaseChronology(r, NOW), 1)[0].caseRef, 'AR11000001');
});

test('TAS: pending applications carry their real stage (RESPONSE_UNREAD is not "under review")', () => {
  const v = officialHistoryView(buildTasIntelligence(unit601Result(), NOW));
  const byRef = Object.fromEntries(v.pendingApplications.map((p) => [p.caseRef, p]));
  assert.equal(byRef.AR11161121.stage, 'SUBMITTED');
  assert.equal(byRef.AR11148112.stage, 'RESPONSE_UNREAD');
  assert.deepEqual(byRef.AR11148112.lastResponse, { number: '7971330', publishedOn: '2026-06-22' });
  assert.deepEqual(v.latestCases.map((c) => c.caseRef), ['AR11161121', 'AR11148112']);
});

test('TAS: a permit — even an amended one — is never construction completion or commissioning', () => {
  const t = buildTasIntelligence(unit601Result(), NOW);
  const claims = Object.fromEntries(t.legalClaims.map((c) => [c.key, c.status]));
  assert.equal(claims.PERMIT_ISSUED, 'CONFIRMED');
  assert.equal(claims.CONSTRUCTION_COMPLETED, 'NOT_VERIFIED');
  assert.equal(claims.COMMISSIONING_APPLIED, 'NOT_VERIFIED');
  assert.equal(claims.COMMISSIONING_APPROVED, 'NOT_VERIFIED');
  assert.notEqual(t.officialStatus.state, 'COMMISSIONED');
  // A COMMISSIONED label without the operative act is not commissioning.
  const r = unit601Result();
  const c = r.browserOfficial.results[0].tasApi.cases.find((x) => x.registrationNumber === 'AR11101896');
  c.motions.push({ motionId: '9', date: '2026-04-01T00:00:00.000Z', response: 'PDF', decision: { number: '9', outcome: 'COMMISSIONED', evidence: 'შენობის ექსპლუატაციაში მიღების წესის შესაბამისად', issueDate: null, validUntil: null } });
  const chron = buildCaseChronology(r, NOW);
  assert.ok(!chron.some((x) => x.effect === 'COMMISSIONED' || x.decisions.some((d) => d.effect === 'COMMISSIONED')));
  assert.equal(buildTasIntelligence(r, NOW).officialStatus.state, 'PERMITTED');
});

test('decision 7839183: an amended permit published 2026-03-11, term 2026-03-11 → 2028-03-11, superseding 7496274 — dated from its own record', () => {
  const chron = buildCaseChronology(unit601Result(), NOW);
  const c = chron.find((x) => x.caseRef === 'AR11101896');
  assert.equal(c.filedOn, '2025-07-29');
  assert.equal(c.stage, 'DECIDED');
  assert.equal(c.effect, 'PERMIT_FOR_CORRECTED_PROJECT');
  assert.equal(c.deficiencyNotices, 2);
  const d = c.decisions.find((x) => x.number === '7839183');
  assert.equal(d.date, '2026-03-11');
  assert.equal(d.dateBasis, 'RESPONSE_PUBLISHED');
  assert.deepEqual(d.term, { from: '2026-03-11', until: '2028-03-11' });
  assert.equal(d.correctedProject, true);
  assert.deepEqual(c.supersedesPermit, { caseRef: 'AR11084312', decisionNumber: '7496274', date: '2025-05-30' });
  const v = officialHistoryView(buildTasIntelligence(unit601Result(), NOW));
  assert.equal(v.status.decisionNumber, '7839183');
  assert.equal(v.status.validUntil, '2028-03-11');
});

test('decision dates: the act\'s own issue date only when consistent; never a date another case cites', () => {
  const r = unit601Result();
  r.browserOfficial.results[0].documents = [
    { rawText: '[2026-03-11 · motion · response]\nDECISION PERMIT N 7839183\n\nგაცემის თარიღი: 10/03/2026გაცნობის თარიღი: -' },
    // Inconsistent: "issued" after it was published — ignored.
    { rawText: 'DECISION PERMIT N 7496274\nგაცემის თარიღი: 30/06/2026' },
    // Another case citing 7152431 with a date is not the act's header.
    { rawText: 'შეთანხმებული პროექტის ბრძანების ნომერი.: 7152431 .შეთანხმებული პროექტის ბრძანების თარიღი.: 01.01.2020' },
  ];
  assert.equal(actIssueDates(r).get('7839183'), '2026-03-10');
  assert.equal(actIssueDates(r).has('7152431'), false);
  const chron = buildCaseChronology(r, NOW);
  const d = (n) => chron.flatMap((c) => c.decisions).find((x) => x.number === n);
  assert.deepEqual([d('7839183').date, d('7839183').dateBasis, d('7839183').publishedOn], ['2026-03-10', 'ACT_ISSUE_DATE', '2026-03-11']);
  assert.deepEqual([d('7496274').date, d('7496274').dateBasis], ['2025-05-30', 'RESPONSE_PUBLISHED']);
  assert.deepEqual([d('7152431').date, d('7152431').dateBasis], ['2024-07-26', 'RESPONSE_PUBLISHED']);
});

test('TAS: an applicant\'s home address is never a building block (privacy) and permit terms parse only complete dates', () => {
  const t = buildTasIntelligence(unit601Result(), NOW);
  const blocks = t.legalClaims.flatMap((c) => c.basis.map((b) => b.block));
  assert.ok(!blocks.some((b) => b && /ბინა/.test(b)));
  assert.equal(plausibleBlock('2, ბინა 34'), null);
  assert.equal(plausibleBlock('ც'), 'ც');
  assert.equal(plausibleBlock('N3'), 'N3');
  assert.deepEqual(permitTerm('3. მშენებლობის ვადა განისაზღვროს 2026 წლის 11 მარტიდან 2028 წლის 11 მარტის'), { from: '2026-03-11', until: '2028-03-11' });
  assert.deepEqual(permitTerm('3. მშენებლობის ვადა განისაზღვროს 2026 წლის 11 მარტიდან 2028 წლის'), { from: '2026-03-11', until: null });
  assert.equal(permitTerm('გაიცეს მშენებლობის ნებართვა'), null);
});

/* ───────────── the persisted report, corrected on read ───────────── */

test('read path: a stored v3 payload gains the identity model, the legal position and the corrected chronology without a rebuild', () => {
  const stored = {
    report: { summary: { statement: 'კონკრეტული ბინა დამოუკიდებლად ვერ დადასტურდა. ბინა რეგისტრირებულია.', highlights: [] }, keyFindings: [], sections: [] },
    officialHistory: {
      status: { state: 'PERMITTED', since: '2026-03-11', caseRef: 'AR11101896', decisionNumber: '7839183', validUntil: null, conclusive: false, caveats: [], pendingCount: 0 },
      legal: [{ key: 'PERMIT_ISSUED', status: 'CONFIRMED', basis: [{ caseRef: 'AR11101896', decisionNumber: '7839183', date: '2026-03-11', block: '2, ბინა 34' }] }],
      milestones: [], evolution: [],
      pendingApplications: [{ caseRef: 'AR11148112', date: '2026-06-17', status: 'UNDER_REVIEW' }],
    },
    _logicVersion: 3,
  };
  const out = withPropertyRegister(stored, unit601Result(), { completedAt: NOW });
  assert.equal(out.unitIdentity.exactUnit.verified, true);
  assert.equal(out.unitLegalPosition.mortgages.history[0].lifecycle, 'CANCELLATION_REGISTERED');
  assert.ok(!JSON.stringify(out.officialHistory.legal).includes('ბინა 34'), 'no applicant address in the legal basis');
  assert.equal(out.officialHistory.status.validUntil, '2028-03-11');
  assert.deepEqual(out.officialHistory.latestCases.map((c) => c.caseRef), ['AR11161121', 'AR11148112']);
  assert.equal(out.officialHistory.pendingApplications.find((p) => p.caseRef === 'AR11148112').stage, 'RESPONSE_UNREAD');
  assert.equal(out.report.summary.statement, 'ბინა რეგისტრირებულია.');
  assert.ok(!JSON.stringify(out).includes('00000000000'));
});

test('prompt: scope/date rules, the no-contradiction rule and the filing-order chronology reach the model', () => {
  const r = unit601Result();
  const pkg = buildEvidencePackage(r, { now: NOW });
  const out = buildIntelligencePrompt(pkg, undefined, 'APARTMENT_IN_PROJECT', { unitIdentity: buildUnitIdentity(r) });
  const all = `${out.system}\n${out.user}`;
  assert.match(all, /SCOPE, SOURCE AND DATE OF EVERY LEGAL CONCLUSION/);
  assert.match(all, /TERMINATION_SUSPENDED all mean the mortgage IS STILL REGISTERED/);
  assert.match(all, /A permit is never construction completion and never commissioning/);
  assert.match(all, /NO CONTRADICTIONS/);
  assert.match(all, /"caseChronology"/);
  assert.match(all, /"unitIdentity"/);
  assert.match(all, /PERMIT_FOR_CORRECTED_PROJECT/);
});
