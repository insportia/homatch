// HOMATCH DESIGN STUDIO — plan reading v2, as the browser uses it.
//
// The modules beside this file are BYTE-IDENTICAL copies of
// supabase/functions/_shared/designStudio/planRead/ (the edge function
// fuses a reading with the drawing's pixels; the browser re-solves and
// applies the customer's answers with the very same code). They carry their
// own structural copies of the contract types so that the edge can use them
// without reaching into src/. This file is the browser's door to them, typed
// with the contract itself (FloorPlanDocument, PlanAnswer, ConstraintReport),
// and the assignments below fail to compile if the copies ever drift.

import type { FloorPlanDocument, RoomPolygon } from '@/services/developer/floorplan';
import type {
  ConstraintReport, DimensionCheck, PlanAnswer, PlanQuestion, PlanUnderstanding, TopologyIssue,
} from '../planToHome.ts';
import type * as Local from './types.ts';
import { applyAnswers as applyAnswersLocal } from './questions.ts';
import { roomSizeM as roomSizeLocal, solveScale, type ScaleReport } from './solve.ts';
import { parseDimension as parseDimensionLocal, type ParsedDimension } from './dimensions.ts';

export { PLAN_READ_VERSION } from './understand.ts';
export { MAX_QUESTIONS, ROOM_KINDS } from './questions.ts';
export { classifyLabel } from './roomKinds.ts';
export type { ParsedDimension, ScaleReport };

/** A printed dimension in metres, or null ("10'X14'", "3,20×4,10", "320x410 cm"). */
export function parseDimension(text: string | null | undefined): ParsedDimension | null {
  return parseDimensionLocal(text);
}

/** The plan with the customer's answers applied (pure; the input is not changed). */
export function applyAnswers(doc: FloorPlanDocument, answers: PlanAnswer[]): FloorPlanDocument {
  return applyAnswersLocal(doc as unknown as Local.PlanDoc, answers) as unknown as FloorPlanDocument;
}

/** The scale re-solved from the plan's printed sizes and the customer's confirmed ones. Null: no printed size. */
export function solvePlan(
  doc: FloorPlanDocument,
  dimensionStrings: Local.DimString[] | Array<{ valueM: number; from: { x: number; y: number }; to: { x: number; y: number }; confidence: number; evidence?: string | null; text?: string | null }>,
  answers: PlanAnswer[] = [],
  axisDeg = 0,
): (ConstraintReport & Pick<ScaleReport, 'anisotropy'>) | null {
  const dims = (dimensionStrings ?? []).map((d) => ({ ...d, evidence: d.evidence ?? null })) as Local.DimString[];
  return solveScale(doc as unknown as Local.PlanDoc, dims, { answers, axisDeg });
}

/** A room's size in metres along the plan's axes (its main rectangle), for labels. */
export function roomSizeM(room: Pick<RoomPolygon, 'polygon'>, metresPerPx: number, axisDeg = 0): { w: number; d: number } {
  return roomSizeLocal(room, metresPerPx, axisDeg);
}

// ── Drift guards: the local copies must stay assignable to the contract ──
type Assert<T extends true> = T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type _QuestionSame = Assert<Same<Local.PlanQuestion, PlanQuestion>>;
export type _AnswerSame = Assert<Same<Local.PlanAnswer, PlanAnswer>>;
export type _CheckSame = Assert<Same<Local.DimensionCheck, DimensionCheck>>;
export type _IssueSame = Assert<Same<Local.TopologyIssue, TopologyIssue>>;
export type _ReportFits = Assert<Local.ConstraintReport extends ConstraintReport ? true : false>;
export type _UnderstandingFits = Assert<Local.PlanUnderstanding extends PlanUnderstanding ? true : false>;
export type _DocFits = Assert<FloorPlanDocument extends Local.PlanDoc ? true : false>;
