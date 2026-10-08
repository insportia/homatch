// ACCEPTANCE FOR THE RENDER-FURNISHED WALKTHROUGH: the light is the render's own (renderLighting.ts), a room jump
// frames what the room is about (cameraDirector.ts roomShot), and a herringbone floor seen in the render reaches the
// visitor as the catalogue's real texture through the one storage door (reconstruction.ts chooseSurfaceMaterial →
// pbrMaps.ts selectPbrMaps → storage-sign's local gate). Synthetic data only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { lightingFromPicture, NEUTRAL_LIGHTING } from '../walkthrough/renderLighting.ts';
import { FURNISHING_VERSION, readFurnishing } from '../walkthrough/renderFurnishing.ts';
import { roomShot } from '../cameraDirector.ts';
import { buildWalkModel } from '../navigation.ts';
import { buildSpaceModel } from '../space.ts';
import { generateScene } from '../../floorplan/geometry.ts';
import { chooseSurfaceMaterial, matchMaterial } from '../reconstruction.ts';
import { selectPbrMaps } from '../pbrMaps.ts';
import { localGate } from '../../../../supabase/functions/_shared/storage/decide.ts';
import { oneBedroomDoc, testAssets } from './fixtures.mjs';

// ── Light ──

/** A picture on a white page: the home's pixels `home(x, y)` inside a centred block, white around it. */
function picture(w, h, home) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const inside = x > w * 0.15 && x < w * 0.85 && y > h * 0.15 && y < h * 0.85;
      const [r, g, b] = inside ? home(x, y) : [255, 255, 255];
      const i = (y * w + x) * 4;
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
  }
  return px;
}

test('a dim, warm render with glowing lamps is lit as a warm evening', () => {
  // Amber-brown interior, a few small bright warm lamps.
  const px = picture(400, 300, (x, y) => ((x % 50 < 2 && y % 50 < 2) ? [255, 236, 190] : [120, 86, 58]));
  const l = lightingFromPicture(px, 400, 300, '#ffffff');
  assert.ok(l);
  assert.equal(l.timeOfDay, 'EVENING');
  assert.equal(l.temperature, 'WARM');
  assert.ok(l.interiorIntensity > NEUTRAL_LIGHTING.interiorIntensity);
});

test('a bright, cool render is daylight; the white page around a cut-away is never counted', () => {
  const px = picture(400, 300, () => [205, 215, 232]);
  const l = lightingFromPicture(px, 400, 300, '#ffffff');
  assert.ok(l);
  assert.equal(l.timeOfDay, 'DAY');
  assert.equal(l.temperature, 'COOL');
  // Only the home's pixels were read (the page is ~51 % of the picture).
  assert.ok(l.evidence.pixels < 400 * 300 * 0.55, String(l.evidence.pixels));
});

test('a picture with too little home in it is not measured (the caller keeps the neutral light)', () => {
  const px = picture(20, 20, () => [120, 86, 58]);
  assert.equal(lightingFromPicture(px, 20, 20, '#ffffff'), null);
});

test('the measured light is kept with the furnishing; a malformed or missing one reads as none', () => {
  const stored = (lighting) => readFurnishing(JSON.parse(JSON.stringify({ version: FURNISHING_VERSION, renderId: 'r', image: 0, objects: [], lighting })));
  assert.deepEqual(stored({ timeOfDay: 'EVENING', temperature: 'WARM', interiorIntensity: 0.9, evidence: { meanLuma: 0.3 } }).lighting, { timeOfDay: 'EVENING', temperature: 'WARM', interiorIntensity: 0.9 });
  assert.equal(stored({ timeOfDay: 'DUSK', temperature: 'WARM', interiorIntensity: 0.9 }).lighting, null);
  assert.equal(stored(undefined).lighting, null);
  assert.equal(stored({ timeOfDay: 'NIGHT', temperature: 'COOL', interiorIntensity: 7 }).lighting.interiorIntensity, 1);
});

// ── Room jumps ──

// A long, narrow living room (8 × 3 m, the shape of a living strip along a façade) with a hall at its east end.
const ok = { confidence: 1, evidence: 'fixture', state: 'VERIFIED' };
const W = (id, x1, y1, x2, y2, kind = 'INTERIOR') => ({ id, start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, kind, thicknessPx: kind === 'EXTERIOR' ? 25 : 12, ...ok });
const O = (id, wallId, position, widthPx, over) => ({ id, wallId, position, widthPx, ...ok, ...over });
const R = (id, kind, label, pts, a) => ({ id, kind, label, polygon: pts.map(([x, y]) => ({ x, y })), statedAreaM2: a, ...ok });
const strip = (() => {
  const { scene } = generateScene({
    ...oneBedroomDoc(), imageWidth: 1000, imageHeight: 300,
    walls: [W('w-n', 0, 0, 1000, 0, 'EXTERIOR'), W('w-e', 1000, 0, 1000, 300, 'EXTERIOR'), W('w-s', 1000, 300, 0, 300, 'EXTERIOR'), W('w-w', 0, 300, 0, 0, 'EXTERIOR'), W('w-i', 800, 0, 800, 300)],
    doors: [O('d-in', 'w-i', 0.5, 90, { sillHeightM: 0, heightM: 2.1 }), O('d-entry', 'w-e', 0.5, 100, { sillHeightM: 0, heightM: 2.1 })],
    windows: [O('win', 'w-n', 0.4, 160, { sillHeightM: 0.9, heightM: 1.4 })],
    rooms: [R('r-living', 'LIVING', 'Living', [[0, 0], [800, 0], [800, 300], [0, 300]], 24), R('r-hall', 'HALL', 'Hall', [[800, 0], [1000, 0], [1000, 300], [800, 300]], 6)],
  });
  return buildSpaceModel(scene);
})();
const assets = testAssets();
const obj = (id, assetId, roomId, x, y, rot = 0) => ({ instanceId: id, assetId, roomId, position: { x, y: 0, z: y }, rotationY: rot, materialVariant: null, colorOverride: null, locked: false });
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const hfovOf = (vfovDeg, aspect) => (2 * Math.atan(Math.tan((vfovDeg * Math.PI) / 360) * aspect) * 180) / Math.PI;

test('a room jump into a long, narrow room frames its seating at an interior lens (never a tunnel)', () => {
  for (const gx of [1.5, 3, 4, 5.5]) {
    const group = { x: gx, y: 1.9 };
    const pieces = [obj('sofa', 'dev/sofa-3', 'r-living', gx, 2.4), obj('table', 'dev/coffee-table', 'r-living', gx, 1.4)];
    const shot = roomShot(strip, buildWalkModel(strip, pieces, assets), 'r-living');
    assert.ok(shot, `group at x ${gx}`);
    const hfov = hfovOf(shot.fov, 16 / 9);
    assert.ok(hfov >= 74 - 0.5, `horizontal field ${hfov.toFixed(1)}° with the group at x ${gx}`);
    const look = Math.atan2(shot.target.y - shot.position.y, shot.target.x - shot.position.x);
    const off = Math.abs(wrap(Math.atan2(group.y - shot.position.y, group.x - shot.position.x) - look)) * (180 / Math.PI);
    assert.ok(off < hfov / 2, `the seating group at x ${gx} is ${off.toFixed(1)}° off a ${hfov.toFixed(1)}° frame`);
  }
});

// ── The floor's real texture ──

const KEY = (n) => `design-studio/catalog/public/materials/hma_0000000000000000000000test/hmv_0000000000000000000000test/textures/${n}`;
const textured = (code, name, maps) => ({
  id: `id-${code}`, code, name, category: 'FLOOR', appliesTo: ['FLOOR'], styleTags: [], colorFamily: null, colorFamilies: ['BROWN'], aliases: [], active: true,
  pbr: {
    baseColor: '#ffffff', roughness: 1, metalness: 1, repeatM: 3.4, physicalSizeM: [3.4, 3.4],
    maps: { albedo: maps['1k'].albedo, normal: maps['1k'].normal, roughness: maps['1k'].orm },
    mapsByRes: maps, variants: { mobile: '1k', desktop: '2k' },
  },
  thumbnailKey: null,
});
const set = (stem) => Object.fromEntries(['1k', '2k'].map((r) => [r, { albedo: KEY(`${stem}_diff_${r}.jpg`), normal: KEY(`${stem}_nor_gl_${r}.jpg`), orm: KEY(`${stem}_arm_${r}.jpg`) }]));
const herringbone = textured('hma_herringbone', 'Herringbone Parquet', set('herringbone_parquet'));
const planks = textured('hma_planks', 'Oak Wood Planks', set('oak_planks'));

test('a herringbone floor seen in the render wears the catalogue herringbone texture, never planks or a flat colour', () => {
  const mat = chooseSurfaceMaterial('FLOOR', '#8a5a3a', 'herringbone oak parquet', 'WOOD_HERRINGBONE', [planks, herringbone]);
  assert.equal(mat?.code, 'hma_herringbone');
  // The flat-colour matcher never stands in for it (a white imported material is no colour match).
  assert.equal(matchMaterial('FLOOR', '#8a5a3a', 'herringbone oak parquet', [herringbone]), null);
  for (const [tier, res] of [['HIGH', '2k'], ['LOW', '1k']]) {
    const sel = selectPbrMaps(mat.pbr, tier);
    assert.ok(sel, tier);
    assert.equal(sel.albedo, KEY(`herringbone_parquet_diff_${res}.jpg`));
    assert.ok(sel.normal && sel.orm);
    assert.deepEqual(sel.repeat, [0.2941, 0.2941]);
  }
});

test('the texture is signed for any viewer (a share link has no account) and only for reading', async () => {
  const noAdmin = async () => null;
  for (const map of Object.values(herringbone.pbr.mapsByRes['1k'])) {
    const read = await localGate({ key: map, action: 'READ', authUid: null, isAdmin: noAdmin });
    assert.equal(read.allowed, true, map);
    const write = await localGate({ key: map, action: 'WRITE', authUid: null, isAdmin: noAdmin, contentType: 'image/jpeg', byteSize: 1000 });
    assert.equal(write.allowed, false);
    assert.equal(write.reason, 'UNAUTHENTICATED');
  }
  // A customer's own files are never readable that way.
  const priv = await localGate({ key: 'design-studio/accounts/00000000-0000-0000-0000-000000000000/projects/p/renders/r.png', action: 'READ', authUid: null, isAdmin: noAdmin });
  assert.equal(priv.allowed, false);
});
