// HOW CLOSE IS IT — a report, not a magic number.
//
// Each dimension is measured on its own and gated on its own: a scene with the
// right colours and the wrong rooms FAILS on rooms. High-impact objects that
// were not built from the picture are listed by name. The visual comparison
// (qa.ts scores) is one line among the others, never the whole verdict.

import type { BuildReport } from '../reconstruction.ts';
import type { Reconstruction } from '../reconstructRead.ts';
import type { DesignState } from '../designState.ts';
import type { ObjectDecision } from './resolution.ts';
import type { QaReport } from './qa.ts';

export type Gate = 'PASS' | 'WARN' | 'FAIL' | 'UNKNOWN';
export interface Dimension { name: string; value: string; gate: Gate; note: string }
export interface FidelityReport {
  dimensions: Dimension[];
  unresolvedHighImpact: Array<{ key: string; type: string; why: string }>;
  routes: Record<'CATALOGUE' | 'PARAMETRIC' | 'GENERATE' | 'APPROXIMATE', number>;
  /** Worst gate across dimensions. */
  verdict: Gate;
}

const worst = (gates: Gate[]): Gate => (gates.includes('FAIL') ? 'FAIL' : gates.includes('WARN') ? 'WARN' : gates.includes('UNKNOWN') ? 'UNKNOWN' : 'PASS');

export function fidelityReport(input: {
  recon: Reconstruction; state: DesignState; build: BuildReport; decisions: ObjectDecision[];
  generatedOk: ReadonlySet<string>; qa: QaReport | null; roomsBuilt: number;
}): FidelityReport {
  const { recon, state, build, decisions, qa } = input;
  const d: Dimension[] = [];
  // Architecture: the rebuilt outline against the picture's own (measured frame).
  const err = recon.fidelity?.errorPct ?? null;
  d.push({ name: 'footprint', value: err === null ? 'n/a' : `${err}% of picture height`, gate: err === null ? 'UNKNOWN' : err <= 2.5 ? 'PASS' : err <= 5 ? 'WARN' : 'FAIL', note: recon.fidelity?.model === 'ORTHO' ? 'measured camera' : 'no measured camera' });
  const pixelRooms = recon.rooms.filter((r) => r.geometry === 'PIXELS').length;
  d.push({ name: 'rooms', value: `${input.roomsBuilt} built of ${recon.rooms.length} read (${pixelRooms} from pixels)`, gate: input.roomsBuilt === recon.rooms.length && pixelRooms === recon.rooms.length ? 'PASS' : input.roomsBuilt === recon.rooms.length ? 'WARN' : 'FAIL', note: 'room outlines traced on the plan view' });
  const pixelOpenings = recon.openings.filter((o) => o.geometry === 'PIXELS').length;
  d.push({ name: 'openings', value: `${recon.openings.length} read (${pixelOpenings} from pixels)`, gate: recon.openings.length ? 'PASS' : 'WARN', note: '' });
  // Inventory: observed pieces that are in the scene.
  const observed = recon.objects.filter((o) => o.basis === 'OBSERVED');
  const placed = new Set(state.objects.map((o) => o.provenance?.ref).filter(Boolean));
  const covered = observed.filter((o) => placed.has(o.key)).length;
  const coverage = observed.length ? covered / observed.length : 1;
  d.push({ name: 'inventory', value: `${covered}/${observed.length} observed pieces placed`, gate: coverage >= 0.95 ? 'PASS' : coverage >= 0.85 ? 'WARN' : 'FAIL', note: build.unplaced.length ? `left out: ${build.unplaced.map((u) => u.key).join(', ')}` : '' });
  // Placement: how far pieces had to move from where they were seen.
  const moved = build.placed.map((p) => p.moved).sort((a, b) => a - b);
  const median = moved.length ? moved[Math.floor(moved.length / 2)] : 0;
  const far = moved.filter((m) => m > 0.6).length;
  d.push({ name: 'placement', value: `median shift ${median} m, ${far} over 0.6 m`, gate: median <= 0.25 && far <= 2 ? 'PASS' : median <= 0.5 ? 'WARN' : 'FAIL', note: 'shift from the traced position to a legal one' });
  // Scale and colour: drawn at the seen size and colour.
  const shaped = state.objects.filter((o) => o.shape).length;
  d.push({ name: 'scale', value: `${shaped}/${state.objects.length} at the seen size`, gate: shaped === state.objects.length ? 'PASS' : 'WARN', note: 'catalogue models are scaled within bounds' });
  const coloured = state.objects.filter((o) => o.colorOverride || o.shape?.secondary).length;
  d.push({ name: 'colour', value: `${coloured}/${state.objects.length} wear a seen colour`, gate: coloured >= state.objects.length * 0.8 ? 'PASS' : 'WARN', note: '' });
  d.push({ name: 'camera', value: recon.cameras.some((c) => c.fit) ? 'picture camera fitted' : 'estimated', gate: recon.cameras.some((c) => c.fit) ? 'PASS' : 'WARN', note: '' });
  const surfaces = Object.values(state.surfaces);
  const textured = surfaces.filter((s) => s.materialId && s.tint).length;
  d.push({ name: 'surfaces', value: `${surfaces.length} dressed, ${textured} with a catalogue texture balanced to the picture`, gate: surfaces.length ? 'PASS' : 'WARN', note: '' });
  if (qa) {
    const high = qa.errors.filter((e) => e.severity === 'HIGH').length;
    d.push({ name: 'visual check', value: `overall ${qa.scores.overall}/10 (layout ${qa.scores.layout}, furniture ${qa.scores.furniture}, materials ${qa.scores.materials}, lighting ${qa.scores.lighting}); ${high} serious differences left`, gate: qa.scores.overall >= 7.5 && high === 0 ? 'PASS' : qa.scores.overall >= 6 ? 'WARN' : 'FAIL', note: 'vision model, source vs render from the same camera' });
  } else d.push({ name: 'visual check', value: 'not run', gate: 'UNKNOWN', note: '' });
  // High-impact pieces that were not built from the picture, by name.
  const unresolved = decisions
    .filter((x) => x.impact >= 0.6 && (x.route === 'APPROXIMATE' || (x.route === 'GENERATE' && !input.generatedOk.has(x.group ?? x.key))))
    .map((x) => ({ key: x.key, type: x.type, why: x.route === 'GENERATE' ? 'generation failed: drawn by HOMATCH' : x.reason }));
  d.push({ name: 'high-impact pieces', value: unresolved.length ? `${unresolved.length} approximate` : 'all built from the picture or matched', gate: unresolved.length === 0 ? 'PASS' : unresolved.length <= 2 ? 'WARN' : 'FAIL', note: unresolved.map((u) => u.key).join(', ') });
  const routes = { CATALOGUE: 0, PARAMETRIC: 0, GENERATE: 0, APPROXIMATE: 0 };
  for (const x of decisions) routes[x.route] += 1;
  return { dimensions: d, unresolvedHighImpact: unresolved, routes, verdict: worst(d.map((x) => x.gate)) };
}
