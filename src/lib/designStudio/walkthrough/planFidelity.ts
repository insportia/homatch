// HOMATCH Design Studio — does the 3D home say what the floor plan says?
//
// The uploaded floor plan is the single source of truth for walls, openings,
// rooms and stairs; nothing downstream may move them (build.ts never touches
// the plan). What CAN be wrong is the reading of the drawing itself, and some
// of that is measurable without another paid call:
//
//   · OPENING_OUTSIDE_WALL — an opening runs past the end of its wall;
//   · DOOR_HITS_WALL       — a doorway is crossed by another wall (a partition
//                            meeting it), so part of it cannot be walked;
//   · STAIR_ENCLOSED       — a flight with no open side toward any room;
//   · WALL_WEAK_EVIDENCE   — a wall the drawing's ink barely supports (the
//                            reading's own fusion evidence, below WEAK_INK);
//   · DIMENSION_MISMATCH   — a room whose written dimensions disagree with its
//                            measured size by more than DIMENSION_TOLERANCE.
//
// BLOCK findings stop a tour (the 3D would contradict the plan); WARN findings
// are reported as ambiguities — never "fixed" by inventing or removing walls.
//
// Pure and dependency-free (Deno + Node + browser).

import type { GeneratedScene as FloorplanScene } from '../../floorplan/geometry.ts';
import type { Point } from '../space.ts';

export type PlanFindingCode = 'OPENING_OUTSIDE_WALL' | 'DOOR_HITS_WALL' | 'STAIR_ENCLOSED' | 'WALL_WEAK_EVIDENCE' | 'DIMENSION_MISMATCH';
export interface PlanFinding { code: PlanFindingCode; severity: 'BLOCK' | 'WARN'; elementIds: string[]; detail: string }

/** A wall the drawing's ink supports less than this (0–1, the reading's fusion evidence) is uncertain. */
export const WEAK_INK = 0.5;
/** Written room dimensions may differ from the measured room by this share before it is a finding. */
export const DIMENSION_TOLERANCE = 0.15;
const EPS = 0.03;

type Seg = { id: string; a: Point; b: Point; t: number };
const segOf = (w: FloorplanScene['walls'][number]): Seg => ({ id: w.id, a: w.start, b: w.end, t: w.thicknessM });

function distPointSeg(p: Point, s: Seg): number {
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y; const L2 = dx * dx + dy * dy || 1;
  const u = Math.max(0, Math.min(1, ((p.x - s.a.x) * dx + (p.y - s.a.y) * dy) / L2));
  return Math.hypot(p.x - (s.a.x + dx * u), p.y - (s.a.y + dy * u));
}

export function planFidelity(
  scene: FloorplanScene,
  evidence: { wallInk?: Record<string, number> | null; dimensionChecks?: Array<{ elementId: string; residualPct: number; used?: boolean; text?: string }> | null } = {},
): PlanFinding[] {
  const out: PlanFinding[] = [];
  const walls = scene.walls.map(segOf);
  for (const w of scene.walls) {
    const L = Math.hypot(w.end.x - w.start.x, w.end.y - w.start.y);
    const dir = { x: (w.end.x - w.start.x) / (L || 1), y: (w.end.y - w.start.y) / (L || 1) };
    for (const o of w.openings) {
      const from = o.offsetM - o.widthM / 2, to = o.offsetM + o.widthM / 2;
      if (from < -EPS || to > L + EPS) {
        out.push({ code: 'OPENING_OUTSIDE_WALL', severity: 'BLOCK', elementIds: [o.id, w.id], detail: `${o.id} spans ${from.toFixed(2)}–${to.toFixed(2)} m of a ${L.toFixed(2)} m wall` });
      }
      if (o.kind !== 'DOOR') continue;
      // Another wall crossing the doorway's clear width (its end inside the opening, beyond a frame's slack).
      for (const other of walls) {
        if (other.id === w.id) continue;
        for (const end of [other.a, other.b]) {
          const rel = { x: end.x - w.start.x, y: end.y - w.start.y };
          const u = rel.x * dir.x + rel.y * dir.y;
          const off = Math.abs(rel.x * dir.y - rel.y * dir.x);
          if (off <= w.thicknessM / 2 + other.t / 2 + EPS && u > from + other.t / 2 + 0.05 && u < to - other.t / 2 - 0.05) {
            out.push({ code: 'DOOR_HITS_WALL', severity: 'BLOCK', elementIds: [o.id, other.id], detail: `${other.id} meets ${w.id} inside doorway ${o.id}` });
          }
        }
      }
    }
  }
  // A flight with every side against a wall (beyond its start edge's reach) cannot be reached from any room.
  for (const st of scene.stairs ?? []) {
    const poly = st.polygon;
    let open = 0;
    for (let i = 0; i < poly.length; i += 1) {
      const p = poly[i], q = poly[(i + 1) % poly.length];
      const samples = [0.2, 0.5, 0.8].map((k) => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k }));
      const walled = samples.every((m) => walls.some((s) => distPointSeg(m, s) <= s.t / 2 + 0.12));
      if (!walled) open += 1;
    }
    if (!open) out.push({ code: 'STAIR_ENCLOSED', severity: 'WARN', elementIds: [st.id], detail: `${st.id} is walled on every side: either the drawing hides its opening or a wall around it is misread` });
  }
  for (const [id, ink] of Object.entries(evidence.wallInk ?? {})) {
    if (ink < WEAK_INK && scene.walls.some((w) => w.id === id)) out.push({ code: 'WALL_WEAK_EVIDENCE', severity: 'WARN', elementIds: [id], detail: `${id} is supported by ${(ink * 100).toFixed(0)}% of its drawn ink` });
  }
  for (const c of evidence.dimensionChecks ?? []) {
    if (c.residualPct / 100 > DIMENSION_TOLERANCE) out.push({ code: 'DIMENSION_MISMATCH', severity: 'WARN', elementIds: [c.elementId], detail: `${c.text ?? ''} differs from the measured room by ${c.residualPct.toFixed(1)}%` });
  }
  return out;
}
