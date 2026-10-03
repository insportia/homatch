// HOW BIG IS IT? — Design Studio's scale and confidence, from a drawing.
//
// A customer usually does not know their plan's scale, and should not have
// to before seeing their home in 3D. So:
//
//   ESTIMATED   scale from the drawing's own weak signals — a printed
//               dimension, a printed room area, the width of a door symbol —
//               combined robustly and shown with its uncertainty
//   CALIBRATED  at least one real-world anchor from the customer:
//               "the flat is 82 m²", "this wall is 4.1 m", "this room is 18 m²"
//   VERIFIED    two or more anchors that agree within a tight tolerance
//
// With no signal and no anchor there is no honest scale, and the customer is
// asked for one rather than given a guess. This is Design Studio's own logic;
// the Developer gate (evaluateGate) is not consulted and not changed.
//
// Everything is deterministic and pure; geometry itself still comes from the
// shared HOMATCH generator, fed only the elements the customer kept.

import { generateScene } from '../floorplan/geometry.ts';
import type { FloorPlanDocument, PixelPoint } from '../../services/developer/floorplan.ts';
import type { CanonicalSpace, GeometryState } from './types.ts';
import type { DesignState } from './designState.ts';
import { DS_GENERATOR_VERSION } from './engine.ts';


export interface DimensionString { valueM: number; from: PixelPoint; to: PixelPoint; confidence: number }

export type ScaleSignalKind = 'DRAWING_SCALE' | 'PRINTED_DIMENSION' | 'PRINTED_AREA' | 'DOOR_WIDTH';

export interface ScaleSignal { kind: ScaleSignalKind; metresPerPx: number; weight: number; elementId?: string }

export interface ScaleEstimate {
  metresPerPx: number;
  /** Relative uncertainty (0.12 = ±12%). */
  uncertainty: number;
  signals: ScaleSignal[];
}

/** A typical interior door leaf. A weak signal, and weighted as one. */
const TYPICAL_DOOR_M = 0.85;

const dist = (a: PixelPoint, b: PixelPoint) => Math.hypot(b.x - a.x, b.y - a.y);

export function polygonAreaPx(poly: PixelPoint[]): number {
  let s = 0;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

function weightedMedian(items: Array<{ value: number; weight: number }>): number {
  const sorted = [...items].sort((a, b) => a.value - b.value);
  const total = sorted.reduce((s, i) => s + i.weight, 0);
  let acc = 0;
  for (const i of sorted) {
    acc += i.weight;
    if (acc >= total / 2) return i.value;
  }
  return sorted[sorted.length - 1].value;
}

/**
 * The drawing's own evidence for its scale. Returns null when there is none:
 * then there is no estimate to show, only a question to ask.
 */
export function estimateScale(doc: FloorPlanDocument, dimensions: DimensionString[] = []): ScaleEstimate | null {
  const signals: ScaleSignal[] = [];
  if (doc.detectedScale && doc.detectedScale > 0) {
    signals.push({ kind: 'DRAWING_SCALE', metresPerPx: doc.detectedScale, weight: 1.5 * Math.max(0.2, doc.scaleConfidence) });
  }
  for (const d of dimensions) {
    const px = dist(d.from, d.to);
    if (px >= 5) signals.push({ kind: 'PRINTED_DIMENSION', metresPerPx: d.valueM / px, weight: 1.2 * Math.max(0.2, d.confidence) });
  }
  for (const r of [...doc.rooms, ...doc.balconies]) {
    if (!r.statedAreaM2) continue;
    const px = polygonAreaPx(r.polygon);
    if (px > 0) signals.push({ kind: 'PRINTED_AREA', metresPerPx: Math.sqrt(r.statedAreaM2 / px), weight: 1.0 * Math.max(0.2, r.confidence), elementId: r.id });
  }
  for (const d of doc.doors) {
    if (d.widthPx > 0) signals.push({ kind: 'DOOR_WIDTH', metresPerPx: TYPICAL_DOOR_M / d.widthPx, weight: 0.25 * Math.max(0.2, d.confidence), elementId: d.id });
  }
  if (signals.length === 0) return null;

  const strong = signals.filter((s) => s.kind !== 'DOOR_WIDTH');
  const scale = weightedMedian((strong.length ? strong : signals).map((s) => ({ value: s.metresPerPx, weight: s.weight })));
  // Spread of the evidence around the chosen value. Door symbols are a weak
  // hint; when printed evidence exists they neither move nor widen it.
  const basis = strong.length ? strong : signals;
  const spread = Math.max(...basis.map((s) => Math.abs(s.metresPerPx - scale) / scale));
  const floor = strong.length >= 2 ? 0.05 : strong.length === 1 ? 0.08 : 0.15;
  return { metresPerPx: scale, uncertainty: Math.min(0.5, Math.max(floor, Math.min(spread, 0.5))), signals };
}

// ── Calibration ───────────────────────────────────────────────────────────

export type Anchor =
  | { kind: 'TOTAL_AREA'; valueM2: number }
  | { kind: 'ROOM_AREA'; roomId: string; valueM2: number }
  | { kind: 'WALL_LENGTH'; wallId: string; valueM: number };

/** Two anchors agree when they imply scales within this relative distance. */
export const AGREEMENT_TOLERANCE = 0.03;

export interface Calibration {
  metresPerPx: number;
  geometryState: GeometryState;
  uncertainty: number | null;
  /** Anchors that disagree beyond tolerance: shown, never averaged away silently. */
  conflict: boolean;
  implied: Array<{ anchor: Anchor; metresPerPx: number }>;
}

export interface ReviewDecisions {
  /** Elements the customer said were misread. */
  rejected: string[];
  /** Room kinds the customer corrected. */
  roomKinds: Record<string, string>;
}

const keptRooms = (doc: FloorPlanDocument, decisions: ReviewDecisions) =>
  doc.rooms.filter((r) => !decisions.rejected.includes(r.id));

export function scaleFromAnchor(doc: FloorPlanDocument, decisions: ReviewDecisions, a: Anchor): number | null {
  switch (a.kind) {
    case 'TOTAL_AREA': {
      const px = keptRooms(doc, decisions).reduce((s, r) => s + polygonAreaPx(r.polygon), 0);
      return px > 0 && a.valueM2 > 0 ? Math.sqrt(a.valueM2 / px) : null;
    }
    case 'ROOM_AREA': {
      const room = [...doc.rooms, ...doc.balconies].find((r) => r.id === a.roomId);
      const px = room ? polygonAreaPx(room.polygon) : 0;
      return px > 0 && a.valueM2 > 0 ? Math.sqrt(a.valueM2 / px) : null;
    }
    case 'WALL_LENGTH': {
      const wall = doc.walls.find((w) => w.id === a.wallId);
      const px = wall ? dist(wall.start, wall.end) : 0;
      return px > 0 && a.valueM > 0 ? a.valueM / px : null;
    }
  }
}

/**
 * Anchors → scale and truth state. With no anchors the estimate stands
 * (ESTIMATED); with none of either there is nothing to build from.
 */
export function calibrate(
  doc: FloorPlanDocument, decisions: ReviewDecisions, anchors: Anchor[], estimate: ScaleEstimate | null,
): Calibration | null {
  const implied = anchors
    .map((anchor) => ({ anchor, metresPerPx: scaleFromAnchor(doc, decisions, anchor) }))
    .filter((x): x is { anchor: Anchor; metresPerPx: number } => x.metresPerPx != null && Number.isFinite(x.metresPerPx));
  if (implied.length === 0) {
    return estimate
      ? { metresPerPx: estimate.metresPerPx, geometryState: 'ESTIMATED', uncertainty: estimate.uncertainty, conflict: false, implied: [] }
      : null;
  }
  const values = implied.map((i) => i.metresPerPx).sort((a, b) => a - b);
  const median = values[Math.floor(values.length / 2)];
  const deviation = Math.max(...values.map((v) => Math.abs(v - median) / median));
  if (implied.length >= 2 && deviation <= AGREEMENT_TOLERANCE) {
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    return { metresPerPx: mean, geometryState: 'VERIFIED', uncertainty: null, conflict: false, implied };
  }
  return { metresPerPx: median, geometryState: 'CALIBRATED', uncertainty: null, conflict: implied.length >= 2, implied };
}

// ── Geometry, from what the customer kept ─────────────────────────────────

export const DEFAULT_CEILING_M = 2.7;

/**
 * The document the shared generator builds from: the customer's reading
 * with their corrections applied (misread elements removed, room kinds
 * corrected), every kept element marked as accepted, and the scale and
 * ceiling height Design Studio settled on.
 */
export function buildDsDocument(
  doc: FloorPlanDocument, decisions: ReviewDecisions, metresPerPx: number, ceilingM: number,
): FloorPlanDocument {
  const keep = <T extends { id: string }>(list: T[]) => list.filter((e) => !decisions.rejected.includes(e.id));
  const accept = <T>(e: T) => ({ ...e, state: 'CORRECTED' as const });
  return {
    ...doc,
    detectedScale: metresPerPx,
    scaleConfidence: 1,
    ceilingHeight: ceilingM,
    ceilingHeightSource: 'OPERATOR',
    walls: keep(doc.walls).map(accept),
    doors: keep(doc.doors).map(accept),
    windows: keep(doc.windows).map(accept),
    rooms: keep(doc.rooms).map((r) => accept({ ...r, kind: (decisions.roomKinds[r.id] ?? r.kind) as typeof r.kind })),
    balconies: keep(doc.balconies).map(accept),
    // Stairs are architecture the customer kept, like a wall; absent stays absent.
    ...(doc.stairs ? { stairs: keep(doc.stairs).map(accept) } : {}),
  };
}

export type BuildResult =
  | { ok: true; canonical: CanonicalSpace }
  | { ok: false; problems: string[] };

export function buildCanonical(
  doc: FloorPlanDocument, decisions: ReviewDecisions, calibration: Calibration, ceilingM: number,
  ceilingSource: 'CUSTOMER' | 'DRAWING' | 'TYPICAL' = 'TYPICAL',
): BuildResult {
  const { scene, validation } = generateScene(buildDsDocument(doc, decisions, calibration.metresPerPx, ceilingM));
  if (!scene) return { ok: false, problems: validation.problems.map((p) => p.code) };
  return {
    ok: true,
    canonical: {
      schema: 1,
      units: 'm',
      generatorVersion: DS_GENERATOR_VERSION,
      geometryState: calibration.geometryState,
      metresPerPx: calibration.metresPerPx,
      scaleUncertainty: calibration.uncertainty,
      ceilingSource,
      scene,
    },
  };
}

/**
 * Carry a design onto recalibrated geometry. The plan's origin is its own
 * corner, so every position scales with the plan; sizes of furniture do not
 * (a sofa is the size it is). Deterministic, and it never moves anything
 * that the new scale would not.
 */
export function rebaseDesign(state: DesignState, factor: number): DesignState {
  if (!Number.isFinite(factor) || factor <= 0 || Math.abs(factor - 1) < 1e-9) return state;
  return {
    ...state,
    objects: state.objects.map((o) => ({
      ...o,
      position: {
        x: Math.round(o.position.x * factor * 10000) / 10000,
        y: o.position.y,
        z: Math.round(o.position.z * factor * 10000) / 10000,
      },
    })),
  };
}
