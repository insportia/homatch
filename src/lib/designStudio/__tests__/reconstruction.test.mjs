// IMAGE → PLAN → GEOMETRY → DESIGN → A HOME YOU CAN WALK IN.
//
// Runs the deterministic half of reconstruction on the acceptance fixture
// (the real isometric apartment render, read by hand into the reader's
// schema — see fixtures/isometric-apartment.recon.json). The vision step
// itself runs in production; everything after it is proven here.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateReconstruction, planDocument, deriveWalls, snapRooms } from '../reconstructRead.ts';
import { buildCanonical, calibrate, estimateScale } from '../scale.ts';
import { buildSpaceModel } from '../space.ts';
import { buildDesign, emptyCorrections, matchAsset, referenceCamera, rotationFromFacing } from '../reconstruction.ts';
import { buildWalkModel, isFree, move, setDoorClosed } from '../navigation.ts';
import { permittedInteractions, validateInteractions } from '../interactions.ts';
import { normalizeDesignState } from '../designState.ts';
import { applyTransaction } from '../operations.ts';
import { seedAssets, seedMaterials } from './seedCatalog.mjs';
import { buildProcedural, slotColors } from '../../../components/designStudio/canvas/procedural.ts';

const RAW = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src/lib/designStudio/__tests__/fixtures/isometric-apartment.recon.json'), 'utf8'));
const ASSETS = seedAssets();
const MATERIALS = seedMaterials();

function built() {
  const { recon, dropped } = validateReconstruction(RAW, 1);
  const doc = planDocument(recon, 'users/u/design-studio-floorplans/p/ref.jpg');
  const decisions = { rejected: [], roomKinds: {} };
  const calibration = calibrate(doc, decisions, [], estimateScale(doc, []));
  const result = buildCanonical(doc, decisions, calibration, 2.7);
  assert.ok(result.ok, JSON.stringify(result));
  const space = buildSpaceModel(result.canonical.scene);
  return { recon, dropped, doc, calibration, canonical: result.canonical, space };
}

test('the seed catalogue parses with every capability it declares', () => {
  assert.ok(ASSETS.length >= 39, String(ASSETS.length));
  const by = new Map(ASSETS.map((a) => [a.code, a]));
  assert.deepEqual(by.get('dev/sofa-3').capabilities, ['MOVABLE', 'ROTATABLE', 'REPLACEABLE', 'DUPLICATABLE', 'SITTABLE']);
  assert.ok(by.get('dev/kitchen-run').capabilities.includes('COOKABLE'));
  assert.equal(by.get('dev/tv-unit').procedural.kind, 'TV_UNIT');
  assert.ok(MATERIALS.length > 0);
});

test('the reading is bounded, keyed and moved to the plan origin', () => {
  const { recon, dropped } = built();
  assert.equal(dropped, 0);
  assert.equal(recon.rooms.length, 7);
  assert.equal(recon.openings.length, 12);
  assert.equal(recon.objects.length, 36);
  assert.ok(recon.rooms.some((r) => r.kind === 'BALCONY' && r.outdoor));
  assert.equal(recon.ceilingHeightM, null, 'no ceiling is invented');
  assert.ok(recon.unknowns.length >= 3);
});

test('walls are derived from the rooms: shared lines interior, the outline exterior, the balcony edge open', () => {
  const { recon } = built();
  const walls = deriveWalls(snapRooms(recon.rooms));
  const interior = walls.filter((w) => w.kind === 'INTERIOR');
  const exterior = walls.filter((w) => w.kind === 'EXTERIOR');
  assert.ok(interior.length >= 5 && exterior.length >= 5, JSON.stringify(walls.map((w) => w.kind)));
  // The living room / bedroom boundary (x = 4.6, y 1.8…6.6) is one interior wall.
  assert.ok(interior.some((w) => w.from[0] === 4.6 && w.to[0] === 4.6 && w.from[1] <= 1.8 && w.to[1] >= 6.6));
  // The balcony's outer edge (y = 0) has no wall: it is a railing edge.
  assert.ok(!walls.some((w) => w.from[1] === 0 && w.to[1] === 0));
});

test('every opening lands on a wall; balcony doors and glazing sit on the balcony line', () => {
  const { doc } = built();
  assert.equal(doc.doors.length + doc.windows.length, 12);
  assert.ok(!doc.warnings.some((w) => w.code === 'OPENING_WITHOUT_WALL'));
  assert.ok(doc.warnings.some((w) => w.code === 'SCALE_INFERRED'));
  assert.ok(doc.doors.every((d) => d.state === 'UNVERIFIED'), 'nothing is accepted until the customer reviews it');
});

test('the shared generator builds it, ESTIMATED, with the balcony outdoors', () => {
  const { canonical, space, calibration } = built();
  assert.equal(calibration.geometryState, 'ESTIMATED');
  assert.equal(canonical.geometryState, 'ESTIMATED');
  assert.equal(space.rooms.length, 7);
  assert.equal(space.rooms.filter((r) => r.outdoor).length, 1);
  const scene = canonical.scene;
  assert.equal(scene.built.doors + scene.built.windows, 12);
  assert.ok(Math.abs(scene.extent.width - 11.6) < 0.4 && Math.abs(scene.extent.depth - 14.4) < 0.4, JSON.stringify(scene.extent));
});

test('pieces match their own family, keep what they were, and say when they are approximate', () => {
  const sofa = matchAsset({ type: 'SOFA', widthM: 2.5, depthM: 0.95, heightM: 0.8, color: '#2f8f7f', style: null }, ASSETS);
  assert.equal(ASSETS.find((a) => a.code === sofa.assetId).category, 'SOFA');
  assert.equal(sofa.colorOverride, '#2f8f7f', 'the teal that was seen');
  assert.equal(matchAsset({ type: 'ARTWORK', widthM: 1, depthM: 0.03, heightM: 1, color: null, style: null }, ASSETS), null, 'no catalogue family: not faked');
  const fridge = matchAsset({ type: 'FRIDGE', widthM: 0.6, depthM: 0.65, heightM: 1.9, color: null, style: null }, ASSETS);
  assert.equal(fridge.assetId, 'dev/fridge');
  assert.equal(fridge.quality, 'GOOD');
});

test('the design is built: pieces placed legally near where they were seen, with provenance', () => {
  const { recon, space } = built();
  const { state, report } = buildDesign(recon, emptyCorrections(), space, ASSETS, MATERIALS, { referenceImageIds: ['img-1'] });
  assert.ok(report.placed.length >= 28, `${report.placed.length} placed; unplaced ${JSON.stringify(report.unplaced)}`);
  assert.deepEqual(report.unmatched.map((u) => u.type).sort(), ['ARTWORK'], 'only artwork has no catalogue family');
  // Near where it was seen; a piece with no place in its own room may stand just across a door, and says so.
  const relocated = new Map(report.relocated.map((r) => [r.key, r]));
  assert.ok(report.placed.every((p) => p.moved <= (relocated.has(p.key) ? 1.5 : 0.9)), JSON.stringify(report.placed.filter((p) => p.moved > 0.9)));
  for (const r of relocated.values()) assert.notEqual(r.from, r.to);
  for (const o of state.objects) {
    assert.equal(o.provenance.source, 'IMAGE_RECONSTRUCTION');
    assert.deepEqual(o.provenance.images, ['img-1']);
    assert.equal(o.provenance.confirmed, false);
  }
  const fridge = state.objects.find((o) => o.assetId === 'dev/fridge');
  assert.ok(fridge && Math.abs(fridge.rotationY - rotationFromFacing(180)) < 1e-6, 'faces the room (south)');
  // Floors wear the colour (or a close catalogue material) that was seen.
  assert.ok(report.surfaces > 0);
  // Survives a save and a reload.
  const again = normalizeDesignState(JSON.parse(JSON.stringify(state)));
  assert.deepEqual(again.objects.map((o) => o.provenance), state.objects.map((o) => o.provenance));
});

test('a piece with no place in its own room stands just across a door, says so — never a bed, never into a bathroom', () => {
  const { recon, space } = built();
  const { state, report } = buildDesign(recon, emptyCorrections(), space, ASSETS, MATERIALS);
  // The fixture's bedside read against the lobby wall of bedroom 2 has no place in that room.
  const side = report.relocated.find((r) => r.key === 'bed2-side-1');
  assert.ok(side, JSON.stringify(report));
  assert.deepEqual([side.from, side.to], ['r-bed2', 'r-lobby']);
  assert.equal(state.objects.find((o) => o.provenance.ref === 'bed2-side-1').roomId, 'r-lobby');
  const kind = (id) => space.rooms.find((r) => r.id === id).kind;
  for (const r of report.relocated) {
    assert.notEqual(kind(r.to), 'BATHROOM');
    assert.ok(!['BED_DOUBLE', 'BED_SINGLE', 'SOFA', 'KITCHEN_RUN', 'SHOWER', 'WARDROBE'].includes(recon.objects.find((o) => o.key === r.key).type));
  }
  // The armchair read on the far side of the living room is not carried 7 m into the bathroom: it is reported.
  assert.ok(report.unplaced.some((u) => u.key === 'armchair-2'));
});

test('an edit by the customer confirms a reconstructed piece', () => {
  const { recon, space } = built();
  const { state } = buildDesign(recon, emptyCorrections(), space, ASSETS, MATERIALS);
  const sofa = state.objects.find((o) => o.provenance.detectedType === 'SOFA');
  const ctx = { space, assets: new Map(ASSETS.map((a) => [a.code, a])), materials: new Map(), styles: new Set() };
  const r = applyTransaction(state, [{ type: 'ROTATE_OBJECT', instanceId: sofa.instanceId, rotationY: sofa.rotationY }], ctx, { id: 't', label: 'x', origin: 'USER' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.equal(r.state.objects.find((o) => o.instanceId === sofa.instanceId).provenance.confirmed, true);
});

test('corrections: a rejected piece is not built; a chosen piece is used', () => {
  const { recon, space } = built();
  const c = emptyCorrections();
  c.rejected.push('plant-window');
  c.assetChoices.sofa = 'dev/sofa-2';
  const { state } = buildDesign(recon, c, space, ASSETS, MATERIALS);
  assert.ok(!state.objects.some((o) => o.provenance.ref === 'plant-window'));
  assert.equal(state.objects.find((o) => o.provenance.ref === 'sofa').assetId, 'dev/sofa-2');
});

test('matched pieces bring their own abilities: the fridge opens, the sofa seats, the bed lies down', () => {
  const { recon, space } = built();
  const { state } = buildDesign(recon, emptyCorrections(), space, ASSETS, MATERIALS);
  const by = new Map(ASSETS.map((a) => [a.code, a]));
  const abilities = (type) => {
    const o = state.objects.find((x) => x.provenance.detectedType === type);
    const a = by.get(o.assetId);
    const g = buildProcedural(a.procedural.kind, a, slotColors(a, null, null));
    return permittedInteractions(validateInteractions(g.userData.interactions), a.capabilities);
  };
  assert.ok(abilities('FRIDGE').some((s) => s.kind === 'HINGED' && s.role === 'APPLIANCE'));
  assert.ok(abilities('SOFA').some((s) => s.kind === 'SEAT'));
  const bed = abilities('BED_DOUBLE');
  assert.ok(bed.some((s) => s.kind === 'SEAT' && s.seats.some((x) => x.posture === 'LIE')));
  assert.ok(bed.some((s) => s.kind === 'STATES' && s.role === 'BED'));
  const kitchen = abilities('KITCHEN_RUN').map((s) => s.role);
  for (const role of ['OVEN', 'STOVE', 'FAUCET', 'COFFEE', 'CABINET']) assert.ok(kitchen.includes(role), role);
  assert.ok(abilities('SHOWER').some((s) => s.kind === 'SWITCH'));
  assert.ok(abilities('OUTDOOR_CHAIR').some((s) => s.kind === 'SEAT'));
});

test('the reconstruction can be walked: rooms connect through doors, closed doors block, walls hold', () => {
  const { recon, space } = built();
  const { state } = buildDesign(recon, emptyCorrections(), space, ASSETS, MATERIALS);
  const model = buildWalkModel(space, state.objects, new Map(ASSETS.map((a) => [a.code, a])));
  const room = (kind) => space.rooms.find((r) => r.kind === kind);
  // A clear standing spot in the living room and the first bedroom.
  const living = { x: 3.1, y: 5.9 };
  assert.ok(isFree(model, living), 'standing in the living room');
  // Walking straight at the living-room / bedroom wall stops at it.
  let p = living;
  for (let i = 0; i < 60; i += 1) p = move(model, p, { x: 0.05, y: 0 });
  assert.ok(p.x < 4.6, `stopped by the wall at x ${p.x}`);
  // The lobby door: open by default (a floor-plan door stands open); closing it blocks the doorway.
  const door = space.doors.find((d) => Math.abs(d.centre.x - 4.6) < 0.2 && Math.abs(d.centre.y - 7.4) < 0.3);
  assert.ok(door, 'the lobby door was built');
  const through = { x: door.centre.x, y: door.centre.y };
  assert.ok(isFree(model, through));
  setDoorClosed(model, door.id, true);
  assert.ok(!isFree(model, through), 'a closed door blocks');
  setDoorClosed(model, door.id, false);
  // The balcony is part of the space (outdoor, walkable).
  const balcony = room('BALCONY');
  assert.ok(balcony && isFree(model, { x: 3.4, y: 0.4 }) || isFree(model, { x: 5.6, y: 0.9 }), 'standing on the balcony');
});

test('Match reference view: a camera above and outside, looking into the home', () => {
  const { recon } = built();
  const cam = referenceCamera(recon, 0);
  assert.ok(cam);
  assert.ok(cam.position[1] > 10, 'aerial');
  assert.ok(cam.target[1] <= cam.position[1]);
  // Looks toward the apartment (positive plan x and y from the camera).
  assert.ok(cam.target[0] > cam.position[0] && -cam.target[2] > -cam.position[2]);
});

test('the browser and the server read reconstructions with the same code (byte-identical copies)', () => {
  for (const file of ['reconstructRead.ts', 'sourceCamera.ts', 'pictureFrame.ts']) {
    const a = fs.readFileSync(path.join(process.cwd(), 'supabase/functions/_shared/designStudio', file), 'utf8');
    const b = fs.readFileSync(path.join(process.cwd(), 'src/lib/designStudio', file), 'utf8');
    assert.equal(b.replace(/\r\n/g, '\n'), a.replace(/\r\n/g, '\n'), file);
  }
});
