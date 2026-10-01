// WHAT THE PICTURE ITSELF SAYS ABOUT GEOMETRY — measured from pixels, no model.
//
// For an orthographic "dollhouse" render (the common isometric/aerial
// cut-away of a whole apartment) three facts are measurable directly:
//
//   1. THE CAMERA'S AXES. Real walls are vertical and floors rectilinear, so
//      the picture's edge directions cluster at three angles: the vertical,
//      and the images of the two floor axes. For an orthographic camera whose
//      verticals stay vertical, the two floor-axis image scales satisfy
//        s1² · d1x·d1y + s2² · d2x·d2y = 0
//      (the camera's rows are orthonormal), so the plan's true proportions
//      follow from the two measured directions alone.
//   2. THE FOOTPRINT. On a plain background the building's silhouette, column
//      by column, is bounded below by the front floor edge and above by the
//      back floor edge raised by the wall height. Lowering the upper boundary
//      by the wall height and mapping both through (1) draws the outline —
//      an L-shape stays an L.
//   3. HOW MUCH TO TRUST IT: a confidence from how cleanly (1) and (2) hold.
//
// Pure functions over a greyscale buffer (row-major, 0…255), so the browser
// (canvas) and tests (decoded fixtures) share them. Nothing here is fitted
// to a particular picture.

import { FRAME_VERSION, type PictureFrame, planToImage } from './pictureFrame.ts';

export interface Axes {
  /** Image angle (degrees, y down, 0…180) of vertical edges. */
  verticalDeg: number;
  /** Image angles of the two floor axes. */
  floorDeg: [number, number];
  /** s1 / s2: image pixels per unit along floor axis 1 relative to axis 2. */
  ratio: number;
  /** 0…1: how much of the edge energy the three directions explain. */
  confidence: number;
}

export interface Footprint {
  /** Floor-level outline in image pixels (a closed polygon, clockwise on screen). */
  polygonPx: Array<[number, number]>;
  /** Wall height in image pixels (the vertical extent at the silhouette's ends). */
  wallPx: number;
  /** 0…1: how clean the background and the silhouette were. */
  confidence: number;
}

const rad = (d: number) => (d * Math.PI) / 180;

/** A separable 5-tap binomial blur: staircased pixel edges otherwise bias Sobel angles toward the grid. */
function blur(g: ArrayLike<number>, w: number, h: number): Float32Array {
  const k = [1, 4, 6, 4, 1];
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let s = 0;
      for (let i = -2; i <= 2; i += 1) s += k[i + 2] * g[y * w + Math.min(w - 1, Math.max(0, x + i))];
      tmp[y * w + x] = s / 16;
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let s = 0;
      for (let i = -2; i <= 2; i += 1) s += k[i + 2] * tmp[Math.min(h - 1, Math.max(0, y + i)) * w + x];
      out[y * w + x] = s / 16;
    }
  }
  return out;
}

/** Edge-direction histogram (Sobel on a blurred image, magnitude-weighted, 1° bins over [0,180)). */
function directionHistogram(g0: ArrayLike<number>, w: number, h: number, minMag: number) {
  const g = blur(g0, w, h);
  const bins = new Float64Array(180);
  const points: number[] = []; // x, y, magnitude of every edge pixel (for refinement)
  const at = (x: number, y: number) => g[y * w + x];
  let total = 0;
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      const m = Math.hypot(gx, gy);
      if (m < minMag) continue;
      points.push(x, y, m);
      const a = ((((Math.atan2(gy, gx) * 180) / Math.PI + 90) % 180) + 180) % 180;
      bins[Math.floor(a) % 180] += m;
      total += m;
    }
  }
  const smooth = bins.map((_, i) => {
    let s = 0;
    for (let k = -2; k <= 2; k += 1) s += bins[(i + k + 180) % 180];
    return s;
  });
  return { smooth, total, points };
}

/**
 * Refine a coarse direction to ~0.1°: project every edge pixel onto the
 * normal of each candidate angle and keep the angle whose profile is the
 * SHARPEST (sum of squared bins). Straight lines pile into single bins only
 * at their true angle, however staircased the pixels are.
 */
function sharpestAngle(points: number[], coarse: number, span = 6, step = 0.1): number {
  let best = coarse; let bestScore = -1;
  for (let a = coarse - span; a <= coarse + span + 1e-9; a += step) {
    const s = Math.sin(rad(a)); const c = Math.cos(rad(a));
    const bins = new Map<number, number>();
    for (let i = 0; i < points.length; i += 3) {
      const r = Math.round(-points[i] * s + points[i + 1] * c);
      bins.set(r, (bins.get(r) ?? 0) + points[i + 2]);
    }
    let score = 0;
    for (const v of bins.values()) score += v * v;
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return best;
}

/** Weighted mean angle of a peak (±3°), for sub-degree precision. */
function refine(smooth: Float64Array, i: number) {
  let s = 0; let w = 0;
  for (let k = -3; k <= 3; k += 1) { const v = smooth[(i + k + 180) % 180]; s += (i + k) * v; w += v; }
  return w ? s / w : i;
}

/** The picture's dominant edge directions (degrees, strongest first) with their weights. */
export function directionPeaks(g: ArrayLike<number>, w: number, h: number) {
  const { smooth, total, points } = directionHistogram(g, w, h, 60);
  const peaks: Array<[number, number]> = [];
  for (let i = 0; i < 180; i += 1) {
    if (smooth[i] >= smooth[(i + 179) % 180] && smooth[i] >= smooth[(i + 1) % 180]) peaks.push([i, smooth[i]]);
  }
  peaks.sort((a, b) => b[1] - a[1]);
  return { smooth, total, peaks, points };
}

export function measureAxes(g: ArrayLike<number>, w: number, h: number): Axes | null {
  const { smooth, total, peaks, points } = directionPeaks(g, w, h);
  if (!total) return null;
  const vertical = peaks.find(([d]) => Math.abs(d - 90) < 10);
  const floor = peaks.filter(([d]) => Math.abs(d - 90) > 12 && d > 4 && d < 176);
  if (!vertical || !floor.length) return null;
  const f1 = floor[0][0];
  const f2 = floor.find(([d]) => Math.abs((((d - f1) % 180) + 180) % 180 - 90) < 70 && Math.abs(d - f1) > 20);
  if (!f2) return null;
  const a1 = sharpestAngle(points, refine(smooth, f1));
  const a2 = sharpestAngle(points, refine(smooth, f2[0]));
  const d1 = [Math.cos(rad(a1)), Math.sin(rad(a1))];
  const d2 = [Math.cos(rad(a2)), Math.sin(rad(a2))];
  const r2 = -(d2[0] * d2[1]) / (d1[0] * d1[1]);
  if (!(r2 > 0)) return null; // not an orthographic view with vertical verticals
  const explained = [vertical[0], f1, f2[0]].reduce((s, i) => s + [-3, -2, -1, 0, 1, 2, 3].reduce((t, k) => t + smooth[(i + k + 180) % 180], 0), 0) / 5;
  // Seen from above, a floor is never mirrored: the plan's x and y must keep
  // the picture's handedness (both y down), or the plan view — and every room
  // traced on it — comes out as the home's mirror image. Order the two axes so.
  const keep = d1[0] * d2[1] - d1[1] * d2[0] > 0;
  return {
    verticalDeg: sharpestAngle(points, refine(smooth, vertical[0]), 4),
    floorDeg: keep ? [a1, a2] : [a2, a1],
    ratio: keep ? Math.sqrt(r2) : 1 / Math.sqrt(r2),
    confidence: Math.max(0, Math.min(1, explained / total)),
  };
}

/** The background: the median grey of the picture's border. */
function backgroundGrey(g: ArrayLike<number>, w: number, h: number) {
  const v: number[] = [];
  for (let x = 0; x < w; x += 4) { v.push(g[x]); v.push(g[(h - 1) * w + x]); }
  for (let y = 0; y < h; y += 4) { v.push(g[y * w]); v.push(g[y * w + w - 1]); }
  v.sort((a, b) => a - b);
  const median = v[Math.floor(v.length / 2)];
  const spread = v[Math.floor(v.length * 0.9)] - v[Math.floor(v.length * 0.1)];
  return { median, spread };
}

export function footprintFromSilhouette(g: ArrayLike<number>, w: number, h: number): Footprint | null {
  const { median, spread } = backgroundGrey(g, w, h);
  if (spread > 24) return null; // not a plain background: a photo, not a cut-away
  const isBg = (x: number, y: number) => Math.abs(g[y * w + x] - median) <= Math.max(10, spread + 6);
  const top = new Int32Array(w).fill(-1);
  const bot = new Int32Array(w).fill(-1);
  for (let x = 0; x < w; x += 1) {
    for (let y = 0; y < h; y += 1) if (!isBg(x, y)) { top[x] = y; break; }
    for (let y = h - 1; y >= 0; y -= 1) if (!isBg(x, y)) { bot[x] = y; break; }
  }
  const cols: number[] = [];
  for (let x = 0; x < w; x += 1) if (top[x] >= 0 && bot[x] - top[x] > 8) cols.push(x);
  if (cols.length < w * 0.2) return null;
  const x0 = cols[0]; const x1 = cols[cols.length - 1];
  // Wall height: the smallest vertical extent just inside the silhouette's two ends.
  const ends = [x0 + 2, x0 + 4, x1 - 2, x1 - 4].filter((x) => top[x] >= 0).map((x) => bot[x] - top[x]);
  const wallPx = Math.max(1, Math.min(...ends));
  // Front floor edge (lower boundary, left → right), then the back floor edge
  // (upper boundary lowered by the wall height, right → left).
  const step = Math.max(1, Math.round(cols.length / 400));
  const lower: Array<[number, number]> = [];
  const upper: Array<[number, number]> = [];
  for (let i = 0; i < cols.length; i += step) { const x = cols[i]; lower.push([x, bot[x]]); upper.push([x, top[x] + wallPx]); }
  const polygonPx = [...lower, ...upper.reverse()];
  const coverage = cols.length / (x1 - x0 + 1);
  return { polygonPx, wallPx, confidence: Math.max(0, Math.min(1, coverage * (1 - spread / 40))) };
}

/**
 * Image → plan (relative units, up to scale and translation) for the
 * measured axes: image = X·s1·d1 + Y·s2·d2 (verticals vertical, floor at h=0).
 */
export function planFromImage(axes: Axes): (px: number, py: number) => [number, number] {
  const d1 = [Math.cos(rad(axes.floorDeg[0])), Math.sin(rad(axes.floorDeg[0]))];
  const d2 = [Math.cos(rad(axes.floorDeg[1])), Math.sin(rad(axes.floorDeg[1]))];
  const a = axes.ratio * d1[0]; const b = d2[0];
  const c = axes.ratio * d1[1]; const d = d2[1];
  const det = a * d - b * c;
  return (px, py) => [(d * px - b * py) / det, (-c * px + a * py) / det];
}

/**
 * Below this the picture is read the usual way (no plan view is made). The
 * structural checks carry most of the weight — three consistent directions,
 * a real orthographic ratio, a plain background around one silhouette — so
 * this only drops pictures whose edges the three directions barely explain
 * (the share depends on drawing style: 0.28 for a clean line render, 0.47
 * for a textured one).
 */
export const FRAME_MIN_CONFIDENCE = 0.2;

type P2 = [number, number];

/** Douglas–Peucker: the outline's corners, not its pixel staircase. */
function simplify(points: P2[], tol: number): P2[] {
  if (points.length < 4) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1; keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    const [ax, ay] = points[i]; const [bx, by] = points[j];
    const len = Math.hypot(bx - ax, by - ay) || 1e-9;
    let far = -1; let farD = 0;
    for (let k = i + 1; k < j; k += 1) {
      const d = Math.abs((bx - ax) * (ay - points[k][1]) - (ax - points[k][0]) * (by - ay)) / len;
      if (d > farD) { farD = d; far = k; }
    }
    if (far >= 0 && farD > tol) { keep[far] = 1; stack.push([i, far], [far, j]); }
  }
  return points.filter((_, k) => keep[k]);
}

/**
 * The picture's frame (pictureFrame.ts): its measured camera, its outline in
 * plan units, and the plan view's size. Null when the picture is not a clean
 * orthographic cut-away (a photo, a busy background) — it is then read as before.
 */
export function measureFrame(g: ArrayLike<number>, w: number, h: number, viewEdge = 1024): PictureFrame | null {
  const axes = measureAxes(g, w, h);
  if (!axes) return null;
  const fp = footprintFromSilhouette(g, w, h);
  if (!fp) return null;
  const toPlan = planFromImage(axes);
  const raw = fp.polygonPx.map(([x, y]) => toPlan(x / h, y / h));
  const xs = raw.map((p) => p[0]); const ys = raw.map((p) => p[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (!(span > 0)) return null;
  // A closed ring: simplify its two halves between the first point and the point farthest from it.
  let far = 0;
  raw.forEach((p, i) => { if (Math.hypot(p[0] - raw[0][0], p[1] - raw[0][1]) > Math.hypot(raw[far][0] - raw[0][0], raw[far][1] - raw[0][1])) far = i; });
  const tol = span * 0.004;
  const ring = [...simplify(raw.slice(0, far + 1), tol), ...simplify([...raw.slice(far), raw[0]], tol).slice(1, -1)];
  const footprint = ring.map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5] as P2);
  if (footprint.length < 3 || footprint.length > 400) return null;
  const confidence = Math.round(Math.min(axes.confidence, fp.confidence) * 1000) / 1000;
  if (confidence < FRAME_MIN_CONFIDENCE) return null;
  const x0 = Math.min(...footprint.map((p) => p[0])); const y0 = Math.min(...footprint.map((p) => p[1]));
  const ex = Math.max(...footprint.map((p) => p[0])) - x0; const ey = Math.max(...footprint.map((p) => p[1])) - y0;
  const perUnit = viewEdge / Math.max(ex, ey);
  return {
    v: FRAME_VERSION, width: w, height: h, verticalDeg: axes.verticalDeg, floorDeg: axes.floorDeg, ratio: axes.ratio,
    wall: fp.wallPx / h, footprint,
    view: { width: Math.max(16, Math.ceil(ex * perUnit)), height: Math.max(16, Math.ceil(ey * perUnit)), x0, y0, perUnit, lift: fp.wallPx / h },
    confidence,
  };
}

/**
 * The top-down plan view (RGBA): every plan point inside the outline takes
 * the picture's colour where that point sits at wall-top height, so every
 * wall is a straight line at its true place. Outside the outline is white.
 */
export function renderPlanView(rgba: ArrayLike<number>, w: number, h: number, frame: PictureFrame): Uint8ClampedArray<ArrayBuffer> {
  const { width: vw, height: vh, x0, y0, perUnit, lift } = frame.view;
  const out = new Uint8ClampedArray(new ArrayBuffer(vw * vh * 4)).fill(255);
  const fp = frame.footprint;
  const scale = h / frame.height; // the RGBA may be a different size than the measured picture
  for (let py = 0; py < vh; py += 1) {
    const qy = y0 + (py + 0.5) / perUnit;
    // Scanline crossings of the outline.
    const xs: number[] = [];
    for (let i = 0, j = fp.length - 1; i < fp.length; j = i, i += 1) {
      const [xi, yi] = fp[i]; const [xj, yj] = fp[j];
      if ((yi > qy) !== (yj > qy)) xs.push(xi + ((qy - yi) * (xj - xi)) / (yj - yi));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const from = Math.max(0, Math.floor((xs[k] - x0) * perUnit)); const to = Math.min(vw - 1, Math.ceil((xs[k + 1] - x0) * perUnit));
      for (let px = from; px <= to; px += 1) {
        const [ix, iy] = planToImage(frame, [x0 + (px + 0.5) / perUnit, qy], lift);
        const sx = ix * frame.height * scale - 0.5; const sy = iy * frame.height * scale - 0.5;
        const fx = Math.floor(sx); const fy = Math.floor(sy);
        if (fx < 0 || fy < 0 || fx + 1 >= w || fy + 1 >= h) continue;
        const ax = sx - fx; const ay = sy - fy;
        const o = (py * vw + px) * 4;
        for (let c = 0; c < 3; c += 1) {
          const p00 = rgba[(fy * w + fx) * 4 + c]; const p10 = rgba[(fy * w + fx + 1) * 4 + c];
          const p01 = rgba[((fy + 1) * w + fx) * 4 + c]; const p11 = rgba[((fy + 1) * w + fx + 1) * 4 + c];
          out[o + c] = (p00 * (1 - ax) + p10 * ax) * (1 - ay) + (p01 * (1 - ax) + p11 * ax) * ay;
        }
      }
    }
  }
  return out;
}

/** The picture's background colour: the per-channel median of its border (RGBA, row-major). */
export function borderColor(rgba: ArrayLike<number>, w: number, h: number): string {
  const ch: number[][] = [[], [], []];
  const take = (x: number, y: number) => { const o = (y * w + x) * 4; for (let c = 0; c < 3; c += 1) ch[c].push(rgba[o + c]); };
  for (let x = 0; x < w; x += 4) { take(x, 0); take(x, h - 1); }
  for (let y = 0; y < h; y += 4) { take(0, y); take(w - 1, y); }
  return `#${ch.map((v) => { v.sort((a, b) => a - b); return Math.round(v[Math.floor(v.length / 2)]).toString(16).padStart(2, '0'); }).join('')}`;
}
