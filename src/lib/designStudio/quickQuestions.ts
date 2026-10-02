// "ONLY WHEN WE GENUINELY NEED YOU" — which of the reading's questions stop
// the customer, one at a time.
//
// The reader asks a question only where its own evidence is weak, each with a
// suggestion preselected, at most MAX_QUESTIONS, the most consequential first.
// The simple flow splits them by what a wrong guess would break:
//
//   ARCHITECTURE-CRITICAL — always asked, never capped away. A wrong guess
//   changes what gets built: a door, an opening or a wall (rooms joined or cut
//   off), indoors or outdoors (the building's edge), a staircase, and the
//   scale itself (no printed size, or an overall width / depth the drawing
//   disagrees with).
//
//   LOW-IMPACT — a room's name, one room's printed size. Asked only when the
//   suggestion is closer to a guess than a reading (below WEAK, a room it could
//   not name at all), and only while fewer than MAX_QUICK questions are asked.
//
// The set is decided from the reading alone, never from the answers, so a
// reload asks the same questions in the same order and an answered one never
// comes back. Pure; no new questions are made here.

import type { PlanAnswer, PlanQuestion } from './planToHome.ts';
import { MAX_QUESTIONS } from './planRead/questions.ts';

/** Below this the suggestion is closer to a guess than to a reading. */
export const WEAK = 0.4;
/** Low-impact questions stop asking once this many questions are asked in all. */
export const MAX_QUICK = 3;

/** Question kinds whose wrong guess changes the architecture that is built. */
export const CRITICAL_KINDS: ReadonlySet<PlanQuestion['kind']> = new Set(['OPENING_TYPE', 'IS_WALL', 'OUTDOOR', 'STAIRS']);

/** The overall width / depth checks (planRead/solve.ts) are the drawing's scale. */
export const isOverallDimension = (q: PlanQuestion) => q.kind === 'DIMENSION' && (q.elementId === 'OVERALL_W' || q.elementId === 'OVERALL_D');

export function isCritical(q: PlanQuestion): boolean {
  if (CRITICAL_KINDS.has(q.kind)) return true;
  if (isOverallDimension(q)) return true;
  return q.kind === 'DIMENSION' && q.confidence === 0; // no printed size at all: the scale
}

/** A question worth stopping for: every critical one, and a low-impact one only when it is closer to a guess. */
export function isNecessary(q: PlanQuestion): boolean {
  if (isCritical(q)) return true;
  if (q.kind === 'ROOM_TYPE' && q.suggested === 'UNKNOWN') return true;
  return q.confidence < WEAK;
}

/** Every question the simple flow asks for this reading, in the reader's order (answers never change it). */
export function quickSet(questions: PlanQuestion[]): PlanQuestion[] {
  const all = questions.slice(0, MAX_QUESTIONS);
  let room = Math.max(0, MAX_QUICK - all.filter(isCritical).length);
  return all.filter((q) => isCritical(q) || (isNecessary(q) && room-- > 0));
}

/** The questions still to ask, the next one first. */
export function necessaryQuestions(questions: PlanQuestion[], answers: PlanAnswer[]): PlanQuestion[] {
  const answered = new Set(answers.map((a) => a.questionId));
  return quickSet(questions).filter((q) => !answered.has(q.id));
}
