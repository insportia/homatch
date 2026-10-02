// WHERE THE CAMERA STANDS — deterministic views of the designed home.
//
// MASTER: the whole furnished home at once, as a dollhouse: an orthographic
// camera high on the diagonal, every ceiling off, walls cut low enough to see
// into every room. It is fitted to the plan's own footprint, so a long thin
// house and a square flat both fill the picture.
//
// ROOM: eye-level photographs inside one room, the way an interior
// photographer works — the main view from where you walk in (or the room's
// strongest corner), the reverse angle, the functional area (the bed, the
// sofa group, the kitchen run), a closer detail, and the connection to the
// next room through a door. N views means the N best DIFFERENT ones (no two
// looking the same way), never ten copies of one.
//
// Pure: plan metres in, SpecViews out. The same design plans the same views.

import type { DesignState } from '../designState.ts';
import type { CatalogAsset } from '../catalog.ts';
import type { Point, SpaceModel, SpaceRoom } from '../space.ts';
import { pointInPolygon } from '../space.ts';
import type { SpecView, ViewPurpose } from './contract.ts';

const r3 = (x: number) => Math.round(x * 1000) / 1000;
const EYE_M = 1.55;

export interface QualityProfile { master: { width: number; samples: number }; room: { width: number; samples: number } }

/** Final quality: what HOMATCH promises, not a customer choice. */
export const FINAL_QUALITY: QualityProfile = { master: { width: 2400, samples: 384 }, room: { width: 2000, samples: 320 } };

/** The plan's extent: rooms, outdoor spaces and walls. */
function extentOf(space: SpaceModel) {
  const pts: Point[] = [
    ...space.rooms.flatMap((r) => r.polygon),
    ...space.walls.flatMap((w) => [w.mesh.start, w.mesh.end]),
  ];
  const xs = pts.map((p) => p.x); const ys = pts.map((p) => p.y);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

/** Unit vector and the camera basis for a view direction (from camera toward target). */
function basis(dir: [number, number, number]) {
  const n = Math.hypot(...dir) || 1;
  const f: [number, number, number] = [dir[0] / n, dir[1] / n, dir[2] / n];
  // right = f × up(z)
  let rx = f[1]; let ry = -f[0];
  const rn = Math.hypot(rx, ry) || 1; rx /= rn; ry /= rn;
  const right: [number, number, number] = [rx, ry, 0];
  const up: [number, number, number] = [right[1] * f[2] - 0 * f[1], 0 * f[0] - right[0] * f[2], right[0] * f[1] - right[1] * f[0]];
  return { f, right, up };
}

/**
 * The dollhouse. Of the four diagonals, the one whose projection of the
 * footprint best fills the picture; ties go to the south-west (a plan's
 * customary front). Walls cut at 1.3 m: high enough for furniture and window
 * sills to read, low enough to see over every partition.
 */
export function planMasterView(space: SpaceModel, opts: { aspect?: number; quality?: QualityProfile } = {}): SpecView {
  const aspect = opts.aspect ?? 1.6;
  const q = (opts.quality ?? FINAL_QUALITY).master;
  const e = extentOf(space);
  const cx = (e.minX + e.maxX) / 2; const cy = (e.minY + e.maxY) / 2;
  const elevation = (38 * Math.PI) / 180;
  const corners: Array<[number, number, number]> = [];
  for (const x of [e.minX, e.maxX]) for (const y of [e.minY, e.maxY]) for (const z of [0, 1.3]) corners.push([x, y, z]);
  let best: { yaw: number; scale: number; fill: number } | null = null;
  for (const yawDeg of [225, 315, 135, 45]) {
    const yaw = (yawDeg * Math.PI) / 180;
    // Direction from the target toward the camera.
    const back: [number, number, number] = [Math.cos(yaw) * Math.cos(elevation), Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation)];
    const { right, up } = basis([-back[0], -back[1], -back[2]]);
    const u = corners.map((p) => (p[0] - cx) * right[0] + (p[1] - cy) * right[1] + p[2] * right[2]);
    const v = corners.map((p) => (p[0] - cx) * up[0] + (p[1] - cy) * up[1] + p[2] * up[2]);
    const w = Math.max(...u) - Math.min(...u); const h = Math.max(...v) - Math.min(...v);
    const scale = Math.max(h, w / aspect) * 1.1;
    const fill = (w * h) / (scale * scale * aspect);
    if (!best || fill > best.fill + 1e-6) best = { yaw, scale, fill };
  }
  const b = best!;
  const dist = 60;
  const back: [number, number, number] = [Math.cos(b.yaw) * Math.cos(elevation), Math.sin(b.yaw) * Math.cos(elevation), Math.sin(elevation)];
  const width = q.width;
  return {
    id: 'master', kind: 'MASTER', purpose: 'DOLLHOUSE', roomId: null,
    position: [r3(cx + back[0] * dist), r3(cy + back[1] * dist), r3(0.6 + back[2] * dist)],
    target: [r3(cx), r3(cy), 0.6],
    fovDeg: null, orthoScale: r3(b.scale), aspect: r3(aspect),
    width, height: Math.round(width / aspect), samples: q.samples,
    cut: { exteriorM: 1.3, interiorM: 1.3 }, hideCeilings: true, objectMap: true,
  };
}

interface Candidate { purpose: ViewPurpose; at: Point; look: Point; fov: number; score: number }

const dist = (a: Point, b: Point) => Math.hypot(b.x - a.x, b.y - a.y);
const angle = (a: Point, b: Point) => Math.atan2(b.y - a.y, b.x - a.x);
const centroidOf = (poly: Point[]): Point => {
  let a = 0; let cx = 0; let cy = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i]; const q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y; a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  return Math.abs(a) < 1e-9 ? poly[0] : { x: cx / (3 * a), y: cy / (3 * a) };
};

/** A point pulled from `p` toward `toward` by `m` metres. */
const pull = (p: Point, toward: Point, m: number): Point => {
  const d = dist(p, toward) || 1;
  return { x: p.x + ((toward.x - p.x) / d) * m, y: p.y + ((toward.y - p.y) / d) * m };
};

/** The pieces that make a room what it is, largest first (the bed, the sofa group, the kitchen run). */
function anchors(room: SpaceRoom, state: DesignState, assets: ReadonlyMap<string, CatalogAsset>) {
  const KEY = new Set(['BED', 'SOFA', 'KITCHEN', 'KITCHEN_RUN', 'TABLE', 'DINING', 'BATH', 'SHOWER', 'VANITY', 'WARDROBE', 'DESK']);
  return state.objects
    .filter((o) => o.roomId === room.id || pointInPolygon({ x: o.position.x, y: o.position.z }, room.polygon))
    .map((o) => ({ o, a: assets.get(o.assetId) }))
    .filter((x) => x.a && (KEY.has(String(x.a.category).toUpperCase()) || KEY.has(String(x.a.procedural?.kind ?? '').toUpperCase())))
    .sort((p, q) => (q.a!.widthM * q.a!.depthM) - (p.a!.widthM * p.a!.depthM))
    .map((x) => ({ at: { x: x.o.position.x, y: x.o.position.z }, size: Math.max(x.a!.widthM, x.a!.depthM) }));
}

/** Somewhere a person could stand: inside the room, clear of the furniture. */
function standable(p: Point, room: SpaceRoom, state: DesignState, assets: ReadonlyMap<string, CatalogAsset>): boolean {
  if (!pointInPolygon(p, room.polygon)) return false;
  for (const o of state.objects) {
    const a = assets.get(o.assetId);
    if (!a || a.heightM < 0.05) continue; // rugs are walked on
    if (dist(p, { x: o.position.x, y: o.position.z }) < Math.max(a.widthM, a.depthM) / 2 + 0.25) return false;
  }
  return true;
}

/**
 * Up to `n` views of one room, each looking a clearly different way.
 * Interior photography: lens ≈ 24–28 mm (about 60–70° vertical at 3:2
 * landscape is too wide; 55° keeps verticals honest), eye height 1.55 m.
 */
export function planRoomViews(
  space: SpaceModel, roomId: string, n: number,
  design: { state: DesignState; assets: ReadonlyMap<string, CatalogAsset> },
  opts: { aspect?: number; quality?: QualityProfile } = {},
): SpecView[] {
  const room = space.rooms.find((r) => r.id === roomId);
  if (!room || n <= 0) return [];
  const aspect = opts.aspect ?? 1.5;
  const q = (opts.quality ?? FINAL_QUALITY).room;
  const c = centroidOf(room.polygon);
  const keys = anchors(room, design.state, design.assets);
  const doorsIn = space.doors.filter((d) => pointInPolygon(pull(d.centre, c, 0.5), room.polygon) || dist(d.centre, c) < 0.1);
  const cands: Candidate[] = [];
  const add = (purpose: ViewPurpose, at: Point, look: Point, fov: number, score: number) => {
    if (dist(at, look) < 1.2) return;
    if (!standable(at, room, design.state, design.assets)) {
      // Step further into the room until a person fits, up to a metre.
      for (let m = 0.2; m <= 1.0; m += 0.2) { const p = pull(at, look, m); if (standable(p, room, design.state, design.assets)) { at = p; break; } }
      if (!standable(at, room, design.state, design.assets)) return;
    }
    cands.push({ purpose, at, look, fov, score });
  };

  // Main: from each entrance, a step inside, toward the room's far side.
  for (const d of doorsIn) {
    const inside = pull(d.centre, c, 0.55);
    const far = pull(c, inside, -Math.min(2, dist(inside, c)));
    add('MAIN', inside, far, 55, 10 + Math.min(4, dist(inside, far)));
  }
  // Corners: each polygon vertex, inset, looking at the centre (the strongest corner first).
  room.polygon.forEach((v, i) => {
    const inset = pull(v, c, 0.45);
    add(i === 0 && !doorsIn.length ? 'MAIN' : 'REVERSE', inset, c, 55, 6 + dist(inset, c));
  });
  // Function: framing the room's defining piece from in front of it.
  for (const k of keys.slice(0, 2)) {
    const from = pull(k.at, c, -(k.size / 2 + 1.8));
    const at = pointInPolygon(from, room.polygon) ? from : pull(c, k.at, -1.2);
    add('FUNCTION', at, k.at, 50, 9);
    add('DETAIL', pull(k.at, at, k.size / 2 + 1.1), k.at, 38, 5);
  }
  // Connection: from the far side, through the door to the next room.
  for (const d of doorsIn) {
    const back = pull(c, d.centre, -Math.min(1.5, dist(c, d.centre)));
    add('CONNECTION', back, pull(d.centre, back, -1.0), 55, 5);
  }
  if (!cands.length) add('MAIN', c, pull(c, room.polygon[0], -1), 60, 1);

  // Choose: best score first, each new view at least 55° away in heading (or another place and purpose).
  const ordered = [...cands].sort((a, b) => b.score - a.score || a.purpose.localeCompare(b.purpose));
  const chosen: Candidate[] = [];
  const heading = (x: Candidate) => angle(x.at, x.look);
  for (const cand of ordered) {
    if (chosen.length >= n) break;
    const clash = chosen.some((x) => {
      const dh = Math.abs(Math.atan2(Math.sin(heading(x) - heading(cand)), Math.cos(heading(x) - heading(cand))));
      return dh < (55 * Math.PI) / 180 && dist(x.at, cand.at) < 1.5;
    });
    if (!clash) chosen.push(cand);
  }
  // A small room may not hold N different views: say so by returning fewer, never duplicates.
  const width = q.width;
  return chosen.map((v, i) => ({
    id: `${roomId}-v${i + 1}`, kind: 'ROOM', purpose: v.purpose, roomId,
    position: [r3(v.at.x), r3(v.at.y), EYE_M],
    target: [r3(v.look.x), r3(v.look.y), v.purpose === 'DETAIL' ? 0.75 : 1.25],
    fovDeg: v.fov, orthoScale: null, aspect: r3(aspect),
    width, height: Math.round(width / aspect), samples: q.samples,
    cut: null, hideCeilings: false, objectMap: true,
  }));
}

/** The most different views a room can honestly offer (the "up to" a customer is told). */
export function maxRoomViews(space: SpaceModel, roomId: string, design: { state: DesignState; assets: ReadonlyMap<string, CatalogAsset> }): number {
  return planRoomViews(space, roomId, 12, design).length;
}
