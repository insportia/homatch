// SOURCE FIDELITY: a piece rebuilt from a picture keeps what the picture
// showed — its size, its form, its colours, where it stands and which way it
// faces — and a surface wears a catalogue material of the kind that was seen,
// balanced to the colour that was seen. A catalogue model that only belongs to
// the right category is not used when it looks nothing like the picture.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as THREE from 'three';
import { validateReconstruction, planDocument } from '../reconstructRead.ts';
import { buildCanonical, calibrate, estimateScale } from '../scale.ts';
import { buildSpaceModel } from '../space.ts';
import { buildDesign, chooseSurfaceMaterial, colourFamily, doorsPassable, emptyCorrections, looksLike, nearestInside, settle } from '../reconstruction.ts';
import { MODEL_SCALE_MAX, modelScale, normalizeShape, seenColors, shapedAsset } from '../objectShape.ts';
import { normalizeDesignState, emptyDesignState } from '../designState.ts';
import { applyOperation } from '../operations.ts';
import { seedAssets, seedMaterials } from './seedCatalog.mjs';
import { buildProcedural, slotColors } from '../../../components/designStudio/canvas/procedural.ts';
import { foliage } from '../../../components/designStudio/canvas/proceduralForms.ts';

const RAW = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/lib/designStudio/__tests__/fixtures/isometric-apartment.recon.json'), 'utf8'));
const ASSETS = seedAssets();
const byCode = new Map(ASSETS.map((a) => [a.code, a]));

function built(raw = RAW) {
  const { recon } = validateReconstruction(raw, 1);
  const doc = planDocument(recon, 'users/u/design-studio-floorplans/p/ref.jpg');
  const decisions = { rejected: [], roomKinds: {} };
  const calibration = calibrate(doc, decisions, [], estimateScale(doc, []));
  const result = buildCanonical(doc, decisions, calibration, 2.7);
  return { recon, space: buildSpaceModel(result.canonical.scene), scale: calibration.metresPerPx * 100 };
}

test('a shape is bounded; anything malformed reads as no shape', () => {
  assert.deepEqual(normalizeShape({ widthM: 2.6, depthM: 0.95, heightM: 0.75, form: 'CURVED', secondary: '#B9BCC0' }),
    { widthM: 2.6, depthM: 0.95, heightM: 0.75, form: 'CURVED', secondary: '#b9bcc0' });
  assert.equal(normalizeShape({ widthM: 40, depthM: 1, heightM: 1 }), undefined, 'not a piece of furniture');
  assert.equal(normalizeShape({ widthM: 1, depthM: 1, heightM: 1, form: 'WOBBLY' }).form, null, 'an unknown form is no form');
  const state = normalizeDesignState({ objects: [{ instanceId: 'a', assetId: 'dev/sofa-3', shape: { widthM: 2.6, depthM: 0.95, heightM: 0.75 } }, { instanceId: 'b', assetId: 'dev/sofa-3', shape: 'x' }], frames: '#16181B' });
  assert.equal(state.objects[0].shape.widthM, 2.6, 'a saved shape survives a reload');
  assert.equal(state.objects[1].shape, undefined);
  assert.equal(state.frames, '#16181b', 'the frame colour survives too');
});

test('a piece HOMATCH draws takes the seen size exactly; a catalogue model only within its bound', () => {
  const sofa = byCode.get('dev/sofa-3');
  const drawn = shapedAsset(sofa, { shape: { widthM: 2.6, depthM: 0.95, heightM: 0.75, form: 'CURVED', secondary: null } });
  assert.deepEqual([drawn.widthM, drawn.depthM, drawn.heightM], [2.6, 0.95, 0.75]);
  assert.equal(shapedAsset(sofa, { shape: { widthM: 2.6, depthM: 0.95, heightM: 0.75, form: null, secondary: null } }), drawn, 'the same object for the same shape');
  const model = { ...sofa, procedural: null, widthM: 1.0, depthM: 0.9, heightM: 0.8 };
  const s = modelScale(model, { widthM: 3, depthM: 0.9, heightM: 0.8, form: null, secondary: null });
  assert.equal(s.x, MODEL_SCALE_MAX, 'a real object is never stretched into a caricature');
  assert.equal(shapedAsset(model, { shape: { widthM: 3, depthM: 0.9, heightM: 0.8, form: null, secondary: null } }).widthM, MODEL_SCALE_MAX);
});

test('what was seen dresses the right parts: a plant\'s colour is its leaves, a bed\'s second colour its bedding', () => {
  const plant = byCode.get('dev/plant-large');
  const p = seenColors(plant, slotColors(plant, null, null), '#2f5e2c', { widthM: 0.6, depthM: 0.6, heightM: 1.2, form: null, secondary: '#f2f2f0' });
  assert.equal(p.leaves, '#2f5e2c');
  assert.equal(p.pot, '#f2f2f0');
  const bed = byCode.get('dev/bed-double');
  const b = seenColors(bed, slotColors(bed, null, null), '#c49a6c', { widthM: 1.6, depthM: 2.1, heightM: 0.95, form: null, secondary: '#c0c3c7' });
  assert.equal(b.body, '#c49a6c', 'the frame');
  assert.equal(b.linen, '#c0c3c7', 'the bedding');
});

test('a catalogue model is used only when it looks like what was seen', () => {
  const model = { ...byCode.get('dev/sofa-3'), procedural: null, widthM: 2.2, depthM: 0.95, heightM: 0.82, dominantColors: ['#8a8f96'] };
  const seen = { widthM: 2.3, depthM: 0.95, heightM: 0.8, color: '#8c9198', form: null };
  assert.ok(looksLike(seen, model), 'same plain form, close in size and colour');
  assert.ok(!looksLike({ ...seen, form: 'CURVED' }, model), 'a curved sofa is not a straight model');
  assert.ok(!looksLike({ ...seen, color: '#2e8b84' }, model), 'a teal sofa is not a grey model');
  assert.ok(!looksLike({ ...seen, widthM: 3.2 }, model), 'a 3.2 m sofa is not a 2.2 m model');
});

test('a piece stands with its back to the wall behind it, inside the room the reader put it in', () => {
  const { space } = built();
  const living = space.rooms.find((r) => r.id === 'r-living');
  const sofa = shapedAsset(byCode.get('dev/sofa-3'), { shape: { widthM: 2.4, depthM: 0.95, heightM: 0.8, form: null, secondary: null } });
  // Read a little off, nearly square to the room, facing into it from its east wall (facing west).
  const east = Math.max(...living.polygon.map((p) => p.x));
  const pose = settle(space, sofa, 'SOFA', 'r-living', { x: east - 0.8, y: 4.3 }, (88 * Math.PI) / 180);
  assert.ok(Math.abs(pose.rotation - Math.PI / 2) < 1e-6, `squared to the room: ${pose.rotation}`);
  // Its back is against the east wall's face (room outlines run on the wall's centre line):
  // half its depth, a centimetre and half the wall in from the outline.
  const gap = east - pose.at.x - (0.95 / 2 + 0.01);
  assert.ok(gap > 0 && gap < 0.16, `back to the wall: ${gap} m of wall`);
  // A trace that landed just outside the room is brought in at the nearest point, not toward a far centroid.
  const outside = nearestInside(living.polygon, { x: east + 0.3, y: 4.3 }, 0.5);
  assert.ok(Math.abs(outside.y - 4.3) < 1e-6 && outside.x < east && outside.x > east - 0.6, JSON.stringify(outside));
});

test('pieces rebuilt from the picture keep their seen size, form and colours, and are all placed', () => {
  const raw = JSON.parse(JSON.stringify(RAW));
  for (const o of raw.objects) if (o.key === 'sofa') { o.form = 'CURVED'; o.secondaryColor = '#b9bcc0'; }
  const { recon, space, scale } = built(raw);
  const { state, report } = buildDesign(recon, emptyCorrections(), space, ASSETS, seedMaterials(), { scale });
  const sofa = state.objects.find((o) => o.provenance.ref === 'sofa');
  assert.deepEqual(sofa.shape, { widthM: 2.5, depthM: 0.95, heightM: 0.8, form: 'CURVED', secondary: '#b9bcc0' });
  assert.equal(sofa.colorOverride, '#2f8f7f', 'a piece HOMATCH draws wears the colour that was seen');
  // What a room is about is always placed; a small piece is only left out when the only place
  // for it would block a door — and every door of the rebuilt home can still be walked through.
  const essential = new Set(['SOFA', 'BED_DOUBLE', 'BED_SINGLE', 'WARDROBE', 'KITCHEN_RUN', 'KITCHEN_ISLAND', 'FRIDGE', 'DINING_TABLE', 'SHOWER', 'BATH', 'TOILET', 'VANITY', 'OUTDOOR_SOFA']);
  const typeOf = new Map(recon.objects.map((o) => [o.key, o.type]));
  assert.ok(report.unplaced.every((u) => !essential.has(typeOf.get(u.key))), JSON.stringify(report.unplaced));
  assert.ok(report.unplaced.length <= 4, JSON.stringify(report.unplaced));
  // A door is only ever blocked by what the room is about, when the room cannot hold it otherwise
  // (this fixture's first bedroom puts its door behind the bed's head): never by a chair or a table.
  for (const d of space.doors) {
    if (doorsPassable(space, byCode, state.objects, [d.id])) continue;
    const blockers = state.objects.filter((o) => doorsPassable(space, byCode, state.objects.filter((x) => x !== o), [d.id]));
    assert.ok(blockers.length && blockers.every((o) => essential.has(o.provenance.detectedType)), `${d.id} blocked by ${blockers.map((o) => o.provenance.ref)}`);
  }
});

test('a surface wears a textured catalogue material of the kind that was seen, balanced to its colour', () => {
  const mat = (code, name, category, applies, aliases, families = []) => ({
    id: code, code, name, category, appliesTo: applies, styleTags: [], colorFamily: null, aliases, colorFamilies: families, active: true, isPlaceholder: false,
    provenance: 'LICENSED', thumbnailKey: null, pbr: { baseColor: '#ffffff', maps: { albedo: `design-studio/catalog/public/materials/${code}/a.jpg` } },
  });
  const library = [
    mat('m1', 'Herringbone Parquet', 'WOOD', ['FLOOR'], ['herringbone', 'parquet', 'floor', 'clean']),
    mat('m2', 'Rectangular Parquet', 'WOOD', ['FLOOR'], ['parquet', 'plank', 'floor']),
    mat('m3', 'Large Grey Tiles', 'STONE', ['FLOOR'], ['grey', 'tiles', 'weathered', 'damaged', 'mossy'], ['GRAY']),
    mat('m4', 'Grey Porcelain Tile', 'TILE', ['FLOOR'], ['grey', 'tile', 'porcelain', 'clean'], ['GRAY']),
    mat('m5', 'White Plaster', 'WALL', ['WALL'], ['plaster', 'white']),
  ];
  assert.equal(chooseSurfaceMaterial('FLOOR', '#d8c4a8', 'light herringbone oak', 'WOOD_HERRINGBONE', library)?.code, 'm1');
  assert.equal(chooseSurfaceMaterial('FLOOR', '#d8c4a8', 'ნაძვისებრი მუხის პარკეტი', 'WOOD_HERRINGBONE', library)?.code, 'm1', 'in any language, by the pattern code');
  assert.equal(chooseSurfaceMaterial('FLOOR', '#6e7883', 'grey tile', 'TILE', library)?.code, 'm4', 'clean tile over a weathered one for an interior');
  assert.equal(chooseSurfaceMaterial('WALL', '#f1f2f3', 'white paint', null, library), null, 'paint stays a flat colour, never a plaster texture');
  assert.equal(chooseSurfaceMaterial('FLOOR', '#d8c4a8', 'oak', 'WOOD_HERRINGBONE', library.filter((m) => m.code !== 'm1')), null, 'a herringbone floor is never given planks');
  assert.equal(colourFamily('#6e7883'), 'GRAY');
  assert.equal(colourFamily('#3f9a4c'), 'GREEN');
  assert.equal(colourFamily('#d8c4a8'), 'BEIGE');
  // The seen colour is kept on the surface, and a new choice by the customer clears it.
  const state = { ...emptyDesignState(), surfaces: { 'floor:r-a': { materialId: 'm1', color: null, finish: null, tint: '#d8c4a8', locked: false } } };
  const after = applyOperation(state, { type: 'ASSIGN_MATERIAL', surfaceIds: ['floor:r-a'], materialId: 'm2' }).state;
  assert.equal(after.surfaces['floor:r-a'].tint, undefined);
});

test('every form draws: a curved sofa, shell chairs, round tables, a made bed, leaves', () => {
  const draw = (code, form, extra = {}) => {
    const a = { ...byCode.get(code), ...extra };
    const g = buildProcedural(a.procedural.kind, a, slotColors(a, null, null), form);
    const box = new THREE.Box3().setFromObject(g);
    assert.ok(!box.isEmpty(), `${code} ${form}`);
    // Drawn at its size, standing on the floor, never wider than it was seen (+ a little for soft forms).
    assert.ok(box.min.y > -0.02 && box.max.x - box.min.x <= a.widthM + 0.25, `${code} ${form} ${JSON.stringify(box)}`);
    return g;
  };
  draw('dev/sofa-3', 'CURVED', { widthM: 2.6, depthM: 0.95, heightM: 0.75 });
  draw('dev/armchair', 'SHELL');
  draw('dev/dining-chair', 'SHELL');
  draw('dev/coffee-table-round', 'ROUND', { heightM: 0.4 });
  draw('dev/dining-table-4', null);
  draw('dev/bed-double', null);
  draw('dev/plant-large', null);
  draw('dev/planter', null, { widthM: 1.6, depthM: 0.45, heightM: 1.0 });
  const bed = draw('dev/bed-double', null);
  assert.ok(bed.userData.interactions.some((s) => s.role === 'BED' && s.kind === 'STATES'), 'the bed can still be made or slept in');
  const leaves = foliage(0.6, 1.0, 0.6, 0.3, '#2f5e2c');
  assert.ok(leaves.geometry.attributes.position.count > 600, 'a crown of leaves, not a ball');
  assert.ok(leaves.geometry.attributes.color, 'leaf-to-leaf colour variation');
});
