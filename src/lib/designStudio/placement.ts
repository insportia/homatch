// DOES IT FIT? — Design Studio's own placement geometry.
//
// AI (or the customer) chooses WHAT goes in a room; this decides whether it
// physically fits. Deterministic, pure, and deliberately separate from the
// Developer interior engine (src/lib/floorplan/interior.ts): enforcing
// clearance there would change Developer Digital Twin output, so Design
// Studio carries its own rules instead of altering shared behaviour.
//
// Every footprint is an oriented rectangle in plan metres. Two kinds of
// finding, and the difference matters:
//
//   BLOCK  physically impossible — outside the room, through a wall. An
//          operation that would cause one is refused.
//   WARN   possible but worth knowing — blocks a doorway, overlaps another
//          piece, tight access in front. Shown as specific feedback; the
//          customer decides. Placement is never pretended to be perfect.
//
// When the space's dimensions are ESTIMATED, every finding is "based on the
// current estimate", and the interface says so.

import { isFlat, type CatalogAsset } from './catalog.ts';
import type { ObjectInstance } from './designState.ts';
import { shapedAsset } from './objectShape.ts';
import { pointInPolygon, wallFrame, type Point, type SpaceModel, type SpaceRoom } from './space.ts';

export interface Obb {
  cx: number;
  cy: number;
  /** Half width along the box's local x. */
  hw: number;
  /** Half depth along the box's local y. */
  hd: number;
  angle: number;
}

export function obbCorners(b: Obb): Point[] {
  const c = Math.cos(b.angle);
  const s = Math.sin(b.angle);
  const ax = { x: c * b.hw, y: s * b.hw };
  const ay = { x: -s * b.hd, y: c * b.hd };
  return [
    { x: b.cx - ax.x - ay.x, y: b.cy - ax.y - ay.y },
    { x: b.cx + ax.x - ay.x, y: b.cy + ax.y - ay.y },
    { x: b.cx + ax.x + ay.x, y: b.cy + ax.y + ay.y },
    { x: b.cx - ax.x + ay.x, y: b.cy - ax.y + ay.y },
  ];
}

/**
 * A box with its corners and axis-aligned bounds worked out once. The search
 * tests the same walls and pieces thousands of times; precomputing them is
 * what keeps a whole-room search inside a frame.
 */
export interface SolidBox {
  obb: Obb;
  corners: Point[];
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function solidBox(b: Obb): SolidBox {
  const corners = obbCorners(b);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of corners) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { obb: b, corners, minX, maxX, minY, maxY };
}

function separatedOn(ca: Point[], cb: Point[], ax: number, ay: number, epsilon: number): boolean {
  let aMin = Infinity;
  let aMax = -Infinity;
  let bMin = Infinity;
  let bMax = -Infinity;
  for (let i = 0; i < 4; i += 1) {
    const pa = ca[i].x * ax + ca[i].y * ay;
    const pb = cb[i].x * ax + cb[i].y * ay;
    if (pa < aMin) aMin = pa;
    if (pa > aMax) aMax = pa;
    if (pb < bMin) bMin = pb;
    if (pb > bMax) bMax = pb;
  }
  return aMax <= bMin + epsilon || bMax <= aMin + epsilon;
}

/**
 * Separating-axis test on precomputed boxes. Boxes whose bounds do not even
 * meet are disjoint (or only touch), so the bounds reject gives exactly the
 * answer the full test would — it is only faster.
 */
export function solidOverlap(a: SolidBox, b: SolidBox, epsilon = 0.005): boolean {
  if (a.maxX <= b.minX || b.maxX <= a.minX || a.maxY <= b.minY || b.maxY <= a.minY) return false;
  for (const t of [a.obb.angle, b.obb.angle]) {
    const c = Math.cos(t);
    const s = Math.sin(t);
    if (separatedOn(a.corners, b.corners, c, s, epsilon) || separatedOn(a.corners, b.corners, -s, c, epsilon)) return false;
  }
  return true;
}

/** Separating-axis test. Touching edges do not count as overlap. */
export function obbOverlap(a: Obb, b: Obb, epsilon = 0.005): boolean {
  return solidOverlap(solidBox(a), solidBox(b), epsilon);
}

/** The asset's local +y (its front) in plan, at a rotation. */
export function frontOf(rotation: number): Point {
  return { x: -Math.sin(rotation), y: Math.cos(rotation) };
}

/** The rotation that turns an asset's front to face along a plan direction. */
export function rotationFacing(dir: Point): number {
  return Math.atan2(-dir.x, dir.y);
}

export function footprint(asset: Pick<CatalogAsset, 'widthM' | 'depthM'>, at: Point, rotation: number): Obb {
  return { cx: at.x, cy: at.y, hw: asset.widthM / 2, hd: asset.depthM / 2, angle: rotation };
}

export type PlacementIssueCode =
  | 'NO_ROOM' | 'OUTSIDE_ROOM' | 'THROUGH_WALL' | 'BLOCKS_DOOR' | 'OVERLAPS_OBJECT' | 'TIGHT_ACCESS';

export interface PlacementIssue {
  code: PlacementIssueCode;
  severity: 'BLOCK' | 'WARN';
  /** The wall, door or object instance involved. */
  relatedId?: string;
}

export interface PlacementContext {
  space: SpaceModel;
  assets: Map<string, CatalogAsset>;
  objects: ObjectInstance[];
}

/**
 * Everything a placement is tested against, every box precomputed: the
 * walls, the doorway keep-out zones and the pieces already in the design.
 * One world serves one evaluation (evaluatePlacement) or a whole search, and
 * both go through the same tests below — so the search can never disagree
 * with the rules a customer's own move is held to.
 */
export interface PlacementWorld {
  room: SpaceRoom;
  walls: Array<{ id: string; box: SolidBox }>;
  doors: Array<{ id: string; box: SolidBox }>;
  objects: Array<{ id: string; box: SolidBox; asset: CatalogAsset; flat: boolean; object: ObjectInstance }>;
}

export function placementWorld(ctx: PlacementContext, room: SpaceRoom): PlacementWorld {
  const walls = ctx.space.walls.map((w) => {
    const f = wallFrame(w.mesh);
    return {
      id: w.id,
      box: solidBox({
        cx: (w.mesh.start.x + w.mesh.end.x) / 2,
        cy: (w.mesh.start.y + w.mesh.end.y) / 2,
        hw: f.length / 2,
        hd: w.mesh.thicknessM / 2,
        angle: f.angle,
      }),
    };
  });
  const doors: PlacementWorld['doors'] = [];
  for (const d of ctx.space.doors) {
    const zone = doorKeepOut(ctx.space, d.id);
    if (zone) doors.push({ id: d.id, box: solidBox(zone) });
  }
  const objects: PlacementWorld['objects'] = [];
  for (const o of ctx.objects) {
    const own = ctx.assets.get(o.assetId);
    if (!own) continue;
    const asset = shapedAsset(own, o);
    objects.push({
      id: o.instanceId, asset, flat: isFlat(asset), object: o,
      box: solidBox(footprint(asset, { x: o.position.x, y: o.position.z }, o.rotationY)),
    });
  }
  return { room, walls, doors, objects };
}

export const insideRoom = (world: PlacementWorld, box: SolidBox) => box.corners.every((p) => pointInPolygon(p, world.room.polygon));

/** The first wall the box goes through, or null. */
export function hitsWall(world: PlacementWorld, box: SolidBox): string | null {
  for (const w of world.walls) if (solidOverlap(box, w.box)) return w.id;
  return null;
}

/** The zone a piece needs free in front of it, `reach` metres deep. */
export function frontZone(asset: Pick<CatalogAsset, 'widthM' | 'depthM'>, at: Point, rotation: number, reach: number): SolidBox {
  const f = frontOf(rotation);
  const d = asset.depthM / 2 + reach / 2;
  return solidBox({ cx: at.x + f.x * d, cy: at.y + f.y * d, hw: asset.widthM / 2, hd: reach / 2, angle: rotation });
}

/** Is this zone inside the room and free of walls and of solid pieces? */
export function zoneClear(world: PlacementWorld, zone: SolidBox, instanceId?: string): boolean {
  if (hitsWall(world, zone) || !insideRoom(world, zone)) return false;
  for (const o of world.objects) {
    if (o.id === instanceId || o.flat) continue;
    if (solidOverlap(zone, o.box)) return false;
  }
  return true;
}

/** The zone in front of a door that must stay passable, on both sides of the wall. */
export function doorKeepOut(space: SpaceModel, doorId: string): Obb | null {
  const door = space.doors.find((d) => d.id === doorId);
  const wall = door ? space.walls.find((w) => w.id === door.wallId) : null;
  if (!door || !wall) return null;
  const f = wallFrame(wall.mesh);
  return { cx: door.centre.x, cy: door.centre.y, hw: door.widthM / 2 + 0.1, hd: 0.9, angle: f.angle };
}

export function roomOf(space: SpaceModel, roomId: string | null): SpaceRoom | null {
  return roomId ? space.rooms.find((r) => r.id === roomId) ?? null : null;
}

/**
 * Everything worth knowing about one piece standing at one place. The
 * object being moved is excluded from its own overlap check by instanceId.
 */
export function evaluatePlacement(
  ctx: PlacementContext,
  asset: CatalogAsset,
  at: Point,
  rotation: number,
  roomId: string | null,
  instanceId?: string,
): PlacementIssue[] {
  const room = roomOf(ctx.space, roomId);
  if (!room) return [{ code: 'NO_ROOM', severity: 'BLOCK' }];
  return evaluateInWorld(placementWorld(ctx, room), asset, at, rotation, instanceId);
}

/** evaluatePlacement against a prepared world — the one implementation of the rules. */
export function evaluateInWorld(
  world: PlacementWorld,
  asset: CatalogAsset,
  at: Point,
  rotation: number,
  instanceId?: string,
): PlacementIssue[] {
  const issues: PlacementIssue[] = [];
  const box = solidBox(footprint(asset, at, rotation));
  if (!insideRoom(world, box)) issues.push({ code: 'OUTSIDE_ROOM', severity: 'BLOCK' });
  const wall = hitsWall(world, box);
  if (wall) issues.push({ code: 'THROUGH_WALL', severity: 'BLOCK', relatedId: wall });

  if (!isFlat(asset)) {
    for (const door of world.doors) {
      if (solidOverlap(box, door.box)) issues.push({ code: 'BLOCKS_DOOR', severity: 'WARN', relatedId: door.id });
    }
    for (const other of world.objects) {
      if (other.id === instanceId || other.flat) continue;
      if (solidOverlap(box, other.box)) issues.push({ code: 'OVERLAPS_OBJECT', severity: 'WARN', relatedId: other.id });
    }
    if (asset.clearanceM > 0 && !zoneClear(world, frontZone(asset, at, rotation, asset.clearanceM), instanceId)) {
      issues.push({ code: 'TIGHT_ACCESS', severity: 'WARN' });
    }
  }
  return issues;
}

export const blocks = (issues: PlacementIssue[]) => issues.some((i) => i.severity === 'BLOCK');

/**
 * Candidate places for a piece in a room, in a deterministic order:
 * against the longest wall faces first, centred then stepping outwards,
 * facing into the room; or the room's centre for free-standing pieces.
 */
export function candidatePositions(ctx: PlacementContext, asset: CatalogAsset, room: SpaceRoom): Array<{ at: Point; rotation: number }> {
  const out: Array<{ at: Point; rotation: number }> = [];
  const centre = room.centroid;

  if (asset.anchor === 'CENTRE' || asset.anchor === 'FREE') {
    for (const [dx, dy] of [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4], [0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]]) {
      for (const rotation of [0, Math.PI / 2]) out.push({ at: { x: centre.x + dx, y: centre.y + dy }, rotation });
    }
    return out;
  }

  const segments = ctx.space.walls
    .flatMap((w) => w.segments.filter((s) => s.roomId === room.id).map((s) => ({ wall: w, seg: s })))
    .sort((a, b) => (b.seg.to - b.seg.from) - (a.seg.to - a.seg.from) || a.seg.surfaceId.localeCompare(b.seg.surfaceId));

  for (const { wall, seg } of segments) {
    const f = wallFrame(wall.mesh);
    const inward = seg.side === 'L' ? f.normalL : f.normalR;
    const rotation = rotationFacing(inward);
    const offset = wall.mesh.thicknessM / 2 + asset.depthM / 2 + 0.01;
    const usable = seg.to - seg.from - asset.widthM;
    if (usable < 0) continue;
    const mid = (seg.from + seg.to) / 2;
    const steps = asset.anchor === 'CORNER'
      ? [-usable / 2, usable / 2]
      : [0, ...Array.from({ length: Math.floor(usable / 0.25) }, (_, i) => (i % 2 === 0 ? 1 : -1) * 0.25 * Math.ceil((i + 1) / 2))
        .filter((d) => Math.abs(d) <= usable / 2)];
    for (const d of steps) {
      const u = mid + d;
      out.push({
        at: {
          x: wall.mesh.start.x + f.dir.x * u + inward.x * offset,
          y: wall.mesh.start.y + f.dir.y * u + inward.y * offset,
        },
        rotation,
      });
    }
  }
  return out;
}

/**
 * The first candidate with no finding at all; failing that, the first that
 * is merely imperfect (WARN); failing that, null — the room cannot take it.
 */
export function autoPlace(
  ctx: PlacementContext, asset: CatalogAsset, room: SpaceRoom,
): { at: Point; rotation: number; issues: PlacementIssue[] } | null {
  let fallback: { at: Point; rotation: number; issues: PlacementIssue[] } | null = null;
  for (const c of candidatePositions(ctx, asset, room)) {
    const issues = evaluatePlacement(ctx, asset, c.at, c.rotation, room.id);
    if (issues.length === 0) return { ...c, issues };
    if (!fallback && !blocks(issues)) fallback = { ...c, issues };
  }
  return fallback;
}

/**
 * Magnetism while dragging: when a wall-anchored piece comes within reach of
 * a wall face of its room, its back goes flat against that face.
 */
export function snapToWall(
  ctx: PlacementContext, asset: CatalogAsset, at: Point, rotation: number, roomId: string, reach = 0.35,
): { at: Point; rotation: number; snapped: boolean } {
  if (asset.anchor === 'CENTRE' || asset.anchor === 'FREE') return { at, rotation, snapped: false };
  let best: { at: Point; rotation: number; distance: number } | null = null;
  for (const wall of ctx.space.walls) {
    const f = wallFrame(wall.mesh);
    for (const seg of wall.segments) {
      if (seg.roomId !== roomId) continue;
      const inward = seg.side === 'L' ? f.normalL : f.normalR;
      const rel = { x: at.x - wall.mesh.start.x, y: at.y - wall.mesh.start.y };
      const u = rel.x * f.dir.x + rel.y * f.dir.y;
      if (u < seg.from || u > seg.to) continue;
      const faceDistance = rel.x * inward.x + rel.y * inward.y - wall.mesh.thicknessM / 2;
      const backDistance = faceDistance - asset.depthM / 2;
      if (Math.abs(backDistance) > reach) continue;
      const clampedU = Math.min(seg.to - asset.widthM / 2, Math.max(seg.from + asset.widthM / 2, u));
      const offset = wall.mesh.thicknessM / 2 + asset.depthM / 2 + 0.01;
      const snapped = {
        at: { x: wall.mesh.start.x + f.dir.x * clampedU + inward.x * offset, y: wall.mesh.start.y + f.dir.y * clampedU + inward.y * offset },
        rotation: rotationFacing(inward),
        distance: Math.abs(backDistance),
      };
      if (!best || snapped.distance < best.distance) best = snapped;
    }
  }
  return best ? { at: best.at, rotation: best.rotation, snapped: true } : { at, rotation, snapped: false };
}

/** Round to a 5 cm grid and a 15° step — the precision a design preview can honestly claim. */
export function quantise(at: Point, rotation: number): { at: Point; rotation: number } {
  const step = Math.PI / 12;
  const r = Math.round(rotation / step) * step;
  return { at: { x: Math.round(at.x * 20) / 20, y: Math.round(at.y * 20) / 20 }, rotation: Math.round(r * 1e6) / 1e6 };
}

/**
 * Line a piece up with its neighbours: when its centre comes within
 * `tolerance` of another piece's centre line in the same room (along x or
 * along y), it takes that line. Independent per axis, so a chair can line up
 * with the table on one axis and stay free on the other. Callers still
 * validate the result; holding the override key skips this entirely.
 */
export function alignToNeighbours(
  ctx: PlacementContext, at: Point, roomId: string | null, instanceId?: string, tolerance = 0.08,
): { at: Point; alignedX: boolean; alignedY: boolean } {
  let bestX: { d: number; v: number } | null = null;
  let bestY: { d: number; v: number } | null = null;
  for (const o of ctx.objects) {
    if (o.instanceId === instanceId || o.roomId !== roomId) continue;
    const dx = Math.abs(o.position.x - at.x);
    const dy = Math.abs(o.position.z - at.y);
    if (dx > 1e-6 && dx <= tolerance && (!bestX || dx < bestX.d)) bestX = { d: dx, v: o.position.x };
    if (dy > 1e-6 && dy <= tolerance && (!bestY || dy < bestY.d)) bestY = { d: dy, v: o.position.z };
  }
  return { at: { x: bestX?.v ?? at.x, y: bestY?.v ?? at.y }, alignedX: !!bestX, alignedY: !!bestY };
}
