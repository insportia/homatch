// A READING OF A PICTURE, MADE BUILDABLE WITHOUT CHANGING WHAT IT SAYS.
//
// Two corrections between a reading (reconstructRead.ts, its pixels already unprojected through the picture's
// measured frame) and the walkable space built from it (inferredSpace.ts):
//
//   square      An orthographic frame measured from a picture that is not perfectly orthographic leaves the two
//               wall directions a few degrees off a right angle, so every room is a parallelogram and every wall
//               slants. The two directions the room edges agree on (by length) are mapped to the axes by one
//               affine map, applied to everything the reading holds — rooms, openings, pieces and their fronts —
//               so proportions along each wall are kept and nothing moves relative to anything else.
//   openings    A door in the reading is where the reader saw or inferred it; a piece is where its pixels put it.
//               When a piece stands in a door's keep-out (placement.ts doorKeepOut: the door's width plus 0.1 m,
//               0.9 m either side), the door slides along its own wall to the nearest clear place, and a wide glazed
//               opening onto a balcony keeps a clear sliding part with the rest as fixed floor-to-ceiling glazing.
//               The furniture the render shows is never moved for a door that was only placed approximately; a
//               door traced on the picture stays where it was seen.
//   fit         A door is a hole in the wall its rooms share: one read a few centimetres past the end of that wall
//               (into a partition meeting it) is moved along its wall, or narrowed, until it fits between the
//               partitions — the smallest change that makes it a door again.
//
// Every change is recorded. Pure (Deno + Node).

import type { ReconObject, ReconOpening, Reconstruction } from '../reconstructRead.ts';

type P = [number, number];
export interface ReadingRepair { code: 'SQUARED' | 'DOOR_FITTED' | 'DOOR_SLID' | 'DOOR_BLOCKED' | 'GLAZING_SPLIT'; element: string; detail: string }

const r3 = (n: number) => Math.round(n * 1000) / 1000;

// ── square ───────────────────────────────────────────────────────────────────

/** The two directions (radians, [0, π)) the room edges agree on, weighted by length; null when not two clear ones. */
export function dominantDirections(rooms: Array<{ polygon: P[] }>): [number, number] | null {
  const bins = new Float64Array(180);
  for (const r of rooms) {
    for (let i = 0; i < r.polygon.length; i += 1) {
      const a = r.polygon[i]; const b = r.polygon[(i + 1) % r.polygon.length];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (len < 0.2) continue;
      let deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
      deg = ((deg % 180) + 180) % 180;
      bins[Math.round(deg) % 180] += len;
    }
  }
  const smooth = (i: number) => { let s = 0; for (let d = -2; d <= 2; d += 1) s += bins[(i + d + 180) % 180] * (3 - Math.abs(d)); return s; };
  const sm = Array.from({ length: 180 }, (_, i) => smooth(i));
  const first = sm.indexOf(Math.max(...sm));
  let second = -1;
  for (let i = 0; i < 180; i += 1) {
    const d = Math.min(Math.abs(i - first), 180 - Math.abs(i - first));
    if (d >= 50 && (second < 0 || sm[i] > sm[second])) second = i;
  }
  if (second < 0 || sm[second] <= 0) return null;
  // Refine each to the length-weighted mean of the edges within 4° of it.
  const refine = (c: number) => {
    let s = 0; let w = 0;
    for (const r of rooms) {
      for (let i = 0; i < r.polygon.length; i += 1) {
        const a = r.polygon[i]; const b = r.polygon[(i + 1) % r.polygon.length];
        const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
        let deg = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI; deg = ((deg % 180) + 180) % 180;
        let off = deg - c; if (off > 90) off -= 180; if (off < -90) off += 180;
        if (Math.abs(off) <= 4) { s += off * len; w += len; }
      }
    }
    return ((c + (w ? s / w : 0)) * Math.PI) / 180;
  };
  return [refine(first), refine(second)];
}

/**
 * Map the reading so its two wall directions run along x and y exactly. The direction nearer the x axis becomes
 * x; lengths along both directions are kept. Returns the reading unchanged (and no repair) when it is already
 * square within half a degree, or when the directions are not plausibly a home's two (under 60° apart).
 */
export function squareReading(recon: Reconstruction): { recon: Reconstruction; repairs: ReadingRepair[] } {
  const dirs = dominantDirections(recon.rooms);
  if (!dirs) return { recon, repairs: [] };
  let [a, b] = dirs;
  // a: the one nearer the x axis.
  const nearX = (t: number) => Math.min(Math.abs(t), Math.abs(Math.PI - t));
  if (nearX(b) < nearX(a)) [a, b] = [b, a];
  const between = Math.abs(a - b) % Math.PI;
  const apart = Math.min(between, Math.PI - between);
  if (apart < (60 * Math.PI) / 180) return { recon, repairs: [] };
  // Unit vectors along each direction (a pointing +x, b pointing +y).
  let u: P = [Math.cos(a), Math.sin(a)]; if (u[0] < 0) u = [-u[0], -u[1]];
  let v: P = [Math.cos(b), Math.sin(b)]; if (v[1] < 0) v = [-v[0], -v[1]];
  const square = Math.abs(u[1]) < Math.sin(Math.PI / 360) && Math.abs(v[0]) < Math.sin(Math.PI / 360);
  if (square) return { recon, repairs: [] };
  // p = s·u + t·v  →  p' = (s, t): the inverse of [u v].
  const det = u[0] * v[1] - u[1] * v[0];
  const map = (p: P): P => [r3((v[1] * p[0] - v[0] * p[1]) / det), r3((-u[1] * p[0] + u[0] * p[1]) / det)];
  const turnFacing = (deg: number) => {
    // A front (clockwise from +y) is a direction: map it like a vector, then back to a bearing.
    const r = (deg * Math.PI) / 180; const d: P = [Math.sin(r), Math.cos(r)];
    const m: P = [(v[1] * d[0] - v[0] * d[1]) / det, (-u[1] * d[0] + u[0] * d[1]) / det];
    return Math.round((((Math.atan2(m[0], m[1]) * 180) / Math.PI) + 360) % 360);
  };
  const shearDeg = Math.round(((apart * 180) / Math.PI - 90) * 10) / 10;
  const turnDeg = Math.round(((Math.atan2(u[1], u[0]) * 180) / Math.PI) * 10) / 10;
  return {
    recon: {
      ...recon,
      rooms: recon.rooms.map((r) => ({ ...r, polygon: r.polygon.map(map) })),
      openings: recon.openings.map((o) => ({ ...o, at: map(o.at) })),
      objects: recon.objects.map((o) => ({ ...o, at: map(o.at), facingDeg: turnFacing(o.facingDeg) })),
    },
    repairs: [{ code: 'SQUARED', element: 'plan', detail: `walls ${shearDeg}° off square, turned ${turnDeg}°` }],
  };
}

// ── openings clear of the pieces ─────────────────────────────────────────────

/** Pieces that do not stand in anyone's way (flat on the floor, on a wall, overhead). */
const FLAT = new Set(['RUG', 'ARTWORK', 'CURTAIN', 'BLIND', 'TV']);
const KEEP_OUT_SIDE_M = 0.1;
const KEEP_OUT_DEPTH_M = 0.9;
const MIN_PASSAGE_M = 0.9;
/** A traced door's passage (build.ts seenIssues): its opening, half a metre either side; a frame's tolerance. */
const PASSAGE_DEPTH_M = 0.5;
const PASSAGE_TOLERANCE_M = 0.05;
/** How far a door traced on the picture may slide along its wall to clear a piece standing in its passage. */
const TRACED_SLIDE_M = 0.6;
const SLIDE_MARGIN_M = 0.1;

/** The room edge an opening sits on: the nearest edge within 0.6 m, as a segment. */
function edgeOf(o: ReconOpening, rooms: Reconstruction['rooms']): { a: P; b: P; len: number } | null {
  let best: { a: P; b: P; len: number; d: number } | null = null;
  for (const r of rooms) {
    for (let i = 0; i < r.polygon.length; i += 1) {
      const a = r.polygon[i]; const b = r.polygon[(i + 1) % r.polygon.length];
      const dx = b[0] - a[0]; const dy = b[1] - a[1]; const l2 = dx * dx + dy * dy;
      if (l2 < 0.04) continue;
      const t = Math.max(0, Math.min(1, ((o.at[0] - a[0]) * dx + (o.at[1] - a[1]) * dy) / l2));
      const d = Math.hypot(o.at[0] - a[0] - t * dx, o.at[1] - a[1] - t * dy);
      if (d <= 0.6 && (!best || d < best.d)) best = { a, b, len: Math.sqrt(l2), d };
    }
  }
  return best;
}

/** Where along the edge (metres from `a`) each standing piece blocks the door band. */
function blockedIntervals(edge: { a: P; b: P; len: number }, objects: ReconObject[], depth = KEEP_OUT_DEPTH_M): Array<[number, number]> {
  const ux = (edge.b[0] - edge.a[0]) / edge.len; const uy = (edge.b[1] - edge.a[1]) / edge.len;
  const out: Array<[number, number]> = [];
  for (const o of objects) {
    if (FLAT.has(o.type) || o.heightM < 0.05) continue;
    const r = (o.facingDeg * Math.PI) / 180;
    // The front is (sin r, cos r); width runs across it.
    const fx = Math.sin(r); const fy = Math.cos(r); const wx = fy; const wy = -fx;
    const corners: P[] = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => [
      o.at[0] + (i * o.widthM / 2) * wx + (j * o.depthM / 2) * fx, o.at[1] + (i * o.widthM / 2) * wy + (j * o.depthM / 2) * fy,
    ]);
    const along = corners.map((c) => (c[0] - edge.a[0]) * ux + (c[1] - edge.a[1]) * uy);
    const across = corners.map((c) => (c[0] - edge.a[0]) * -uy + (c[1] - edge.a[1]) * ux);
    if (Math.min(...across) > depth || Math.max(...across) < -depth) continue;
    const lo = Math.min(...along); const hi = Math.max(...along);
    if (hi < 0 || lo > edge.len) continue;
    out.push([lo, hi]);
  }
  return out.sort((x, y) => x[0] - y[0]);
}

const overlaps = (lo: number, hi: number, blocked: Array<[number, number]>) => blocked.some(([a, b]) => b > lo && a < hi);

/** The free stretches of [lo, hi] once the blocked intervals are taken out. */
function freeWithin(lo: number, hi: number, blocked: Array<[number, number]>): Array<[number, number]> {
  let free: Array<[number, number]> = [[lo, hi]];
  for (const [a, b] of blocked) free = free.flatMap(([x, y]): Array<[number, number]> => (b <= x || a >= y ? [[x, y]] : [[x, Math.min(y, a)], [Math.max(x, b), y]].filter(([p, q]) => q - p > 1e-6) as Array<[number, number]>));
  return free;
}

export function clearOpenings(recon: Reconstruction): { recon: Reconstruction; repairs: ReadingRepair[] } {
  const repairs: ReadingRepair[] = [];
  const openings: ReconOpening[] = [];
  for (const o of recon.openings) {
    if (o.kind === 'WINDOW') { openings.push(o); continue; }
    const edge = edgeOf(o, recon.rooms);
    if (!edge) { openings.push(o); continue; }
    const ux = (edge.b[0] - edge.a[0]) / edge.len; const uy = (edge.b[1] - edge.a[1]) / edge.len;
    const c = (o.at[0] - edge.a[0]) * ux + (o.at[1] - edge.a[1]) * uy;
    const pointAt0 = (s: number): P => [r3(edge.a[0] + ux * s), r3(edge.a[1] + uy * s)];
    if (o.geometry === 'PIXELS') {
      // An opening traced on the picture stands where it was seen, unless a piece the picture shows stands in its
      // very passage (the picture's own inconsistency): then it slides along its wall, at most TRACED_SLIDE_M, to
      // the nearest place the passage is clear. Its keep-out beyond the passage is the walk's to prove, not this.
      const passage = blockedIntervals(edge, recon.objects, PASSAGE_DEPTH_M);
      const ph = o.widthM / 2 - PASSAGE_TOLERANCE_M;
      if (o.kind !== 'DOOR' || !overlaps(c - ph, c + ph, passage)) { openings.push(o); continue; }
      let to: number | null = null;
      for (let step = 0.05; step <= TRACED_SLIDE_M + 1e-9 && to === null; step += 0.05) {
        for (const s of [c - step, c + step]) {
          if (s - o.widthM / 2 < 0.15 || s + o.widthM / 2 > edge.len - 0.15) continue;
          // Clear with a margin: the reading's centimetres move again when the pieces settle against their walls.
          if (!overlaps(s - ph - SLIDE_MARGIN_M, s + ph + SLIDE_MARGIN_M, passage)) { to = s; break; }
        }
      }
      if (to === null) { openings.push(o); repairs.push({ code: 'DOOR_BLOCKED', element: o.key, detail: 'a piece stands in its passage' }); continue; }
      openings.push({ ...o, at: pointAt0(to) });
      repairs.push({ code: 'DOOR_SLID', element: o.key, detail: `${r3(Math.abs(to - c))} m along its wall, its passage clear of the pieces` });
      continue;
    }
    const blocked = blockedIntervals(edge, recon.objects);
    const half = o.widthM / 2 + KEEP_OUT_SIDE_M;
    const pointAt = (s: number): P => [r3(edge.a[0] + ux * s), r3(edge.a[1] + uy * s)];
    if (!overlaps(c - half, c + half, blocked)) { openings.push(o); continue; }
    const wide = o.kind === 'BALCONY_DOOR' && o.widthM >= 1.6;
    if (wide) {
      // Keep a clear sliding part inside the glazed span; the rest is fixed glazing.
      const span = freeWithin(c - o.widthM / 2, c + o.widthM / 2, blocked.map(([a, b]) => [a - KEEP_OUT_SIDE_M, b + KEEP_OUT_SIDE_M] as [number, number]))
        .filter(([a, b]) => b - a >= MIN_PASSAGE_M).sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))[0];
      if (span) {
        const w = Math.min(span[1] - span[0], 1.6);
        const mid = (span[0] + span[1]) / 2;
        openings.push({ ...o, at: pointAt(mid), widthM: r3(w) });
        openings.push({ ...o, key: `${o.key}g`, kind: 'WINDOW', widthM: r3(o.widthM), sillM: 0, at: o.at });
        repairs.push({ code: 'GLAZING_SPLIT', element: o.key, detail: `sliding ${r3(w)} m clear of the pieces, the rest fixed glazing` });
        continue;
      }
    }
    // Slide along its own wall (kept 0.15 m off the corners) to the nearest clear place.
    let best: number | null = null;
    for (let step = 0.05; step <= edge.len; step += 0.05) {
      for (const s of [c - step, c + step]) {
        if (s - o.widthM / 2 < 0.15 || s + o.widthM / 2 > edge.len - 0.15) continue;
        if (!overlaps(s - half, s + half, blocked)) { best = s; break; }
      }
      if (best !== null) break;
    }
    if (best === null) { openings.push(o); repairs.push({ code: 'DOOR_BLOCKED', element: o.key, detail: 'no clear place on its wall' }); continue; }
    if (wide) openings.push({ ...o, key: `${o.key}g`, kind: 'WINDOW', sillM: 0 });
    openings.push({ ...o, at: pointAt(best), widthM: wide ? r3(Math.min(o.widthM, 1.2)) : o.widthM });
    repairs.push({ code: 'DOOR_SLID', element: o.key, detail: `${r3(Math.abs(best - c))} m along its wall, clear of the pieces` });
  }
  return { recon: { ...recon, openings }, repairs };
}

// ── openings fitted to their wall ────────────────────────────────────────────

const FIT_REACH_M = 0.45; // as inferredSpace links a door to the rooms whose outline is this close
const FIT_MARGIN_M = 0.1; // half a partition plus a frame
const MIN_DOOR_M = 0.7;

/**
 * Each door between rooms (or onto the outside) inside the stretch of wall its rooms share: the room edges near it
 * that run along it are intersected, and the door is moved along that line, or narrowed when the stretch is short,
 * until it clears the partitions at both ends.
 */
export function fitOpenings(recon: Reconstruction): { recon: Reconstruction; repairs: ReadingRepair[] } {
  const repairs: ReadingRepair[] = [];
  const openings = recon.openings.map((o) => {
    if (o.kind === 'WINDOW') return o;
    const edges: Array<{ a: P; b: P }> = [];
    for (const r of recon.rooms) {
      let best: { a: P; b: P; d: number } | null = null;
      for (let i = 0; i < r.polygon.length; i += 1) {
        const a = r.polygon[i]; const b = r.polygon[(i + 1) % r.polygon.length];
        const dx = b[0] - a[0]; const dy = b[1] - a[1]; const l2 = dx * dx + dy * dy;
        if (l2 < 0.04) continue;
        const t = Math.max(0, Math.min(1, ((o.at[0] - a[0]) * dx + (o.at[1] - a[1]) * dy) / l2));
        const d = Math.hypot(o.at[0] - a[0] - t * dx, o.at[1] - a[1] - t * dy);
        if (d <= FIT_REACH_M && (!best || d < best.d)) best = { a, b, d };
      }
      if (best) edges.push(best);
    }
    if (!edges.length) return o;
    const e0 = edges.sort((x, y) => Math.hypot(x.a[0] - x.b[0], x.a[1] - x.b[1]) - Math.hypot(y.a[0] - y.b[0], y.a[1] - y.b[1]))[0];
    const len0 = Math.hypot(e0.b[0] - e0.a[0], e0.b[1] - e0.a[1]);
    const ux = (e0.b[0] - e0.a[0]) / len0; const uy = (e0.b[1] - e0.a[1]) / len0;
    let lo = -Infinity; let hi = Infinity;
    for (const e of edges) {
      const ex = e.b[0] - e.a[0]; const ey = e.b[1] - e.a[1]; const l = Math.hypot(ex, ey);
      if (Math.abs((ex * ux + ey * uy) / l) < 0.9) continue; // a wall meeting this one, not along it
      const s = [e.a, e.b].map((p) => (p[0] - o.at[0]) * ux + (p[1] - o.at[1]) * uy);
      lo = Math.max(lo, Math.min(...s)); hi = Math.min(hi, Math.max(...s));
    }
    if (!(hi > lo)) return o;
    const room = hi - lo - 2 * FIT_MARGIN_M;
    if (room < MIN_DOOR_M) return o;
    const w = Math.min(o.widthM, room);
    const c = Math.max(lo + FIT_MARGIN_M + w / 2, Math.min(hi - FIT_MARGIN_M - w / 2, 0));
    if (Math.abs(c) < 0.01 && w === o.widthM) return o;
    repairs.push({ code: 'DOOR_FITTED', element: o.key, detail: `${r3(Math.abs(c))} m along its wall${w < o.widthM ? `, ${r3(w)} m wide` : ''}, clear of the partitions` });
    return { ...o, at: [r3(o.at[0] + c * ux), r3(o.at[1] + c * uy)] as P, widthM: r3(w) };
  });
  return { recon: { ...recon, openings }, repairs };
}

/** The corrections, in order (squaring first: doors are fitted and their bands measured along square walls). */
export function repairReading(recon: Reconstruction): { recon: Reconstruction; repairs: ReadingRepair[] } {
  const a = squareReading(recon);
  const f = fitOpenings(a.recon);
  const b = clearOpenings(f.recon);
  return { recon: b.recon, repairs: [...a.repairs, ...f.repairs, ...b.repairs] };
}
