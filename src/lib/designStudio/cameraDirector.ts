// THE CAMERA DIRECTOR — SHOTS FROM THE PLAN ITSELF, NEVER HARD-CODED.
//
// Every camera decision is computed from the space, so a different floor
// plan gets different shots without a line of per-apartment code:
//
//   room graph     which rooms connect, through which door (and which door
//                  leads outside: the entry)
//   free space     only positions the walkthrough body could stand in
//                  (navigation.ts: walls, door gaps, current furniture)
//   sight lines    a view must not look through a solid wall
//   focal points   windows are what a person looks toward first
//   depth          stand where the room reads deepest
//   field of view  wide enough to hold the room, never fish-eye
//
// Output is data (CameraShot); the renderer only animates to it. The same
// shots drive the walkthrough's entry, its room-to-room tour, and later a
// cinematic path (a sequence of shots along the room graph).

import { COMFORT_RADIUS_M, EYE_HEIGHT_M, isFree, nearestFree, type WalkModel } from './navigation.ts';
import { roomContaining, wallFrame, type Point, type SpaceModel, type SpaceRoom } from './space.ts';

export interface CameraShot {
  kind: 'ENTRY' | 'ROOM';
  roomId: string | null;
  /** Plan metres. */
  position: Point;
  height: number;
  target: Point;
  targetHeight: number;
  /** Vertical field of view in degrees, for the given aspect. */
  fov: number;
}

export interface RoomLink { a: string; b: string | null; doorId: string; at: Point }

export interface RoomGraph {
  rooms: string[];
  links: RoomLink[];
  /** The room an exterior door opens into, when the plan shows one. */
  entryRoomId: string | null;
  entryDoorId: string | null;
}

const MIN_HFOV = 62;
const MAX_HFOV = 92;

/** Which rooms each door joins, found by stepping through the opening on both sides. */
export function roomGraph(space: SpaceModel): RoomGraph {
  const links: RoomLink[] = [];
  let entryRoomId: string | null = null;
  let entryDoorId: string | null = null;
  for (const door of space.doors) {
    const wall = space.walls.find((w) => w.id === door.wallId);
    if (!wall) continue;
    const f = wallFrame(wall.mesh);
    const reach = wall.mesh.thicknessM / 2 + 0.3;
    const side = (n: Point) => roomContaining(space, { x: door.centre.x + n.x * reach, y: door.centre.y + n.y * reach });
    const l = side(f.normalL);
    const r = side(f.normalR);
    const a = l ?? r;
    const b = l && r && l !== r ? r : null;
    if (!a) continue;
    links.push({ a, b, doorId: door.id, at: door.centre });
    if (!b && (wall.kind === 'EXTERIOR' || !(l && r)) && !entryRoomId) {
      entryRoomId = a;
      entryDoorId = door.id;
    }
  }
  return { rooms: space.rooms.map((r) => r.id), links, entryRoomId, entryDoorId };
}

/** The order a visitor meets the rooms: from the entry, through doors, nearest first. */
export function tourOrder(space: SpaceModel, graph = roomGraph(space)): string[] {
  const byArea = [...space.rooms].sort((x, y) => y.areaM2 - x.areaM2);
  const start = graph.entryRoomId ?? byArea[0]?.id ?? null;
  if (!start) return [];
  const seen = new Set<string>([start]);
  const order = [start];
  const queue = [start];
  while (queue.length) {
    const at = queue.shift()!;
    const next = graph.links
      .filter((l) => l.b && (l.a === at || l.b === at))
      .map((l) => (l.a === at ? l.b! : l.a))
      .filter((id) => !seen.has(id))
      .sort((x, y) => (space.rooms.find((r) => r.id === y)?.areaM2 ?? 0) - (space.rooms.find((r) => r.id === x)?.areaM2 ?? 0));
    for (const id of next) { seen.add(id); order.push(id); queue.push(id); }
  }
  // Rooms no door reaches (a drawing that omits a door) still get a visit.
  for (const r of byArea) if (!seen.has(r.id)) order.push(r.id);
  return order;
}

function windowCentres(space: SpaceModel, room: SpaceRoom): Point[] {
  const out: Point[] = [];
  for (const wall of space.walls) {
    if (!wall.segments.some((s) => s.roomId === room.id)) continue;
    const f = wallFrame(wall.mesh);
    for (const o of wall.mesh.openings) {
      if (o.kind !== 'WINDOW') continue;
      const seg = wall.segments.find((s) => s.roomId === room.id && o.offsetM >= s.from - 0.05 && o.offsetM <= s.to + 0.05);
      if (seg) out.push({ x: wall.mesh.start.x + f.dir.x * o.offsetM, y: wall.mesh.start.y + f.dir.y * o.offsetM });
    }
  }
  return out;
}

const angleOf = (from: Point, to: Point) => Math.atan2(to.y - from.y, to.x - from.x);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** True when nothing solid stands on the straight line between two plan points. */
export function clearSight(model: WalkModel, a: Point, b: Point): boolean {
  const steps = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.1));
  for (let i = 1; i < steps; i += 1) {
    const t = i / steps;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    for (const w of model.walls) {
      const dx = p.x - w.cx; const dy = p.y - w.cy;
      const c = Math.cos(w.angle); const s = Math.sin(w.angle);
      if (Math.abs(dx * c + dy * s) <= w.hw && Math.abs(-dx * s + dy * c) <= w.hd) return false;
    }
  }
  return true;
}

/** Convert a horizontal field of view to the vertical one a camera takes. */
export function verticalFov(hfovDeg: number, aspect: number): number {
  const h = (hfovDeg * Math.PI) / 180;
  return (2 * Math.atan(Math.tan(h / 2) / Math.max(0.3, aspect)) * 180) / Math.PI;
}

/**
 * The shot that shows a room best from eye level: stand in a free spot
 * near the room's edge, look across its depth toward the light, with a
 * field of view that holds the room.
 */
/** How far one can see from `at` along a heading before a wall (metres, capped). */
function sightAlong(walk: WalkModel, at: Point, heading: number, max = 12): number {
  let seen = 0;
  for (let t = 0.25; t <= max; t += 0.25) {
    if (!clearSight(walk, at, { x: at.x + Math.cos(heading) * t, y: at.y + Math.sin(heading) * t })) break;
    seen = t;
  }
  return seen;
}

/**
 * A room's shot (a room shortcut lands here): first among spots with a comfortable margin all round (never pressed
 * against a wardrobe, a wall or a bed), then — only if the room has none — among spots the body merely fits.
 */
export function roomShot(space: SpaceModel, walk: WalkModel, roomId: string, aspect = 16 / 9): CameraShot | null {
  const own = walk.radius;
  try {
    for (const r of [Math.max(own, COMFORT_RADIUS_M), own]) {
      walk.radius = r;
      const shot = roomShotAt(space, walk, roomId, aspect, r > own);
      if (shot) return shot;
    }
    return null;
  } finally {
    walk.radius = own;
  }
}

function roomShotAt(space: SpaceModel, walk: WalkModel, roomId: string, aspect: number, strict: boolean): CameraShot | null {
  const room = space.rooms.find((r) => r.id === roomId);
  if (!room) return null;
  const c = room.centroid;
  const windows = windowCentres(space, room);
  const candidates: Point[] = [];
  // Corners pulled into the room, and the midpoints of its edges.
  const poly = room.polygon;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    for (const base of [p, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }]) {
      const d = Math.hypot(c.x - base.x, c.y - base.y) || 1;
      const inset = Math.min(0.6, d * 0.4);
      candidates.push({ x: base.x + ((c.x - base.x) / d) * inset, y: base.y + ((c.y - base.y) / d) * inset });
    }
  }

  let best: { score: number; at: Point; target: Point; hfov: number } | null = null;
  for (const raw of candidates) {
    const at = isFree(walk, raw) ? raw : nearestFree(walk, raw, 0.4);
    if (!at || roomContaining(space, at) !== room.id) continue;
    // Look across the room: toward the centroid, pulled toward a window in view.
    let look = angleOf(at, c);
    const inView = windows.filter((w) => Math.abs(wrap(angleOf(at, w) - look)) < Math.PI / 3 && clearSight(walk, at, w));
    if (inView.length) {
      const w = inView[0];
      look = look + wrap(angleOf(at, w) - look) * 0.35;
    }
    // Depth and spread of what is seen from here.
    let depth = 0;
    let spread = 0;
    for (const v of poly) {
      const a = Math.abs(wrap(angleOf(at, v) - look));
      if (a < Math.PI / 2) {
        depth = Math.max(depth, Math.hypot(v.x - at.x, v.y - at.y) * Math.cos(a));
        spread = Math.max(spread, a);
      }
    }
    const hfov = Math.min(MAX_HFOV, Math.max(MIN_HFOV, ((spread * 2) * 180) / Math.PI + 8));
    // What is actually seen straight ahead: the corners of a notched room can lie behind a wall a step away.
    const seen = Math.min(depth, sightAlong(walk, at, look));
    if (seen < 1.5) continue;
    const target = { x: at.x + Math.cos(look) * Math.max(1, seen * 0.6), y: at.y + Math.sin(look) * Math.max(1, seen * 0.6) };
    if (!clearSight(walk, at, target)) continue;
    const score = seen + inView.length * 1.5 - Math.max(0, hfov - 80) * 0.05;
    if (!best || score > best.score + 1e-9) best = { score, at, target, hfov };
  }
  if (!best) {
    const at = nearestFree(walk, c, 1.5);
    if (!at || (strict && roomContaining(space, at) !== room.id)) return null;
    // Face the most open direction, never a fixed one (that can be a wall at arm's length).
    let open = 0; let far = -1;
    for (let k = 0; k < 16; k += 1) { const a = (k / 16) * Math.PI * 2; const d = sightAlong(walk, at, a); if (d > far) { far = d; open = a; } }
    const target = { x: at.x + Math.cos(open), y: at.y + Math.sin(open) };
    return { kind: 'ROOM', roomId, position: at, height: EYE_HEIGHT_M, target, targetHeight: EYE_HEIGHT_M - 0.15, fov: verticalFov(75, aspect) };
  }
  return {
    kind: 'ROOM', roomId, position: best.at, height: EYE_HEIGHT_M,
    target: best.target, targetHeight: EYE_HEIGHT_M - 0.15, fov: verticalFov(best.hfov, aspect),
  };
}

/** Where a visitor starts: just inside the entry door, facing in; else the best view of the largest room. */
export function entryShot(space: SpaceModel, walk: WalkModel, aspect = 16 / 9, graph = roomGraph(space)): CameraShot | null {
  if (graph.entryDoorId && graph.entryRoomId) {
    const door = space.doors.find((d) => d.id === graph.entryDoorId)!;
    const room = space.rooms.find((r) => r.id === graph.entryRoomId)!;
    const dir = angleOf(door.centre, room.centroid);
    const raw = { x: door.centre.x + Math.cos(dir) * 0.7, y: door.centre.y + Math.sin(dir) * 0.7 };
    const at = nearestFree(walk, raw, 0.6);
    if (at && roomContaining(space, at) === room.id) {
      // Facing on into the home: toward the nearest doorway onward from the entry room that can be seen from here
      // (a small hall's far wall is not a view); without one, straight in from the front door.
      const onward = graph.links
        .filter((l) => l.b && (l.a === room.id || l.b === room.id) && l.doorId !== graph.entryDoorId && clearSight(walk, at, l.at))
        .sort((p, q) => Math.hypot(p.at.x - at.x, p.at.y - at.y) - Math.hypot(q.at.x - at.x, q.at.y - at.y))[0];
      const look = onward ? angleOf(at, onward.at) : dir;
      const target = { x: at.x + Math.cos(look) * 2, y: at.y + Math.sin(look) * 2 };
      return { kind: 'ENTRY', roomId: room.id, position: at, height: EYE_HEIGHT_M, target, targetHeight: EYE_HEIGHT_M - 0.1, fov: verticalFov(78, aspect) };
    }
  }
  const largest = [...space.rooms].filter((r) => !r.outdoor).sort((a, b) => b.areaM2 - a.areaM2)[0];
  return largest ? roomShot(space, walk, largest.id, aspect) : null;
}
