// THE SPACE, AS THE DESIGN LAYER SEES IT.
//
// The canonical geometry (walls, openings, room floors in metres) becomes a
// SpaceModel: rooms with bounds, walls with the rooms on each side, and a
// stable id for every surface a design can dress. Everything a design
// version references — "floor:r-1", "wall:w-3:L" — comes from here, so a
// version made today still addresses the same surfaces tomorrow.
//
// COORDINATES. Plan metres (x, y) with y "up the drawing". The renderer maps
// them to three.js as (x, height, -y); that mapping lives in one place
// (wallFrame) and is tested, because the Developer shell's diagonal walls
// show what happens when it is written twice.
//
// Pure: no three.js, no network.

import type { FloorMesh, GeneratedScene, StairMesh, WallMesh } from '../floorplan/geometry.ts';
import type { RoomKind } from '../../services/developer/floorplan.ts';

export interface Point { x: number; y: number }

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export interface SpaceRoom {
  id: string;
  kind: RoomKind;
  label: string | null;
  polygon: Point[];
  areaM2: number;
  centroid: Point;
  bounds: Bounds;
  outdoor: boolean;
}

export type WallSide = 'L' | 'R';

/**
 * One stretch of one face of a wall, looking into one room. A wall that runs
 * past three rooms has (up to) three segments on each face; each is its own
 * design surface, so painting the living room never paints the hall.
 */
export interface WallFaceSegment {
  surfaceId: string;
  side: WallSide;
  roomId: string;
  /** Metres along the wall from its start. */
  from: number;
  to: number;
}

export interface SpaceWall {
  id: string;
  kind: 'EXTERIOR' | 'INTERIOR';
  mesh: WallMesh;
  segments: WallFaceSegment[];
}

export interface SpaceDoor {
  id: string;
  wallId: string;
  /** Plan position of the opening's centre. */
  centre: Point;
  widthM: number;
}

export type SurfaceKind = 'FLOOR' | 'WALL' | 'CEILING';

export interface SpaceSurface {
  id: string;
  kind: SurfaceKind;
  roomId: string | null;
  wallId: string | null;
}

export interface SpaceModel {
  ceilingHeightM: number;
  extent: { width: number; depth: number };
  rooms: SpaceRoom[];
  walls: SpaceWall[];
  doors: SpaceDoor[];
  surfaces: SpaceSurface[];
  /** Built architecture the design walks around and never moves (empty on older scenes). */
  stairs: StairMesh[];
}

export const floorSurfaceId = (roomId: string) => `floor:${roomId}`;
export const ceilingSurfaceId = (roomId: string) => `ceiling:${roomId}`;
export const wallSurfaceId = (wallId: string, side: WallSide, roomId: string) => `wall:${wallId}:${side}:${roomId}`;

export function parseSurfaceId(id: string):
  | { kind: 'FLOOR' | 'CEILING'; roomId: string }
  | { kind: 'WALL'; wallId: string; side: WallSide; roomId: string }
  | null {
  const [kind, a, b, c] = id.split(':');
  if (kind === 'floor' && a) return { kind: 'FLOOR', roomId: a };
  if (kind === 'ceiling' && a) return { kind: 'CEILING', roomId: a };
  if (kind === 'wall' && a && (b === 'L' || b === 'R') && c) return { kind: 'WALL', wallId: a, side: b, roomId: c };
  return null;
}

export function boundsOf(points: Point[]): Bounds {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

/** Ray casting; points on an edge count as inside. */
export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    const onEdge = Math.abs((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) < 1e-9
      && p.x >= Math.min(a.x, b.x) - 1e-9 && p.x <= Math.max(a.x, b.x) + 1e-9
      && p.y >= Math.min(a.y, b.y) - 1e-9 && p.y <= Math.max(a.y, b.y) + 1e-9;
    if (onEdge) return true;
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * A wall's frame in plan space: its direction, its two face normals and its
 * angle. `L` is the face on the left when walking from start to end.
 *
 * The renderer turns this into three.js with rotation.y = +angle and
 * z = -y; with that, the box's local +z face is the R side and -z is L.
 */
export function wallFrame(wall: Pick<WallMesh, 'start' | 'end'>) {
  const dx = wall.end.x - wall.start.x;
  const dy = wall.end.y - wall.start.y;
  const length = Math.hypot(dx, dy) || 1;
  const dir = { x: dx / length, y: dy / length };
  return {
    angle: Math.atan2(dy, dx),
    dir,
    normalL: { x: -dir.y, y: dir.x },
    normalR: { x: dir.y, y: -dir.x },
    length,
  };
}

function roomAt(p: Point, rooms: SpaceRoom[]): string | null {
  // Smallest containing room wins, so a room drawn inside another resolves to the inner one.
  let best: SpaceRoom | null = null;
  for (const room of rooms) {
    if (pointInPolygon(p, room.polygon) && (!best || room.areaM2 < best.areaM2)) best = room;
  }
  return best?.id ?? null;
}

function toRoom(floor: FloorMesh): SpaceRoom {
  return {
    id: floor.id,
    kind: floor.kind,
    label: floor.label,
    polygon: floor.polygon,
    areaM2: floor.areaM2,
    centroid: floor.centroid,
    bounds: boundsOf(floor.polygon),
    outdoor: floor.outdoor,
  };
}

/** Rooms a flight of stairs can never fill: living space the reading itself named. */
const LIVED_IN: ReadonlySet<string> = new Set(['LIVING', 'BEDROOM', 'KITCHEN', 'BATHROOM', 'WC']);
/** A "flight" covering at least this share of such a room is a misreading, not architecture. */
export const STAIR_FILLS_ROOM = 0.8;

/**
 * The flights a home really has. Plan reading also looks for flights the model
 * missed, by tread-like evenly spaced lines; in a drawing that has such lines
 * inside a bedroom (production, 2026-10-03: both bedrooms of a one-staircase
 * plan read as flights) the "stairs" fill the whole room. A flight that covers
 * most of a room the reading named as lived-in space is that misreading: it is
 * left out of the space, so nothing is built, walked into or furnished around
 * it. A flight in its own compartment, a hall or open to a living room is kept.
 */
export function credibleStairs(stairs: StairMesh[], rooms: Array<Pick<SpaceRoom, 'kind' | 'polygon'>>): StairMesh[] {
  const STEP = 0.1;
  return stairs.filter((st) => {
    const flight = st.polygon as Point[];
    if (flight.length < 3) return true;
    return !rooms.some((room) => {
      if (!LIVED_IN.has(room.kind)) return false;
      const b = boundsOf(room.polygon);
      let inside = 0; let covered = 0;
      for (let x = b.minX + STEP / 2; x < b.maxX; x += STEP) {
        for (let y = b.minY + STEP / 2; y < b.maxY; y += STEP) {
          const p = { x, y };
          if (!pointInPolygon(p, room.polygon)) continue;
          inside += 1;
          if (pointInPolygon(p, flight)) covered += 1;
        }
      }
      return inside > 0 && covered / inside >= STAIR_FILLS_ROOM;
    });
  });
}

export function buildSpaceModel(scene: GeneratedScene): SpaceModel {
  const rooms = scene.floors.map(toRoom);

  const walls: SpaceWall[] = scene.walls.map((mesh) => {
    const frame = wallFrame(mesh);
    // Probe just beyond each face (half the thickness plus a few centimetres)
    // every 5 cm along the wall, and group the runs by the room found.
    const probe = mesh.thicknessM / 2 + 0.05;
    const STEP = 0.05;
    const segments: WallFaceSegment[] = [];
    for (const side of ['L', 'R'] as const) {
      const n = side === 'L' ? frame.normalL : frame.normalR;
      let run: { roomId: string | null; from: number } | null = null;
      const close = (to: number) => {
        if (run?.roomId && to - run.from >= 0.1) {
          segments.push({
            surfaceId: wallSurfaceId(mesh.id, side, run.roomId),
            side,
            roomId: run.roomId,
            from: Math.round(run.from * 10000) / 10000,
            to: Math.round(to * 10000) / 10000,
          });
        }
      };
      const steps = Math.max(1, Math.ceil(frame.length / STEP));
      for (let i = 0; i <= steps; i += 1) {
        const u = Math.min(frame.length, i * STEP);
        const roomId = roomAt({
          x: mesh.start.x + frame.dir.x * u + n.x * probe,
          y: mesh.start.y + frame.dir.y * u + n.y * probe,
        }, rooms);
        if (!run) { run = { roomId, from: 0 }; continue; }
        if (roomId !== run.roomId) {
          const boundary = Math.max(0, u - STEP / 2);
          close(boundary);
          run = { roomId, from: boundary };
        }
      }
      close(frame.length);
    }
    return { id: mesh.id, kind: mesh.kind, mesh, segments };
  });

  const doors: SpaceDoor[] = [];
  for (const wall of scene.walls) {
    const frame = wallFrame(wall);
    for (const o of wall.openings) {
      if (o.kind !== 'DOOR') continue;
      doors.push({
        id: o.id,
        wallId: wall.id,
        centre: { x: wall.start.x + frame.dir.x * o.offsetM, y: wall.start.y + frame.dir.y * o.offsetM },
        widthM: o.widthM,
      });
    }
  }

  const surfaces: SpaceSurface[] = [];
  for (const room of rooms) {
    surfaces.push({ id: floorSurfaceId(room.id), kind: 'FLOOR', roomId: room.id, wallId: null });
    if (!room.outdoor) surfaces.push({ id: ceilingSurfaceId(room.id), kind: 'CEILING', roomId: room.id, wallId: null });
  }
  // A face that looks at nothing (the outside of an exterior wall) is not a design surface.
  const seen = new Set<string>();
  for (const wall of walls) {
    for (const seg of wall.segments) {
      if (seen.has(seg.surfaceId)) continue;
      seen.add(seg.surfaceId);
      surfaces.push({ id: seg.surfaceId, kind: 'WALL', roomId: seg.roomId, wallId: wall.id });
    }
  }

  return { ceilingHeightM: scene.ceilingHeightM, extent: scene.extent, rooms, walls, doors, surfaces, stairs: credibleStairs(scene.stairs ?? [], rooms) };
}

/** Every surface that belongs to one room: its floor, ceiling and the wall faces looking into it. */
export function surfacesOfRoom(space: SpaceModel, roomId: string): SpaceSurface[] {
  return space.surfaces.filter((s) => s.roomId === roomId);
}

/** The room a plan point stands in, or null. */
export function roomContaining(space: SpaceModel, p: Point): string | null {
  return roomAt(p, space.rooms);
}

/** A plan point at a height, in three.js world coordinates (y up, z = -plan y). */
export function toWorld(p: Point, height = 0): { x: number; y: number; z: number } {
  return { x: p.x, y: height, z: -p.y };
}

/**
 * Where a box slab of a wall sits in the world: its centre, and the
 * rotation about Y that lines the box's local +x up with the wall. With this
 * rotation the box's local +z face is the wall's R side and -z its L side.
 */
export function wallSlabPlacement(
  wall: Pick<WallMesh, 'start' | 'end'>,
  u: number, v: number, lengthM: number, heightM: number,
): { position: { x: number; y: number; z: number }; rotationY: number } {
  const frame = wallFrame(wall);
  const mid = u + lengthM / 2;
  const centre = { x: wall.start.x + frame.dir.x * mid, y: wall.start.y + frame.dir.y * mid };
  return { position: toWorld(centre, v + heightM / 2), rotationY: frame.angle };
}

/** The same rotation three.js applies, for tests: R_y(θ)·(x, y, z). */
export function rotateY(v: { x: number; y: number; z: number }, theta: number) {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}
