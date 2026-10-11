// The Verify gallery as the project's story (owner, 2026-10-11), the blank
// image gate and the recovery of skipped official pictures, held on the REAL
// .601 visual set (fixtures/krtsanisiVisuals601.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogVisuals, visualChronology, datedLabel, pictureTypeOf, CHAPTER_ORDER, CHAPTER_KEY, PICTURE_TYPE_KEY } from '../visualCatalog.ts';
import { assessVisualQuality, annotateVisualQuality, visualByteSizes, isUnusableVisual } from '../intelligence/visualQuality.ts';
import { toCustomerVisualAssets } from '../intelligence/visualAssets.ts';
import {
  applyVisualRecovery, needsVisualRecovery, recoverableAttachments, storedUnpersistedVisuals, storedVisualRecord,
  VISUAL_RECOVERY_SOURCE, VISUAL_RECOVERY_STORED_SOURCE,
} from '../intelligence/visualRecovery.ts';
import { GALLERY_24, BLANK_IDS, PRIORITY_STORED_NOT_IN_GALLERY, CASE_DATES, resultJson601 } from './fixtures/krtsanisiVisuals601.mjs';
import { VERIFY_FINAL_VISUALS_STRINGS } from '../../../scripts/verify-final-visuals-i18n-data.mjs';
import { VERIFY_V6_VISUALS_STRINGS } from '../../../scripts/verify-v6-visuals-i18n-data.mjs';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const SIGNED = (id) => `https://x.supabase.co/storage/v1/object/sign/verify-official-visuals/tas/${id}.jpg?token=t`;
const signedAll = (list) => list.map((v) => ({ ...v, url: SIGNED(v.id) }));
const CASES = new Map(Object.entries(CASE_DATES).map(([k, v]) => [k, v]));
const TODAY = '2026-10-11';

/* ── blank / unusable gate ─────────────────────────────────────────────── */

test('the two grey Architecture thumbnails are blank; every other real visual is kept', () => {
  const verdicts = GALLERY_24.map((v) => [v.id, assessVisualQuality(v)]);
  const unusable = verdicts.filter(([, q]) => !q.usable).map(([id]) => id).sort();
  assert.deepEqual(unusable, [...BLANK_IDS].sort());
  const facade = assessVisualQuality(GALLERY_24[23]);
  assert.equal(facade.verdict, 'BLANK');
  assert.ok(facade.bytesPerPixel < 0.04);
  assert.notEqual(assessVisualQuality(GALLERY_24[6]).verdict, 'OK');
  // Renders and photographs sit far above any floor.
  assert.ok(assessVisualQuality(GALLERY_24[0]).bytesPerPixel > 0.7);
});

test('very large native pictures are not mistaken for blanks; a twin blank layer is', () => {
  const [one, two, three, facadeTwin, smallFacade] = PRIORITY_STORED_NOT_IN_GALLERY;
  for (const v of [one, two, three]) assert.equal(assessVisualQuality(v).verdict, 'OK', v.fileName);
  assert.equal(assessVisualQuality(facadeTwin).verdict, 'BLANK');
  assert.equal(assessVisualQuality(smallFacade).verdict, 'TOO_SMALL');
  assert.equal(assessVisualQuality({ kind: 'PHOTO', width: 4000, height: 300, bytes: 900000 }).verdict, 'STRIP');
  assert.equal(assessVisualQuality({ kind: 'PHOTO', width: 2000, height: 1500 }).verdict, 'UNKNOWN', 'no size, no verdict');
  assert.equal(assessVisualQuality({ kind: 'PHOTO', width: 2000, height: 1500 }).usable, true);
});

test('blanks stay in the stored report with a reason and never reach the customer', async () => {
  const rj = resultJson601();
  const persisted = annotateVisualQuality(rj.officialVisuals, visualByteSizes(rj));
  assert.equal(persisted.length, 24, 'a blank was deleted instead of kept internally');
  const blank = persisted.find((v) => v.id === BLANK_IDS[1]);
  assert.equal(blank.quality.usable, false);
  assert.match(blank.quality.reason, /bytes\/px/);
  assert.ok(isUnusableVisual(blank));
  const sign = async (paths) => Object.fromEntries(paths.map((p) => [p, `https://x.supabase.co/storage/v1/object/sign/verify-official-visuals/${p}?token=t`]));
  const assets = await toCustomerVisualAssets(persisted, sign);
  assert.equal(assets.length, 22);
  for (const id of BLANK_IDS) assert.ok(!assets.some((a) => a.id === id), 'a blank reached the gallery');
});

/* ── chronology ─────────────────────────────────────────────────────────── */

// Premise (2026-10-11, visual evolution): the five chapters became five tabs,
// newest first: TODAY / LATEST / CHANGES / OLD / DRAWINGS (visualEvolution.test.mjs
// holds the Digomi set). On .601: Sept 2026 photographs are today, the newest
// case's pictures the latest design, 2022 renders a change, 2018 photographs history.
test('the .601 gallery reads newest first, dated from the case filings', () => {
  const usable = GALLERY_24.filter((v) => !BLANK_IDS.includes(v.id));
  const catalog = catalogVisuals(signedAll([...usable, ...PRIORITY_STORED_NOT_IN_GALLERY.slice(0, 3)]));
  const chrono = visualChronology(catalog, CASES, TODAY);
  const chapterOf = (id) => chrono.groups.find((g) => g.items.some((i) => i.visual.id === id))?.chapter;
  assert.deepEqual(chrono.groups.map((g) => g.chapter), ['TODAY', 'LATEST', 'CHANGES', 'OLD', 'DRAWINGS']);
  assert.equal(chrono.defaultChapter, 'TODAY');
  // 2022 renders: an earlier version within five years; the newest case's own pictures: the latest.
  assert.equal(chapterOf(GALLERY_24[0].id), 'CHANGES');
  assert.equal(chapterOf(PRIORITY_STORED_NOT_IN_GALLERY[0].id), 'LATEST');
  // Drawings: drawings. 2018 site photographs: history. Sept 2026 photographs: today.
  assert.equal(chapterOf(GALLERY_24[7].id), 'DRAWINGS');
  assert.equal(chapterOf(GALLERY_24[2].id), 'OLD');
  assert.equal(chapterOf(GALLERY_24[16].id), 'TODAY');
  assert.equal(chrono.noNewerRender, false);
  assert.equal(chrono.noCurrentPhotos, false);
  // Every card is dated from its case, never invented.
  const all = chrono.groups.flatMap((g) => g.items);
  assert.equal(all.length, catalog.length);
  for (const i of all) {
    assert.equal(i.dateSource, 'CASE');
    assert.equal(i.date, CASE_DATES[i.visual.documentId].date);
  }
  const latest = all.find((i) => i.visual.id === PRIORITY_STORED_NOT_IN_GALLERY[0].id);
  assert.deepEqual(latest.dated, { key: 'vfv_date_application', vars: { year: '2026', month: '9' } });
  assert.equal(latest.type, 'IMAGE', 'an unlabelled picture was promoted to a render or photo');
  const render = all.find((i) => i.visual.id === GALLERY_24[0].id);
  assert.equal(render.type, 'RENDER');
  assert.equal(render.typeKey, 'vfv_type_render');
  assert.deepEqual(render.dated.vars, { year: '2022', month: '8' });
});

test('render vs photograph is always distinguished; a render is never current condition', () => {
  const cat = catalogVisuals(signedAll(GALLERY_24));
  for (const v of cat) {
    const t = pictureTypeOf(v);
    if (v.kind === 'RENDER') assert.equal(t, 'RENDER');
    if (v.kind === 'PHOTO') assert.equal(t, 'PHOTO');
  }
  const chrono = visualChronology(cat, CASES, TODAY);
  for (const g of chrono.groups) {
    if (g.chapter === 'TODAY') for (const i of g.items) assert.ok(i.type === 'PHOTO' || i.type === 'CONSTRUCTION_PHOTO', `${i.type} in ${g.chapter}`);
    if (g.chapter === 'LATEST') for (const i of g.items) assert.ok(i.type === 'RENDER' || i.type === 'IMAGE', `${i.type} in ${g.chapter}`);
  }
});

test('with no recent photograph the gallery says so; undated pictures are not dated', () => {
  const old = catalogVisuals(signedAll(GALLERY_24.filter((v) => v.documentId !== '1161121')));
  const chrono = visualChronology(old, CASES, TODAY);
  assert.equal(chrono.noCurrentPhotos, true);
  assert.equal(chrono.newestPhotoDate, '2018-12-07');
  assert.ok(!chrono.groups.some((g) => g.chapter === 'TODAY'));
  const none = visualChronology(catalogVisuals(signedAll([GALLERY_24[0]])), new Map(), TODAY);
  assert.equal(none.noCurrentPhotos, true);
  assert.equal(none.newestPhotoDate, null);
  assert.deepEqual(none.groups[0].items[0].dated, { key: 'vfv_date_unknown', vars: {} });
  assert.deepEqual(datedLabel('2025-04-03', 'EXIF'), { key: 'vfv_date_exif', vars: { date: '03.04.2025' } });
});

test('a camera EXIF date places a photograph; it never dates a render', () => {
  const cat = catalogVisuals(signedAll([
    { ...GALLERY_24[2], exifDate: '2025-05-02' },
    { ...GALLERY_24[0], exifDate: '2025-05-02' },
  ]));
  const chrono = visualChronology(cat, CASES, TODAY);
  const items = chrono.groups.flatMap((g) => g.items);
  assert.equal(items.find((i) => i.visual.kind === 'PHOTO').dateSource, 'EXIF');
  assert.equal(items.find((i) => i.visual.kind === 'RENDER').dateSource, 'CASE');
});

/* ── recovery of skipped pictures ───────────────────────────────────────── */

test('recoverable: budget-skipped images of the ledger, never paperwork or what is already shown', () => {
  const rj = resultJson601();
  assert.ok(needsVisualRecovery(rj));
  const stored = storedUnpersistedVisuals(rj, '2026-10-11T00:00:00Z');
  // "ძველი მონტაჟი.pdf" (old montage) is a render by its name (visualAssets.ts), so it is kept since v2.
  assert.deepEqual(stored.records.map((r) => r.fileName), ['1.jpg', '2.jpg', '3.jpg', 'ძველი მონტაჟი.pdf'], 'blank layers, paperwork scans or duplicates were appended');
  assert.equal(stored.records[3].kind, 'RENDER');
  assert.equal(stored.skippedQuality, 2);
  for (const r of stored.records) {
    assert.equal(r.provenance.recoveredFrom, VISUAL_RECOVERY_STORED_SOURCE);
    assert.match(r.provenance.sourceUrl, /^https:\/\/docs\.tbilisi\.gov\.ge\/DownloadServlet\?downloadCase=2&attachedFileId=\d+$/);
    assert.match(r.storagePath, /^tas\/[a-f0-9]{64}\.jpg$/);
  }
  const ask = recoverableAttachments(rj, { exclude: stored.records.map((r) => r.attachedFileId) });
  assert.deepEqual(ask.map((c) => c.attachedFileId), ['4850052', '4850053', '4850054', '3872813', '3872814'], 'newest case first, images only');
  assert.equal(ask[0].caseDate, '2025-04-03');
  assert.equal(ask[0].documentId, '1084312');
  assert.ok(!ask.some((c) => c.fileName.endsWith('.pdf')));
});

test('applying a recovery appends with provenance, marks the ledger and is idempotent', () => {
  const rj = resultJson601();
  const at = '2026-10-11T10:00:00Z';
  const stored = storedUnpersistedVisuals(rj, at);
  const workerVisual = { id: 'ab'.repeat(32), kind: 'OTHER', category: 'BUILDING', documentId: '1084312', attachedFileId: '4850052', fileName: '1.jpg', width: 2400, height: 1350, bytes: 1_400_000, mime: 'image/jpeg', extraction: 'NATIVE_IMAGE' };
  const rec = storedVisualRecord(workerVisual, { recoveredAt: at, recoveredFrom: VISUAL_RECOVERY_SOURCE });
  const marker = applyVisualRecovery(rj, {
    at, records: [...stored.records, rec],
    outcomes: [{ attachedFileId: '4850052', outcome: 'RECOVERED' }, { attachedFileId: '4850053', outcome: 'DEADLINE' }],
    requested: 5, storedAppended: stored.records.length, skippedQuality: stored.skippedQuality, complete: false,
  });
  assert.equal(rj.officialVisuals.length, 24 + 5);
  assert.equal(rj.officialVisuals.at(-1).provenance.recoveredFrom, 'TAS_ATTACHMENT_RECOVERY');
  assert.equal(rj.officialVisuals.at(-1).provenance.attachedFileId, '4850052');
  const ledger = rj.browserOfficial.results[1].tasApi.cases[1].attachments;
  assert.equal(ledger[0].outcome, 'RECOVERED');
  assert.equal(ledger[0].previousOutcome, 'NOT_PROCESSED_BUDGET');
  assert.equal(ledger[1].outcome, 'NOT_PROCESSED_BUDGET', 'a file not recovered was marked recovered');
  assert.equal(ledger[1].recoveryAttempt.outcome, 'DEADLINE');
  const acc = rj.browserOfficial.results[1].tasApi.accounting.attachmentOutcomes;
  assert.equal(acc.NOT_PROCESSED_BUDGET, 42);
  assert.equal(acc.RECOVERED, 1);
  assert.deepEqual({ ...marker.counts }, { requested: 5, recovered: 1, appended: 5, storedAppended: 4, failed: 1, skippedQuality: 2 });
  assert.equal(rj._visualRecovery.version, 2);
  assert.equal(rj._visualRecovery.appendedTotal, 5);
  assert.equal(rj._visualRecovery.complete, false);
  // A partial recovery is resumed, then stops; applying the same records twice appends nothing.
  assert.equal(needsVisualRecovery(rj), true);
  const again = applyVisualRecovery(rj, { at, records: [rec], outcomes: [], requested: 0, storedAppended: 0, skippedQuality: 0, complete: true });
  assert.equal(again.counts.appended, 0);
  assert.equal(again.attempts, 2);
  assert.equal(needsVisualRecovery(rj), false);
});

/* ── wiring and copy ────────────────────────────────────────────────────── */

test('the explorer renders chapters, labels and the no-photo sentence; images are contained and lazy', () => {
  const ui = read('src/components/verify/VisualExplorer.tsx');
  assert.match(ui, /visualChronology\(usable, cases/);
  assert.match(ui, /t\(CHAPTER_KEY\[x\.chapter\]\)/);
  assert.match(ui, /data-visual-label/);
  assert.match(ui, /data-no-current-photos/);
  assert.match(ui, /vfv_render_not_evidence/);
  assert.ok(!/object-cover/.test(ui), 'an image is cropped');
  assert.match(ui, /loading="lazy"/);
  assert.match(ui, /decoding="async"/);
  assert.match(ui, /role="tablist"[^>]*overflow-x-auto/);
});

test('every chronology string exists in six locales with its placeholders, and in the bundle', () => {
  const bundle = read('src/i18n/translations.ts');
  const keys = [...Object.values(CHAPTER_KEY), ...Object.values(PICTURE_TYPE_KEY), 'vfv_date_application', 'vfv_date_exif', 'vfv_date_unknown',
    'vfv_render_not_evidence', 'vfv_image_type_note', 'vfv_no_current_photos', 'vfv_no_current_photos_since', 'vev_tabs_label', 'vev_date_filename',
    ...Array.from({ length: 12 }, (_, i) => `vfv_month_${i + 1}`)];
  const STRINGS = { ...VERIFY_FINAL_VISUALS_STRINGS, ...VERIFY_V6_VISUALS_STRINGS };
  assert.equal(CHAPTER_ORDER.length, 5);
  for (const k of keys) {
    const v = STRINGS[k];
    assert.ok(v && v.length === 6, k);
    const want = (v[0].match(/\{\{\w+\}\}/g) ?? []).sort().join();
    for (const s of v) {
      assert.equal((s.match(/\{\{\w+\}\}/g) ?? []).sort().join(), want, `${k}: ${s}`);
      assert.ok(!s.includes('—'), `${k}: em dash in customer copy`);
    }
    assert.equal([...bundle.matchAll(new RegExp(`^  ${k}: `, 'gm'))].length, 6, `${k} is not in all six bundles`);
  }
});

test('recovery is wired: worker endpoint, research-agent action, rebuild hook', () => {
  const agent = read('supabase/functions/research-agent/index.ts');
  assert.match(agent, /action \|\| ''\) === 'recover_visuals'/);
  assert.match(agent, /\/verify\/tas-files/);
  assert.match(agent, /applyVisualRecovery\(rj, apply\)/);
  const synth = read('supabase/functions/verify-synthesis/index.ts');
  assert.match(synth, /await recoverVisualsBeforeRebuild\(job\);/);
  assert.match(synth, /annotateVisualQuality\(persistableVisuals\(/);
  assert.match(synth, /AbortSignal\.timeout\(60_000\)/);
});
