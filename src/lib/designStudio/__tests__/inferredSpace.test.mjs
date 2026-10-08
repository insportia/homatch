// A 3D walkthrough from EVERY generated design: a photo design with no floor
// plan walks on a space reconstructed from the project's own pictures (never
// a request to upload again), completed, built, walked and repaired.
//
//   A  generated design, no floor plan → the walkthrough starts (no upload blocker)
//   B  incomplete walls (a room read a little off) → conservative geometry inferred
//   C  a missing room connection → a door is inferred, every room reachable
//   D  furniture blocking the only passage → placement repaired, still walkable
//   E  an invalid spawn → a valid one is recalculated
//   F  a double tap → one reading
//   G  refresh / reopen → the same reading resumes
//   H  inferred geometry is never written as verified property facts
//   I  a project with a real floor plan still uses it (no inference)

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { validateReconstruction } from '../reconstructRead.ts';
import { basisOf, completeForWalk, inferredSpace, mostlyInferred, sharedSegments, validSpawn, WALK_SPACE_BRIEF } from '../walkthrough/inferredSpace.ts';
import { buildWalkthrough, reachableRooms } from '../walkthrough/build.ts';
import { buildSpaceModel, pointInPolygon } from '../space.ts';
import { buildWalkModel, isFree } from '../navigation.ts';
import { emptyDesignState } from '../designState.ts';
import { compileSceneSpec } from '../hybrid/compileSpec.ts';
import { validateSceneSpec } from '../hybrid/sceneSpec.ts';
import { testAssets, testMaterials } from './fixtures.mjs';

const code = (rel) => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const room = (key, kind, poly, over = {}) => ({ key, kind, label: null, polygon: poly, outdoor: kind === 'BALCONY', confidence: 0.8, basis: 'OBSERVED', ...over });
const door = (key, at, over = {}) => ({ key, kind: 'DOOR', at, widthM: 0.9, heightM: 2.1, sillM: 0, confidence: 0.8, basis: 'OBSERVED', ...over });
const reading = (rooms, openings, over = {}) => ({
  version: 'ds-recon-3', view: 'AERIAL', scaleConfidence: 0.5, scaleEvidence: null, ceilingHeightM: null, rooms, openings,
  objects: [], surfaces: [], palette: [], styleWords: [], cameras: [], unknowns: [], usesPlan: false, ...over,
});
const walk = (canonical) => {
  const space = buildSpaceModel(canonical.scene);
  return { space, model: buildWalkModel(space, [], new Map()) };
};

test('the reconstruction reader is reused with a walk brief: source pictures for architecture, generated designs for the rest', () => {
  assert.match(WALK_SPACE_BRIEF, /SOURCE pictures: the architecture/);
  assert.match(WALK_SPACE_BRIEF, /GENERATED DESIGNS/);
  assert.match(WALK_SPACE_BRIEF, /Never mark a guess OBSERVED/);
  const walkRoute = code('supabase/functions/design-studio-reconstruct/walkthrough.ts');
  assert.match(walkRoute, /input: \[\{ role: 'system', content: RECON_SYSTEM \}, \{ role: 'user', content \}\]/, 'the existing reconstruction reader');
  // Read with each picture's shape and the selected render's measured frame, then made buildable (readingRepair.ts).
  assert.match(walkRoute, /const \{ recon: read \} = validateReconstruction\(raw, images\.length, \{\s*\/\/[^\n]*\n\s*imageAspects: images\.map\(\(img\) => img\.aspect\),\s*frames: measured && viewIndex != null \? \[\{ image: selected, view: viewIndex, frame: measured\.frame \}\] : \[\],/);
  assert.match(walkRoute, /const repaired = repairReading\(read\);\s*const recon = repaired\.recon;/);
  assert.deepEqual([basisOf('OBSERVED', 0.2), basisOf('INFERRED', 0.8), basisOf('INFERRED', 0.5), basisOf('INFERRED', 0.2)], ['OBSERVED', 'INFERRED_HIGH', 'INFERRED_MEDIUM', 'INFERRED_LOW']);
});

test('A: a generated design with no floor plan starts its walkthrough (no upload blocker anywhere)', () => {
  const route = code('supabase/functions/design-studio-reconstruct/walkthrough.ts');
  assert.match(route, /if \(source\?\.kind === 'PHOTO_SET'\) \{\s*const renderId = body\.renderId \?\? null;\s*let onPlan = await designOnPlan\(admin, version, project\.id, renderId\);/);
  // A space read from other pictures is read once more from the selected render; a failed reading keeps the old one.
  assert.match(route, /if \(onPlan && renderId && onPlan\.source\.provenance\?\.inferred === true && onPlan\.source\.provenance\?\.fromRenderId !== renderId\) \{/);
  assert.match(route, /if \(again\.state === 'READY'\) onPlan = await designOnPlan\(admin, version, project\.id, renderId\) \?\? onPlan;\s*\}\s*if \(!onPlan\) \{/);
  assert.match(route, /const space = await reconstructSpace\(admin,/);
  assert.match(route, /if \(space\.state === 'RUNNING'\) return json\(\{ walkthrough: null, reconstructing: true \}, 202\);/);
  assert.doesNotMatch(route, /have: \['DESIGN', 'PHOTOS'\]/, 'the "add a plan" answer is gone');
  // The walkthrough starts by itself once the space exists (the page may be closed).
  assert.match(route, /if \(done\) await kick\(a\.authorization, 'walkthrough-create'/);
  const panel = code('src/components/designStudio/unified/WalkthroughPanel.tsx');
  for (const gone of [/walk-needs-plan/, /walk-add-plan/, /onAddPlan/, /dsx_walk_needs_/, /dsx_walk_missing_/]) assert.doesNotMatch(panel, gone);
  assert.match(panel, /data-testid="walk-reconstructing"/);
  assert.doesNotMatch(code('src/components/designStudio/unified/DesignResult.tsx'), /start=floorplan/, 'the Result never sends the customer to upload the property again');
  // The isometric apartment of the reconstruction fixtures: a real navigable scene, every indoor room reached.
  const raw = JSON.parse(code('src/lib/designStudio/__tests__/fixtures/isometric-apartment.recon.json'));
  const out = inferredSpace(validateReconstruction(raw, 1).recon, 'k');
  assert.ok(!('problems' in out), JSON.stringify(out.problems));
  assert.equal(out.unreachable.length, 0, JSON.stringify(out));
  assert.ok(out.reachable.length >= 5);
  assert.equal(out.canonical.geometryState, 'ESTIMATED');
});

test('B: a room read a little off (a gap, no wall shared) is moved to touch and joined: conservative geometry, no island', () => {
  const r = reading([
    room('living', 'LIVING', rect(0, 0, 5, 4)),
    room('bed', 'BEDROOM', rect(5.6, 0.5, 9, 4), { confidence: 0.5, basis: 'INFERRED' }), // 0.6 m gap: a wall read off
  ], [door('front', [2.5, 0])]);
  const { recon, repairs } = completeForWalk(r);
  assert.ok(repairs.some((x) => x.code === 'ROOM_MOVED_TO_TOUCH' && x.element === 'bed'), JSON.stringify(repairs));
  const bed = recon.rooms.find((x) => x.key === 'bed');
  assert.ok(sharedSegments(bed.polygon, recon.rooms[0].polygon)[0].len >= 3, 'now shares a wall');
  assert.ok(repairs.some((x) => x.code === 'DOOR_INFERRED'), 'and is reached through an inferred door');
  const out = inferredSpace(r, 'k');
  assert.deepEqual(out.unreachable, []);
  assert.equal(out.reachable.length, 2);
  // A missing ceiling height is the typical one, said as a repair.
  assert.ok(out.repairs.some((x) => x.code === 'CEILING_TYPICAL'));
});

test('C: rooms that touch but were read with no door between them get a plausible door; the home gets an entrance', () => {
  const r = reading([
    room('hall', 'HALL', rect(0, 0, 2, 3)),
    room('living', 'LIVING', rect(2, 0, 7, 5)),
    room('bed', 'BEDROOM', rect(7, 0, 10, 4)),
    room('balcony', 'BALCONY', rect(2, 5, 7, 6.5)),
  ], []); // no openings at all
  const { recon, repairs } = completeForWalk(r);
  assert.ok(repairs.some((x) => x.code === 'ENTRANCE_INFERRED'), JSON.stringify(repairs));
  const inferred = recon.openings.filter((o) => o.basis === 'INFERRED');
  assert.ok(inferred.length >= 3, 'hall↔living, living↔bed, living↔balcony');
  assert.ok(inferred.every((o) => o.widthM >= 0.8 && o.confidence < 0.5), 'wide enough to pass; honestly low confidence');
  assert.ok(recon.openings.some((o) => o.kind === 'BALCONY_DOOR'), 'the balcony through a balcony door');
  const out = inferredSpace(r, 'k');
  assert.deepEqual(out.unreachable, [], JSON.stringify(out.repairs));
  assert.equal(out.reachable.length, 3);
  assert.ok(mostlyInferred({ OBSERVED: 1, INFERRED_HIGH: 0, INFERRED_MEDIUM: 0, INFERRED_LOW: 3 }));
  // The scene is renderable by the existing walkthrough factory path.
  const { space } = walk(out.canonical);
  const spec = compileSceneSpec({ space, state: emptyDesignState(), assets: testAssets(), materials: testMaterials(), source: { kind: 'DESIGN', architecture: 'OBSERVED', furnishing: 'DESIGN' }, camera: null, outputs: { render: false, scene: false, objects: true } });
  assert.doesNotThrow(() => validateSceneSpec(JSON.parse(JSON.stringify(spec))));
});

test('D: furniture the design put across the only passage is moved (or dropped), never left blocking it', () => {
  const r = reading([room('living', 'LIVING', rect(0, 0, 5, 4)), room('bed', 'BEDROOM', rect(5, 0, 8.5, 4))], [door('front', [2.5, 0]), door('d1', [5, 2])]);
  const out = inferredSpace(r, 'k');
  const { space } = walk(out.canonical);
  const assets = testAssets();
  const materialsById = testMaterials();
  const materialsByCode = new Map([...materialsById.values()].map((m) => [m.code, m]));
  const living = space.rooms.find((x) => x.id === 'r-living');
  const d = space.doors.find((x) => Math.abs(x.centre.x - 5) < 0.3);
  assert.ok(d, 'the door between the rooms exists in the scene');
  // A sofa planned right in front of the bedroom door (room-local metres).
  const pose = { x: d.centre.x - living.bounds.minX - 0.5, y: d.centre.y - living.bounds.minY, rotationDeg: 90 };
  const plan = { lighting: { timeOfDay: 'DAY', temperature: 'NEUTRAL', interiorIntensity: 0.8 }, palette: [], styleCode: null,
    rooms: [{ roomId: 'r-living', floorMaterial: null, floorColor: null, wallMaterial: null, wallColor: null, wallFinish: 'MATTE', accent: null, ceilingColor: null, items: [{ code: 'dev/sofa-3', type: 'X', pose, scale: 1, color: null, origin: 'PLANNED' }] }] };
  const { state, report } = buildWalkthrough({ space, base: emptyDesignState(), plan, assets, materialsByCode, materialsById, idPrefix: 'walk-d' });
  assert.notEqual(report.items[0].outcome, 'PLANNED', 'not kept where it blocks the door');
  const before = reachableRooms(space, buildWalkModel(space, [], assets));
  const after = reachableRooms(space, buildWalkModel(space, state.objects, assets));
  for (const id of before) assert.ok(after.has(id), `${id} cut off`);
  assert.ok(after.has('r-bed'));
});

test('E: an invalid spawn (in a wall, outside, nowhere) is recalculated to free floor inside an indoor room', () => {
  const out = inferredSpace(reading([room('living', 'LIVING', rect(0, 0, 5, 4))], []), 'k');
  const { space, model } = walk(out.canonical);
  assert.ok(out.spawn && isFree(model, out.spawn), 'the stored spawn is valid');
  const living = space.rooms[0];
  for (const bad of [{ x: living.bounds.minX, y: living.bounds.minY + 1 }, { x: -20, y: -20 }, null]) {
    const p = validSpawn(space, model, bad);
    assert.ok(p && isFree(model, p) && pointInPolygon(p, living.polygon), JSON.stringify({ bad, p }));
  }
  const good = { x: (living.bounds.minX + living.bounds.maxX) / 2, y: (living.bounds.minY + living.bounds.maxY) / 2 };
  assert.deepEqual(validSpawn(space, model, good), good, 'a valid spawn is kept');
});

test('F/G: one reading per photo source — a double tap, a refresh or a reopen follows the same job; failures retry a bounded number of times', () => {
  const route = code('supabase/functions/design-studio-reconstruct/walkthrough.ts');
  // Keyed on the architecture's evidence, and on the selected render when the reading furnishes from it.
  assert.match(route, /const key = await sha256Hex\(a\.renderId \? `walk-space:v2:\$\{a\.photoSource\.id\}:\$\{a\.renderId\}` : `walk-space:v1:\$\{a\.photoSource\.id\}`\);/, 'keyed on the architecture\'s evidence');
  assert.match(route, /if \(rows\.some\(\(j\) => j\.status === 'SUCCEEDED' && j\.output\?\.sourceId\)\) return \{ state: 'READY' \};/, 'done once, reused');
  assert.match(route, /if \(running && isFresh\(running\.started_at\)\) return \{ state: 'RUNNING' \};/, 'a second tap or a refresh follows it');
  assert.match(route, /Two taps that raced: the earliest job stays/);
  assert.match(route, /failed\.length \+ \(running \? 1 : 0\) >= \(a\.renderId \? RENDER_SPACE_ATTEMPTS : SPACE_ATTEMPTS\)/, 'never an unbounded number of paid readings');
  // A reading of the selected render is bought once: a failure is reported, never retried automatically.
  assert.match(route, /const RENDER_SPACE_ATTEMPTS = 1;/, 'the render reading is a single paid call');
  assert.match(route, /Answered: paid whatever the answer turns out to be, so metered before it is judged\./);
  const panel = code('src/components/designStudio/unified/WalkthroughPanel.tsx');
  assert.match(panel, /if \(asking \|\| inFlight\.current\) return;/);
  assert.match(panel, /window\.sessionStorage\.getItem\(`hm-ds-walk:\$\{designVersionId\}`\) === '1'\) void start\(false\)/, 'a reopened page picks the reconstruction up again');
  // Reopened after the space exists: the derived design on it is found again (same deterministic version, same lineage).
  assert.match(route, /const id = await uuidFrom\(`ds-walk-photo-design:\$\{version\.id\}:\$\{plan\.id\}`\);/);
});

test('H: inferred geometry stays a Design Studio walkthrough approximation — never verified, never property data', () => {
  const route = code('supabase/functions/design-studio-reconstruct/walkthrough.ts');
  const read = route.slice(route.indexOf('async function readSpace'), route.indexOf('/** The design and every geometry correction of it'));
  assert.match(read, /geometry_state: 'ESTIMATED'/);
  assert.match(read, /origin: 'INFERRED_FOR_WALKTHROUGH', inferred: true, verified: false/);
  for (const forbidden of [/from\('properties'\)/, /from\('ds_floorplans'\)\.update/, /active_source_id/, /head_version_id/, /verif(y|ication)_/i, /\.update\(\{[^}]*canonical/]) {
    assert.doesNotMatch(read, forbidden, String(forbidden));
  }
  // Every element of the plan document stays UNVERIFIED with its own confidence (the reader's own document).
  const out = inferredSpace(reading([room('living', 'LIVING', rect(0, 0, 5, 4))], []), 'k');
  assert.equal(out.canonical.geometryState, 'ESTIMATED');
  assert.ok(out.basis.INFERRED_LOW + out.basis.INFERRED_MEDIUM >= 1, 'the inferred entrance is counted as inferred');
  // The walkthrough knows it walked a reconstructed space; the Result says so quietly, never as a blocker.
  assert.match(route, /\.\.\.\(source\.provenance\?\.inferred === true \? \{ inferred: true \} : \{\}\)/);
  assert.match(code('src/components/designStudio/unified/WalkthroughPanel.tsx'), /walk\.inferred \? \(/);
});

test('I: a project with a measured floor plan walks on it — exact evidence first, no inference', () => {
  const route = code('supabase/functions/design-studio-reconstruct/walkthrough.ts');
  // A floor-plan design never enters the photo branch; a photo design prefers a measured plan over a reconstructed one.
  assert.match(route, /Number\(a\.provenance\?\.inferred === true\) - Number\(b\.provenance\?\.inferred === true\)/);
  assert.match(route, /if \(!source \|\| source\.kind !== 'FLOORPLAN_SCENE' \|\| !source\.canonical\?\.scene\?\.floors\?\.length\)/);
  const create = route.slice(route.indexOf('export async function handleWalkthroughCreate'), route.indexOf('export async function handleWalkthroughStatus'));
  assert.ok(create.indexOf("source?.kind === 'PHOTO_SET'") > 0 && create.indexOf('reconstructSpace(') > create.indexOf("source?.kind === 'PHOTO_SET'"), 'inference only inside the photo branch');
});
