// The rebuilt customer Verify report (2026-10): story-first chapters, the
// visual explorer, legal reality and the identity notice.
//
// Accuracy first: these tests hold what the reader is TOLD — a status is
// never upgraded, an asset is never unlabelled, an unread record is never a
// "no" — and that the case page receives the same synthesis as /verify.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  catalogVisuals,
  categoryTabs,
  heroVisual,
  signedVisualUrl,
  badgeFor,
  BADGE_KEY,
  CATEGORY_KEY,
} from '../visualCatalog.ts';
import {
  LEGAL_STATUS_VIEW,
  legalRows,
  identityNotice,
  timelineGroups,
  yearSpan,
  peopleCards,
  chapterOfSection,
  SECTION_HEADING_KEY,
  LEGAL_CLAIM_KEY,
} from '../reportPresentation.ts';
import { normalizeVerifyResult } from '../resultNormalizer.ts';
import { marketView, TIER_KEY, REASON_KEY, AREA_KEYS } from '../marketPresentation.ts';
import { VERIFY_REPORT_UI_STRINGS } from '../../../scripts/verify-report-ui-i18n-data.mjs';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const code = (p) => read(p).replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
const translations = () => read('src/i18n/translations.ts');
const valuesOf = (key) => [...translations().matchAll(new RegExp(`^  ${key}: '((?:[^'\\\\]|\\\\.)*)',$`, 'gm'))].map((m) => m[1]);

const SIGNED = (n) => `https://ptx.supabase.co/storage/v1/object/sign/verify-official-visuals/tas/${'a'.repeat(63)}${n}.jpg?token=x`;

/* ── one synthesis, through both doors ───────────────────────────────── */

test('toVerifySynthesis passes every synthesis field through', () => {
  const view = code('src/components/verify/VerifyResultView.tsx');
  const fn = view.slice(view.indexOf('export function toVerifySynthesis'), view.indexOf('const StageProgress'));
  assert.match(fn, /\.\.\.\(rest as unknown as/, 'fields are listed one by one again, so new ones get dropped');
  // Only fields the report has no type for may be left out.
  const dropped = [...fn.matchAll(/(\w+): _\w+/g)].map((m) => m[1]);
  const report = read('src/components/verify/VerifyReport.tsx');
  const i = report.indexOf('export interface VerifySynthesis');
  const type = report.slice(i, report.indexOf('\n}', i));
  const keys = [...type.matchAll(/^\s{2}(\w+)\?*:/gm)].map((m) => m[1]);
  for (const k of ['propertyRegister', 'companyFinance', 'projectTeam', 'marketContext', 'evidenceGroups', 'checklist', 'identity', 'officialHistory', 'developerAds']) {
    assert.ok(keys.includes(k), `VerifySynthesis has no ${k}`);
  }
  for (const d of dropped) assert.ok(!keys.includes(d), `toVerifySynthesis drops ${d}, which the report renders`);
});

test('the normaliser keeps the deterministic blocks the case page used to lose', () => {
  const payload = {
    report: { summary: { label: 'BALANCED', statement: 'S.' }, sections: [{ key: 'QUALITY', title: 'შენობა და ხარისხი', body: 'Frame.' }],
      visualExplanations: [{ id: 'v1', what: 'The facade.', interesting: '', buyerMeaning: 'Shows the design.', uncertain: '' }],
      advertisingAssessment: { summary: 'x' } },
    propertyRegister: { latest: { owners: [] } },
    companyFinance: { companyName: 'X' },
    projectTeam: [{ name: 'Studio A', roles: ['ARCHITECT'], basis: 'OFFICIAL' }],
    marketContext: { medianPerSqm: 1 },
    evidenceGroups: [{ key: 'g', items: [] }],
    checklist: [{ id: 'c1' }],
    identity: { status: 'UNRESOLVED_MISMATCH', requested: '01.18.06.019.055.03.01.503' },
  };
  const { result } = normalizeVerifyResult({ raw: payload, jobStatus: 'COMPLETED' });
  for (const k of ['propertyRegister', 'companyFinance', 'projectTeam', 'marketContext', 'evidenceGroups', 'checklist', 'identity']) {
    assert.ok(result[k] && (Array.isArray(result[k]) ? result[k].length : Object.keys(result[k]).length), `${k} was dropped`);
  }
  assert.equal(result.report.visualExplanations[0].id, 'v1');
  assert.ok(result.report.advertisingAssessment, 'the advertising assessment was dropped');
  assert.equal(result.report.sections[0].key, 'QUALITY');
});

/* ── legal reality ───────────────────────────────────────────────────── */

test('NOT_VERIFIED is never shown as negative', () => {
  assert.equal(LEGAL_STATUS_VIEW.NOT_VERIFIED.tone, 'neutral');
  for (const v of Object.values(LEGAL_STATUS_VIEW)) assert.notEqual(v.tone, 'negative');
  const values = valuesOf('vrx_legal_status_not_verified');
  assert.equal(values.length, 6);
  assert.match(values[0], /could not be confirmed/i);
  // None of the six opens with, or is, a bare negative.
  for (const v of values) assert.ok(!/^(no|არა|нет|hayır|لا|לא)\b/iu.test(v.trim()), `reads as a "no": ${v}`);
  const ui = code('src/components/verify/LegalReality.tsx');
  assert.match(ui, /LEGAL_STATUS_VIEW\[r\.status\]/, 'the component chooses its own presentation');
  assert.ok(!/destructive/.test(ui), 'a legal state is painted as a defect');
});

test('legal rows keep the data status and never upgrade an unknown one', () => {
  const rows = legalRows([
    { key: 'PERMIT_ISSUED', status: 'CONFIRMED', basis: [{ caseRef: 'C', decisionNumber: '1', date: '2022-01-01', block: null }] },
    { key: 'COMMISSIONING_APPROVED', status: 'SOMETHING_NEW', basis: [] },
  ]);
  assert.deepEqual(rows.map((r) => r.key), ['PERMIT_ISSUED', 'CONSTRUCTION_STARTED', 'CONSTRUCTION_COMPLETED', 'COMMISSIONING_APPLIED', 'COMMISSIONING_APPROVED']);
  assert.equal(rows[0].status, 'CONFIRMED');
  assert.equal(rows[1].status, 'NOT_VERIFIED', 'a missing claim is shown as anything but unconfirmed');
  assert.equal(rows[4].status, 'NOT_VERIFIED', 'an unknown status was upgraded');
  assert.deepEqual(legalRows(null), []);
  for (const k of Object.values(LEGAL_CLAIM_KEY)) assert.equal(valuesOf(k).length, 6, k);
});

test('the identity notice shows for an unresolved mismatch, with the codes', () => {
  const n = identityNotice({ status: 'UNRESOLVED_MISMATCH', requested: '01.18.06.019.055.03.01.503', nearMatches: ['01.18.06.019.055.01.01.503'] });
  assert.ok(n);
  assert.equal(n.key, 'vrx_identity_mismatch');
  assert.deepEqual(n.codes, ['01.18.06.019.055.01.01.503']);
  assert.equal(n.vars.requested, '01.18.06.019.055.03.01.503');
  assert.equal(identityNotice({ status: 'PARCEL_ONLY', requested: 'r', parcel: '01.18.06.019.055' }).key, 'vrx_identity_parcel_only');
  assert.equal(identityNotice({ status: 'CONFIRMED' }), null);
  assert.equal(identityNotice({ status: 'NOT_VERIFIED' }), null);
  assert.equal(identityNotice(null), null);
  const report = code('src/components/verify/VerifyReport.tsx');
  assert.match(report, /<IdentityNotice identity=\{identity\} \/>/, 'the notice is never mounted');
});

/* ── the visual explorer ─────────────────────────────────────────────── */

test('every catalogued asset carries a label, in all six locales', () => {
  const kinds = ['PHOTO', 'RENDER', 'CONSTRUCTION_PHOTO', 'SITE_PLAN', 'MASTER_PLAN', 'FLOOR_PLAN', 'UNIT_PLAN', 'SECTION', 'ELEVATION', 'FACADE', 'STRUCTURAL', 'ENGINEERING', 'LOCATION_DIAGRAM', 'OTHER', 'LANDSCAPE', 'OTHER_DRAWING', 'WHATEVER'];
  const vs = catalogVisuals(kinds.map((kind, i) => ({ id: `v${i}`, kind, url: SIGNED(i) })));
  assert.equal(vs.length, kinds.length);
  for (const v of vs) {
    assert.ok(BADGE_KEY[v.badge], `${v.kind} has no label`);
    assert.equal(valuesOf(BADGE_KEY[v.badge]).length, 6, BADGE_KEY[v.badge]);
  }
  for (const k of Object.values(CATEGORY_KEY)) assert.equal(valuesOf(k).length, 6, k);
  const ui = code('src/components/verify/VisualExplorer.tsx');
  assert.match(ui, /alt=\{at\.alt\}/, 'the stage image has no alt text');
  assert.match(ui, /t\(BADGE_KEY\[v\.badge\]\)/, 'the badge is not rendered from the label map');
});

test('a label is never stronger than the data', () => {
  assert.equal(badgeFor('UNIT_PLAN', null), 'PLAN', 'a plan without a scope became an exact apartment plan');
  assert.equal(badgeFor('FLOOR_PLAN', 'EXACT_UNIT'), 'EXACT_UNIT_PLAN');
  assert.equal(badgeFor('FLOOR_PLAN', 'EXACT_UNIT', true), 'PLAN', 'an unresolved identity still claims the exact apartment');
  assert.equal(badgeFor('FLOOR_PLAN', 'TYPICAL_FLOOR'), 'TYPICAL_FLOOR_PLAN');
  assert.equal(badgeFor('UNIT_PLAN', 'BUILDING'), 'GENERAL_PLAN');
  assert.equal(badgeFor('RENDER', 'EXACT_UNIT'), 'RENDER', 'a render was presented as anything but illustrative');
  // The original shape: a role-only render is still a render.
  assert.equal(catalogVisuals([{ id: 'x', role: 'LATEST_RENDER', url: SIGNED(1) }])[0].badge, 'RENDER');
});

test('only signed storage URLs survive; broken and non-image assets are dropped', () => {
  assert.equal(signedVisualUrl('https://myhome.ge/photo.jpg'), null);
  assert.equal(signedVisualUrl('tas/abc.jpg'), null);
  assert.equal(signedVisualUrl('data:image/png;base64,AAAA'), null);
  assert.equal(signedVisualUrl('https://x.supabase.co/storage/v1/object/public/b/a.jpg'), null);
  assert.ok(signedVisualUrl(SIGNED(1)));
  const vs = catalogVisuals([
    { id: 'a', kind: 'PHOTO', url: 'https://ss.ge/a.jpg' },
    { id: 'b', kind: 'PHOTO', url: SIGNED(2) },
    { id: 'b', kind: 'PHOTO', url: SIGNED(3) },
    { id: 'c', kind: 'SITE_PLAN', url: SIGNED(4), mime: 'application/pdf' },
    { id: '', kind: 'PHOTO', url: SIGNED(5) },
    { id: 'd', kind: 'FACADE', signedUrl: SIGNED(6) },
  ]);
  assert.deepEqual(vs.map((v) => v.id), ['b', 'd']);
  // An image that fails to load is removed at render time.
  const ui = code('src/components/verify/VisualExplorer.tsx');
  assert.match(ui, /onError=\{\(\) => onBroken\(/);
  assert.match(ui, /catalog\.filter\(\(v\) => !broken\.has\(v\.id\)\)/);
});

test('tabs exist only for categories that hold an asset, in a fixed order', () => {
  const vs = catalogVisuals([
    { id: 's', kind: 'STRUCTURAL', url: SIGNED(1) },
    { id: 'r', kind: 'RENDER', url: SIGNED(2) },
    { id: 'p', kind: 'FLOOR_PLAN', url: SIGNED(3), category: 'APARTMENT', scope: 'TYPICAL_FLOOR' },
    { id: 'q', kind: 'PHOTO', url: SIGNED(4), category: 'BUILDING' },
  ]);
  assert.deepEqual(categoryTabs(vs), [
    { category: 'BUILDING', count: 2 },
    { category: 'APARTMENT', count: 1 },
    { category: 'STRUCTURE', count: 1 },
  ]);
  assert.equal(heroVisual(vs).id, 'q', 'a real photo of the building should open the section');
  assert.equal(heroVisual([]), null);
});

test('with nothing to show the explorer says so — no stock imagery', () => {
  assert.deepEqual(catalogVisuals(undefined), []);
  assert.deepEqual(categoryTabs([]), []);
  const ui = code('src/components/verify/VisualExplorer.tsx');
  assert.match(ui, /if \(!usable\.length\) \{[\s\S]{0,400}vrx_explore_empty/);
  assert.match(valuesOf('vrx_explore_empty')[0], /does not substitute stock photos/);
  assert.ok(!/unsplash|pexels|placeholder\.(com|jpg|png)/i.test(ui), 'a stock image source appeared');
});

test('the lightbox is keyboard operable, traps focus and returns it', () => {
  const ui = code('src/components/verify/VisualExplorer.tsx');
  assert.match(ui, /createPortal\(/);
  assert.match(ui, /role="dialog"/);
  assert.match(ui, /aria-modal="true"/);
  for (const key of ["'Escape'", "'ArrowRight'", "'ArrowLeft'", "'+'", "'-'", "'Tab'"]) assert.ok(ui.includes(key), `${key} is not handled`);
  assert.match(ui, /previous\?\.focus/, 'focus is not returned to the trigger');
  assert.match(ui, /role="tablist"/);
  assert.match(ui, /tabIndex=\{selected \? 0 : -1\}/, 'the tabs have no roving tabindex');
  assert.match(ui, /motion-safe:/, 'transitions ignore reduced motion');
});

/* ── structure ───────────────────────────────────────────────────────── */

test('QUALITY renders as its own section, with its own heading', () => {
  const report = read('src/components/verify/VerifyReport.tsx');
  assert.match(report, /const READING_ORDER = \[[^\]]*'QUALITY'/);
  assert.equal(chapterOfSection('QUALITY'), 'building');
  assert.equal(chapterOfSection('PROJECT'), 'building');
  assert.equal(chapterOfSection('LEGAL'), 'legal', 'a stored legacy section was dropped');
  assert.equal(chapterOfSection('SOMETHING_OLD'), 'final', 'an unknown stored section was dropped');
  assert.equal(SECTION_HEADING_KEY.QUALITY, 'vrx_section_quality');
  assert.deepEqual(valuesOf('vrx_section_quality').slice(1, 2), ['შენობა და ხარისხი']);
  assert.match(report, /\{inChapter\('building'\)\.map\(renderSection\)\}/);
  assert.match(report, /SECTION_HEADING_KEY\[s\.key\]/);
});

test('the evidence drawer, research transparency and the glance are not rendered', () => {
  const report = code('src/components/verify/VerifyReport.tsx');
  assert.ok(!/<EvidenceSources/.test(report), 'the evidence sources drawer is back in the customer report');
  assert.ok(!/<ResearchTransparency/.test(report), 'research transparency is back in the customer report');
  assert.ok(!/<ExecutiveGlance/.test(report), 'the glance tiles repeat the register card again');
  // The data paths stay: evidence groups still reach the type.
  assert.match(read('src/components/verify/VerifyReport.tsx'), /evidenceGroups\?: EvidenceGroup\[\]/);
});

test('the chapters appear in the story-first order', () => {
  const report = code('src/components/verify/VerifyReport.tsx');
  const ids = ['vbi-summary', 'vbi-explore', 'vbi-story', 'vbi-people', 'vbi-building', 'vbi-legal', 'vbi-location', 'vbi-market', 'vbi-final'];
  const at = ids.map((id) => report.indexOf(`id="${id}"`));
  for (let i = 0; i < ids.length; i++) assert.ok(at[i] > 0, `${ids[i]} is missing`);
  for (let i = 1; i < ids.length; i++) assert.ok(at[i] > at[i - 1], `${ids[i]} is out of order`);
  // Attention points live in the legal chapter, once.
  assert.equal((report.match(/r\.attentionPoints\.map/g) ?? []).length, 1);
  assert.ok(report.indexOf('r.attentionPoints.map') > at[5] && report.indexOf('r.attentionPoints.map') < at[6]);
  for (const c of ['explore', 'story', 'people', 'building', 'legal', 'location', 'market', 'final']) {
    assert.equal(valuesOf(`vrx_nav_${c}`).length, 6, `vrx_nav_${c}`);
  }
});

test('the market headline appears only for a RANGE; otherwise the evidence is called limited', () => {
  const ranged = marketView({
    currency: 'USD',
    headline: { state: 'RANGE', basis: 'SAME_STREET', tiersUsed: ['SAME_STREET', 'PEER_PROJECT'], median: 1500, mean: 1510, min: 1300, max: 1700, count: 7, outliersTrimmed: 1, minimumSample: 3, trimMethod: 'IQR_1_5' },
    projectAskingEvidence: [{ kind: 'ASKING', origin: 'DEVELOPER_MARKETING', pricePerSqm: 1400, currency: 'USD', state: 'ACTIVE', url: 'https://x.ge/a', notTransaction: true }],
    projectAskingRange: null,
    ranked: [
      { tier: 'SAME_STREET', pricePerSqm: 1450, currency: 'USD', headlineEligible: true, district: 'KRTSANISI', relevanceReasons: ['SAME_STREET', 'SIZE_SIMILAR', 'CONDITION_MISMATCH', 'HEADLINE_ELIGIBLE'], url: 'https://ss.ge/1', state: 'ACTIVE' },
      { tier: 'SAME_STREET', pricePerSqm: 3450, currency: 'USD', headlineEligible: true, outlier: true, relevanceReasons: [] },
      { tier: 'WIDER_MARKET', pricePerSqm: 900, currency: 'USD', headlineEligible: false, relevanceReasons: [] },
    ],
    tiers: [{ tier: 'WIDER_MARKET', median: 1100, min: 800, max: 1500, count: 40, thin: false, contextOnly: true, outliersTrimmed: 0 }],
  });
  assert.equal(ranged.headline.state, 'RANGE');
  assert.deepEqual(ranged.headline.tiers, ['SAME_STREET', 'PEER_PROJECT']);
  assert.equal(ranged.comparables.length, 1, 'an outlier or a context-only listing joined the comparison');
  assert.equal(ranged.comparables[0].districtKey, 'vrx_area_krtsanisi');
  assert.deepEqual(ranged.comparables[0].fits, ['vrx_mr_same_street', 'vrx_mr_size_similar']);
  assert.deepEqual(ranged.comparables[0].differs, ['vrx_mr_condition_mismatch']);
  assert.ok(!JSON.stringify(ranged).includes('http'), 'a URL reached the market view');
  assert.equal(ranged.asking[0].originKey, 'vrx_mkt_origin_developer_marketing');
  assert.deepEqual(ranged.context.map((c) => c.tier), ['WIDER_MARKET']);

  const limited = marketView({ currency: 'USD', headline: { state: 'EVIDENCE_LIMITED', basis: 'EVIDENCE_LIMITED', tiersUsed: [], median: null, min: null, max: null, count: 2, minimumSample: 3 } });
  assert.deepEqual(limited.headline, { state: 'EVIDENCE_LIMITED', count: 2, minimumSample: 3 });
  // A RANGE without numbers is never drawn as one.
  assert.equal(marketView({ headline: { state: 'RANGE', median: null, min: null, max: null, count: 5 } }).headline.state, 'EVIDENCE_LIMITED');
  // An older stored market shape gives prose only.
  assert.equal(marketView({ currency: 'USD', median: 1000, min: 900, max: 1100, count: 12 }), null);

  const ui = code('src/components/verify/MarketPosition.tsx');
  assert.match(ui, /h\?\.state === 'RANGE' \?/, 'the headline is drawn without checking its state');
  assert.match(ui, /vrx_mkt_project_asking_note/, 'project asks are not labelled as asking prices');
  assert.ok(!/ComparablesCard|MarketRangeCard|activeMin|activeMax/.test(ui), 'the legacy market cards are back');
  assert.ok(!/\.url\b/.test(ui), 'the market card renders a listing URL');
  for (const k of Object.values(TIER_KEY)) assert.equal(valuesOf(k).length, 6, k);
  assert.equal(valuesOf('cmp_reason_peer_project')[0], 'A comparable development nearby');
  for (const r of Object.values(REASON_KEY)) assert.equal(valuesOf(r.key).length, 6, r.key);
  for (const a of AREA_KEYS) assert.equal(valuesOf(`vrx_area_${a.toLowerCase()}`).length, 6, a);
});

test('the final visual contract: generic material, other buildings, explanation precedence', () => {
  const [low, other, own, kind] = catalogVisuals(
    [
      { id: 'a', kind: 'OTHER', confidence: 0.3, url: SIGNED(1) },
      { id: 'b', kind: 'FLOOR_PLAN', scope: 'PROJECT', matchBasis: 'OTHER_BUILDING', block: '01', url: SIGNED(2), documentRef: { documentId: 'secret' } },
      { id: 'c', kind: 'PHOTO', url: SIGNED(3), explanation: { what: 'Own', interesting: '', buyerMeaning: '', uncertain: 'u' } },
      { id: 'd', kind: 'ELEVATION', url: SIGNED(4) },
    ],
    [{ id: 'c', what: 'Report-level' }, { id: 'd', what: 'From report' }],
    [{ visualId: 'd', caption: 'Legacy', explanation: 'Legacy text' }],
  );
  assert.equal(low.badge, 'MATERIAL', 'a low-confidence asset is labelled as something specific');
  assert.equal(other.otherBuilding, true);
  assert.equal(other.badge, 'GENERAL_PLAN');
  assert.equal(own.explanation.what, 'Own', 'the asset\'s own explanation does not win');
  assert.equal(kind.explanation.what, 'From report', 'report.visualExplanations does not beat legacy captions');
  assert.equal(kind.captionKey, 'verify_visual_kind_elevation');
  assert.ok(!JSON.stringify([low, other, own, kind]).includes('secret'), 'an internal document ref is carried into the view');
  for (const k of ['photo', 'render', 'construction_photo', 'site_plan', 'master_plan', 'floor_plan', 'unit_plan', 'section', 'elevation', 'facade', 'structural', 'engineering', 'location_diagram', 'other']) {
    assert.equal(valuesOf(`verify_visual_kind_${k}`).length, 6, k);
  }
  assert.equal(valuesOf('vrx_visual_other_building').length, 6);
});

/* ── timeline and people ─────────────────────────────────────────────── */

test('milestones are grouped into steps that expand to their own records', () => {
  const ms = [
    { date: '2022-03-01', kind: 'AMENDMENT', outcome: 'AMENDMENT_APPROVED', decisionNumber: '1' },
    { date: '2021-01-01', kind: 'PERMIT', outcome: 'PERMIT_ISSUED', decisionNumber: '0' },
    { date: '2023-05-01', kind: 'AMENDMENT', outcome: 'AMENDMENT_APPROVED', decisionNumber: '2' },
    { date: '2025-02-01', kind: 'AMENDMENT', outcome: 'AMENDMENT_APPROVED', decisionNumber: '3' },
  ];
  const g = timelineGroups(ms);
  assert.deepEqual(g.map((x) => [x.kind, x.count]), [['PERMIT', 1], ['AMENDMENT', 3]]);
  assert.deepEqual(g[1].records.map((r) => r.decisionNumber), ['1', '2', '3']);
  assert.equal(yearSpan(g[1].firstDate, g[1].lastDate), '2022–2025');
  // Only the server's groups: shown, without invented records.
  const only = timelineGroups([], [{ kind: 'AMENDMENT', outcome: null, firstDate: '2022-01-01', lastDate: '2024-01-01', count: 4, decisionNumbers: [] }]);
  assert.equal(only[0].count, 4);
  assert.deepEqual(only[0].records, []);
  const oi = code('src/components/verify/OfficialIntelligence.tsx');
  assert.ok(!/verify_ox_changed_to'\)\} <\/span>/.test(oi) && !/sr-only/.test(oi), 'the screen-reader-only "changed" construct is back');
});

test('the team never shows a private person outside a professional role', () => {
  const cards = peopleCards({
    team: [
      { name: 'ნინო აბაშიძე', kind: 'PERSON', roles: ['PARCEL_OWNER'] },
      { name: 'გიორგი ბერიძე', kind: 'PERSON', roles: ['ARCHITECT'] },
      { name: 'შპს ბილდერი', kind: 'ORGANIZATION', roles: ['CONTRACTOR'] },
      { name: 'Someone', kind: 'PERSON', roles: ['OTHER'] },
    ],
    projectTeam: [{ name: 'გიორგი ბერიძე', roles: ['ARCHITECT'], basis: 'PUBLIC' }],
    developer: 'შპს დეველოპერი',
    financingPartner: 'Bank of Georgia',
  });
  const names = cards.map((c) => c.name);
  assert.ok(!names.includes('ნინო აბაშიძე'), 'a private parcel owner is named');
  assert.ok(!names.includes('Someone'));
  assert.equal(names.filter((n) => n === 'გიორგი ბერიძე').length, 1, 'one person, two sources, two cards');
  assert.equal(names[0], 'შპს დეველოპერი');
  assert.ok(cards.find((c) => c.roles.includes('FINANCING'))?.publicStatement);
});

/* ── i18n ────────────────────────────────────────────────────────────── */

test('every new key is in all six locales with its placeholders', () => {
  for (const [key, values] of Object.entries(VERIFY_REPORT_UI_STRINGS)) {
    const inBundle = valuesOf(key);
    assert.equal(inBundle.length, 6, `${key} is missing from some locale`);
    const want = (values[0].match(/\{\{\w+\}\}/g) ?? []).sort().join();
    for (const v of inBundle) assert.equal((v.match(/\{\{\w+\}\}/g) ?? []).sort().join(), want, `${key}: ${v}`);
  }
  // Terminology: never a "confirmed buyer", never შესატყვისი.
  const all = Object.values(VERIFY_REPORT_UI_STRINGS).flat().join('\n');
  assert.ok(!/confirmed buyer|შესატყვისი/i.test(all));
});
