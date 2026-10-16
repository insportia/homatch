// Verify v6: the project's evolution reconstructed from the TAS cases, the
// decided-but-listed-as-pending orders, the four status tracks, the legal
// findings scope by scope, the technical cards, the final conclusion and the
// editorial pass. Fixtures from job eeefada9 (Kristian Stiven St 18, Digomi)
// and job 8ba97da9 (Krtsanisi St 6, unit 601), sanitized.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import * as E from './fixtures/jobEeeEvolution.mjs';
import * as V from './fixtures/job601Narrative.mjs';
import { extractEvolution, evolutionView, openApplications, fileRevisionDate, readActBlock, kaFromDay, kaUntilDay } from '../intelligence/projectEvolution.ts';
import { buildCaseChronology } from '../intelligence/tasChronology.ts';
import { extractProjectSignals, projectStory } from '../intelligence/projectStory.ts';
import { legalFindings } from '../intelligence/legalStatus.ts';
import { buildBuyerAssessment, readBuyerAssessment, finalConclusion, assessmentProblems, finalBuyerAssessment } from '../intelligence/buyerAssessment.ts';
import { readTechnicalCards, explainTechnical } from '../intelligence/technicalExplained.ts';
import { stripCaseIdentifiers, nearDuplicate } from '../intelligence/editorial.ts';
import { polishReport } from '../intelligence/report.ts';
import { VERIFY_V6_STORY_STRINGS } from '../../../scripts/verify-v6-story-i18n-data.mjs';

const NOW = '2026-10-11T00:00:00Z';
const roundTrip = (x) => JSON.parse(JSON.stringify(x));
const RAW_EEE = E.rawResultEee();
const SIG_EEE = roundTrip(extractProjectSignals(RAW_EEE));
const EVO_EEE = evolutionView({ history: E.HISTORY_EEE, evolution: SIG_EEE.evolution });
const STORY_EEE = projectStory({ history: E.HISTORY_EEE, signals: SIG_EEE, unitIdentity: E.UNIT_IDENTITY });
const SIG_601 = roundTrip(extractProjectSignals(V.rawResult601()));
const STORY_601 = projectStory({ history: V.HISTORY_601, signals: SIG_601 });

const proseOf = (steps) => steps.flatMap((s) => [s.title, s.what, s.requested, s.changed, s.final, s.impact, s.unverified, ...s.components]).filter(Boolean).join('\n');

/* ── the published acts decide what the classifier could not ─────────────── */

test('chronology: AR11136621 and AR11143236 are decided amendments, 7761945 issued the permit with the approval', () => {
  const ch = Object.fromEntries(buildCaseChronology(RAW_EEE, NOW).map((c) => [c.caseRef, c]));
  for (const [ref, number, date] of [['AR11136621', '7869341', '2026-04-02'], ['AR11143236', '7930086', '2026-05-21'], ['AR11095988', '7528083', '2025-06-24']]) {
    assert.equal(ch[ref].stage, 'DECIDED', ref);
    assert.equal(ch[ref].effect, 'ACT_AMENDED', ref);
    assert.deepEqual(ch[ref].decisions.map((d) => [d.number, d.date, d.dateBasis]), [[number, date, 'ACT_ISSUE_DATE']], ref);
    assert.equal(ch[ref].unreadResponses.length, 0, ref);
  }
  assert.equal(ch.AR11143236.deficiencyNotices, 1, 'the authority notice is a deficiency, not a decision');
  assert.equal(ch.AR11110027.effect, 'PERMIT_FOR_CORRECTED_PROJECT');
  assert.equal(ch.AR11110027.supersedesPermit?.decisionNumber, '7463932');
  assert.equal(ch.AR195157.effect, 'PERMIT');
});

test('acts: requested and fixed area figures, the summation error, the amended order', () => {
  const byRef = Object.fromEntries(SIG_EEE.evolution.map((e) => [e.caseRef, e]));
  const a = byRef.AR11136621.acts.find((x) => x.number === '7869341');
  assert.equal(a.result, 'CONSENT');
  assert.deepEqual(a.amends, { number: '7761945', date: '2025-12-30' });
  assert.deepEqual(a.areaChanges.find((x) => x.key === 'total'), { key: 'total', from: 3652.4, requested: 3708.2, fixed: 3676.4 });
  assert.equal(a.summationError, true);
  const b = byRef.AR11143236.acts.find((x) => x.number === '7930086');
  assert.deepEqual(b.areaChanges.map((x) => [x.key, x.from, x.fixed]), [['summer', 500.4, 532.2], ['auxiliary', 10.2, 13.2], ['total', 3676.4, 3711.2]]);
  assert.ok(byRef.AR11143236.acts.find((x) => x.number === '7924530').reasons.includes('AUTHORITY'));
  assert.deepEqual(byRef.AR11095988.acts[0].permitTerms, [{ decisionNumber: '7463932', until: '2026-09-30' }]);
  assert.ok(byRef.AR11110027.acts[0].reasons.includes('OWNER_CONSENT'));
  assert.deepEqual(byRef.AR11110027.stages, ['პროექტის შეთანხმება', 'მშენებლობის ნებართვა']);
  assert.ok(byRef.AR11078892.acts[0].correctionQuotes.some((q) => /6-5 ღერძებში კორექტირების შედეგად გაჩენილი კედელი/.test(q)));
  assert.equal(readActBlock(['no act here'], null), null);
});

test('drawing sets: revisions read from file names, never invented years, old and new montage', () => {
  const byRef = Object.fromEntries(SIG_EEE.evolution.map((e) => [e.caseRef, e]));
  const facades = byRef.AR11022993.components.find((c) => c.component === 'FACADES');
  assert.deepEqual(facades.revisions, ['2024-03-12', '2024-04-30', '2024-05-27', '2024-05-31', '2024-06-03', '2024-06-06']);
  assert.deepEqual(byRef.AR11110027.components.find((c) => c.component === 'FACADES').revisions, ['2025-12-18', '2025-12-27']);
  assert.equal(byRef.AR11022993.storeys, 7);
  assert.equal(byRef.AR11078892.correctionFiles, true);
  // A file reused from an earlier application keeps its own year.
  assert.equal(fileRevisionDate('გენგემა+14.03.dwg', '2025-09-23', '2025-12-30'), '2025-03-14');
  assert.equal(fileRevisionDate('ფასადები 27,12.pdf', '2025-09-23', '2025-12-30'), '2025-12-27');
  assert.equal(fileRevisionDate('01.72.14.040.030 - sqema.pdf', '2024-03-12'), null);
  assert.equal(fileRevisionDate('ფოტო.pdf', '2024-03-12'), null);
  const files = SIG_EEE.evolution.flatMap((e) => e.components.flatMap((c) => c.files));
  assert.ok(files.every((f) => !f.url || /^https:\/\/docs\.tbilisi\.gov\.ge\/DownloadServlet\?/.test(f.url)));
  const m = SIG_601.evolution.find((e) => e.caseRef === 'AR11161121');
  assert.ok(m.components.length > 0);
});

/* ── the evolution story ─────────────────────────────────────────────── */

test('evolution: concept, first permit, returned design, conditions, design, permits, changes and corrected figures', () => {
  const kinds = EVO_EEE.steps.map((s) => s.kind);
  assert.deepEqual(kinds, ['EARLY', 'PERMIT', 'RETURNED', 'CONDITIONS', 'EARLY', 'DESIGN_APPROVED', 'PERMIT', 'EARLY', 'DESIGN_CHANGE', 'PERMIT', 'FIGURES_CORRECTED', 'DESIGN_CHANGE', 'FIGURES_CORRECTED', 'FIGURES_CORRECTED']);
  const s = Object.fromEntries(EVO_EEE.steps.map((x) => [x.id, x]));
  assert.match(s['permit-AR195157'].what, /ინდივიდუალური საცხოვრებელი სახლის/);
  assert.match(s['permit-AR195157'].what, /2013 წლის 1 იანვრიდან 2014 წლის 1 იანვრამდე/);
  assert.match(s['permit-AR195157'].unverified, /არ ჩანს, აშენდა თუ არა/);
  assert.match(s['quiet-AR1137104'].changed, /რეგულირების ხაზს სცდებოდა/);
  assert.equal(s['approval-AR1980594'].kind, 'CONDITIONS');
  assert.match(s['approval-AR11022993'].title, /7-სართულიანი/);
  assert.match(s['permit-AR11110027'].changed, /მესაკუთრეების, მომავალი მესაკუთრეებისა და იპოთეკარების თანხმობა/);
  assert.equal(s['permit-AR11110027'].decidedOn, '2025-12-30');
  assert.match(s['figures-AR11136621'].changed, /3 676\.4 მ²-ით განსაზღვრა, ნაცვლად მოთხოვნილი 3 708\.2 მ²-ისა/);
  assert.match(s['figures-AR11143236'].requested, /უფლებამოსილების/);
  assert.match(s['permit-AR11087185'].what, /2026 წლის 30 სექტემბრამდე/);
  assert.ok(EVO_EEE.discoveries && /2012 წლიდან/.test(EVO_EEE.discoveries) && /2-ჯერ შეიცვალა/.test(EVO_EEE.discoveries));
  assert.equal(EVO_EEE.latest.date, '2025-12-30');
  assert.match(EVO_EEE.latest.text, /ფასადები \(18\.12\.2025, 27\.12\.2025\)/);
});

test('pending: the two orders the records list as pending are decided; 601 keeps its two open applications', () => {
  assert.deepEqual(EVO_EEE.pending, []);
  assert.deepEqual(EVO_EEE.resolved.map((r) => r.id), ['figures-AR11136621', 'figures-AR11143236']);
  assert.deepEqual(openApplications(E.HISTORY_EEE, SIG_EEE.evolution), []);
  assert.equal(openApplications(E.HISTORY_EEE, []).length, 2, 'without the acts the list stays as recorded');
  const p601 = STORY_601.evolution.pending;
  assert.deepEqual(p601.map((p) => p.id).sort(), ['pending-AR11148112', 'pending-AR11161121']);
  assert.match(p601.find((p) => p.id === 'pending-AR11148112').final, /შინაარსი წაკითხულ ჩანაწერებში არ ჩანს/);
  for (const p of p601) assert.match(p.impact, /მხოლოდ მოთხოვნაა/);
});

test('story prose: no raw identifiers, no dashes, never "built", never unauthorised, never compliance from a render', () => {
  for (const story of [STORY_EEE, STORY_601]) {
    const prose = proseOf([...story.evolution.steps, ...story.evolution.pending]) + story.tracks.map((t) => t.text).join('\n') + (story.evolution.discoveries ?? '') + (story.evolution.latest?.text ?? '');
    assert.ok(!/AR\d{5,9}|№\s*\d|No\s*\d{6}|\b\d{7}\b/.test(prose), 'a case or decision number in prose');
    assert.ok(!/[—–]/.test(prose), 'a dash');
    assert.ok(!/უკანონო|უნებართვო|unauthori[sz]ed/iu.test(prose), 'the building called unauthorised');
    assert.ok(!/(?:პროექტი|სახლი|შენობა|ვერსია|ჩანაფიქრი)\s+(?:\S+\s+)?აშენდა(?!\s+თუ\s+არა)/u.test(prose), 'an old design said to be built');
    assert.ok(!/შეესაბამება\s+(?:რენდერ|ფოტომონტაჟ)/u.test(prose));
    assert.ok(!/ექსპლუატაციაში მიღებულია/.test(prose));
  }
});

test('four tracks: construction activity, physical completion, official approval, commissioning', () => {
  const t601 = Object.fromEntries(STORY_601.tracks.map((t) => [t.track, t]));
  assert.deepEqual(Object.keys(t601), ['CONSTRUCTION', 'COMPLETION', 'PERMIT', 'COMMISSIONING']);
  assert.equal(t601.COMPLETION.state, 'COMPLETION_CLAIMED');
  assert.match(t601.COMPLETION.text, /დეველოპერის განცხადებაა და არა ოფიციალური აქტი/);
  assert.match(t601.PERMIT.text, /2028 წლის 11 მარტს იწურება/);
  const tE = Object.fromEntries(STORY_EEE.tracks.map((t) => [t.track, t]));
  // The status block's 2014-01-01 belongs to the 2012 permit: never the validity of the newest one.
  assert.ok(!/2014/.test(tE.PERMIT.text), tE.PERMIT.text);
  assert.match(tE.COMPLETION.text, /მშენებარედაა აღრიცხული/);
  assert.equal(tE.COMMISSIONING.state, 'NO_ACT_SEEN');
});

test('Georgian date forms: from / until', () => {
  assert.equal(kaFromDay('2013-01-01'), '2013 წლის 1 იანვრიდან');
  assert.equal(kaUntilDay('2014-01-01'), '2014 წლის 1 იანვრამდე');
  assert.equal(kaUntilDay('2026-08-24'), '2026 წლის 24 აგვისტომდე');
  assert.equal(kaFromDay('2026-08-24'), '2026 წლის 24 აგვისტოდან');
});

/* ── legal findings ─────────────────────────────────────────────── */

test('legal: the exact unit is verified, the parcel kept apart, every finding dated, private owner never named', () => {
  const v = legalFindings({
    unitLegalPosition: E.UNIT_LEGAL_POSITION, unitIdentity: E.UNIT_IDENTITY, companyFinance: E.COMPANY_FINANCE,
    applications: { open: openApplications(E.HISTORY_EEE, SIG_EEE.evolution), resolvedOn: EVO_EEE.resolved.map((r) => r.decidedOn) },
  });
  const by = Object.fromEntries(v.findings.map((f) => [f.key, f]));
  for (const k of ['EXACT_UNIT', 'PARCEL', 'BUILDING', 'OWNERSHIP_CURRENT', 'OWNERSHIP_HISTORY', 'MORTGAGE_CANCELLED', 'MORTGAGE_CURRENT', 'RESTRICTIONS', 'COMPANY_OBLIGATIONS', 'PENDING_APPLICATIONS']) assert.ok(by[k], k);
  assert.equal(by.EXACT_UNIT.tone, 'positive');
  assert.match(by.EXACT_UNIT.text, /ზუსტად ამ ბინას ეხება \(ბინა N4, 2 სართული\)/);
  assert.ok(!/არ არის|ვერ დადასტურდა|unverified/.test(by.EXACT_UNIT.text));
  assert.equal(by.PARCEL.scope, 'PARENT_PARCEL');
  assert.match(by.PARCEL.text, /1 400 მ²/);
  assert.match(by.PARCEL.text, /ნაკვეთს ეხება და არა ბინას/);
  assert.match(by.MORTGAGE_CANCELLED.text, /2024 წლის 18 დეკემბერს რეგისტრირებული იპოთეკა \(კრედიტორი: სააქციო საზოგადოება "კრედო ბანკი"\) 2026 წლის 22 ივნისს გაუქმდა/);
  assert.equal(by.MORTGAGE_CURRENT.tone, 'positive');
  assert.match(by.OWNERSHIP_CURRENT.text, /კერძო პირი/);
  assert.match(by.OWNERSHIP_HISTORY.text, /შპს ჯეო სითი დიღომი/);
  assert.ok(!JSON.stringify(v).includes(E.OWNER), 'the private owner is named');
  assert.match(by.PENDING_APPLICATIONS.text, /უკვე გადაწყვეტილია/);
  for (const f of v.findings.filter((f) => f.scope !== 'PROJECT')) assert.ok(f.observedOn, `${f.key} has no date`);
  assert.match(v.freshnessNote, /2026 წლის 22 ივნისის ამონაწერს ეყრდნობა და იმ დღის მდგომარეობას ასახავს/);
  assert.ok(!/[—–]/.test(JSON.stringify(v)));
});

test('legal: developer pledges are the developer\'s, a financing partner is the developer\'s claim; a missing extract is said plainly', () => {
  const v = legalFindings({
    unitLegalPosition: V.UNIT_LEGAL_POSITION,
    unitIdentity: { exactUnit: { code: '01.18.06.019.055.03.01.601', verified: true, apartment: '601', floor: '6', block: 'ც', areaSqm: 94.1, underConstruction: true, evidenceDate: '2026-08-24T08:35:20' } },
    companyFinance: { companyName: 'შპს მილენიო გრუპი', pledges: [{ creditor: 'სს საქართველოს ბანკი 204378869', registeredOn: '2023-12-19' }], debtorRegistry: { state: 'NO_ENTRY', checkedOn: '2026-10-11' }, financingPartner: 'საქართველოს ბანკი — პროექტის ოფიციალური ინფორმაციით, პროექტი სრულად დაფინანსებულია.', registryExtractDate: '2024-08-15' },
  });
  const by = Object.fromEntries(v.findings.map((f) => [f.key, f]));
  assert.match(by.EXACT_UNIT.text, /ბინა N601, 6 სართული, ბლოკი „ც“, 94\.1 მ²/);
  assert.match(by.COMPANY_OBLIGATIONS.text, /დეველოპერის ვალდებულებაა და არა ბინაზე რეგისტრირებული იპოთეკა/);
  assert.ok(!/204378869/.test(by.COMPANY_OBLIGATIONS.text));
  assert.match(by.PROJECT_FINANCING.text, /საქართველოს ბანკი არის დასახელებული/);
  const none = legalFindings({ unitLegalPosition: { scope: 'PARENT_PARCEL' }, unitIdentity: { exactUnit: { verified: false } } });
  assert.equal(none.findings[0].tone, 'attention');
});

/* ── technical cards ─────────────────────────────────────────────── */

test('technical: each card says what documents establish and what they cannot prove, also for persisted cards', () => {
  const cards = explainTechnical({ publicResearch: V.PUBLIC_RESEARCH, team: V.PROJECT_TEAM_V2_LIVE });
  for (const c of cards) {
    assert.ok(c.establishes && c.cannotProve, c.topic);
    assert.ok(!/[—–]/.test(c.establishes + c.cannotProve));
  }
  const old = readTechnicalCards([{ topic: 'FACADE', title: 'ფასადი', what: 'x', why: 'y', buyerMeaning: 'z', verify: 'v', source: 'OFFICIAL', date: '2025-08-21' }]);
  assert.match(old[0].establishes, /21\.08\.2025/);
  assert.match(old[0].cannotProve, /ადგილზე უნდა ნახოთ/);
});

/* ── the final conclusion ─────────────────────────────────────────────── */

test('conclusion: brackets replaced by verified specifics; balanced or cautious, never a recommendation', () => {
  const synth = {
    unitLegalPosition: E.UNIT_LEGAL_POSITION, officialHistory: E.HISTORY_EEE, report: { projectSignals: SIG_EEE },
    market: { valuation: { state: 'RANGE' } }, location: { nearby: [1, 2, 3] },
  };
  const a = buildBuyerAssessment(synth);
  assert.ok(!a.concerns.some((c) => /განაცხადზე.*საბოლოო გადაწყვეტილება ჯერ არ ჩანს/.test(c)), 'decided orders raised as pending');
  assert.ok(a.concerns.some((c) => /2-ჯერ შეიცვალა/.test(c) && /პრაქტიკულად ეს ნიშნავს/.test(c)));
  assert.ok(a.strengths.some((s) => /ქალაქმა ოფიციალურად შეათანხმა/.test(s)));
  const r = readBuyerAssessment(roundTrip(a));
  assert.ok(r.conclusion);
  assert.ok(['POSITIVE', 'BALANCED', 'CAUTIOUS'].includes(r.conclusion.stance));
  const text = [r.conclusion.strengths, ...r.conclusion.concerns, r.conclusion.stanceText].join(' ');
  assert.ok(!/\[|\]|VERIFIED|PLACEHOLDER|%/.test(text), text);
  assert.ok(!/იყიდეთ|შეიძინეთ|გირჩევთ/.test(text));
  assert.ok(!/2014 წლის 1 იანვარს იწურება/.test(JSON.stringify(a)), 'the 2012 permit\'s term');
  assert.equal(finalConclusion({ strengths: ['a'], concerns: ['ამონაწერში ბინაზე იპოთეკა ჯერ კიდევ რეგისტრირებულია.'] }).stance, 'CAUTIOUS');
  assert.equal(finalConclusion({ strengths: ['a', 'b'], concerns: [] }).stance, 'POSITIVE');
  assert.equal(finalConclusion({ strengths: [], concerns: [] }), null);
  assert.ok(assessmentProblems({ narrative: 'გირჩევთ ამ ბინის შეძენას.' }).includes('assessment recommends the purchase'));
  assert.equal(finalBuyerAssessment({ narrative: 'ღირს ამ ბინის ყიდვა.' }, synth).source, 'DETERMINISTIC');
});

/* ── editorial ─────────────────────────────────────────────── */

test('editorial: identifiers leave the prose, near-duplicate conclusions are said once', () => {
  assert.equal(stripCaseIdentifiers('2026 წლის 18 მაისს (AR11143236) შეტანილი განაცხადი.'), '2026 წლის 18 მაისს შეტანილი განაცხადი.');
  assert.equal(stripCaseIdentifiers('ქალაქმა No7761945 ბრძანებით შეათანხმა.'), 'ქალაქმა ბრძანებით შეათანხმა.');
  assert.equal(stripCaseIdentifiers('AR11136621 განაცხადით მოთხოვნა დაკმაყოფილდა.'), 'განაცხადით მოთხოვნა დაკმაყოფილდა.');
  assert.equal(stripCaseIdentifiers('კოდი 01.72.14.040.030.01.01.004 რჩება.'), 'კოდი 01.72.14.040.030.01.01.004 რჩება.');
  const a = 'ბინის საკუთრება გარკვეულია და იპოთეკა გაუქმებულია ამონაწერის თარიღისთვის საჯარო რეესტრში';
  assert.equal(nearDuplicate(a, 'ამონაწერის თარიღისთვის ბინის საკუთრება გარკვეულია და იპოთეკა გაუქმებულია საჯარო რეესტრში.'), true);
  assert.equal(nearDuplicate(a, 'ფასადი ალუმინის პანელებითაა მოპირკეთებული და ფანჯრები ორმაგი მინაპაკეტითაა.'), false);
  const r = polishReport({
    summary: { label: 'BALANCED', statement: 'ქალაქმა 2026 წლის 21 მაისს (AR11143236, № 7930086) ფართობები შეასწორა. ბინის საკუთრება გარკვეულია და იპოთეკა გაუქმებულია ამონაწერის თარიღისთვის საჯარო რეესტრში.', highlights: [] },
    keyFindings: [], sections: [], attentionPoints: [], nextSteps: [],
    finalView: 'ამონაწერის თარიღისთვის ბინის საკუთრება გარკვეულია და იპოთეკა გაუქმებულია საჯარო რეესტრში.',
    contractUpload: { recommend: true, text: '' }, mode: 'MODEL', rejectedBecause: [], evidenceUsed: [],
  });
  assert.ok(!/AR\d|№/.test(r.summary.statement), r.summary.statement);
  assert.equal(r.finalView, '', 'the conclusion was said twice');
});

/* ── copy and components ─────────────────────────────────────────────── */

test('copy: approved Georgian verbatim, six locales, placeholders intact, every key the components use exists', () => {
  const S = VERIFY_V6_STORY_STRINGS;
  assert.match(S.verify_v6s_intro_body[1], /^ამ შენობის ისტორია მხოლოდ მისი დღევანდელი იერსახით არ იწყება\./);
  assert.match(S.verify_v6s_pending_body[1], /ეს თავისთავად არ ნიშნავს, რომ პროექტს პრობლემა აქვს\./);
  assert.match(S.verify_v6s_legal_body[1], /ძველი ამონაწერი ყოველთვის ვერ ასახავს დღევანდელ მდგომარეობას/);
  assert.match(S.verify_v6s_final_closing[1], /^ჩვენი მიზანი არ არის თქვენს ნაცვლად გადაწყვეტილების მიღება\./);
  for (const [key, values] of Object.entries(S)) {
    assert.equal(values.length, 6, key);
    const want = (values[0].match(/\{\{\w+\}\}/g) ?? []).sort().join();
    for (const v of values) {
      assert.equal((v.match(/\{\{\w+\}\}/g) ?? []).sort().join(), want, `${key}: ${v}`);
      assert.ok(!/—/.test(v), `${key}: em dash`);
    }
  }
  assert.ok(!/confirmed buyer|შესატყვისი|ტბილისი/i.test(Object.values(S).flat().join('\n')));
  const used = new Set();
  for (const f of ['ProjectStory', 'LegalReality', 'BuyerAssessment', 'TechnicalExplained', 'ProjectMath']) {
    const src = fs.readFileSync(new URL(`../../components/verify/${f}.tsx`, import.meta.url), 'utf8');
    for (const m of src.matchAll(/'(verify_v6s_[a-z0-9_]+)'/g)) used.add(m[1]);
  }
  for (const k of used) assert.ok(S[k], `${k} has no copy`);
  for (const s of ['approved', 'permit', 'corrected', 'returned', 'under_review', 'response_unread', 'no_decision_read']) assert.ok(S[`verify_v6s_status_${s}`], s);
  for (const s of ['construction', 'completion', 'permit', 'commissioning']) assert.ok(S[`verify_v6s_track_${s}`], s);
  for (const s of ['positive', 'balanced', 'cautious']) assert.ok(S[`verify_v6s_stance_${s}`], s);
});

test('components: the story is visible by default, the five-stage widget is gone, evidence carries the numbers', () => {
  const read = (f) => fs.readFileSync(new URL(`../../components/verify/${f}.tsx`, import.meta.url), 'utf8');
  const oi = read('OfficialIntelligence');
  const block = oi.slice(oi.indexOf('export const PropertyStoryBlock'));
  // v7 (owner, 2026-10-11): introduction, then the readable chapters, then the
  // status cards; the step list sits in the detailed-chronology disclosure.
  const ret = block.slice(block.indexOf('return (\n    <div className="space-y-8">'));
  assert.ok(ret.indexOf('<StoryIntro') < ret.indexOf('{chaptersList}'), 'the introduction is not first');
  assert.ok(ret.indexOf('{chaptersList}') < ret.indexOf('part="status"'), 'the chapters do not lead');
  const ps = read('ProjectStory');
  const evolution = ps.slice(ps.indexOf('data-evolution>'), ps.indexOf('data-latest-approved'));
  assert.ok(!/<details/.test(evolution.slice(0, evolution.indexOf('<Step'))), 'the story sits behind an accordion');
  assert.match(ps, /<OfficialLink/, 'evidence opens the official documents');
  const legal = read('LegalReality');
  assert.ok(!/lg:grid-cols-5|LEGAL_STATUS_VIEW/.test(legal));
  assert.match(legal, /verify_v6s_legal_body[\s\S]*data-legal-finding/, 'the legal copy is not followed by its findings');
  for (const f of ['ProjectStory', 'LegalReality', 'BuyerAssessment', 'TechnicalExplained']) assert.ok(!/text-\[1[01]px\]/.test(read(f)), f);
});
