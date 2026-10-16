// V7 photo chronology and provenance (owner, 2026-10-11): a capture date
// comes ONLY from EXIF or a provider's stated capture; a file-name date or a
// case filing date is a DOCUMENT date; the photo tab is "უახლესი ფოტოები"
// (never "დღეს") and says which case applies; an old render is never the
// latest design; a verified fresh photo opens the gallery. Held on the real
// Digomi visual list (job eeefada9, facts in the lead's V7_SHARED notes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  visualDates, withVisualDates, caseIndex, sanitizeVisualDates, freshPhotoViews, kaDatedBy, documentDatePhrase,
} from '../intelligence/visualDates.ts';
import { toCustomerVisualAssets } from '../intelligence/visualAssets.ts';
import {
  catalogVisuals, catalogFreshPhotos, visualChronology, photoDatedLabel, CHAPTER_KEY, CHAPTER_ORDER,
} from '../visualCatalog.ts';
import { VERIFY_V7_GALLERY_STRINGS as S } from '../../../scripts/verify-v7-gallery-i18n-data.mjs';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const TODAY = '2026-10-11';
const hex = (n) => n.toString(16).padStart(64, 'c');
const SIGNED = (id) => `https://x.supabase.co/storage/v1/object/sign/verify-official-visuals/tas/${id}.jpg?token=t`;
const sign = async (paths) => Object.fromEntries(paths.map((p) => [p, `https://x.supabase.co/storage/v1/object/sign/verify-official-visuals/${p}?token=t`]));

/* ── the real eeefada9 joins (synthesis_json.officialDocuments) ── */
const DOCS = [
  ['95157', 'AR195157', '2012-12-04'], ['137104', 'AR1137104', '2013-06-07'], ['144566', 'AR1144566', '2013-07-06'],
  ['980594', 'AR1980594', '2023-07-26'], ['1014318', 'AR11014318', '2024-02-07'], ['1022993', 'AR11022993', '2024-03-12'],
  ['1059939', 'AR11059939', '2024-09-30'], ['1078892', 'AR11078892', '2025-02-20'], ['1087185', 'AR11087185', '2025-04-14'],
  ['1110027', 'AR11110027', '2025-09-23'],
].map(([documentId, caseRef, caseDate]) => ({ documentId, caseRef, caseDate, title: 'მშენებლობის ნებართვა', publicUrl: null }));
const CASES = new Map(DOCS.map((d) => [d.documentId, { caseRef: d.caseRef, date: d.caseDate }]));

let n = 0;
/** A stored officialVisuals record as production holds it: date, exifDate and caseRef all null. */
const rec = (documentId, fileName, kind, extra = {}) => {
  n += 1;
  return {
    id: hex(n), storagePath: `tas/${hex(n)}.jpg`, kind, category: 'BUILDING', scope: 'PROJECT', role: 'SUPPORTING', versionStatus: 'UNDETERMINED',
    documentId, attachedFileId: String(4_000_000 + n), fileName, width: 2400, height: 1600, mime: 'image/jpeg', confidence: 0.8,
    date: null, exifDate: null, caseRef: null, ...extra,
  };
};
const EEEFADA9 = [
  rec('144566', 'Render.pdf', 'RENDER', { role: 'LATEST_RENDER' }),
  rec('95157', 'foto.pdf', 'PHOTO'), rec('95157', 'foto.pdf', 'PHOTO'),
  rec('95157', 'fotomontaji da aqsiometriuli xedebi.pdf', 'PHOTO'), rec('95157', 'fotomontaji da aqsiometriuli xedebi.pdf', 'PHOTO'),
  rec('137104', 'ფასადები.pdf', 'FACADE', { category: 'ARCHITECTURE' }),
  rec('980594', 'ფოტო.pdf', 'PHOTO'),
  rec('1014318', 'არსებული ფოტოები.pdf', 'PHOTO'),
  rec('1022993', 'ენერგო ეფექტურობა-საინჟინრო კომუნიკაცია-კონსტრუქცია.pdf', 'STRUCTURAL', { category: 'STRUCTURE' }),
  rec('1022993', 'მონტაჟი2-1.jpg', 'OTHER'),
  rec('1059939', 'ფოტო 05-08.pdf', 'PHOTO'),
  rec('1078892', 'რენდ1.jpg', 'OTHER'),
  rec('1087185', 'ფოტო 14-04-2025.pdf', 'PHOTO'), rec('1087185', 'ფოტო 14-04-2025.pdf', 'PHOTO'),
  rec('1087185', 'ფოტო 14-04-2025.pdf', 'PHOTO'), rec('1087185', 'ფოტო 14-04-2025.pdf', 'PHOTO'),
  rec('1110027', 'ფოტომონტაჟი.pdf', 'RENDER'),
];
const ids = (list) => list.map((i) => i.visual.id);
const groupOf = (chrono, c) => chrono.groups.find((g) => g.chapter === c)?.items ?? [];

/* ── visualDates: capture vs document ── */

test('null image dates: no case, no EXIF, no file-name date: nothing is invented', () => {
  const r = visualDates({ kind: 'PHOTO', fileName: 'foto.pdf', date: null, exifDate: null, documentId: null }, CASES, { today: TODAY });
  assert.deepEqual(r, { caseRef: null, dates: { capture: null, document: null } });
  const unknown = visualDates({ kind: 'PHOTO', fileName: 'foto.pdf', documentId: '999999' }, CASES);
  assert.deepEqual(unknown.dates, { capture: null, document: null }, 'a case that is not joined dated the photo');
  // As a card: unknown-capture copy only, placed last, marked.
  const cat = catalogVisuals([{ id: 'u', kind: 'PHOTO', url: SIGNED('u') }, { id: 'd', kind: 'PHOTO', url: SIGNED('d'), documentId: '980594' }]);
  const chrono = visualChronology(cat, CASES, TODAY);
  const u = chrono.groups.flatMap((g) => g.items).find((i) => i.visual.id === 'u');
  assert.equal(u.chapter, 'CHANGES');
  assert.equal(u.date, null);
  assert.equal(u.photoDating, 'UNKNOWN');
  assert.deepEqual(u.dated, { key: 'vg_capture_unknown_title', vars: {} });
  assert.deepEqual(u.notes, [{ key: 'vg_capture_unknown_body', vars: {} }]);
  assert.equal(u.photoLabel, null);
  const withRender = visualChronology(catalogVisuals([
    { id: 'u', kind: 'PHOTO', url: SIGNED('u') }, { id: 'p', kind: 'PHOTO', url: SIGNED('p'), documentId: '1014318' },
    { id: 'q', kind: 'PHOTO', url: SIGNED('q'), documentId: '1059939' },
  ]), CASES, TODAY);
  const changes = groupOf(withRender, 'CHANGES');
  assert.equal(changes.at(-1).visual.id, 'u', 'an undated photo was not placed last');
});

test('a document date is not a capture date; only EXIF on a photograph is', () => {
  const photo = visualDates({ kind: 'PHOTO', fileName: 'ფოტო.pdf', documentId: '980594', exifDate: '2023-05-02' }, CASES, { today: TODAY });
  assert.deepEqual(photo.dates.capture, { date: '2023-05-02', source: 'EXIF' });
  assert.deepEqual(photo.dates.document, { date: '2023-07-26', source: 'CASE_FILED', caseRef: 'AR1980594' });
  assert.equal(photo.caseRef, 'AR1980594');
  const noExif = visualDates({ kind: 'PHOTO', fileName: 'ფოტო.pdf', documentId: '980594' }, CASES);
  assert.equal(noExif.dates.capture, null, 'a filing date became a capture date');
  // A render (or a photomontage stored as PHOTO) has no camera date.
  assert.equal(visualDates({ kind: 'RENDER', exifDate: '2023-05-02', documentId: '980594' }, CASES).dates.capture, null);
  assert.equal(visualDates({ kind: 'PHOTO', fileName: 'ფოტომონტაჟი.pdf', exifDate: '2023-05-02' }, CASES).dates.capture, null);
  // A future EXIF date is refused.
  assert.equal(visualDates({ kind: 'PHOTO', exifDate: '2027-01-01' }, CASES, { today: TODAY }).dates.capture, null);
  // The card: verified capture, said as such, placed by it.
  const chrono = visualChronology(catalogVisuals([{ id: 'e', kind: 'PHOTO', url: SIGNED('e'), documentId: '980594', exifDate: '2023-05-02' }]), CASES, TODAY);
  const e = chrono.groups[0].items[0];
  assert.equal(e.photoDating, 'CAPTURED');
  assert.equal(e.date, '2023-05-02');
  assert.equal(e.dateSource, 'EXIF');
  assert.deepEqual(e.dated, { key: 'vfv_date_exif', vars: { date: '02.05.2023' } });
});

test('a FILE_NAME date is a document date, never a capture date', () => {
  const r = visualDates({ kind: 'PHOTO', fileName: 'ფოტო 14-04-2025.pdf', documentId: '1087185' }, CASES, { today: TODAY });
  assert.equal(r.dates.capture, null);
  assert.deepEqual(r.dates.document, { date: '2025-04-14', source: 'FILE_NAME', caseRef: 'AR11087185' });
  const r2 = visualDates({ kind: 'PHOTO', fileName: 'ფოტო 05-08.pdf', documentId: '1059939' }, CASES);
  assert.deepEqual(r2.dates.document, { date: '2024-08-05', source: 'FILE_NAME', caseRef: 'AR11059939' });
  assert.equal(r2.dates.capture, null);
  const label = photoDatedLabel(r.dates);
  assert.equal(label.dating, 'ARCHIVAL');
  assert.deepEqual(label.label, { key: 'vg_archival_photo', vars: { year: '2025' } });
  assert.deepEqual(label.notes, [{ key: 'vg_archival_note', vars: { date: '2025-04-14' } }]);
});

test('multiple blocks do not matter for dating: the case join dates every block alike', () => {
  const a = visualDates({ kind: 'PHOTO', block: 'A', fileName: 'ფოტო.pdf', documentId: '980594' }, CASES);
  const b = visualDates({ kind: 'PHOTO', block: '03', fileName: 'ფოტო.pdf', documentRef: { documentId: '980594' } }, CASES);
  assert.deepEqual(a, b);
  const cat = catalogVisuals([
    { id: 'a', kind: 'PHOTO', url: SIGNED('a'), documentId: '1087185', fileName: 'ფოტო 14-04-2025.pdf', block: '01' },
    { id: 'b', kind: 'PHOTO', url: SIGNED('b'), documentId: '1087185', fileName: 'ფოტო 14-04-2025.pdf', block: '02', scope: 'PROJECT', matchBasis: 'OTHER_BUILDING' },
  ]);
  const chrono = visualChronology(cat, CASES, TODAY);
  assert.deepEqual(groupOf(chrono, 'LATEST_PHOTOS').map((i) => i.date), ['2025-04-14', '2025-04-14']);
});

/* ── server build: withVisualDates; read path keeps them ── */

test('build time attaches caseRef and dates to every visual; the customer asset carries them; the client re-validates', async () => {
  const built = withVisualDates(EEEFADA9, DOCS, { today: TODAY });
  assert.equal(built.length, EEEFADA9.length);
  for (const v of built) assert.ok(v.caseRef, `${v.fileName} has no caseRef`);
  const render = built.find((v) => v.fileName === 'Render.pdf');
  assert.equal(render.caseRef, 'AR1144566');
  assert.deepEqual(render.dates, { capture: null, document: { date: '2013-07-06', source: 'CASE_FILED', caseRef: 'AR1144566' } });
  assert.equal(EEEFADA9[0].dates, undefined, 'the input record was mutated');
  const assets = await toCustomerVisualAssets(built, sign);
  assert.equal(assets.length, EEEFADA9.length);
  assert.equal(assets[0].caseRef, 'AR1144566');
  assert.deepEqual(assets[0].dates, render.dates);
  // A forged shape never survives.
  assert.equal(sanitizeVisualDates({ capture: { date: '2025-04-14', source: 'FILE_NAME' } }), null);
  assert.equal(sanitizeVisualDates({ document: { date: 'yesterday', source: 'CASE_FILED' } }), null);
  assert.equal(caseIndex([{ documentId: 'x', caseRef: 'AR1' }]).size, 0);
});

/* ── renders: case dates, never role or source order ── */

test('a historical render marked LATEST_RENDER (2013) is history; the newest dated render is the latest design', () => {
  const cat = catalogVisuals(EEEFADA9.map((v) => ({ ...v, url: SIGNED(v.id) })));
  const chrono = visualChronology(cat, CASES, TODAY);
  const render2013 = chrono.groups.flatMap((g) => g.items).find((i) => i.visual.fileName === 'Render.pdf');
  // v7 proof fix: outside the latest-design tab the stale role is demoted, so no "latest" badge or wording.
  assert.equal(render2013.visual.role, 'SUPPORTING');
  assert.equal(render2013.chapter, 'OLD');
  assert.deepEqual(render2013.historical.vars, { year: '2013' });
  assert.ok(!groupOf(chrono, 'LATEST').some((i) => i.visual.fileName === 'Render.pdf'));
  // Without any date an old role still never makes a render "the latest".
  const undated = visualChronology(catalogVisuals([{ id: 'r', kind: 'RENDER', role: 'LATEST_RENDER', url: SIGNED('r') }]), new Map(), TODAY);
  assert.equal(undated.groups[0].chapter, 'CHANGES');
  // A render filed five or more years ago is history whatever its file name.
  const named = visualChronology(catalogVisuals([{ id: 'n', kind: 'RENDER', fileName: 'ახალი რენდერი 2025.jpg', documentId: '137104', url: SIGNED('n') }]), CASES, TODAY);
  assert.equal(named.groups[0].chapter, 'OLD');
  // The UI never prints "latest design" on a render the dates put elsewhere.
  const ui = read('src/components/verify/VisualExplorer.tsx');
  assert.match(ui, /v\.role === 'LATEST_RENDER' && chronoOf\.get\(v\.id\)\?\.chapter !== 'LATEST' \? null/);
});

/* ── the real eeefada9 list ── */

for (const mode of ['joined on read', 'stored dates only']) {
  test(`eeefada9 (${mode}): four 2025 archival photos, badge 2025, photomontage latest, 2013 Render.pdf history`, async () => {
    const built = withVisualDates(EEEFADA9, DOCS, { today: TODAY });
    const assets = await toCustomerVisualAssets(built, sign);
    const cat = catalogVisuals(assets);
    const chrono = visualChronology(cat, mode === 'joined on read' ? CASES : new Map(), TODAY);
    assert.equal(chrono.defaultChapter, 'LATEST_PHOTOS');
    const photos = groupOf(chrono, 'LATEST_PHOTOS');
    assert.equal(photos.length, 4);
    for (const p of photos) {
      assert.equal(p.visual.fileName, 'ფოტო 14-04-2025.pdf');
      assert.equal(p.caseRef, 'AR11087185');
      assert.equal(p.photoDating, 'ARCHIVAL');
      assert.equal(p.dates.capture, null);
      assert.deepEqual(p.dated, { key: 'vg_capture_unknown_title', vars: {} });
      assert.deepEqual(p.photoLabel, { key: 'vg_archival_photo', vars: { year: '2025' } });
      assert.deepEqual(p.notes, [{ key: 'vg_archival_note', vars: { date: '2025-04-14' } }]);
      assert.equal(p.historical, null);
    }
    assert.deepEqual(chrono.latestPhotos, {
      kind: 'LAST_AVAILABLE', titleKey: 'vg_photos_last_title', bodyKey: 'vg_photos_last_body',
      badge: { key: 'vg_photos_badge', noteKey: 'vg_photos_badge_note', vars: { year: '2025' } },
    });
    assert.equal(chrono.noCurrentPhotos, true);
    assert.equal(chrono.hero.fileName, 'ფოტო 14-04-2025.pdf');
    const latest = groupOf(chrono, 'LATEST');
    assert.deepEqual(latest.map((i) => i.visual.fileName), ['ფოტომონტაჟი.pdf']);
    assert.equal(latest[0].caseRef, 'AR11110027');
    assert.equal(latest[0].date, '2025-09-23');
    const old = groupOf(chrono, 'OLD');
    assert.ok(old.some((i) => i.visual.fileName === 'Render.pdf'));
    // Historical photographs stay, dated, in the older tabs.
    const all = chrono.groups.flatMap((g) => g.items);
    const where = (f) => all.filter((i) => i.visual.fileName === f).map((i) => `${i.chapter}:${i.date}`);
    assert.deepEqual(where('foto.pdf'), ['OLD:2012-12-04', 'OLD:2012-12-04']);
    assert.deepEqual(where('ფოტო.pdf'), ['CHANGES:2023-07-26']);
    assert.deepEqual(where('არსებული ფოტოები.pdf'), ['CHANGES:2024-02-07']);
    assert.deepEqual(where('ფოტო 05-08.pdf'), ['CHANGES:2024-08-05']);
    assert.deepEqual(where('რენდ1.jpg'), ['CHANGES:2025-02-20']);
    for (const i of all) assert.notEqual(i.chapter, 'TODAY');
    // Newest first inside a tab, by verified date.
    for (const g of chrono.groups) {
      const dates = g.items.map((i) => i.date ?? '0000');
      assert.deepEqual(dates, [...dates].sort().reverse(), `${g.chapter} is not newest first`);
    }
  });
}

/* ── fresh photos ── */

const FRESH = {
  version: 1, status: 'FOUND', searchedAt: '2026-10-11T09:00:00Z', center: { lat: 41.77, lng: 44.75, basis: 'CADASTRAL' }, sources: [],
  photos: [{
    id: 'f'.repeat(64), path: 'fresh/abc.jpg', url: SIGNED('fresh-abc'), source: 'WIKIMEDIA_COMMONS',
    sourceUrl: 'https://commons.wikimedia.org/wiki/File:Digomi.jpg', author: 'Jane Doe', license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/', capturedAt: '2026-08-30', captureDateSource: 'EXIF',
    publishedAt: '2026-09-02', retrievedAt: '2026-10-11T09:00:00Z', distanceM: 40, scope: 'BUILDING', width: 4000, height: 3000,
  }],
};

test('a verified fresh web photo overrides older official photos as the opening image', async () => {
  const assets = await toCustomerVisualAssets(withVisualDates(EEEFADA9, DOCS, { today: TODAY }), sign);
  const cat = [...catalogFreshPhotos(FRESH, { today: TODAY }), ...catalogVisuals(assets)];
  const chrono = visualChronology(cat, CASES, TODAY);
  assert.equal(chrono.defaultChapter, 'LATEST_PHOTOS');
  assert.equal(chrono.hero.id, `fresh:${'f'.repeat(64)}`);
  const photos = groupOf(chrono, 'LATEST_PHOTOS');
  assert.deepEqual(ids(photos), [`fresh:${'f'.repeat(64)}`], 'unverified official photos shared the verified newest tab');
  assert.equal(photos[0].photoDating, 'CAPTURED');
  assert.equal(photos[0].dateSource, 'EXIF');
  assert.deepEqual(photos[0].dated, { key: 'vfv_date_exif', vars: { date: '30.08.2026' } });
  assert.equal(chrono.latestPhotos.kind, 'NEWEST_VERIFIED');
  assert.equal(chrono.latestPhotos.titleKey, 'vg_photos_fresh_title');
  assert.equal(chrono.latestPhotos.badge, null);
  assert.equal(chrono.noCurrentPhotos, false);
  // The 2025 official photos stay, dated as archival, in the changes tab.
  assert.equal(groupOf(chrono, 'CHANGES').filter((i) => i.visual.fileName === 'ფოტო 14-04-2025.pdf').length, 4);
  // Credit kept: source, author, license, capture and (separately) publication date.
  const f = photos[0].visual.fresh;
  assert.equal(f.author, 'Jane Doe');
  assert.equal(f.license, 'CC BY-SA 4.0');
  assert.equal(f.licenseUrl, 'https://creativecommons.org/licenses/by-sa/4.0/');
  assert.deepEqual(f.capture, { date: '2026-08-30', source: 'EXIF' });
  assert.equal(f.publishedAt, '2026-09-02');
  assert.equal(f.retrievedAt, '2026-10-11');
});

test('a fresh photo without a stated capture date is not "newest": publication is never capture', () => {
  const noCapture = { photos: [{ ...FRESH.photos[0], capturedAt: null, captureDateSource: null }] };
  assert.equal(freshPhotoViews(noCapture)[0].capture, null);
  const sourceless = { photos: [{ ...FRESH.photos[0], captureDateSource: null }] };
  assert.equal(freshPhotoViews(sourceless)[0].capture, null, 'a capture date without its source was trusted');
  const cat = [...catalogFreshPhotos(noCapture), ...catalogVisuals(EEEFADA9.map((v) => ({ ...v, url: SIGNED(v.id) })))];
  const chrono = visualChronology(cat, CASES, TODAY);
  assert.equal(chrono.latestPhotos.kind, 'LAST_AVAILABLE');
  assert.ok(!groupOf(chrono, 'LATEST_PHOTOS').some((i) => i.visual.fresh));
  // Without a signed URL a fresh photo is not shown at all.
  assert.equal(catalogFreshPhotos({ photos: [{ ...FRESH.photos[0], url: 'https://evil.example/x.jpg' }] }).length, 0);
  assert.equal(catalogFreshPhotos({ status: 'NOT_RUN', photos: [] }).length, 0);
  assert.equal(catalogFreshPhotos(undefined).length, 0);
});

test('no fresh photo: the fallback copy, with the year badge only when that year is past', () => {
  const thisYear = visualChronology(catalogVisuals([{ id: 'p', kind: 'PHOTO', url: SIGNED('p'), documentId: '1', fileName: 'ფოტო 02-03-2026.pdf' }]), new Map([['1', { date: '2026-03-02' }]]), TODAY);
  assert.equal(thisYear.latestPhotos.kind, 'LAST_AVAILABLE');
  assert.equal(thisYear.latestPhotos.titleKey, 'vg_photos_last_title');
  assert.equal(thisYear.latestPhotos.badge, null);
  const none = visualChronology(catalogVisuals([{ id: 'r', kind: 'RENDER', url: SIGNED('r') }]), new Map(), TODAY);
  assert.equal(none.latestPhotos, null);
  assert.equal(none.noCurrentPhotos, true);
});

/* ── Georgian dates, UI wiring, copy ── */

test('the document date reads as a document date: KA instrumental, never "აპრილის ფოტო"', () => {
  assert.equal(kaDatedBy('2025-04-14'), '2025 წლის 14 აპრილით');
  assert.equal(kaDatedBy('2024-08-05'), '2024 წლის 5 აგვისტოთი');
  assert.equal(kaDatedBy('2025-09-23'), '2025 წლის 23 სექტემბრით');
  assert.equal(kaDatedBy(null), null);
  assert.equal(documentDatePhrase('2025-04-14', 'ka'), '2025 წლის 14 აპრილით');
  assert.match(documentDatePhrase('2025-04-14', 'en'), /14 April 2025/);
  const ka = S.vg_archival_note[1].replace('{{date}}', kaDatedBy('2025-04-14'));
  assert.ok(ka.includes('რომლებიც 2025 წლის 14 აპრილით თარიღდება'));
});

test('the explorer takes freshPhotos, says which photo case applies, and never labels a tab "today"', () => {
  const ui = read('src/components/verify/VisualExplorer.tsx');
  assert.match(ui, /freshPhotos\?: unknown;/);
  assert.match(ui, /catalogFreshPhotos\(freshPhotos/);
  assert.match(ui, /current === 'LATEST_PHOTOS' && chrono\.latestPhotos \? <LatestPhotosNote h=\{chrono\.latestPhotos\} \/>/);
  assert.match(ui, /data-fresh-credit/);
  assert.match(ui, /t\('vg_fresh_published'\)/);
  assert.match(ui, /t\('vg_fresh_license'\)/);
  assert.match(ui, /documentDatePhrase\(/);
  assert.ok(!ui.includes('vev_tab_today'));
  assert.ok(!ui.includes('heroVisual('), 'the opening image bypassed the dated chronology');
  const synth = read('supabase/functions/verify-synthesis/index.ts');
  assert.match(synth, /officialVisuals: withVisualDates\(\s*annotateVisualQuality\(persistableVisuals\(/);
  assert.match(synth, /pkg\.dossier\?\.officialDocuments \?\? \[\],/);
});

test('v7 gallery copy: six locales, placeholders intact, owner-approved Georgian verbatim, in the bundle', () => {
  const bundle = read('src/i18n/translations.ts');
  for (const [k, v] of Object.entries(S)) {
    assert.equal(v.length, 6, k);
    const want = (v[0].match(/\{\{\w+\}\}/g) ?? []).sort().join();
    for (const s of v) {
      assert.equal((s.match(/\{\{\w+\}\}/g) ?? []).sort().join(), want, `${k}: ${s}`);
      assert.ok(!s.includes('—'), `${k}: em dash`);
    }
    assert.equal([...bundle.matchAll(new RegExp(`^  ${k}: `, 'gm'))].length, 6, `${k} is not in all six bundles`);
  }
  assert.equal(S[CHAPTER_KEY.LATEST_PHOTOS][1], 'უახლესი ფოტოები');
  assert.equal(CHAPTER_ORDER[0], 'LATEST_PHOTOS');
  assert.equal(S.vg_photos_fresh_title[1], 'შენობის უახლესი ფოტოები');
  assert.equal(S.vg_photos_fresh_body[1], 'ეს ფოტოები ასახავს შენობის ჩვენ მიერ მოძიებულ უახლეს მდგომარეობას. თითოეულ გამოსახულებას მითითებული აქვს წყარო და დადასტურებული თარიღი.');
  assert.equal(S.vg_photos_last_title[1], 'ბოლო ხელმისაწვდომი ფოტო');
  assert.equal(S.vg_photos_last_body[1], 'შენობის უფრო ახალი, დადასტურებული ფოტო ამ ეტაპზე ვერ მოვიძიეთ. ამიტომ გაჩვენებთ ბოლო ხელმისაწვდომ გამოსახულებას, რომელიც შესაძლოა დღევანდელ მდგომარეობას აღარ ასახავდეს.');
  assert.equal(S.vg_photos_badge[1], 'უახლესი მოძიებული ფოტო | {{year}} წელი');
  assert.equal(S.vg_photos_badge_note[1], 'ეს არის ჩვენ მიერ მოძიებული ერთ-ერთი უახლესი ფოტო, თუმცა იგი {{year}} წლით თარიღდება და შესაძლოა შენობის დღევანდელ მდგომარეობას სრულად აღარ ასახავდეს.');
  assert.equal(S.vg_archival_photo[1], '{{year}} წლის საარქივო ფოტო');
  assert.equal(S.vg_archival_note[1], 'ეს ფოტო წარმოდგენილია ოფიციალურ მასალებში, რომლებიც {{date}} თარიღდება. ფოტოს გადაღების ზუსტი თარიღი ცალკე უნდა დადასტურდეს. იგი გვიჩვენებს შენობის იმ პერიოდში დოკუმენტირებულ მდგომარეობას და არა აუცილებლად დღევანდელ სურათს.');
  assert.equal(S.vg_capture_unknown_title[1], 'ფოტოს გადაღების თარიღი უცნობია');
  assert.equal(S.vg_capture_unknown_body[1], 'გამოსახულება მოძიებულია ოფიციალურ მასალებში, თუმცა მისი გადაღების ზუსტი თარიღი ვერ დადასტურდა.');
});
