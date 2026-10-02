// HOW CLOSE IS IT — a report, not a magic number.
//
// Each dimension is measured on its own and gated on its own (PASS / WARN /
// FAIL / UNKNOWN), and says why: a scene with the right colours and the wrong
// rooms FAILS on rooms. Measured facts (the camera's reprojection error, rooms
// and openings built, pieces placed, how far they moved) come first; the
// visual check's per-dimension judgement (qa.ts) sits beside them, never
// replacing them. Pieces nothing could represent are listed by name.

import type { BuildReport } from '../reconstruction.ts';
import type { Reconstruction } from '../reconstructRead.ts';
import type { DesignState } from '../designState.ts';
import type { ObjectDecision, Route } from './resolution.ts';
import type { QaDimension, QaReport } from './qa.ts';

export type Gate = 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';
export interface Dimension { name: string; value: string; gate: Gate; note: string }
export interface FidelityReport {
  dimensions: Dimension[];
  unresolvedHighImpact: Array<{ key: string; type: string; why: string }>;
  routes: Record<Route, number>;
  /** Worst gate across dimensions. */
  verdict: Gate;
}

const worst = (gates: Gate[]): Gate => (gates.includes('FAIL') ? 'FAIL' : gates.includes('WARN') ? 'WARN' : gates.includes('UNKNOWN') ? 'UNKNOWN' : 'PASS');
/** A visual-check score as a gate: 8+ PASS, 6+ WARN, below FAIL, none UNKNOWN. */
export const gateOf = (score: number | null | undefined): Gate => (score == null ? 'UNKNOWN' : score >= 8 ? 'PASS' : score >= 6 ? 'WARN' : 'FAIL');
const both = (a: Gate, b: Gate): Gate => (a === 'UNKNOWN' ? b : b === 'UNKNOWN' ? a : worst([a, b]));

export function fidelityReport(input: {
  recon: Reconstruction; state: DesignState; build: BuildReport; decisions: ObjectDecision[];
  /** Factory-built walkthrough models that arrived (object keys). */
  factoryOk: ReadonlySet<string>; qa: QaReport | null; roomsBuilt: number;
}): FidelityReport {
  const { recon, state, build, decisions, qa } = input;
  const dims = qa?.scores.dimensions ?? {};
  const seen = (name: QaDimension) => (dims[name] == null ? 'not judged' : `${dims[name]}/10 by eye`);
  const why = (codes: string[]) => (qa ? qa.errors.filter((e) => codes.includes(e.code)).slice(0, 4).map((e) => `${e.target}: ${e.evidence}`).join('; ') : '');
  const d: Dimension[] = [];
  // Architecture: the rebuilt outline against the picture's own (measured frame). Never loosened.
  const err = recon.fidelity?.errorPct ?? null;
  const fp: Gate = err === null ? 'UNKNOWN' : err <= 2.5 ? 'PASS' : err <= 5 ? 'WARN' : 'FAIL';
  d.push({ name: 'footprint', value: `${err === null ? 'n/a' : `${err}% of picture height`}; ${seen('footprint')}`, gate: both(fp, gateOf(dims.footprint)), note: recon.fidelity?.model ? `measured ${recon.fidelity.model} camera` : 'no measured camera' });
  const pixelRooms = recon.rooms.filter((r) => r.geometry === 'PIXELS').length;
  const rooms: Gate = input.roomsBuilt === recon.rooms.length && pixelRooms === recon.rooms.length ? 'PASS' : input.roomsBuilt === recon.rooms.length ? 'WARN' : 'FAIL';
  d.push({ name: 'rooms', value: `${input.roomsBuilt} built of ${recon.rooms.length} read (${pixelRooms} traced); ${seen('rooms')}`, gate: both(rooms, gateOf(dims.rooms)), note: why(['wrongWall']) });
  d.push({ name: 'walls', value: seen('walls'), gate: gateOf(dims.walls), note: why(['wrongWall', 'wrongSectionCut']) });
  const pixelOpenings = recon.openings.filter((o) => o.geometry === 'PIXELS').length;
  d.push({ name: 'openings', value: `${recon.openings.length} read (${pixelOpenings} traced); ${seen('openings')}`, gate: both(recon.openings.length ? 'PASS' : 'WARN', gateOf(dims.openings)), note: why(['wrongOpening']) });
  const balcony = recon.rooms.some((r) => r.kind === 'BALCONY' || r.kind === 'TERRACE');
  d.push({ name: 'balcony', value: `${balcony ? 'read' : 'none read'}; ${seen('balcony')}`, gate: gateOf(dims.balcony), note: '' });
  // Inventory: observed pieces that are in the scene.
  const observed = recon.objects.filter((o) => o.basis === 'OBSERVED');
  const placed = new Set(state.objects.map((o) => o.provenance?.ref).filter(Boolean));
  const covered = observed.filter((o) => placed.has(o.key)).length;
  const coverage = observed.length ? covered / observed.length : 1;
  d.push({ name: 'inventory', value: `${covered}/${observed.length} observed pieces placed; ${seen('inventory')}`, gate: both(coverage >= 0.95 ? 'PASS' : coverage >= 0.85 ? 'WARN' : 'FAIL', gateOf(dims.inventory)), note: [build.unplaced.length ? `left out: ${build.unplaced.map((u) => u.key).join(', ')}` : '', why(['objectMissing', 'objectExtra'])].filter(Boolean).join('; ') });
  // Placement: how far pieces had to move from where they were seen.
  const moved = build.placed.map((p) => p.moved).sort((a, b) => a - b);
  const median = moved.length ? moved[Math.floor(moved.length / 2)] : 0;
  const far = moved.filter((m) => m > 0.6).length;
  d.push({ name: 'placement', value: `median shift ${median} m, ${far} over 0.6 m; ${seen('placement')}`, gate: both(median <= 0.25 && far <= 2 ? 'PASS' : median <= 0.5 ? 'WARN' : 'FAIL', gateOf(dims.placement)), note: why(['wrongPosition']) });
  const shaped = state.objects.filter((o) => o.shape).length;
  d.push({ name: 'scale', value: `${shaped}/${state.objects.length} at the seen size; ${seen('scale')}`, gate: both(shaped === state.objects.length ? 'PASS' : 'WARN', gateOf(dims.scale)), note: why(['wrongScale']) });
  d.push({ name: 'orientation', value: seen('orientation'), gate: gateOf(dims.orientation), note: why(['wrongRotation']) });
  const coloured = state.objects.filter((o) => o.colorOverride || o.shape?.secondary).length;
  d.push({ name: 'colors', value: `${coloured}/${state.objects.length} wear a seen colour; ${seen('colors')}`, gate: both(coloured >= state.objects.length * 0.8 ? 'PASS' : 'WARN', gateOf(dims.colors)), note: why(['wrongColor']) });
  const surfaces = Object.values(state.surfaces);
  const textured = surfaces.filter((s) => s.materialId).length;
  d.push({ name: 'materials', value: `${surfaces.length} surfaces dressed, ${textured} with a catalogue material; ${seen('materials')}`, gate: both(surfaces.length ? 'PASS' : 'WARN', gateOf(dims.materials)), note: why(['wrongMaterial', 'wrongSurfacePattern']) });
  d.push({ name: 'lighting', value: seen('lighting'), gate: gateOf(dims.lighting), note: why(['wrongLighting']) });
  d.push({ name: 'camera', value: `${recon.cameras.some((c) => c.fit) ? 'picture camera fitted' : 'estimated'}; ${seen('camera')}`, gate: both(recon.cameras.some((c) => c.fit) ? 'PASS' : 'WARN', gateOf(dims.camera)), note: why(['wrongCamera']) });
  if (qa) {
    const high = qa.errors.filter((e) => e.severity === 'HIGH').length;
    d.push({ name: 'overall likeness', value: `${qa.scores.overall}/10; ${high} serious differences left`, gate: qa.scores.overall >= 7.5 && high === 0 ? 'PASS' : qa.scores.overall >= 6 ? 'WARN' : 'FAIL', note: 'source and render from the same camera' });
  } else d.push({ name: 'overall likeness', value: 'not checked', gate: 'UNKNOWN', note: '' });
  // High-impact pieces nothing could represent faithfully, by name.
  const unresolved = decisions
    .filter((x) => x.impact >= 0.5 && (x.route === 'UNRESOLVED' || (x.route === 'FACTORY' && !input.factoryOk.has(x.key) && input.factoryOk.size > 0)))
    .map((x) => ({ key: x.key, type: x.type, why: x.route === 'UNRESOLVED' ? x.reason : 'its factory model did not arrive: HOMATCH\'s drawn piece stands in' }));
  d.push({ name: 'high-impact pieces', value: unresolved.length ? `${unresolved.length} unresolved` : 'all represented', gate: unresolved.length === 0 ? 'PASS' : unresolved.length <= 2 ? 'WARN' : 'FAIL', note: unresolved.map((u) => u.key).join(', ') });
  const routes: Record<Route, number> = { CATALOGUE: 0, PARAMETRIC: 0, FACTORY: 0, UNRESOLVED: 0 };
  for (const x of decisions) routes[x.route] += 1;
  return { dimensions: d, unresolvedHighImpact: unresolved, routes, verdict: worst(d.map((x) => x.gate)) };
}

/** The report with further measured facts (walkability, intersections, scale) beside it; the verdict follows. */
export function withChecks(report: FidelityReport, extra: Dimension[]): FidelityReport {
  const dimensions = [...report.dimensions, ...extra.filter((x) => !report.dimensions.some((d) => d.name === x.name))];
  return { ...report, dimensions, verdict: worst(dimensions.map((x) => x.gate)) };
}
