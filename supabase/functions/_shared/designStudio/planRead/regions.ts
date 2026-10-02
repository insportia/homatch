// HOMATCH DESIGN STUDIO — rooms as the space the WALLS enclose.
//
// A model's room polygon is a sketch: a corner cut diagonally, a stair hall
// swallowed into the kitchen, a porch that stops short of the building's
// edge. The fused walls are measured. So a room's outline is recomputed as
// the region its label sits in, flooded on a grid where the walls (and the
// stairs, which are architecture of their own) are solid and the building's
// footprint is the boundary. The outline then lies on the walls' faces by
// construction, and a printed "10'X14'" can be checked against it.
//
// Pure and dependency-free (Deno + Node + browser). Pixels in, pixels out.

import type { Box, Pt } from './types.ts';
import { bboxOf, dropCollinear, segDist, simplifyRing, signedArea } from './geom.ts';

export interface Grid {
  cell: number;
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** 1 = solid (wall, stairs), 2 = outside the footprint. */
  solid: Uint8Array;
}

export interface WallBand { start: Pt; end: Pt; thicknessPx: number }

const idx = (g: Grid, cx: number, cy: number) => cy * g.w + cx;
export const cellOf = (g: Grid, p: Pt) => ({ cx: Math.floor((p.x - g.x0) / g.cell), cy: Math.floor((p.y - g.y0) / g.cell) });
const centreOf = (g: Grid, cx: number, cy: number): Pt => ({ x: g.x0 + (cx + 0.5) * g.cell, y: g.y0 + (cy + 0.5) * g.cell });

/** Calls `fn` with the index of every cell whose centre lies inside `poly` (scanline fill). */
export function forEachCellIn(g: Grid, poly: Pt[], fn: (i: number) => void): void {
  if (poly.length < 3) return;
  const bb = bboxOf(poly);
  const cy0 = Math.max(0, Math.floor((bb.y - g.y0) / g.cell));
  const cy1 = Math.min(g.h - 1, Math.ceil((bb.y + bb.h - g.y0) / g.cell));
  const xs: number[] = [];
  for (let cy = cy0; cy <= cy1; cy += 1) {
    const y = g.y0 + (cy + 0.5) * g.cell;
    xs.length = 0;
    for (let k = 0, j = poly.length - 1; k < poly.length; j = k, k += 1) {
      const a = poly[k];
      const b = poly[j];
      if ((a.y > y) !== (b.y > y)) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
    }
    xs.sort((m, n) => m - n);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.cell - 0.5));
      const c1 = Math.min(g.w - 1, Math.floor((xs[k + 1] - g.x0) / g.cell - 0.5));
      for (let cx = c0; cx <= c1; cx += 1) fn(cy * g.w + cx);
    }
  }
}

/** A grid over `bounds` with every wall band solid and everything outside `footprint` marked outside. */
export function buildGrid(bounds: Box, walls: WallBand[], footprint: Pt[] | null, cell: number): Grid {
  const pad = 2 * cell;
  const x0 = Math.floor(bounds.x - pad);
  const y0 = Math.floor(bounds.y - pad);
  const w = Math.ceil((bounds.w + 2 * pad) / cell) + 1;
  const h = Math.ceil((bounds.h + 2 * pad) / cell) + 1;
  const g: Grid = { cell, x0, y0, w, h, solid: new Uint8Array(w * h) };
  if (footprint && footprint.length >= 3) {
    g.solid.fill(2);
    forEachCellIn(g, footprint, (i) => { g.solid[i] = 0; });
  }
  for (const wall of walls) paintBand(g, wall, 1);
  return g;
}

/** Marks a wall band (a capsule: the wall's thickness, closed past both ends by half of it). */
export function paintBand(g: Grid, wall: WallBand, value: 1 | 0): void {
  const r = Math.max(g.cell * 0.75, wall.thicknessPx / 2);
  const bb = bboxOf([wall.start, wall.end]);
  const c0 = cellOf(g, { x: bb.x - r - g.cell, y: bb.y - r - g.cell });
  const c1 = cellOf(g, { x: bb.x + bb.w + r + g.cell, y: bb.y + bb.h + r + g.cell });
  for (let cy = Math.max(0, c0.cy); cy <= Math.min(g.h - 1, c1.cy); cy += 1) {
    for (let cx = Math.max(0, c0.cx); cx <= Math.min(g.w - 1, c1.cx); cx += 1) {
      if (segDist(centreOf(g, cx, cy), wall.start, wall.end) <= r) {
        const i = idx(g, cx, cy);
        if (value === 1 && g.solid[i] === 0) g.solid[i] = 1;
      }
    }
  }
}

export function paintPolygon(g: Grid, poly: Pt[], value: 1): void {
  forEachCellIn(g, poly, (i) => { if (g.solid[i] === 0) g.solid[i] = value; });
}

export interface Region {
  mask: Uint8Array;
  cells: number;
  /** The flood reached the edge of the grid: the space is not enclosed. */
  leaked: boolean;
}

/** The nearest free cell to `p` within `radius` cells, or null. */
export function freeCellNear(g: Grid, p: Pt, radius = 10): { cx: number; cy: number } | null {
  const c = cellOf(g, p);
  for (let r = 0; r <= radius; r += 1) {
    let best: { cx: number; cy: number } | null = null;
    let bestD = Infinity;
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const cx = c.cx + dx;
        const cy = c.cy + dy;
        if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h || g.solid[idx(g, cx, cy)]) continue;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = { cx, cy }; }
      }
    }
    if (best) return best;
  }
  return null;
}

/** 4-connected flood over free cells from a seed cell. */
export function flood(g: Grid, seed: { cx: number; cy: number }, blocked?: Uint8Array): Region {
  const mask = new Uint8Array(g.w * g.h);
  const stack = [idx(g, seed.cx, seed.cy)];
  mask[stack[0]] = 1;
  let cells = 0;
  let leaked = false;
  while (stack.length) {
    const i = stack.pop()!;
    cells += 1;
    const cx = i % g.w;
    const cy = (i / g.w) | 0;
    if (cx === 0 || cy === 0 || cx === g.w - 1 || cy === g.h - 1) leaked = true;
    const push = (j: number) => {
      if (mask[j] || g.solid[j] || (blocked && blocked[j])) return;
      mask[j] = 1;
      stack.push(j);
    };
    if (cx > 0) push(i - 1);
    if (cx < g.w - 1) push(i + 1);
    if (cy > 0) push(i - g.w);
    if (cy < g.h - 1) push(i + g.w);
  }
  return { mask, cells, leaked };
}

/**
 * The outer outline of a region, as a simplified polygon in image pixels:
 * boundary cell edges linked into rings, the largest ring kept, then
 * Douglas–Peucker and collinear-point removal.
 */
export function outline(g: Grid, mask: Uint8Array, tolCells = 1.2, box?: CellBox): Pt[] {
  const W = g.w + 1;
  // Directed edges with the region on the left; keyed by start vertex.
  const next = new Map<number, number[]>();
  const add = (ax: number, ay: number, bx: number, by: number) => {
    const k = ay * W + ax;
    const list = next.get(k);
    const v = by * W + bx;
    if (list) list.push(v); else next.set(k, [v]);
  };
  const inside = (cx: number, cy: number) => cx >= 0 && cy >= 0 && cx < g.w && cy < g.h && mask[cy * g.w + cx] === 1;
  const [bx0, by0, bx1, by1] = box ?? [0, 0, g.w - 1, g.h - 1];
  for (let cy = by0; cy <= by1; cy += 1) {
    for (let cx = bx0; cx <= bx1; cx += 1) {
      if (!inside(cx, cy)) continue;
      // y grows downward; walking with the region on the left (counter-clockwise in screen terms).
      if (!inside(cx, cy - 1)) add(cx + 1, cy, cx, cy);
      if (!inside(cx, cy + 1)) add(cx, cy + 1, cx + 1, cy + 1);
      if (!inside(cx - 1, cy)) add(cx, cy, cx, cy + 1);
      if (!inside(cx + 1, cy)) add(cx + 1, cy + 1, cx + 1, cy);
    }
  }
  let best: Pt[] = [];
  let bestArea = 0;
  while (next.size) {
    const startKey = next.keys().next().value as number;
    const ring: number[] = [];
    let k = startKey;
    for (let guard = 0; guard < 4_000_000; guard += 1) {
      const list = next.get(k);
      if (!list || list.length === 0) break;
      const v = list.pop()!;
      if (list.length === 0) next.delete(k);
      ring.push(k);
      k = v;
      if (k === startKey) break;
    }
    if (ring.length < 4) continue;
    const pts = ring.map((key) => ({ x: g.x0 + (key % W) * g.cell, y: g.y0 + Math.floor(key / W) * g.cell }));
    const area = Math.abs(signedArea(pts));
    if (area > bestArea) { bestArea = area; best = pts; }
  }
  if (best.length < 4) return best;
  const simple = dropCollinear(simplifyRing(dropCollinear(best, 1), tolCells * g.cell), 3);
  return simple.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
}

/** Cells of `mask` (or of every free cell when mask is absent) that lie inside `poly`. */
export function maskInPolygon(g: Grid, poly: Pt[], mask?: Uint8Array): Uint8Array {
  const out = new Uint8Array(g.w * g.h);
  forEachCellIn(g, poly, (i) => { if (mask ? mask[i] : !g.solid[i]) out[i] = 1; });
  return out;
}

/** Inclusive cell bounds [cx0, cy0, cx1, cy1]. */
export type CellBox = [number, number, number, number];

/** The cells of every component, and each component's cell box. */
export function componentCells(g: Grid, labels: Int32Array, sizes: number[]): { cells: Int32Array[]; boxes: CellBox[] } {
  const cells = sizes.map((n) => new Int32Array(n));
  const fill = new Int32Array(sizes.length);
  const boxes: CellBox[] = sizes.map(() => [Infinity, Infinity, -Infinity, -Infinity] as CellBox);
  for (let i = 0; i < labels.length; i += 1) {
    const l = labels[i];
    if (!l) continue;
    cells[l][fill[l]] = i;
    fill[l] += 1;
    const cx = i % g.w;
    const cy = (i / g.w) | 0;
    const b = boxes[l];
    if (cx < b[0]) b[0] = cx;
    if (cy < b[1]) b[1] = cy;
    if (cx > b[2]) b[2] = cx;
    if (cy > b[3]) b[3] = cy;
  }
  return { cells, boxes };
}

/** Labels every free cell with its 4-connected component (0 = solid). */
export function labelComponents(g: Grid): { labels: Int32Array; sizes: number[]; leaked: boolean[] } {
  const labels = new Int32Array(g.w * g.h);
  const sizes: number[] = [0];
  const leaked: boolean[] = [false];
  const stack: number[] = [];
  let next = 1;
  for (let s = 0; s < labels.length; s += 1) {
    if (labels[s] || g.solid[s]) continue;
    const id = next;
    next += 1;
    let n = 0;
    let leak = false;
    labels[s] = id;
    stack.push(s);
    while (stack.length) {
      const i = stack.pop()!;
      n += 1;
      const cx = i % g.w;
      const cy = (i / g.w) | 0;
      if (cx === 0 || cy === 0 || cx === g.w - 1 || cy === g.h - 1) leak = true;
      if (cx > 0 && !labels[i - 1] && !g.solid[i - 1]) { labels[i - 1] = id; stack.push(i - 1); }
      if (cx < g.w - 1 && !labels[i + 1] && !g.solid[i + 1]) { labels[i + 1] = id; stack.push(i + 1); }
      if (cy > 0 && !labels[i - g.w] && !g.solid[i - g.w]) { labels[i - g.w] = id; stack.push(i - g.w); }
      if (cy < g.h - 1 && !labels[i + g.w] && !g.solid[i + g.w]) { labels[i + g.w] = id; stack.push(i + g.w); }
    }
    sizes.push(n);
    leaked.push(leak);
  }
  return { labels, sizes, leaked };
}
