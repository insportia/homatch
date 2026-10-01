// The visual catalogue: no blind selection, no 2,000 signing calls, and an
// imported material wears its maps at its real scale instead of turning white.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createSignedUrlBatcher } from '../signedUrlBatcher.ts';
import { LIST_PAGE, nextShown, shownCount } from '../incrementalList.ts';
import { hasPbrMaps, pbrRepeat, pbrResolution, resolutionEdge, selectPbrMaps } from '../pbrMaps.ts';
import { ASSET_TAG_KEYS, assetTagKeys } from '../assetTags.ts';

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/* ── Signed URL batching and caching ─────────────────────────────── */

function harness(signImpl) {
  let clock = 1_000_000;
  const timers = [];
  const signed = [];
  const b = createSignedUrlBatcher({
    sign: async (keys) => { signed.push([...keys]); return signImpl ? signImpl(keys) : new Map(keys.map((k) => [k, `https://cdn.test/${k}?t=${clock}`])); },
    expiresInS: 600,
    safetyMarginMs: 60_000,
    windowMs: 50,
    now: () => clock,
    schedule: (fn) => { timers.push(fn); },
  });
  const flush = async () => { while (timers.length) timers.shift()(); await new Promise((r) => setImmediate(r)); };
  return { b, signed, flush, advance: (ms) => { clock += ms; } };
}

test('requests within one window are signed in ONE call', async () => {
  const { b, signed, flush } = harness();
  const ps = ['a', 'b', 'c', 'a'].map((k) => b.get(k));
  await flush();
  const urls = await Promise.all(ps);
  assert.equal(signed.length, 1);
  assert.deepEqual(signed[0].sort(), ['a', 'b', 'c']);
  assert.ok(urls.every((u) => typeof u === 'string'));
  assert.equal(urls[0], urls[3]);
  assert.equal(b.calls, 1);
});

test('a cached URL is reused until shortly before it expires, then re-signed', async () => {
  const { b, signed, flush, advance } = harness();
  const first = b.get('k'); await flush(); const u1 = await first;
  assert.equal(b.peek('k'), u1);
  advance(500_000); // 500 s < 600 s − 60 s margin
  assert.equal(await b.get('k'), u1);
  assert.equal(signed.length, 1);
  advance(60_000); // 560 s: inside the safety margin
  assert.equal(b.peek('k'), null);
  const again = b.get('k'); await flush(); const u2 = await again;
  assert.equal(signed.length, 2);
  assert.notEqual(u2, u1);
});

test('a key that cannot be signed resolves null and is not retried at once', async () => {
  const { b, signed, flush, advance } = harness(() => new Map());
  const p = b.get('missing'); await flush();
  assert.equal(await p, null);
  assert.equal(await b.get('missing'), null);
  assert.equal(signed.length, 1);
  advance(61_000);
  const p2 = b.get('missing'); await flush(); await p2;
  assert.equal(signed.length, 2);
});

test('a signer that throws never rejects a row', async () => {
  const { b, flush } = harness(() => { throw new Error('offline'); });
  const p = b.get('x'); await flush();
  assert.equal(await p, null);
});

test('invalidate() forgets a URL (a picture that failed to load is re-signed next time)', async () => {
  const { b, signed, flush } = harness();
  const p = b.get('k'); await flush(); await p;
  b.invalidate('k');
  const p2 = b.get('k'); await flush(); await p2;
  assert.equal(signed.length, 2);
});

test('nothing is signed until a row asks (no eager signing on mount)', () => {
  const { b, signed } = harness();
  assert.equal(b.peek('anything'), null);
  assert.equal(signed.length, 0);
});

/* ── Incremental rendering ───────────────────────────────────────── */

test('a 2,000-row result draws one page, then a page at a time', () => {
  assert.equal(LIST_PAGE, 40);
  assert.equal(shownCount(2000, LIST_PAGE), 40);
  assert.equal(nextShown(40, 2000), 80);
  assert.equal(shownCount(2000, nextShown(40, 2000)), 80);
  assert.equal(nextShown(1990, 2000), 2000);
  assert.equal(shownCount(12, LIST_PAGE), 12);
  assert.equal(shownCount(0, LIST_PAGE), 0);
  // A shrinking result (a narrower search) never shows phantom rows.
  assert.equal(shownCount(5, 400), 5);
});

test('the furniture panel and material list render through the page cap, ranking untouched', () => {
  const panel = read('src/components/designStudio/workspace/FurniturePanel.tsx');
  assert.match(panel, /useIncrementalList\(results\.length/);
  assert.match(panel, /results\.slice\(0, list\.shown\)/);
  assert.match(panel, /rankAssets\(assets, q, \{ roomKind \}\)/);
  assert.doesNotMatch(panel, /\) : results\.map\(/);
  // Replace mode uses the same visual rows.
  assert.match(panel, /<CatalogThumb thumbKey=\{asset\.thumbnailKey\}/);
  const materials = read('src/components/designStudio/workspace/SurfacePanels.tsx');
  assert.match(materials, /materials\.slice\(0, list\.shown\)/);
  assert.match(materials, /<CatalogThumb\s+thumbKey=\{m\.thumbnailKey\}/);
});

test('thumbnails are signed lazily: only on screen, batched, lazy-loaded, fixed box', () => {
  const thumb = read('src/components/designStudio/workspace/CatalogThumb.tsx');
  assert.match(thumb, /IntersectionObserver/);
  assert.match(thumb, /catalogUrls\(\)\.get\(thumbKey\)/);
  assert.match(thumb, /loading="lazy"/);
  assert.match(thumb, /if \(!thumbKey \|\| !visible \|\| url\) return;/);
});

/* ── Imported material maps ──────────────────────────────────────── */

const imported = {
  baseColor: '#ffffff', roughness: 1, metalness: 1,
  maps: { albedo: 'p/1k/a.jpg', normal: 'p/1k/n.jpg', roughness: 'p/1k/orm.jpg' },
  mapsByRes: {
    '1k': { albedo: 'p/1k/a.jpg', normal: 'p/1k/n.jpg', orm: 'p/1k/orm.jpg' },
    '2k': { albedo: 'p/2k/a.jpg', normal: 'p/2k/n.jpg', orm: 'p/2k/orm.jpg' },
  },
  variants: { mobile: '1k', desktop: '2k' },
  physicalSizeM: [2, 1],
  repeatM: 2,
  controls: { repeatM: 2, rotationDeg: 0, scale: 1, roughnessFactor: 1, metalnessFactor: 1, normalScale: 1 },
};

test('hand-made materials keep the flat-colour path', () => {
  assert.equal(hasPbrMaps({ baseColor: '#aabbcc', roughness: 0.8, metalness: 0 }), false);
  assert.equal(selectPbrMaps({ baseColor: '#aabbcc', roughness: 0.8, metalness: 0 }, 'HIGH'), null);
  assert.equal(selectPbrMaps(undefined, 'HIGH'), null);
  assert.equal(hasPbrMaps(imported), true);
});

test('resolution follows the quality tier and the texture budget', () => {
  assert.equal(resolutionEdge('1k'), 1024);
  assert.equal(resolutionEdge('2k'), 2048);
  assert.equal(pbrResolution(imported, 'LOW', 512), '1k');
  assert.equal(pbrResolution(imported, 'HIGH', 2048), '2k');
  // BALANCED (phones) has a 1024 budget: the desktop 2K would exceed it.
  assert.equal(pbrResolution(imported, 'BALANCED', 1024), '1k');
  assert.equal(pbrResolution(imported, 'BALANCED'), '2k');
  // Only a 1K exists: everyone gets it.
  const only1k = { ...imported, mapsByRes: { '1k': imported.mapsByRes['1k'] }, variants: { mobile: '1k', desktop: '1k' } };
  assert.equal(pbrResolution(only1k, 'HIGH', 2048), '1k');
  const sel = selectPbrMaps(imported, 'HIGH', 2048);
  assert.equal(sel.albedo, 'p/2k/a.jpg');
  assert.equal(sel.orm, 'p/2k/orm.jpg');
  assert.equal(sel.normal, 'p/2k/n.jpg');
  assert.equal(selectPbrMaps(imported, 'LOW', 512).albedo, 'p/1k/a.jpg');
});

test('repeat comes from the physical tile size (plan-metre UVs), with safe fallbacks', () => {
  assert.deepEqual(pbrRepeat(imported), [0.5, 1]);
  assert.deepEqual(pbrRepeat({ physicalSizeM: null, repeatM: 0.5 }), [2, 2]);
  assert.deepEqual(pbrRepeat({ physicalSizeM: null, repeatM: 0 }), [1, 1]);
  assert.deepEqual(pbrRepeat({}), [1, 1]);
  // The editor widened the tile: proportions are kept.
  assert.deepEqual(pbrRepeat({ ...imported, controls: { repeatM: 4 } }), [0.25, 0.5]);
  // Model parts use their own UVs: once per UV unit.
  assert.deepEqual(selectPbrMaps(imported, 'HIGH', 2048, false).repeat, [1, 1]);
  // The signature changes with what is shown.
  assert.notEqual(selectPbrMaps(imported, 'HIGH', 2048).signature, selectPbrMaps(imported, 'LOW', 512).signature);
});

test('the scene wears ORM glTF-style, sRGB albedo only, and drops late loads', () => {
  const tex = read('src/components/designStudio/canvas/pbrTextures.ts');
  assert.match(tex, /srgb \? THREE\.SRGBColorSpace : THREE\.NoColorSpace/);
  assert.match(tex, /m\.aoMap = set\.orm;/);
  assert.match(tex, /m\.roughnessMap = set\.orm;/);
  assert.match(tex, /m\.metalnessMap = set\.orm;/);
  assert.match(tex, /THREE\.RepeatWrapping/);
  assert.doesNotMatch(tex, /KTX2Loader/); // JPEG maps for now
  const sc = read('src/components/designStudio/canvas/SceneController.ts');
  assert.match(sc, /selectPbrMaps\(mat\.pbr, this\.quality\.tier, this\.quality\.maxTextureSize\)/);
  assert.match(sc, /m\.userData\.pbrSig !== sel\.signature \|\| !live\(\)/);
  assert.match(sc, /this\.pbr\.dispose\(\)/);
  assert.match(sc, /metreUVs\(plane, piece\.u, piece\.v/);
});

/* ── Copy ────────────────────────────────────────────────────────── */

test('the outdated "library is being prepared" copy is gone in all six locales', () => {
  const src = read('src/i18n/translations.ts');
  const lines = src.split('\n').filter((l) => /^\s{2}ds_library_placeholder_note: /.test(l));
  assert.equal(lines.length, 6);
  const stale = [/being prepared/i, /მზადდება/, /готовится/, /hazırlanıyor/, /قيد الإعداد/, /בהכנה/];
  for (const l of lines) for (const s of stale) assert.doesNotMatch(l, s);
  const notes = src.split('\n').filter((l) => /^\s{2}ds_materials_note: /.test(l));
  assert.equal(notes.length, 6);
  for (const l of notes) assert.doesNotMatch(l, /arrive with the licensed|დაემატება|появятся|gelecek|ستأتي|יגיעו/);
});

test('every tag key the rows can show exists in all six locales', () => {
  const counts = new Map();
  for (const l of read('src/i18n/translations.ts').split('\n')) {
    const m = /^ {2}([a-z0-9_]+): /.exec(l);
    if (m) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  }
  for (const key of [...ASSET_TAG_KEYS, 'ds_cat_textile', 'ds_library_show_more', 'ds_library_showing']) {
    assert.equal(counts.get(key), 6, `${key} appears ${counts.get(key)} times`);
  }
});

test('tags: one style, then materials, then colours; unknown words are dropped', () => {
  assert.deepEqual(
    assetTagKeys({ styleTags: ['scandinavian', 'minimal'], materialTags: ['oak', 'linen', 'unobtainium'], colorTags: ['beige'] }),
    ['ds_style_scandinavian', 'ds_tag_mat_wood', 'ds_tag_mat_fabric', 'ds_tag_col_beige'],
  );
  assert.deepEqual(
    assetTagKeys({ styleTags: [], materialTags: [], colorTags: ['beige'], colorFamilies: ['WOOD_DARK', 'METALLIC'] }),
    ['ds_tag_col_wood_dark', 'ds_tag_col_metallic'],
  );
  assert.deepEqual(assetTagKeys({ styleTags: ['zzz'], materialTags: [], colorTags: [] }), []);
  assert.equal(assetTagKeys({ styleTags: [], materialTags: ['wood', 'metal', 'glass', 'stone'], colorTags: ['white'] }, 3).length, 3);
});
