// HOMATCH DESIGN STUDIO — does the plan hold together as a home?
//
// Deterministic checks on the fused plan, each a TopologyIssue with the
// elements it concerns: rooms outside the building or on top of each other,
// building area no room accounts for (usually a room the reading missed),
// openings that are not in a wall, duplicate and dangling walls, stairs
// outside, no way in from outside, and rooms that cannot be reached through
// the doors. Plus the adjacency map the walkthrough and the AI designer use.
//
// Pure and dependency-free (Deno + Node + browser).

import type { Connectivity, ConnectivityEdge, ConnectivitySignal, Opening, PlanDoc, Pt, Room, TopologyIssue } from './types.ts';
import { angleDiff, angleOf, bboxOf, dist, frame, lerp, lineDist, pointInPoly, polyArea, projT, segDist } from './geom.ts';

export interface TopologyInput {
  doc: PlanDoc;
  /** Building space no room accounts for (from fusion), image pixels. */
  uncovered?: Array<{ polygon: Pt[]; areaPx: number }>;
  metresPerPx?: number | null;
}

export interface TopologyResult { issues: TopologyIssue[]; adjacency: Record<string, string[]>; entrances: string[] }

const OUTDOOR = new Set(['BALCONY', 'TERRACE']);

/** Fraction of `a` (sampled) that lies inside `b`. */
function insideFraction(a: Pt[], b: Pt[], step: number): number {
  const bb = bboxOf(a);
  let n = 0;
  let hit = 0;
  for (let y = bb.y + step / 2; y < bb.y + bb.h; y += step) {
    for (let x = bb.x + step / 2; x < bb.x + bb.w; x += step) {
      const p = { x, y };
      if (!pointInPoly(p, a)) continue;
      n += 1;
      if (pointInPoly(p, b)) hit += 1;
    }
  }
  return n ? hit / n : 0;
}

/** The room (or outdoor space) a point is in, or null. */
function roomAt(p: Pt, rooms: Room[]): Room | null {
  for (const r of rooms) if (pointInPoly(p, r.polygon)) return r;
  return null;
}

export function checkTopology(input: TopologyInput): TopologyResult {
  const { doc } = input;
  const issues: TopologyIssue[] = [];
  const rooms = [...doc.rooms, ...doc.balconies];
  const wallById = new Map(doc.walls.map((w) => [w.id, w]));
  const T = (() => {
    const t = doc.walls.map((w) => w.thicknessPx ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
    return t.length ? t[t.length >> 1] : 6;
  })();
  const side = Math.max(doc.imageWidth, doc.imageHeight);
  const step = Math.max(2, side / 300);
  const fp = doc.footprint && doc.footprint.length >= 3 ? doc.footprint : null;

  // Rooms outside the building; rooms on top of each other.
  if (fp) {
    for (const r of rooms) {
      const f = insideFraction(r.polygon, fp, step);
      if (f < 0.9) issues.push({ code: 'ROOM_OUTSIDE_FOOTPRINT', elementIds: [r.id], severity: f < 0.5 ? 'BLOCK' : 'WARN', detail: `${Math.round((1 - f) * 100)}% outside the building outline` });
    }
  }
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const a = rooms[i];
      const b = rooms[j];
      const ba = bboxOf(a.polygon);
      const bb = bboxOf(b.polygon);
      if (ba.x > bb.x + bb.w || bb.x > ba.x + ba.w || ba.y > bb.y + bb.h || bb.y > ba.y + ba.h) continue;
      const small = polyArea(a.polygon) <= polyArea(b.polygon) ? a : b;
      const big = small === a ? b : a;
      const f = insideFraction(small.polygon, big.polygon, step);
      if (f > 0.05) issues.push({ code: 'ROOMS_OVERLAP', elementIds: [a.id, b.id], severity: f > 0.4 ? 'BLOCK' : 'WARN', detail: `${Math.round(f * 100)}% of ${small.id} overlaps ${big.id}` });
    }
  }
  for (const u of input.uncovered ?? []) {
    const m = input.metresPerPx;
    const area = m ? `${Math.round(u.areaPx * m * m * 10) / 10} m²` : `${u.areaPx} px²`;
    const c = bboxOf(u.polygon);
    issues.push({ code: 'UNCOVERED_AREA', elementIds: [], severity: 'WARN', detail: `${area} of the building is not in any room (around x=${Math.round(c.x + c.w / 2)}, y=${Math.round(c.y + c.h / 2)})` });
  }
  for (const r of rooms) if (r.polygon.length < 3 || polyArea(r.polygon) < 1) issues.push({ code: 'ROOM_NOT_CLOSED', elementIds: [r.id], severity: 'BLOCK' });

  // Openings: in a wall, inside its length.
  const openings: Array<{ o: Opening; door: boolean }> = [...doc.doors.map((o) => ({ o, door: true })), ...doc.windows.map((o) => ({ o, door: false }))];
  for (const { o } of openings) {
    const w = wallById.get(o.wallId);
    if (!w) { issues.push({ code: 'OPENING_OFF_WALL', elementIds: [o.id], severity: 'WARN', detail: 'its wall does not exist' }); continue; }
    const L = dist(w.start, w.end);
    const half = o.widthPx / 2 / Math.max(L, 1e-9);
    const off = o.centerPx ? segDist(o.centerPx, w.start, w.end) : 0;
    if (o.position - half < -0.02 || o.position + half > 1.02 || off > (w.thicknessPx ?? T) + 4) {
      issues.push({ code: 'OPENING_OFF_WALL', elementIds: [o.id, w.id], severity: 'WARN', detail: off > (w.thicknessPx ?? T) + 4 ? 'not on its wall' : 'runs past the end of its wall' });
    }
  }

  // Walls: duplicates and dangling ends.
  for (let i = 0; i < doc.walls.length; i += 1) {
    for (let j = i + 1; j < doc.walls.length; j += 1) {
      const a = doc.walls[i];
      const b = doc.walls[j];
      if (angleDiff(angleOf(a.start, a.end), angleOf(b.start, b.end)) > 3) continue;
      const tol = Math.max(a.thicknessPx ?? T, b.thicknessPx ?? T) * 0.6 + 2;
      if (lineDist(b.start, a.start, a.end) > tol || lineDist(b.end, a.start, a.end) > tol) continue;
      const L = dist(a.start, a.end);
      const t0 = projT(b.start, a.start, a.end) * L;
      const t1 = projT(b.end, a.start, a.end) * L;
      const overlap = Math.min(L, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1));
      if (overlap > 0.3 * Math.min(L, dist(b.start, b.end))) issues.push({ code: 'DUPLICATE_WALL', elementIds: [a.id, b.id], severity: 'WARN' });
    }
  }
  for (const w of doc.walls) {
    for (const p of [w.start, w.end]) {
      const joined = doc.walls.some((o) => o !== w && segDist(p, o.start, o.end) <= ((o.thicknessPx ?? T) + (w.thicknessPx ?? T)) / 2 + 3);
      const onEdge = fp ? fp.some((a, i) => segDist(p, a, fp[(i + 1) % fp.length]) <= (w.thicknessPx ?? T) + 3) : false;
      if (!joined && !onEdge) issues.push({ code: 'DANGLING_WALL', elementIds: [w.id], severity: 'INFO', detail: `end at x=${Math.round(p.x)}, y=${Math.round(p.y)} joins nothing` });
    }
  }

  // Stairs inside the building.
  if (fp) {
    for (const s of doc.stairs ?? []) {
      if (insideFraction(s.polygon, fp, step) < 0.9) issues.push({ code: 'STAIRS_OUTSIDE', elementIds: [s.id], severity: 'WARN' });
    }
  }

  // Adjacency through doors and doorless openings; open boundaries between rooms.
  const adj = new Map<string, Set<string>>(rooms.map((r) => [r.id, new Set<string>()]));
  const link = (a: string, b: string) => { if (a !== b) { adj.get(a)?.add(b); adj.get(b)?.add(a); } };
  const entrances: string[] = [];
  for (const { o, door } of openings) {
    if (!door) continue;
    const w = wallById.get(o.wallId);
    if (!w) continue;
    const c = o.centerPx ?? lerp(w.start, w.end, o.position);
    const { n } = frame(w.start, w.end);
    const reach = (w.thicknessPx ?? T) / 2 + Math.max(4, T);
    const sideA = roomAt({ x: c.x + n.x * reach, y: c.y + n.y * reach }, rooms);
    const sideB = roomAt({ x: c.x - n.x * reach, y: c.y - n.y * reach }, rooms);
    if (sideA && sideB) link(sideA.id, sideB.id);
    // A way in: a door between an indoor room and the outside (or a terrace / porch).
    const indoor = [sideA, sideB].find((r) => r && !OUTDOOR.has(r.kind));
    const other = indoor === sideA ? sideB : sideA;
    if (indoor && (!other || other.kind === 'TERRACE')) {
      const outside = !other ? (fp ? !pointInPoly(o.centerPx ?? c, fp) || w.kind === 'EXTERIOR' : w.kind === 'EXTERIOR') : true;
      if (outside) entrances.push(o.id);
    }
  }
  for (const r of rooms) {
    const ring = r.polygon;
    const touching = new Map<string, number>();
    for (let k = 0; k < ring.length; k += 1) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      const L = dist(a, b);
      if (L < 4) continue;
      const { n } = frame(a, b);
      const inward = pointInPoly({ x: (a.x + b.x) / 2 + n.x * 2, y: (a.y + b.y) / 2 + n.y * 2 }, ring) ? 1 : -1;
      for (let s = 4; s < L; s += 8) {
        const p = lerp(a, b, s / L);
        const q = { x: p.x - n.x * inward * 2.5, y: p.y - n.y * inward * 2.5 };
        const other = roomAt(q, rooms.filter((o) => o !== r));
        if (other) touching.set(other.id, (touching.get(other.id) ?? 0) + 1);
      }
    }
    for (const [id, count] of touching) if (count >= 3) link(r.id, id);
  }
  const adjacency: Record<string, string[]> = {};
  for (const [id, set] of adj) adjacency[id] = [...set].sort();

  const indoorRooms = doc.rooms.filter((r) => !OUTDOOR.has(r.kind));
  if (indoorRooms.length > 0 && entrances.length === 0) {
    issues.push({ code: 'NO_ENTRANCE', elementIds: [], severity: 'WARN', detail: 'no door leads outside or onto a terrace' });
  }
  // Reachability from the way in (or from the main living space when none is drawn).
  const starts = new Set<string>();
  for (const id of entrances) {
    const o = doc.doors.find((d) => d.id === id);
    const w = o && wallById.get(o.wallId);
    if (!o || !w) continue;
    const c = o.centerPx ?? lerp(w.start, w.end, o.position);
    const { n } = frame(w.start, w.end);
    for (const s of [1, -1]) {
      const r = roomAt({ x: c.x + n.x * s * (T + 4), y: c.y + n.y * s * (T + 4) }, rooms);
      if (r) starts.add(r.id);
    }
  }
  if (starts.size === 0) {
    const hub = [...indoorRooms].sort((a, b) => (Number(b.kind === 'LIVING' || b.kind === 'HALL' || b.kind === 'CORRIDOR') - Number(a.kind === 'LIVING' || a.kind === 'HALL' || a.kind === 'CORRIDOR')) || polyArea(b.polygon) - polyArea(a.polygon))[0];
    if (hub) starts.add(hub.id);
  }
  const seen = new Set<string>(starts);
  const queue = [...starts];
  while (queue.length) {
    const id = queue.shift()!;
    for (const n of adjacency[id] ?? []) if (!seen.has(n)) { seen.add(n); queue.push(n); }
  }
  for (const r of rooms) {
    if (seen.has(r.id)) continue;
    issues.push({ code: 'ROOM_UNREACHABLE', elementIds: [r.id], severity: OUTDOOR.has(r.kind) ? 'INFO' : 'WARN', detail: 'no door or opening leads into it' });
  }
  return { issues, adjacency, entrances };
}

// ── Connectivity: who can walk to whom through the walls as reconstructed ───
//
// A validation signal, not a repair: rooms are nodes; an edge is a door (by
// its id) or a stretch of shared boundary at least a doorway wide with no
// wall on it (an open plan). Unlike `adjacency` above (rooms that merely
// touch), a wall between two rooms is respected. It flags what a home rarely
// is: a bedroom reached only through another bedroom, a lived-in room nobody
// can walk into, a door with no room on one side. Nothing is invented to make
// the graph connected; a flag means "this reading is uncertain here".

const PRIVATE = new Set(['BEDROOM']);
const LIVED_IN = new Set(['LIVING', 'BEDROOM', 'KITCHEN', 'BATHROOM', 'WC', 'HALL', 'CORRIDOR', 'UNKNOWN']);

export function connectivityOf(doc: PlanDoc, entrances: string[]): Connectivity {
  const rooms = [...doc.rooms, ...doc.balconies];
  const T = (() => {
    const t = doc.walls.map((w) => w.thicknessPx ?? 0).filter((n) => n > 0).sort((a, b) => a - b);
    return t.length ? t[t.length >> 1] : 6;
  })();
  const pxPerM = doc.detectedScale ? 1 / doc.detectedScale : Math.max(doc.imageWidth, doc.imageHeight) / 20;
  const doorway = 0.6 * pxPerM;
  const walled = (p: Pt) => doc.walls.some((w) => segDist(p, w.start, w.end) <= (w.thicknessPx ?? T) / 2 + 2);
  const edges: ConnectivityEdge[] = [];
  const signals: ConnectivitySignal[] = [];
  const wallById = new Map(doc.walls.map((w) => [w.id, w]));
  for (const o of doc.doors) {
    const w = wallById.get(o.wallId);
    if (!w) continue;
    const c = o.centerPx ?? lerp(w.start, w.end, o.position);
    const { u, n } = frame(w.start, w.end);
    const reach = (w.thicknessPx ?? T) / 2 + Math.max(4, T);
    // Across the door's whole span (a room outline can start part-way along a doorway).
    const sideOf = (sgn: number) => {
      for (const f of [0, -0.3, 0.3, -0.45, 0.45]) {
        const q = { x: c.x + u.x * f * o.widthPx + n.x * sgn * reach, y: c.y + u.y * f * o.widthPx + n.y * sgn * reach };
        const hit = roomAt(q, rooms);
        if (hit) return hit;
      }
      return null;
    };
    const A = sideOf(1);
    const B = sideOf(-1);
    if (A && B && A !== B) edges.push({ a: A.id, b: B.id, via: o.id });
    else if ((!A || !B) && w.kind === 'INTERIOR') signals.push({ code: 'DOOR_CONNECTS_NOTHING', rooms: [A, B].filter(Boolean).map((r) => r!.id), detail: `${o.id} on ${w.id} has no room on one side` });
  }
  // Open boundaries: a doorway-wide run of shared edge with no wall on it.
  for (let i = 0; i < rooms.length; i += 1) {
    const r = rooms[i];
    const ring = r.polygon;
    const runs = new Map<string, number>();
    const best = new Map<string, number>();
    for (let k = 0; k < ring.length; k += 1) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      const L = dist(a, b);
      if (L < 4) continue;
      const { n } = frame(a, b);
      const inward = pointInPoly({ x: (a.x + b.x) / 2 + n.x * 2, y: (a.y + b.y) / 2 + n.y * 2 }, ring) ? 1 : -1;
      runs.clear();
      for (let s = 2; s < L; s += 2) {
        const p = lerp(a, b, s / L);
        let other: Room | null = null;
        for (const reachOut of [3, T / 2 + 3, T + 4]) {
          other = roomAt({ x: p.x - n.x * inward * reachOut, y: p.y - n.y * inward * reachOut }, rooms.filter((o) => o !== r));
          if (other) break;
        }
        for (const id of [...runs.keys()]) if (!other || other.id !== id) runs.set(id, 0);
        if (!other || walled(p)) { if (other) runs.set(other.id, 0); continue; }
        const run = (runs.get(other.id) ?? 0) + 2;
        runs.set(other.id, run);
        best.set(other.id, Math.max(best.get(other.id) ?? 0, run));
      }
    }
    for (const [id, run] of best) if (run >= doorway && r.id < id) edges.push({ a: r.id, b: id, via: 'OPEN' });
  }
  const adj = new Map<string, Set<string>>(rooms.map((r) => [r.id, new Set<string>()]));
  for (const e of edges) { adj.get(e.a)?.add(e.b); adj.get(e.b)?.add(e.a); }
  // From the way in (or the main living space when none is drawn).
  const starts = new Set<string>();
  for (const id of entrances) for (const e of edges) if (e.via === id) { starts.add(e.a); starts.add(e.b); }
  for (const id of entrances) {
    const o = doc.doors.find((d) => d.id === id);
    const w = o && wallById.get(o.wallId);
    if (!o || !w) continue;
    const c = o.centerPx ?? lerp(w.start, w.end, o.position);
    const { n } = frame(w.start, w.end);
    for (const sgn of [1, -1]) { const rr = roomAt({ x: c.x + n.x * sgn * (T + 4), y: c.y + n.y * sgn * (T + 4) }, rooms); if (rr) starts.add(rr.id); }
  }
  if (!starts.size) {
    const hub = doc.rooms.filter((r) => r.kind === 'LIVING').sort((a, b) => polyArea(b.polygon) - polyArea(a.polygon))[0] ?? doc.rooms[0];
    if (hub) starts.add(hub.id);
  }
  const seen = new Set(starts);
  const queue = [...starts];
  while (queue.length) { const id = queue.shift()!; for (const nb of adj.get(id) ?? []) if (!seen.has(nb)) { seen.add(nb); queue.push(nb); } }
  for (const r of doc.rooms) {
    if (!seen.has(r.id) && LIVED_IN.has(r.kind)) signals.push({ code: 'HABITABLE_UNREACHABLE', rooms: [r.id], detail: `${r.kind} ${r.id}: no door or open boundary reaches it from the way in` });
    if (PRIVATE.has(r.kind)) {
      const nbs = [...(adj.get(r.id) ?? [])].map((id) => rooms.find((x) => x.id === id)!).filter((x) => x && !OUTDOOR.has(x.kind));
      if (nbs.length && nbs.every((x) => PRIVATE.has(x.kind))) signals.push({ code: 'PRIVATE_ROOM_VIA_PRIVATE_ONLY', rooms: [r.id, ...nbs.map((x) => x.id)], detail: `${r.id} is reached only through ${nbs.map((x) => x.id).join(', ')}` });
    }
  }
  edges.sort((p, q) => (p.a + p.b + p.via < q.a + q.b + q.via ? -1 : 1));
  return { edges, reachable: [...seen].sort(), signals };
}
