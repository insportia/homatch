// The gallery after job 61c1c38c (2026-10-22): 24 official visuals stored,
// all 5000×400 slices of one TAS photomontage, all rejected as STRIP — and
// the gallery said "no official images were found". Held here:
//   - assets assembled from PDF tiles (official-worker pdfTiles.ts) keep their
//     provenance (PDF_TILES_STITCHED, page, sourceTiles) to the customer;
//   - every visual carries an evidence category mapped from its kind; a
//     render / photomontage is never a PROPERTY_PHOTO;
//   - an empty gallery says WHY: none found, or found but not presentable
//     (withheld by the server, or every image failed to load).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  evidenceCategoryOf, EVIDENCE_CATEGORY_OF_KIND, VISUAL_KINDS, VISUAL_EXTRACTIONS, withheldVisualCount, toCustomerVisualAssets, persistableVisuals,
} from '../intelligence/visualAssets.ts';
import { annotateVisualQuality, isUnusableVisual } from '../intelligence/visualQuality.ts';
import { storedVisualRecord } from '../intelligence/visualRecovery.ts';
import { catalogVisuals, catalogFreshPhotos, galleryEmptyReason, GALLERY_EMPTY_KEY } from '../visualCatalog.ts';
import { VERIFY_REPORT_UI_STRINGS } from '../../../scripts/verify-report-ui-i18n-data.mjs';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const read = (f) => readFileSync(join(ROOT, f), 'utf8');
const sha = (n) => n.toString(16).padStart(64, '0');
const SIGNED = (id) => `https://x.supabase.co/storage/v1/object/sign/verify-official-visuals/tas/${id}.jpg?token=t`;
const signer = async (paths) => Object.fromEntries(paths.map((p) => [p, SIGNED(p.slice(4, 68))]));

// The production shape of job 61c1c38c's records (sizes from storage.objects).
const STRIPS_61C1 = Array.from({ length: 24 }, (_, i) => ({
  id: sha(i + 1), kind: i < 12 ? 'RENDER' : 'PHOTO', category: 'BUILDING', role: 'SUPPORTING', scope: 'PROJECT',
  width: i < 12 ? 5000 : 5472, height: i < 12 ? 400 : 366, bytes: 104_000 + i, mime: 'image/jpeg',
  extraction: 'PDF_EMBEDDED_IMAGE', storagePath: `tas/${sha(i + 1)}.jpg`, documentId: '1107725', attachedFileId: '5108620',
  fileName: 'მონტაჟი+ განთავსება+ კონსტრუქცია.pdf',
}));

test('job 61c1c38c: 24 strips → nothing shown, and the 24 are counted as withheld, not as "none found"', async () => {
  const annotated = annotateVisualQuality(STRIPS_61C1, new Map());
  assert.ok(annotated.every((v) => v.quality.verdict === 'STRIP' && isUnusableVisual(v)));
  const shown = await toCustomerVisualAssets(annotated, signer);
  assert.equal(shown.length, 0);
  assert.equal(withheldVisualCount(annotated, shown.length), 24);
  assert.equal(galleryEmptyReason({ catalogued: catalogVisuals(shown).length, broken: 0, withheld: 24 }), 'NOT_PRESENTABLE');
  // Out-of-parcel assets are not "found for this property"; duplicates count once.
  assert.equal(withheldVisualCount([...annotated, annotated[0], { ...annotated[1], id: sha(99), scope: 'UNRELATED_SUSPECT' }], 0), 24);
  assert.equal(withheldVisualCount(undefined, 0), 0);
});

test('a stitched asset reaches the customer with its provenance and is no longer a strip', async () => {
  assert.ok(VISUAL_EXTRACTIONS.includes('PDF_TILES_STITCHED'));
  const tiles = [sha(1), sha(2), sha(3)];
  const stored = [{
    id: sha(500), kind: 'RENDER', category: 'BUILDING', role: 'LATEST_RENDER', width: 5000, height: 2999, bytes: 3_991_711, mime: 'image/jpeg',
    extraction: 'PDF_TILES_STITCHED', page: 3, sourceTiles: tiles, storagePath: `tas/${sha(500)}.jpg`, documentId: '1107725', attachedFileId: '5108620',
    fileName: 'მონტაჟი+ განთავსება+ კონსტრუქცია.pdf',
  }];
  const persisted = persistableVisuals(stored, [{ id: sha(500), kind: 'RENDER', scope: 'PROJECT' }]);
  assert.deepEqual(persisted[0].sourceTiles, tiles);
  const [asset] = await toCustomerVisualAssets(annotateVisualQuality(persisted, new Map()), signer);
  assert.ok(asset, 'the stitched picture is shown');
  assert.equal(asset.page, 3);
  assert.equal(asset.documentRef.extraction, 'PDF_TILES_STITCHED');
  assert.deepEqual(asset.documentRef.sourceTiles, tiles);
  assert.equal(asset.documentRef.attachedFileId, '5108620');
  assert.equal(asset.evidenceCategory, 'OFFICIAL_DOCUMENT', 'a photomontage is a design document, not a property photo');
  // The recovery path keeps the same provenance.
  assert.deepEqual(storedVisualRecord(stored[0], {}).sourceTiles, tiles);
  // research-agent copies it into the report record.
  assert.match(read('supabase/functions/research-agent/index.ts'), /sourceTiles: v\.sourceTiles\.filter\(/);
  assert.match(read('supabase/functions/verify-synthesis/index.ts'), /officialVisualsWithheld: withheld/);
});

test('evidence categories: every kind maps; renders and montages are never property photos', () => {
  for (const k of VISUAL_KINDS) assert.ok(EVIDENCE_CATEGORY_OF_KIND[k], k);
  const table = [
    ['PHOTO', null, 'PROPERTY_PHOTO'], ['CONSTRUCTION_PHOTO', null, 'PROPERTY_PHOTO'], ['RENDER', null, 'OFFICIAL_DOCUMENT'],
    ['PHOTO', 'fotomontaji da aqsiometriuli xedebi.pdf', 'OFFICIAL_DOCUMENT'], ['PHOTO', 'ფოტომონტაჟი.pdf', 'OFFICIAL_DOCUMENT'],
    ['SITE_PLAN', null, 'CADASTRAL_MAP'], ['MASTER_PLAN', null, 'CADASTRAL_MAP'], ['FLOOR_PLAN', null, 'FLOOR_PLAN'], ['UNIT_PLAN', null, 'FLOOR_PLAN'],
    ['LOCATION_DIAGRAM', null, 'LOCATION_IMAGERY'], ['FACADE', null, 'OFFICIAL_DOCUMENT'], ['STRUCTURAL', null, 'OFFICIAL_DOCUMENT'],
    ['OTHER', null, 'OFFICIAL_DOCUMENT'], ['LANDSCAPE', null, 'CADASTRAL_MAP'], ['nonsense', null, 'OFFICIAL_DOCUMENT'],
  ];
  for (const [kind, fileName, want] of table) assert.equal(evidenceCategoryOf(kind, { fileName }), want, `${kind} ${fileName ?? ''}`);
  assert.equal(evidenceCategoryOf('PHOTO', { freshScope: 'BUILDING' }), 'PROPERTY_PHOTO');
  assert.equal(evidenceCategoryOf('PHOTO', { freshScope: 'DEVELOPMENT' }), 'LOCATION_IMAGERY');
  // The catalogue carries it next to the kind (the kind and its badge are unchanged).
  const vs = catalogVisuals([
    { id: 'a', kind: 'PHOTO', url: SIGNED(sha(1)), fileName: 'ფოტომონტაჟი.pdf' },
    { id: 'b', kind: 'PHOTO', url: SIGNED(sha(2)), fileName: 'არსებული ფოტოები.pdf' },
    { id: 'c', kind: 'FLOOR_PLAN', url: SIGNED(sha(3)) },
  ]);
  assert.deepEqual(vs.map((v) => [v.kind, v.badge, v.evidenceCategory]), [['RENDER', 'RENDER', 'OFFICIAL_DOCUMENT'], ['PHOTO', 'PHOTO', 'PROPERTY_PHOTO'], ['FLOOR_PLAN', 'PLAN', 'FLOOR_PLAN']]);
  const fresh = catalogFreshPhotos({ photos: [{ id: 'f1', url: SIGNED(sha(9)), source: 'WIKIMEDIA_COMMONS', scope: 'DEVELOPMENT', capturedAt: '2026-09-01', captureDateSource: 'EXIF', license: 'CC BY 4.0' }] }, { today: '2026-10-22' });
  for (const f of fresh) assert.equal(f.evidenceCategory, 'LOCATION_IMAGERY');
});

test('empty-state reason: none found vs found-but-not-presentable (withheld, or every image broken)', () => {
  assert.equal(galleryEmptyReason({ catalogued: 0, broken: 0 }), 'NONE_FOUND');
  assert.equal(galleryEmptyReason({ catalogued: 0, broken: 0, withheld: 0 }), 'NONE_FOUND');
  assert.equal(galleryEmptyReason({ catalogued: 0, broken: 0, withheld: '3' }), 'NONE_FOUND', 'only a real count says images exist');
  assert.equal(galleryEmptyReason({ catalogued: 0, broken: 0, withheld: 5 }), 'NOT_PRESENTABLE');
  assert.equal(galleryEmptyReason({ catalogued: 4, broken: 4 }), 'NOT_PRESENTABLE', 'every image failed to load');
  assert.equal(galleryEmptyReason({ catalogued: 4, broken: 3 }), null);
  assert.equal(GALLERY_EMPTY_KEY.NOT_PRESENTABLE, 'vrx_explore_unpresentable');
  // Six locales, none of them a "nothing was found".
  const strings = VERIFY_REPORT_UI_STRINGS.vrx_explore_unpresentable;
  assert.equal(strings.length, 6);
  const tr = read('src/i18n/translations.ts');
  for (const s of strings) assert.ok(tr.includes(`  vrx_explore_unpresentable: '${s}',`), s.slice(0, 30));
  assert.match(strings[0], /were found/);
  // Broken images feed the reason instead of vanishing silently.
  const ui = read('src/components/verify/VisualExplorer.tsx');
  assert.match(ui, /galleryEmptyReason\(\{ catalogued: catalog\.length, broken: catalog\.length - usable\.length, withheld \}\)/);
  assert.match(read('src/components/verify/VerifyReport.tsx'), /withheld=\{\(synthesis as \{ officialVisualsWithheld\?: unknown \}\)\.officialVisualsWithheld\}/);
});
