// HOMATCH DESIGN STUDIO — reading v2: from a model's reading to an understood plan.
//
//   reading (model, ds-read-2)  ──┐
//   the drawing's pixels ─────────┼─ fuse ── solve ── topology ── questions
//                                 │
//   → { doc (fused), understanding, rawDoc (exactly what the model said) }
//
// The raw reading is kept beside the fused one so every change fusion made
// stays auditable, and ids are stable between them (corrections are keyed by
// id). Nothing here calls a model; the same reading and pixels always give
// the same result.
//
// Pure and dependency-free (Deno + Node + browser).

import type { DimString, GrayImage, PlanDoc, PlanUnderstanding } from './types.ts';
import { prepareRaster, type Raster } from './raster.ts';
import { fuse, type FuseMeta } from './fuse.ts';
import { scaleConfidence, solveScale, type ScaleReport } from './solve.ts';
import { checkTopology } from './topology.ts';
import { buildQuestions, type QuestionEvidence } from './questions.ts';
import { polyArea, roundPt } from './geom.ts';

export const PLAN_READ_VERSION = 'ds-read-2';

export interface UnderstandInput {
  doc: PlanDoc;
  dimensionStrings: DimString[];
  /** The drawing as grey bytes; absent (e.g. WebP) → model-only fusion. */
  gray?: GrayImage | null;
  raster?: Raster | null;
}

/** The parts of fusion worth keeping with the reading (audit, and the review's evidence). */
export interface FusionSummary {
  rasterUsed: boolean;
  axisDeg: number | null;
  wallThicknessPx: number | null;
  footprintSource: FuseMeta['footprintSource'];
  mergedWalls: FuseMeta['mergedWalls'];
  inferredWalls: string[];
  removedWalls: string[];
  droppedOpenings: FuseMeta['droppedOpenings'];
  openingSource: FuseMeta['openingSource'];
  roomGeometry: FuseMeta['roomGeometry'];
  placeholderRooms: string[];
  evidence: QuestionEvidence;
}

export interface UnderstandResult {
  doc: PlanDoc;
  rawDoc: PlanDoc;
  dimensionStrings: DimString[];
  understanding: PlanUnderstanding & { constraints: ScaleReport | null };
  fusion: FusionSummary;
  timings: { rasterMs: number; fuseMs: number; solveMs: number };
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function understand(input: UnderstandInput): UnderstandResult {
  const t0 = now();
  let raster: Raster | null = input.raster ?? null;
  if (!raster && input.gray && input.gray.width === input.doc.imageWidth && input.gray.height === input.doc.imageHeight) {
    raster = prepareRaster(input.gray);
  }
  const t1 = now();
  const fused = fuse({ doc: input.doc, dimensionStrings: input.dimensionStrings, raster });
  const doc = fused.doc;
  const meta = fused.meta;
  const t2 = now();

  const report = solveScale(doc, fused.dimensionStrings, { axisDeg: meta.axisDeg ?? 0, roomGeometry: meta.roomGeometry });
  if (report) {
    doc.detectedScale = Math.round(report.metresPerPx * 1e7) / 1e7;
    doc.scaleConfidence = scaleConfidence(report);
    const used = report.checks.filter((c) => c.used).length;
    doc.scaleEvidence = `Solved from ${used} of ${report.checks.length} printed sizes (median residual ${report.medianResidualPct}%).`;
  }
  const mpp = doc.detectedScale;

  // Building area no room accounts for becomes a room to ask about (when it is room-sized).
  const placeholders: string[] = [];
  const minRoomPx = mpp ? 2.0 / (mpp * mpp) : null;
  for (const u of meta.uncovered) {
    if (minRoomPx == null || u.areaPx < minRoomPx) continue;
    let k = 1;
    const ids = new Set([...doc.rooms, ...doc.balconies].map((r) => r.id));
    while (ids.has(`hm-room${k}`)) k += 1;
    const id = `hm-room${k}`;
    doc.rooms.push({
      id, kind: 'UNKNOWN', label: null, polygon: u.polygon.map(roundPt), statedAreaM2: null, dimensionText: null,
      confidence: 0.3, evidence: 'Building area no room in the reading accounts for.', state: 'UNVERIFIED',
    });
    placeholders.push(id);
  }
  const uncovered = meta.uncovered.filter((u) => !(minRoomPx != null && u.areaPx >= minRoomPx));
  const topo = checkTopology({ doc, uncovered, metresPerPx: mpp });
  for (const id of placeholders) {
    const p = doc.rooms.find((r) => r.id === id)!;
    topo.issues.push({ code: 'UNCOVERED_AREA', elementIds: [id], severity: 'WARN', detail: `${mpp ? Math.round(polyArea(p.polygon) * mpp * mpp * 10) / 10 : '?'} m² of the building was not in any room; added as a room to confirm` });
  }

  const evidence: QuestionEvidence = {
    roomKind: Object.fromEntries(Object.entries(meta.roomKind).map(([k, v]) => [k, { confidence: v.confidence, outdoor: v.outdoor, modelKind: v.modelKind }])),
    openingTypeAgreement: meta.openingTypeAgreement,
    openingSource: meta.openingSource,
    wallInk: meta.wallInk,
    inferredWalls: meta.inferredWalls,
    stairEvidence: meta.stairEvidence,
    placeholderRooms: placeholders,
  };
  const questions = buildQuestions(doc, report, evidence);
  const conf = [...doc.walls, ...doc.doors, ...doc.windows, ...doc.rooms, ...doc.balconies].map((e) => e.confidence);
  doc.extractionConfidence = conf.length ? Math.min(...conf) : 0;
  const t3 = now();
  return {
    doc,
    rawDoc: input.doc,
    dimensionStrings: fused.dimensionStrings,
    understanding: { readVersion: PLAN_READ_VERSION, constraints: report, issues: topo.issues, questions, adjacency: topo.adjacency },
    fusion: {
      rasterUsed: meta.rasterUsed, axisDeg: meta.axisDeg, wallThicknessPx: meta.wallThicknessPx, footprintSource: meta.footprintSource,
      mergedWalls: meta.mergedWalls, inferredWalls: meta.inferredWalls, removedWalls: meta.removedWalls, droppedOpenings: meta.droppedOpenings,
      openingSource: meta.openingSource, roomGeometry: meta.roomGeometry, placeholderRooms: placeholders, evidence,
    },
    timings: { rasterMs: Math.round(t1 - t0), fuseMs: Math.round(t2 - t1), solveMs: Math.round(t3 - t2) },
  };
}
