// Verify v3 intelligence layer — regression for job 220ed087 (Villion,
// parcel 01.18.06.019.055, unit 01.18.06.019.055.03.01.503). Fixture texts are
// sanitized reconstructions of the TAS forms (fixtures/villionV3Fixture.mjs);
// nothing here claims live TAS verification.
import test from 'node:test';
import assert from 'node:assert/strict';

import { villionV3, COMPLETED_AT, RES255, RES255_SHORT } from './fixtures/villionV3Fixture.mjs';
import { browserOfficial as registerBrowserOfficial, CODE } from './fixtures/propertyRegisterFixture.mjs';
import { revalidateDecision } from '../legalStatus.ts';
import { buildTasIntelligence, officialHistoryView } from '../tasIntelligence.ts';
import { buildEvidencePackage } from '../evidencePackage.ts';
import { buildIntelligencePrompt } from '../prompt.ts';
import { asPersonName, asOrganizationName, extractTasProfessionals, buildProjectTeamV2, roleCode } from '../tasProfessionals.ts';
import { extractTechnicalSpecs, parseNumber } from '../technicalSpecs.ts';
import { buildOfficialDocuments, fileKind } from '../officialDocuments.ts';
import { REPORT_LOGIC_VERSION, shouldAutoUpgrade, versionMarkers, markUpgradeAttempted, logicVersionOf, AUTO_UPGRADE_WINDOW_DAYS } from '../reportVersion.ts';
import { reuseEarlierRegister, hasOwnRegister, targetCadastralCode } from '../registerReuse.ts';
import { withPropertyRegister, stripUnsupportedCommissioning } from '../registerEnrichment.ts';
import { projectTeamFrom } from '../reportGaps.ts';
import { normalizeVerifyPayload } from '../../resultNormalizer.ts';

const NOW = COMPLETED_AT;
const pkgOf = (r = villionV3(), now = NOW) => buildEvidencePackage(r, { now });

/* ───────────── 1. false commissioning (Gov. Resolution №255 citation) ───────────── */

test('every stored COMMISSIONED whose evidence only cites Resolution №255 is downgraded', () => {
  // AR11101896 motion 7839253 (2026-03-11) and the nine like it.
  for (const evidence of [RES255, RES255_SHORT, 'მშენებლობის ნებართვის გაცემისა და შენობა-ნაგებობის ექსპლუატაციაში მიღების წესის და პირობების']) {
    const d = revalidateDecision({ number: '7839253', outcome: 'COMMISSIONED', evidence });
    assert.equal(d.outcome, 'UNDETERMINED', evidence);
    assert.equal(d.revalidated, 'COMMISSIONING_NOT_OPERATIVE');
  }
  const intel = buildTasIntelligence(villionV3(), NOW);
  const approved = intel.legalClaims.find((c) => c.key === 'COMMISSIONING_APPROVED');
  assert.equal(approved.status, 'NOT_VERIFIED');
  assert.notEqual(intel.officialStatus.state, 'COMMISSIONED');
});

test('a persisted report claiming commissioning is corrected on read; negated sentences stay', () => {
  const stored = {
    officialHistory: { status: { state: 'COMMISSIONED' }, milestones: [], evolution: [] },
    report: {
      summary: { statement: 'ბინა ვილიონის კომპლექსშია. 2026 წლის 11 მარტის გადაწყვეტილებით შენობა ექსპლუატაციაში მიღებულად არის მონიშნული.' },
      currentStatus: {
        statement: 'ნებართვა მოქმედებს.',
        items: [{ label: 'ექსპლუატაციაში მიღება', value: '11.03.2026' }, { label: 'ნებართვა', value: 'მოქმედებს' }],
      },
      sections: [{ key: 'PROJECT', body: 'შენობა ჯერ არ არის ექსპლუატაციაში მიღებული. პროექტი შეთანხმებულია.' }],
    },
  };
  const out = withPropertyRegister(stored, villionV3(), { completedAt: NOW });
  assert.ok(!/მიღებულად არის მონიშნული/.test(out.report.summary.statement));
  assert.match(out.report.summary.statement, /ვილიონის/);
  assert.deepEqual(out.report.currentStatus.items.map((i) => i.label), ['ნებართვა']);
  assert.match(out.report.sections[0].body, /ჯერ არ არის ექსპლუატაციაში/);
  assert.notEqual(out.officialHistory.status.state, 'COMMISSIONED');
  assert.ok(out.officialHistory.currentPosition, 'old payloads gain the current position on read');
  assert.equal(out.officialHistory.pendingApplications[0].caseRef, 'AR11161121');
  // The pure stripper on its own.
  assert.equal(stripUnsupportedCommissioning({ finalView: 'Accepted into operation in 2026. Good.' }).finalView, 'Good.');
});

/* ───────────── 2. pending application, never an approval ───────────── */

test('AR11161121 is UNDER_REVIEW and never overrides the latest effective decision', () => {
  const intel = buildTasIntelligence(villionV3(), NOW);
  const view = officialHistoryView(intel);
  assert.equal(view.pendingApplications.length, 1);
  const p = view.pendingApplications[0];
  assert.equal(p.caseRef, 'AR11161121');
  assert.equal(p.status, 'UNDER_REVIEW');
  assert.equal(p.statusText, 'განხილვის პროცესში');
  assert.equal(p.date, '2026-09-17');
  assert.equal(p.deadline, '2026-10-16');
  assert.equal(p.applicant, 'ლევან ჩაჩუა');
  assert.match(p.subject, /ნებართვაში ცვლილების/);
  assert.match(p.subject, /K3/);

  const cp = view.currentPosition;
  assert.deepEqual(Object.keys(cp).slice(0, 3), ['effective', 'pending', 'conflicts'], 'effective → pending → conflicts');
  assert.equal(cp.effective.caseRef, 'AR11101896');
  assert.equal(cp.effective.decisionNumber, '7839254');
  assert.equal(cp.effective.date, '2026-03-11');
  assert.equal(cp.effective.outcome, 'AMENDMENT_APPROVED');
  assert.equal(cp.effective.state, 'PERMITTED');
  assert.equal(cp.pending[0].caseRef, 'AR11161121');
  assert.equal(view.status.caseRef, 'AR11101896', 'the pending case never becomes the status basis');
  // No milestone or legal basis cites the pending case as a decision.
  assert.ok(!view.legal.some((c) => c.basis.some((b) => b.caseRef === 'AR11161121')));
});

/* ───────────── 3. future-dated references ───────────── */

test('a reference dated after the job completed is FUTURE_DATED_REFERENCE, excluded from claims and timeline', () => {
  const intel = buildTasIntelligence(villionV3(), NOW);
  assert.deepEqual(intel.futureDatedReferences.map((f) => [f.flag, f.date, f.caseRef]), [['FUTURE_DATED_REFERENCE', '2026-11-03', 'AR11161121']]);
  assert.ok(!intel.timeline.some((e) => e.date > '2026-10-09'));
  assert.ok(!intel.legalClaims.some((c) => c.basis.some((b) => (b.date ?? '') > '2026-10-09')));
  assert.notEqual(intel.officialStatus.basis.caseRef, 'AR11161121');
  // Deterministic: "now" is the job's completion, never the wall clock.
  const again = buildTasIntelligence(villionV3(), NOW);
  assert.deepEqual(again.futureDatedReferences, intel.futureDatedReferences);
  const later = buildTasIntelligence(villionV3(), '2026-12-01T00:00:00Z');
  assert.equal(later.futureDatedReferences.length, 0, 'with a later completion the same date is simply history');
});

/* ───────────── 4. project team ───────────── */

test('names: persons are 2–4 nominative name words; fragments, CV prose and banks are not', () => {
  for (const ok of ['დარეჯან შათაშვილი', 'დავით სორდია', 'ია მშვიდობაძე', 'ვასილ ტატიაშვილი', 'John Smith']) assert.equal(asPersonName(ok), ok);
  for (const bad of [
    '"იმკ-91" მშენებელ-ინჟინერი. 2018 წლიდან შპს "რეალექსპერტი"-ს ექსპერტი გეოლოგიის დარგში.',
    'ს - დავით ხაბულიანის სანოტარო წესით',
    'დავით ხაბულიანის',
    'მიმდებარე შენობის კონსტრუქციული მდგომარეობის შეფასება',
    'ქუჩა კრწანისი 6',
    'თიბისი ბანკი',
    'რეხვიაშვილი',
    'გიორგი რეხვიაშვილი 01001012345',
  ]) assert.equal(asPersonName(bad), null, bad);
  assert.equal(asOrganizationName('შპს "არტიტექსი" (ს/კ 405000002)'), 'შპს „არტიტექსი“');
});

test('AR11161121 professionals are recovered with documented roles and provenance', () => {
  const team = extractTasProfessionals(villionV3());
  const by = (n) => team.find((m) => m.name === n);
  const role = (n) => by(n)?.roles[0];

  assert.equal(role('დარეჯან შათაშვილი').code, 'CHIEF_ARCHITECT');
  assert.equal(role('დარეჯან შათაშვილი').roleText, 'მთავარი არქიტექტორი');
  assert.equal(by('დარეჯან შათაშვილი').group, 'ARCHITECTURE');
  for (const n of ['დავით სორდია', 'გიორგი ლეჟავა']) {
    assert.equal(role(n).code, 'CO_AUTHOR');
    assert.equal(role(n).roleText, 'თანაავტორი');
  }
  assert.equal(by('შპს „არტიტექსი“').kind, 'ORGANIZATION');
  assert.equal(role('შპს „არტიტექსი“').code, 'ARCHITECTURAL_ORGANIZATION');

  // Goga ≠ Giorgi: two people, two different assessments.
  const goga = by('გოგა რეხვიაშვილი');
  const giorgi = by('გიორგი რეხვიაშვილი');
  assert.ok(goga && giorgi && goga !== giorgi);
  assert.equal(goga.roles[0].code, 'ADJACENT_BUILDING_STRUCTURAL_ASSESSMENT');
  assert.equal(goga.roles[0].scope, 'მიმდებარე შენობის კონსტრუქციული მდგომარეობის შეფასება');
  assert.match(goga.roles[0].roleText, /^სპეციალისტი: მიმდებარე შენობის კონსტრუქციული მდგომარეობის შეფასება$/);
  assert.equal(giorgi.roles[0].code, 'STRUCTURAL_EXPERT_ASSESSMENT');
  assert.equal(giorgi.roles[0].scope, 'საძირკვლისა და ძირითადი კონსტრუქციული ელემენტების საექსპერტო შეფასება');
  // A specialist on one assessment is never promoted to the project's structural designer.
  assert.ok(!team.some((m) => m.roles.some((r) => r.code === 'STRUCTURAL_DESIGNER')));

  assert.match(role('ვასილ ტატიაშვილი').roleText, /შენობის უსაფრთხოების რეგულირების შეფასება/);
  assert.equal(by('ვასილ ტატიაშვილი').group, 'SAFETY');
  assert.equal(role('ბელა გოგოლაური').roleText, 'მშენებლობის ორგანიზების გრაფიკი');
  assert.equal(by('ბელა გოგოლაური').group, 'CONSTRUCTION_ORG');
  assert.match(role('ია მშვიდობაძე').roleText, /საინჟინრო-გეოლოგიური საექსპერტო შეფასება/);
  assert.equal(by('ია მშვიდობაძე').group, 'GEOTECHNICAL');
  assert.equal(by('შპს „მილენიო გრუპი“').group, 'DEVELOPER');

  // Provenance on every role.
  for (const m of team)
    for (const r of m.roles) {
      assert.ok(r.caseRef, `${m.name} has a case`);
      assert.ok(r.sourceUrl?.startsWith('https://docs.tbilisi.gov.ge/'), `${m.name} has a public source`);
    }
  assert.equal(role('დარეჯან შათაშვილი').sourceUrl, 'https://docs.tbilisi.gov.ge/architect/public.html?docId=1161121');
  assert.match(role('ვასილ ტატიაშვილი').sourceUrl, /DownloadServlet\?downloadCase=2&attachedFileId=a1$/);
  assert.equal(role('ვასილ ტატიაშვილი').documentTitle, 'არქიტექტურული_პროექტი_K3.pdf');
});

test('projectTeamV2: garbage and banks never appear; personal data never leaves', () => {
  const pkg = pkgOf();
  const team = pkg.dossier.projectTeamV2;
  const names = team.map((m) => m.name);
  assert.ok(!names.some((n) => /წლიდან|სანოტარო|იმკ-91|ხაბულიან/.test(n)), names.join(' | '));
  assert.ok(!names.some((n) => /ბანკ/.test(n)), 'a bank is not a project-team member');
  assert.equal(new Set(names).size, names.length, 'one entry per full name');
  const json = JSON.stringify(pkg.dossier);
  assert.ok(!/01001012345|01019011223|599 12 34 56|405000002\)/.test(json), 'no personal numbers or phones');
  // Legacy public team (reportGaps) drops the bank too.
  assert.ok(!projectTeamFrom(villionV3(), null).some((m) => /ბანკ/.test(m.name)));
  // Merge: an official legacy entry for someone extracted precisely adds no coarse role.
  const merged = buildProjectTeamV2(extractTasProfessionals(villionV3()), [{ name: 'გიორგი რეხვიაშვილი', roles: ['STRUCTURAL_ENGINEER'] }, { name: 'ნინო კაპანაძე', roles: ['ARCHITECT'] }], [{ name: 'თიბისი ბანკი', roles: ['OTHER'], roleText: 'იპოთეკური შეძენის შესაძლებლობა' }]);
  const g = merged.find((m) => m.name === 'გიორგი რეხვიაშვილი');
  assert.ok(!g.roles.some((r) => r.code === 'STRUCTURAL_DESIGNER'));
  assert.ok(merged.some((m) => m.name === 'ნინო კაპანაძე' && m.official));
  assert.ok(!merged.some((m) => /ბანკ/.test(m.name)));
  assert.equal(roleCode('შენობის უსაფრთხოების რეგულირების შეფასება').group, 'SAFETY');
});

/* ───────────── 5. technical specifications ───────────── */

test('specs: values with standing — PROPOSED from the pending case, APPROVED from approved cases', () => {
  const specs = extractTechnicalSpecs(villionV3(), NOW);
  const get = (k, st) => specs.find((s) => s.key === k && (!st || s.status === st));
  assert.equal(get('landArea').numeric, 2145);
  assert.equal(get('landArea').status, 'APPROVED');
  assert.equal(get('k2CalculationArea').numeric, 5242.3);
  assert.equal(get('k2CalculationArea').status, 'PROPOSED');
  assert.equal(get('heightAboveGround').numeric, 22.75);
  assert.equal(get('undergroundDepth').numeric, 4.2);
  assert.equal(get('structuralHeight').numeric, 26.95);
  assert.equal(get('K1').numeric, 0.5);
  assert.equal(get('K3').numeric, 0.3);
  assert.equal(get('K2', 'APPROVED').numeric, 2.4);
  assert.equal(specs.filter((s) => s.key === 'K2').length, 1, 'same value proposed again is not a change');
  assert.equal(get('foundationType').value, 'კომბინირებული');
  assert.match(get('facadeMaterials').value, /ალუმინის კომპოზიტური პანელები/);
  assert.equal(get('residentialArea').numeric, 3960.4);
  assert.equal(get('buildingClass').value, 'IV კლასი');
  for (const s of specs) assert.ok(s.label && s.caseRef && s.source, s.key);

  // A different proposed value is shown WITH the approved one, never instead of it.
  const r = villionV3();
  r.browserOfficial.results[0].tasApi.cases[2].attachments[0].text = 'K2 = 2,6';
  const k2 = extractTechnicalSpecs(r, NOW).filter((s) => s.key === 'K2');
  assert.deepEqual(k2.map((s) => [s.status, s.numeric]), [['APPROVED', 2.4], ['PROPOSED', 2.6]]);
  assert.equal(parseNumber('2,145 მ²'), 2145);
  assert.equal(parseNumber('5 242,3'), 5242.3);
});

/* ───────────── 10. official documents ───────────── */

test('officialDocuments: priority cases first, then by date; file kinds and public links', () => {
  const docs = buildOfficialDocuments(villionV3());
  assert.deepEqual(docs.map((d) => d.caseRef), ['AR11161121', 'AR11101896', 'AR10761052']);
  assert.equal(docs[0].priority, 1);
  assert.equal(docs[0].publicUrl, 'https://docs.tbilisi.gov.ge/architect/public.html?docId=1161121');
  assert.deepEqual(docs[0].files.map((f) => f.kind).sort(), ['DRAWING', 'IMAGE', 'PDF']);
  assert.equal(docs[0].files.find((f) => f.kind === 'PDF').pages, 64);
  assert.equal(fileKind('ფასადი.pdf', 'pdf'), 'DRAWING');
  assert.equal(fileKind('a.zip', null), 'ARCHIVE');
});

/* ───────────── 9. AI input completeness ───────────── */

test('the prompt carries every material fact of the priority case, bounded, without personal data', () => {
  const pkg = pkgOf();
  const { user, system } = buildIntelligencePrompt(pkg);
  for (const fact of [
    'დარეჯან შათაშვილი', 'მთავარი არქიტექტორი', 'დავით სორდია', 'გიორგი ლეჟავა', 'გოგა რეხვიაშვილი', 'გიორგი რეხვიაშვილი',
    'მიმდებარე შენობის კონსტრუქციული მდგომარეობის შეფასება', 'ვასილ ტატიაშვილი', 'ბელა გოგოლაური', 'ია მშვიდობაძე',
    'შპს „არტიტექსი“', 'შპს „მილენიო გრუპი“', 'ლევან ჩაჩუა',
    'განხილვის პროცესში', '2026-10-16', 'UNDER_REVIEW', 'AR11161121',
    '22.75 მ', '5 242.3 მ²', 'კომბინირებული', 'PROPOSED',
    'არქიტექტურული_პროექტი_K3.pdf', 'გენგეგმა.dwg', 'DRAWING',
    '2026-11-03',
  ]) assert.ok(user.includes(fact), `missing in prompt: ${fact}`);
  assert.ok(!/01001012345|01019011223|599 12 34 56/.test(user));
  const parsed = JSON.parse(user);
  assert.equal(parsed.officialPosition.effective.caseRef, 'AR11101896');
  assert.equal(parsed.officialPosition.pending[0].caseRef, 'AR11161121');
  assert.equal(parsed.priorityCases[0].standing, 'UNDER_REVIEW');
  assert.ok(parsed.priorityCases[0].attachments.length <= 40);
  // The narrative rules exist.
  assert.match(system, /NAME THE PEOPLE WITH THEIR DOCUMENTED ROLES/);
  assert.match(system, /em dash/);
  assert.match(system, /current verified position first/);
  assert.match(system, /buyer is free to choose any bank/);
});

/* ───────────── 6. logic-version gate ───────────── */

test('auto-upgrade gate: older READY report of a recent job, once per version', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const base = { synthesisState: 'READY', synthesisJson: { report: {} }, completedAt: '2026-10-09T18:20:00Z', now };
  assert.equal(logicVersionOf({}), 0);
  assert.equal(shouldAutoUpgrade(base), true);
  assert.equal(shouldAutoUpgrade({ ...base, synthesisJson: { report: {}, _logicVersion: REPORT_LOGIC_VERSION } }), false, 'current version');
  assert.equal(shouldAutoUpgrade({ ...base, synthesisJson: markUpgradeAttempted({ report: {} }) }), false, 'already attempted');
  assert.equal(shouldAutoUpgrade({ ...base, completedAt: new Date(now - (AUTO_UPGRADE_WINDOW_DAYS + 1) * 864e5).toISOString() }), false, 'too old');
  assert.equal(shouldAutoUpgrade({ ...base, synthesisState: 'PENDING' }), false, 'in flight');
  assert.equal(shouldAutoUpgrade({ ...base, synthesisJson: null }), false);
  assert.equal(shouldAutoUpgrade({ ...base, completedAt: null }), false);
  assert.deepEqual(versionMarkers({ _logicVersion: 2 }, true), { _logicVersion: REPORT_LOGIC_VERSION, _autoUpgradedFrom: 2 });
  assert.deepEqual(versionMarkers(null, false), { _logicVersion: REPORT_LOGIC_VERSION });
  assert.equal(shouldAutoUpgrade({ ...base, synthesisJson: { ...versionMarkers({}, true) } }), false, 'a rebuilt report is never rebuilt again');
});

/* ───────────── 7. register from the buyer's own earlier check ───────────── */

test('register fallback: the newest earlier job of the same exact code supplies the extract', () => {
  const rj = villionV3();
  assert.equal(hasOwnRegister(rj), false);
  assert.equal(targetCadastralCode(rj), CODE);
  const other = { results: [{ source: 'mygov', traversal: { search: { cadastralCode: '01.18.06.019.055.03.01.502', records: [] } }, documents: [] }] };
  const out = reuseEarlierRegister(rj, CODE, [
    { id: 'c80f7237-31f0-4aa0-ad2e-2fdbedf5ba06', completedAt: '2026-09-23T10:00:00Z', browserOfficial: registerBrowserOfficial() },
    { id: 'e02d4f16-0ff2-42e4-8659-80a4496d5986', completedAt: '2026-09-03T10:00:00Z', browserOfficial: registerBrowserOfficial() },
    { id: 'zzz', completedAt: '2026-09-30T10:00:00Z', browserOfficial: other },
  ]);
  assert.ok(out);
  assert.deepEqual(out.registerSource, { jobId: 'c80f7237-31f0-4aa0-ad2e-2fdbedf5ba06', asOf: '2026-09-22', reused: true });
  assert.equal(hasOwnRegister(out.resultJson), true);
  // TAS of the job itself is kept; only the registry results come from the earlier check.
  assert.ok(out.resultJson.browserOfficial.results.some((r) => r.source === 'tas' && r.tasApi));
  assert.equal(out.register.cadastralCode, CODE);
  // A different unit, or no code, never supplies a register.
  assert.equal(reuseEarlierRegister(rj, '01.18.06.019.055.03.01.502', [{ id: 'x', completedAt: null, browserOfficial: registerBrowserOfficial() }]), null);
  assert.equal(reuseEarlierRegister(rj, null, [{ id: 'x', completedAt: null, browserOfficial: registerBrowserOfficial() }]), null);
});

test('a reused register persists with the report and is applied again on read', () => {
  const reused = reuseEarlierRegister(villionV3(), CODE, [{ id: 'c80f7237', completedAt: '2026-09-23T10:00:00Z', browserOfficial: registerBrowserOfficial() }]);
  const built = withPropertyRegister({ report: { summary: { statement: 'x.' } }, snapshot: {}, registerSource: reused.registerSource }, reused.resultJson, { completedAt: NOW });
  assert.equal(built.propertyRegister.latest.issuedAt, '2026-09-22T09:47:44');
  // Read path: the job's own result has no register, the persisted one is used.
  const read = withPropertyRegister({ ...built, snapshot: {} }, villionV3(), { completedAt: NOW });
  assert.equal(read.propertyRegister.latest.issuedAt, '2026-09-22T09:47:44');
  assert.match(String(read.snapshot.owner), /სატესტო მესაკუთრე/);
});

/* ───────────── read path recovery and the client contract ───────────── */

test('old payloads gain the dossier on read; banks leave the stored team', () => {
  const out = withPropertyRegister({ report: null, projectTeam: [{ name: 'თიბისი ბანკი', roles: ['OTHER'], basis: 'PUBLIC', roleText: 'იპოთეკური შეძენის შესაძლებლობა' }, { name: 'დარეჯან შათაშვილი', roles: ['ARCHITECT'], basis: 'OFFICIAL' }] }, villionV3(), { completedAt: NOW });
  assert.deepEqual(out.projectTeam.map((m) => m.name), ['დარეჯან შათაშვილი']);
  assert.ok(out.projectTeamV2.some((m) => m.name === 'გოგა რეხვიაშვილი'));
  assert.ok(out.technicalSpecs.some((s) => s.key === 'heightAboveGround'));
  assert.equal(out.officialDocuments[0].caseRef, 'AR11161121');
});

test('the normalizer passes the v3 blocks through unchanged', () => {
  const pkg = pkgOf();
  const intel = buildTasIntelligence(villionV3(), NOW);
  const raw = {
    report: { summary: { statement: 'ტესტი.' }, keyFindings: [], sections: [] },
    officialHistory: officialHistoryView(intel),
    projectTeamV2: pkg.dossier.projectTeamV2,
    technicalSpecs: pkg.dossier.technicalSpecs,
    officialDocuments: pkg.dossier.officialDocuments,
    registerSource: { jobId: 'c80f7237', asOf: '2026-09-22', reused: true },
  };
  const { result } = normalizeVerifyPayload(raw);
  assert.equal(result.projectTeamV2.length, pkg.dossier.projectTeamV2.length);
  assert.equal(result.technicalSpecs.length, pkg.dossier.technicalSpecs.length);
  assert.equal(result.officialDocuments[0].caseRef, 'AR11161121');
  assert.deepEqual(result.registerSource, raw.registerSource);
  assert.equal(result.officialHistory.pendingApplications[0].caseRef, 'AR11161121');
  assert.ok(result.officialHistory.currentPosition.effective);
});

/* ───────────── 8. market: a shown comparable carries its basis ───────────── */

test('a scored comparable keeps source, area, price, price/m² and its rationale; no subject price is invented', async () => {
  const { buildMarketIntelligence } = await import('../marketIntelligence.ts');
  const subject = { project: 'Villion', address: 'Krtsanisi St. 6, Tbilisi', district: 'ორთაჭალა', currency: 'USD' };
  const m = buildMarketIntelligence(subject, [
    { pricePerSqm: 2000, area: 80, price: 160000, currency: 'USD', source: 'myhome.ge', address: 'Krtsanisi St. 6, Tbilisi', project: 'Villion', similarity: 'same project' },
  ]);
  const c = (m?.ranked ?? m?.closest ?? [])[0];
  assert.ok(c, 'the comparable is scored');
  assert.equal(c.source, 'myhome.ge');
  assert.equal(c.area, 80);
  assert.equal(c.pricePerSqm, 2000);
  assert.equal(c.totalPrice, 160000);
  assert.ok(c.relevanceReasons.length > 0);
  assert.equal(m.subjectPricePerSqm ?? null, null, 'no subject price from comparables');
});
