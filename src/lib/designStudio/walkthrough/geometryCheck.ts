// IS THIS THE HOME? THE GEOMETRY IS CHECKED BEFORE A SINGLE PIECE IS PLACED.
//
// A walkthrough built from pictures (inferredSpace.ts) stands on a reading of them. When that reading is wrong —
// a room missing, rooms drawn as slanted diamonds, a bedroom too small for the bed it was seen with, a room no door
// reaches, pieces of one room scattered across the home — no amount of furniture placement makes the tour the home,
// and the walkability gate only finds out after the work (and the GPU) is spent. This file judges the built space
// against the evidence it came from, deterministically, before furnishing:
//
//   rooms        every space the customer's own picture shows (the photo reading, PHOTO_UNDERSTANDING, with its
//                confidence) is a room of the space: bedrooms counted, the day space (living / kitchen), the bathroom,
//                the terrace or balcony                                                    → EXPECTED_ROOM_MISSING
//   dropped      pieces the reading put in a room the space does not have               → ROOM_DROPPED
//   shape        every outline is a simple polygon whose walls run along the home's two wall directions
//                                                                                          → ROOM_SHAPE_INVALID
//   consistency  a room's own pieces stand in it                                        → PIECES_OUTSIDE_ROOM
//   fit          a bedroom holds the bed it was seen with (or a single bed), with a way to it
//                                                                                          → ESSENTIAL_DOES_NOT_FIT
//   reach        a walker from the entrance reaches every indoor room                    → ROOM_UNREACHABLE
//   footprint    the measured outline of the home (when it is known in the scene's frame) is covered by rooms
//                                                                                          → FOOTPRINT_UNCOVERED
//
// Each room is CONFIRMED (read and consistent), RECOVERED (corrected by a recorded repair, and consistent) or
// UNCERTAIN (an issue names it). The verdict is PASS only with no blocking issue; a FAIL says exactly what is
// missing or wrong. Nothing here changes the geometry: it never invents a room to make a gate pass.
//
// Pure and deterministic (Deno + Node).

import { dominantDirections } from './readingRepair.ts';

export const GEOMETRY_CHECK_VERSION = 'ds-geometry-check-1';

type P = [number, number];
export type RoomStatus = 'CONFIRMED' | 'RECOVERED' | 'UNCERTAIN';
export type GeometryIssueCode =
  | 'EXPECTED_ROOM_MISSING' | 'ROOM_DROPPED' | 'ROOM_SHAPE_INVALID' | 'PIECES_OUTSIDE_ROOM' | 'ESSENTIAL_DOES_NOT_FIT'
  | 'ROOM_UNREACHABLE' | 'FOOTPRINT_UNCOVERED' | 'NO_ROOMS';

export interface GeometryIssue { code: GeometryIssueCode; room: string | null; detail: string; blocking: boolean }
export interface GeometryCheck {
  version: typeof GEOMETRY_CHECK_VERSION;
  verdict: 'PASS' | 'FAIL';
  rooms: Array<{ id: string; kind: string; areaM2: number; status: RoomStatus; reasons: GeometryIssueCode[] }>;
  /** Spaces the evidence shows that the geometry does not have: what a second reading would have to find. */
  missing: Array<{ space: string; expected: number; found: number; evidence: string[] }>;
  issues: GeometryIssue[];
}

export interface CheckRoom { id: string; kind: string; outdoor: boolean; polygon: Array<{ x: number; y: number }> }
/** A piece as the reading placed it (scene metres); `room` is the reading's room key (the floor id is `r-<key>`). */
export interface CheckPiece { type: string; room: string | null; at: P; widthM: number; depthM: number; basis?: string }
/** A space the customer's own picture shows (photoProject.ts PhotoRoomKind), with how sure that reading was. */
export interface ExpectedSpace { kind: string; label?: string | null; confidence?: number | null }

export interface GeometryCheckInput {
  rooms: CheckRoom[];
  pieces?: CheckPiece[];
  expected?: ExpectedSpace[] | null;
  /** Indoor room ids a walker from the entrance does not reach (inferredSpace.ts). */
  unreachable?: string[];
  /** Repairs recorded on the way (inferredSpace.ts Repair): which rooms were corrected. */
  repairs?: Array<{ code: string; element: string }>;
  /** The home's measured outline, in the scene's own frame; omitted when that frame is not known. */
  footprint?: P[] | null;
}

// ── Kinds ────────────────────────────────────────────────────────────────────

/** The spaces counted against the picture: a space's kind, and the room kinds that stand for it. */
const SPACES: Array<{ space: string; picture: string[]; rooms: string[]; outdoor?: boolean; count: 'EACH' | 'ANY'; blocking: boolean }> = [
  { space: 'BEDROOM', picture: ['BEDROOM', 'KIDS_ROOM', 'GUEST_ROOM'], rooms: ['BEDROOM', 'KIDS_ROOM', 'GUEST_ROOM'], count: 'EACH', blocking: true },
  { space: 'LIVING_KITCHEN', picture: ['LIVING', 'KITCHEN', 'KITCHEN_LIVING', 'DINING', 'STUDIO'], rooms: ['LIVING', 'KITCHEN', 'KITCHEN_LIVING', 'DINING', 'STUDIO'], count: 'ANY', blocking: true },
  { space: 'BATHROOM', picture: ['BATHROOM', 'WC'], rooms: ['BATHROOM', 'WC'], count: 'ANY', blocking: true },
  { space: 'OUTDOOR', picture: ['BALCONY', 'TERRACE', 'LOGGIA'], rooms: ['BALCONY', 'TERRACE', 'LOGGIA'], outdoor: true, count: 'ANY', blocking: true },
  // A hall is often read as part of the open plan: reported, never blocking.
  { space: 'HALL', picture: ['HALL', 'CORRIDOR'], rooms: ['HALL', 'CORRIDOR'], count: 'ANY', blocking: false },
];
/** A space read from the picture with less confidence than this is not counted against the geometry. */
const EXPECTED_MIN_CONFIDENCE = 0.75;

/** Pieces that stand on the floor and say which room they are in (flat, wall-hung and small pieces do not). */
const TELLING = new Set([
  'SOFA', 'ARMCHAIR', 'DINING_TABLE', 'DESK', 'BED_DOUBLE', 'BED_SINGLE', 'BEDSIDE', 'WARDROBE', 'DRESSER', 'TV_UNIT',
  'KITCHEN_RUN', 'KITCHEN_ISLAND', 'FRIDGE', 'VANITY', 'SHOWER', 'TOILET', 'BATH', 'WASHING_MACHINE',
  'OUTDOOR_CHAIR', 'OUTDOOR_TABLE', 'OUTDOOR_SOFA',
]);
const BEDS = new Set(['BED_DOUBLE', 'BED_SINGLE']);
/** A bed the room was not seen with: a single, the smallest a bedroom is for. */
const SINGLE_BED: [number, number] = [0.9, 2.0];
/** The way to a bed: along one long side. */
const BED_ACCESS_M = 0.5;
/** A piece this close to its room's outline counts as in it (a reading's metre is not exact). */
const IN_ROOM_TOL_M = 0.4;
/** A room's pieces mostly elsewhere: fewer than this share of them in it. */
const IN_ROOM_MIN_SHARE = 0.6;
/** Walls along the home's two directions: this share of a room's perimeter, within this angle. */
const ALIGNED_MIN_SHARE = 0.75;
const ALIGNED_TOL_DEG = 8;
const FOOTPRINT_MAX_UNCOVERED_M2 = 4;
const FOOTPRINT_MAX_UNCOVERED_SHARE = 0.1;

// ── Geometry helpers ─────────────────────────────────────────────────────────

const pts = (r: CheckRoom): P[] => r.polygon.map((q) => [q.x, q.y] as P);
function area(poly: P[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i += 1) { const a = poly[i]; const b = poly[(i + 1) % poly.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}
function inside(p: P, poly: P[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]; const b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
}
function toOutline(p: P, poly: P[]): number {
  let best = Infinity;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const dx = b[0] - a[0]; const dy = b[1] - a[1]; const l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
    best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy));
  }
  return best;
}
const near = (p: P, poly: P[]) => inside(p, poly) || toOutline(p, poly) <= IN_ROOM_TOL_M;

/** Whether two segments cross (proper intersection, shared endpoints excluded). */
function crosses(a: P, b: P, c: P, d: P): boolean {
  const o = (p: P, q: P, r: P) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  return o(a, b, c) * o(a, b, d) < 0 && o(c, d, a) * o(c, d, b) < 0;
}
export function selfIntersecting(poly: P[]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      if (crosses(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) return true;
    }
  }
  return false;
}

/** The share of a room's perimeter that runs along either of the home's two wall directions (radians). */
export function alignedShare(poly: P[], dirs: [number, number]): number {
  let on = 0; let all = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L < 1e-6) continue;
    all += L;
    const t = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const off = (d: number) => { let x = Math.abs(t - d) % Math.PI; x = Math.min(x, Math.PI - x); return (x * 180) / Math.PI; };
    if (Math.min(off(dirs[0]), off(dirs[1])) <= ALIGNED_TOL_DEG) on += L;
  }
  return all ? on / all : 0;
}

/**
 * Whether a w × d rectangle (plus nothing) fits inside the polygon with its sides along `dir`, in either orientation
 * (a 0.1 m grid in the room's own frame).
 */
export function rectangleFits(poly: P[], dir: number, w: number, d: number): boolean {
  const c = Math.cos(-dir); const s = Math.sin(-dir);
  const local = poly.map(([x, y]) => [x * c - y * s, x * s + y * c] as P);
  const xs = local.map((p) => p[0]); const ys = local.map((p) => p[1]);
  const x0 = Math.min(...xs); const y0 = Math.min(...ys);
  const step = 0.1;
  const nx = Math.ceil((Math.max(...xs) - x0) / step); const ny = Math.ceil((Math.max(...ys) - y0) / step);
  if (nx <= 0 || ny <= 0 || nx * ny > 400000) return false;
  // Summed-area table of cells wholly inside (centre inside and clear of the outline by half a cell).
  const sum = new Float64Array((nx + 1) * (ny + 1));
  for (let j = 0; j < ny; j += 1) {
    for (let i = 0; i < nx; i += 1) {
      const p: P = [x0 + (i + 0.5) * step, y0 + (j + 0.5) * step];
      const ok = inside(p, local) && toOutline(p, local) >= step * 0.49 ? 1 : 0;
      sum[(j + 1) * (nx + 1) + i + 1] = ok + sum[j * (nx + 1) + i + 1] + sum[(j + 1) * (nx + 1) + i] - sum[j * (nx + 1) + i];
    }
  }
  const fits = (a: number, b: number) => {
    const ca = Math.ceil(a / step - 1e-6); const cb = Math.ceil(b / step - 1e-6);
    for (let j = 0; j + cb <= ny; j += 1) {
      for (let i = 0; i + ca <= nx; i += 1) {
        const v = sum[(j + cb) * (nx + 1) + i + ca] - sum[j * (nx + 1) + i + ca] - sum[(j + cb) * (nx + 1) + i] + sum[j * (nx + 1) + i];
        if (v >= ca * cb) return true;
      }
    }
    return false;
  };
  return fits(w, d) || fits(d, w);
}

/** Floor of the footprint that no room covers, in m² (a 0.1 m grid). */
export function uncoveredArea(footprint: P[], rooms: P[][]): { uncovered: number; total: number } {
  const xs = footprint.map((p) => p[0]); const ys = footprint.map((p) => p[1]);
  const step = 0.1; let total = 0; let open = 0;
  for (let x = Math.min(...xs) + step / 2; x < Math.max(...xs); x += step) {
    for (let y = Math.min(...ys) + step / 2; y < Math.max(...ys); y += step) {
      if (!inside([x, y], footprint)) continue;
      total += 1;
      // Rooms are traced on wall lines: a wall's width around them is still covered.
      if (!rooms.some((r) => inside([x, y], r) || toOutline([x, y], r) <= 0.2)) open += 1;
    }
  }
  return { uncovered: Math.round(open * step * step * 100) / 100, total: Math.round(total * step * step * 100) / 100 };
}

// ── The check ────────────────────────────────────────────────────────────────

const keyOf = (id: string) => id.replace(/^r-/, '');
const r2 = (n: number) => Math.round(n * 100) / 100;

export function checkGeometry(input: GeometryCheckInput): GeometryCheck {
  const issues: GeometryIssue[] = [];
  const add = (code: GeometryIssueCode, room: string | null, detail: string, blocking = true) => issues.push({ code, room, detail, blocking });
  const rooms = input.rooms.filter((r) => r.polygon.length >= 3);
  const pieces = (input.pieces ?? []).filter((p) => Array.isArray(p.at) && Number.isFinite(p.at[0]) && Number.isFinite(p.at[1]));
  const missing: GeometryCheck['missing'] = [];
  if (!rooms.some((r) => !r.outdoor)) add('NO_ROOMS', null, 'the space has no indoor room');

  // Rooms: the customer's own picture against the geometry.
  const expected = (input.expected ?? []).filter((e) => (e.confidence ?? 1) >= EXPECTED_MIN_CONFIDENCE);
  for (const s of SPACES) {
    const seen = expected.filter((e) => s.picture.includes(String(e.kind)));
    if (!seen.length) continue;
    const want = s.count === 'EACH' ? seen.length : 1;
    const have = rooms.filter((r) => s.rooms.includes(String(r.kind)) || (s.outdoor && r.outdoor)).length;
    if (have >= want) continue;
    const evidence = seen.map((e) => `original picture: ${e.kind}${e.label ? ` "${e.label}"` : ''}${e.confidence != null ? ` (${Math.round(e.confidence * 100)}%)` : ''}`);
    missing.push({ space: s.space, expected: want, found: have, evidence });
    add('EXPECTED_ROOM_MISSING', null, `${s.space}: the original picture shows ${want}, the geometry has ${have}`, s.blocking);
  }

  // Dropped: pieces placed in a room the geometry does not have.
  const ids = new Set(rooms.map((r) => keyOf(r.id)));
  const orphans = new Map<string, CheckPiece[]>();
  for (const p of pieces) if (p.room && !ids.has(p.room) && TELLING.has(p.type)) orphans.set(p.room, [...(orphans.get(p.room) ?? []), p]);
  for (const [room, list] of orphans) {
    if (list.length < 2) continue;
    add('ROOM_DROPPED', null, `${list.length} pieces were read in "${room}", which the geometry does not have (${[...new Set(list.map((p) => p.type))].slice(0, 5).join(', ')})`);
    const m = missing.find((x) => x.evidence.length && /LIVING|KITCHEN/.test(room.toUpperCase()) && x.space === 'LIVING_KITCHEN')
      ?? missing.find((x) => /TERRACE|BALCONY/.test(room.toUpperCase()) && x.space === 'OUTDOOR')
      ?? missing.find((x) => /BED/.test(room.toUpperCase()) && x.space === 'BEDROOM')
      ?? missing.find((x) => /BATH|WC/.test(room.toUpperCase()) && x.space === 'BATHROOM');
    if (m) m.evidence.push(`${list.length} pieces read in "${room}"`);
  }

  // Shape: simple outlines along the home's two wall directions.
  const polys = rooms.map(pts);
  const dirs = dominantDirections(polys.map((polygon) => ({ polygon })));
  for (const [i, r] of rooms.entries()) {
    const poly = polys[i];
    if (selfIntersecting(poly) || area(poly) < 0.5) { add('ROOM_SHAPE_INVALID', r.id, 'its outline crosses itself or encloses no floor'); continue; }
    if (dirs) {
      const share = alignedShare(poly, dirs);
      if (share < ALIGNED_MIN_SHARE) add('ROOM_SHAPE_INVALID', r.id, `only ${Math.round(share * 100)}% of its walls run along the home's walls (a slanted outline, not a room)`);
    }
  }

  // Consistency: a room's own pieces stand in it.
  for (const [i, r] of rooms.entries()) {
    const own = pieces.filter((p) => p.room === keyOf(r.id) && TELLING.has(p.type));
    if (own.length < 2) continue;
    const inRoom = own.filter((p) => near(p.at, polys[i])).length;
    if (inRoom / own.length < IN_ROOM_MIN_SHARE) add('PIECES_OUTSIDE_ROOM', r.id, `${own.length - inRoom} of its ${own.length} pieces stand outside it`);
  }

  // Fit: a bedroom holds a bed, with a way to it.
  for (const [i, r] of rooms.entries()) {
    if (!['BEDROOM', 'KIDS_ROOM', 'GUEST_ROOM'].includes(String(r.kind))) continue;
    const bed = pieces.filter((p) => p.room === keyOf(r.id) && BEDS.has(p.type)).sort((a, b) => b.widthM * b.depthM - a.widthM * a.depthM)[0];
    const [w, d] = bed ? [Math.min(bed.widthM, bed.depthM), Math.max(bed.widthM, bed.depthM)] : SINGLE_BED;
    const dir = dirs ? dirs[0] : 0;
    if (!rectangleFits(polys[i], dir, w + BED_ACCESS_M, d)) {
      add('ESSENTIAL_DOES_NOT_FIT', r.id, `a ${r2(w)} × ${r2(d)} m bed${bed ? ' (as seen)' : ''} with a ${BED_ACCESS_M} m way to it does not fit its ${r2(area(polys[i]))} m²`);
    }
  }

  // Reach.
  for (const id of input.unreachable ?? []) add('ROOM_UNREACHABLE', id.startsWith('r-') ? id : `r-${id}`, 'no door joins it to the rest of the home');

  // Footprint.
  if (input.footprint && input.footprint.length >= 3) {
    const { uncovered, total } = uncoveredArea(input.footprint, polys);
    if (uncovered > Math.max(FOOTPRINT_MAX_UNCOVERED_M2, FOOTPRINT_MAX_UNCOVERED_SHARE * total)) add('FOOTPRINT_UNCOVERED', null, `${uncovered} m² of the home's measured ${total} m² outline is in no room`);
  }

  const repaired = new Set((input.repairs ?? []).filter((x) => /CARVED|MOVED|DOOR_INFERRED|MERGED/.test(x.code))
    .flatMap((x) => x.element.split(/[↔−→]/)).map((k) => k.trim()));
  const roomsOut = rooms.map((r, i) => {
    const reasons = [...new Set(issues.filter((x) => x.blocking && x.room === r.id).map((x) => x.code))];
    const status: RoomStatus = reasons.length ? 'UNCERTAIN' : repaired.has(keyOf(r.id)) ? 'RECOVERED' : 'CONFIRMED';
    return { id: r.id, kind: String(r.kind), areaM2: r2(area(polys[i])), status, reasons };
  });
  return { version: GEOMETRY_CHECK_VERSION, verdict: issues.some((x) => x.blocking) ? 'FAIL' : 'PASS', rooms: roomsOut, missing, issues };
}

/** The scene's floors as the check reads them (canonical.scene.floors). */
export function roomsOfScene(floors: Array<{ id: string; kind: string; outdoor?: boolean; polygon: Array<{ x: number; y: number }> }>): CheckRoom[] {
  return floors.map((f) => ({ id: f.id, kind: f.kind, outdoor: !!f.outdoor, polygon: f.polygon }));
}

/** The spaces of a photo reading (PHOTO_UNDERSTANDING rooms) the check counts. */
export function expectedOfUnderstanding(u: { rooms?: Array<{ kind?: unknown; label?: unknown; confidence?: unknown }> } | null | undefined): ExpectedSpace[] {
  return (u?.rooms ?? []).map((r) => ({
    kind: String(r.kind ?? ''), label: typeof r.label === 'string' ? r.label : null,
    confidence: typeof r.confidence === 'number' ? r.confidence : null,
  })).filter((r) => r.kind);
}
