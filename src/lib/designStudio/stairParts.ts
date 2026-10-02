// A FLIGHT OF STAIRS, AS PARTS.
//
// The geometry generator says where a flight is (StairMesh: the start edge
// a→b, the run to its left, the rise and the number of steps). This says what
// it is made of, as plain boxes in the flight's own frame, so the walkthrough
// (three.js) and the Blender factory (worker/factory/arch.py, the same rules
// in Python) build the same staircase:
//
//   TREAD     a board on every step, its nosing proud of the riser below
//   RISER     the upright between treads
//   STRINGER  the sloped board each side carries the steps on
//   RAIL      the handrail, 0.9 m above the nosing line (on every open side;
//             on the wall when both sides are walled)
//   BALUSTER  one per step under an open side's rail
//   POST      a newel at each end of an open side's rail
//   GUARD     a DOWN flight's balustrade round its well, at floor level
//   WELL      the lining round the hole a flight passes through (ceiling for
//             UP, floor for DOWN), so a cut-away never shows a void
//
// THE FRAME. u runs along a→b (0..width), v up the run, to the left of a→b
// (0..runM), h is height above the floor. A part is a box centred at
// (u, v, h) with sizes (su, sv, sh), pitched by `pitch` radians about the u
// axis (positive: rising with v). Plan point = a + along·u + climb·v.
//
// Pure: no three.js, no DOM.

import type { StairMesh } from '../floorplan/geometry.ts';

export type StairPartKind = 'TREAD' | 'RISER' | 'STRINGER' | 'RAIL' | 'BALUSTER' | 'POST' | 'GUARD' | 'WELL';

export interface StairPart {
  kind: StairPartKind;
  centre: [number, number, number];
  size: [number, number, number];
  pitch: number;
}

export const STAIR_DIMS = {
  treadT: 0.04, nosing: 0.03, riserT: 0.02, stringerT: 0.05, stringerD: 0.28,
  railH: 0.9, railT: 0.05, balusterT: 0.025, postT: 0.08, guardH: 1.0, wellT: 0.05, wellH: 0.3,
} as const;

export interface StairSides {
  /** The side at u = 0 (through a) has no wall along it. */
  openA: boolean;
  /** The side at u = width (through b). */
  openB: boolean;
}

interface Seg { start: { x: number; y: number }; end: { x: number; y: number }; thicknessM: number }

function segDist(p: { x: number; y: number }, s: Seg): number {
  const dx = s.end.x - s.start.x;
  const dy = s.end.y - s.start.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - s.start.x) * dx + (p.y - s.start.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (s.start.x + t * dx), p.y - (s.start.y + t * dy));
}

/**
 * Which long sides of a flight are open (no wall along them). A side is
 * walled when its quarter, middle and three-quarter points all lie within
 * half a wall's thickness plus 0.15 m of one wall.
 */
export function stairSides(st: Pick<StairMesh, 'a' | 'b' | 'runM'>, walls: Seg[]): StairSides {
  const dx = st.b.x - st.a.x;
  const dy = st.b.y - st.a.y;
  const w = Math.hypot(dx, dy) || 1;
  const climb = { x: -dy / w, y: dx / w };
  const walled = (o: { x: number; y: number }) => walls.some((s) => [0.25, 0.5, 0.75].every((f) => {
    const p = { x: o.x + climb.x * st.runM * f, y: o.y + climb.y * st.runM * f };
    return segDist(p, s) <= s.thicknessM / 2 + 0.15;
  }));
  return { openA: !walled(st.a), openB: !walled(st.b) };
}

const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** The parts of one flight, deterministic, in its own frame (see the header). */
export function stairParts(st: Pick<StairMesh, 'a' | 'b' | 'runM' | 'riseM' | 'treads' | 'direction'>, sides: StairSides): StairPart[] {
  const D = STAIR_DIMS;
  const width = Math.hypot(st.b.x - st.a.x, st.b.y - st.a.y);
  const n = Math.max(1, Math.round(st.treads));
  const run = st.runM;
  const rise = st.riseM;
  const g = run / n;
  const r = rise / n;
  const down = st.direction === 'DOWN';
  const parts: StairPart[] = [];
  // Built as an UP flight; a DOWN flight is the same flight seen from its top:
  // mirrored along the run and lowered by the rise, so its top step is level
  // with the floor at the start edge.
  const put = (kind: StairPartKind, u: number, v: number, h: number, su: number, sv: number, sh: number, pitch = 0) => {
    parts.push({
      kind,
      centre: [r4(u), r4(down ? run - v : v), r4(down ? h - rise : h)],
      size: [r4(su), r4(sv), r4(sh)],
      pitch: r4(down ? -pitch : pitch),
    });
  };
  const inner = Math.max(0.1, width - 2 * D.stringerT);
  for (let k = 1; k <= n; k += 1) {
    const v0 = (k - 1) * g;
    // The tread spans its going plus the nosing over the riser in front.
    put('TREAD', width / 2, v0 + g / 2 - D.nosing / 2, k * r - D.treadT / 2, inner, g + D.nosing, D.treadT);
    put('RISER', width / 2, v0 + D.riserT / 2, (k - 1) * r + (r - D.treadT) / 2, inner, D.riserT, Math.max(0.01, r - D.treadT));
  }
  const pitch = Math.atan2(rise, run);
  const slope = Math.hypot(run, rise);
  // Stringers: their top edge 5 cm over the nosing line h = r + v·r/g.
  const lineMid = r + rise / 2;
  const sCentre = lineMid + 0.05 - (D.stringerD / 2) / Math.cos(pitch);
  for (const u of [D.stringerT / 2, width - D.stringerT / 2]) put('STRINGER', u, run / 2, sCentre, D.stringerT, slope, D.stringerD, pitch);

  const railSides: number[] = [];
  if (sides.openA) railSides.push(D.stringerT / 2);
  if (sides.openB) railSides.push(width - D.stringerT / 2);
  const wallRail = railSides.length === 0;
  // Both sides walled: one rail on the wall at a's side, 6 cm off it.
  const rails = wallRail ? [0.06] : railSides;
  // An UP flight's rail stops where it would meet the ceiling (one storey is
  // built; what is above it is not); a DOWN flight's runs its whole length.
  const railTop = (v: number) => r + (v * r) / g + D.railH;
  const vEnd = down ? run : Math.max(g, Math.min(run, ((rise - 0.05 - D.railH - r) * g) / r));
  for (const u of rails) {
    put('RAIL', u, vEnd / 2, railTop(vEnd / 2), D.railT, (vEnd * slope) / run, D.railT, pitch);
    if (wallRail) continue;
    for (let k = 1; k <= n; k += 1) {
      const v = (k - 1) * g + g / 2;
      if (v > vEnd) break;
      const foot = k * r;
      put('BALUSTER', u, v, (railTop(v) + foot) / 2, D.balusterT, D.balusterT, railTop(v) - foot);
    }
    const postH = r + D.railH + 0.1;
    put('POST', u, D.postT / 2, postH / 2, D.postT, D.postT, postH);
    if (down) put('POST', u, run - D.postT / 2, rise + postH / 2, D.postT, D.postT, postH);
  }

  if (down) {
    // The well at floor level: a guard along each open side and the far end
    // (in the mirrored frame: v = 0 here is the far end once mirrored).
    // Each guard: a top rail and posts no more than 1 m apart.
    const guard = (u0: number, v0: number, u1: number, v1: number) => {
      const len = Math.hypot(u1 - u0, v1 - v0);
      const alongU = Math.abs(u1 - u0) >= Math.abs(v1 - v0);
      put('GUARD', (u0 + u1) / 2, (v0 + v1) / 2, rise + D.guardH - D.railT / 2, alongU ? len : D.railT, alongU ? D.railT : len, D.railT);
      const posts = Math.max(2, Math.ceil(len / 1.0) + 1);
      for (let i = 0; i < posts; i += 1) {
        const f = i / (posts - 1);
        put('GUARD', u0 + (u1 - u0) * f, v0 + (v1 - v0) * f, rise + (D.guardH - D.railT) / 2, D.balusterT * 1.6, D.balusterT * 1.6, D.guardH - D.railT);
      }
    };
    guard(0, 0, width, 0);
    if (sides.openA) guard(0, 0, 0, run);
    if (sides.openB) guard(width, 0, width, run);
    // Lining under the floor round the well.
    put('WELL', -D.wellT / 2, run / 2, rise / 2, D.wellT, run, rise);
    put('WELL', width + D.wellT / 2, run / 2, rise / 2, D.wellT, run, rise);
    put('WELL', width / 2, -D.wellT / 2, rise / 2, width + 2 * D.wellT, D.wellT, rise);
  } else {
    // The hole in the ceiling: lined on four sides and capped above.
    const h0 = rise + D.wellH / 2;
    put('WELL', -D.wellT / 2, run / 2, h0, D.wellT, run, D.wellH);
    put('WELL', width + D.wellT / 2, run / 2, h0, D.wellT, run, D.wellH);
    put('WELL', width / 2, -D.wellT / 2, h0, width + 2 * D.wellT, D.wellT, D.wellH);
    put('WELL', width / 2, run + D.wellT / 2, h0, width + 2 * D.wellT, D.wellT, D.wellH);
    put('WELL', width / 2, run / 2, rise + D.wellH + D.wellT / 2, width + 2 * D.wellT, run + 2 * D.wellT, D.wellT);
  }
  return parts;
}

/** A part's centre in plan metres and height: plan = a + along·u + climb·v. */
export function partToPlan(st: Pick<StairMesh, 'a' | 'b'>, p: StairPart): { x: number; y: number; h: number } {
  const dx = st.b.x - st.a.x;
  const dy = st.b.y - st.a.y;
  const w = Math.hypot(dx, dy) || 1;
  const along = { x: dx / w, y: dy / w };
  const climb = { x: -along.y, y: along.x };
  const [u, v, h] = p.centre;
  return { x: st.a.x + along.x * u + climb.x * v, y: st.a.y + along.y * u + climb.y * v, h };
}
