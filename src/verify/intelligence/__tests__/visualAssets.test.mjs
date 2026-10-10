// Verify "Visual Property Intelligence" — the customer data contract:
// identity scope against the requested unit (Villion Krtsanisi, unit
// 01.18.06.019.055.03.01.503 = building 03), hidden other-parcel assets,
// mixed render/photo, broken/missing URLs dropped, private signed URLs only,
// the per-job bound, and the synthesis hooks (prompt list + explanations).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  visualSubject, resolveVisualScope, toCustomerVisualAssets, persistableVisuals, isSignedVisualUrl, normalizeVisualKind,
  VISUAL_ASSET_MAX,
} from '../visualAssets.ts';
import { buildTasIntelligence } from '../tasIntelligence.ts';
import { buildEvidencePackage } from '../evidencePackage.ts';
import { finalizeReport, deterministicReport, guardVisualExplanation } from '../report.ts';
import { buildIntelligencePrompt } from '../prompt.ts';

const SHA = (c) => c.repeat(64);
const UNIT = '01.18.06.019.055.03.01.503';
const PARCEL = '01.18.06.019.055';
const subject = visualSubject(UNIT);
const SIGN_BASE = 'https://ptx.supabase.co/storage/v1/object/sign/verify-official-visuals/';
const signAll = async (paths) => Object.fromEntries(paths.map((p) => [p, `${SIGN_BASE}${p}?token=t`]));

test('subject: unit code → parcel, building 03, unit 503', () => {
  assert.deepEqual(subject, { cadastralCode: UNIT, parcel: PARCEL, building: '03', unitNumber: '503', floor: null });
  assert.equal(visualSubject(PARCEL).building, null);
});

test('identity: a plan of a different unit or building is never EXACT_UNIT', () => {
  const plan = (o) => resolveVisualScope('FLOOR_PLAN', { caseCadastralCodes: [PARCEL], ...o }, subject);
  assert.equal(plan({ blocks: ['03'], unitLabels: ['503'] }).scope, 'EXACT_UNIT');
  assert.equal(plan({ blocks: ['03'], unitLabels: ['502'] }).scope, 'BUILDING', 'wrong unit, same building');
  assert.equal(plan({ blocks: ['01'], unitLabels: ['503'] }).scope, 'PROJECT', 'same number in building 01');
  assert.equal(plan({ blocks: ['01'], unitLabels: ['503'] }).matchBasis, 'OTHER_BUILDING');
  assert.equal(plan({ blocks: [], unitLabels: ['503'] }).scope, 'PROJECT', 'no building evidence → not this flat');
  assert.equal(plan({ blocks: ['03'], typicalFloor: true }).scope, 'TYPICAL_FLOOR');
  assert.equal(plan({ blocks: ['01'], typicalFloor: true }).scope, 'PROJECT');
  assert.equal(resolveVisualScope('RENDER', { blocks: ['03'], unitLabels: ['503'], caseCadastralCodes: [PARCEL] }, subject).scope, 'BUILDING', 'only a plan can be the unit');
  assert.equal(resolveVisualScope('SITE_PLAN', { caseCadastralCodes: ['01.18.06.019.055.01.01.012'], blocks: ['01'], blockBasis: 'CASE_CADASTRAL' }, subject).scope, 'PROJECT');
  assert.equal(resolveVisualScope('SITE_PLAN', { caseCadastralCodes: [PARCEL] }, subject).scope, 'PROJECT');
});

test('identity: a case filed for another parcel is UNRELATED_SUSPECT', () => {
  const r = resolveVisualScope('RENDER', { caseCadastralCodes: ['01.18.06.019.099'] }, subject);
  assert.equal(r.scope, 'UNRELATED_SUSPECT');
  // No codes at all is not evidence of another parcel.
  assert.equal(resolveVisualScope('RENDER', { caseCadastralCodes: [] }, subject).scope, 'PROJECT');
});

const vis = (c, o = {}) => ({
  id: SHA(c), role: 'SUPPORTING', kind: 'RENDER', category: 'BUILDING', confidence: 0.9, date: '2022-06-06', width: 2200, height: 1555,
  mime: 'image/jpeg', extraction: 'NATIVE_IMAGE', page: null, storagePath: `tas/${SHA(c)}.jpg`, documentId: '1897963', attachedFileId: `9${c.charCodeAt(0)}`,
  fileName: `${c}.jpg`, identity: { blocks: [], unitLabels: [], floorLabels: [], typicalFloor: false, caseCadastralCodes: [PARCEL] }, ...o,
});

const report = (visuals) => ({
  exactUnit: { code: UNIT },
  officialVisuals: visuals,
  browserOfficial: {
    results: [{
      source: 'tas', originalCadastralCode: UNIT,
      tasApi: {
        requestedCadastralCode: PARCEL, searchCadastralCode: PARCEL, visuals,
        reconciliation: { sourceTotal: 1, reconciled: true }, accounting: { motions: 1, attachments: 1, responses: { PDF: 1 }, attachmentOutcomes: { READ_TEXT: 1 } },
        cases: [{
          documentId: '1897963', registrationNumber: 'AR1897963', title: 'მშენებლობის ნებართვა', docType: 'მშენებლობის ნებართვა', status: null, date: '2022-06-06',
          parties: [], values: [{ key: 'v1', label: 'სართულიანობა', value: '12' }], technicalFacts: [], attachments: [],
          motions: [{ motionId: '1', date: '2022-07-01', name: 'ნებართვა გაიცა', status: 'დასრულებული' }],
        }],
      },
    }],
  },
});

test('intelligence: mixed render / photo / drawings keep kind+category; other-parcel hidden; scope resolved', () => {
  const visuals = [
    vis('a', { role: 'LATEST_RENDER', kind: 'RENDER' }),
    vis('b', { kind: 'PHOTO', category: 'BUILDING' }),
    vis('c', { kind: 'FLOOR_PLAN', category: 'ARCHITECTURE', extraction: 'PDF_PAGE_RENDER', page: 2, mime: 'image/png', storagePath: `tas/${SHA('c')}.png`, identity: { blocks: ['03'], typicalFloor: true, caseCadastralCodes: [PARCEL] } }),
    vis('d', { kind: 'RENDER', identity: { caseCadastralCodes: ['01.18.06.019.099'] } }),
    vis('e', { kind: 'LANDSCAPE' }),
  ];
  const intel = buildTasIntelligence(report(visuals));
  const ids = intel.visuals.map((v) => v.id);
  assert.ok(!ids.includes(SHA('d')), 'other parcel never customer-visible');
  assert.equal(intel.funnel.visualsHidden, 1);
  const byId = Object.fromEntries(intel.visuals.map((v) => [v.id, v]));
  assert.equal(byId[SHA('a')].kind, 'RENDER');
  assert.equal(byId[SHA('b')].kind, 'PHOTO', 'a photo stays a photo, a render stays a render');
  assert.equal(byId[SHA('c')].scope, 'TYPICAL_FLOOR');
  assert.equal(byId[SHA('c')].category, 'APARTMENT', 'typical floor of the unit building → apartment tab');
  assert.equal(byId[SHA('c')].page, 2);
  assert.equal(byId[SHA('e')].kind, 'SITE_PLAN', 'legacy LANDSCAPE normalised');
  assert.equal(normalizeVisualKind('OTHER_DRAWING'), 'OTHER');
});

test('intelligence + serialization: bound respected end-to-end (30 → 24)', async () => {
  const many = Array.from({ length: 30 }, (_, i) => vis(String.fromCharCode(97 + (i % 26)) + '', { id: (i.toString(16).padStart(2, '0')).repeat(32), storagePath: `tas/${(i.toString(16).padStart(2, '0')).repeat(32)}.jpg` }));
  const intel = buildTasIntelligence(report(many));
  assert.equal(intel.visuals.length, VISUAL_ASSET_MAX);
  const persisted = persistableVisuals(many, intel.visuals);
  assert.equal(persisted.length, VISUAL_ASSET_MAX);
  let asked = 0;
  const assets = await toCustomerVisualAssets(many, async (paths) => { asked = paths.length; return signAll(paths); });
  assert.equal(asked, VISUAL_ASSET_MAX, 'one signing call, bounded');
  assert.equal(assets.length, VISUAL_ASSET_MAX);
});

test('serialization: broken / missing / public URLs and bad paths are dropped; only private signed URLs leave', async () => {
  const records = [
    vis('a', { scope: 'BUILDING', block: '03' }),
    vis('b'),
    vis('c'),
    vis('d', { storagePath: 'public/x.jpg' }),
    vis('e', { storagePath: undefined }),
    vis('f', { scope: 'UNRELATED_SUSPECT' }),
  ];
  const assets = await toCustomerVisualAssets(records, async (paths) => ({
    [paths[0]]: `${SIGN_BASE}${paths[0]}?token=ok`,
    [paths[1]]: null,
    [paths[2]]: `https://ptx.supabase.co/storage/v1/object/public/verify-official-visuals/${paths[2]}`,
  }), { explanations: [{ id: SHA('a'), what: 'რენდერი.', interesting: 'x', buyerMeaning: 'y', uncertain: 'z' }] });
  assert.deepEqual(assets.map((a) => a.id), [SHA('a')]);
  const a = assets[0];
  assert.ok(isSignedVisualUrl(a.url));
  assert.equal(a.scope, 'BUILDING');
  assert.equal(a.block, '03');
  assert.equal(a.mime, 'image/jpeg');
  assert.equal(a.documentRef.source, 'TAS');
  assert.equal(a.documentRef.usage, 'OFFICIAL_RECORD_REFERENCE');
  assert.equal(a.captionKey, 'verify.visual.kind.RENDER');
  assert.equal(a.explanation.what, 'რენდერი.');
  assert.ok(!('storagePath' in a), 'no bucket path reaches the customer');
  // A signer failure omits visuals, never fails the report.
  assert.deepEqual(await toCustomerVisualAssets(records, async () => { throw new Error('storage down'); }), []);
  assert.equal(isSignedVisualUrl('https://x.supabase.co/storage/v1/object/public/verify-official-visuals/tas/a.jpg'), false);
  assert.equal(isSignedVisualUrl('javascript:alert(1)'), false);
});

test('synthesis hooks: prompt lists every visible asset; explanations bounded to known ids, guarded, with fallback', () => {
  const visuals = [
    vis('a', { role: 'LATEST_RENDER' }),
    vis('c', { kind: 'FLOOR_PLAN', extraction: 'PDF_PAGE_RENDER', page: 2, identity: { blocks: ['03'], typicalFloor: true, caseCadastralCodes: [PARCEL] } }),
    vis('d', { identity: { caseCadastralCodes: ['01.18.06.019.099'] } }),
  ];
  const pkg = buildEvidencePackage(report(visuals));
  const prompt = JSON.stringify(buildIntelligencePrompt(pkg));
  assert.match(prompt, /visualExplanations/);
  assert.ok(prompt.includes(SHA('c')) && prompt.includes('TYPICAL_FLOOR'));
  assert.ok(!prompt.includes(SHA('d')), 'a hidden asset is never described');
  assert.match(prompt, /never infer structural safety/i);

  const det = deterministicReport(pkg);
  assert.deepEqual(det.visualExplanations.map((e) => e.id).sort(), [SHA('a'), SHA('c')].sort());
  assert.ok(det.visualExplanations.every((e) => e.what && e.uncertain));
  assert.match(det.visualExplanations.find((e) => e.id === SHA('a')).uncertain, /არა აშენებული/);

  const cite = Object.values(pkg.tasCite)[0];
  const raw = JSON.stringify({
    summary: { label: 'BALANCED', statement: 'პროექტი შეთანხმებულია.', highlights: [{ dimension: 'PROJECT_QUALITY', sentiment: 'POSITIVE', headline: 'ნებართვა', detail: 'x', cites: [cite] }] },
    keyFindings: [], sections: [{ key: 'PROJECT', title: 'პროექტი', body: 'მოკლე.', metrics: [], cites: [cite] }],
    visualExplanations: [
      { id: SHA('a'), what: 'პროექტის ვიზუალიზაცია. შენობა სეისმომედეგია.', interesting: 'ფასადი ღიაა.', buyerMeaning: 'გიჩვენებთ დიზაინს.', uncertain: 'არ ჩანს უსაფრთხოება.' },
      { id: SHA('f'), what: 'ყალბი.', interesting: '', buyerMeaning: '', uncertain: '' },
    ],
    attentionPoints: [], nextSteps: [], finalView: '', contractUpload: { recommend: true, text: '' },
  });
  const fin = finalizeReport(pkg, raw);
  assert.equal(fin.mode, 'MODEL', String(fin.rejectedBecause));
  assert.equal(fin.visualExplanations.find((e) => e.id === SHA('a')).interesting, 'ფასადი ღიაა.', 'the model explanation is used');
  const ids = fin.visualExplanations.map((e) => e.id);
  assert.ok(!ids.includes(SHA('f')), 'unknown ids dropped');
  assert.ok(ids.includes(SHA('c')), 'missing explanations filled deterministically');
  const a = fin.visualExplanations.find((e) => e.id === SHA('a'));
  assert.ok(!/სეისმომედეგ/.test(a.what), 'no safety inferred from an image');
  assert.match(a.uncertain, /უსაფრთხოება/, 'uncertainty may name what cannot be judged');
  assert.equal(guardVisualExplanation({ id: 'x', what: 'see https://a.b', interesting: '', buyerMeaning: '', uncertain: '' }), null);
});
