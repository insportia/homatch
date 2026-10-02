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
  RoomKind, StairFlight,
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
  /** How it closes (OpeningLeaf); absent when the drawing does not say. */
  leaf?: import('@/services/developer/floorplan').OpeningLeaf | null;
  /**
   * The face of the wall a swinging leaf opens towards (L: left walking
   * start→end), resolved from the drawing's swingRoomId. Absent when the
   * drawing does not say; a renderer then swings into the larger room.
   */
  swing?: 'L' | 'R';
}

/**
 * A straight flight, in metres: it starts at the edge a→b (the first tread's
 * front, the flight's full width) and climbs `runM` in the direction
 * perpendicular to a→b that points into its footprint, `treads` equal steps
 * up to `riseM`.
 *
 * The generator orders a and b so that the footprint lies on the LEFT of a→b
 * (the climb direction is (-dy, dx) normalised), so every consumer can take
 * the left normal without testing the polygon; `stairFrame` does exactly that.
 * DOWN flights descend from a→b (a stairwell); UP flights climb from it.
 */
export interface StairMesh {
  id: string;
  a: MetrePoint;
  b: MetrePoint;
  runM: number;
  riseM: number;
  treads: number;
  direction: 'UP' | 'DOWN';
  /** The footprint as drawn, counter-clockwise: walked around, never through. */
  polygon: MetrePoint[];
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
  /** Absent on scenes generated before stairs were read (homatch-geo-1). */
  stairs?: StairMesh[];
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
  | 'OPENING_WITHOUT_WALL' | 'OPENING_WIDER_THAN_WALL' | 'OPENING_OFF_WALL'
  | 'STAIR_TOO_FEW_POINTS' | 'STAIR_ZERO_AREA' | 'STAIR_DEGENERATE';

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

  if (doc.detectedScale != null && doc.detectedScale > 0) {
    for (const stair of (doc.stairs ?? []).filter(isVerified)) {
      const problem = stairProblem(stair, doc.detectedScale);
      if (problem) skips.push({ code: problem, elementId: stair.id });
    }
  }

  return { ok: problems.length === 0, problems, skips };
}

/** The smallest flight worth building: a person's width, two treads deep. */
const MIN_STAIR_WIDTH_M = 0.5;
const MIN_STAIR_RUN_M = 0.5;

function stairProblem(stair: StairFlight, scale: number): GeometryProblemCode | null {
  const poly = Array.isArray(stair.polygon) ? stair.polygon : [];
  if (poly.length < 3) return 'STAIR_TOO_FEW_POINTS';
  if (!poly.every((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y))) return 'STAIR_DEGENERATE';
  if (Math.abs(shoelace(poly)) / 2 * scale * scale < 0.25) return 'STAIR_ZERO_AREA';
  if (stair.startEdge) {
    const [a, b] = stair.startEdge;
    if (!a || !b || !Number.isFinite(a.x + a.y + b.x + b.y)) return 'STAIR_DEGENERATE';
    if (pxLength(a, b) * scale < MIN_STAIR_WIDTH_M) return 'STAIR_DEGENERATE';
  }
  return null;
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
      resolveSwings(doc, wall, openings, start, end, lengthM, project);
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
/** Ray casting in metres; enough to tell which side of a wall a room is on. */
function insideRing(p: MetrePoint, ring: MetrePoint[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * The side a swinging leaf opens to, from the room the drawing says it opens
 * into: probe 0.3 m beyond each face at the opening's centre. Only set when
 * the opening has a swinging leaf and exactly one face finds that room.
 */
function resolveSwings(
  doc: FloorPlanDocument, wall: WallSegment, openings: OpeningMesh[],
  start: MetrePoint, end: MetrePoint, lengthM: number, project: (p: PixelPoint) => MetrePoint,
) {
  const swingers = new Set(['HINGED', 'DOUBLE', 'FRENCH']);
  const byId = new Map([...doc.doors, ...doc.windows].filter((o) => o.wallId === wall.id).map((o) => [o.id, o]));
  for (const mesh of openings) {
    const source = byId.get(mesh.id);
    if (!source?.swingRoomId || !mesh.leaf || !swingers.has(mesh.leaf)) continue;
    const room = [...doc.rooms, ...doc.balconies].find((r) => r.id === source.swingRoomId && isVerified(r));
    if (!room || room.polygon.length < 3) continue;
    const ring = room.polygon.map(project);
    const len = lengthM || 1;
    const dir = { x: (end.x - start.x) / len, y: (end.y - start.y) / len };
    const c = { x: start.x + dir.x * mesh.offsetM, y: start.y + dir.y * mesh.offsetM };
    const left = insideRing({ x: c.x - dir.y * 0.3, y: c.y + dir.x * 0.3 }, ring);
    const right = insideRing({ x: c.x + dir.y * 0.3, y: c.y - dir.x * 0.3 }, ring);
    if (left !== right) mesh.swing = left ? 'L' : 'R';
  }
}

function collectOpenings(
  doc: FloorPlanDocument,
  wall: WallSegment,
  scale: number,
  wallLengthM: number,
  skipped: Set<string>,
): OpeningMesh[] {
  const ceiling = doc.ceilingHeight as number;
  const make = (opening: Opening, kind: 'DOOR' | 'WINDOW'): OpeningMesh => {
    // A FRENCH leaf is a full-height glazed door (a balcony's): it starts at
    // the floor and stops a lintel short of the ceiling, unless drawn otherwise.
    const french = opening.leaf === 'FRENCH';
    const mesh: OpeningMesh = {
      id: opening.id,
      kind,
      offsetM: Math.round(opening.position * wallLengthM * 10000) / 10000,
      widthM: Math.round(opening.widthPx * scale * 10000) / 10000,
      sillM: opening.sillHeightM ?? (kind === 'DOOR' || french ? 0 : DEFAULT_WINDOW_SILL_M),
      heightM: opening.heightM
        ?? (french ? fullHeightDoorM(ceiling) : kind === 'DOOR' ? DEFAULT_DOOR_HEIGHT_M : DEFAULT_WINDOW_HEIGHT_M),
    };
    // Present only when the drawing says: a reading without leaves produces
    // exactly the scene it always did, so cached Developer scenes stay valid.
    if (opening.leaf) mesh.leaf = opening.leaf;
    return mesh;
  };

  const usable = (o: Opening) => isVerified(o) && o.wallId === wall.id && !skipped.has(o.id);
  return [
    ...doc.doors.filter(usable).map((o) => make(o, 'DOOR')),
    ...doc.windows.filter(usable).map((o) => make(o, 'WINDOW')),
  ].sort((a, b) => a.offsetM - b.offsetM);
}

/** A full-height door: the ceiling less a 0.2 m lintel, never lower than an ordinary door. */
function fullHeightDoorM(ceiling: number): number {
  return Math.max(DEFAULT_DOOR_HEIGHT_M, Math.round((ceiling - 0.2) * 10000) / 10000);
}

// ── Stairs ─────────────────────────────────────────────────────────────────

/** An ordinary going (tread depth), for counting treads the drawing did not. */
const TYPICAL_GOING_M = 0.27;
export const MIN_STAIR_TREADS = 3;
export const MAX_STAIR_TREADS = 25;

/** Unit vectors of a flight: along its start edge, and up the climb (left of a→b). */
export function stairFrame(stair: Pick<StairMesh, 'a' | 'b'>) {
  const dx = stair.b.x - stair.a.x;
  const dy = stair.b.y - stair.a.y;
  const widthM = Math.hypot(dx, dy) || 1;
  const along = { x: dx / widthM, y: dy / widthM };
  return { along, climb: { x: -along.y, y: along.x }, widthM };
}

const dot = (p: MetrePoint, d: MetrePoint) => p.x * d.x + p.y * d.y;

function segmentDistance(p: MetrePoint, a: MetrePoint, b: MetrePoint): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/**
 * WHERE A FLIGHT STARTS, WHEN THE DRAWING DOES NOT SAY.
 *
 * The footprint's frame is taken from its longest edge; a flight climbs along
 * its longer extent, so the two candidate start edges are the short ends of
 * that oriented box. Of the two, deterministically:
 *   1. the end nearer a verified door (edge midpoint, within 4 m, by more
 *      than 1 cm) — a flight is stepped onto from the circulation;
 *   2. otherwise the end with more clearance from the nearest wall — the top
 *      of a flight usually lands against a wall, its foot does not;
 *   3. otherwise (a tie) the end at the lower coordinate along the run.
 */
function inferStartEdge(
  ring: MetrePoint[], doorCentres: MetrePoint[], walls: Array<{ start: MetrePoint; end: MetrePoint }>,
): [MetrePoint, MetrePoint] {
  let longest = 0;
  let axis = { x: 1, y: 0 };
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len > longest + 1e-9) { longest = len; axis = { x: (q.x - p.x) / len, y: (q.y - p.y) / len }; }
  }
  const perp = { x: -axis.y, y: axis.x };
  const us = ring.map((p) => dot(p, axis));
  const vs = ring.map((p) => dot(p, perp));
  const alongAxis = Math.max(...us) - Math.min(...us) >= Math.max(...vs) - Math.min(...vs);
  const run = alongAxis ? axis : perp;
  const span = alongAxis ? perp : axis;
  const rs = alongAxis ? us : vs;
  const ss = alongAxis ? vs : us;
  const [r0, r1, s0, s1] = [Math.min(...rs), Math.max(...rs), Math.min(...ss), Math.max(...ss)];
  const at = (r: number, s: number): MetrePoint => ({ x: run.x * r + span.x * s, y: run.y * r + span.y * s });
  const ends = [r0, r1].map((r) => ({
    edge: [at(r, s0), at(r, s1)] as [MetrePoint, MetrePoint],
    mid: at(r, (s0 + s1) / 2),
  }));
  const nearestDoor = (m: MetrePoint) => Math.min(Infinity, ...doorCentres.map((d) => Math.hypot(d.x - m.x, d.y - m.y)));
  const [d0, d1] = ends.map((e) => nearestDoor(e.mid));
  if (Math.min(d0, d1) <= 4 && Math.abs(d0 - d1) > 0.01) return d0 < d1 ? ends[0].edge : ends[1].edge;
  const clearance = (m: MetrePoint) => Math.min(Infinity, ...walls.map((w) => segmentDistance(m, w.start, w.end)));
  const [c0, c1] = ends.map((e) => clearance(e.mid));
  if (Number.isFinite(c0) && Number.isFinite(c1) && Math.abs(c0 - c1) > 0.01) return c0 > c1 ? ends[0].edge : ends[1].edge;
  return ends[0].edge;
}

/**
 * A verified flight in metres: projected and rounded like every other
 * element, a and b ordered so the footprint lies to the left of a→b.
 * Null when what is left after projection is too small to climb.
 */
function buildStair(
  stair: StairFlight,
  project: (p: PixelPoint) => MetrePoint,
  ceiling: number,
  doorCentres: MetrePoint[],
  walls: Array<{ start: MetrePoint; end: MetrePoint }>,
): StairMesh | null {
  const round = (n: number) => Math.round(n * 10000) / 10000;
  let ring = stair.polygon.map(project);
  if (shoelace(ring) < 0) ring = [...ring].reverse();
  let [a, b] = stair.startEdge
    ? [project(stair.startEdge[0]), project(stair.startEdge[1])]
    : inferStartEdge(ring, doorCentres, walls);
  let cx = 0;
  let cy = 0;
  for (const p of ring) { cx += p.x; cy += p.y; }
  const centre = { x: cx / ring.length, y: cy / ring.length };
  if ((b.x - a.x) * (centre.y - a.y) - (b.y - a.y) * (centre.x - a.x) < 0) [a, b] = [b, a];
  const { climb, widthM } = stairFrame({ a, b });
  const runM = Math.max(...ring.map((p) => (p.x - a.x) * climb.x + (p.y - a.y) * climb.y));
  if (!(widthM >= MIN_STAIR_WIDTH_M) || !(runM >= MIN_STAIR_RUN_M)) return null;
  const drawn = stair.treads != null && Number.isFinite(stair.treads) ? Math.round(stair.treads) : null;
  const treads = Math.max(MIN_STAIR_TREADS, Math.min(MAX_STAIR_TREADS, drawn ?? Math.round(runM / TYPICAL_GOING_M)));
  return {
    id: stair.id,
    a: { x: round(a.x), y: round(a.y) },
    b: { x: round(b.x), y: round(b.y) },
    runM: round(runM),
    riseM: ceiling,
    treads,
    // A flight whose direction the drawing does not show is built going up.
    direction: stair.direction === 'DOWN' ? 'DOWN' : 'UP',
    polygon: ring.map((p) => ({ x: round(p.x), y: round(p.y) })),
  };
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

  // Stairs: verified flights only, and never part of the extent (a flight sits
  // inside the rooms, and a plan without stairs must not move).
  const doorCentres = walls.flatMap((w) => {
    const len = w.lengthM || 1;
    return w.openings.filter((o) => o.kind === 'DOOR').map((o) => ({
      x: w.start.x + ((w.end.x - w.start.x) / len) * o.offsetM,
      y: w.start.y + ((w.end.y - w.start.y) / len) * o.offsetM,
    }));
  });
  const stairs = (doc.stairs ?? [])
    .filter(isVerified)
    .filter((s) => !skipped.has(s.id))
    .map((s) => buildStair(s, project, doc.ceilingHeight as number, doorCentres, walls))
    .filter((s): s is StairMesh => s != null);

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

  const shiftedStairs = stairs.map((st) => ({
    ...st,
    a: { x: round(st.a.x - minX), y: round(st.a.y - minY) },
    b: { x: round(st.b.x - minX), y: round(st.b.y - minY) },
    polygon: shift(st.polygon, minX, minY),
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
      // Absent, not empty, when nothing was built: a plan without stairs
      // produces exactly the scene it always did.
      ...(shiftedStairs.length ? { stairs: shiftedStairs } : {}),
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
