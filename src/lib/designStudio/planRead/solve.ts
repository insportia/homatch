// HOMATCH DESIGN STUDIO — the plan's scale, solved from everything printed on it.
//
// A plan prints its size in many places: an overall "20'-0\" × 46'-0\"",
// and a size in nearly every room ("10'X14'", "3.20 x 4.10"). Each is one
// equation: metres-per-pixel = printed metres / measured pixels. Taken
// together they over-determine the scale, so it is SOLVED (robust weighted
// least squares in log space, outliers rejected and reported) rather than
// read from one number, and every printed size becomes a check with its
// residual: the customer sees which printed sizes the geometry agrees with.
//
// Room sizes on plans are clear inner dimensions in either order (W×L or
// L×W), and describe the room's main rectangle; each room's order is chosen
// to fit. Separate x and y fits expose a stretched scan (anisotropy).
//
// Pure and dependency-free (Deno + Node + browser).

import type { ConstraintReport, DimensionCheck, DimString, PlanAnswer, PlanDoc, Room } from './types.ts';
import { bboxOf, dist, mainRectangle, weightedMedian } from './geom.ts';
import { parseDimension } from './dimensions.ts';

export interface Anisotropy { xMetresPerPx: number; yMetresPerPx: number; ratio: number }

export interface ScaleReport extends ConstraintReport { anisotropy?: Anisotropy | null }

export interface SolveOptions {
  /** The plan's axis in degrees (walls squared to it); 0 for an upright plan. */
  axisDeg?: number | null;
  /** How each room's outline was obtained (fusion's meta): trusted less when it is the model's sketch. */
  roomGeometry?: Record<string, 'REGION' | 'REGION_CLIPPED' | 'MODEL'>;
  /** The customer's confirmed sizes (DIMENSION answers). */
  answers?: PlanAnswer[];
}

/**
 * An overall dimension is printed exactly (it is what the building is set
 * out from); a room's size is rounded to the foot or the decimetre and is
 * a clear inner size. Inverse-variance weighting (≈0.5% vs ≈2–3%) makes one
 * overall equation worth about a dozen room equations.
 */
const OVERALL_WEIGHT = 12;

interface Obs {
  id: string;
  text: string;
  values: number[];
  /** Pixel extents along x and y (rooms), or the one span (overall / other). */
  px: number[];
  axes: Array<'x' | 'y' | 'n'>;
  ocr: number;
  geom: number;
  weight: number;
  room: boolean;
}

/** The element id a question or answer is about: "KIND:elementId". */
export const elementOf = (questionId: string) => questionId.slice(questionId.indexOf(':') + 1);

/** A room's size in metres along the plan's axes (its main rectangle). */
export function roomSizeM(room: Pick<Room, 'polygon'>, metresPerPx: number, axisDeg = 0): { w: number; d: number } {
  const { w, d } = mainRectangle(room.polygon, axisDeg);
  return { w: w * metresPerPx, d: d * metresPerPx };
}

function collect(doc: PlanDoc, dims: DimString[], opts: SolveOptions): Obs[] {
  const out: Obs[] = [];
  const axis = opts.axisDeg ?? 0;
  const answered = new Map<string, number[]>();
  for (const a of opts.answers ?? []) {
    if (a.kind !== 'DIMENSION') continue;
    const v = Array.isArray(a.value) ? a.value : [a.value];
    if (v.every((n) => Number.isFinite(n) && n > 0.2 && n < 200)) answered.set(elementOf(a.questionId), v);
  }
  const rooms = [...doc.rooms, ...doc.balconies];
  const sized = new Set<string>();
  for (const room of rooms) {
    if (room.polygon.length < 3) continue;
    const confirmed = answered.get(room.id);
    const parsed = confirmed ? { values: confirmed, confidence: 1 } : parseDimension(room.dimensionText ?? null);
    if (!parsed || parsed.values.length !== 2) continue;
    const { w, d } = mainRectangle(room.polygon, axis);
    if (w < 3 || d < 3) continue;
    sized.add(room.id);
    const g = opts.roomGeometry?.[room.id];
    const geom = g === 'REGION' ? 0.9 : g === 'REGION_CLIPPED' ? 0.6 : g === 'MODEL' ? 0.35 : 0.7;
    out.push({
      id: room.id, text: confirmed ? `${confirmed.join(' x ')} m (confirmed)` : room.dimensionText ?? '',
      values: parsed.values, px: [w, d], axes: ['x', 'y'], ocr: parsed.confidence, geom, weight: 1, room: true,
    });
  }

  // Printed spans: the longest one along each axis is the overall size.
  const geomPts = [...doc.walls.flatMap((w) => [w.start, w.end]), ...(doc.footprint ?? [])];
  const bb = bboxOf(geomPts.length ? geomPts : rooms.flatMap((r) => r.polygon));
  const rad = (axis * Math.PI) / 180;
  const along = (d: DimString): 'x' | 'y' => {
    const dx = d.to.x - d.from.x;
    const dy = d.to.y - d.from.y;
    const ux = Math.abs(dx * Math.cos(rad) + dy * Math.sin(rad));
    const uy = Math.abs(-dx * Math.sin(rad) + dy * Math.cos(rad));
    return ux >= uy ? 'x' : 'y';
  };
  const best: Record<'x' | 'y', { d: DimString; px: number; k: number } | null> = { x: null, y: null };
  dims.forEach((d, k) => {
    const px = dist(d.from, d.to);
    const ax = along(d);
    const side = ax === 'x' ? bb.w : bb.h;
    if (px >= 0.6 * side && (!best[ax] || px > best[ax]!.px)) best[ax] = { d, px, k };
  });
  dims.forEach((d, k) => {
    const px = dist(d.from, d.to);
    if (px < 10) return;
    const ax = along(d);
    const overall = best[ax]?.k === k;
    const id = overall ? (ax === 'x' ? 'OVERALL_W' : 'OVERALL_D') : `DIM_${k + 1}`;
    const confirmed = answered.get(id);
    const parsed = d.text ? parseDimension(d.text) : null;
    const value = confirmed?.[0] ?? (parsed && parsed.values.length === 1 ? parsed.values[0] : d.valueM);
    if (!overall && !confirmed) {
      // A span that repeats a room's own printed size is that room's check already.
      const mid = { x: (d.from.x + d.to.x) / 2, y: (d.from.y + d.to.y) / 2 };
      const repeats = rooms.some((r) => {
        if (!sized.has(r.id)) return false;
        const b = bboxOf(r.polygon);
        if (within(b, d, 14)) return true;
        const sameValue = (parseDimension(r.dimensionText ?? null)?.values ?? answered.get(r.id) ?? []).some((v) => Math.abs(v / value - 1) < 0.01);
        return sameValue && Math.hypot(mid.x - (b.x + b.w / 2), mid.y - (b.y + b.h / 2)) <= 1.5 * Math.max(b.w, b.h);
      });
      if (repeats) return;
    }
    if (!(value > 0)) return;
    out.push({
      id, text: confirmed ? `${value} m (confirmed)` : d.text ?? d.evidence ?? `${value} m`, values: [value], px: [px], axes: [ax],
      ocr: confirmed ? 1 : Math.max(0.2, Math.min(1, parsed?.confidence ?? d.confidence)), geom: 0.85, weight: overall ? OVERALL_WEIGHT : 1, room: false,
    });
  });
  // An overall size confirmed by the customer for a plan that prints none.
  for (const id of ['OVERALL_W', 'OVERALL_D'] as const) {
    if (!answered.has(id) || out.some((o) => o.id === id) || !(bb.w > 0)) continue;
    const ax = id === 'OVERALL_W' ? 'x' : 'y';
    out.push({ id, text: `${answered.get(id)![0]} m (confirmed)`, values: [answered.get(id)![0]], px: [ax === 'x' ? bb.w : bb.h], axes: [ax], ocr: 1, geom: 0.7, weight: OVERALL_WEIGHT, room: false });
  }
  return out;
}

function within(b: { x: number; y: number; w: number; h: number }, d: DimString, tol: number): boolean {
  const inside = (p: { x: number; y: number }) => p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
  return inside(d.from) && inside(d.to);
}

/** The order of a room's printed pair that fits its outline best at scale m. */
function orient(o: Obs, m: number): { values: number[]; worst: number } {
  if (!o.room) return { values: o.values, worst: Math.abs((o.px[0] * m) / o.values[0] - 1) };
  const [a, b] = o.values;
  const straight = Math.max(Math.abs((o.px[0] * m) / a - 1), Math.abs((o.px[1] * m) / b - 1));
  const crossed = Math.max(Math.abs((o.px[0] * m) / b - 1), Math.abs((o.px[1] * m) / a - 1));
  return straight <= crossed ? { values: [a, b], worst: straight } : { values: [b, a], worst: crossed };
}

/** Scale-free first guess: each room's order by aspect ratio, then a weighted median. */
function initial(obs: Obs[]): number {
  const items: Array<{ v: number; w: number }> = [];
  for (const o of obs) {
    let values = o.values;
    if (o.room) {
      const [a, b] = o.values;
      const straight = Math.abs(Math.log((a / b) / (o.px[0] / o.px[1])));
      const crossed = Math.abs(Math.log((b / a) / (o.px[0] / o.px[1])));
      values = straight <= crossed ? [a, b] : [b, a];
    }
    values.forEach((v, i) => items.push({ v: v / o.px[i], w: o.ocr * o.geom * o.weight }));
  }
  return weightedMedian(items);
}

/**
 * Solve the scale from the printed sizes. Null when the plan prints nothing
 * measurable: then there is no honest scale, only a question to ask.
 */
export function solveScale(doc: PlanDoc, dims: DimString[], opts: SolveOptions = {}): ScaleReport | null {
  const obs = collect(doc, dims, opts);
  if (obs.length === 0) return null;
  let m = initial(obs);
  if (!(m > 0)) return null;
  let used = new Set<Obs>(obs);
  for (let iter = 0; iter < 8; iter += 1) {
    // Robust spread of the current residuals sets the outlier threshold.
    const res = obs.map((o) => orient(o, m).worst);
    const sorted = [...res].sort((a, b) => a - b);
    const mad = sorted[Math.floor(sorted.length / 2)] ?? 0;
    const thr = Math.max(0.08, 3 * 1.4826 * mad);
    const next = new Set(obs.filter((_, i) => res[i] <= thr));
    if (next.size === 0) break;
    let sw = 0;
    let sl = 0;
    for (const o of next) {
      const { values } = orient(o, m);
      values.forEach((v, i) => {
        const w = (o.ocr * o.geom * o.weight) / values.length;
        sw += w;
        sl += w * Math.log(v / o.px[i]);
      });
    }
    const m2 = Math.exp(sl / sw);
    const done = Math.abs(m2 / m - 1) < 1e-6 && next.size === used.size;
    m = m2;
    used = next;
    if (done) break;
  }
  // Uncertainty: the weighted spread of the used equations over their effective count.
  let sw = 0;
  let sw2 = 0;
  let sv = 0;
  let neq = 0;
  const perAxis: Record<'x' | 'y', { sw: number; sl: number; n: number }> = { x: { sw: 0, sl: 0, n: 0 }, y: { sw: 0, sl: 0, n: 0 } };
  for (const o of used) {
    const { values } = orient(o, m);
    values.forEach((v, i) => {
      const w = (o.ocr * o.geom * o.weight) / values.length;
      const lr = Math.log(v / o.px[i]) - Math.log(m);
      sw += w; sw2 += w * w; sv += w * lr * lr; neq += 1;
      const ax = o.axes[i];
      if (ax === 'x' || ax === 'y') { perAxis[ax].sw += w; perAxis[ax].sl += w * Math.log(v / o.px[i]); perAxis[ax].n += 1; }
    });
  }
  const nEff = sw > 0 ? (sw * sw) / sw2 : 1;
  const sigma = sw > 0 ? Math.sqrt(sv / sw) : 0.05;
  const uncertainty = neq <= 1 ? 0.05 : Math.max(0.004, Math.min(0.5, sigma / Math.sqrt(Math.max(1, nEff - 1))));

  const checks: DimensionCheck[] = obs.map((o) => {
    const { values, worst } = orient(o, m);
    return {
      elementId: o.id,
      text: o.text,
      valueM: values.map((v) => Math.round(v * 1000) / 1000),
      measuredM: o.px.map((p) => Math.round(p * m * 1000) / 1000),
      residualPct: Math.round(worst * 1000) / 10,
      ocrConfidence: Math.round(o.ocr * 100) / 100,
      geometryConfidence: o.geom,
      used: used.has(o),
    };
  });
  const usedRes = checks.filter((c) => c.used).map((c) => c.residualPct).sort((a, b) => a - b);
  let anisotropy: Anisotropy | null = null;
  if (perAxis.x.n >= 2 && perAxis.y.n >= 2) {
    const mx = Math.exp(perAxis.x.sl / perAxis.x.sw);
    const my = Math.exp(perAxis.y.sl / perAxis.y.sw);
    const ratio = mx / my;
    if (Math.abs(ratio - 1) > 0.03) anisotropy = { xMetresPerPx: mx, yMetresPerPx: my, ratio: Math.round(ratio * 1000) / 1000 };
  }
  return {
    metresPerPx: m,
    uncertainty: Math.round(uncertainty * 10000) / 10000,
    checks,
    medianResidualPct: usedRes.length ? usedRes[Math.floor((usedRes.length - 1) / 2)] : 0,
    worstResidualPct: checks.length ? Math.max(...checks.map((c) => c.residualPct)) : 0,
    anisotropy,
  };
}

/** The confidence a solved scale earns: many agreeing checks → high; one → modest. */
export function scaleConfidence(report: ConstraintReport): number {
  const used = report.checks.filter((c) => c.used).length;
  const base = used >= 4 ? 0.95 : used === 3 ? 0.9 : used === 2 ? 0.82 : 0.65;
  const penalty = Math.min(0.4, report.uncertainty * 3 + Math.max(0, report.medianResidualPct - 3) / 50);
  return Math.max(0.2, Math.min(0.99, Math.round((base - penalty) * 100) / 100));
}
