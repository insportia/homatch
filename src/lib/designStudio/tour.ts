// THE WHOLE-HOME TOUR — ONE CONTINUOUS INTERIOR, NAVIGATED THROUGH ITS REAL DOORS.
//
// The plan is the truth: which rooms a door joins (cameraDirector.roomGraph),
// where a visitor starts (just inside the entrance, at eye level), and which
// rooms a body can actually walk into from there. The walkthrough shows a
// navigation point at each real doorway of the room the visitor stands in,
// named after the room behind it — only when that room is reachable through
// that very door — and a tap walks the visitor through the doorway along a
// collision-safe route (SceneController.routeTo), never a teleport.
//
// Pure data: no three.js, no DOM. The overlay projects these points on screen.

import { entryShot, roomGraph, verticalFov, type CameraShot, type RoomGraph } from './cameraDirector.ts';
import { EYE_HEIGHT_M, findPath, isFree, nearestFree, type WalkModel } from './navigation.ts';
import { roomContaining, wallFrame, type Point, type SpaceModel } from './space.ts';

/** A real doorway, seen from one side: where it is, the room behind it, and where a visitor lands through it. */
export interface DoorPoint {
  doorId: string;
  /** The doorway's centre (plan metres). */
  at: Point;
  fromRoom: string;
  toRoom: string;
  /** Just through the doorway, inside `toRoom`, facing on in the direction of travel (heading preserved). */
  landing: CameraShot;
}

export interface TourPlan {
  graph: RoomGraph;
  /** Where the tour starts: inside the entrance, at eye level. */
  entry: CameraShot | null;
  /** Rooms a body can walk into from the entry (doors opened on the way). */
  reachable: Set<string>;
  /** Every passable doorway, once from each side. */
  doors: DoorPoint[];
}

/** How far through a doorway a visitor lands (metres from the door's centre line). */
const LANDING_M = 0.95;
/** How many grid cells the route between a doorway's two sides may search: a local check, never a home-wide search. */
const DOOR_PATH_CELLS = 1500;

/** The two free standing points either side of a door, keyed by the room each is in. */
function doorSides(space: SpaceModel, walk: WalkModel, doorId: string, reach: number): Map<string, Point> {
  const out = new Map<string, Point>();
  const door = space.doors.find((d) => d.id === doorId);
  const wall = door ? space.walls.find((w) => w.id === door.wallId) : null;
  if (!door || !wall) return out;
  const f = wallFrame(wall.mesh);
  const r = wall.mesh.thicknessM / 2 + reach;
  for (const n of [f.normalL, f.normalR]) {
    const raw = { x: door.centre.x + n.x * r, y: door.centre.y + n.y * r };
    const room = roomContaining(space, raw);
    if (!room || out.has(room)) continue;
    const free = isFree(walk, raw) ? raw : nearestFree(walk, raw, 0.45);
    if (free && roomContaining(space, free) === room) out.set(room, free);
  }
  return out;
}

/** Where a visitor stands after walking through `doorId` from `fromRoom` into `toRoom`. */
export function landingThrough(space: SpaceModel, walk: WalkModel, doorId: string, fromRoom: string, toRoom: string, aspect = 16 / 9): CameraShot | null {
  const door = space.doors.find((d) => d.id === doorId);
  if (!door) return null;
  const near = doorSides(space, walk, doorId, 0.45);
  const from = near.get(fromRoom);
  const far = doorSides(space, walk, doorId, LANDING_M).get(toRoom) ?? near.get(toRoom);
  if (!far) return null;
  // The heading of the step through the door: from this side to the other, so the view carries on into the room.
  const base = from ?? door.centre;
  const len = Math.hypot(far.x - base.x, far.y - base.y) || 1;
  const dir = { x: (far.x - base.x) / len, y: (far.y - base.y) / len };
  return {
    kind: 'ROOM', roomId: toRoom, position: far, height: EYE_HEIGHT_M,
    target: { x: far.x + dir.x * 2.5, y: far.y + dir.y * 2.5 }, targetHeight: EYE_HEIGHT_M - 0.1, fov: verticalFov(78, aspect),
  };
}

/** True when a body can walk from one side of the doorway to the other (a door in the way is opened, as a person would). */
function passable(space: SpaceModel, walk: WalkModel, doorId: string, a: string, b: string): boolean {
  const sides = doorSides(space, walk, doorId, 0.45);
  const pa = sides.get(a); const pb = sides.get(b);
  if (!pa || !pb) return false;
  const route = findPath(walk, pa, pb, { throughDoors: true, maxCells: DOOR_PATH_CELLS });
  if (!route) return false;
  // Through THIS doorway, not round by another one: the way is barely longer than the step across.
  let len = 0; let prev = pa;
  for (const p of route) { len += Math.hypot(p.x - prev.x, p.y - prev.y); prev = p; }
  return len <= Math.hypot(pb.x - pa.x, pb.y - pa.y) + 1.5;
}

/**
 * The tour of a home: the entry, the rooms reachable from it through passable doorways (a breadth-first walk over the
 * room graph, each doorway checked by a real route between its sides), and every such doorway from both sides.
 */
export function planTour(space: SpaceModel, walk: WalkModel, aspect = 16 / 9): TourPlan {
  const graph = roomGraph(space);
  const entry = entryShot(space, walk, aspect, graph);
  const reachable = new Set<string>();
  const doors: DoorPoint[] = [];
  const start = entry?.position ? roomContaining(space, entry.position) ?? entry.roomId : entry?.roomId ?? null;
  if (!start) return { graph, entry, reachable, doors };
  reachable.add(start);
  const queue = [start];
  const checked = new Map<string, boolean>();
  while (queue.length) {
    const at = queue.shift()!;
    for (const link of graph.links) {
      if (!link.b || (link.a !== at && link.b !== at)) continue;
      const other = link.a === at ? link.b : link.a;
      let ok = checked.get(link.doorId);
      if (ok === undefined) { ok = passable(space, walk, link.doorId, link.a, link.b); checked.set(link.doorId, ok); }
      if (!ok) continue;
      if (!reachable.has(other)) { reachable.add(other); queue.push(other); }
    }
  }
  for (const link of graph.links) {
    if (!link.b || !checked.get(link.doorId)) continue;
    for (const [from, to] of [[link.a, link.b], [link.b, link.a]] as const) {
      if (!reachable.has(from) || !reachable.has(to)) continue;
      const landing = landingThrough(space, walk, link.doorId, from, to, aspect);
      if (landing) doors.push({ doorId: link.doorId, at: link.at, fromRoom: from, toRoom: to, landing });
    }
  }
  return { graph, entry, reachable, doors };
}

/** The doorways a visitor standing in `roomId` can walk through (one per neighbouring room and door). */
export function doorPointsFrom(plan: TourPlan, roomId: string | null): DoorPoint[] {
  if (!roomId) return [];
  return plan.doors.filter((d) => d.fromRoom === roomId);
}
