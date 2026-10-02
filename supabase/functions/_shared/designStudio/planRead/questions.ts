// HOMATCH DESIGN STUDIO — only the questions worth asking, and their answers.
//
// The customer is not an architect and should not proofread a drawing. A
// question is asked only where HOMATCH's own evidence is weak or in
// conflict: a label the dictionary is unsure of, a printed size the geometry
// disagrees with, a door the ink draws as glazing, a wall with no ink, a
// staircase found only faintly, building area no room accounts for, or no
// printed size at all (then the scale itself is the question). At most a
// handful, the most consequential first. Every question is a small closed
// choice with HOMATCH's suggestion preselected.
//
// Question ids are "KIND:elementId", so an answer names its element without
// any other state, and applyAnswers is a pure function of (doc, answers).
//
// Pure and dependency-free (Deno + Node + browser).

import type { ConstraintReport, Opening, OpeningChoice, PlanAnswer, PlanDoc, PlanQuestion, Room, RoomKind } from './types.ts';
import { mainRectangle, median, polyArea } from './geom.ts';
import { formatMetres } from './dimensions.ts';
import { classifyLabel, OUTDOOR_KINDS } from './roomKinds.ts';

/** What fusion measured, as far as questions need it. All optional: absent evidence asks nothing. */
export interface QuestionEvidence {
  roomKind?: Record<string, { confidence: number; outdoor: boolean; modelKind?: string }>;
  openingTypeAgreement?: Record<string, number>;
  openingSource?: Record<string, string>;
  wallInk?: Record<string, number | null>;
  inferredWalls?: string[];
  stairEvidence?: Record<string, { model: boolean; treads: number | null; strength: number }>;
  /** Rooms added for building area the reading left out. */
  placeholderRooms?: string[];
}

export const MAX_QUESTIONS = 6;
const ASK_BELOW = 0.75;
const RESIDUAL_ASK_PCT = 8;
export const ROOM_KINDS: readonly RoomKind[] = ['LIVING', 'BEDROOM', 'KITCHEN', 'BATHROOM', 'WC', 'HALL', 'CORRIDOR', 'STORAGE', 'BALCONY', 'TERRACE', 'UNKNOWN'];
const TYPICAL_DOOR_M = 0.85;

const qid = (kind: string, id: string) => `${kind}:${id}`;

export function buildQuestions(doc: PlanDoc, report: ConstraintReport | null, ev: QuestionEvidence = {}): PlanQuestion[] {
  const out: Array<{ q: PlanQuestion; impact: number }> = [];
  const rooms = [...doc.rooms, ...doc.balconies];
  const total = rooms.reduce((s, r) => s + polyArea(r.polygon), 0) || 1;
  const share = (r: Room) => Math.min(1, polyArea(r.polygon) / total);

  // No printed size at all: the scale is the question (the biggest room's size).
  if (!report) {
    const target = [...doc.rooms].sort((a, b) => polyArea(b.polygon) - polyArea(a.polygon))[0];
    const doors = doc.doors.map((d) => d.widthPx).filter((w) => w > 0);
    const guess = doors.length ? TYPICAL_DOOR_M / median(doors) : null;
    if (target) {
      const { w, d } = mainRectangle(target.polygon);
      out.push({
        impact: 1,
        q: {
          id: qid('DIMENSION', target.id), kind: 'DIMENSION', elementId: target.id, text: target.dimensionText ?? '',
          suggestedM: guess ? [Math.round(w * guess * 10) / 10, Math.round(d * guess * 10) / 10] : [0, 0], residualPct: 100, confidence: 0,
        },
      });
    }
  } else {
    for (const c of report.checks) {
      // Rooms and the overall size only: a stray span is reported, not asked about.
      if (c.residualPct <= RESIDUAL_ASK_PCT || c.elementId.startsWith('DIM_')) continue;
      const suggested = c.measuredM.length === 2 ? [c.measuredM[0], c.measuredM[1]] as [number, number] : c.measuredM[0];
      out.push({
        impact: 0.55 + Math.min(0.3, c.residualPct / 100),
        q: { id: qid('DIMENSION', c.elementId), kind: 'DIMENSION', elementId: c.elementId, text: c.text, suggestedM: suggested, residualPct: c.residualPct, confidence: Math.max(0, Math.round((1 - c.residualPct / 50) * 100) / 100) },
      });
    }
  }

  // Building area the reading left out (a placeholder room) and unsure labels.
  for (const r of rooms) {
    const placeholder = ev.placeholderRooms?.includes(r.id);
    const k = ev.roomKind?.[r.id];
    const conf = placeholder ? 0.2 : k ? k.confidence : r.kind === 'UNKNOWN' ? 0.2 : 1;
    if (conf < ASK_BELOW || r.kind === 'UNKNOWN') {
      out.push({ impact: placeholder ? 0.9 : 0.4 + 0.4 * share(r), q: { id: qid('ROOM_TYPE', r.id), kind: 'ROOM_TYPE', elementId: r.id, suggested: r.kind, confidence: Math.round(conf * 100) / 100 } });
    }
    // Indoors or out, when the label and the reading disagree or the label is unsure.
    if (k && !placeholder) {
      const modelOutdoor = k.modelKind ? OUTDOOR_KINDS.has(k.modelKind as RoomKind) : k.outdoor;
      const labelled = classifyLabel(r.label);
      if (k.outdoor !== modelOutdoor && labelled && labelled.confidence < 0.9 && k.modelKind !== 'UNKNOWN') {
        out.push({ impact: 0.5, q: { id: qid('OUTDOOR', r.id), kind: 'OUTDOOR', elementId: r.id, suggested: k.outdoor, confidence: Math.round(labelled.confidence * 100) / 100 } });
      }
    }
  }

  // Openings whose type the ink disputes, or that nothing in the ink confirms.
  const openings: Array<{ o: Opening; door: boolean }> = [...doc.doors.map((o) => ({ o, door: true })), ...doc.windows.map((o) => ({ o, door: false }))];
  for (const { o, door } of openings) {
    const agree = ev.openingTypeAgreement?.[o.id];
    const source = ev.openingSource?.[o.id];
    const weak = agree != null && agree < ASK_BELOW;
    if (!weak && o.confidence >= 0.5) continue;
    const suggested: OpeningChoice = source === 'MODEL' ? (door ? 'DOOR' : 'WINDOW') : door ? (o.leaf === 'NONE' ? 'OPENING' : 'DOOR') : 'WINDOW';
    out.push({
      impact: source === 'MODEL' ? 0.45 : 0.35,
      q: { id: qid('OPENING_TYPE', o.id), kind: 'OPENING_TYPE', elementId: o.id, options: ['DOOR', 'WINDOW', 'OPENING', 'WALL'], suggested, confidence: Math.round(Math.min(o.confidence, agree ?? 1) * 100) / 100 },
    });
  }

  // Walls the ink does not show, and walls HOMATCH added on weak ink.
  for (const w of doc.walls) {
    const ink = ev.wallInk?.[w.id];
    const inferred = ev.inferredWalls?.includes(w.id);
    if (ink != null && ink < 0.25) {
      out.push({ impact: w.kind === 'EXTERIOR' ? 0.6 : 0.45, q: { id: qid('IS_WALL', w.id), kind: 'IS_WALL', elementId: w.id, suggested: ink >= 0.1, confidence: Math.round(ink * 100) / 100 } });
    } else if (inferred && w.confidence < 0.6) {
      out.push({ impact: 0.45, q: { id: qid('IS_WALL', w.id), kind: 'IS_WALL', elementId: w.id, suggested: true, confidence: w.confidence } });
    }
  }

  // Stairs: found faintly, or claimed without treads in the ink.
  for (const s of doc.stairs ?? []) {
    const e = ev.stairEvidence?.[s.id];
    if (!e) continue;
    const weak = e.model ? e.treads == null : e.strength < 0.7;
    if (weak) out.push({ impact: 0.55, q: { id: qid('STAIRS', s.id), kind: 'STAIRS', elementId: s.id, suggested: e.model || e.strength >= 0.6, confidence: Math.round((e.model ? 0.5 : e.strength) * 100) / 100 } });
  }

  const seen = new Set<string>();
  return out
    .sort((a, b) => b.impact - a.impact || a.q.id.localeCompare(b.q.id))
    .filter(({ q }) => (seen.has(q.id) ? false : (seen.add(q.id), true)))
    .slice(0, MAX_QUESTIONS)
    .map(({ q }) => q);
}

// ── Answers ────────────────────────────────────────────────────────────────

const elementOf = (questionId: string) => questionId.slice(questionId.indexOf(':') + 1);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/**
 * The plan with the customer's answers applied. Pure: the input is not
 * changed. Answered elements become VERIFIED (or CORRECTED when the answer
 * changed them) with full confidence; removed elements are gone, and an
 * opening goes with its wall. Unknown or malformed answers are ignored.
 */
export function applyAnswers<D extends PlanDoc>(input: D, answers: PlanAnswer[]): D {
  const doc = clone(input);
  doc.stairs = doc.stairs ?? [];
  for (const a of answers ?? []) {
    const id = elementOf(a.questionId);
    if (a.kind === 'OPENING_TYPE') {
      const inDoors = doc.doors.find((o) => o.id === id);
      const inWindows = doc.windows.find((o) => o.id === id);
      const o = inDoors ?? inWindows;
      if (!o) continue;
      doc.doors = doc.doors.filter((x) => x.id !== id);
      doc.windows = doc.windows.filter((x) => x.id !== id);
      if (a.value === 'WALL') continue;
      const was = inDoors ? (o.leaf === 'NONE' ? 'OPENING' : 'DOOR') : 'WINDOW';
      const next: Opening = { ...o, confidence: 1, state: was === a.value ? 'VERIFIED' : 'CORRECTED' };
      if (a.value === 'WINDOW') {
        if (next.leaf && !['FIXED', 'CASEMENT', 'SLIDING'].includes(next.leaf)) next.leaf = null;
        doc.windows.push(next);
      } else {
        if (a.value === 'OPENING') next.leaf = 'NONE';
        else if (next.leaf === 'NONE' || next.leaf === 'FIXED' || next.leaf === 'CASEMENT') next.leaf = null;
        doc.doors.push(next);
      }
    } else if (a.kind === 'ROOM_TYPE') {
      const room = [...doc.rooms, ...doc.balconies].find((r) => r.id === id);
      if (!room) continue;
      doc.rooms = doc.rooms.filter((r) => r.id !== id);
      doc.balconies = doc.balconies.filter((r) => r.id !== id);
      if (a.value === 'NONE') continue;
      const kind = (ROOM_KINDS as readonly string[]).includes(a.value) ? (a.value as RoomKind) : room.kind;
      const next: Room = { ...room, kind, confidence: 1, state: kind === room.kind ? 'VERIFIED' : 'CORRECTED' };
      (OUTDOOR_KINDS.has(kind) ? doc.balconies : doc.rooms).push(next);
    } else if (a.kind === 'OUTDOOR') {
      const room = [...doc.rooms, ...doc.balconies].find((r) => r.id === id);
      if (!room) continue;
      doc.rooms = doc.rooms.filter((r) => r.id !== id);
      doc.balconies = doc.balconies.filter((r) => r.id !== id);
      let kind = room.kind;
      if (a.value && !OUTDOOR_KINDS.has(kind)) kind = classifyLabel(room.label)?.kind === 'BALCONY' ? 'BALCONY' : 'TERRACE';
      if (!a.value && OUTDOOR_KINDS.has(kind)) {
        const k = classifyLabel(room.label)?.kind;
        kind = k && !OUTDOOR_KINDS.has(k) ? k : 'UNKNOWN';
      }
      const next: Room = { ...room, kind, confidence: 1, state: kind === room.kind ? 'VERIFIED' : 'CORRECTED' };
      (a.value ? doc.balconies : doc.rooms).push(next);
    } else if (a.kind === 'IS_WALL') {
      if (!doc.walls.some((w) => w.id === id)) continue;
      if (a.value) doc.walls = doc.walls.map((w) => (w.id === id ? { ...w, confidence: 1, state: 'VERIFIED' as const } : w));
      else {
        doc.walls = doc.walls.filter((w) => w.id !== id);
        doc.doors = doc.doors.filter((o) => o.wallId !== id);
        doc.windows = doc.windows.filter((o) => o.wallId !== id);
      }
    } else if (a.kind === 'STAIRS') {
      if (a.value) doc.stairs = doc.stairs.map((s) => (s.id === id ? { ...s, confidence: 1, state: 'VERIFIED' as const } : s));
      else doc.stairs = doc.stairs.filter((s) => s.id !== id);
    } else if (a.kind === 'DIMENSION') {
      const v = Array.isArray(a.value) ? a.value : [a.value];
      if (!v.every((n) => Number.isFinite(n) && n > 0.2 && n < 200)) continue;
      // A room's confirmed size is kept as its printed size (re-parseable metres);
      // an overall size has no element to live on and is passed to solvePlan as an answer.
      doc.rooms = doc.rooms.map((r) => (r.id === id ? { ...r, dimensionText: formatMetres(v), evidence: 'Size confirmed by the customer.' } : r));
      doc.balconies = doc.balconies.map((r) => (r.id === id ? { ...r, dimensionText: formatMetres(v), evidence: 'Size confirmed by the customer.' } : r));
    }
  }
  const conf = [...doc.walls, ...doc.doors, ...doc.windows, ...doc.rooms, ...doc.balconies].map((e) => e.confidence);
  doc.extractionConfidence = conf.length ? Math.min(...conf) : 0;
  return doc;
}
