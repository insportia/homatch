// THE ARCHITECT (walkthrough/planArchitect.ts): every plan, whatever it was read from, a plausible home.
//
// The shape of a real failure: a reading with a bathroom of 13 m², an entrance hall of 16 m², a kitchen-living room
// of 14 m², a study drawn as a slanted strip — and pieces read in a frame that does not quite match the rooms. The
// architect keeps the rooms, their kinds, their arrangement and their pieces, and redraws sizes and walls. Synthetic
// data: no customer reading is committed.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { architectPlan, SIZE_RANGE, roomUse } from '../walkthrough/planArchitect.ts';
import { spaceFromReading } from '../walkthrough/photoSpace.ts';

const room = (key, kind, label, polygon, outdoor = false) => ({ key, kind, label, polygon, outdoor: outdoor || kind === 'BALCONY', confidence: 0.8, basis: 'OBSERVED', geometry: 'ESTIMATE' });
const obj = (key, type, roomKey, at, w, d) => ({ key, type, label: type, room: roomKey, at, facingDeg: 0, widthM: w, depthM: d, heightM: 0.8, color: null, material: null, style: null, confidence: 0.8, basis: 'OBSERVED', seenIn: [0] });
const door = (key, kind, at) => ({ key, kind, at, widthM: 0.9, heightM: 2.1, sillM: 0, confidence: 0.7, basis: 'OBSERVED' });
const reading = {
  version: 'ds-recon-3', view: 'AERIAL', scaleConfidence: 0.6, scaleEvidence: null, ceilingHeightM: 2.7, usesPlan: false,
  rooms: [
    room('bath', 'BATHROOM', 'bathroom', [[0, 0], [4, 0], [4, 3.3], [0, 3.3]]),
    room('bed', 'BEDROOM', 'bedroom', [[4, 0], [9, 0], [9, 3.3], [4, 3.3]]),
    room('study', 'HALL', 'office', [[4.2, 3.3], [8.8, 3.3], [9, 5.1], [4, 5.2]]),
    room('hall', 'HALL', 'entry hall', [[0, 3.3], [4, 3.3], [4, 7.3], [0, 7.3]]),
    room('living', 'LIVING', 'kitchen-living', [[4, 5.2], [9, 5.2], [9, 8], [4, 8]]),
    room('balcony', 'BALCONY', 'balcony', [[9, 2], [11, 2], [11, 8], [9, 8]]),
  ],
  openings: [
    door('entry', 'DOOR', [0.2, 6]), door('bath_hall', 'DOOR', [2, 2.4]), door('hall_living', 'DOOR', [3.6, 6.5]),
    door('study_bed', 'DOOR', [6, 3.5]), door('living_balcony', 'BALCONY_DOOR', [8.9, 6.5]),
    { ...door('bed_window', 'WINDOW', [6.5, 0.1]), sillM: 0.9, heightM: 1.4 },
  ],
  surfaces: [], palette: [], styleWords: [], cameras: [], unknowns: [],
  objects: [
    obj('run', 'KITCHEN_RUN', 'living', [6, 7.6], 2.8, 0.6), obj('sofa', 'SOFA', 'living', [6, 5.6], 2.2, 0.9),
    obj('bedd', 'BED_DOUBLE', 'bed', [6.5, 1.5], 1.6, 2.0), obj('desk', 'DESK', 'study', [6, 4.3], 1.4, 0.7),
    obj('wc', 'TOILET', 'bath', [1, 0.6], 0.4, 0.7), obj('shower', 'SHOWER', 'bath', [3, -0.6], 0.9, 0.9),
    obj('chair', 'OUTDOOR_CHAIR', 'balcony', [10, 5], 0.6, 0.6),
  ],
};
const box = (poly) => ({ x0: Math.min(...poly.map((p) => p[0])), y0: Math.min(...poly.map((p) => p[1])), x1: Math.max(...poly.map((p) => p[0])), y1: Math.max(...poly.map((p) => p[1])) });

test('every room is sized for what it is, the rooms tile the home, and the plan builds as drawn', () => {
  const out = architectPlan(reading);
  assert.ok(out);
  const types = new Map();
  for (const o of reading.objects) { if (!types.has(o.room)) types.set(o.room, new Set()); types.get(o.room).add(o.type); }
  for (const r of out.recon.rooms.filter((x) => !x.outdoor)) {
    const b = box(r.polygon); const area = (b.x1 - b.x0) * (b.y1 - b.y0);
    const range = SIZE_RANGE[roomUse(r, types.get(r.key) ?? new Set())];
    assert.ok(area >= range.min - 0.05 && area <= range.max + 0.05, `${r.key} ${area.toFixed(1)} m²`);
    assert.ok(Math.min(b.x1 - b.x0, b.y1 - b.y0) >= range.short - 0.01, `${r.key} too narrow`);
  }
  const indoor = out.recon.rooms.filter((x) => !x.outdoor).map((r) => box(r.polygon));
  for (let i = 0; i < indoor.length; i += 1) for (let j = i + 1; j < indoor.length; j += 1) {
    const a = indoor[i]; const b = indoor[j];
    assert.ok(Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0)) < 1e-6, 'rooms overlap');
  }
  const built = spaceFromReading(out.recon, { sourceKey: 't', expected: [], furnish: null });
  assert.ok(!('problems' in built), JSON.stringify(built.problems));
  assert.equal(built.layout, 'READ');
  assert.equal(built.geometryCheck.verdict, 'PASS');
});

test('the arrangement is kept: the bathroom west of the bedroom, the hall below it, the balcony on the east', () => {
  const out = architectPlan(reading);
  const at = (k) => box(out.recon.rooms.find((r) => r.key === k).polygon);
  const c = (b) => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2];
  assert.ok(c(at('bath'))[0] < c(at('bed'))[0]);
  assert.ok(c(at('hall'))[1] > c(at('bath'))[1]);
  assert.ok(at('balcony').x0 >= Math.max(...out.recon.rooms.filter((r) => !r.outdoor).map((r) => at(r.key).x1)) - 0.01);
  // Pieces stay in their rooms.
  for (const o of out.recon.objects) {
    const b = at(o.room);
    assert.ok(o.at[0] >= b.x0 - 1e-6 && o.at[0] <= b.x1 + 1e-6 && o.at[1] >= b.y0 - 1e-6 && o.at[1] <= b.y1 + 1e-6, o.key);
  }
});

test('doors keep the rooms they join: the bathroom opens once, onto the hall; the entrance stays the hall\'s', () => {
  const out = architectPlan(reading);
  const at = (k) => box(out.recon.rooms.find((r) => r.key === k).polygon);
  const onEdge = (b, p) => (Math.abs(p[0] - b.x0) < 0.02 || Math.abs(p[0] - b.x1) < 0.02 || Math.abs(p[1] - b.y0) < 0.02 || Math.abs(p[1] - b.y1) < 0.02)
    && p[0] >= b.x0 - 0.02 && p[0] <= b.x1 + 0.02 && p[1] >= b.y0 - 0.02 && p[1] <= b.y1 + 0.02;
  const bathDoors = out.recon.openings.filter((o) => o.kind === 'DOOR' && onEdge(at('bath'), o.at));
  assert.equal(bathDoors.length, 1);
  assert.ok(onEdge(at('hall'), bathDoors[0].at));
  const entry = out.recon.openings.find((o) => o.key === 'entry');
  assert.ok(entry && onEdge(at('hall'), entry.at));
});

test('the edge function draws the plan again with the architect when the draft is no plausible home', () => {
  const src = fs.readFileSync(new URL('../../../../supabase/functions/design-studio-reconstruct/walkthrough.ts', import.meta.url), 'utf8');
  assert.match(src, /architectPlan\(drafted\?\.recon \?\? read\)/);
  assert.match(src, /const built = useArchitect \? fromArchitect! : useDraft \? fromDraft! : spaceOf\(read\);/);
  assert.match(src, /const kept = useArchitect \? architected!\.recon/);
});

test('a plan the model never delivers is not waited on again: the walkthrough is planned by rule, and that plan is never reused', () => {
  const src = fs.readFileSync(new URL('../../../../supabase/functions/design-studio-reconstruct/walkthrough.ts', import.meta.url), 'utf8');
  assert.match(src, /const PLAN_RESPONSE_MAX_MS = 6 \* 60_000;/);
  assert.match(src, /if \(!payload\) missed = \{ id: pending\.id, status:/);
  assert.match(src, /\} else if \(!reused && misses\.length\) \{\n    ruled = true;/);
  assert.match(src, /if \(ruled\) raw = \{ summary: 'HOMATCH rule plan: the model did not answer'/);
  assert.match(src, /!String\(x\.plan\.summary \?\? ''\)\.startsWith\('HOMATCH rule plan'\)/);
});
