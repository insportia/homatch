// WHEN A READING'S ROOMS AND PIECES DISAGREE, THE PIECES DECIDE (walkthrough/pieceLayout.ts, photoSpace.ts).
//
// A reading of photos whose room outlines are a guessed grid in another frame than its measured pieces (a bedroom's
// bed in the next room, a slanted open plan, rooms no door joins) failed its geometry check, and the walkthrough of
// that home could never be built. The same rooms are now laid out again from where their pieces stand — rectangles
// that tile the home, balconies outside it, doors inferred between neighbours — and checked again. Synthetic plan:
// it reproduces, rounded and without identifiers, the shape of a real failing reading (no customer data).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { layoutFromPieces } from '../walkthrough/pieceLayout.ts';
import { PHOTO_SPACE_VERSION, spaceFromReading } from '../walkthrough/photoSpace.ts';
import { READY_MIN_IMPORTANT_RECALL, READY_MIN_RECALL } from '../walkthrough/renderGate.ts';

const code = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const room = (key, kind, polygon, over = {}) => ({ key, kind, label: null, polygon, outdoor: ['BALCONY', 'TERRACE'].includes(kind), confidence: 0.7, basis: 'OBSERVED', geometry: 'ESTIMATE', ...over });
const piece = (key, room, type, at, w, d, facingDeg = 0) => ({
  key, room, type, label: type, at, facingDeg, widthM: w, depthM: d, heightM: 0.8, color: null, material: null, style: null,
  confidence: 0.8, basis: 'OBSERVED', seenIn: [0], geometry: 'PIXELS',
});
const opening = (key, kind, at, widthM = 0.9) => ({ key, kind, at, widthM, heightM: 2.1, sillM: 0, confidence: 0.7, basis: 'OBSERVED' });

// The rooms: a tidy guessed grid (bedrooms, bath, hall) beside a slanted traced open plan; the pieces: where the
// measured picture shows them — each bedroom's bed one room to the right of its guessed outline.
const READING = {
  version: 'ds-recon-3', view: 'AERIAL', scaleConfidence: 0.6, scaleEvidence: null, ceilingHeightM: 2.8, usesPlan: false,
  rooms: [
    room('living', 'LIVING', [[5, 3.2], [9, 2.6], [12.4, 4.1], [12, 8], [5.6, 7.8]], { geometry: 'PIXELS' }),
    room('bed_a', 'BEDROOM', rect(0, 0, 4, 3.5)),
    room('bed_b', 'BEDROOM', rect(4, 0, 8, 3.5)),
    room('bath', 'BATHROOM', rect(0, 3.5, 2.5, 8)),
    room('hall', 'HALL', rect(2.5, 3.5, 5, 8), { basis: 'INFERRED', confidence: 0.6 }),
    room('balcony', 'BALCONY', rect(-1, 0, 0, 3.5)),
  ],
  openings: [opening('door_a', 'DOOR', [2, 3.5]), opening('door_b', 'DOOR', [6, 3.5]), opening('door_bath', 'DOOR', [2.5, 6]), opening('win', 'WINDOW', [12.2, 6], 2)],
  objects: [
    piece('bed_a', 'bed_a', 'BED_DOUBLE', [5.6, 1.6], 1.6, 2), piece('wardrobe_a', 'bed_a', 'WARDROBE', [7, 0.5], 1.5, 0.6), piece('bedside_a', 'bed_a', 'BEDSIDE', [4.5, 1.2], 0.5, 0.45),
    piece('bed_b', 'bed_b', 'BED_DOUBLE', [10.4, 1.6], 1.6, 2), piece('wardrobe_b', 'bed_b', 'WARDROBE', [11.6, 0.5], 1.5, 0.6),
    piece('toilet', 'bath', 'TOILET', [1.2, 5.6], 0.38, 0.62), piece('shower', 'bath', 'SHOWER', [0.8, 7.2], 1, 1), piece('vanity', 'bath', 'VANITY', [1.9, 4.6], 0.8, 0.48),
    piece('sofa', 'living', 'SOFA', [8.4, 6.3], 2.4, 0.95), piece('kitchen', 'living', 'KITCHEN_RUN', [10.8, 4.6], 3, 0.6), piece('table', 'living', 'DINING_TABLE', [7, 4.9], 1.6, 0.9),
    piece('tv', 'living', 'TV_UNIT', [8.4, 7.6], 1.8, 0.4), piece('chair', 'balcony', 'OUTDOOR_CHAIR', [11.6, 7.4], 0.6, 0.6),
  ],
  surfaces: [], palette: [], styleWords: [], cameras: [], unknowns: [],
  fidelity: { image: 0, model: 'ORTHO', outline: [[0, 0], [12.5, 0], [12.5, 8], [0, 8]] },
};

const inRect = (p, poly) => { const xs = poly.map((q) => q[0]); const ys = poly.map((q) => q[1]); return p[0] >= Math.min(...xs) && p[0] <= Math.max(...xs) && p[1] >= Math.min(...ys) && p[1] <= Math.max(...ys); };

test('the beds stand outside their read rooms and inside their laid-out ones', () => {
  const out = spaceFromReading(READING, { sourceKey: 'k', expected: [], furnish: null });
  assert.ok(!('problems' in out));
  // Without the pieces' furnishing the check sees the shapes and the doors; with the layout it passes (below).
  const laid = layoutFromPieces(READING);
  const beds = READING.objects.filter((o) => o.type === 'BED_DOUBLE');
  for (const b of beds) assert.ok(!inRect(b.at, READING.rooms.find((r) => r.key === b.room).polygon), `${b.key} stands outside its read room`);
  for (const b of beds) assert.ok(inRect(b.at, laid.recon.rooms.find((r) => r.key === b.room).polygon), `${b.key} stands inside its laid-out room`);
});

test('laid out from the pieces: every room kept, rectangles that tile the home, each defining piece in its own room', () => {
  const laid = layoutFromPieces(READING);
  assert.deepEqual(laid.recon.rooms.map((r) => `${r.key}:${r.kind}`), READING.rooms.map((r) => `${r.key}:${r.kind}`), 'same rooms, same kinds, nothing invented or dropped');
  const indoor = laid.recon.rooms.filter((r) => !r.outdoor);
  for (const r of laid.recon.rooms) assert.equal(r.polygon.length, 4, `${r.key} is a rectangle`);
  const area = (p) => (Math.max(...p.map((q) => q[0])) - Math.min(...p.map((q) => q[0]))) * (Math.max(...p.map((q) => q[1])) - Math.min(...p.map((q) => q[1])));
  assert.ok(Math.abs(indoor.reduce((s, r) => s + area(r.polygon), 0) - 12.5 * 8) < 0.2, 'the indoor rooms tile the measured outline');
  for (const o of READING.objects.filter((x) => ['BED_DOUBLE', 'TOILET', 'SHOWER', 'SOFA', 'KITCHEN_RUN'].includes(x.type))) {
    assert.ok(inRect(o.at, laid.recon.rooms.find((r) => r.key === o.room).polygon), `${o.key} in ${o.room}`);
  }
  for (const r of indoor) {
    const xs = r.polygon.map((q) => q[0]); const ys = r.polygon.map((q) => q[1]);
    const w = Math.max(...xs) - Math.min(...xs); const h = Math.max(...ys) - Math.min(...ys);
    assert.ok(Math.min(w, h) >= 1.5 - 1e-6, `${r.key} is at least 1.5 m wide`);
  }
  // The balcony is outside the home, along it; its chair standing inside the home belongs to the room it stands in.
  const balcony = laid.recon.rooms.find((r) => r.key === 'balcony');
  assert.ok(balcony.polygon.every((p) => p[0] <= 0 + 1e-6 || p[0] >= 12.5 - 1e-6 || p[1] <= 0 + 1e-6 || p[1] >= 8 - 1e-6));
  assert.equal(laid.recon.objects.find((o) => o.key === 'chair').room, 'living');
  assert.deepEqual(laid.recon.objects.map((o) => o.at), READING.objects.map((o) => o.at), 'no piece moves');
  // Doors read in the old outlines are dropped (the walk infers them); the window is on an exterior wall.
  assert.equal(laid.recon.openings.filter((o) => o.kind !== 'WINDOW').length, 0);
  assert.deepEqual(laid.recon.openings.find((o) => o.key === 'win').at, [12.5, 6]);
  assert.deepEqual(layoutFromPieces(READING), laid, 'deterministic');
});

test('spaceFromReading: the read outlines fail, the layout from the pieces passes — every room reached through a door', () => {
  const furnish = (recon) => ({ objects: recon.objects });
  const out = spaceFromReading(READING, { sourceKey: 'k', expected: [{ kind: 'BEDROOM' }, { kind: 'BEDROOM' }, { kind: 'BATHROOM' }], furnish });
  assert.ok(!('problems' in out), JSON.stringify(out.problems));
  assert.equal(out.layout, 'FROM_PIECES');
  assert.equal(out.geometryCheck.verdict, 'PASS', JSON.stringify(out.geometryCheck.issues));
  assert.deepEqual(out.space.unreachable, []);
  assert.ok(out.layoutRepairs.some((r) => r.code === 'LAYOUT_FROM_PIECES'));
  assert.ok(out.space.repairs.some((r) => r.code === 'DOOR_INFERRED'));
  // A reading whose own outlines pass is used as read.
  const clean = {
    ...READING, fidelity: undefined, objects: [],
    rooms: [room('living', 'LIVING', rect(0, 0, 6, 4)), room('bed', 'BEDROOM', rect(6, 0, 10, 4))],
    openings: [opening('door', 'DOOR', [6, 2]), opening('entry', 'DOOR', [3, 4])],
  };
  const plain = spaceFromReading(clean, { sourceKey: 'k', expected: [], furnish: null });
  assert.ok(!('problems' in plain));
  assert.equal(plain.geometryCheck.verdict, 'PASS', JSON.stringify(plain.geometryCheck.issues));
  assert.equal(plain.layout, 'READ');
  assert.deepEqual(plain.layoutRepairs, []);
});

test('the server builds photo spaces through spaceFromReading, rebuilds an old failed one from its kept reading for free, and publishes an approximate render walk or plans it the usual way', () => {
  const route = code('supabase/functions/design-studio-reconstruct/walkthrough.ts');
  assert.match(route, /const spaceOf = \(recon: typeof read\) => spaceFromReading\(recon, \{[\s\S]*const built = useArchitect \? fromArchitect! : useDraft \? fromDraft! : spaceOf\(read\);/);
  const rebuild = route.slice(route.indexOf('async function rebuildSpace'), route.indexOf('/** The design and every geometry correction of it'));
  // Only a failed space of older code, only the owner's own reading of these pictures and this render, never a model call.
  assert.match(rebuild, /prov\.photoSpace === PHOTO_SPACE_VERSION/);
  assert.match(rebuild, /const stale = prov\?\.geometryCheck\?\.verdict === 'FAIL' \|\| prov\?\.layout === 'FROM_PIECES';/);
  assert.match(rebuild, /String\(job\.user_id\) !== a\.actorId/);
  assert.match(rebuild, /built\.geometryCheck\.verdict !== 'PASS'\) return false;/);
  assert.doesNotMatch(rebuild, /fetch\(|OPENAI|meterAiCall/);
  assert.match(route, /photoSpace: PHOTO_SPACE_VERSION, layout: built\.layout, layoutRepairs: built\.layoutRepairs,/);
  // Asked again for a design already walked on its reconstructed space, that space is rebuilt too (not only on the
  // first walk from the photo design): the request starts from the on-plan version, whose parent is the photo design.
  assert.match(route, /if \(source\?\.kind === 'FLOORPLAN_SCENE' && source\.provenance\?\.inferred === true && version\.parent_id/);
  assert.match(route, /await rebuildSpace\(admin, \{ actorId, project, version: root, photoSource: photo, renderId \}, source\)\) \{\s*const again = await designOnPlan\(admin, root, project\.id, renderId\);/);
  assert.equal(PHOTO_SPACE_VERSION, 'ds-photo-space-3');
  // A render walk that is walkable and most of the render is published, recorded as approximate.
  assert.match(route, /const publishable = gate\.ready \|\| \(lastResort && gate\.lastResort\);[\s\S]*if \(!publishable\) \{/);
  assert.match(route, /const approximate = publishable && !gate\.promoted;/);
  // A render walk that is not even that is declined, never failed: the walkthrough is planned the usual way instead.
  const fromRender = route.slice(route.indexOf('async function planFromRender'), route.indexOf('// ── SUBMIT'));
  assert.match(fromRender, /if \(!publishable\) \{[\s\S]{0,600}?return false;\s*\}/);
  assert.doesNotMatch(fromRender.slice(fromRender.indexOf('if (!publishable)'), fromRender.indexOf('return false;')), /await fail\(/);
  assert.match(route, /if \(furnishing && row\.render_id && furnishing\.renderId === String\(row\.render_id\) && !declined\) \{[\s\S]{0,400}?tried: true[\s\S]{0,300}?if \(await planFromRender\(admin, row, design, furnishing, preferences\.style \?\? null\)\) return;/);
  // An attempt killed mid-build (the CPU limit) is never built again: the try is recorded before the build.
  assert.match(route, /const declined = !!row\.timings\?\.renderFurnishing\?\.declined \|\| !!row\.timings\?\.renderFurnishing\?\.tried;/);
  // Declined once, never built again (it spent an invocation's CPU): the usual plan starts in a fresh invocation,
  // and the declining one is not counted as a plan attempt.
  assert.match(route, /if \(furnishing && row\.render_id && !declined && row\.timings\?\.renderFurnishing\?\.declined\) \{\s*await release\(admin, row, \{ plan_attempts: Math\.max\(0, row\.plan_attempts - 1\), timings: row\.timings, next_check_at: iso\(Date\.now\(\)\) \}\);\s*return;/);
  assert.ok(READY_MIN_IMPORTANT_RECALL >= 0.8 && READY_MIN_RECALL >= 0.7);
  const gate = code('src/lib/designStudio/walkthrough/renderGate.ts');
  assert.match(gate, /const ready = promoted \|\| \(navPass && roughly\);/);
  assert.match(gate, /!build\.gate\?\.missingEssential\?\.length/);
});
