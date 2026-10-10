// A WALKABLE SPACE FOR A DESIGN THAT HAS NO FLOOR PLAN (best effort, never shown as fact).
//
// A design made from photos, renders or screenshots has no measured plan, yet
// its 3D walkthrough needs walls, doors and rooms. HOMATCH's reconstruction
// reader (reconstructRead.ts — the same reader, schema and plan document the
// photo reconstruction uses) reads the project's own pictures and generated
// designs into rooms and openings, each OBSERVED or INFERRED with a
// confidence. This file completes that reading into a scene a person can walk:
//
//   complete   rooms that duplicate one another are merged away, a room a
//              short gap from the rest is moved to touch it, every room is
//              reached through a door (inferred where none was read), the
//              home has an entrance, doors are wide enough to pass, a missing
//              ceiling height is the typical one
//   build      the standard plan document → the shared deterministic
//              generator (buildCanonical), exactly like a drawn plan
//   validate   on the built scene: a body walking from the entrance reaches
//              every indoor room (reachableRooms); a room it cannot reach gets
//              a door to a reached neighbour and the scene is built again
//   spawn      a free standing point inside the walkable space
//
// Everything inferred stays inferred: the elements keep their confidence and
// basis, the source is ESTIMATED, and nothing here is written anywhere but the
// Design Studio walkthrough's own source. Pure (Deno + Node).

import { planDocument, PX_PER_M, type ReconOpening, type ReconRoom, type Reconstruction } from '../reconstructRead.ts';
import { buildCanonical, calibrate, estimateScale } from '../scale.ts';
import { buildSpaceModel, pointInPolygon, type SpaceModel } from '../space.ts';
import { buildWalkModel, isFree, nearestFree, type WalkModel } from '../navigation.ts';
import { circulationStart, reachableRooms } from './build.ts';
import type { CanonicalSpace } from '../types.ts';

type P = [number, number];

/** What a walk needs, added to the reconstruction reader's own instructions (server-internal; never shown). */
export const WALK_SPACE_BRIEF = `PURPOSE OF THIS READING: a navigable 3D walkthrough of this home, built even where the pictures do not show everything.
- The first pictures are the customer's own SOURCE pictures: the architecture (walls, rooms, doors, windows, balcony) comes primarily from them. The later pictures are GENERATED DESIGNS of the same home: use them for what they show of the layout, surfaces and furniture; where they disagree with the source about architecture, the source wins.
- Combine every picture into ONE home: the same wall, door or window seen twice is one element (more confident), never two.
- Return EVERY room the pictures show or clearly imply, each a closed outline that shares its walls exactly with its neighbours (no gaps, no overlaps), plus the floor between them (a hall or corridor) when the home needs it to connect.
- Every room must be reachable: give the door or opening between connected rooms, and the entrance door of the home, even when it is only implied (basis INFERRED, lower confidence). Doors are at least 0.8 m wide.
- Where a wall, a room boundary or a size cannot be seen, infer the most conservative plausible value from perspective, visible edges, ordinary objects (doors ~2.1 m high, beds ~2 m long, worktops ~0.9 m high) and ordinary apartment layouts, and mark it INFERRED with an honest confidence. Never mark a guess OBSERVED.
- Give the ceiling height when it can be judged; otherwise leave it null.`;

export type Basis = 'OBSERVED' | 'INFERRED_HIGH' | 'INFERRED_MEDIUM' | 'INFERRED_LOW';
/** The four-level basis an element carries internally. */
export const basisOf = (basis: 'OBSERVED' | 'INFERRED', confidence: number): Basis =>
  (basis === 'OBSERVED' ? 'OBSERVED' : confidence >= 0.7 ? 'INFERRED_HIGH' : confidence >= 0.45 ? 'INFERRED_MEDIUM' : 'INFERRED_LOW');

export interface Repair { code: 'DUPLICATE_ROOM_REMOVED' | 'ROOM_CARVED' | 'ROOM_MERGED_INTO_OPEN_PLAN' | 'ROOM_MOVED_TO_TOUCH' | 'DOOR_INFERRED' | 'ENTRANCE_INFERRED' | 'DOOR_WIDENED' | 'CEILING_TYPICAL' | 'RECTANGLES_USED' | 'ROOM_UNREACHABLE'; element: string }

const TYPICAL_CEILING_M = 2.7;
const MIN_DOOR_M = 0.8;
const TOUCH_TOL = 0.25;
const MIN_SHARED_M = 0.9;
/** A room is moved to touch only across a wall's own thickness (rooms read on the two faces of one wall). A wider
 *  gap is a fact of the reading, never closed by moving a wall: the room stays where it was read, and an
 *  unreached room is reported (geometryCheck.ts), not made reachable. */
export const WALL_GAP_M = 0.35;
const MAX_MOVE_M = WALL_GAP_M;
const r2 = (n: number) => Math.round(n * 100) / 100;

function area(poly: P[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i += 1) { const a = poly[i]; const b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}
function bbox(poly: P[]) {
  const xs = poly.map((p) => p[0]); const ys = poly.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
const centroid = (poly: P[]): P => { const b = bbox(poly); return [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]; };
const edgesOf = (poly: P[]): Array<[P, P]> => poly.map((p, i) => [p, poly[(i + 1) % poly.length]]);

/** Where two rooms share a wall: segments on A's edges that B's edges run along (parallel, within tolerance). */
export function sharedSegments(a: P[], b: P[], tol = TOUCH_TOL): Array<{ from: P; to: P; len: number }> {
  const out: Array<{ from: P; to: P; len: number }> = [];
  for (const [p, q] of edgesOf(a)) {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L < 1e-6) continue;
    const ux = (q[0] - p[0]) / L; const uy = (q[1] - p[1]) / L;
    for (const [s, t] of edgesOf(b)) {
      const M = Math.hypot(t[0] - s[0], t[1] - s[1]);
      if (M < 1e-6) continue;
      if (Math.abs(ux * (t[1] - s[1]) / M - uy * (t[0] - s[0]) / M) > 0.05) continue; // not parallel
      const dist = (r: P) => Math.abs((r[0] - p[0]) * uy - (r[1] - p[1]) * ux);
      if (dist(s) > tol || dist(t) > tol) continue;
      const proj = (r: P) => (r[0] - p[0]) * ux + (r[1] - p[1]) * uy;
      const lo = Math.max(0, Math.min(proj(s), proj(t))); const hi = Math.min(L, Math.max(proj(s), proj(t)));
      if (hi - lo <= 0.05) continue;
      out.push({ from: [p[0] + ux * lo, p[1] + uy * lo], to: [p[0] + ux * hi, p[1] + uy * hi], len: hi - lo });
    }
  }
  return out.sort((x, y) => y.len - x.len);
}

function inside(pt: P, poly: P[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]; const b = poly[j];
    if ((a[1] > pt[1]) !== (b[1] > pt[1]) && pt[0] < ((b[0] - a[0]) * (pt[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}

/** The share of polygon a's floor that lies inside polygon b (sampled on a 10 cm grid). */
function sharedFloor(a: P[], b: P[]): number {
  const box = bbox(a); let n = 0; let hit = 0;
  for (let x = box.minX + 0.05; x < box.maxX; x += 0.1) {
    for (let y = box.minY + 0.05; y < box.maxY; y += 0.1) {
      if (!inside([x, y], a)) continue;
      n += 1; if (inside([x, y], b)) hit += 1;
    }
  }
  return n ? hit / n : 0;
}

/** Distance from a point to a polygon's outline. */
function toOutline(pt: P, poly: P[]): number {
  let best = Infinity;
  for (const [p, q] of edgesOf(poly)) {
    const dx = q[0] - p[0]; const dy = q[1] - p[1]; const L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((pt[0] - p[0]) * dx + (pt[1] - p[1]) * dy) / L2));
    best = Math.min(best, Math.hypot(pt[0] - (p[0] + t * dx), pt[1] - (p[1] + t * dy)));
  }
  return best;
}

/** The rooms each door joins (two rooms), or the outside (one room: the door is on its exterior wall). */
function doorLinks(rooms: ReconRoom[], openings: ReconOpening[]): { links: Array<[string, string]>; entrances: string[] } {
  const links: Array<[string, string]> = []; const entrances: string[] = [];
  for (const o of openings) {
    if (o.kind === 'WINDOW') continue;
    const near = rooms.filter((r) => toOutline(o.at, r.polygon) <= 0.45).map((r) => r.key);
    if (near.length >= 2) links.push([near[0], near[1]]);
    else if (near.length === 1 && o.kind === 'DOOR') entrances.push(near[0]);
  }
  return { links, entrances };
}

function reachFrom(start: string, links: Array<[string, string]>): Set<string> {
  const seen = new Set([start]); let grew = true;
  while (grew) {
    grew = false;
    for (const [a, b] of links) {
      if (seen.has(a) && !seen.has(b)) { seen.add(b); grew = true; }
      if (seen.has(b) && !seen.has(a)) { seen.add(a); grew = true; }
    }
  }
  return seen;
}

/** The room a walk starts in: the one with the entrance, else a hall or corridor, else the largest indoor room. */
function startRoom(rooms: ReconRoom[], entrances: string[]): ReconRoom {
  const indoor = rooms.filter((r) => !r.outdoor);
  return indoor.find((r) => entrances.includes(r.key))
    ?? indoor.find((r) => r.kind === 'HALL' || r.kind === 'CORRIDOR')
    ?? [...indoor].sort((a, b) => area(b.polygon) - area(a.polygon))[0];
}

/** A door between two touching rooms, on their longest shared wall (INFERRED). */
function inferDoor(a: ReconRoom, b: ReconRoom, n: number): ReconOpening | null {
  const seg = sharedSegments(a.polygon, b.polygon)[0];
  if (!seg || seg.len < MIN_SHARED_M) return null;
  const outdoor = a.outdoor || b.outdoor;
  return {
    key: `inferred-door-${n}`, kind: outdoor ? 'BALCONY_DOOR' : 'DOOR', at: [r2((seg.from[0] + seg.to[0]) / 2), r2((seg.from[1] + seg.to[1]) / 2)],
    widthM: r2(Math.min(outdoor ? 1.2 : 0.9, seg.len - 0.2)), heightM: outdoor ? 2.3 : 2.1, sillM: 0, confidence: 0.35, basis: 'INFERRED',
  };
}

/** The longest stretch of a room's outline that no other room shares (its exterior wall), as a midpoint. */
function exteriorPoint(room: ReconRoom, rooms: ReconRoom[]): P | null {
  let best: { at: P; len: number } | null = null;
  for (const [p, q] of edgesOf(room.polygon)) {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (L < MIN_SHARED_M + 0.2) continue;
    const covered = rooms.filter((o) => o.key !== room.key).flatMap((o) => sharedSegments([p, q, q], o.polygon));
    const ux = (q[0] - p[0]) / L; const uy = (q[1] - p[1]) / L;
    const spans = covered.map((s) => [(s.from[0] - p[0]) * ux + (s.from[1] - p[1]) * uy, (s.to[0] - p[0]) * ux + (s.to[1] - p[1]) * uy].sort((x, y) => x - y)).sort((x, y) => x[0] - y[0]);
    let cursor = 0;
    for (const [lo, hi] of [...spans, [L, L]]) {
      if (lo - cursor >= MIN_SHARED_M + 0.2 && (!best || lo - cursor > best.len)) {
        const mid = (cursor + lo) / 2;
        best = { at: [r2(p[0] + ux * mid), r2(p[1] + uy * mid)], len: lo - cursor };
      }
      cursor = Math.max(cursor, hi);
    }
  }
  return best?.at ?? null;
}

// ── Rooms inside rooms ───────────────────────────────────────────────────────

/** The share of a polygon's perimeter running along the axes (within 3°): 1 for a square-walled room. */
export function axisShare(poly: P[]): number {
  let on = 0; let all = 0;
  for (const [p, q] of edgesOf(poly)) {
    const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
    all += L;
    const deg = Math.abs((Math.atan2(q[1] - p[1], q[0] - p[0]) * 180) / Math.PI) % 90;
    if (Math.min(deg, 90 - deg) <= 3) on += L;
  }
  return all ? on / all : 0;
}

/**
 * `outer` minus the `holes`, exactly, for square-walled outlines: the plane is cut on every vertex coordinate
 * (a compressed grid), each cell kept when its centre is in `outer` and in none of the holes, and the largest
 * connected piece's boundary traced (collinear corners dropped). Null when the result is not one simple outline
 * of the same room (a hole floating inside, nothing left, or the outlines not square).
 */
export function subtractSquare(outer: P[], holes: P[][]): P[] | null {
  if ([outer, ...holes].some((p) => axisShare(p) < 0.98)) return null;
  const snap = (v: number) => Math.round(v * 1000) / 1000;
  const xs = [...new Set([outer, ...holes].flatMap((p) => p.map((q) => snap(q[0]))))].sort((a, b) => a - b);
  const ys = [...new Set([outer, ...holes].flatMap((p) => p.map((q) => snap(q[1]))))].sort((a, b) => a - b);
  const nx = xs.length - 1; const ny = ys.length - 1;
  if (nx < 1 || ny < 1) return null;
  const cell = new Uint8Array(nx * ny);
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const c: P = [(xs[i] + xs[i + 1]) / 2, (ys[j] + ys[j + 1]) / 2];
      if (inside(c, outer) && !holes.some((h) => inside(c, h))) cell[j * nx + i] = 1;
    }
  }
  // The largest connected piece (by area).
  const comp = new Int32Array(nx * ny).fill(-1);
  let best = -1; let bestArea = 0; let id = 0;
  for (let s = 0; s < cell.length; s += 1) {
    if (!cell[s] || comp[s] >= 0) continue;
    const stack = [s]; comp[s] = id; let a = 0;
    while (stack.length) {
      const k = stack.pop()!; const i = k % nx; const j = Math.floor(k / nx);
      a += (xs[i + 1] - xs[i]) * (ys[j + 1] - ys[j]);
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const u = i + di; const v = j + dj; const n = v * nx + u;
        if (u >= 0 && v >= 0 && u < nx && v < ny && cell[n] && comp[n] < 0) { comp[n] = id; stack.push(n); }
      }
    }
    if (a > bestArea) { bestArea = a; best = id; }
    id += 1;
  }
  if (best < 0) return null;
  const on = (i: number, j: number) => i >= 0 && j >= 0 && i < nx && j < ny && comp[j * nx + i] === best;
  // Boundary edges, counter-clockwise around the kept cells (grid-index corners).
  const next = new Map<string, Array<[number, number]>>();
  const add = (a: [number, number], b: [number, number]) => { const k = `${a[0]},${a[1]}`; next.set(k, [...(next.get(k) ?? []), b]); };
  let edges = 0;
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      if (!on(i, j)) continue;
      if (!on(i, j - 1)) { add([i, j], [i + 1, j]); edges += 1; }
      if (!on(i + 1, j)) { add([i + 1, j], [i + 1, j + 1]); edges += 1; }
      if (!on(i, j + 1)) { add([i + 1, j + 1], [i, j + 1]); edges += 1; }
      if (!on(i - 1, j)) { add([i, j + 1], [i, j]); edges += 1; }
    }
  }
  // One loop must use every boundary edge: anything else is a hole (a room floating inside this one).
  const startKey = [...next.keys()].sort()[0];
  const loop: Array<[number, number]> = [];
  let at = startKey.split(',').map(Number) as [number, number];
  for (let guard = 0; guard <= edges; guard += 1) {
    loop.push(at);
    const outs = next.get(`${at[0]},${at[1]}`);
    if (!outs?.length) return null;
    at = outs.shift()!;
    if (`${at[0]},${at[1]}` === startKey) break;
  }
  if (loop.length !== edges || [...next.values()].some((v) => v.length)) return null;
  const pts = loop.map(([i, j]) => [xs[i], ys[j]] as P);
  const simple = pts.filter((p, k) => {
    const a = pts[(k - 1 + pts.length) % pts.length]; const b = pts[(k + 1) % pts.length];
    return Math.abs((p[0] - a[0]) * (b[1] - p[1]) - (p[1] - a[1]) * (b[0] - p[0])) > 1e-9;
  });
  return simple.length >= 4 ? simple : null;
}

/** Each room lying inside a larger one is cut out of it (or, when it cannot be, is a zone of that open plan). */
function separateNested<R extends ReconRoom>(rooms: R[], repairs: Repair[]): R[] {
  let out = [...rooms];
  for (const host of [...rooms].sort((a, b) => area(b.polygon) - area(a.polygon))) {
    const current = out.find((r) => r.key === host.key);
    if (!current) continue;
    const nested = out.filter((r) => r.key !== host.key && area(r.polygon) < area(current.polygon) && r.outdoor === current.outdoor
      && sharedFloor(r.polygon, current.polygon) > 0.6);
    if (!nested.length) continue;
    const carved = subtractSquare(current.polygon, nested.map((r) => r.polygon));
    if (carved && area(carved) >= 0.25 * area(current.polygon)) {
      out = out.map((r) => (r.key === host.key ? { ...r, polygon: carved } : r));
      for (const r of nested) repairs.push({ code: 'ROOM_CARVED', element: `${host.key}−${r.key}` });
    } else {
      // Not separable: the open plan stays whole, and the zone read inside it is part of it.
      const gone = new Set(nested.map((r) => r.key));
      out = out.filter((r) => !gone.has(r.key));
      for (const r of nested) repairs.push({ code: 'ROOM_MERGED_INTO_OPEN_PLAN', element: `${r.key}→${host.key}` });
    }
  }
  return out;
}

/**
 * The deterministic completion pass on the reading (metres): what a walkable scene needs and the pictures did not
 * settle. Every repair is recorded; nothing is added that a walk does not need.
 */
export function completeForWalk(input: Reconstruction): { recon: Reconstruction; repairs: Repair[] } {
  const repairs: Repair[] = [];
  let rooms = input.rooms.map((r) => ({ ...r, polygon: r.polygon.map((p) => [p[0], p[1]] as P) }));
  let openings = input.openings.map((o) => ({ ...o }));

  // 1. A room read twice (two outlines over the same floor, each mostly the other): the less certain one goes.
  //    A room lying INSIDE a larger one (a hall drawn within an open-plan living's outline) is not a duplicate:
  //    the larger room is never deleted for it — the smaller is cut out of it (ROOM_CARVED), or, when it cannot
  //    be (it floats inside, or the outlines are not square), it is a zone of the open plan (ROOM_MERGED_INTO_OPEN_PLAN).
  const keep: typeof rooms = [];
  for (const r of [...rooms].sort((a, b) => b.confidence - a.confidence || area(b.polygon) - area(a.polygon))) {
    const dup = keep.find((k) => Math.min(sharedFloor(r.polygon, k.polygon), sharedFloor(k.polygon, r.polygon)) > 0.6);
    if (dup) repairs.push({ code: 'DUPLICATE_ROOM_REMOVED', element: r.key }); else keep.push(r);
  }
  rooms = rooms.filter((r) => keep.some((k) => k.key === r.key));
  rooms = separateNested(rooms, repairs);

  // 2. Doors wide enough to walk through.
  openings = openings.map((o) => {
    if (o.kind === 'WINDOW' || o.widthM >= MIN_DOOR_M) return o;
    repairs.push({ code: 'DOOR_WIDENED', element: o.key });
    return { ...o, widthM: MIN_DOOR_M };
  });

  // 3. Every room reached from the entrance: a door to a touching reached room; a room a short gap away is moved to touch.
  let n = 0;
  for (let round = 0; round < rooms.length + 2; round += 1) {
    const { links, entrances } = doorLinks(rooms, openings);
    const start = startRoom(rooms, entrances);
    if (!start) break;
    const reached = reachFrom(start.key, links);
    const missing = rooms.filter((r) => !reached.has(r.key));
    if (!missing.length) break;
    let changed = false;
    for (const r of missing) {
      const neighbour = rooms.filter((o) => reached.has(o.key) && (!r.outdoor || !o.outdoor))
        .map((o) => ({ o, seg: sharedSegments(r.polygon, o.polygon)[0] })).filter((x) => x.seg && x.seg.len >= MIN_SHARED_M)
        .sort((x, y) => Number(x.o.outdoor) - Number(y.o.outdoor) || y.seg!.len - x.seg!.len)[0];
      if (neighbour) {
        const door = inferDoor(r, neighbour.o, ++n);
        if (door) { openings.push(door); repairs.push({ code: 'DOOR_INFERRED', element: `${r.key}↔${neighbour.o.key}` }); changed = true; break; }
      }
      // A short gap from a reached room (a wall read a little off): moved to touch it, along one axis.
      const b = bbox(r.polygon);
      let move: P | null = null; let best = Infinity;
      for (const o of rooms.filter((x) => reached.has(x.key))) {
        const c = bbox(o.polygon);
        const overlapY = Math.min(b.maxY, c.maxY) - Math.max(b.minY, c.minY); const overlapX = Math.min(b.maxX, c.maxX) - Math.max(b.minX, c.minX);
        const gapR = c.minX - b.maxX; const gapL = b.minX - c.maxX; const gapD = c.minY - b.maxY; const gapU = b.minY - c.maxY;
        const options: Array<[number, P]> = [];
        if (overlapY >= MIN_SHARED_M) { if (gapR > 0 && gapR <= MAX_MOVE_M) options.push([gapR, [gapR, 0]]); if (gapL > 0 && gapL <= MAX_MOVE_M) options.push([gapL, [-gapL, 0]]); }
        if (overlapX >= MIN_SHARED_M) { if (gapD > 0 && gapD <= MAX_MOVE_M) options.push([gapD, [0, gapD]]); if (gapU > 0 && gapU <= MAX_MOVE_M) options.push([gapU, [0, -gapU]]); }
        for (const [d, v] of options) if (d < best) { best = d; move = v; }
      }
      if (move) {
        const [dx, dy] = move;
        rooms = rooms.map((x) => (x.key === r.key ? { ...x, polygon: x.polygon.map((p) => [r2(p[0] + dx), r2(p[1] + dy)] as P) } : x));
        repairs.push({ code: 'ROOM_MOVED_TO_TOUCH', element: r.key });
        changed = true; break;
      }
    }
    if (!changed) { for (const r of missing) repairs.push({ code: 'ROOM_UNREACHABLE', element: r.key }); break; }
  }

  // 4. An entrance: the home is entered somewhere.
  const { entrances } = doorLinks(rooms, openings);
  if (!entrances.length) {
    const start = startRoom(rooms, []);
    const at = start ? exteriorPoint(start, rooms) ?? rooms.filter((r) => !r.outdoor).map((r) => exteriorPoint(r, rooms)).find(Boolean) ?? null : null;
    if (at) {
      openings.push({ key: 'inferred-entrance', kind: 'DOOR', at, widthM: 0.9, heightM: 2.1, sillM: 0, confidence: 0.3, basis: 'INFERRED' });
      repairs.push({ code: 'ENTRANCE_INFERRED', element: start!.key });
    }
  }

  let ceilingHeightM = input.ceilingHeightM;
  if (ceilingHeightM == null || !(ceilingHeightM >= 2.2 && ceilingHeightM <= 4.5)) { ceilingHeightM = TYPICAL_CEILING_M; repairs.push({ code: 'CEILING_TYPICAL', element: 'ceiling' }); }
  return { recon: { ...input, rooms, openings, ceilingHeightM }, repairs };
}

/** Every room as its bounding rectangle (the fallback when an outline cannot be built). */
function asRectangles(recon: Reconstruction): Reconstruction {
  return {
    ...recon,
    rooms: recon.rooms.map((r) => { const b = bbox(r.polygon); return { ...r, polygon: [[b.minX, b.minY], [b.maxX, b.minY], [b.maxX, b.maxY], [b.minX, b.maxY]] as P[] }; }),
  };
}

/**
 * Where a visitor starts: the proposed point when it is free floor inside an indoor room (never in a wall or a
 * piece); otherwise the nearest free floor to it, else the free middle of the largest indoor room.
 */
export function validSpawn(space: SpaceModel, model: WalkModel, proposed: { x: number; y: number } | null): { x: number; y: number } | null {
  const indoor = space.rooms.filter((r) => !r.outdoor);
  const ok = (p: { x: number; y: number } | null) => !!p && isFree(model, p) && indoor.some((r) => pointInPolygon(p, r.polygon));
  if (ok(proposed)) return proposed;
  const near = proposed ? nearestFree(model, proposed, 1.5) : null;
  if (ok(near)) return near;
  for (const room of [...indoor].sort((a, b) => b.areaM2 - a.areaM2)) {
    const c = room.polygon.reduce((s, p) => ({ x: s.x + p.x / room.polygon.length, y: s.y + p.y / room.polygon.length }), { x: 0, y: 0 });
    const at = ok(c) ? c : nearestFree(model, c, 2);
    if (ok(at)) return at;
  }
  return null;
}

export interface InferredSpace {
  canonical: CanonicalSpace;
  repairs: Repair[];
  /** A free standing point inside the walkable space, in plan metres. */
  spawn: { x: number; y: number } | null;
  /** Indoor rooms a walking body reaches from the entrance, and those it does not. */
  reachable: string[];
  unreachable: string[];
  /** How much of it the pictures showed: elements by basis. */
  basis: Record<Basis, number>;
}

/**
 * The reading completed, built, walked and repaired until every indoor room is reached (or nothing more can be
 * done), with a valid spawn. Null when even the completed reading builds no scene (no room at all).
 */
export function inferredSpace(reading: Reconstruction, sourceKey: string): InferredSpace | { problems: string[] } {
  if (!reading.rooms.some((r) => !r.outdoor)) return { problems: ['NO_ROOMS'] };
  let { recon, repairs } = completeForWalk(reading);
  const build = (rc: Reconstruction) => {
    const doc = planDocument(rc, sourceKey);
    const dec = { rejected: [], roomKinds: {} };
    // The reader's own metres (ESTIMATED), as the photo reconstruction is calibrated before review.
    const calibration = calibrate(doc as never, dec, [], estimateScale(doc as never, []))
      ?? { metresPerPx: 1 / PX_PER_M, geometryState: 'ESTIMATED' as const, uncertainty: null, conflict: false, implied: [] };
    return buildCanonical(doc as never, dec, calibration, rc.ceilingHeightM ?? TYPICAL_CEILING_M);
  };
  let built = build(recon);
  if (!built.ok) {
    const rect = completeForWalk(asRectangles(reading));
    recon = rect.recon; repairs = [...rect.repairs, { code: 'RECTANGLES_USED', element: 'rooms' }];
    built = build(recon);
  }
  if (!built.ok) return { problems: built.problems };

  // Walk it: a room the body cannot reach gets a door to a reached neighbour, and the scene is built again.
  let canonical = built.canonical;
  let reach = { reachable: [] as string[], unreachable: [] as string[], spawn: null as { x: number; y: number } | null };
  for (let round = 0; round < 4; round += 1) {
    const space = buildSpaceModel(canonical.scene);
    const model = buildWalkModel(space, [], new Map());
    const reached = reachableRooms(space, model);
    const indoor = space.rooms.filter((r) => !r.outdoor);
    const spawn = validSpawn(space, model, circulationStart(space, model));
    reach = { reachable: indoor.filter((r) => reached.has(r.id)).map((r) => r.id), unreachable: indoor.filter((r) => !reached.has(r.id)).map((r) => r.id), spawn };
    if (!reach.unreachable.length) break;
    let added = false;
    for (const id of reach.unreachable) {
      const r = recon.rooms.find((x) => `r-${x.key}` === id);
      const o = r && recon.rooms.filter((x) => reach.reachable.includes(`r-${x.key}`)).map((x) => ({ x, seg: sharedSegments(r.polygon, x.polygon)[0] }))
        .filter((c) => c.seg && c.seg.len >= MIN_SHARED_M).sort((a, b) => b.seg!.len - a.seg!.len)[0];
      const door = r && o ? inferDoor(r, o.x, 100 + round * 10 + recon.openings.length) : null;
      if (door) { recon = { ...recon, openings: [...recon.openings, door] }; repairs.push({ code: 'DOOR_INFERRED', element: `${r!.key}↔${o!.x.key}` }); added = true; }
    }
    if (!added) break;
    const again = build(recon);
    if (!again.ok) break;
    canonical = again.canonical;
  }
  for (const id of reach.unreachable) if (!repairs.some((x) => x.code === 'ROOM_UNREACHABLE' && `r-${x.element}` === id)) repairs.push({ code: 'ROOM_UNREACHABLE', element: id.replace(/^r-/, '') });

  const basis: Record<Basis, number> = { OBSERVED: 0, INFERRED_HIGH: 0, INFERRED_MEDIUM: 0, INFERRED_LOW: 0 };
  for (const e of [...recon.rooms, ...recon.openings]) basis[basisOf(e.basis, e.confidence)] += 1;
  return { canonical: { ...canonical, geometryState: 'ESTIMATED' }, repairs, spawn: reach.spawn, reachable: reach.reachable, unreachable: reach.unreachable, basis };
}

/** Whether a walkthrough's space was mostly inferred (the Result then says so, quietly). */
export const mostlyInferred = (basis: Record<Basis, number> | null | undefined) => !!basis && basis.OBSERVED < (basis.INFERRED_HIGH + basis.INFERRED_MEDIUM + basis.INFERRED_LOW);
