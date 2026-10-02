// HOMATCH DESIGN STUDIO — the model's reading, fused with the drawing's ink.
//
// The model is right about WHAT is on the plan (that is a wall, that is the
// kitchen, there is a door between them) and approximate about WHERE. The
// raster is exact about where and knows nothing about what. Fusion keeps the
// model's answers and replaces its coordinates with measured ones:
//
//   walls      snapped to their ink band (centre + thickness), made square to
//              the plan's axes, duplicates merged, collinear pieces joined
//              across door-sized gaps, ends extended/trimmed to the ink and
//              joined into L/T junctions; a dangling end that stops a door's
//              width short of another wall is carried across (that gap IS a
//              door); a boundary between two rooms with no wall but with ink
//              gets the wall the model missed
//   openings   placed in the measured gaps of their walls (the reading's
//              centre point when it gave one; otherwise matched by wall,
//              width and type); gaps no opening claimed become openings of
//              their own, at a lower confidence
//   rooms      kinds settled from their labels (any of six languages);
//              outlines recomputed as the space the walls enclose, so they
//              sit on wall faces; stairs carved out of whatever swallowed them
//   stairs     the reading's flights checked for treads, and flights the
//              reading missed found from their treads
//
// Without a raster (a WebP upload) fusion still settles kinds, merges walls,
// recomputes outlines from the walls and places nothing it cannot see.
//
// Ids survive: an element that exists in the reading keeps its id in the
// fused document (corrections are keyed by id). New elements get "hm-" ids.
//
// Pure and dependency-free (Deno + Node + browser). Never golden-specific:
// every threshold is in metres (via a prior scale) or relative to the
// drawing's own wall thickness.

import type { DimString, Opening, PlanDoc, Pt, Room, RoomKind, Stair, Wall } from './types.ts';
import {
  angleDiff, angleOf, bboxOf, boxPoly, centroid, dist, dropCollinear, frame, interiorPoint, lerp, lineDist, lineIntersection,
  median, medianExtents, pointInPoly, polyArea, projT, round1, roundPt, segDist, squareRing, weightedMedian,
} from './geom.ts';
import { detectTreads, runsOf, scanWall, snapWall, type Raster, type Run } from './raster.ts';
import { buildGrid, componentCells, forEachCellIn, freeCellNear, labelComponents, outline, paintPolygon, type CellBox, type Grid } from './regions.ts';
import { parseDimension } from './dimensions.ts';
import { OUTDOOR_KINDS, settleKind } from './roomKinds.ts';

export interface FuseMeta {
  priorScale: number | null;
  wallThicknessPx: number | null;
  /** Plan axis (degrees) the walls are squared to; null when the plan is not orthogonal. */
  axisDeg: number | null;
  roomKind: Record<string, { confidence: number; matched: string | null; outdoor: boolean; modelKind: string }>;
  roomGeometry: Record<string, 'REGION' | 'REGION_CLIPPED' | 'MODEL'>;
  /** How each opening was placed. */
  openingSource: Record<string, 'CENTER' | 'GAP' | 'RASTER' | 'MODEL'>;
  /** How well an opening's TYPE agrees with its gap (1 agrees, lower conflicts). */
  openingTypeAgreement: Record<string, number>;
  /** Fraction of each final wall's length the ink confirms (null: no raster). */
  wallInk: Record<string, number | null>;
  inferredWalls: string[];
  mergedWalls: Array<{ from: string; into: string }>;
  removedWalls: string[];
  /** Openings dropped as a second reading of one already placed. */
  droppedOpenings: Array<{ id: string; duplicateOf: string }>;
  stairEvidence: Record<string, { model: boolean; treads: number | null; strength: number }>;
  uncovered: Array<{ polygon: Pt[]; areaPx: number }>;
  footprintSource: 'MODEL' | 'DERIVED' | null;
  /** Each room's printed dimension and where it came from. */
  roomDimension: Record<string, { text: string; source: 'READING' | 'EVIDENCE'; confidence: number }>;
  rasterUsed: boolean;
}

export interface FuseResult { doc: PlanDoc; dimensionStrings: DimString[]; meta: FuseMeta }

interface WW {
  w: Wall;
  T: number;
  strength: number;
  anchored: [boolean, boolean];
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ── Scale prior (for thresholds only; the solve comes later) ───────────────

export function priorScale(doc: PlanDoc, dims: DimString[]): number | null {
  const items: Array<{ v: number; w: number }> = [];
  if (doc.detectedScale && doc.detectedScale > 0) items.push({ v: doc.detectedScale, w: 0.5 * Math.max(0.2, doc.scaleConfidence) });
  for (const d of dims) {
    const px = dist(d.from, d.to);
    const val = (d.text ? parseDimension(d.text)?.values[0] : null) ?? d.valueM;
    if (px >= 20 && val > 0) items.push({ v: val / px, w: Math.max(0.2, d.confidence) });
  }
  for (const r of [...doc.rooms, ...doc.balconies]) {
    const parsed = parseDimension(r.dimensionText ?? null);
    if (!parsed || parsed.values.length !== 2 || r.polygon.length < 3) continue;
    const { w, d } = medianExtents(r.polygon);
    if (w < 5 || d < 5) continue;
    const [a, b] = parsed.values;
    const straight = Math.abs(Math.log((a / w) / (b / d)));
    const crossed = Math.abs(Math.log((a / d) / (b / w)));
    const pair = straight <= crossed ? [a / w, b / d] : [a / d, b / w];
    for (const v of pair) items.push({ v, w: 0.3 * parsed.confidence });
  }
  const m = weightedMedian(items);
  return Number.isFinite(m) && m > 0 ? m : null;
}

// ── Walls ──────────────────────────────────────────────────────────────────

function wallAngle(w: Wall) { return angleOf(w.start, w.end); }
const wlen = (w: Wall) => dist(w.start, w.end);

/** The plan's dominant axis (mod 90°) and how much of the wall length follows it. */
function dominantAxis(walls: Wall[]): { axis: number; share: number } {
  let sx = 0;
  let sy = 0;
  let total = 0;
  for (const w of walls) {
    const L = wlen(w);
    const a = (wallAngle(w) * 4 * Math.PI) / 180;
    sx += L * Math.cos(a);
    sy += L * Math.sin(a);
    total += L;
  }
  // In (−45°, 45°]: an upright plan is 0, not 90.
  let axis = ((Math.atan2(sy, sx) * 180) / Math.PI) / 4;
  axis = ((axis % 90) + 90) % 90;
  if (axis > 45) axis -= 90;
  if (Math.abs(axis) < 1e-9) axis = 0;
  let on = 0;
  for (const w of walls) {
    const a = wallAngle(w);
    if (Math.min(angleDiff(a, axis), angleDiff(a, axis + 90)) <= 5) on += wlen(w);
  }
  return { axis, share: total ? on / total : 0 };
}

function squareTo(w: Wall, axis: number): void {
  const a = wallAngle(w);
  const target = angleDiff(a, axis) <= angleDiff(a, axis + 90) ? axis : axis + 90;
  if (angleDiff(a, target) > 5) return;
  const mid = lerp(w.start, w.end, 0.5);
  const L = wlen(w) / 2;
  const rad = (target * Math.PI) / 180;
  const u = { x: Math.cos(rad), y: Math.sin(rad) };
  const sign = (w.end.x - w.start.x) * u.x + (w.end.y - w.start.y) * u.y >= 0 ? 1 : -1;
  w.start = { x: mid.x - sign * u.x * L, y: mid.y - sign * u.y * L };
  w.end = { x: mid.x + sign * u.x * L, y: mid.y + sign * u.y * L };
}

/** Merge b into a: one wall along a's line spanning both. */
function mergeInto(a: WW, b: WW): void {
  const { u } = frame(a.w.start, a.w.end);
  const wa = Math.max(0.05, a.strength) * wlen(a.w);
  const wb = Math.max(0.05, b.strength) * wlen(b.w);
  const ts = [0, 1, projT(b.w.start, a.w.start, a.w.end), projT(b.w.end, a.w.start, a.w.end)];
  const t0 = Math.min(...ts);
  const t1 = Math.max(...ts);
  const L = wlen(a.w);
  // Weighted centreline offset.
  const { n } = frame(a.w.start, a.w.end);
  const off = ((b.w.start.x + b.w.end.x) / 2 - a.w.start.x) * n.x + ((b.w.start.y + b.w.end.y) / 2 - a.w.start.y) * n.y;
  const shift = (off * wb) / (wa + wb);
  const s = { x: a.w.start.x + u.x * t0 * L + n.x * shift, y: a.w.start.y + u.y * t0 * L + n.y * shift };
  const e = { x: a.w.start.x + u.x * t1 * L + n.x * shift, y: a.w.start.y + u.y * t1 * L + n.y * shift };
  a.w.start = s;
  a.w.end = e;
  if (b.strength * wlen(b.w) > a.strength * wlen(a.w) * 1.5) a.T = b.T;
  a.strength = (a.strength * wa + b.strength * wb) / (wa + wb);
  if (b.w.kind === 'EXTERIOR') a.w.kind = 'EXTERIOR';
  a.w.confidence = Math.max(a.w.confidence, b.w.confidence);
}

/** Collinear-and-close: duplicates, overlaps, touching pieces, and pieces a door's width apart. */
function mergeCollinear(ws: WW[], maxGapPx: number, merged: Array<{ from: string; into: string }>): WW[] {
  let list = ws;
  let again = true;
  while (again) {
    again = false;
    outer: for (let i = 0; i < list.length; i += 1) {
      for (let j = 0; j < list.length; j += 1) {
        if (i === j) continue;
        const a = list[i];
        const b = list[j];
        if (angleDiff(wallAngle(a.w), wallAngle(b.w)) > 3) continue;
        const tol = Math.max(a.T, b.T) * 0.6 + 2;
        if (lineDist(b.w.start, a.w.start, a.w.end) > tol || lineDist(b.w.end, a.w.start, a.w.end) > tol) continue;
        const L = wlen(a.w);
        const tb0 = projT(b.w.start, a.w.start, a.w.end) * L;
        const tb1 = projT(b.w.end, a.w.start, a.w.end) * L;
        const lo = Math.min(tb0, tb1);
        const hi = Math.max(tb0, tb1);
        const gap = Math.max(lo - L, -hi);
        if (gap > maxGapPx) continue;
        // Keep the longer one's id (it is the better-read wall).
        const [keep, drop] = wlen(a.w) >= wlen(b.w) ? [a, b] : [b, a];
        mergeInto(keep, drop);
        merged.push({ from: drop.w.id, into: keep.w.id });
        list = list.filter((x) => x !== drop);
        again = true;
        break outer;
      }
    }
  }
  return list;
}

/** Join ends into L/T junctions: an end near another wall's line moves onto it. */
function joinEnds(ws: WW[], maxSnapPx: number): void {
  for (const a of ws) {
    for (const endIdx of [0, 1] as const) {
      const P = endIdx === 0 ? a.w.start : a.w.end;
      const Q = endIdx === 0 ? a.w.end : a.w.start;
      const { u } = frame(Q, P); // outward
      let best: { X: Pt; s: number } | null = null;
      for (const b of ws) {
        if (b === a) continue;
        if (angleDiff(wallAngle(a.w), wallAngle(b.w)) < 30) continue;
        const X = lineIntersection(a.w.start, a.w.end, b.w.start, b.w.end);
        if (!X) continue;
        const Lb = wlen(b.w);
        const tb = projT(X, b.w.start, b.w.end) * Lb;
        if (tb < -(b.T / 2 + a.T / 2 + 2) || tb > Lb + b.T / 2 + a.T / 2 + 2) continue;
        const s = (X.x - P.x) * u.x + (X.y - P.y) * u.y; // + ahead, − behind
        if (s > maxSnapPx || s < -(b.T / 2 + a.T + 2)) continue;
        if (!best || Math.abs(s) < Math.abs(best.s)) best = { X, s };
      }
      if (best) {
        if (endIdx === 0) a.w.start = best.X; else a.w.end = best.X;
        a.anchored[endIdx] = true;
      }
    }
  }
}

/** Carry a dangling end across a door-sized gap to the wall it points at. Returns true when it did. */
function bridgeEnd(a: WW, endIdx: 0 | 1, ws: WW[], minPx: number, maxPx: number): boolean {
  const P = endIdx === 0 ? a.w.start : a.w.end;
  const Q = endIdx === 0 ? a.w.end : a.w.start;
  const { u } = frame(Q, P);
  let best: { X: Pt; s: number } | null = null;
  for (const b of ws) {
    if (b === a) continue;
    if (angleDiff(wallAngle(a.w), wallAngle(b.w)) < 30) continue;
    const X = lineIntersection(a.w.start, a.w.end, b.w.start, b.w.end);
    if (!X) continue;
    const Lb = wlen(b.w);
    const tb = projT(X, b.w.start, b.w.end) * Lb;
    if (tb < -b.T / 2 || tb > Lb + b.T / 2) continue;
    const s = (X.x - P.x) * u.x + (X.y - P.y) * u.y;
    const clear = s - b.T / 2;
    if (clear < minPx || clear > maxPx) continue;
    if (!best || s < best.s) best = { X, s };
  }
  if (!best) return false;
  if (endIdx === 0) a.w.start = best.X; else a.w.end = best.X;
  a.anchored[endIdx] = true;
  return true;
}

// ── Openings ───────────────────────────────────────────────────────────────

interface Gap { wallId: string; t0: number; t1: number; kind: 'EMPTY' | 'WINDOW'; center: Pt; widthPx: number }

function gapsOf(r: Raster, ww: WW, minGapPx: number, maxGapPx: number): { gaps: Gap[]; coverage: number; runs: Run[] } {
  const L = wlen(ww.w);
  const scan = scanWall(r, ww.w.start, ww.w.end, ww.T, 0);
  const runs = runsOf(scan, minGapPx / L, Math.max(2, ww.T * 0.5) / L);
  const gaps: Gap[] = [];
  let solid = 0;
  for (const run of runs) {
    const a = Math.max(0, run.t0);
    const b = Math.min(1, run.t1 + 1 / L);
    if (b <= a) continue;
    if (run.state !== 0) solid += b - a;
    const len = (b - a) * L;
    if (run.state === 1 || len < minGapPx || len > maxGapPx) continue;
    // A gap is between two pieces of something: an end of the wall counts
    // only when it is joined to another wall.
    if ((a <= 1e-6 && !ww.anchored[0] && run.state === 0) || (b >= 1 - 1e-6 && !ww.anchored[1] && run.state === 0)) continue;
    gaps.push({
      wallId: ww.w.id, t0: a, t1: b, kind: run.state === 2 ? 'WINDOW' : 'EMPTY',
      center: lerp(ww.w.start, ww.w.end, (a + b) / 2), widthPx: len,
    });
  }
  return { gaps, coverage: clamp01(solid), runs };
}

// ── The fusion ─────────────────────────────────────────────────────────────

export interface FuseInput { doc: PlanDoc; dimensionStrings: DimString[]; raster?: Raster | null }

export function fuse(input: FuseInput): FuseResult {
  const raw = input.doc;
  const doc: PlanDoc = clone(raw);
  const r = input.raster ?? null;
  const meta: FuseMeta = {
    priorScale: null, wallThicknessPx: null, axisDeg: null, roomKind: {}, roomGeometry: {}, openingSource: {},
    openingTypeAgreement: {}, wallInk: {}, inferredWalls: [], mergedWalls: [], removedWalls: [], droppedOpenings: [], stairEvidence: {},
    uncovered: [], footprintSource: null, roomDimension: {}, rasterUsed: !!r,
  };
  const ids = new Set<string>([...doc.walls, ...doc.doors, ...doc.windows, ...doc.rooms, ...doc.balconies, ...(doc.stairs ?? [])].map((e) => e.id));
  const newId = (prefix: string) => { let k = 1; while (ids.has(`hm-${prefix}${k}`)) k += 1; const id = `hm-${prefix}${k}`; ids.add(id); return id; };

  // ── 1. Rooms: kinds from labels; printed sizes; outdoor spaces apart ────
  for (const room of [...doc.rooms, ...doc.balconies]) {
    let text = room.dimensionText ?? null;
    let source: 'READING' | 'EVIDENCE' = 'READING';
    if (!parseDimension(text) && room.evidence) {
      // Older readings quoted the printed size in their evidence ("Label reads BEDROOM 9'X14'").
      const m = room.evidence.match(/[\d][\d\s'"′″.,\-xX×]*[\d'"′″]/g);
      const cand = m?.map((s) => s.trim()).find((s) => (parseDimension(s)?.values.length ?? 0) === 2);
      if (cand) { text = cand; source = 'EVIDENCE'; }
    }
    const parsed = parseDimension(text);
    if (parsed && text) {
      room.dimensionText = text;
      meta.roomDimension[room.id] = { text, source, confidence: parsed.confidence * (source === 'EVIDENCE' ? 0.85 : 1) };
    }
  }
  const allRooms = [...doc.rooms, ...doc.balconies];
  const indoor: Room[] = [];
  const outdoor: Room[] = [];
  for (const room of allRooms) {
    const wasBalcony = doc.balconies.includes(room);
    const cls = settleKind(room.label, room.kind as RoomKind, room.confidence);
    meta.roomKind[room.id] = { confidence: cls.confidence, matched: cls.matched, outdoor: cls.outdoor || (wasBalcony && !cls.matched), modelKind: room.kind };
    room.kind = cls.kind === 'UNKNOWN' && wasBalcony ? 'BALCONY' : cls.kind;
    if (meta.roomKind[room.id].outdoor) {
      if (!OUTDOOR_KINDS.has(room.kind)) room.kind = 'TERRACE';
      outdoor.push(room);
    } else indoor.push(room);
  }
  doc.rooms = indoor;
  doc.balconies = outdoor;

  // ── 2. Scale prior and the drawing's wall thickness ─────────────────────
  const scale = priorScale(doc, input.dimensionStrings);
  meta.priorScale = scale;
  const maxSide = Math.max(doc.imageWidth, doc.imageHeight);
  // Thresholds are in metres. Without a printed size, the drawing's own wall
  // thickness stands in for a ruler (a wall is about 0.2 m) — for thresholds
  // only; the document's scale stays null.
  let ruler = scale;
  const m2px = (m: number, fallbackFrac: number) => (ruler ? m / ruler : fallbackFrac * maxSide);
  const modelT = median(doc.walls.map((w) => w.thicknessPx ?? NaN).filter((n) => Number.isFinite(n) && n > 0));
  let T0 = Number.isFinite(modelT) ? modelT : null;

  let ws: WW[] = doc.walls.map((w) => ({ w: { ...w }, T: w.thicknessPx ?? T0 ?? 6, strength: 0, anchored: [false, false] as [boolean, boolean] }));

  if (r) {
    const maxThick = scale ? Math.max(6, 0.6 / scale) : 0.04 * maxSide;
    const snapOne = (x: WW, prior: number | null) => snapWall(r, x.w.start, x.w.end, { priorPx: prior, searchPx: Math.max(20, 2.5 * (prior ?? 8)), maxThickPx: maxThick });
    const first = ws.map((x) => snapOne(x, x.w.thicknessPx ?? T0));
    const strong = first.filter((s) => s && s.strength >= 0.5).map((s) => s!.thicknessPx);
    if (strong.length >= 2) T0 = median(strong);
    ws.forEach((x, i) => {
      let s = first[i];
      if (s && T0 && Math.abs(s.thicknessPx - T0) / T0 > 0.35) s = snapOne(x, T0) ?? s;
      if (!s || s.strength < 0.1) { x.T = x.w.thicknessPx ?? T0 ?? 6; x.strength = 0; return; }
      x.w.start = s.start;
      x.w.end = s.end;
      x.T = T0 && s.strength < 0.4 && Math.abs(s.thicknessPx - T0) / T0 > 0.3 ? T0 : s.thicknessPx;
      x.strength = s.strength;
    });
  }
  meta.wallThicknessPx = T0;
  const T = T0 ?? 6;
  if (!ruler && T0) ruler = 0.2 / T0;
  const minGapPx = Math.max(1.5 * T, m2px(0.4, 0.012));
  const maxOpeningPx = m2px(3.6, 0.1);
  const doorMinPx = m2px(0.5, 0.012);
  const doorMaxPx = m2px(1.65, 0.05);

  // ── 3. Square to the plan's axes; merge duplicates and collinear pieces ─
  const { axis, share } = dominantAxis(ws.map((x) => x.w));
  if (ws.length >= 3 && share >= 0.7) {
    meta.axisDeg = Math.round(axis * 100) / 100;
    for (const x of ws) squareTo(x.w, axis);
  }
  ws = mergeCollinear(ws, doorMaxPx, meta.mergedWalls);

  // ── 4. Walls the model missed: a shared room boundary that has ink ─────
  if (r) {
    const rooms = [...doc.rooms, ...doc.balconies];
    for (let i = 0; i < rooms.length; i += 1) {
      for (let j = i + 1; j < rooms.length; j += 1) {
        const A = rooms[i].polygon;
        const B = rooms[j].polygon;
        for (let p = 0; p < A.length; p += 1) {
          const a0 = A[p];
          const a1 = A[(p + 1) % A.length];
          const la = dist(a0, a1);
          if (la < minGapPx) continue;
          for (let q = 0; q < B.length; q += 1) {
            const b0 = B[q];
            const b1 = B[(q + 1) % B.length];
            if (angleDiff(angleOf(a0, a1), angleOf(b0, b1)) > 5) continue;
            const sep = lineDist(b0, a0, a1);
            if (sep > 2 * T + 8) continue;
            const t0 = projT(b0, a0, a1) * la;
            const t1 = projT(b1, a0, a1) * la;
            const lo = Math.max(0, Math.min(t0, t1));
            const hi = Math.min(la, Math.max(t0, t1));
            if (hi - lo < Math.max(minGapPx, m2px(0.6, 0.02))) continue;
            const { u, n } = frame(a0, a1);
            const sgn = ((b0.x - a0.x) * n.x + (b0.y - a0.y) * n.y) >= 0 ? 1 : -1;
            const mid = (sep / 2) * sgn;
            const s0 = { x: a0.x + u.x * lo + n.x * mid, y: a0.y + u.y * lo + n.y * mid };
            const s1 = { x: a0.x + u.x * hi + n.x * mid, y: a0.y + u.y * hi + n.y * mid };
            const covered = ws.some((x) => angleDiff(wallAngle(x.w), angleOf(s0, s1)) <= 5
              && lineDist(lerp(s0, s1, 0.5), x.w.start, x.w.end) <= x.T + 6
              && overlapLen(x.w, s0, s1) >= 0.5 * (hi - lo));
            if (covered) continue;
            const snap = snapWall(r, s0, s1, { priorPx: T, searchPx: Math.max(12, 2 * T), maxThickPx: 3 * T });
            if (!snap || snap.strength < 0.25) continue;
            const probe: WW = { w: { id: '', start: snap.start, end: snap.end, kind: 'INTERIOR', thicknessPx: snap.thicknessPx, confidence: 0, state: 'UNVERIFIED' }, T: snap.thicknessPx, strength: snap.strength, anchored: [true, true] };
            const { coverage } = gapsOf(r, probe, minGapPx, maxOpeningPx);
            if (coverage < 0.35) continue;
            const outdoorSide = OUTDOOR_KINDS.has(rooms[i].kind) !== OUTDOOR_KINDS.has(rooms[j].kind);
            const id = newId('w');
            probe.w = {
              id, start: snap.start, end: snap.end, kind: outdoorSide ? 'EXTERIOR' : 'INTERIOR', thicknessPx: snap.thicknessPx,
              confidence: Math.round((0.45 + 0.4 * coverage) * 100) / 100,
              evidence: `Inferred: the boundary between ${rooms[i].id} and ${rooms[j].id} has wall ink over ${Math.round(coverage * 100)}% of its length.`,
              state: 'UNVERIFIED',
            };
            probe.anchored = [false, false];
            if (meta.axisDeg != null) squareTo(probe.w, meta.axisDeg);
            ws.push(probe);
            meta.inferredWalls.push(id);
          }
        }
      }
    }
    ws = mergeCollinear(ws, doorMaxPx, meta.mergedWalls);
    meta.inferredWalls = meta.inferredWalls.filter((id) => ws.some((x) => x.w.id === id));
  }

  // ── 5. Ends: extend along the ink, join junctions, trim, bridge ─────────
  if (r) {
    for (const x of ws) {
      const L = wlen(x.w);
      const ext = Math.max(3 * x.T, minGapPx);
      const scan = scanWall(r, x.w.start, x.w.end, x.T, ext);
      const i0 = Math.round((0 - scan.t0) / scan.dt);
      const i1 = Math.round((1 - scan.t0) / scan.dt);
      let a = i0;
      let b = i1;
      // Walk out while there is ink, stepping over the short hole a crossing
      // wall's open face leaves (up to about one and a half thicknesses).
      const hole = Math.max(2, Math.ceil((1.5 * x.T) / r.factor));
      const inkAhead = (k: number, dir: number) => {
        for (let q = 1; q <= hole; q += 1) {
          const j = k + dir * q;
          if (j < 0 || j >= scan.states.length) return -1;
          if (scan.states[j] !== 0) return j;
        }
        return -1;
      };
      for (let j = inkAhead(a, -1); j >= 0; j = inkAhead(a, -1)) a = j;
      for (let j = inkAhead(b, 1); j >= 0; j = inkAhead(b, 1)) b = j;
      const ta = Math.min(0, scan.t0 + a * scan.dt);
      const tb = Math.max(1, scan.t0 + b * scan.dt);
      if (L > 0) {
        const s = lerp(x.w.start, x.w.end, ta);
        const e = lerp(x.w.start, x.w.end, tb);
        x.w.start = s;
        x.w.end = e;
      }
    }
  }
  const maxSnap = Math.max(T, m2px(0.25, 0.008));
  joinEnds(ws, maxSnap);
  if (r) {
    // Trim ends the ink does not support (the model drew past the wall).
    for (const x of ws) {
      const L = wlen(x.w);
      if (L < 1) continue;
      const scan = scanWall(r, x.w.start, x.w.end, x.T, 0);
      const runs = runsOf(scan, minGapPx / L, Math.max(2, x.T * 0.5) / L);
      if (runs.length === 0) continue;
      const first = runs[0];
      const last = runs[runs.length - 1];
      let t0 = 0;
      let t1 = 1;
      if (runs.length > 1 && first.state === 0 && !x.anchored[0] && (first.t1 - first.t0) * L >= minGapPx) t0 = first.t1;
      if (runs.length > 1 && last.state === 0 && !x.anchored[1] && (last.t1 - last.t0) * L >= minGapPx) t1 = last.t0;
      if (t0 > 0 || t1 < 1) {
        const s = lerp(x.w.start, x.w.end, t0);
        const e = lerp(x.w.start, x.w.end, t1);
        x.w.start = s;
        x.w.end = e;
      }
    }
    joinEnds(ws, maxSnap);
    for (const x of ws) {
      for (const endIdx of [0, 1] as const) {
        if (!x.anchored[endIdx]) bridgeEnd(x, endIdx, ws, doorMinPx, doorMaxPx);
      }
    }
    ws = mergeCollinear(ws, doorMaxPx, meta.mergedWalls);
  }
  // Walls with no length left, and walls the ink entirely denies.
  ws = ws.filter((x) => {
    if (wlen(x.w) >= Math.max(3, T)) return true;
    meta.removedWalls.push(x.w.id);
    return false;
  });

  // ── 6. Gaps and openings ────────────────────────────────────────────────
  const gaps: Gap[] = [];
  for (const x of ws) {
    if (!r) { meta.wallInk[x.w.id] = null; continue; }
    const g = gapsOf(r, x, minGapPx, maxOpeningPx);
    meta.wallInk[x.w.id] = Math.round(g.coverage * 100) / 100;
    gaps.push(...g.gaps);
  }
  const wallById = new Map(ws.map((x) => [x.w.id, x]));
  const resolveWall = (id: string): WW | null => {
    let cur = id;
    for (let k = 0; k < 10; k += 1) {
      const hit = wallById.get(cur);
      if (hit) return hit;
      const m = meta.mergedWalls.find((mm) => mm.from === cur);
      if (!m) return null;
      cur = m.into;
    }
    return null;
  };
  const pxPerM = ruler ? 1 / ruler : maxSide / 20;
  const openings = [
    ...doc.doors.map((o) => ({ o, type: 'DOOR' as const })),
    ...doc.windows.map((o) => ({ o, type: 'WINDOW' as const })),
  ];
  const endish = openings.filter(({ o }) => o.position <= 0.02 || o.position >= 0.98).length;
  const positionsUnreliable = openings.length > 0 && endish / openings.length >= 0.5;
  const claimed = new Set<Gap>();
  const placed = new Map<string, { wall: WW; center: Pt; widthPx: number; source: 'CENTER' | 'GAP' | 'MODEL'; agree: number }>();

  // (a) Openings with a drawn centre: their gap is the one around that point.
  // The host is the wall the centre lies in: the named wall when it is the
  // nearest, otherwise whichever nearby wall has an open gap right there
  // (a reading often names the neighbouring wall of a corner).
  const reachPx = m2px(0.3, 0.01);
  const gapAt = (x: WW, c: Pt, widthPx: number) => {
    const L = wlen(x.w);
    const t = projT(c, x.w.start, x.w.end);
    const slack = 0.5 * (widthPx / L);
    return gaps.filter((gg) => gg.wallId === x.w.id && !claimed.has(gg) && t >= gg.t0 - slack && t <= gg.t1 + slack)
      .sort((p, q) => dist(p.center, c) - dist(q.center, c))[0] ?? null;
  };
  for (const { o, type } of openings) {
    if (!o.centerPx) continue;
    const c = o.centerPx;
    const named = resolveWall(o.wallId);
    const near = ws.filter((x) => segDist(c, x.w.start, x.w.end) <= x.T / 2 + reachPx);
    let host: WW | null = null;
    let g: Gap | null = null;
    let bestScore = Infinity;
    for (const x of near) {
      const gg = gapAt(x, c, o.widthPx);
      const score = segDist(c, x.w.start, x.w.end) - (x === named ? x.T / 2 : 0) - (gg ? 2 * reachPx : 0);
      if (score < bestScore) { bestScore = score; host = x; g = gg; }
    }
    if (!host) host = named;
    if (!host) continue;
    const t = clamp01(projT(c, host.w.start, host.w.end));
    if (g) {
      claimed.add(g);
      placed.set(o.id, { wall: host, center: g.center, widthPx: g.widthPx, source: 'CENTER', agree: (g.kind === 'WINDOW') === (type === 'WINDOW') ? 1 : 0.4 });
    } else {
      placed.set(o.id, { wall: host, center: lerp(host.w.start, host.w.end, t), widthPx: o.widthPx, source: 'CENTER', agree: r ? 0.6 : 1 });
    }
  }
  // (b) The rest: matched to unclaimed gaps by wall, width, type and (when credible) position.
  if (r) {
    const cands: Array<{ id: string; g: Gap; cost: number }> = [];
    for (const { o, type } of openings) {
      if (placed.has(o.id)) continue;
      const claimedWall = resolveWall(o.wallId);
      const modelWall = raw.walls.find((w) => w.id === o.wallId);
      for (const g of gaps) {
        if (claimed.has(g)) continue;
        let cost = 0;
        if (claimedWall && g.wallId === claimedWall.w.id) cost += 0;
        else if (modelWall) cost += segDist(g.center, modelWall.start, modelWall.end) / pxPerM;
        else cost += 2;
        if (cost > 2.5) continue;
        if (!positionsUnreliable && modelWall) cost += 0.5 * dist(g.center, lerp(modelWall.start, modelWall.end, o.position)) / pxPerM;
        cost += 0.5 * Math.abs(o.widthPx - g.widthPx) / Math.max(o.widthPx, g.widthPx);
        if ((g.kind === 'WINDOW') !== (type === 'WINDOW')) cost += 1.0;
        if (cost <= 2.5) cands.push({ id: o.id, g, cost });
      }
    }
    cands.sort((p, q) => p.cost - q.cost);
    for (const c of cands) {
      if (placed.has(c.id) || claimed.has(c.g)) continue;
      const type = doc.windows.some((w) => w.id === c.id) ? 'WINDOW' : 'DOOR';
      claimed.add(c.g);
      placed.set(c.id, { wall: wallById.get(c.g.wallId)!, center: c.g.center, widthPx: c.g.widthPx, source: 'GAP', agree: (c.g.kind === 'WINDOW') === (type === 'WINDOW') ? 1 : 0.4 });
    }
  }
  const windowIds = new Set(doc.windows.map((w) => w.id));
  const isWindow = (id: string) => windowIds.has(id);
  const finish = (o: Opening): Opening | null => {
    const p = placed.get(o.id);
    if (p) {
      const t = clamp01(projT(p.center, p.wall.w.start, p.wall.w.end));
      meta.openingSource[o.id] = p.source;
      meta.openingTypeAgreement[o.id] = p.agree;
      return {
        ...o, wallId: p.wall.w.id, position: Math.round(t * 10000) / 10000, widthPx: round1(Math.min(p.widthPx, wlen(p.wall.w) * 0.98)),
        centerPx: roundPt(p.center), confidence: p.agree < 1 ? Math.min(o.confidence, 0.6) : o.confidence,
      };
    }
    const host = resolveWall(o.wallId);
    if (!host) return null;
    // The same opening read twice: an unplaced one beside a placed one of its type.
    const nominal = lerp(host.w.start, host.w.end, clamp01(o.position));
    const twin = r ? [...placed.entries()].find(([id, p]) => isWindow(id) === isWindow(o.id) && dist(p.center, nominal) <= Math.max(pxPerM, o.widthPx)) : null;
    if (twin) {
      meta.droppedOpenings.push({ id: o.id, duplicateOf: twin[0] });
      return null;
    }
    meta.openingSource[o.id] = 'MODEL';
    meta.openingTypeAgreement[o.id] = r ? 0.5 : 1;
    const t = clamp01(o.position);
    return { ...o, wallId: host.w.id, position: t, centerPx: roundPt(lerp(host.w.start, host.w.end, t)), confidence: r ? Math.min(o.confidence, 0.5) : o.confidence };
  };
  doc.doors = doc.doors.map(finish).filter(Boolean) as Opening[];
  doc.windows = doc.windows.map(finish).filter(Boolean) as Opening[];
  // (c) Gaps nobody claimed are openings the reading missed.
  for (const g of gaps) {
    if (claimed.has(g)) continue;
    const isWindow = g.kind === 'WINDOW';
    const id = newId(isWindow ? 'win' : 'door');
    const o: Opening = {
      id, wallId: g.wallId, position: Math.round(((g.t0 + g.t1) / 2) * 10000) / 10000, widthPx: round1(g.widthPx),
      sillHeightM: null, heightM: null, centerPx: roundPt(g.center), leaf: null, swingRoomId: null,
      confidence: 0.7, evidence: isWindow ? 'Found in the drawing: glazing lines across a wall.' : 'Found in the drawing: a gap in a wall.',
      state: 'UNVERIFIED',
    };
    meta.openingSource[id] = 'RASTER';
    meta.openingTypeAgreement[id] = isWindow ? 0.9 : 0.75;
    (isWindow ? doc.windows : doc.doors).push(o);
  }

  // ── 7. Footprint ────────────────────────────────────────────────────────
  const exterior = ws.filter((x) => x.w.kind === 'EXTERIOR');
  let footprint: Pt[] | null = null;
  if (doc.footprint && doc.footprint.length >= 3) {
    footprint = snapFootprint(doc.footprint, exterior);
    meta.footprintSource = 'MODEL';
  } else if (exterior.length >= 2) {
    const pts: Pt[] = [];
    for (const x of exterior) {
      const { n } = frame(x.w.start, x.w.end);
      for (const p of [x.w.start, x.w.end]) for (const s of [-1, 1]) pts.push({ x: p.x + n.x * s * x.T / 2, y: p.y + n.y * s * x.T / 2 });
    }
    for (const b of doc.balconies) pts.push(...b.polygon);
    const bb = bboxOf(pts);
    const box = boxPoly(bb);
    // A box is the footprint only when the rooms fill it (a rectangular building).
    const rooms = [...doc.rooms, ...doc.balconies];
    let hit = 0;
    let tot = 0;
    for (let i = 1; i < 20; i += 1) {
      for (let j = 1; j < 20; j += 1) {
        const p = { x: bb.x + (bb.w * i) / 20, y: bb.y + (bb.h * j) / 20 };
        tot += 1;
        if (rooms.some((rm) => pointInPoly(p, rm.polygon))) hit += 1;
      }
    }
    if (meta.axisDeg != null && Math.abs(meta.axisDeg) < 1 && tot && hit / tot >= 0.75) {
      footprint = box.map(roundPt);
      meta.footprintSource = 'DERIVED';
    }
  }
  doc.footprint = footprint;

  // ── 8. Stairs: the reading's, verified; the ones it missed, found ───────
  const stairs: Stair[] = (doc.stairs ?? []).map((s) => ({ ...s }));
  const bounds = bboxOf([
    ...ws.flatMap((x) => [x.w.start, x.w.end]), ...(footprint ?? []), ...[...doc.rooms, ...doc.balconies].flatMap((rm) => rm.polygon),
  ]);
  // About 400k cells at most: fine plans stay at one pixel per cell; the
  // outlines are snapped onto the measured wall faces afterwards anyway.
  const cell = Math.max(1, Math.ceil(Math.sqrt(((bounds.w + 8) * (bounds.h + 8)) / 400_000)));
  const bands = ws.map((x) => ({ start: x.w.start, end: x.w.end, thicknessPx: x.T }));
  const treadRange = { minSpacingPx: m2px(0.15, 0.006), maxSpacingPx: m2px(0.42, 0.04) };
  const all = [...doc.rooms, ...doc.balconies];
  if (r) {
    for (const s of stairs) {
      const tr = detectTreads(r, s.polygon, treadRange);
      meta.stairEvidence[s.id] = { model: true, treads: tr ? tr.lines.length : null, strength: tr ? tr.strength : 0 };
      if (tr && s.treads == null) s.treads = tr.lines.length;
    }
    // Look for flights in every enclosed space the reading did not mark as stairs.
    const base = buildGrid(bounds, bands, footprint, cell);
    const comps = labelComponents(base);
    const parts = componentCells(base, comps.labels, comps.sizes);
    const minCells = (m2px(1.2, 0.03) ** 2) / (cell * cell);
    const touched = new Set<number>();
    for (const rm of all) forEachCellIn(base, rm.polygon, (i) => { if (comps.labels[i]) touched.add(comps.labels[i]); });
    for (const id of touched) {
      if (comps.leaked[id] || comps.sizes[id] < minCells) continue;
      const mask = new Uint8Array(base.w * base.h);
      for (const i of parts.cells[id]) mask[i] = 1;
      if (stairs.some((s) => regionHas(base, mask, interiorPoint(s.polygon)))) continue;
      const tr = detectTreads(r, boxPolyOf(base, parts.boxes[id]), { ...treadRange, exclude: (x, y) => !regionHas(base, mask, { x, y }) });
      if (!tr || tr.strength < 0.55) continue;
      const poly = expandToWalls(base, tr.box, m2px(1.2, 0.04));
      const sid = newId('stair');
      stairs.push({
        id: sid, polygon: poly.map(roundPt), startEdge: null, direction: 'UNKNOWN', treads: tr.lines.length,
        confidence: Math.round((0.45 + 0.4 * tr.strength) * 100) / 100,
        evidence: `Found in the drawing: ${tr.lines.length} evenly spaced tread lines.`, state: 'UNVERIFIED',
      });
      meta.stairEvidence[sid] = { model: false, treads: tr.lines.length, strength: tr.strength };
    }
  }
  doc.stairs = stairs;

  // ── 9. Room outlines: the space the walls enclose, stairs carved out ────
  // Each room takes the enclosed space its own outline overlaps most. A
  // space two rooms both mostly overlap (an open plan with no wall between)
  // is shared out by their outlines instead.
  const grid = buildGrid(bounds, bands, footprint, cell);
  for (const s of stairs) paintPolygon(grid, s.polygon, 1);
  const comps = labelComponents(grid);
  const parts = componentCells(grid, comps.labels, comps.sizes);
  const inter = all.map((rm) => {
    const counts = new Map<number, number>();
    let own = 0;
    forEachCellIn(grid, rm.polygon, (i) => { own += 1; const l = comps.labels[i]; if (l) counts.set(l, (counts.get(l) ?? 0) + 1); });
    // A printed label is the strongest evidence of which space is the room's.
    const seed = seedOf(grid, rm, doc, true);
    if (seed) { const l = comps.labels[seed.cy * grid.w + seed.cx]; if (l) counts.set(l, (counts.get(l) ?? 0) + own); }
    let best = 0;
    let bestN = 0;
    for (const [l, n] of counts) if (n > bestN) { best = l; bestN = n; }
    return { own: Math.max(1, own), best, bestN };
  });
  const claimedCells = new Uint8Array(grid.w * grid.h);
  all.forEach((rm, k) => {
    const { own, best, bestN } = inter[k];
    const modelArea = polyArea(rm.polygon);
    let mask: Uint8Array | null = null;
    let kind: 'REGION' | 'REGION_CLIPPED' | 'MODEL' = 'MODEL';
    if (best && bestN >= 0.2 * own) {
      const shared = inter.some((o, j) => j !== k && o.best === best && o.bestN >= 0.3 * o.own);
      const ratio = (comps.sizes[best] * cell * cell) / Math.max(1, modelArea);
      mask = new Uint8Array(grid.w * grid.h);
      if (!shared && !comps.leaked[best] && ratio >= 0.35 && ratio <= 3) {
        for (const i of parts.cells[best]) mask[i] = 1;
        kind = 'REGION';
      } else {
        const m = mask;
        forEachCellIn(grid, rm.polygon, (i) => { if (comps.labels[i] === best) m[i] = 1; });
        kind = 'REGION_CLIPPED';
      }
    }
    if (mask) {
      let n = 0;
      for (const i of parts.cells[best]) if (mask[i]) { n += 1; claimedCells[i] = 1; }
      const poly = n * cell * cell >= 0.25 * modelArea ? outline(grid, mask, 1.2, parts.boxes[best]) : [];
      if (poly.length >= 3) {
        const square = meta.axisDeg != null ? squareRing(poly, meta.axisDeg, 3 * cell + 1) : poly;
        rm.polygon = dropCollinear(snapToFaces(square, ws, cell + 1.5), 2).map(roundPt);
        meta.roomGeometry[rm.id] = kind;
        return;
      }
    }
    meta.roomGeometry[rm.id] = 'MODEL';
    rm.polygon = rm.polygon.map(roundPt);
  });
  // Space inside the footprint that no room, wall or stair accounts for.
  if (footprint) {
    const minArea = Math.max(m2px(1.0, 0.02) ** 2, 0.01 * polyArea(footprint));
    for (let id = 1; id < comps.sizes.length; id += 1) {
      if (comps.leaked[id] || comps.sizes[id] * cell * cell < minArea) continue;
      const mask = new Uint8Array(grid.w * grid.h);
      let free = 0;
      for (const i of parts.cells[id]) if (!claimedCells[i]) { mask[i] = 1; free += 1; }
      if (free * cell * cell < minArea) continue;
      const poly = outline(grid, mask, 1.2, parts.boxes[id]);
      if (poly.length >= 3) meta.uncovered.push({ polygon: poly, areaPx: Math.round(free * cell * cell) });
    }
  }

  // ── 10. Dimension strings: spans snapped to the measured geometry ───────
  const dims = input.dimensionStrings.map((d) => snapDimension(d, ws, footprint));

  // ── Write back ──────────────────────────────────────────────────────────
  doc.walls = ws.map((x) => ({
    ...x.w, start: roundPt(x.w.start), end: roundPt(x.w.end), thicknessPx: round1(x.T),
    confidence: r && meta.wallInk[x.w.id] != null && meta.wallInk[x.w.id]! < 0.25 ? Math.min(x.w.confidence, 0.5) : x.w.confidence,
  }));
  doc.warnings = doc.warnings.filter((w) => w.code !== 'OPENING_WITHOUT_WALL' || [...doc.doors, ...doc.windows].every((o) => o.id !== w.elementId));
  const conf = [...doc.walls, ...doc.doors, ...doc.windows, ...doc.rooms, ...doc.balconies].map((e) => e.confidence);
  doc.extractionConfidence = conf.length ? Math.min(...conf) : 0;
  return { doc, dimensionStrings: dims, meta };
}

// ── Helpers ────────────────────────────────────────────────────────────────

function overlapLen(w: Wall, s0: Pt, s1: Pt): number {
  const L = dist(s0, s1);
  const a = projT(w.start, s0, s1) * L;
  const b = projT(w.end, s0, s1) * L;
  return Math.max(0, Math.min(L, Math.max(a, b)) - Math.max(0, Math.min(a, b)));
}

function seedOf(g: Grid, rm: Room, doc: PlanDoc, labelOnly = false) {
  const label = (doc.texts ?? []).find((t) => t.roomId === rm.id && t.role === 'ROOM_LABEL');
  if (!label && labelOnly) return null;
  const p = label ? { x: label.box.x + label.box.w / 2, y: label.box.y + label.box.h / 2 } : interiorPoint(rm.polygon);
  return freeCellNear(g, p, 12);
}

function regionHas(g: Grid, mask: Uint8Array, p: Pt): boolean {
  const cx = Math.floor((p.x - g.x0) / g.cell);
  const cy = Math.floor((p.y - g.y0) / g.cell);
  return cx >= 0 && cy >= 0 && cx < g.w && cy < g.h && mask[cy * g.w + cx] === 1;
}

function boxPolyOf(g: Grid, b: CellBox): Pt[] {
  return boxPoly({ x: g.x0 + b[0] * g.cell, y: g.y0 + b[1] * g.cell, w: (b[2] - b[0] + 1) * g.cell, h: (b[3] - b[1] + 1) * g.cell });
}

/**
 * An outline's edges moved onto the wall faces they run along (within
 * `tol`), so a room measures from face to face whatever the grid's cell.
 */
function snapToFaces(poly: Pt[], ws: WW[], tol: number): Pt[] {
  const lines = poly.map((a, i) => {
    const b = poly[(i + 1) % poly.length];
    const L = dist(a, b);
    if (L < 2) return { a, b };
    const { n } = frame(a, b);
    const mid = lerp(a, b, 0.5);
    let best: { d: number; shift: number } | null = null;
    for (const x of ws) {
      if (angleDiff(angleOf(a, b), wallAngle(x.w)) > 3) continue;
      if (overlapLen(x.w, a, b) < 0.5 * L) continue;
      // Signed distance from the edge to the wall's centreline, along the edge's normal.
      const toCentre = (x.w.start.x - mid.x) * n.x + (x.w.start.y - mid.y) * n.y;
      for (const face of [toCentre - x.T / 2, toCentre + x.T / 2]) {
        if (Math.abs(face) <= tol && (!best || Math.abs(face) < best.d)) best = { d: Math.abs(face), shift: face };
      }
    }
    if (!best) return { a, b };
    const off = { x: n.x * best.shift, y: n.y * best.shift };
    return { a: { x: a.x + off.x, y: a.y + off.y }, b: { x: b.x + off.x, y: b.y + off.y } };
  });
  return poly.map((p, i) => {
    const prev = lines[(i - 1 + poly.length) % poly.length];
    const cur = lines[i];
    if (angleDiff(angleOf(prev.a, prev.b), angleOf(cur.a, cur.b)) < 10) return cur.a;
    return lineIntersection(prev.a, prev.b, cur.a, cur.b) ?? p;
  });
}

/** Grow a stair box outward to the walls that enclose its compartment (a landing beside the treads). */
function expandToWalls(g: Grid, box: { x: number; y: number; w: number; h: number }, maxPx: number): Pt[] {
  let { x: x0, y: y0 } = box;
  let x1 = box.x + box.w;
  let y1 = box.y + box.h;
  const solidFrac = (ax: number, ay: number, bx: number, by: number) => {
    let s = 0;
    let n = 0;
    const steps = Math.max(2, Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) / g.cell));
    for (let k = 0; k <= steps; k += 1) {
      const p = { x: ax + ((bx - ax) * k) / steps, y: ay + ((by - ay) * k) / steps };
      const cx = Math.floor((p.x - g.x0) / g.cell);
      const cy = Math.floor((p.y - g.y0) / g.cell);
      n += 1;
      if (cx < 0 || cy < 0 || cx >= g.w || cy >= g.h || g.solid[cy * g.w + cx]) s += 1;
    }
    return s / n;
  };
  const grow = (side: 'L' | 'R' | 'T' | 'B') => {
    for (let d = 0; d <= maxPx; d += g.cell) {
      const hit = side === 'L' ? solidFrac(x0 - d, y0, x0 - d, y1) : side === 'R' ? solidFrac(x1 + d, y0, x1 + d, y1)
        : side === 'T' ? solidFrac(x0, y0 - d, x1, y0 - d) : solidFrac(x0, y1 + d, x1, y1 + d);
      if (hit >= 0.5) return d + g.cell;
    }
    return 0;
  };
  const dl = grow('L');
  const dr = grow('R');
  const dt = grow('T');
  const db = grow('B');
  x0 -= dl; x1 += dr; y0 -= dt; y1 += db;
  // A side that ended up inside a wall band comes back to the band's face.
  const shrink = (side: 'L' | 'R' | 'T' | 'B') => {
    for (let k = 0; k < 40; k += 1) {
      const f = side === 'L' ? solidFrac(x0, y0, x0, y1) : side === 'R' ? solidFrac(x1, y0, x1, y1)
        : side === 'T' ? solidFrac(x0, y0, x1, y0) : solidFrac(x0, y1, x1, y1);
      const inner = side === 'L' ? solidFrac(x0 + g.cell, y0, x0 + g.cell, y1) : side === 'R' ? solidFrac(x1 - g.cell, y0, x1 - g.cell, y1)
        : side === 'T' ? solidFrac(x0, y0 + g.cell, x1, y0 + g.cell) : solidFrac(x0, y1 - g.cell, x1, y1 - g.cell);
      if (f < 0.5 || inner < 0.5) return;
      if (side === 'L') x0 += g.cell; else if (side === 'R') x1 -= g.cell; else if (side === 'T') y0 += g.cell; else y1 -= g.cell;
    }
  };
  shrink('L'); shrink('R'); shrink('T'); shrink('B');
  return boxPoly({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
}

/** Footprint edges moved onto the outer faces of the exterior walls they follow. */
function snapFootprint(fp: Pt[], exterior: WW[]): Pt[] {
  const c = centroid(fp);
  const lines = fp.map((a, i) => {
    const b = fp[(i + 1) % fp.length];
    let best: { a: Pt; b: Pt; d: number } | null = null;
    for (const x of exterior) {
      if (angleDiff(angleOf(a, b), wallAngle(x.w)) > 5) continue;
      const d = lineDist(lerp(a, b, 0.5), x.w.start, x.w.end);
      if (d > x.T + 10) continue;
      if (overlapLen(x.w, a, b) < 0.3 * dist(a, b)) continue;
      const { n } = frame(x.w.start, x.w.end);
      const side = ((c.x - x.w.start.x) * n.x + (c.y - x.w.start.y) * n.y) > 0 ? -1 : 1;
      const off = { x: n.x * side * x.T / 2, y: n.y * side * x.T / 2 };
      if (!best || d < best.d) best = { a: { x: x.w.start.x + off.x, y: x.w.start.y + off.y }, b: { x: x.w.end.x + off.x, y: x.w.end.y + off.y }, d };
    }
    return best ? { a: best.a, b: best.b } : { a, b };
  });
  return fp.map((p, i) => {
    const prev = lines[(i - 1 + fp.length) % fp.length];
    const cur = lines[i];
    return roundPt(lineIntersection(prev.a, prev.b, cur.a, cur.b) ?? p);
  });
}

/** A printed dimension's span, its ends moved onto the nearest measured wall face or footprint edge. */
function snapDimension(d: DimString, ws: WW[], footprint: Pt[] | null): DimString {
  const horizontal = Math.abs(d.to.x - d.from.x) >= Math.abs(d.to.y - d.from.y);
  const along = (p: Pt) => (horizontal ? p.x : p.y);
  const cands: number[] = [];
  for (const x of ws) {
    const a = wallAngle(x.w);
    const perpendicular = horizontal ? angleDiff(a, 90) <= 3 : angleDiff(a, 0) <= 3;
    if (!perpendicular) continue;
    const c = horizontal ? (x.w.start.x + x.w.end.x) / 2 : (x.w.start.y + x.w.end.y) / 2;
    cands.push(c - x.T / 2, c + x.T / 2);
  }
  for (const p of footprint ?? []) cands.push(along(p));
  const tol = Math.max(8, 1.5 * (median(ws.map((x) => x.T)) || 6));
  const snap = (v: number) => {
    let best = v;
    let bd = tol;
    for (const c of cands) if (Math.abs(c - v) < bd) { bd = Math.abs(c - v); best = c; }
    return best;
  };
  const from = horizontal ? { x: snap(d.from.x), y: d.from.y } : { x: d.from.x, y: snap(d.from.y) };
  const to = horizontal ? { x: snap(d.to.x), y: d.to.y } : { x: d.to.x, y: snap(d.to.y) };
  const parsed = d.text ? parseDimension(d.text) : null;
  return { ...d, from: roundPt(from), to: roundPt(to), valueM: parsed && parsed.values.length === 1 ? parsed.values[0] : d.valueM };
}
