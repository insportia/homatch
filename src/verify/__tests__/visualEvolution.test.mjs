// VISUAL EVOLUTION of the Verify gallery (owner, 2026-10-11), held on the
// REAL Digomi set (job eeefada9, fixtures/digomiVisualsEeefada9.mjs):
//   - photomontage / axonometric views are renders, never photographs;
//   - 2012 pictures are history, labelled "ძველი საპროექტო ვერსია | 2012 წელი";
//   - with no newer verified render the gallery says so;
//   - recovery v2 brings back the 2024–2025 pictures (IMAGE jpgs and
//     visual-named PDFs), newest case first, older cases capped;
//   - file-name dates ("ფოტო 14-04-2025", "ფასადები 27,12") are read when unambiguous.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { catalogVisuals, visualChronology, CHAPTER_KEY, CHAPTER_WHY_KEY, CHAPTER_ORDER, HISTORICAL_YEARS } from '../visualCatalog.ts';
import { toCustomerVisualAssets, fileNameDate, isRenderName, correctVisualKind } from '../intelligence/visualAssets.ts';
import {
  applyVisualRecovery, needsVisualRecovery, recoverableAttachments, storedVisualRecord, isVisualPdfCandidate,
  VISUAL_RECOVERY_SOURCE, VISUAL_RECOVERY_VERSION, VISUAL_RECOVERY_MAX_ASSETS, VISUAL_RECOVERY_OLD_CASE_MAX, VISUAL_RECOVERY_MAX_FILES,
} from '../intelligence/visualRecovery.ts';
import { DIGOMI_GALLERY_12, DIGOMI_BLANK_ID, DIGOMI_CASES, digomiResultJson } from './fixtures/digomiVisualsEeefada9.mjs';
import { VERIFY_V6_VISUALS_STRINGS } from '../../../scripts/verify-v6-visuals-i18n-data.mjs';
import { VERIFY_V7_GALLERY_STRINGS } from '../../../scripts/verify-v7-gallery-i18n-data.mjs';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const SIGNED = (id) => `https://x.supabase.co/storage/v1/object/sign/verify-official-visuals/tas/${id}.jpg?token=t`;
const sign = async (paths) => Object.fromEntries(paths.map((p) => [p, `https://x.supabase.co/storage/v1/object/sign/verify-official-visuals/${p}?token=t`]));
const CASES = new Map(Object.entries(DIGOMI_CASES));
const TODAY = '2026-10-11';
const hex = (n) => n.toString(16).padStart(64, 'a');

/* ── classification ─────────────────────────────────────────────────────── */

test('photomontage and axonometric views are renders, never photographs; the 2012 site photos stay photos', async () => {
  const assets = await toCustomerVisualAssets(digomiResultJson().officialVisuals, sign);
  assert.equal(assets.length, 11, 'the blank structural layer reached the gallery');
  assert.ok(!assets.some((a) => a.id === DIGOMI_BLANK_ID));
  const montage = assets.filter((a) => a.fileName === 'fotomontaji da aqsiometriuli xedebi.pdf');
  assert.equal(montage.length, 4);
  for (const a of montage) {
    assert.equal(a.kind, 'RENDER', 'a photomontage was presented as a photograph');
    assert.equal(a.category, 'BUILDING');
  }
  for (const a of assets.filter((x) => x.fileName === 'foto.pdf')) assert.equal(a.kind, 'PHOTO');
  // The catalogue applies the same evidence to a stored record that skipped the server.
  const cat = catalogVisuals(DIGOMI_GALLERY_12.map((v) => ({ ...v, url: SIGNED(v.id) })));
  for (const v of cat.filter((x) => /fotomontaji/.test(x.fileName))) assert.equal(v.badge, 'RENDER');
  assert.equal(isRenderName('რენდ1.jpg'), true);
  assert.equal(isRenderName('დემონტაჟის პროექტი.pdf'), false);
  assert.equal(correctVisualKind('FACADE', 'ფოტომონტაჟი.pdf'), 'FACADE', 'a drawing was re-labelled');
  assert.equal(correctVisualKind('PHOTO', 'foto.pdf'), 'PHOTO');
});

test('file-name dates: full dates always; day.month only when the case year makes it unambiguous', () => {
  assert.equal(fileNameDate('ფოტო 14-04-2025.pdf', '2025-04-14'), '2025-04-14');
  assert.equal(fileNameDate('ფასადები 27,12.pdf', '2025-09-23'), '2025-12-27');
  assert.equal(fileNameDate('ფასადები 14,03.pdf', '2025-02-20'), '2025-03-14');
  assert.equal(fileNameDate('ფოტო 05-08.pdf', '2024-09-30'), '2024-08-05', 'a photo taken before the filing');
  assert.equal(fileNameDate('ფასადები 27,12.pdf', null), null, 'a year was invented');
  assert.equal(fileNameDate('მონტაჟი2-1.jpg', '2024-03-12'), null, '"2-1" is not a date');
  assert.equal(fileNameDate('საინჟინროები 01.72.14.040.030 განახლებული.pdf', '2025-09-23'), null, 'a cadastral code read as a date');
  assert.equal(fileNameDate('1.jpg', '2025-02-20'), null);
});

/* ── tabs ───────────────────────────────────────────────────────────────── */

// Premise (v7 dating, 2026-10-11): the newest photographs always open the
// gallery in the latest-photos tab, with their year and "last available"
// header, even when they are 2012 photographs; they are never "today".
test('as stored before recovery: the 2012 photos are the last available ones (with their year), the rest 2012–2013 history', async () => {
  const assets = await toCustomerVisualAssets(digomiResultJson().officialVisuals, sign);
  const cat = catalogVisuals(assets);
  const chrono = visualChronology(cat, CASES, TODAY);
  assert.deepEqual(chrono.groups.map((g) => g.chapter), ['LATEST_PHOTOS', 'OLD', 'DRAWINGS']);
  assert.equal(chrono.noNewerRender, true);
  assert.equal(chrono.defaultChapter, 'LATEST_PHOTOS');
  const latest = chrono.groups[0].items;
  assert.deepEqual(latest.map((i) => i.visual.fileName), ['foto.pdf', 'foto.pdf', 'foto.pdf', 'foto.pdf']);
  assert.equal(chrono.latestPhotos.kind, 'LAST_AVAILABLE');
  assert.deepEqual(chrono.latestPhotos.badge.vars, { year: '2012' });
  for (const i of latest) {
    assert.equal(i.photoDating, 'ARCHIVAL', '2012 site photos must never read as current condition');
    assert.deepEqual(i.photoLabel, { key: 'vg_archival_photo', vars: { year: '2012' } });
  }
  const old = chrono.groups.find((g) => g.chapter === 'OLD').items;
  assert.equal(old.length, 6);
  const render2012 = old.find((i) => i.visual.fileName === 'fotomontaji da aqsiometriuli xedebi.pdf');
  assert.deepEqual(render2012.historical, { badgeKey: 'vev_hist_render_badge', noteKey: 'vev_hist_render_note', vars: { year: '2012' } });
  const render2013 = old.find((i) => i.visual.fileName === 'Render.pdf');
  assert.equal(render2013.historical.vars.year, '2013');
  // Newest first inside a tab: 2013 before 2012.
  assert.equal(old[0].date, '2013-07-06');
  for (const i of old) assert.ok(i.historical, `${i.visual.fileName} has no historical label`);
  assert.equal(chrono.noCurrentPhotos, true);
});

test('after recovery: the 2025 photomontage is the latest design, the 2025 photo leads the latest photos (archival), 2012 stays history', () => {
  const rj = digomiResultJson();
  const rec = (n, documentId, attachedFileId, fileName, kind, extraction = 'NATIVE_IMAGE') =>
    storedVisualRecord({ id: hex(n), kind, category: 'BUILDING', documentId, attachedFileId, fileName, width: 2400, height: 1600, bytes: 1_200_000, mime: 'image/jpeg', extraction },
      { recoveredAt: '2026-10-11T10:00:00Z', recoveredFrom: VISUAL_RECOVERY_SOURCE });
  const records = [
    rec(1, '1110027', '5035666', 'ფოტომონტაჟი.pdf', 'RENDER', 'PDF_EMBEDDED_IMAGE'),
    rec(2, '1110027', '5035669', '1.jpg', 'OTHER'),
    rec(3, '1087185', '4867063', 'ფოტო 14-04-2025.pdf', 'PHOTO', 'PDF_EMBEDDED_IMAGE'),
    rec(4, '1078892', '4836470', 'რენდ1.jpg', 'OTHER'), // a v1-era worker said OTHER: the name decides
    rec(5, '1022993', '4444788', 'მონტაჟი2-1.jpg', 'OTHER'),
  ];
  assert.equal(records[3].kind, 'RENDER');
  applyVisualRecovery(rj, { at: '2026-10-11T10:00:00Z', records, outcomes: records.map((r) => ({ attachedFileId: r.attachedFileId, outcome: 'RECOVERED' })), requested: 5, storedAppended: 0, skippedQuality: 0, complete: true });
  const cat = catalogVisuals(rj.officialVisuals.map((v) => ({ ...v, url: SIGNED(v.id) })));
  const chrono = visualChronology(cat, CASES, TODAY);
  const tab = (id) => chrono.groups.find((g) => g.items.some((i) => i.visual.id === id));
  assert.deepEqual(chrono.groups.map((g) => g.chapter), CHAPTER_ORDER);
  assert.equal(chrono.defaultChapter, 'LATEST_PHOTOS');
  assert.equal(chrono.noNewerRender, false);
  assert.equal(tab(hex(1)).chapter, 'LATEST');
  assert.equal(tab(hex(2)).chapter, 'LATEST');
  assert.equal(tab(hex(4)).chapter, 'CHANGES', 'the February 2025 renders are an earlier version');
  const latestPhotos = chrono.groups.find((g) => g.chapter === 'LATEST_PHOTOS').items;
  assert.equal(latestPhotos.length, 1);
  assert.equal(latestPhotos[0].visual.id, hex(3));
  // The file-name date is a DOCUMENT date: placed by it, never shown as a capture date.
  assert.equal(latestPhotos[0].dateSource, 'FILENAME');
  assert.equal(latestPhotos[0].dates.capture, null);
  assert.deepEqual(latestPhotos[0].dates.document, { date: '2025-04-14', source: 'FILE_NAME', caseRef: 'AR11087185' });
  assert.deepEqual(latestPhotos[0].dated, { key: 'vg_capture_unknown_title', vars: {} });
  assert.equal(chrono.hero.id, hex(3));
  // Never a render among the latest photos; never history in the latest design.
  for (const g of chrono.groups) for (const i of g.items) {
    if (g.chapter === 'LATEST_PHOTOS') assert.ok(i.type === 'PHOTO' || i.type === 'CONSTRUCTION_PHOTO');
    if (g.chapter === 'LATEST' || g.chapter === 'CHANGES') assert.ok(!i.date || i.date >= '2021-10-11');
    if (g.chapter === 'OLD') assert.ok(i.date && i.date <= `${2026 - HISTORICAL_YEARS}-10-11`);
  }
});

/* ── recovery v2 ────────────────────────────────────────────────────────── */

test('recovery v2 asks for the recent pictures first: IMAGE jpgs and visual-named PDFs, never paperwork or what is shown', () => {
  const rj = digomiResultJson();
  assert.equal(VISUAL_RECOVERY_VERSION, 2);
  assert.ok(needsVisualRecovery(rj));
  const ask = recoverableAttachments(rj);
  const names = ask.map((c) => `${c.documentId}:${c.fileName}`);
  assert.ok(ask.length <= VISUAL_RECOVERY_MAX_FILES);
  // Newest case first, renders before photographs before facades inside a case.
  assert.deepEqual(names.slice(0, 7), [
    '1110027:ფოტომონტაჟი.pdf', '1110027:ფოტომონტაჟი.pdf', '1110027:2.jpg', '1110027:3.jpg', '1110027:1.jpg', '1110027:ფასადები 27,12.pdf',
    '1087185:ფოტო 14-04-2025.pdf',
  ]);
  for (const n of ['1078892:რენდ1.jpg', '1078892:ფოტომონტაჟი.pdf', '1078892:ფასადები 14,03.pdf', '1059939:ფოტო 05-08.pdf', '1051702:ფოტო 05-08.pdf',
    '1022993:მონტაჟი2-1.jpg', '1022993:ფოტოები.pdf', '1014318:fotomontaji.pdf', '1014318:არსებული ფოტოები.pdf', '980594:ფოტო.pdf']) {
    assert.ok(names.includes(n), `${n} is not recovered`);
  }
  // Already in the gallery, paperwork, demolition, expert reports, TIFF: never asked.
  for (const id of ['249565', '252213', '252210', '415285', '4182934', '4625005', '4630001', '4679256', '4850914', '4867060', '5137836', '198126', '5284946']) {
    assert.ok(!ask.some((c) => c.attachedFileId === id), `${id} was asked for`);
  }
  // 2012–2013 cases are history: capped.
  const old = ask.filter((c) => c.caseDate < '2020-01-01');
  assert.ok(old.length <= VISUAL_RECOVERY_OLD_CASE_MAX, `${old.length} files of 2012–2013 cases`);
  assert.equal(isVisualPdfCandidate('ფასადები 27,12.pdf', 'READ_TEXT'), false, 'a facade read as text has no pictures to recover');
  assert.equal(isVisualPdfCandidate('fotomontaji.pdf', 'READ_TEXT'), true);
});

test('a job recovered under v1 runs v2 once; the appended total is capped', () => {
  const rj = digomiResultJson();
  rj._visualRecovery = { at: '2026-10-11T08:00:00Z', version: 1, complete: true, attempts: 1, counts: { requested: 0, recovered: 0, appended: 0, storedAppended: 0, failed: 0, skippedQuality: 0 } };
  assert.equal(needsVisualRecovery(rj), true, 'a v1 marker blocked the v2 recovery');
  const many = Array.from({ length: 45 }, (_, i) => storedVisualRecord(
    { id: hex(100 + i), kind: 'OTHER', documentId: '1110027', attachedFileId: String(6_000_000 + i), fileName: `${i}.jpg`, width: 2400, height: 1600, bytes: 1_200_000, extraction: 'NATIVE_IMAGE' },
    { recoveredFrom: VISUAL_RECOVERY_SOURCE },
  ));
  const m = applyVisualRecovery(rj, { at: '2026-10-11T10:00:00Z', records: many, outcomes: [], requested: 45, storedAppended: 0, skippedQuality: 0, complete: false });
  assert.equal(m.version, 2);
  assert.equal(m.attempts, 1, 'attempts of an older version were counted');
  assert.equal(m.counts.appended, VISUAL_RECOVERY_MAX_ASSETS);
  assert.equal(rj.officialVisuals.length, 12 + VISUAL_RECOVERY_MAX_ASSETS);
  const again = applyVisualRecovery(rj, { at: '2026-10-11T10:05:00Z', records: many, outcomes: [], requested: 0, storedAppended: 0, skippedQuality: 0, complete: true });
  assert.equal(again.counts.appended, 0, 'the cap was exceeded on a resumed attempt');
  assert.equal(again.appendedTotal, VISUAL_RECOVERY_MAX_ASSETS);
  assert.equal(needsVisualRecovery(rj), false);
});

/* ── UI and copy ────────────────────────────────────────────────────────── */

test('the explorer shows the historical label on and above the image, the empty state, the five-field card and a containing zoom viewer', () => {
  const ui = read('src/components/verify/VisualExplorer.tsx');
  assert.match(ui, /\{hist \? <HistoricalBadge h=\{hist\} className="text-xs" \/> : null\}\s*<button/, 'no label above the stage image');
  assert.match(ui, /<HistoricalOverlay h=\{hist\} \/>/, 'no label on the image');
  assert.equal((ui.match(/<HistoricalOverlay h=\{hist\} \/>/g) ?? []).length, 2, 'the full-screen viewer lost the label');
  assert.match(ui, /data-no-newer-render/);
  assert.match(ui, /t\('vev_no_newer_title'\)/);
  assert.match(ui, /chrono\.defaultChapter/);
  for (const k of ['vev_card_what', 'vev_card_type', 'vev_card_date', 'vev_card_scope', 'vev_card_why']) assert.ok(ui.includes(`'${k}'`), k);
  assert.match(ui, /CHAPTER_WHY_KEY\[activeChrono\.chapter\]/);
  assert.match(ui, /<OfficialLink href=\{c\.href\}/, 'the source reference is gone');
  assert.ok(!/object-cover/.test(ui), 'an image is cropped');
  assert.match(ui, /'Escape'/);
  assert.match(ui, /addEventListener\('wheel'/);
  assert.match(ui, /vrx_lightbox_zoom_in/);
  assert.match(ui, /pointers\.current\.size >= 2/, 'pinch zoom is gone');
});

test('the visual-evolution copy: six locales, placeholders intact, the owner-approved Georgian verbatim, in the bundle', () => {
  const bundle = read('src/i18n/translations.ts');
  const S = { ...VERIFY_V6_VISUALS_STRINGS, ...VERIFY_V7_GALLERY_STRINGS };
  for (const k of [...Object.values(CHAPTER_KEY), ...Object.values(CHAPTER_WHY_KEY)]) assert.ok(S[k], `${k} has no copy`);
  for (const [k, v] of Object.entries(S)) {
    assert.equal(v.length, 6, k);
    const want = (v[0].match(/\{\{\w+\}\}/g) ?? []).sort().join();
    for (const s of v) {
      assert.equal((s.match(/\{\{\w+\}\}/g) ?? []).sort().join(), want, `${k}: ${s}`);
      assert.ok(!s.includes('—'), `${k}: em dash`);
    }
    assert.equal([...bundle.matchAll(new RegExp(`^  ${k}: `, 'gm'))].length, 6, `${k} is not in all six bundles`);
  }
  // Order: en, ka, ru, tr, ar, he.
  assert.equal(S.vev_hist_render_badge[1], 'ძველი საპროექტო ვერსია | {{year}} წელი');
  assert.equal(S.vev_hist_render_note[1], 'ეს გამოსახულება პროექტის ადრინდელ არქიტექტურულ ჩანაფიქრს ასახავს. მოგვიანებით პროექტი შესაძლოა შეცვლილიყო, ამიტომ ეს რენდერი არ უნდა აღიქვათ როგორც დღევანდელი შენობის ზუსტი გამოსახულება.');
  assert.equal(S.vev_no_newer_title[1], 'განახლებული რენდერი ვერ მოიძებნა');
  assert.equal(S.vev_no_newer_body[1], 'ამ ეტაპზე ვერ მოვიძიეთ უფრო ახალი, დადასტურებული რენდერი, რომელიც შენობის ბოლო საპროექტო ვერსიას ასახავს. ამიტომ ძველ გამოსახულებას მხოლოდ პროექტის ისტორიის გასაცნობად გაჩვენებთ.');
  // "დღეს" never labels photographs (v7): the photo tab is "უახლესი ფოტოები".
  assert.deepEqual(CHAPTER_ORDER.map((c) => S[CHAPTER_KEY[c]][1]), ['უახლესი ფოტოები', 'ბოლო პროექტი', 'ცვლილებები', 'ძველი ვერსიები', 'ნახაზები']);
  for (const k of Object.values(CHAPTER_KEY)) assert.notEqual(S[k][1], 'დღეს');
});
