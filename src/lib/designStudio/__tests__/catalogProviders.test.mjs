// Provider adapters: each knows only its provider, and all of them feed one
// catalogue. Poly Haven: materials and HDRIs only (objects come from
// Blendkit). Blendkit: objects, per-asset licence, quality from metadata,
// GLB only, the key never leaves Supabase. Fixtures are real listings.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as C from '../catalogSource.ts';
import * as P from '../catalogProviders/polyhaven.ts';
import * as B from '../catalogProviders/blendkit.ts';

const PH = JSON.parse(fs.readFileSync(new URL('./fixtures/polyhaven-sample.json', import.meta.url), 'utf8'));
const BK = JSON.parse(fs.readFileSync(new URL('./fixtures/blendkit-sample.json', import.meta.url), 'utf8'));
const KIND = { textures: 'MATERIAL', models: 'MODEL', hdris: 'ENVIRONMENT' };
const phPlan = (id) => {
  const s = PH[id]; const kind = KIND[s.type];
  const c = P.classify(kind, s.asset.category, id);
  return { c, p: c ? P.plan(kind, id, s.asset, s.files, c) : null };
};

test('Poly Haven: materials and environments only — its models are not selected', () => {
  assert.equal(P.classify('MODEL', 'Furniture/Seating', 'ArmChair_01'), null, 'objects come from Blendkit');
  assert.equal(P.plan('MODEL', 'ArmChair_01', PH.ArmChair_01.asset, PH.ArmChair_01.files, { canonicalCategory: 'OBJECT.FURNITURE', canonicalSubcategory: 'SEATING' }).refusal, 'provider policy: physical objects come from Blendkit');
  assert.equal(P.classify('MATERIAL', 'Wood/Bark/Pine', 'pine_bark'), null);
});

test('Poly Haven material: its maps at 1K and 2K (never the preview mesh), public (CC0)', () => {
  const { c, p } = phPlan('rough_concrete');
  assert.deepEqual(c, { canonicalCategory: 'MATERIAL.CONCRETE', canonicalSubcategory: 'CAST' });
  assert.equal(p.refusal, null);
  assert.deepEqual(p.resolutions, ['1k', '2k']);
  for (const r of ['1k', '2k']) for (const role of ['BASE_COLOR', 'NORMAL', 'ORM']) assert.ok(p.files.some((f) => f.role === role && f.resolution === r), `${role} ${r}`);
  assert.ok(p.files.some((f) => f.role === 'BASE_COLOR' && /_diff_1k\.jpg$/.test(f.relPath)), '"rough" in the asset name does not make a colour map ORM');
  assert.ok(!p.files.some((f) => f.relPath.endsWith('.bin') || /_(4k|8k)\./.test(f.relPath)));
  assert.ok(p.files.every((f) => f.delivery === 'public'));
  assert.ok(p.files.filter((f) => f.sourceUrl && f.role !== 'THUMBNAIL').every((f) => f.md5 && f.bytes > 0), 'exact sizes and checksums');
  assert.equal(P.LICENSE.providerLicense, 'CC0-1.0');
  assert.equal(P.LICENSE.licenseClass, 'CC0');
});

test('Poly Haven HDRI: 1K/2K, plus 4K only for a visible background; classified by its light', () => {
  const { c, p } = phPlan('aristea_wreck_puresky');
  assert.equal(c.canonicalSubcategory, 'PURE_SKY');
  assert.deepEqual(p.resolutions, ['1k', '2k', '4k']);
  assert.equal(P.HDRI_4K_SUBCATEGORIES.has('PARK'), false);
  const cls = P.environmentClass({ ...PH.aristea_wreck_puresky.asset, attributes: { time_of_day: 'sunset' } }, c);
  assert.deepEqual(cls, { lighting: 'SUNSET', context: 'SKY' });
  assert.match(P.name('ENVIRONMENT', PH.aristea_wreck_puresky.asset, c).displayName, / HDRI — Aristea Wreck$/);
});

test('Blendkit licence: per asset; CC0 is delivered, Royalty-Free is STOPPED, anything else UNKNOWN', () => {
  assert.equal(B.licenseOf(BK.cc0).licenseClass, 'CC0');
  assert.equal(C.licenseRefusal(B.licenseOf(BK.cc0)), null);
  assert.equal(B.licenseOf(BK.rf).licenseClass, 'ROYALTY_FREE');
  assert.match(C.licenseRefusal(B.licenseOf(BK.rf)), /does not permit runtime delivery/, 'the extraction clause is not guessed away');
  assert.equal(B.licenseOf({ license: 'editorial' }).licenseClass, 'UNKNOWN');
  assert.equal(B.licenseOf({}).licenseClass, 'UNKNOWN');
});

test('Blendkit taxonomy and quality: from metadata; GLB only; polygon count is not quality', () => {
  const c = B.classify(BK.cc0);
  assert.equal(c.canonicalCategory, 'OBJECT.FURNITURE');
  assert.match(c.canonicalSubcategory, /SOFA/);
  const a = B.assess(BK.cc0);
  assert.notEqual(a.tier, 'REJECT', a.reasons.join('; '));
  assert.ok(a.glb && a.glb.type === 'gltf');
  const noGlb = B.assess(BK.noglb);
  assert.equal(noGlb.tier, 'REJECT');
  assert.ok(noGlb.reasons.some((r) => /no GLB/.test(r)));
  // A lighter model is not worse; a hugely heavy one is (no practical web path).
  const heavy = B.assess({ ...BK.cc0, params: { ...BK.cc0.params, faceCount: 3_000_000 } });
  assert.equal(heavy.tier, 'REJECT');
  const light = B.assess({ ...BK.cc0, params: { ...BK.cc0.params, faceCount: 20_000 } });
  assert.ok(light.webSuitability >= a.webSuitability);
  assert.equal(B.assess({ ...BK.cc0, params: { ...BK.cc0.params, modelStyle: 'lowpoly' } }).tier, 'REJECT', 'game/cartoon styles are rejected');
  assert.equal(B.assess({ ...BK.cc0, params: { ...BK.cc0.params, dimensionX: 40 } }).tier, 'REJECT', 'absurd dimensions are rejected');
  const refined = B.classify({ ...BK.cc0, name: 'Modern Sectional Sofa with Chaise' });
  assert.equal(refined.canonicalSubcategory, 'SECTIONAL_SOFA');
});

test('Blendkit plan: its own GLB via its own download URL; CC0 public; Royalty-Free refused', () => {
  const c = B.classify(BK.cc0);
  const p = B.plan('MODEL', BK.cc0.assetBaseId, BK.cc0, {}, c);
  assert.equal(p.refusal, null);
  const glb = p.files.find((f) => f.role === 'GLB');
  assert.match(glb.sourceUrl, B.DOWNLOAD_URL);
  assert.equal(glb.delivery, 'public');
  assert.ok(glb.bytes > 0, 'exact size from the listing');
  assert.ok(!p.files.some((f) => /\.blend$/.test(f.relPath)), 'a .blend is never taken');
  assert.match(B.plan('MODEL', BK.rf.assetBaseId, BK.rf, {}, B.classify(BK.rf)).refusal, /runtime delivery not permitted/);
  // The signing route accepts exactly the adapter's download URLs.
  const route = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/design-studio-model/catalog.ts'), 'utf8');
  assert.ok(route.includes(`export const BLENDKIT_DOWNLOAD = ${B.DOWNLOAD_URL.toString()};`));
  assert.doesNotMatch('https://evil.example/api/v1/downloads/00000000-0000-0000-0000-000000000000/', B.DOWNLOAD_URL);
});

test('Blendkit identity is the asset, not one upload of it', async () => {
  assert.ok(BK.cc0.assetBaseId && BK.cc0.assetBaseId !== BK.cc0.id);
  const a = await C.homatchAssetId('blendkit', 'MODEL', BK.cc0.assetBaseId);
  assert.equal(a, await C.homatchAssetId('blendkit', 'MODEL', BK.cc0.assetBaseId));
  const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/designStudio/catalogProviders/blendkit.ts'), 'utf8');
  assert.match(src, /const base = r\.assetBaseId \?\? r\.id;/);
});

test('names: no provider filenames; the object type is said', () => {
  const n = B.name('MODEL', { ...BK.cc0, name: 'blend_file_03 sofa', tags: ['modern', 'beige'] }, { canonicalCategory: 'OBJECT.FURNITURE', canonicalSubcategory: 'SOFA' });
  assert.doesNotMatch(n.displayName, /blend|_|\d{2}/i);
  assert.match(n.displayName, /Sofa/);
  assert.ok(n.styleTags.includes('modern'));
  assert.ok(n.colorTags.includes('beige'));
});
