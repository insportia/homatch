// HOMATCH DESIGN STUDIO — small plane geometry for plan reading.
// Pure and dependency-free (Deno + Node + browser).

import type { Box, Pt } from './types.ts';

export const dist = (a: Pt, b: Pt) => Math.hypot(b.x - a.x, b.y - a.y);
export const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const round1 = (n: number) => Math.round(n * 10) / 10;
export const roundPt = (p: Pt): Pt => ({ x: round1(p.x), y: round1(p.y) });

/** Unit direction and left normal of a segment. */
export function frame(a: Pt, b: Pt) {
  const len = dist(a, b) || 1e-9;
  const u = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  return { len, u, n: { x: -u.y, y: u.x } };
}

/** Parameter of p's projection on a→b (0 at a, 1 at b; unclamped). */
export function projT(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1e-9;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
}

/** Distance from p to the segment a–b. */
export function segDist(p: Pt, a: Pt, b: Pt): number {
  const t = Math.max(0, Math.min(1, projT(p, a, b)));
  return dist(p, lerp(a, b, t));
}

/** Perpendicular distance from p to the infinite line through a, b. */
export function lineDist(p: Pt, a: Pt, b: Pt): number {
  const { n } = frame(a, b);
  return Math.abs((p.x - a.x) * n.x + (p.y - a.y) * n.y);
}

/** Undirected angle of a segment in degrees, 0 ≤ θ < 180. */
export function angleOf(a: Pt, b: Pt): number {
  let d = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  while (d < 0) d += 180;
  while (d >= 180) d -= 180;
  return d;
}

/** Smallest difference between two undirected angles (0–90). */
export function angleDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 180;
  return Math.min(d, 180 - d);
}

export function signedArea(poly: Pt[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export const polyArea = (poly: Pt[]) => Math.abs(signedArea(poly));

export function centroid(poly: Pt[]): Pt {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-6) {
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

export function pointInPoly(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

export function bboxOf(points: Pt[]): Box {
  let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  if (!Number.isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const boxCenter = (b: Box): Pt => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });
export const boxPoly = (b: Box): Pt[] => [{ x: b.x, y: b.y }, { x: b.x + b.w, y: b.y }, { x: b.x + b.w, y: b.y + b.h }, { x: b.x, y: b.y + b.h }];

/** A point well inside the polygon: its centroid when inside, else the interior sample farthest from the edges. */
export function interiorPoint(poly: Pt[]): Pt {
  const c = centroid(poly);
  const edgeDist = (p: Pt) => {
    let m = Infinity;
    for (let i = 0; i < poly.length; i += 1) m = Math.min(m, segDist(p, poly[i], poly[(i + 1) % poly.length]));
    return m;
  };
  if (pointInPoly(c, poly) && edgeDist(c) > 2) return c;
  const b = bboxOf(poly);
  let best = c;
  let bestD = -1;
  const steps = 12;
  for (let i = 1; i < steps; i += 1) {
    for (let j = 1; j < steps; j += 1) {
      const p = { x: b.x + (b.w * i) / steps, y: b.y + (b.h * j) / steps };
      if (!pointInPoly(p, poly)) continue;
      const d = edgeDist(p);
      if (d > bestD) { bestD = d; best = p; }
    }
  }
  return best;
}

export function rotatePt(p: Pt, rad: number, about: Pt = { x: 0, y: 0 }): Pt {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  const dx = p.x - about.x;
  const dy = p.y - about.y;
  return { x: about.x + dx * c - dy * s, y: about.y + dx * s + dy * c };
}

/** Intersection of the infinite lines a1–a2 and b1–b2, or null when parallel. */
export function lineIntersection(a1: Pt, a2: Pt, b1: Pt, b2: Pt): Pt | null {
  const d = (a1.x - a2.x) * (b1.y - b2.y) - (a1.y - a2.y) * (b1.x - b2.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((a1.x - b1.x) * (b1.y - b2.y) - (a1.y - b1.y) * (b1.x - b2.x)) / d;
  return { x: a1.x + t * (a2.x - a1.x), y: a1.y + t * (a2.y - a1.y) };
}

export function median(values: number[]): number {
  if (values.length === 0) return NaN;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Weighted median of (value, weight) pairs. */
export function weightedMedian(items: Array<{ v: number; w: number }>): number {
  const s = items.filter((i) => i.w > 0 && Number.isFinite(i.v)).sort((a, b) => a.v - b.v);
  if (s.length === 0) return NaN;
  const total = s.reduce((a, i) => a + i.w, 0);
  let acc = 0;
  for (const i of s) {
    acc += i.w;
    if (acc >= total / 2) return i.v;
  }
  return s[s.length - 1].v;
}

/**
 * A room's size along two axes (the plan's own, rotated by `axisDeg`): the
 * MEDIAN chord in each direction, so an alcove or a notch does not change
 * what a printed "10'X14'" is compared against. Pixels.
 */
export function medianExtents(poly: Pt[], axisDeg = 0): { w: number; d: number } {
  if (poly.length < 3) return { w: 0, d: 0 };
  const rad = (-axisDeg * Math.PI) / 180;
  const p = poly.map((q) => rotatePt(q, rad));
  const chordsAlong = (horizontal: boolean) => {
    const b = bboxOf(p);
    const span = horizontal ? b.h : b.w;
    const lo = horizontal ? b.y : b.x;
    const samples = Math.max(8, Math.min(200, Math.round(span)));
    const out: number[] = [];
    for (let i = 0; i < samples; i += 1) {
      const c = lo + ((i + 0.5) * span) / samples;
      const xs: number[] = [];
      for (let k = 0; k < p.length; k += 1) {
        const a = p[k];
        const bb = p[(k + 1) % p.length];
        const a1 = horizontal ? a.y : a.x;
        const b1 = horizontal ? bb.y : bb.x;
        if ((a1 > c) === (b1 > c)) continue;
        const t = (c - a1) / (b1 - a1);
        xs.push(horizontal ? a.x + t * (bb.x - a.x) : a.y + t * (bb.y - a.y));
      }
      xs.sort((m, n) => m - n);
      let len = 0;
      for (let k = 0; k + 1 < xs.length; k += 2) len += xs[k + 1] - xs[k];
      if (len > 0) out.push(len);
    }
    return out.length ? median(out) : 0;
  };
  return { w: chordsAlong(true), d: chordsAlong(false) };
}

/** Douglas–Peucker on a closed ring. */
export function simplifyRing(ring: Pt[], tol: number): Pt[] {
  if (ring.length <= 4) return ring;
  // Split the ring at its two farthest-apart points and simplify each half.
  let i0 = 0;
  let i1 = 0;
  let best = -1;
  for (let i = 0; i < ring.length; i += 1) {
    const d = dist(ring[0], ring[i]);
    if (d > best) { best = d; i1 = i; }
  }
  best = -1;
  for (let i = 0; i < ring.length; i += 1) {
    const d = dist(ring[i1], ring[i]);
    if (d > best) { best = d; i0 = i; }
  }
  const [a, b] = i0 < i1 ? [i0, i1] : [i1, i0];
  const dp = (pts: Pt[]): Pt[] => {
    if (pts.length <= 2) return pts;
    let idx = -1;
    let m = -1;
    for (let i = 1; i < pts.length - 1; i += 1) {
      const d = segDist(pts[i], pts[0], pts[pts.length - 1]);
      if (d > m) { m = d; idx = i; }
    }
    if (m <= tol) return [pts[0], pts[pts.length - 1]];
    const left = dp(pts.slice(0, idx + 1));
    const right = dp(pts.slice(idx));
    return [...left.slice(0, -1), ...right];
  };
  const first = dp(ring.slice(a, b + 1));
  const second = dp([...ring.slice(b), ...ring.slice(0, a + 1)]);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

/** Drops vertices whose two edges are (almost) collinear. */
export function dropCollinear(ring: Pt[], tolDeg = 4): Pt[] {
  let out = ring;
  for (let pass = 0; pass < 3; pass += 1) {
    const next: Pt[] = [];
    for (let i = 0; i < out.length; i += 1) {
      const p = out[(i - 1 + out.length) % out.length];
      const c = out[i];
      const n = out[(i + 1) % out.length];
      if (dist(p, c) < 0.5) continue;
      if (angleDiff(angleOf(p, c), angleOf(c, n)) < tolDeg) continue;
      next.push(c);
    }
    if (next.length === out.length || next.length < 3) return next.length >= 3 ? next : out;
    out = next;
  }
  return out;
}

/**
 * A room's MAIN rectangle along the plan's axes (rotated by `axisDeg`): the
 * largest axis-aligned rectangle inside its outline. A printed "10'X20'"
 * describes the body of a room, not the alcove beside the stairs or the
 * recess at the bathroom door, so this — not the bounding box, not the
 * area — is what printed sizes are checked against. Pixels.
 */
export function mainRectangle(poly: Pt[], axisDeg = 0): { w: number; d: number } {
  if (poly.length < 3) return { w: 0, d: 0 };
  const rad = (-axisDeg * Math.PI) / 180;
  const p = poly.map((q) => rotatePt(q, rad));
  const bb = bboxOf(p);
  const res = Math.max(0.5, Math.max(bb.w, bb.h) / 600);
  const W = Math.max(1, Math.round(bb.w / res));
  const H = Math.max(1, Math.round(bb.h / res));
  const heights = new Int32Array(W);
  const xs: number[] = [];
  let bestA = 0;
  let bestW = 0;
  let bestH = 0;
  const stack: number[] = [];
  for (let row = 0; row < H; row += 1) {
    const y = bb.y + (row + 0.5) * res;
    xs.length = 0;
    for (let k = 0, j = p.length - 1; k < p.length; j = k, k += 1) {
      const a = p[k];
      const b = p[j];
      if ((a.y > y) !== (b.y > y)) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    xs.sort((m, n) => m - n);
    const inside = new Uint8Array(W);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - bb.x) / res - 0.5));
      const c1 = Math.min(W - 1, Math.floor((xs[k + 1] - bb.x) / res - 0.5));
      for (let c = c0; c <= c1; c += 1) inside[c] = 1;
    }
    for (let c = 0; c < W; c += 1) heights[c] = inside[c] ? heights[c] + 1 : 0;
    // Largest rectangle in the histogram of this row.
    stack.length = 0;
    for (let c = 0; c <= W; c += 1) {
      const hgt = c === W ? 0 : heights[c];
      while (stack.length && heights[stack[stack.length - 1]] >= hgt) {
        const top = stack.pop()!;
        const left = stack.length ? stack[stack.length - 1] + 1 : 0;
        const width = c - left;
        const area = width * heights[top];
        if (area > bestA) { bestA = area; bestW = width; bestH = heights[top]; }
      }
      stack.push(c);
    }
  }
  return { w: bestW * res, d: bestH * res };
}

/**
 * Makes a ring square to the plan's axes: an edge that is within `tol` of
 * horizontal or vertical (in the plan's own frame) becomes exactly so, its
 * two ends meeting at the mean line. Leaves genuinely diagonal edges alone.
 */
export function squareRing(ring: Pt[], axisDeg: number, tol: number): Pt[] {
  if (ring.length < 4) return ring;
  const rad = (axisDeg * Math.PI) / 180;
  const p = ring.map((q) => rotatePt(q, -rad));
  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < p.length; i += 1) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      const dx = Math.abs(b.x - a.x);
      const dy = Math.abs(b.y - a.y);
      if (dy > 0 && dy <= tol && dx >= dy) { const y = (a.y + b.y) / 2; a.y = y; b.y = y; }
      else if (dx > 0 && dx <= tol && dy > dx) { const x = (a.x + b.x) / 2; a.x = x; b.x = x; }
    }
  }
  return dropCollinear(p.map((q) => rotatePt(q, rad)), 2);
}
