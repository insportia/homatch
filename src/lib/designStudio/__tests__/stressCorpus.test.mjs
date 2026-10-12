// A STRESS CORPUS: generated homes and generated (often bad) plans, built as production builds them.
//
// Each home is a random footprint split room by room (a kitchen-living or living room and kitchen, bedrooms, a
// hall, a bathroom, sometimes a study and a balcony), its doors read at random places on its walls (some missed, the
// build infers them). Each plan is what a careless model could return: every piece of each room's programme at a
// random place and turn, half of them locked as if seen in a picture. The tour is built from it; when that build does
// not walk, leaves a room without what makes it that room or would not be believed, it is built again by HOMATCH's
// rules alone (the rule build, walkthrough.ts ruleFallback) — as production does. A ratchet: the share of homes that
// come out walkable, complete and believable may only rise. Synthetic data only.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spaceFromReading } from '../walkthrough/photoSpace.ts';
import { buildSpaceModel } from '../space.ts';
import { buildWalkthrough } from '../walkthrough/build.ts';
import { homeProgramme } from '../walkthrough/programme.ts';
import { emptyDesignState } from '../designState.ts';
import { prodAssets } from './fixtures/devCatalogue.mjs';

const SEEDS = 20;
// Measured on this corpus when the rule build and the aisle guarantee came in (15 of 20). Raise it as the build improves.
const FLOOR = 15;

function mulberry(a) { return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const r2 = (n) => Math.round(n * 100) / 100;
const rect = (b) => [[r2(b.x0), r2(b.y0)], [r2(b.x1), r2(b.y0)], [r2(b.x1), r2(b.y1)], [r2(b.x0), r2(b.y1)]];

function home(rng) {
  const W = 7 + rng() * 5; const D = 6 + rng() * 4;
  const n = 4 + Math.floor(rng() * 4);
  let rooms = [{ x0: 0, y0: 0, x1: W, y1: D }]; const splits = [];
  for (let k = 0; rooms.length < n && k < 20; k += 1) {
    rooms.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0));
    const big = rooms[0]; const w = big.x1 - big.x0; const d = big.y1 - big.y0;
    if (Math.max(w, d) < 4.6) break;
    const t = 0.32 + rng() * 0.36; rooms.shift();
    if (w >= d) { const x = big.x0 + w * t; rooms.push({ ...big, x1: x }, { ...big, x0: x }); splits.push({ a: [x, big.y0], b: [x, big.y1] }); }
    else { const y = big.y0 + d * t; rooms.push({ ...big, y1: y }, { ...big, y0: y }); splits.push({ a: [big.x0, y], b: [big.x1, y] }); }
  }
  const area = (b) => (b.x1 - b.x0) * (b.y1 - b.y0);
  rooms.sort((a, b) => area(b) - area(a));
  const kitchenSeparate = rooms.length >= 6 && rng() < 0.4;
  const out = rooms.map((b, i) => {
    let kind = 'BEDROOM'; let label = null;
    if (i === 0) { kind = 'LIVING'; label = kitchenSeparate ? 'living room' : 'kitchen-living'; }
    else if (i === rooms.length - 1) { kind = 'BATHROOM'; label = 'bathroom'; }
    else if (i === rooms.length - 2) { kind = 'HALL'; label = 'entrance hall'; }
    else if (kitchenSeparate && i === 1) { kind = 'KITCHEN'; label = 'kitchen'; }
    else if (i === rooms.length - 3 && rng() < 0.4) { kind = rng() < 0.5 ? 'UNKNOWN' : 'HALL'; label = 'office'; }
    return { key: `room${i}`, kind, label, polygon: rect(b), outdoor: false, confidence: 0.8, basis: 'OBSERVED', geometry: 'ESTIMATE', b };
  });
  const openings = [];
  splits.forEach((s, i) => { if (rng() < 0.75) { const t = 0.15 + rng() * 0.7; openings.push({ key: `d${i}`, kind: 'DOOR', at: [r2(s.a[0] + (s.b[0] - s.a[0]) * t), r2(s.a[1] + (s.b[1] - s.a[1]) * t)], widthM: 0.8 + rng() * 0.2, heightM: 2.1, sillM: 0, confidence: 0.7, basis: 'OBSERVED' }); } });
  const hall = out.find((r) => r.kind === 'HALL') ?? out[0];
  openings.push({ key: 'entry', kind: 'DOOR', at: [r2(hall.b.x0), r2((hall.b.y0 + hall.b.y1) / 2)], widthM: 0.9, heightM: 2.1, sillM: 0, confidence: 0.7, basis: 'OBSERVED' });
  const rooms2 = out.map(({ b, ...r }) => r);
  if (rng() < 0.6) rooms2.push({ key: 'balcony', kind: 'BALCONY', label: 'balcony', polygon: rect({ x0: W, y0: D * 0.2, x1: W + 1.4, y1: D * 0.8 }), outdoor: true, confidence: 0.8, basis: 'OBSERVED', geometry: 'ESTIMATE' });
  return { version: 'ds-recon-3', view: 'AERIAL', scaleConfidence: 0.6, scaleEvidence: null, ceilingHeightM: 2.7, usesPlan: false, rooms: rooms2, openings, objects: [], surfaces: [], palette: [], styleWords: [], cameras: [], unknowns: [] };
}

function plan(space, rng, all) {
  const prog = homeProgramme(space.rooms);
  return {
    lighting: { timeOfDay: 'DAY', temperature: 'NEUTRAL', interiorIntensity: 0.7 }, palette: [], styleCode: null,
    rooms: space.rooms.map((r) => {
      const xs = r.polygon.map((p) => p.x); const ys = r.polygon.map((p) => p.y);
      const w = Math.max(...xs) - Math.min(...xs); const d = Math.max(...ys) - Math.min(...ys);
      const items = [];
      for (const nd of prog.get(r.id)?.needs ?? []) {
        const opts = all.filter((a) => nd.serves(a) && a.placement === 'FLOOR'); if (!opts.length) continue;
        for (let c = 0; c < (nd.count ?? 1); c += 1) {
          const a = opts[Math.floor(rng() * opts.length)];
          items.push({ code: a.code, type: nd.id, pose: { x: r2(rng() * w), y: r2(rng() * d), rotationDeg: [0, 90, 180, 270][Math.floor(rng() * 4)] }, scale: 1, color: null, origin: 'PLANNED', refKey: `${nd.id}-${c}`, lock: rng() < 0.5 ? { maxShiftM: 0.4, maxTurnDeg: 15 } : null });
        }
      }
      return { roomId: r.id, floorMaterial: null, floorColor: null, wallMaterial: null, wallColor: null, wallFinish: null, accent: null, ceilingColor: null, items };
    }),
  };
}

test(`a stress corpus of ${SEEDS} generated homes and careless plans: at least ${FLOOR} come out walkable, complete and believable`, () => {
  const assets = prodAssets(); const all = [...assets.values()];
  const sound = (g) => g.ok !== false && !g.missingEssential.length && !g.implausible.length;
  let clean = 0; let rescued = 0;
  for (let s = 1; s <= SEEDS; s += 1) {
    const rng = mulberry(s * 7919);
    const built0 = spaceFromReading(home(rng), { sourceKey: `s${s}`, expected: [], furnish: null });
    if ('problems' in built0) continue;
    const space = buildSpaceModel(built0.space.canonical.scene);
    const pl = plan(space, rng, all);
    const build = (p) => buildWalkthrough({ space, base: emptyDesignState(), assets, materialsByCode: new Map(), materialsById: new Map(), idPrefix: 'x', plan: p });
    let b = build(pl);
    if (!sound(b.report.gate)) { b = build({ ...pl, rooms: pl.rooms.map((r) => ({ ...r, items: [] })) }); if (sound(b.report.gate)) rescued += 1; }
    if (sound(b.report.gate)) clean += 1;
  }
  assert.ok(clean >= FLOOR, `${clean} of ${SEEDS} clean (${rescued} by the rule build)`);
  assert.ok(rescued > 0, 'the rule build rescues tours a careless plan breaks');
});
