// Writes the Blender factory's test specs from HOMATCH's own fixtures, through
// the real builders and compiler (so the worker tests build what production sends):
//   apartment.spec.json   the isometric apartment reading → buildDesign → compileSceneSpec
// Run: node scripts/design-studio/factory-fixtures.mjs
import fs from 'node:fs';
import path from 'node:path';
import { validateReconstruction, planDocument } from '../../src/lib/designStudio/reconstructRead.ts';
import { buildCanonical, calibrate, estimateScale } from '../../src/lib/designStudio/scale.ts';
import { buildSpaceModel } from '../../src/lib/designStudio/space.ts';
import { buildDesign, emptyCorrections } from '../../src/lib/designStudio/reconstruction.ts';
import { compileSceneSpec } from '../../src/lib/designStudio/hybrid/compileSpec.ts';
import { validateSceneSpec } from '../../src/lib/designStudio/hybrid/sceneSpec.ts';
import { seedAssets, seedMaterials } from '../../src/lib/designStudio/__tests__/seedCatalog.mjs';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'infra/design-studio-gpu-worker/tests/fixtures');
const RAW = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/lib/designStudio/__tests__/fixtures/isometric-apartment.recon.json'), 'utf8'));
const { recon } = validateReconstruction(RAW, 1);
const doc = planDocument(recon, 'users/u/design-studio-floorplans/p/ref.jpg');
const decisions = { rejected: [], roomKinds: {} };
const calibration = calibrate(doc, decisions, [], estimateScale(doc, []));
const canonical = buildCanonical(doc, decisions, calibration, 2.7).canonical;
const space = buildSpaceModel(canonical.scene);
const assets = seedAssets(); const materials = seedMaterials();
const { state } = buildDesign(recon, emptyCorrections(), space, assets, materials, { scale: calibration.metresPerPx * 100 });
// A dollhouse view from the south-east, 35° down (three.js world: x, up, −north).
const xs = space.rooms.flatMap((r) => r.polygon.map((p) => p.x)); const ys = space.rooms.flatMap((r) => r.polygon.map((p) => p.y));
const cx = (Math.min(...xs) + Math.max(...xs)) / 2; const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
const dist = 60; const a = 0.7; const el = (35 * Math.PI) / 180;
const position = [cx + dist * Math.sin(a) * Math.cos(el), dist * Math.sin(el), -cy + dist * Math.cos(a) * Math.cos(el)];
const spec = compileSceneSpec({
  space, state, assets: new Map(assets.map((x) => [x.code, x])), materials: new Map(materials.map((m) => [m.id, m])),
  source: { kind: 'PICTURE', architecture: 'OBSERVED', furnishing: 'OBSERVED' },
  camera: { position, target: [cx, 0, -cy], fov: 16, near: 1, far: 400, aspect: 1.4, background: '#f3f1ed', cut: { exteriorM: 1.1, interiorM: 1.0 } },
  render: { edge: 640, samples: 16 },
  outputs: { render: true, scene: true, objects: true },
});
validateSceneSpec(JSON.parse(JSON.stringify(spec)));
fs.writeFileSync(path.join(OUT, 'apartment.spec.json'), `${JSON.stringify(spec, null, 1)}\n`);
console.log(`apartment.spec.json: ${spec.rooms.length} rooms, ${spec.walls.length} walls, ${spec.objects.length} pieces, ${spec.objects.filter((o) => o.runtime).length} walkthrough models in ${new Set(spec.objects.filter((o) => o.group).map((o) => o.group)).size} groups`);
