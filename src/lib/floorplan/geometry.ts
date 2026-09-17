/**
 * THE HOMATCH GEOMETRY GENERATOR.
 *
 * Deterministic, pure, and it calls nothing. The same verified FloorPlan
 * produces byte-identical output every time, on any machine, for ever — which
 * is the property that lets a published Digital Twin be trusted and cached,
 * and the reason this layer is code rather than a model.
 *
 * THE DIVISION, RESTATED WHERE IT MATTERS MOST
 *
 * OpenAI may read a drawing. It may not build one. Nothing in this file has
 * access to a network, and nothing in it invents a measurement: every number
 * it emits is a verified number multiplied by a verified scale. Where a fact
 * is missing the generator DOES NOT BUILD THAT PART — an unverified window is
 * an absent window, never a plausible one.
 *
 * THE PIPELINE
 *
 *   normalize   pixels -> metres, origin to the plan's own corner
 *   validate    is this buildable? what is wrong with it?
 *   build       walls, floors, openings, rooms, balconies
 *   scene       one object with everything a renderer needs
 *
 * WHAT THE OUTPUT IS. Plain JSON describing boxes and polygons in metres. It
 * is not a Three.js scene: this module has no three import, so it runs in a
 * test, in a worker, or on a server without dragging a megabyte of renderer
 * behind it. The viewer turns it into meshes; the generator decides where
 * everything is.
 */

import type {
  FloorPlanDocument, WallSegment, Opening, RoomPolygon, PixelPoint, MetrePoint,
  RoomKind,
} from '@/services/developer/floorplan';

// ── What comes out ─────────────────────────────────────────────────────────

/** A wall as the renderer needs it: a line on the floor, given thickness. */
export interface WallMesh {
  id: string;
  kind: 'EXTERIOR' | 'INTERIOR';
  start: MetrePoint;
  end: MetrePoint;
  lengthM: number;
  thicknessM: number;
  heightM: number;
  /** Holes cut through it, already in metres along the wall from `start`. */
  openings: OpeningMesh[];
}

export interface OpeningMesh {
  id: string;
  kind: 'DOOR' | 'WINDOW';
  /** Metres along the wall to the opening's CENTRE. */
  offsetM: number;
  widthM: number;
  /** Metres from the floor to the bottom of the hole. */
  sillM: number;
  heightM: number;
}

export interface FloorMesh {
  id: string;
  kind: RoomKind;
  label: string | null;
  /** Closed ring in metres, counter-clockwise, first point not repeated. */
  polygon: MetrePoint[];
  areaM2: number;
  /** Where a label or a piece of furniture belongs: inside, always. */
  centroid: MetrePoint;
  /** Balconies sit outside the envelope and get no ceiling. */
  outdoor: boolean;
}

export interface GeneratedScene {
  /** Bumped whenever the generator's output would change for the same input. */
  generatorVersion: string;
  ceilingHeightM: number;
  walls: WallMesh[];
  floors: FloorMesh[];
  /** Metres. The plan's own bounding box, after normalisation. */
  extent: { width: number; depth: number };
  /** What was verified and therefore built, and what was not. */
  built: {
    walls: number; doors: number; windows: number; rooms: number; balconies: number;
  };
  skipped: {
    walls: number; doors: number; windows: number; rooms: number; balconies: number;
  };
}

export const GENERATOR_VERSION = 'homatch-geo-1';

// ── Validation ─────────────────────────────────────────────────────────────

export type GeometryProblemCode =
  | 'NO_SCALE' | 'NO_CEILING_HEIGHT' | 'NO_EXTERIOR_WALLS' | 'NO_ROOMS'
  | 'DEGENERATE_WALL' | 'ROOM_TOO_FEW_POINTS' | 'ROOM_ZERO_AREA'
  | 'OPENING_WITHOUT_WALL' | 'OPENING_WIDER_THAN_WALL' | 'OPENING_OFF_WALL';

export interface GeometryProblem {
  code: GeometryProblemCode;
  elementId?: string;
  detail?: string;
}

export interface ValidationResult {
  ok: boolean;
  /** Fatal: nothing can be generated. */
  problems: GeometryProblem[];
  /** Non-fatal: that element is skipped, the rest still builds. */
  skips: GeometryProblem[];
}

/** Elements a person has accepted. Anything else is not built. */
const isVerified = (el: { state: string }) => el.state === 'VERIFIED' || el.state === 'CORRECTED';

export function validate(doc: FloorPlanDocument): ValidationResult {
  const problems: GeometryProblem[] = [];
  const skips: GeometryProblem[] = [];

  if (doc.detectedScale == null || doc.detectedScale <= 0) {
    problems.push({ code: 'NO_SCALE' });
  }
  if (doc.ceilingHeight == null || doc.ceilingHeight <= 0) {
    problems.push({ code: 'NO_CEILING_HEIGHT' });
  }

  const walls = doc.walls.filter(isVerified);
  const rooms = doc.rooms.filter(isVerified);
  if (walls.filter((w) => w.kind === 'EXTERIOR').length === 0) {
    problems.push({ code: 'NO_EXTERIOR_WALLS' });
  }
  if (rooms.length === 0) problems.push({ code: 'NO_ROOMS' });

  for (const wall of walls) {
    if (pxLength(wall.start, wall.end) < 1) {
      skips.push({ code: 'DEGENERATE_WALL', elementId: wall.id });
    }
  }
  for (const room of [...rooms, ...doc.balconies.filter(isVerified)]) {
    if (room.polygon.length < 3) {
      skips.push({ code: 'ROOM_TOO_FEW_POINTS', elementId: room.id });
    } else if (Math.abs(shoelace(room.polygon)) < 1) {
      skips.push({ code: 'ROOM_ZERO_AREA', elementId: room.id });
    }
  }

  const wallById = new Map(walls.map((w) => [w.id, w]));
  for (const opening of [...doc.doors, ...doc.windows].filter(isVerified)) {
    const wall = wallById.get(opening.wallId);
    if (!wall) {
      skips.push({ code: 'OPENING_WITHOUT_WALL', elementId: opening.id });
      continue;
    }
    if (opening.position < 0 || opening.position > 1) {
      skips.push({ code: 'OPENING_OFF_WALL', elementId: opening.id });
      continue;
    }
    if (opening.widthPx >= pxLength(wall.start, wall.end)) {
      skips.push({ code: 'OPENING_WIDER_THAN_WALL', elementId: opening.id });
    }
  }

  return { ok: problems.length === 0, problems, skips };
}

// ── Normalisation ──────────────────────────────────────────────────────────

const pxLength = (a: PixelPoint, b: PixelPoint) => Math.hypot(b.x - a.x, b.y - a.y);

/** Twice the signed area of a ring. Sign gives the winding direction. */
function shoelace(points: PixelPoint[] | MetrePoint[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum;
}

/**
 * Pixels to metres, with the plan's own corner at the origin.
 *
 * The image's y axis points DOWN and a floor plan's forward axis points UP, so
 * y is flipped here once, at the boundary, rather than in four builders and a
 * renderer. Rounding to a tenth of a millimetre is what makes the output
 * byte-identical across machines: floating point multiplication is not, and a
 * cached scene whose hash changes on every regeneration is not cached.
 */
function makeProjector(doc: FloorPlanDocument) {
  const scale = doc.detectedScale as number;
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return (p: PixelPoint): MetrePoint => ({
    x: round(p.x * scale),
    y: round((doc.imageHeight - p.y) * scale),
  });
}

function shift(points: MetrePoint[], dx: number, dy: number): MetrePoint[] {
  const round = (n: number) => Math.round(n * 10000) / 10000;
  return points.map((p) => ({ x: round(p.x - dx), y: round(p.y - dy) }));
}

// ── Builders ───────────────────────────────────────────────────────────────

/** A wall with no drawn thickness gets the category's ordinary one. */
const DEFAULT_THICKNESS_M = { EXTERIOR: 0.3, INTERIOR: 0.1 } as const;

/** Where the drawing is silent, these are the building code's ordinary ones. */
const DEFAULT_DOOR_HEIGHT_M = 2.1;
const DEFAULT_WINDOW_SILL_M = 0.9;
const DEFAULT_WINDOW_HEIGHT_M = 1.4;

function buildWalls(
  doc: FloorPlanDocument,
  project: (p: PixelPoint) => MetrePoint,
  skipped: Set<string>,
): WallMesh[] {
  const scale = doc.detectedScale as number;
  const ceiling = doc.ceilingHeight as number;

  return doc.walls
    .filter(isVerified)
    .filter((w) => !skipped.has(w.id))
    .map((wall) => {
      const start = project(wall.start);
      const end = project(wall.end);
      const lengthM = Math.hypot(end.x - start.x, end.y - start.y);
      const openings = collectOpenings(doc, wall, scale, lengthM, skipped);
      return {
        id: wall.id,
        kind: wall.kind,
        start,
        end,
        lengthM: Math.round(lengthM * 10000) / 10000,
        thicknessM: wall.thicknessPx != null
          ? Math.round(wall.thicknessPx * scale * 10000) / 10000
          : DEFAULT_THICKNESS_M[wall.kind],
        heightM: ceiling,
        openings,
      };
    });
}

/**
 * A DOOR IS A HOLE IN A WALL, AND IT IS BUILT ONLY IF BOTH ARE VERIFIED.
 *
 * `position` is a fraction along the wall, so an opening travels with its wall
 * if an operator drags the wall's endpoints — the correction moves the hole
 * rather than orphaning it.
 */
function collectOpenings(
  doc: FloorPlanDocument,
  wall: WallSegment,
  scale: number,
  wallLengthM: number,
  skipped: Set<string>,
): OpeningMesh[] {
  const make = (opening: Opening, kind: 'DOOR' | 'WINDOW'): OpeningMesh => ({
    id: opening.id,
    kind,
    offsetM: Math.round(opening.position * wallLengthM * 10000) / 10000,
    widthM: Math.round(opening.widthPx * scale * 10000) / 10000,
    sillM: opening.sillHeightM ?? (kind === 'DOOR' ? 0 : DEFAULT_WINDOW_SILL_M),
    heightM: opening.heightM
      ?? (kind === 'DOOR' ? DEFAULT_DOOR_HEIGHT_M : DEFAULT_WINDOW_HEIGHT_M),
  });

  const usable = (o: Opening) => isVerified(o) && o.wallId === wall.id && !skipped.has(o.id);
  return [
    ...doc.doors.filter(usable).map((o) => make(o, 'DOOR')),
    ...doc.windows.filter(usable).map((o) => make(o, 'WINDOW')),
  ].sort((a, b) => a.offsetM - b.offsetM);
}

function buildFloor(
  room: RoomPolygon,
  project: (p: PixelPoint) => MetrePoint,
  outdoor: boolean,
): FloorMesh {
  let ring = room.polygon.map(project);
  // Counter-clockwise, always, so a renderer's face winding never depends on
  // which way somebody happened to trace the room.
  if (shoelace(ring) < 0) ring = [...ring].reverse();

  const area = Math.abs(shoelace(ring)) / 2;
  let cx = 0;
  let cy = 0;
  for (const p of ring) { cx += p.x; cy += p.y; }

  return {
    id: room.id,
    kind: room.kind,
    label: room.label,
    polygon: ring,
    areaM2: Math.round(area * 100) / 100,
    centroid: {
      x: Math.round((cx / ring.length) * 10000) / 10000,
      y: Math.round((cy / ring.length) * 10000) / 10000,
    },
    outdoor,
  };
}

// ── The scene ──────────────────────────────────────────────────────────────

export interface GenerateResult {
  scene: GeneratedScene | null;
  validation: ValidationResult;
}

/**
 * VERIFIED FLOOR PLAN IN, SCENE OUT. Nothing else happens here.
 *
 * Returns `scene: null` when the plan is not buildable, with the reasons —
 * the caller shows them rather than rendering half a building and hoping
 * nobody looks at the missing half.
 */
export function generateScene(doc: FloorPlanDocument): GenerateResult {
  const validation = validate(doc);
  if (!validation.ok) return { scene: null, validation };

  const skipped = new Set(validation.skips.map((s) => s.elementId).filter(Boolean) as string[]);
  const project = makeProjector(doc);

  const walls = buildWalls(doc, project, skipped);
  const rooms = doc.rooms.filter(isVerified).filter((r) => !skipped.has(r.id));
  const balconies = doc.balconies.filter(isVerified).filter((b) => !skipped.has(b.id));
  const floors = [
    ...rooms.map((r) => buildFloor(r, project, false)),
    ...balconies.map((b) => buildFloor(b, project, true)),
  ];

  // Everything shifted so the plan's own minimum corner is the origin: a scene
  // centred on the drawing rather than on wherever the image happened to sit.
  const xs = [...walls.flatMap((w) => [w.start.x, w.end.x]), ...floors.flatMap((f) => f.polygon.map((p) => p.x))];
  const ys = [...walls.flatMap((w) => [w.start.y, w.end.y]), ...floors.flatMap((f) => f.polygon.map((p) => p.y))];
  const minX = xs.length ? Math.min(...xs) : 0;
  const minY = ys.length ? Math.min(...ys) : 0;
  const round = (n: number) => Math.round(n * 10000) / 10000;

  const shiftedWalls = walls.map((w) => ({
    ...w,
    start: { x: round(w.start.x - minX), y: round(w.start.y - minY) },
    end: { x: round(w.end.x - minX), y: round(w.end.y - minY) },
  }));
  const shiftedFloors = floors.map((f) => ({
    ...f,
    polygon: shift(f.polygon, minX, minY),
    centroid: { x: round(f.centroid.x - minX), y: round(f.centroid.y - minY) },
  }));

  const built = {
    walls: shiftedWalls.length,
    doors: shiftedWalls.reduce((n, w) => n + w.openings.filter((o) => o.kind === 'DOOR').length, 0),
    windows: shiftedWalls.reduce((n, w) => n + w.openings.filter((o) => o.kind === 'WINDOW').length, 0),
    rooms: rooms.length,
    balconies: balconies.length,
  };

  const countUnbuilt = <T extends { state: string; id: string }>(items: T[]) =>
    items.filter((i) => !isVerified(i) || skipped.has(i.id)).length;

  return {
    scene: {
      generatorVersion: GENERATOR_VERSION,
      ceilingHeightM: doc.ceilingHeight as number,
      walls: shiftedWalls,
      floors: shiftedFloors,
      extent: {
        width: round((xs.length ? Math.max(...xs) : 0) - minX),
        depth: round((ys.length ? Math.max(...ys) : 0) - minY),
      },
      built,
      skipped: {
        walls: countUnbuilt(doc.walls),
        doors: countUnbuilt(doc.doors),
        windows: countUnbuilt(doc.windows),
        rooms: countUnbuilt(doc.rooms),
        balconies: countUnbuilt(doc.balconies),
      },
    },
    validation,
  };
}

/** Total built floor area. The number to compare against the printed one. */
export function totalAreaM2(scene: GeneratedScene, includeOutdoor = false): number {
  return Math.round(scene.floors
    .filter((f) => includeOutdoor || !f.outdoor)
    .reduce((sum, f) => sum + f.areaM2, 0) * 100) / 100;
}
