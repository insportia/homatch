// HOMATCH DESIGN STUDIO — what the drawing's INK says, measured.
//
// The model reads a plan the way a person glances at it: the rooms and the
// walls are right, the coordinates are approximate (a wall a few pixels off,
// every door at the end of its wall). The raster is the opposite: it knows
// nothing about rooms, but where it has ink it is exact. This module asks it
// narrow questions about places the model pointed at:
//
//   snapWall      where exactly is this wall's band, and how thick is it?
//   scanWall      along this wall: solid wall, window, or nothing (a gap)?
//   detectTreads  is there a run of evenly spaced parallel lines here (stairs)?
//
// Robust to scans and screenshots: Otsu binarisation (plus a lighter "faint"
// level for the grey lines plans use for stairs and thresholds), and a
// min-pool downscale so a 4000-pixel scan is analysed at ≤1600 pixels in a
// few tens of milliseconds without losing one-pixel lines.
//
// Pure and dependency-free (Deno + Node + browser). Coordinates in and out
// are SOURCE IMAGE pixels; the downscale is internal.

import type { GrayImage, Pt } from './types.ts';
import { bboxOf, frame, pointInPoly } from './geom.ts';

export interface Raster {
  /** Analysis grid size (the source divided by `factor`). */
  width: number;
  height: number;
  /** Source pixels per analysis cell. */
  factor: number;
  /** 1 where the ink is dark (below Otsu). */
  dark: Uint8Array;
  /** 1 where there is any ink, including the light grey of stairs and thresholds. */
  faint: Uint8Array;
  /**
   * Dark ink that belongs to something LARGE: a wall network, a window frame,
   * a long line. Letters, numbers and small symbols (separate small blobs)
   * are removed, so a label printed across a wall line does not read as wall.
   */
  line: Uint8Array;
  threshold: number;
  faintThreshold: number;
}

/** RGB(A) or grey bytes → one grey byte per pixel (Rec. 601 luma). */
export function toGray(data: Uint8Array | Uint8ClampedArray, width: number, height: number, channels: number): GrayImage {
  const out = new Uint8Array(width * height);
  if (channels === 1) { out.set(data.subarray(0, width * height)); return { width, height, data: out }; }
  for (let i = 0, j = 0; i < out.length; i += 1, j += channels) {
    const r = data[j];
    const g = channels >= 3 ? data[j + 1] : r;
    const b = channels >= 3 ? data[j + 2] : r;
    let v = (r * 299 + g * 587 + b * 114) / 1000;
    // Transparent pixels are paper.
    if (channels === 4 || channels === 2) {
      const a = data[j + channels - 1] / 255;
      v = v * a + 255 * (1 - a);
    }
    out[i] = v;
  }
  return { width, height, data: out };
}

function otsu(hist: Float64Array, total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i += 1) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let thr = 128;
  for (let t = 0; t < 256; t += 1) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

/** Binarise once; every later question is a lookup. */
export function prepareRaster(img: GrayImage, maxSide = 1600): Raster {
  const factor = Math.max(1, Math.ceil(Math.max(img.width, img.height) / maxSide));
  const width = Math.ceil(img.width / factor);
  const height = Math.ceil(img.height / factor);
  const grey = new Uint8Array(width * height);
  if (factor === 1) grey.set(img.data.subarray(0, width * height));
  else {
    // Min-pool: the darkest source pixel wins, so thin lines survive.
    grey.fill(255);
    for (let y = 0; y < img.height; y += 1) {
      const row = y * img.width;
      const cy = ((y / factor) | 0) * width;
      for (let x = 0; x < img.width; x += 1) {
        const v = img.data[row + x];
        const c = cy + ((x / factor) | 0);
        if (v < grey[c]) grey[c] = v;
      }
    }
  }
  const hist = new Float64Array(256);
  for (let i = 0; i < grey.length; i += 1) hist[grey[i]] += 1;
  // Paper is the most common bright level; ink is everything clearly darker.
  let paper = 255;
  let paperCount = -1;
  for (let v = 128; v < 256; v += 1) if (hist[v] > paperCount) { paperCount = hist[v]; paper = v; }
  const threshold = Math.max(60, Math.min(200, otsu(hist, grey.length)));
  const faintThreshold = Math.max(threshold + 10, Math.min(paper - 16, 242));
  const dark = new Uint8Array(grey.length);
  const faint = new Uint8Array(grey.length);
  for (let i = 0; i < grey.length; i += 1) {
    const v = grey[i];
    if (v < threshold) dark[i] = 1;
    if (v < faintThreshold) faint[i] = 1;
  }
  const line = withoutSmallBlobs(dark, width, height, Math.max(12, Math.round(0.022 * Math.max(width, height))));
  return { width, height, factor, dark, faint, line, threshold, faintThreshold };
}

/** Dark pixels minus 8-connected blobs whose bounding box is smaller than `minSide` both ways. */
function withoutSmallBlobs(mask: Uint8Array, w: number, h: number, minSide: number): Uint8Array {
  const parent = new Int32Array(w * h).fill(-1);
  const find = (i: number) => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    while (parent[i] !== r) { const n = parent[i]; parent[i] = r; i = n; }
    return r;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra < rb ? rb : ra] = ra < rb ? ra : rb;
  };
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!mask[i]) continue;
      parent[i] = i;
      if (x > 0 && mask[i - 1]) union(i, i - 1);
      if (y > 0) {
        if (mask[i - w]) union(i, i - w);
        if (x > 0 && mask[i - w - 1]) union(i, i - w - 1);
        if (x + 1 < w && mask[i - w + 1]) union(i, i - w + 1);
      }
    }
  }
  const x0 = new Map<number, number[]>();
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (!mask[i]) continue;
      const r = find(i);
      const b = x0.get(r);
      if (!b) x0.set(r, [x, y, x, y]);
      else { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }
    }
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i += 1) {
    if (!mask[i]) continue;
    const b = x0.get(find(i))!;
    if (b[2] - b[0] + 1 >= minSide || b[3] - b[1] + 1 >= minSide) out[i] = 1;
  }
  return out;
}

const at = (r: Raster, m: Uint8Array, x: number, y: number) => {
  const xi = Math.round(x);
  const yi = Math.round(y);
  return xi >= 0 && yi >= 0 && xi < r.width && yi < r.height ? m[yi * r.width + xi] : 0;
};

// ── Walls ──────────────────────────────────────────────────────────────────

export interface SnappedWall {
  start: Pt;
  end: Pt;
  thicknessPx: number;
  /** How far the centreline moved, image pixels (signed along the left normal). */
  shiftPx: number;
  /** 0–1: how clearly the ink shows a wall band here. */
  strength: number;
}

/**
 * The wall band nearest the model's line: a solid (poché) band, or the two
 * face lines of a hollow (outlined, hatched) wall. Searches ±`searchPx`
 * across the wall. Null when there is no band: the model drew a wall the ink
 * does not have.
 */
export function snapWall(r: Raster, a: Pt, b: Pt, opts: { searchPx?: number; priorPx?: number | null; maxThickPx?: number } = {}): SnappedWall | null {
  const f = r.factor;
  const A = { x: a.x / f, y: a.y / f };
  const B = { x: b.x / f, y: b.y / f };
  const { len, u, n } = frame(A, B);
  if (len < 3) return null;
  const S = Math.max(3, Math.ceil((opts.searchPx ?? 20) / f));
  const maxT = Math.max(3, (opts.maxThickPx ?? 40) / f);
  const p = new Float64Array(2 * S + 1);
  let count = 0;
  const s0 = len * 0.1;
  const s1 = len * 0.9;
  const step = Math.max(1, (s1 - s0) / 400);
  for (let s = s0; s <= s1; s += step) {
    count += 1;
    const cx = A.x + u.x * s;
    const cy = A.y + u.y * s;
    for (let o = -S; o <= S; o += 1) if (at(r, r.line, cx + n.x * o, cy + n.y * o)) p[o + S] += 1;
  }
  if (count === 0) return null;
  let maxP = 0;
  for (let i = 0; i < p.length; i += 1) { p[i] /= count; if (p[i] > maxP) maxP = p[i]; }
  if (maxP < 0.1) return null;
  const theta = Math.max(0.1, 0.25 * maxP);
  const runs: Array<{ s: number; e: number; peak: number; mean: number }> = [];
  for (let i = 0; i < p.length;) {
    if (p[i] < theta) { i += 1; continue; }
    let j = i;
    let peak = 0;
    let sum = 0;
    while (j < p.length && p[j] >= theta) { peak = Math.max(peak, p[j]); sum += p[j]; j += 1; }
    runs.push({ s: i - S, e: j - 1 - S, peak, mean: sum / (j - i) });
    i = j;
  }
  const prior = opts.priorPx && opts.priorPx > 0 ? opts.priorPx : null;
  let best: { s: number; e: number; score: number } | null = null;
  const consider = (s: number, e: number, faces: number) => {
    const thick = (e - s + 1) * f;
    if (e - s + 1 > maxT) return;
    let score = faces;
    if (prior) score -= 0.8 * maxP * Math.min(1, Math.abs(thick - prior) / prior);
    else if (thick < 3) score -= 0.3 * maxP;
    score -= 0.25 * maxP * (Math.abs((s + e) / 2) / S);
    if (!best || score > best.score) best = { s, e, score };
  };
  for (let i = 0; i < runs.length; i += 1) {
    consider(runs[i].s, runs[i].e, runs[i].mean);
    for (let j = i + 1; j < runs.length; j += 1) consider(runs[i].s, runs[j].e, (runs[i].peak + runs[j].peak) / 2);
  }
  if (!best) return null;
  const { s, e, score } = best as { s: number; e: number; score: number };
  const mid = ((s + e) / 2) * f;
  return {
    start: { x: a.x + n.x * mid, y: a.y + n.y * mid },
    end: { x: b.x + n.x * mid, y: b.y + n.y * mid },
    thicknessPx: (e - s + 1) * f,
    shiftPx: mid,
    strength: Math.max(0, Math.min(1, score)),
  };
}

export type BandState = 0 | 1 | 2; // 0 nothing, 1 wall, 2 window (glazing lines inside the band)

export interface WallScan {
  /** Parameter (0 at start, 1 at end) of the first sample; samples are `dt` apart. */
  t0: number;
  dt: number;
  states: Uint8Array;
}

/**
 * Walk along a wall band and classify every step: solid wall, window (a
 * continuous line INSIDE the band, i.e. glazing), or nothing. `extendPx`
 * looks past both ends, so ends can be refined.
 */
export function scanWall(r: Raster, a: Pt, b: Pt, thicknessPx: number, extendPx = 0): WallScan {
  const f = r.factor;
  const A = { x: a.x / f, y: a.y / f };
  const B = { x: b.x / f, y: b.y / f };
  const { len, u, n } = frame(A, B);
  // Faces sit at ±h from the centreline; the interior keeps clear of both
  // face lines (they can be two pixels wide) so only glazing counts there.
  const h = Math.max(0.5, (thicknessPx / f - 1) / 2);
  const H = Math.ceil(h);
  const ext = extendPx / f;
  const steps = Math.max(1, Math.ceil(len + 2 * ext));
  const dt = 1 / Math.max(len, 1e-9);
  const t0 = -ext / Math.max(len, 1e-9);
  const states = new Uint8Array(steps + 1);
  const interior: number[] = [];
  const reach = h - 2.5;
  if (reach >= 0) for (let o = -reach; o <= reach + 1e-9; o += 1) interior.push(o);
  else if (h >= 1.5) interior.push(0);
  const lines = interior.map(() => new Uint8Array(steps + 1));
  const fill = new Float64Array(steps + 1);
  const faces = new Uint8Array(steps + 1);
  for (let i = 0; i <= steps; i += 1) {
    const s = -ext + i;
    const cx = A.x + u.x * s;
    const cy = A.y + u.y * s;
    let dark = 0;
    for (let o = -H; o <= H; o += 1) dark += at(r, r.line, cx + n.x * o, cy + n.y * o);
    fill[i] = dark / (2 * H + 1);
    const face = (side: number) => {
      for (let o = side * h - 1; o <= side * h + 1 + 1e-9; o += 1) if (at(r, r.line, cx + n.x * o, cy + n.y * o)) return true;
      return false;
    };
    faces[i] = face(-1) && face(1) ? 1 : 0;
    for (let k = 0; k < interior.length; k += 1) lines[k][i] = at(r, r.line, cx + n.x * interior[k], cy + n.y * interior[k]);
  }
  // A glazing line is CONTINUOUS along the band; hatching is not.
  const W = 3;
  for (let i = 0; i <= steps; i += 1) {
    let glazing = false;
    if (fill[i] < 0.6) {
      for (let k = 0; k < lines.length && !glazing; k += 1) {
        let on = 0;
        let tot = 0;
        for (let j = Math.max(0, i - W); j <= Math.min(steps, i + W); j += 1) { on += lines[k][j]; tot += 1; }
        if (on / tot >= 0.8) glazing = true;
      }
    }
    states[i] = fill[i] >= 0.6 ? 1 : glazing ? 2 : faces[i] ? 1 : 0;
  }
  return { t0, dt, states };
}

export interface Run { t0: number; t1: number; state: BandState }

/**
 * Runs of equal state. A gap or window shorter than `minGapT` is a blip (a
 * T-junction's missing face, a hatch, a letter) and becomes wall; a wall
 * run shorter than `minWallT` between two gaps is absorbed the other way.
 */
export function runsOf(scan: WallScan, minGapT: number, minWallT = minGapT / 3): Run[] {
  const raw: Run[] = [];
  const { states, t0, dt } = scan;
  for (let i = 0; i < states.length;) {
    let j = i;
    while (j < states.length && states[j] === states[i]) j += 1;
    raw.push({ t0: t0 + i * dt, t1: t0 + (j - 1) * dt, state: states[i] as BandState });
    i = j;
  }
  // Absorb short runs (a T-junction's missing face, a hatch blip) into the wall.
  let changed = true;
  let runs = raw;
  while (changed && runs.length > 1) {
    changed = false;
    let idx = -1;
    let shortest = Infinity;
    for (let i = 1; i < runs.length - 1; i += 1) {
      const l = runs[i].t1 - runs[i].t0 + dt;
      const min = runs[i].state === 1 ? minWallT : minGapT;
      if (l < min && l / min < shortest) { shortest = l / min; idx = i; }
    }
    if (idx < 0) break;
    const prev = runs[idx - 1];
    const next = runs[idx + 1];
    const into = prev && next ? (prev.state === 1 || next.state !== 1 ? prev : next) : (prev ?? next);
    into.t0 = Math.min(into.t0, runs[idx].t0);
    into.t1 = Math.max(into.t1, runs[idx].t1);
    runs = runs.filter((_, i) => i !== idx);
    // Merge equal neighbours.
    const merged: Run[] = [];
    for (const r of runs) {
      const last = merged[merged.length - 1];
      if (last && last.state === r.state) last.t1 = r.t1;
      else merged.push({ ...r });
    }
    runs = merged;
    changed = true;
  }
  return runs;
}

// ── Stairs ─────────────────────────────────────────────────────────────────

export interface Treads {
  orientation: 'V' | 'H';
  /** Positions of the tread lines (x for V, y for H), image px. */
  lines: number[];
  spacingPx: number;
  /** The flight's extent: along the run of lines, and across where they are inked. */
  box: { x: number; y: number; w: number; h: number };
  /** 0–1: how regular and how inked. */
  strength: number;
}

/**
 * A run of evenly spaced parallel lines inside `poly`: what a staircase
 * looks like in plan. A tile grid has the same in BOTH directions and is
 * rejected; so is anything with fewer than five lines.
 */
export function detectTreads(r: Raster, poly: Pt[], opts: { minSpacingPx: number; maxSpacingPx: number; exclude?: (x: number, y: number) => boolean }): Treads | null {
  const f = r.factor;
  const bb = bboxOf(poly);
  const x0 = Math.max(0, Math.floor(bb.x / f));
  const y0 = Math.max(0, Math.floor(bb.y / f));
  const x1 = Math.min(r.width - 1, Math.ceil((bb.x + bb.w) / f));
  const y1 = Math.min(r.height - 1, Math.ceil((bb.y + bb.h) / f));
  const W = x1 - x0 + 1;
  const H = y1 - y0 + 1;
  if (W < 8 || H < 8) return null;
  const inside = new Uint8Array(W * H);
  const ink = new Uint8Array(W * H);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const px = (x0 + x) * f;
      const py = (y0 + y) * f;
      if (!pointInPoly({ x: px, y: py }, poly)) continue;
      if (opts.exclude && opts.exclude(px, py)) continue;
      inside[y * W + x] = 1;
      ink[y * W + x] = r.faint[(y0 + y) * r.width + x0 + x];
    }
  }
  const profile = (vertical: boolean) => {
    const nOut = vertical ? W : H;
    const out = new Float64Array(nOut);
    for (let i = 0; i < nOut; i += 1) {
      let on = 0;
      let tot = 0;
      const m = vertical ? H : W;
      for (let j = 0; j < m; j += 1) {
        const k = vertical ? j * W + i : i * W + j;
        if (!inside[k]) continue;
        tot += 1;
        on += ink[k];
      }
      out[i] = tot >= 4 ? on / tot : 0;
    }
    return out;
  };
  const minS = opts.minSpacingPx / f;
  const maxS = opts.maxSpacingPx / f;
  const chain = (prof: Float64Array) => {
    const peaks: Array<{ i: number; v: number }> = [];
    for (let i = 0; i < prof.length; i += 1) {
      const v = prof[i];
      if (v < 0.25) continue;
      if ((i > 0 && prof[i - 1] > v) || (i + 1 < prof.length && prof[i + 1] >= v)) continue;
      peaks.push({ i, v });
    }
    let best: Array<{ i: number; v: number }> = [];
    for (let a = 0; a < peaks.length; a += 1) {
      for (let b = a + 1; b < peaks.length; b += 1) {
        const d = peaks[b].i - peaks[a].i;
        if (d < minS) continue;
        if (d > maxS) break;
        const c = [peaks[a], peaks[b]];
        let last = peaks[b];
        for (let k = b + 1; k < peaks.length; k += 1) {
          const dd = peaks[k].i - last.i;
          if (dd < d * 0.7) continue;
          if (dd > d * 1.3) break;
          c.push(peaks[k]);
          last = peaks[k];
        }
        if (c.length > best.length) best = c;
      }
    }
    return best;
  };
  const vChain = chain(profile(true));
  const hChain = chain(profile(false));
  const score = (c: Array<{ v: number }>) => (c.length >= 5 ? c.length * (c.reduce((s, p) => s + p.v, 0) / c.length) : 0);
  const sv = score(vChain);
  const sh = score(hChain);
  if (sv === 0 && sh === 0) return null;
  if (sv > 0 && sh > 0 && Math.min(sv, sh) >= 0.6 * Math.max(sv, sh)) return null; // a grid, not a flight
  const vertical = sv >= sh;
  const c = vertical ? vChain : hChain;
  const spacing = (c[c.length - 1].i - c[0].i) / (c.length - 1);
  // Across the lines: where most of them are inked.
  const m = vertical ? H : W;
  const across: number[] = [];
  for (let j = 0; j < m; j += 1) {
    let on = 0;
    for (const p of c) {
      const k = vertical ? j * W + p.i : p.i * W + j;
      if (ink[k] || (vertical ? (p.i + 1 < W && ink[k + 1]) || (p.i > 0 && ink[k - 1]) : (p.i + 1 < H && ink[k + W]) || (p.i > 0 && ink[k - W]))) on += 1;
    }
    if (on / c.length >= 0.5) across.push(j);
  }
  if (across.length < 3) return null;
  // The longest stretch, bridging small breaks (a landing between flights).
  let bestA = across[0];
  let bestB = across[0];
  let a = across[0];
  for (let k = 1; k <= across.length; k += 1) {
    if (k === across.length || across[k] - across[k - 1] > Math.max(3, spacing * 2)) {
      if (across[k - 1] - a > bestB - bestA) { bestA = a; bestB = across[k - 1]; }
      if (k < across.length) a = across[k];
    }
  }
  const lo = c[0].i - spacing / 2;
  const hi = c[c.length - 1].i + spacing / 2;
  const box = vertical
    ? { x: (x0 + lo) * f, y: (y0 + bestA) * f, w: (hi - lo) * f, h: (bestB - bestA + 1) * f }
    : { x: (x0 + bestA) * f, y: (y0 + lo) * f, w: (bestB - bestA + 1) * f, h: (hi - lo) * f };
  const regular = 1 - Math.min(1, c.slice(1).reduce((s, p, i) => s + Math.abs(p.i - c[i].i - spacing), 0) / (c.length - 1) / spacing);
  const inked = c.reduce((s, p) => s + p.v, 0) / c.length;
  return {
    orientation: vertical ? 'V' : 'H',
    lines: c.map((p) => ((vertical ? x0 : y0) + p.i) * f),
    spacingPx: spacing * f,
    box,
    strength: Math.max(0, Math.min(1, 0.5 * regular + 0.5 * Math.min(1, inked / 0.6))),
  };
}
