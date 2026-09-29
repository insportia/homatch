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

/** Separating-axis test. Touching edges do not count as overlap. */
export function obbOverlap(a: Obb, b: Obb, epsilon = 0.005): boolean {
  const ca = obbCorners(a);
  const cb = obbCorners(b);
  const axes = [a.angle, a.angle + Math.PI / 2, b.angle, b.angle + Math.PI / 2]
    .map((t) => ({ x: Math.cos(t), y: Math.sin(t) }));
  for (const axis of axes) {
    const pa = ca.map((p) => p.x * axis.x + p.y * axis.y);
    const pb = cb.map((p) => p.x * axis.x + p.y * axis.y);
    if (Math.max(...pa) <= Math.min(...pb) + epsilon || Math.max(...pb) <= Math.min(...pa) + epsilon) return false;
  }
  return true;
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

function wallObbs(space: SpaceModel): Array<{ id: string; box: Obb }> {
  return space.walls.map((w) => {
    const f = wallFrame(w.mesh);
    return {
      id: w.id,
      box: {
        cx: (w.mesh.start.x + w.mesh.end.x) / 2,
        cy: (w.mesh.start.y + w.mesh.end.y) / 2,
        hw: f.length / 2,
        hd: w.mesh.thicknessM / 2,
        angle: f.angle,
      },
    };
  });
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
  const issues: PlacementIssue[] = [];
  const room = roomOf(ctx.space, roomId);
  if (!room) return [{ code: 'NO_ROOM', severity: 'BLOCK' }];

  const box = footprint(asset, at, rotation);
  const corners = obbCorners(box);
  if (!corners.every((p) => pointInPolygon(p, room.polygon))) {
    issues.push({ code: 'OUTSIDE_ROOM', severity: 'BLOCK' });
  }
  for (const wall of wallObbs(ctx.space)) {
    if (obbOverlap(box, wall.box)) {
      issues.push({ code: 'THROUGH_WALL', severity: 'BLOCK', relatedId: wall.id });
      break;
    }
  }

  const flat = isFlat(asset);
  if (!flat) {
    for (const door of ctx.space.doors) {
      const zone = doorKeepOut(ctx.space, door.id);
      if (zone && obbOverlap(box, zone)) issues.push({ code: 'BLOCKS_DOOR', severity: 'WARN', relatedId: door.id });
    }
    for (const other of ctx.objects) {
      if (other.instanceId === instanceId) continue;
      const otherAsset = ctx.assets.get(other.assetId);
      if (!otherAsset || isFlat(otherAsset)) continue;
      const otherBox = footprint(otherAsset, { x: other.position.x, y: other.position.z }, other.rotationY);
      if (obbOverlap(box, otherBox)) issues.push({ code: 'OVERLAPS_OBJECT', severity: 'WARN', relatedId: other.instanceId });
    }
    if (asset.clearanceM > 0) {
      const f = frontOf(rotation);
      const reach = asset.depthM / 2 + asset.clearanceM / 2;
      const zone: Obb = { cx: at.x + f.x * reach, cy: at.y + f.y * reach, hw: asset.widthM / 2, hd: asset.clearanceM / 2, angle: rotation };
      const zoneCorners = obbCorners(zone);
      const blockedByWall = wallObbs(ctx.space).some((w) => obbOverlap(zone, w.box))
        || !zoneCorners.every((p) => pointInPolygon(p, room.polygon));
      const blockedByObject = ctx.objects.some((o) => {
        if (o.instanceId === instanceId) return false;
        const a = ctx.assets.get(o.assetId);
        return !!a && !isFlat(a) && obbOverlap(zone, footprint(a, { x: o.position.x, y: o.position.z }, o.rotationY));
      });
      if (blockedByWall || blockedByObject) issues.push({ code: 'TIGHT_ACCESS', severity: 'WARN' });
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
