// WALKING THROUGH THE REAL GEOMETRY.
//
// The walkthrough camera is a body of radius BODY_RADIUS_M at eye height,
// moving in plan. What stops it is exactly what stands in the space:
//
//   · every wall, as solid slabs between its door openings (windows are
//     solid: you look through them, you do not walk through them)
//   · a CLOSED door fills its opening; an open one leaves it free
//   · every placed floor piece taller than a rug (from the current design)
//   · every flight of stairs: its footprint is walked around, never onto
//     (one storey is walked; the flight is architecture to look at)
//   · the space itself: the body must stay in a room or in a doorway
//
// A blocked move slides along the obstacle instead of stopping dead, and a
// long step is taken in small sub-steps so nothing can be tunnelled through.
// Deterministic and pure; the renderer only asks where the body may go.

import type { CatalogAsset } from './catalog.ts';
import type { ObjectInstance } from './designState.ts';
import { footprint, type Obb } from './placement.ts';
import { shapedAsset } from './objectShape.ts';
import { pointInPolygon, wallFrame, type Point, type SpaceModel } from './space.ts';

export const EYE_HEIGHT_M = 1.6;
export const BODY_RADIUS_M = 0.22;
/** Pieces lower than this are stepped over (rugs, low platforms). */
export const STEP_OVER_M = 0.3;
const SUBSTEP_M = 0.08;
const DOORWAY_REACH_M = 0.45;

export interface WalkModel {
  space: SpaceModel;
  walls: Obb[];
  furniture: Obb[];
  doors: Point[];
  /** Stair footprints (plan polygons): solid, like a wall. */
  stairs: Point[][];
  /** Each door opening's leaf, as the solid it becomes when the door is closed. */
  doorways: Map<string, Obb>;
  /** Doors currently closed (walkthrough state, never the design's). */
  closedDoors: Set<string>;
  radius: number;
}

/** The solid parts of every wall, and every piece in the way. */
export function buildWalkModel(space: SpaceModel, objects: ObjectInstance[], assets: Map<string, CatalogAsset>): WalkModel {
  const walls: Obb[] = [];
  const doorways = new Map<string, Obb>();
  for (const wall of space.walls) {
    const m = wall.mesh;
    const f = wallFrame(m);
    for (const o of m.openings) {
      if (o.kind !== 'DOOR') continue;
      doorways.set(o.id, {
        cx: m.start.x + f.dir.x * o.offsetM, cy: m.start.y + f.dir.y * o.offsetM,
        hw: o.widthM / 2, hd: Math.max(m.thicknessM / 2, 0.03), angle: f.angle,
      });
    }
    // Extend each end by half the thickness so corners are closed.
    const ext = m.thicknessM / 2;
    const doors = m.openings.filter((o) => o.kind === 'DOOR')
      .map((o) => [o.offsetM - o.widthM / 2, o.offsetM + o.widthM / 2] as const)
      .sort((a, b) => a[0] - b[0]);
    let from = -ext;
    const pieces: Array<[number, number]> = [];
    for (const [a, b] of doors) {
      if (a > from) pieces.push([from, a]);
      from = Math.max(from, b);
    }
    if (f.length + ext > from) pieces.push([from, f.length + ext]);
    for (const [a, b] of pieces) {
      if (b - a < 0.01) continue;
      const mid = (a + b) / 2;
      walls.push({
        cx: m.start.x + f.dir.x * mid,
        cy: m.start.y + f.dir.y * mid,
        hw: (b - a) / 2,
        hd: m.thicknessM / 2,
        angle: f.angle,
      });
    }
  }

  const furniture: Obb[] = [];
  for (const o of objects) {
    const own = assets.get(o.assetId);
    const a = own ? shapedAsset(own, o) : undefined;
    if (!a || a.placement !== 'FLOOR' || a.heightM < STEP_OVER_M) continue;
    furniture.push(footprint(a, { x: o.position.x, y: o.position.z }, o.rotationY));
  }

  const stairs = (space.stairs ?? []).map((st) => st.polygon).filter((p) => p.length >= 3);
  return { space, walls, furniture, doors: space.doors.map((d) => d.centre), stairs, doorways, closedDoors: new Set(), radius: BODY_RADIUS_M };
}

/** Distance from a point to an oriented box (0 inside). */
export function distanceToObb(p: Point, b: Obb): number {
  const dx = p.x - b.cx;
  const dy = p.y - b.cy;
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  const qx = Math.max(Math.abs(lx) - b.hw, 0);
  const qy = Math.max(Math.abs(ly) - b.hd, 0);
  return Math.hypot(qx, qy);
}

/** Distance from a point to a polygon's boundary (0 inside). */
export function distanceToPolygon(p: Point, polygon: Point[]): number {
  if (pointInPolygon(p, polygon)) return 0;
  let best = Infinity;
  for (let i = 0; i < polygon.length; i += 1) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/** The room a point stands in; a doorway counts as the space too. */
export function inSpace(model: WalkModel, p: Point): boolean {
  if (model.space.rooms.some((r) => pointInPolygon(p, r.polygon))) return true;
  return model.doors.some((d) => Math.hypot(d.x - p.x, d.y - p.y) <= DOORWAY_REACH_M);
}

export function isFree(model: WalkModel, p: Point): boolean {
  if (!inSpace(model, p)) return false;
  for (const w of model.walls) if (distanceToObb(p, w) < model.radius) return false;
  for (const f of model.furniture) if (distanceToObb(p, f) < model.radius) return false;
  for (const s of model.stairs ?? []) if (distanceToPolygon(p, s) < model.radius) return false;
  for (const id of model.closedDoors) {
    const leaf = model.doorways.get(id);
    if (leaf && distanceToObb(p, leaf) < model.radius) return false;
  }
  return true;
}

/** Close or open a door for walking (the leaf blocks its opening while closed). */
export function setDoorClosed(model: WalkModel, doorId: string, closed: boolean): void {
  if (!model.doorways.has(doorId)) return;
  if (closed) model.closedDoors.add(doorId); else model.closedDoors.delete(doorId);
}

/**
 * Move the body by `delta`, as far as the space allows. Blocked on both
 * axes it stays where it is; blocked on one it slides along the other.
 */
export function move(model: WalkModel, from: Point, delta: Point): Point {
  const length = Math.hypot(delta.x, delta.y);
  if (length === 0) return from;
  const steps = Math.max(1, Math.ceil(length / SUBSTEP_M));
  let p = from;
  for (let i = 0; i < steps; i += 1) {
    const dx = delta.x / steps;
    const dy = delta.y / steps;
    const full = { x: p.x + dx, y: p.y + dy };
    if (isFree(model, full)) { p = full; continue; }
    const alongX = { x: p.x + dx, y: p.y };
    if (Math.abs(dx) > 1e-9 && isFree(model, alongX)) { p = alongX; continue; }
    const alongY = { x: p.x, y: p.y + dy };
    if (Math.abs(dy) > 1e-9 && isFree(model, alongY)) { p = alongY; continue; }
    break;
  }
  return p;
}

/** The nearest free point to `p` (searching outward in rings), or null. */
export function nearestFree(model: WalkModel, p: Point, maxRadius = 2): Point | null {
  if (isFree(model, p)) return p;
  for (let r = 0.1; r <= maxRadius; r += 0.1) {
    const n = Math.max(8, Math.round((2 * Math.PI * r) / 0.1));
    for (let i = 0; i < n; i += 1) {
      const a = (i / n) * Math.PI * 2;
      const q = { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r };
      if (isFree(model, q)) return q;
    }
  }
  return null;
}

// ── Finding a way ─────────────────────────────────────────────────────
//
// For the guided moments (Live Here): a walkable route from where the
// visitor stands to where something is used, on a 15 cm grid over the free
// space, shortened to straight runs that stay free. Closed doors can be
// treated as open (`throughDoors`) — the walker opens them on the way.

const GRID_M = 0.15;

function segmentFree(model: WalkModel, a: Point, b: Point): boolean {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(len / 0.05));
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    if (!isFree(model, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })) return false;
  }
  return true;
}

/** A route (list of points, start excluded) or null when there is none. */
export function findPath(model: WalkModel, from: Point, to: Point, options: { throughDoors?: boolean; maxCells?: number } = {}): Point[] | null {
  const closed = model.closedDoors;
  if (options.throughDoors) model.closedDoors = new Set();
  try {
    const goal = nearestFree(model, to, 1.2);
    if (!goal || !isFree(model, from)) return null;
    if (segmentFree(model, from, goal)) return [goal];
    const key = (i: number, j: number) => `${i},${j}`;
    const cell = (p: Point) => [Math.round((p.x - from.x) / GRID_M), Math.round((p.y - from.y) / GRID_M)] as const;
    const at = (i: number, j: number): Point => ({ x: from.x + i * GRID_M, y: from.y + j * GRID_M });
    const [gi, gj] = cell(goal);
    const open: Array<{ i: number; j: number; f: number; g: number }> = [{ i: 0, j: 0, f: 0, g: 0 }];
    const came = new Map<string, string>();
    const best = new Map<string, number>([[key(0, 0), 0]]);
    const max = options.maxCells ?? 40000;
    let visited = 0;
    let found: string | null = null;
    while (open.length && visited < max) {
      let k = 0;
      for (let x = 1; x < open.length; x += 1) if (open[x].f < open[k].f) k = x;
      const cur = open.splice(k, 1)[0];
      visited += 1;
      if (Math.abs(cur.i - gi) <= 1 && Math.abs(cur.j - gj) <= 1) { found = key(cur.i, cur.j); break; }
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const ni = cur.i + di;
        const nj = cur.j + dj;
        const nk = key(ni, nj);
        const g = cur.g + Math.hypot(di, dj);
        if (g >= (best.get(nk) ?? Infinity)) continue;
        if (!isFree(model, at(ni, nj))) continue;
        // No cutting corners: a diagonal step needs both sides of it free.
        if (di !== 0 && dj !== 0 && (!isFree(model, at(cur.i + di, cur.j)) || !isFree(model, at(cur.i, cur.j + dj))
          || !isFree(model, { x: from.x + (cur.i + di / 2) * GRID_M, y: from.y + (cur.j + dj / 2) * GRID_M }))) continue;
        best.set(nk, g);
        came.set(nk, key(cur.i, cur.j));
        open.push({ i: ni, j: nj, g, f: g + Math.hypot(gi - ni, gj - nj) });
      }
    }
    if (!found) return null;
    const cells: Point[] = [];
    for (let c: string | undefined = found; c && c !== key(0, 0); c = came.get(c)) {
      const [i, j] = c.split(',').map(Number);
      cells.unshift(at(i, j));
    }
    cells.push(goal);
    // Straighten: keep only the points where a straight free run has to turn.
    const out: Point[] = [];
    let anchor = from;
    for (let i = 0; i < cells.length; i += 1) {
      const next = cells[i + 1];
      if (next && segmentFree(model, anchor, next)) continue;
      out.push(cells[i]);
      anchor = cells[i];
    }
    return out;
  } finally {
    model.closedDoors = closed;
  }
}

/** Closed doors a route passes through (the walker opens them on the way). */
export function doorsOnRoute(model: WalkModel, from: Point, route: Point[]): string[] {
  const hits = new Set<string>();
  let a = from;
  for (const b of route) {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(len / 0.05));
    for (let i = 0; i <= steps; i += 1) {
      const p = { x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps };
      for (const id of model.closedDoors) {
        const leaf = model.doorways.get(id);
        if (leaf && distanceToObb(p, leaf) < model.radius + 0.05) hits.add(id);
      }
    }
    a = b;
  }
  return [...hits];
}
