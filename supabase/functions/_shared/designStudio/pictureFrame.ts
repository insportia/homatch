// HOMATCH DESIGN STUDIO — a picture's own frame, MEASURED from its pixels.
//
// An isometric / dollhouse render of a whole home is an orthographic view.
// Its camera is not guessed and not fitted from a model's traces: the
// browser measures it from the picture itself (pictureGeometry.ts) — the
// vertical direction, the two floor directions and their metric ratio, the
// wall height, and the home's outline at floor level — and renders a
// TOP-DOWN plan view of the picture from it. That frame is stored with the
// picture (ds_floorplans.picture_geometry) and read here.
//
// PLAN UNITS. With image coordinates in image-height units (X = u·aspect,
// Y = v, Y down), a floor point at plan units (p, q) lands at
//   image = p·ratio·d1 + q·d2        (d1, d2 the unit floor directions)
// and a point h above the floor `wall·h/wallHeight` higher. Plan units are
// isotropic (that is what the measured ratio buys), so ONE scale turns them
// into metres; the reader's own metric estimate sets that scale.
//
// The reader traces rooms on the plan view, where every wall is a straight
// axis-aligned line; those traces become the plan directly. Everything else
// traced on the picture is unprojected through the measured camera.
//
// Pure and dependency-free: the edge function (Deno), the browser and the
// tests (Node) run the same code.

import { type CameraFit, fitOrtho } from './sourceCamera.ts';

export type Point2 = [number, number];

export const FRAME_VERSION = 1;

export interface PictureFrame {
  v: 1;
  /** The analysis picture the frame was measured on, in pixels. */
  width: number;
  height: number;
  /** Measured directions, degrees in image coordinates (Y down), [0, 180). */
  verticalDeg: number;
  floorDeg: [number, number];
  /** Image length of one plan unit along d1, relative to d2. */
  ratio: number;
  /** Wall height, in image-height units. */
  wall: number;
  /** The home's outline at floor level, in plan units. */
  footprint: Point2[];
  /** The top-down plan view: plan (x0 + px/perUnit, y0 + py/perUnit) for its pixel (px, py). `lift` is the height it samples at, image-height units. */
  view: { width: number; height: number; x0: number; y0: number; perUnit: number; lift: number };
  /** How sure the measurement is, 0..1. */
  confidence: number;
  /** The picture's plain background (#rrggbb), when measured: its views are drawn on it. */
  background?: string | null;
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const within = (v: unknown, lo: number, hi: number): v is number => finite(v) && v >= lo && v <= hi;
const rad = (d: number) => (d * Math.PI) / 180;

/** A stored frame, bounded; anything malformed reads as no frame (the reading then works as without one). */
export function readFrame(raw: unknown): PictureFrame | null {
  const o = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!o || o.v !== FRAME_VERSION) return null;
  const view = (o.view && typeof o.view === 'object' ? o.view : null) as Record<string, unknown> | null;
  const floor = Array.isArray(o.floorDeg) ? o.floorDeg : [];
  const fp = Array.isArray(o.footprint) ? o.footprint : [];
  if (!within(o.width, 64, 20000) || !within(o.height, 64, 20000)) return null;
  if (!within(o.verticalDeg, 0, 180) || floor.length !== 2 || !within(floor[0], 0, 180) || !within(floor[1], 0, 180)) return null;
  const between = Math.abs(floor[0] - floor[1]) % 180;
  if (Math.min(between, 180 - between) < 20) return null;
  if (!within(o.ratio, 0.2, 5) || !within(o.wall, 0.001, 1) || !within(o.confidence, 0, 1)) return null;
  if (fp.length < 3 || fp.length > 400) return null;
  const footprint: Point2[] = [];
  for (const p of fp) {
    if (!Array.isArray(p) || p.length !== 2 || !within(p[0], -100, 100) || !within(p[1], -100, 100)) return null;
    footprint.push([p[0], p[1]]);
  }
  if (!view || !within(view.width, 16, 4096) || !within(view.height, 16, 4096) || !within(view.x0, -100, 100) || !within(view.y0, -100, 100)
    || !within(view.perUnit, 1, 100000) || !within(view.lift, 0, 1)) return null;
  return {
    v: 1, width: o.width, height: o.height, verticalDeg: o.verticalDeg, floorDeg: [floor[0], floor[1]], ratio: o.ratio, wall: o.wall, footprint,
    view: { width: view.width, height: view.height, x0: view.x0, y0: view.y0, perUnit: view.perUnit, lift: view.lift },
    confidence: o.confidence,
    background: typeof o.background === 'string' && /^#[0-9a-f]{6}$/i.test(o.background) ? o.background.toLowerCase() : null,
  };
}

function directions(frame: Pick<PictureFrame, 'floorDeg' | 'ratio'>) {
  const d1: Point2 = [Math.cos(rad(frame.floorDeg[0])), Math.sin(rad(frame.floorDeg[0]))];
  const d2: Point2 = [Math.cos(rad(frame.floorDeg[1])), Math.sin(rad(frame.floorDeg[1]))];
  return { a: frame.ratio * d1[0], b: d2[0], c: frame.ratio * d1[1], d: d2[1] };
}

/** Plan units → image (image-height units), `lift` image-height units above the floor. */
export function planToImage(frame: Pick<PictureFrame, 'floorDeg' | 'ratio'>, p: Point2, lift = 0): Point2 {
  const { a, b, c, d } = directions(frame);
  return [a * p[0] + b * p[1], c * p[0] + d * p[1] - lift];
}

/** Image (image-height units) at floor level → plan units. */
export function imageToPlan(frame: Pick<PictureFrame, 'floorDeg' | 'ratio'>, x: number, y: number): Point2 {
  const { a, b, c, d } = directions(frame);
  const det = a * d - b * c;
  return [(d * x - b * y) / det, (-c * x + a * y) / det];
}

/** A picture point [u, v] (fractions) at floor level → plan units. */
export function pictureToPlan(frame: PictureFrame, uv: Point2): Point2 {
  return imageToPlan(frame, uv[0] * (frame.width / frame.height), uv[1]);
}

/** A plan-view point [u, v] (fractions of the plan view) → plan units. */
export function viewToPlan(frame: PictureFrame, uv: Point2): Point2 {
  return [frame.view.x0 + (uv[0] * frame.view.width) / frame.view.perUnit, frame.view.y0 + (uv[1] * frame.view.height) / frame.view.perUnit];
}

/** Plan units ↔ the reader's metres: a turn by a multiple of 90°, a uniform scale and a shift. */
export interface FrameAlignment {
  /** Metres per plan unit. */
  k: number;
  /** Quarter turns applied to plan units, and whether plan-unit y is mirrored first. */
  quarter: number;
  mirror: boolean;
  t: Point2;
  /** Root-mean-square disagreement with the reader's own metres, over the pairs kept. */
  rmsM: number;
  kept: number;
}

const orient = (q: Point2, quarter: number, mirror: boolean): Point2 => {
  let p: Point2 = [q[0], mirror ? -q[1] : q[1]];
  for (let i = 0; i < quarter; i += 1) p = [-p[1], p[0]];
  return p;
};

export function toMetres(al: FrameAlignment, q: Point2): Point2 {
  const p = orient(q, al.quarter, al.mirror);
  return [al.k * p[0] + al.t[0], al.k * p[1] + al.t[1]];
}

export function toPlanUnits(al: FrameAlignment, m: Point2): Point2 {
  let p: Point2 = [(m[0] - al.t[0]) / al.k, (m[1] - al.t[1]) / al.k];
  for (let i = 0; i < (4 - al.quarter) % 4; i += 1) p = [-p[1], p[0]];
  return [p[0], al.mirror ? -p[1] : p[1]];
}

/**
 * The picture shows the floor FROM ABOVE, so the plan (y north) and its image
 * (Y down) have opposite handedness; that fixes the mirror, leaving the four
 * quarter turns. Of those, the one that agrees best with the reader's metres
 * wins, then scale and shift are fitted by trimmed least squares — the
 * reader's metres set the SIZE and which way is north, never the shape.
 */
export function alignFrame(frame: PictureFrame, pairs: Array<{ m: Point2; q: Point2 }>): FrameAlignment | null {
  if (pairs.length < 3) return null;
  const { a, b, c, d } = directions(frame);
  // Image handedness of plan units; metres→image must come out negative.
  const mirror = a * d - b * c > 0;
  let best: FrameAlignment | null = null;
  for (let quarter = 0; quarter < 4; quarter += 1) {
    let list = pairs;
    let fit: FrameAlignment | null = null;
    for (let round = 0; round < 4; round += 1) {
      const P = list.map((x) => orient(x.q, quarter, mirror));
      const n = list.length;
      const mp = [0, 0]; const mm = [0, 0];
      for (let i = 0; i < n; i += 1) { mp[0] += P[i][0] / n; mp[1] += P[i][1] / n; mm[0] += list[i].m[0] / n; mm[1] += list[i].m[1] / n; }
      let num = 0; let den = 0;
      for (let i = 0; i < n; i += 1) {
        const px = P[i][0] - mp[0]; const py = P[i][1] - mp[1];
        num += px * (list[i].m[0] - mm[0]) + py * (list[i].m[1] - mm[1]);
        den += px * px + py * py;
      }
      if (!(den > 1e-12) || !(num > 0)) { fit = null; break; }
      const k = num / den;
      const t: Point2 = [mm[0] - k * mp[0], mm[1] - k * mp[1]];
      const al: FrameAlignment = { k, quarter, mirror, t, rmsM: 0, kept: n };
      const res = pairs.map((x) => { const q = toMetres(al, x.q); return Math.hypot(q[0] - x.m[0], q[1] - x.m[1]); });
      const kept = list.map((x) => { const q = toMetres(al, x.q); return Math.hypot(q[0] - x.m[0], q[1] - x.m[1]); });
      al.rmsM = Math.sqrt(kept.reduce((s, r) => s + r * r, 0) / kept.length);
      fit = al;
      // Trim the worst fifth (mistraces and the reader's own layout errors) and refit.
      const cut = [...res].sort((x, y) => x - y)[Math.max(2, Math.floor(res.length * 0.8)) - 1];
      const next = pairs.filter((_, i) => res[i] <= cut);
      if (next.length === list.length || next.length < 3) break;
      list = next;
    }
    if (fit && (!best || fit.rmsM < best.rmsM)) best = fit;
  }
  return best;
}

/** The measured camera, in the reader's metres: an exact orthographic view of the floor (sourceCamera's own form). */
export function frameCamera(frame: PictureFrame, al: FrameAlignment): CameraFit | null {
  const aspect = frame.width / frame.height;
  const xs = frame.footprint.map((p) => p[0]); const ys = frame.footprint.map((p) => p[1]);
  const lo: Point2 = [Math.min(...xs), Math.min(...ys)]; const hi: Point2 = [Math.max(...xs), Math.max(...ys)];
  const pairs: Array<{ plan: Point2; uv: Point2 }> = [];
  for (let i = 0; i <= 4; i += 1) {
    for (let j = 0; j <= 4; j += 1) {
      const q: Point2 = [lo[0] + ((hi[0] - lo[0]) * i) / 4, lo[1] + ((hi[1] - lo[1]) * j) / 4];
      const img = planToImage(frame, q);
      pairs.push({ plan: toMetres(al, q), uv: [img[0] / aspect, img[1]] as Point2 });
    }
  }
  return fitOrtho(pairs, aspect);
}

function segDistance(p: Point2, a: Point2, b: Point2): number {
  const dx = b[0] - a[0]; const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function inside(p: Point2, poly: Point2[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [xi, yi] = poly[i]; const [xj, yj] = poly[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/**
 * How far the rebuilt plan's OUTLINE is from the picture's own outline, drawn
 * in the picture: root-mean-square distance in image-height units, both ways
 * (the picture's outline to the nearest rebuilt edge; every rebuilt corner and
 * edge sample outside the picture's outline to that outline).
 */
export function outlineError(frame: PictureFrame, al: FrameAlignment, rooms: Point2[][]): number {
  const img = (m: Point2) => planToImage(frame, toPlanUnits(al, m));
  const roomEdges: Array<[Point2, Point2]> = [];
  const roomSamples: Point2[] = [];
  for (const poly of rooms) {
    for (let i = 0; i < poly.length; i += 1) {
      const a = img(poly[i]); const b = img(poly[(i + 1) % poly.length]);
      roomEdges.push([a, b]);
      for (let s = 0; s < 8; s += 1) roomSamples.push([a[0] + ((b[0] - a[0]) * s) / 8, a[1] + ((b[1] - a[1]) * s) / 8]);
    }
  }
  if (!roomEdges.length) return Infinity;
  const fp = frame.footprint.map((q) => planToImage(frame, q));
  const d2: number[] = [];
  for (let i = 0; i < fp.length; i += 1) {
    const a = fp[i]; const b = fp[(i + 1) % fp.length];
    for (let s = 0; s < 8; s += 1) {
      const p: Point2 = [a[0] + ((b[0] - a[0]) * s) / 8, a[1] + ((b[1] - a[1]) * s) / 8];
      d2.push(Math.min(...roomEdges.map(([u, v]) => segDistance(p, u, v))) ** 2);
    }
  }
  for (const p of roomSamples) {
    if (inside(p, fp)) continue;
    let m = Infinity;
    for (let i = 0; i < fp.length; i += 1) m = Math.min(m, segDistance(p, fp[i], fp[(i + 1) % fp.length]));
    d2.push(m * m);
  }
  return Math.sqrt(d2.reduce((s, v) => s + v, 0) / d2.length);
}
