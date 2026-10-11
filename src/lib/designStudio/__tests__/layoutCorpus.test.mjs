// EVERY KIND OF HOME, FURNISHED COMPLETELY (walkthrough/programme.ts + build.ts + photoSpace.ts).
//
// A corpus of homes — a studio (named, and one only implied by a single habitable room), a one-bedroom with a separate
// kitchen, a kitchen-living, a two-bedroom open plan with a WC and a balcony, a three-bedroom family home with a
// dining room, an office and two bathrooms, and the shape of a real photo reading (a "Kitchen / Living" read as
// LIVING, an "Office" read as UNKNOWN) — each read, built into a space, and furnished with NO plan at all (the worst
// case: the model planned nothing). Every one must be walkable and believable, every room holding what makes it
// that room: the kitchen its cabinetry and fridge, the bathroom its toilet, basin and shower, the bedroom its bed
// and wardrobe, the living room its sofa, the office its desk. A change that breaks any home here breaks the build.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spaceFromReading } from '../walkthrough/photoSpace.ts';
import { buildSpaceModel } from '../space.ts';
import { buildWalkthrough } from '../walkthrough/build.ts';
import { homeProgramme, needsOf, roomUseOf } from '../walkthrough/programme.ts';
import { emptyDesignState } from '../designState.ts';
import { prodAssets } from './fixtures/devCatalogue.mjs';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const room = (key, kind, poly, label = null) => ({ key, kind, label, polygon: poly, outdoor: ['BALCONY', 'TERRACE'].includes(kind), confidence: 0.8, basis: 'OBSERVED', geometry: 'ESTIMATE' });
const reading = (rooms) => ({ version: 'ds-recon-3', view: 'AERIAL', scaleConfidence: 0.6, scaleEvidence: null, ceilingHeightM: 2.7, usesPlan: false, rooms, openings: [], objects: [], surfaces: [], palette: [], styleWords: [], cameras: [], unknowns: [] });

const HOMES = {
  studio_named: [room('studio', 'LIVING', rect(0, 0, 6, 5), 'Studio'), room('bath', 'BATHROOM', rect(6, 0, 8.2, 2.5)), room('hall', 'HALL', rect(6, 2.5, 8.2, 5))],
  studio_single_room: [room('main', 'LIVING', rect(0, 0, 6.5, 5)), room('bath', 'BATHROOM', rect(6.5, 0, 8.7, 2.6)), room('hall', 'HALL', rect(6.5, 2.6, 8.7, 5))],
  one_bed_separate_kitchen: [room('living', 'LIVING', rect(0, 0, 5, 4.2)), room('kitchen', 'KITCHEN', rect(5, 0, 8, 3.2)), room('bed', 'BEDROOM', rect(0, 4.2, 3.6, 7.8)), room('bath', 'BATHROOM', rect(3.6, 5.2, 5.8, 7.8)), room('hall', 'HALL', rect(5, 3.2, 8, 5.2)), room('hall2', 'CORRIDOR', rect(3.6, 4.2, 5, 5.2))],
  one_bed_kitchen_living: [room('kl', 'LIVING', rect(0, 0, 6.5, 4.5), 'Kitchen / Living'), room('bed', 'BEDROOM', rect(0, 4.5, 3.8, 8)), room('bath', 'BATHROOM', rect(3.8, 4.5, 6.5, 6.5)), room('hall', 'HALL', rect(3.8, 6.5, 6.5, 8))],
  two_bed_open_plan: [room('living', 'LIVING', rect(0, 0, 7, 5)), room('bed1', 'BEDROOM', rect(0, 5, 3.8, 8.6)), room('bed2', 'BEDROOM', rect(3.8, 5, 7, 8.6)), room('bath', 'BATHROOM', rect(7, 0, 9.4, 2.6)), room('wc', 'WC', rect(7, 2.6, 8.4, 4)), room('hall', 'HALL', rect(7, 4, 9.4, 8.6)), room('balcony', 'BALCONY', rect(0, -1.4, 4, 0))],
  three_bed_family: [room('living', 'LIVING', rect(0, 0, 6, 5)), room('kitchen', 'KITCHEN', rect(6, 0, 9.5, 3.5)), room('dining', 'UNKNOWN', rect(6, 3.5, 9.5, 6.5), 'Dining room'), room('bed1', 'BEDROOM', rect(0, 5, 4, 9)), room('bed2', 'BEDROOM', rect(4, 6.5, 7.2, 9.6)), room('bed3', 'BEDROOM', rect(7.2, 6.5, 10.4, 9.6)), room('bath1', 'BATHROOM', rect(9.5, 0, 12, 2.8)), room('bath2', 'BATHROOM', rect(9.5, 2.8, 12, 5)), room('office', 'UNKNOWN', rect(10.4, 5, 12, 9.6), 'Office'), room('hall', 'HALL', rect(4, 5, 6, 6.5)), room('corr', 'CORRIDOR', rect(9.5, 5, 10.4, 6.5)), room('terrace', 'TERRACE', rect(0, -2, 6, 0))],
  photo_kitchen_living_office: [room('kitchen_living', 'LIVING', rect(2, 3.4, 8.2, 7), 'Kitchen / Living'), room('office', 'UNKNOWN', rect(4.6, 0, 8.2, 3.4), 'Office'), room('bathroom', 'BATHROOM', rect(0, 0, 2.4, 2.6)), room('bedroom', 'BEDROOM', rect(2.4, 0, 4.6, 3.4)), room('hall', 'HALL', rect(0, 2.6, 2, 7)), room('balcony', 'BALCONY', rect(8.2, 0, 9.8, 6))],
};

function furnish(rooms) {
  const built0 = spaceFromReading(reading(rooms), { sourceKey: 'corpus', expected: [], furnish: null });
  assert.ok(!('problems' in built0), JSON.stringify(built0.problems));
  const space = buildSpaceModel(built0.space.canonical.scene);
  const assets = prodAssets();
  const plan = { lighting: { timeOfDay: 'DAY', temperature: 'NEUTRAL', interiorIntensity: 0.7 }, palette: [], styleCode: null,
    rooms: space.rooms.map((r) => ({ roomId: r.id, floorMaterial: null, floorColor: null, wallMaterial: null, wallColor: null, wallFinish: null, accent: null, ceilingColor: null, items: [] })) };
  const built = buildWalkthrough({ space, base: emptyDesignState(), assets, materialsByCode: new Map(), materialsById: new Map(), idPrefix: 'c', plan });
  return { space, assets, built, geometry: built0.geometryCheck };
}

for (const [name, rooms] of Object.entries(HOMES)) {
  test(`${name}: walkable, believable, every room holding what makes it that room`, () => {
    const { space, assets, built, geometry } = furnish(rooms);
    assert.equal(geometry.verdict, 'PASS', JSON.stringify(geometry.issues));
    const gate = built.report.gate;
    assert.equal(gate.ok, true, JSON.stringify(gate));
    assert.deepEqual(gate.missingEssential, []);
    assert.deepEqual(gate.implausible, [], JSON.stringify(gate.implausible));
    const prog = homeProgramme(space.rooms);
    for (const r of space.rooms) {
      const objs = built.state.objects.filter((o) => o.roomId === r.id).map((o) => assets.get(o.assetId));
      for (const nd of prog.get(r.id).needs.filter((x) => x.core)) assert.ok(objs.some((a) => nd.serves(a)), `${r.id} (${prog.get(r.id).use}) has its ${nd.id}`);
    }
  });
}

test('the uses a room is read as: label and home decide, not the kind alone', () => {
  const home = (habitableRooms, kitchenRoomId = null) => ({ habitableRooms, kitchenRoomId, roomId: 'r' });
  assert.equal(roomUseOf('LIVING', 'Kitchen / Living', home(2)), 'KITCHEN_LIVING');
  assert.equal(roomUseOf('UNKNOWN', 'Office', home(2)), 'OFFICE');
  assert.equal(roomUseOf('LIVING', null, home(1)), 'STUDIO');
  assert.equal(roomUseOf('LIVING', null, home(3, 'r')), 'KITCHEN_LIVING');
  assert.equal(roomUseOf('BATHROOM', null, home(3)), 'BATHROOM');
  assert.equal(roomUseOf('WC', null, home(3)), 'WC');
  assert.equal(roomUseOf('BALCONY', null, home(3)), 'OUTDOOR');
  // A kitchen is cabinetry and a fridge; a bathroom a toilet, a basin and a shower; a shower room just its shower.
  assert.deepEqual(needsOf('KITCHEN', 8).filter((n) => n.core).map((n) => n.id), ['KITCHEN_RUN', 'FRIDGE']);
  assert.deepEqual(needsOf('BATHROOM', 4).filter((n) => n.core).map((n) => n.id), ['TOILET', 'BASIN', 'SHOWER_OR_BATH']);
  assert.deepEqual(needsOf('BATHROOM', 1.4).filter((n) => n.core).map((n) => n.id), ['SHOWER_OR_BATH']);
  assert.deepEqual(needsOf('STUDIO', 30).filter((n) => n.core).map((n) => n.id), ['KITCHEN_RUN', 'FRIDGE', 'BED']);
});
