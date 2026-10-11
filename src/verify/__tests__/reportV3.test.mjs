// Verify v3 customer report (2026-10): the discipline-grouped team, the
// official document explorer, today's legal position, the documented
// specifications and the register's ownership & security card.
//
// What is held here is what the reader is TOLD: a documented role is never
// replaced by a generic label, a pending application is never an approval,
// the newest applications come first, a reused register extract says so, and
// a report stored before any of this still renders its older presentation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  teamGroupsV2,
  plausibleName,
  TEAM_GROUP_ORDER,
  TEAM_GROUP_KEY,
  documentExplorer,
  caseStatusOf,
  readStateOf,
  readableTitle,
  DOC_READ_KEY,
  DOC_STATUS_KEY,
  legalPosition,
  specGroups,
  specGroupOf,
  SPEC_GROUP_KEY,
  SPEC_STATUS_KEY,
  registerView,
  isParcelCode,
  safeHref,
  visualSources,
} from '../reportPresentation.ts';
import { catalogVisuals } from '../visualCatalog.ts';
import { normalizeVerifyResult } from '../resultNormalizer.ts';
import { VERIFY_REPORT_V3_STRINGS } from '../../../scripts/verify-report-v3-i18n-data.mjs';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const translations = read('src/i18n/translations.ts');
const valuesOf = (key) => [...translations.matchAll(new RegExp(`^  ${key}: '((?:[^'\\\\]|\\\\.)*)',$`, 'gm'))].map((m) => m[1]);
const TAS = 'https://www.tas.ge/case/12345';

/* A sanitized team shaped like the Villion records. */
const role = (roleText, extra = {}) => ({ code: 'X', roleText, scope: null, caseRef: '01/2024/0001', date: '2024-03-01', documentTitle: 'ესკიზური პროექტი', sourceUrl: TAS, ...extra });
const TEAM = [
  { name: 'შპს მილენიო გრუპი', kind: 'ORGANIZATION', group: 'DEVELOPER', organization: null, roles: [role('დამკვეთი')], official: true },
  { name: 'დარეჯან შათაშვილი', kind: 'PERSON', group: 'ARCHITECTURE', organization: 'შპს არტიტექსი', roles: [role('მთავარი არქიტექტორი'), role('პროექტის ავტორი', { date: '2025-01-10', caseRef: '01/2025/0002' })], official: true },
  { name: 'შპს არტიტექსი', kind: 'ORGANIZATION', group: 'ARCHITECTURE', roles: [role('საპროექტო ორგანიზაცია')], official: true },
  { name: 'დავით სორდია', kind: 'PERSON', group: 'ARCHITECTURE', roles: [role('თანაავტორი')], official: true },
  { name: 'გიორგი ლეჟავა', kind: 'PERSON', group: 'ARCHITECTURE', roles: [role('თანაავტორი')], official: true },
  { name: 'გოგა რეხვიაშვილი', kind: 'PERSON', group: 'STRUCTURAL', roles: [role('მიმდებარე შენობის კონსტრუქციული შეფასება')], official: true },
  { name: 'გიორგი რეხვიაშვილი', kind: 'PERSON', group: 'STRUCTURAL', roles: [role('საძირკვლისა და ძირითადი კონსტრუქციული ელემენტების საექსპერტო შეფასება')], official: true },
  { name: 'ვასილ ტატიაშვილი', kind: 'PERSON', group: 'SAFETY', roles: [role('შენობის უსაფრთხოების მარეგულირებელი შეფასება')], official: true },
  { name: 'ბელა გოგოლაური', kind: 'PERSON', group: 'CONSTRUCTION_ORG', roles: [role('მშენებლობის ორგანიზაციის კალენდარული გეგმა')], official: true },
  { name: 'ია მშვიდობაძე', kind: 'PERSON', group: 'GEOTECHNICAL', roles: [role('საინჟინრო-გეოლოგიური საექსპერტო შეფასება')], official: true },
  // Fragments and identifiers that must never become a card:
  { name: 'ნინო ბერიძე 01024012345', kind: 'PERSON', group: 'OTHER', roles: [role('ექსპერტი')] },
  { name: 'პროექტის ავტორი არქიტექტორი ხელმოწერა და ბეჭედი თარიღი', kind: 'PERSON', group: 'OTHER', roles: [role('ავტორი')] },
  { name: 'არქიტექტორი: გიორგი', kind: 'PERSON', group: 'ARCHITECTURE', roles: [role('არქიტექტორი')] },
  { name: 'ლაშა კაპანაძე', kind: 'PERSON', group: 'OTHER', roles: [{ code: 'OTHER', roleText: '' }] },
];

/* ── project team ─────────────────────────────────────────────────────── */

test('the team is grouped by discipline, in a fixed order, under documented wording', () => {
  const groups = teamGroupsV2(TEAM);
  // Owner, 2026-10-11: the professionals lead, the commissioning side follows.
  assert.deepEqual(groups.map((g) => g.group), ['ARCHITECTURE', 'STRUCTURAL', 'GEOTECHNICAL', 'CONSTRUCTION_ORG', 'SAFETY', 'DEVELOPER']);
  const arch = groups.find((g) => g.group === 'ARCHITECTURE').cards;
  assert.deepEqual(arch.map((c) => c.name), ['დარეჯან შათაშვილი', 'დავით სორდია', 'გიორგი ლეჟავა', 'შპს არტიტექსი'], 'people before their firm, otherwise the record order');
  const chief = arch[0];
  assert.equal(chief.headline.roleText, 'მთავარი არქიტექტორი', 'the headline is the first documented wording');
  assert.equal(chief.organization, 'შპს არტიტექსი');
  assert.equal(chief.roles[0].date, '2025-01-10', 'the expanded list is newest first');
  assert.equal(chief.roles.length, 2);
  assert.equal(chief.headline.sourceUrl, TAS);
  const structural = groups.find((g) => g.group === 'STRUCTURAL').cards.map((c) => c.headline.roleText);
  assert.ok(structural.some((r) => /საძირკვლისა/.test(r)));
  for (const g of groups) for (const c of g.cards) assert.ok(c.headline.roleText && !/^other$/i.test(c.headline.roleText));
});

test('names with digits, more than five words, label fragments or no documented role are dropped', () => {
  const names = teamGroupsV2(TEAM).flatMap((g) => g.cards.map((c) => c.name));
  assert.ok(!names.some((n) => /\d/.test(n)), 'an ID number travelled with a name');
  assert.ok(!names.some((n) => n.split(/\s+/).length > 5), 'a raw fragment became a name');
  assert.ok(!names.includes('არქიტექტორი: გიორგი'));
  assert.ok(!names.includes('ლაშა კაპანაძე'), 'a member with no documented role got a generic card');
  assert.equal(plausibleName('შპს მილენიო გრუპი'), true);
  assert.equal(plausibleName('A'), false);
  assert.equal(plausibleName('ID 123'), false);
});

test('an unsafe source link is never rendered as an href', () => {
  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('tas/abc.pdf'), null);
  assert.equal(safeHref(TAS), TAS);
  const [g] = teamGroupsV2([{ name: 'ია მშვიდობაძე', group: 'GEOTECHNICAL', roles: [role('ექსპერტი', { sourceUrl: 'javascript:x' })] }]);
  assert.equal(g.cards[0].headline.sourceUrl, null);
});

test('without projectTeamV2 the report falls back to the existing people cards', () => {
  assert.deepEqual(teamGroupsV2(undefined), []);
  assert.deepEqual(teamGroupsV2([]), []);
  const ui = code('src/components/verify/PeopleBehind.tsx');
  assert.match(ui, /groups\.length \?[\s\S]{0,400}professional\.length \? <CardGrid/, 'the legacy grid is not the fallback');
  assert.match(ui, /vrx_ownership_note/, 'the not-your-unit note left the ownership group');
  assert.match(ui, /aria-expanded=\{open\}/);
  assert.match(ui, /motion-safe:transition-\[grid-template-rows,opacity\]/, 'the expansion ignores reduced motion');
  assert.match(code('src/components/verify/OfficialLink.tsx'), /target="_blank"[\s\S]{0,40}rel="noopener noreferrer"/);
  const report = code('src/components/verify/VerifyReport.tsx');
  assert.match(report, /teamV2=\{synthesis\.projectTeamV2\}/);
});

/* ── official documents ───────────────────────────────────────────────── */

const DOCS = [
  { caseRef: 'C-2019', documentId: 'd1', caseDate: '2019-05-01', title: 'მშენებლობის ნებართვა', status: 'APPROVED', priority: null, publicUrl: TAS, files: [] },
  { caseRef: 'C-2025', documentId: 'd3', caseDate: '2025-06-01', title: 'პროექტის ცვლილება', status: 'UNDER_REVIEW', priority: 1, publicUrl: TAS, files: [
    { fileName: 'proekti.pdf', format: 'pdf', kind: 'PDF', outcome: 'READ_TEXT', pages: 42, sourceUrl: `${TAS}/f1`, date: null },
    { fileName: 'renders.zip', format: 'zip', kind: 'ARCHIVE', outcome: 'UNSUPPORTED_FORMAT', pages: null, sourceUrl: null, date: null },
    { fileName: 'facade.jpg', format: 'jpg', kind: 'IMAGE', outcome: 'VISUAL', pages: null, sourceUrl: null, date: null },
    { fileName: 'big.pdf', format: 'pdf', kind: 'PDF', outcome: 'DEFERRED', pages: null, sourceUrl: null, date: null },
  ] },
  { caseRef: 'C-2024', documentId: 'd2', caseDate: '2024-02-01', title: '7f3a9c2e-1b4d-4e8a-9c3f-2a1b0c9d8e7f', status: 'SOMETHING', priority: 2, publicUrl: TAS, files: [] },
  { caseRef: 'C-2021', documentId: 'd0', caseDate: '2021-01-01', title: 'განაცხადი', status: '', priority: null, publicUrl: null, files: [] },
];

test('the document explorer puts the two newest applications first, older ones newest first', () => {
  const { recent, earlier } = documentExplorer(DOCS);
  assert.deepEqual(recent.map((c) => c.caseRef), ['C-2025', 'C-2024']);
  assert.deepEqual(earlier.map((c) => c.caseRef), ['C-2021', 'C-2019']);
  // Without server priority, by date.
  const plain = documentExplorer(DOCS.map((d) => ({ ...d, priority: null })));
  assert.deepEqual(plain.recent.map((c) => c.caseRef), ['C-2025', 'C-2024']);
  assert.deepEqual(documentExplorer(undefined), { recent: [], earlier: [] });
});

test('a case is approved only when the record says so; pending is under review', () => {
  const { recent, earlier } = documentExplorer(DOCS, ['C-2024']);
  assert.equal(recent[0].status, 'UNDER_REVIEW');
  assert.equal(recent[1].status, 'UNDER_REVIEW', 'a case named in the pending applications was not shown as under review');
  assert.equal(earlier.find((c) => c.caseRef === 'C-2019').status, 'APPROVED');
  assert.equal(earlier.find((c) => c.caseRef === 'C-2021').status, 'HISTORICAL', 'an unknown status was upgraded');
  assert.equal(caseStatusOf('SOMETHING'), 'HISTORICAL');
  assert.equal(caseStatusOf('APPROVED', true), 'UNDER_REVIEW', 'pending must win over a stale approved label');
});

test('ids never become titles; every file carries a read state and a key', () => {
  const { recent } = documentExplorer(DOCS);
  assert.equal(recent[1].title, null, 'a uuid became the case title');
  assert.equal(readableTitle('12345/2024'), null);
  assert.deepEqual(recent[0].files.map((f) => f.read), ['READ', 'UNSUPPORTED', 'VISUAL', 'DEFERRED']);
  assert.equal(recent[0].files[0].format, 'PDF');
  assert.equal(recent[0].files[0].pages, 42);
  assert.equal(readStateOf('FAILED'), 'NOT_READ');
  for (const k of [...Object.values(DOC_READ_KEY), ...Object.values(DOC_STATUS_KEY)]) assert.equal(valuesOf(k).length, 6, k);
  const ui = code('src/components/verify/OfficialDocuments.tsx');
  assert.ok(!/\{c\.documentId\}/.test(ui), 'an internal id is printed');
  assert.match(ui, /OfficialImagesViewer/, 'extracted images do not open in the report viewer');
});

test('extracted images are linked to their document for the viewer, without carrying the id into the view', () => {
  const SIGNED = `https://ptx.supabase.co/storage/v1/object/sign/verify-official-visuals/tas/${'a'.repeat(64)}.jpg?token=x`;
  const raw = [{ id: 'v1', kind: 'RENDER', url: SIGNED, fileName: 'facade.jpg', documentRef: { source: 'TAS', documentId: 'd3' } }];
  assert.deepEqual(visualSources(raw).get('v1'), { documentId: 'd3', fileName: 'facade.jpg' });
  assert.ok(!JSON.stringify(catalogVisuals(raw)).includes('d3'), 'the document id entered the catalogued view');
  assert.equal(visualSources(undefined).size, 0);
});

/* ── legal position ───────────────────────────────────────────────────── */

test('the effective decision comes first; pending applications are under review, never approved', () => {
  const pos = legalPosition({
    currentPosition: {
      effective: { kind: 'PERMIT', date: '2022-04-12', decisionNumber: '01-123', caseRef: 'C-2022' },
      pending: [{ caseRef: 'C-2025', date: '2025-06-01', deadline: null, subject: 'სართულის დამატება', status: 'UNDER_REVIEW' }],
      conflicts: [{}],
    },
    pendingApplications: [{ caseRef: 'C-2025', date: '2025-06-01', deadline: '2025-08-01', subject: null, status: 'UNDER_REVIEW' }],
  });
  assert.equal(pos.effective.kindKey, 'verify_ox_kind_permit');
  assert.equal(pos.effective.decisionNumber, '01-123');
  assert.equal(pos.pending.length, 1, 'the same case listed twice');
  assert.equal(pos.pending[0].deadline, '2025-08-01');
  assert.equal(pos.pending[0].subject, 'სართულის დამატება');
  assert.equal(pos.conflicts, 1);
  assert.equal(legalPosition({}), null);
  assert.equal(legalPosition(null), null);
  assert.equal(legalPosition({ currentPosition: { effective: { kind: 'WHATEVER', date: '2020-01-01' } } }).effective.kindKey, 'verify_ox_kind_decision');

  // The wording: "under review — not yet decided", and a note that says it is not an approval.
  const chip = valuesOf('verify_v3_pending_chip');
  assert.equal(chip.length, 6);
  assert.match(chip[0], /under review — not yet decided/i);
  assert.match(valuesOf('verify_v3_pending_note')[0], /not an approval/i);
  for (const v of valuesOf('verify_v3_pending_chip')) assert.ok(!/approved|დამტკიც|утвержд|onaylı|معتمد|אושר/i.test(v), `pending reads as approved: ${v}`);
  const ui = code('src/components/verify/LegalReality.tsx');
  const pendingBlock = ui.slice(ui.indexOf('data-pending'));
  assert.ok(!/emerald/.test(pendingBlock.slice(0, pendingBlock.indexOf('conflicts ?'))), 'a pending application is painted as confirmed');
  const report = code('src/components/verify/VerifyReport.tsx');
  assert.ok(report.indexOf('<LegalFindings') > -1 && report.indexOf('<LegalFindings') < report.indexOf('<LegalPosition'), 'the dated legal findings do not open the legal chapter');
});

/* ── specifications ───────────────────────────────────────────────────── */

test('specifications are grouped for a buyer, with approved and proposed side by side', () => {
  const groups = specGroups([
    { key: 'floors', label: 'სართულები', value: '12', numeric: 12, unit: null, status: 'APPROVED' },
    { key: 'landArea', label: 'მიწის ნაკვეთის ფართი', value: '1 250', numeric: 1250, unit: 'მ²', status: 'APPROVED' },
    { key: 'K2', label: 'კ-2', value: '3.2', numeric: 3.2, unit: null, status: 'APPROVED' },
    { key: 'floors', label: 'სართულები', value: '14', numeric: 14, unit: null, status: 'PROPOSED' },
    { key: 'residentialArea', label: 'საცხოვრებელი ფართი', value: '9 800 მ²', unit: 'მ²', status: 'UNKNOWN' },
    { key: 'foundationType', label: 'საძირკველი', value: 'ფილა', status: 'APPROVED' },
    { key: 'facadeMaterial', label: 'ფასადის მასალა', value: 'ტრავერტინი', status: 'PROPOSED' },
    { key: 'elevators', label: 'ლიფტები', value: '2', status: 'APPROVED' },
    { key: 'bad', label: '', value: 'x' },
  ]);
  assert.deepEqual(groups.map((g) => g.group), ['SITE', 'VOLUME', 'AREAS', 'STRUCTURE', 'FACADE', 'TRANSPORT']);
  const site = groups.find((g) => g.group === 'SITE').rows;
  assert.equal(site[0].value, '1 250 მ²', 'the unit was not attached');
  const vol = groups.find((g) => g.group === 'VOLUME').rows;
  assert.deepEqual(vol.map((r) => [r.value, r.status]), [['12', 'APPROVED'], ['14', 'PROPOSED']]);
  assert.equal(groups.find((g) => g.group === 'AREAS').rows[0].value, '9 800 მ²', 'a unit was doubled');
  assert.equal(specGroupOf('totalFloorArea', 'Total floor area'), 'AREAS');
  assert.deepEqual(specGroups(undefined), []);
  for (const k of Object.values(SPEC_STATUS_KEY)) assert.equal(valuesOf(k).length, 6, k);
  for (const g of Object.values(SPEC_GROUP_KEY)) {
    assert.equal(valuesOf(g.title).length, 6, g.title);
    if (g.meaning) assert.equal(valuesOf(g.meaning).length, 6, g.meaning);
  }
  const ui = code('src/components/verify/BuildingSpecs.tsx');
  assert.ok(!/score/i.test(ui), 'the specifications grew a score');
});

/* ── register ─────────────────────────────────────────────────────────── */

test('the register card names owners only, separates parcel security, and discloses a reused extract', () => {
  const reg = {
    cadastralCode: '01.18.06.019.055.03.01.503',
    latest: { owners: [{ kind: 'PERSON', name: 'თამარ გელაშვილი 01024012345' }, { kind: 'COMPANY', name: 'შპს მილენიო გრუპი' }] },
    currentMortgages: [{ creditor: 'სს "საქართველოს ბანკი"' }, { creditor: 'სს "თიბისი ბანკი"', level: 'PARCEL' }],
    removedMortgages: [{ creditor: 'x' }],
    proceedings: [],
  };
  const v = registerView(reg, { jobId: 'j1', asOf: '2026-09-30T10:00:00Z', reused: true });
  assert.deepEqual(v.owners.map((o) => o.name), ['თამარ გელაშვილი', 'შპს მილენიო გრუპი'], 'a personal number travelled with a name');
  assert.equal(v.unitMortgages.length, 1);
  assert.equal(v.parcelMortgages.length, 1);
  assert.equal(v.removed, 1);
  assert.deepEqual(v.disclosure, { date: '2026-09-30' });
  assert.equal(registerView(reg, { asOf: '2026-09-30', reused: false }).disclosure, null, 'a fresh extract was called reused');
  assert.equal(registerView(reg, null).disclosure, null);
  // A parcel extract: every mortgage is parcel-level.
  assert.equal(isParcelCode('01.18.06.019.055'), true);
  assert.equal(registerView({ ...reg, cadastralCode: '01.18.06.019.055' }).parcelMortgages.length, 2);
  assert.equal(registerView({}), null);
  assert.match(valuesOf('verify_v3_reg_reused')[0], /earlier check/);
  assert.match(valuesOf('verify_v3_reg_reused')[1], /\{\{date\}\}/);
  const report = code('src/components/verify/VerifyReport.tsx');
  assert.match(report, /<PropertyRegisterCard register=\{synthesis\.propertyRegister\} source=\{synthesis\.registerSource \?\? null\} \/>/);
});

/* ── plumbing & i18n ──────────────────────────────────────────────────── */

test('the normaliser passes the v3 contract through, and tolerates its absence', () => {
  const base = { report: { summary: { label: 'BALANCED', statement: 'S.' }, sections: [{ key: 'QUALITY', title: 'Q', body: 'B.' }] } };
  const { result } = normalizeVerifyResult({
    raw: { ...base, projectTeamV2: TEAM, technicalSpecs: [{ key: 'floors', label: 'F', value: '1' }], officialDocuments: DOCS, registerSource: { jobId: 'j', asOf: '2026-01-01', reused: true } },
    jobStatus: 'COMPLETED',
  });
  assert.equal(result.projectTeamV2.length, TEAM.length);
  assert.equal(result.technicalSpecs.length, 1);
  assert.equal(result.officialDocuments.length, DOCS.length);
  assert.equal(result.registerSource.reused, true);
  const old = normalizeVerifyResult({ raw: base, jobStatus: 'COMPLETED' }).result;
  assert.equal(old.projectTeamV2, null);
  assert.equal(old.officialDocuments, null);
});

test('every v3 key is in all six locales with its placeholders, in the house terminology', () => {
  for (const [key, values] of Object.entries(VERIFY_REPORT_V3_STRINGS)) {
    const inBundle = valuesOf(key);
    assert.equal(inBundle.length, 6, `${key} is missing from some locale`);
    const want = (values[0].match(/\{\{\w+\}\}/g) ?? []).sort().join();
    for (const v of inBundle) assert.equal((v.match(/\{\{\w+\}\}/g) ?? []).sort().join(), want, `${key}: ${v}`);
  }
  for (const g of TEAM_GROUP_ORDER) assert.equal(valuesOf(TEAM_GROUP_KEY[g]).length, 6, TEAM_GROUP_KEY[g]);
  const all = Object.values(VERIFY_REPORT_V3_STRINGS).flat().join('\n');
  assert.ok(!/confirmed buyer|შესატყვისი/i.test(all));
});

/* ── production report 01.18.06.019.055.03.01.601 (sanitized fixture) ──── */

import { STORED_SYNTHESIS, customerSynthesis, VISUAL_IDS } from './fixtures/job601Synthesis.mjs';
import { caseCount, isAuthority, TEAM_GROUP_DUTY_KEY } from '../reportPresentation.ts';
import { scopeKeyFor } from '../visualCatalog.ts';
import { VERIFY_P0_UI_STRINGS } from '../../../scripts/verify-p0-ui-i18n-data.mjs';

test('job 601: the documented team renders as disciplines, without extraction noise or the city authority', () => {
  const groups = teamGroupsV2(STORED_SYNTHESIS.projectTeamV2);
  const by = Object.fromEntries(groups.map((g) => [g.group, g.cards]));
  assert.deepEqual(groups.map((g) => g.group), ['ARCHITECTURE', 'APPLICANTS', 'OTHER']);
  // The two chief architects, headed by their architect role — not by "applicant".
  assert.deepEqual(by.ARCHITECTURE.map((c) => c.name), ['დარეჯან შათაშვილი', 'დავით ლოსაბერიძე']);
  for (const c of by.ARCHITECTURE) {
    assert.equal(c.headline.code, 'CHIEF_ARCHITECT');
    assert.equal(c.headline.labelKey, 'verify_p0_role_chief_architect', 'a form label ("…სახელი და გვარი") reached the reader as a role');
    assert.ok(caseCount(c) >= 6, 'the evidence drawer lost cases');
    assert.ok(c.roles.every((r) => r.sourceUrl?.startsWith('https://docs.tbilisi.gov.ge/')));
  }
  // The developer's director commissioned and applied — he is never seated among the architects.
  assert.ok(by.APPLICANTS.some((c) => c.name === 'ლევან ჩაჩუა' && c.headline.labelKey === 'vrx_team_role_client'));
  assert.ok(!by.ARCHITECTURE.some((c) => c.name === 'ლევან ჩაჩუა'));
  const names = groups.flatMap((g) => g.cards.map((c) => c.name));
  for (const noise of ['•••) ნაცვლად - შპს „ქეი-ელ-გრუპი“', '•••) ნაცვლად დაფიქსირდეს შპს', 'გამოყენებული წესები', 'მრავალბინიანი საცხოვრებელი სახლი', 'ქ. თბილისის მუნიციპალიტეტის სსიპ']) {
    assert.ok(!names.includes(noise), `"${noise}" became a person`);
  }
  assert.equal(isAuthority('ქ. თბილისის მუნიციპალიტეტის სსიპ'), true);
  // No role shown to a reader carries a personal-number marker.
  for (const c of groups.flatMap((g) => g.cards)) for (const r of c.roles) assert.ok(!/პ\/ნ/.test(r.roleText));
  // The non-official supplier is shown, and as public.
  assert.equal(by.OTHER[0].name, 'GBS');
  assert.equal(by.OTHER[0].official, false);
  for (const g of ['ARCHITECTURE', 'APPLICANTS']) assert.ok(TEAM_GROUP_DUTY_KEY[g], g);
});

test('job 601: all 24 official visuals survive forCustomer and the catalogue, labelled as project-wide', async () => {
  const s = await customerSynthesis();
  assert.equal(s.officialVisuals.length, 24);
  const cat = catalogVisuals(s.officialVisuals, s.report.visualExplanations, s.report.visualCaptions);
  assert.deepEqual(cat.map((v) => v.id), VISUAL_IDS);
  for (const v of cat) {
    assert.equal(scopeKeyFor(v), 'verify_p0_scope_project', 'a project-wide image was given a narrower scope');
    assert.notEqual(v.badge, 'EXACT_UNIT_PLAN');
    assert.ok(v.documentId, 'the image lost its case');
    assert.ok(v.explanation?.what);
  }
  // A forged exact-unit drawing is never presented as this apartment's plan.
  const [forged] = catalogVisuals([{ ...s.officialVisuals[6], kind: 'ELEVATION', scope: 'EXACT_UNIT' }]);
  assert.equal(scopeKeyFor(forged), 'verify_p0_scope_building');
  const [unresolved] = catalogVisuals([{ ...s.officialVisuals[6], kind: 'UNIT_PLAN', scope: 'EXACT_UNIT' }], [], [], { identityUnresolved: true });
  assert.notEqual(unresolved.badge, 'EXACT_UNIT_PLAN');
  assert.equal(scopeKeyFor(unresolved, true), 'verify_p0_scope_building');
});

test('job 601: the report renders the gallery near the top and the team with evidence, once', () => {
  const report = code('src/components/verify/VerifyReport.tsx');
  assert.match(report, /<VisualExplorer[\s\S]{0,400}docs=\{synthesis\.officialDocuments\}/, 'the gallery lost its case links');
  assert.match(report, /directors=\{directors\}/, 'directors are not passed to the team');
  assert.match(report, /teamV2Groups\.length \? \[\] : inChapter\('people'\)/, 'the people prose repeats the documented team');
  assert.match(report, /people\.length && !companyListsDirectors/, 'the directors tree repeats the company card');
  const ui = code('src/components/verify/PeopleBehind.tsx');
  assert.match(ui, /verify_p0_team_evidence_show/);
  assert.match(ui, /r\.labelKey \? t\(r\.labelKey\) : r\.roleText/);
  const gallery = code('src/components/verify/VisualExplorer.tsx');
  assert.match(gallery, /<ScopeChip v=\{active\}/, 'the stage image has no scope label');
  assert.match(gallery, /data-gallery-count=\{usable\.length\}/);
  const company = code('src/components/verify/CompanyIntelligenceCard.tsx');
  assert.match(company, /REPRESENTATION_CODE_KEY\[role\.toUpperCase\(\)\]/, 'a representation code prints as English');
});

test('the P0 copy: six locales, placeholders intact, the house terminology', () => {
  const used = new Set();
  for (const f of ['src/components/verify/PeopleBehind.tsx', 'src/components/verify/VisualExplorer.tsx', 'src/components/verify/VerifyReport.tsx', 'src/components/verify/CompanyIntelligenceCard.tsx', 'src/verify/reportPresentation.ts', 'src/verify/visualCatalog.ts']) {
    for (const m of read(f).matchAll(/'(verify_p0_[a-z0-9_]+)'/g)) used.add(m[1]);
  }
  for (const k of used) assert.ok(VERIFY_P0_UI_STRINGS[k] || valuesOf(k).length === 6, `${k} has no copy`);
  for (const [key, values] of Object.entries(VERIFY_P0_UI_STRINGS)) {
    assert.equal(values.length, 6, key);
    const want = (values[0].match(/\{\{\w+\}\}/g) ?? []).sort().join();
    for (const v of values) {
      assert.ok(v.trim(), `${key} is empty`);
      assert.equal((v.match(/\{\{\w+\}\}/g) ?? []).sort().join(), want, `${key}: ${v}`);
    }
    assert.ok(!/[a-z]{4}/i.test(values[1].replace(/\{\{\w+\}\}/g, '')), `${key}: Latin text in Georgian`);
  }
  const all = Object.values(VERIFY_P0_UI_STRINGS).flat().join('\n');
  assert.ok(!/confirmed buyer|შესატყვისი|ტბილისი/i.test(all));
});
