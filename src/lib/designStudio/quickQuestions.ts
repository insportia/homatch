// "ONLY WHEN WE GENUINELY NEED YOU" — which of the reading's questions stop
// the customer, one at a time.
//
// The reader already asks only where its evidence is weak, each question with
// a suggestion preselected. Most can safely go ahead on that suggestion (the
// full review still shows them all). These cannot: HOMATCH's own confidence
// is below WEAK, a room it could not name at all, or no printed size at all
// (the scale itself). Pure.

import type { PlanAnswer, PlanQuestion } from './planToHome.ts';

/** Below this the suggestion is closer to a guess than to a reading. */
export const WEAK = 0.4;
/** Never more than this many in a row; the rest go ahead on their suggestion. */
export const MAX_QUICK = 3;

export function isNecessary(q: PlanQuestion): boolean {
  if (q.kind === 'ROOM_TYPE' && q.suggested === 'UNKNOWN') return true;
  if (q.kind === 'DIMENSION' && q.confidence === 0) return true; // no printed size: the scale
  return q.confidence < WEAK;
}

/** The questions to ask now, most consequential first (the reader's own order), the answered ones gone. */
export function necessaryQuestions(questions: PlanQuestion[], answers: PlanAnswer[]): PlanQuestion[] {
  const answered = new Set(answers.map((a) => a.questionId));
  return questions.filter((q) => !answered.has(q.id) && isNecessary(q)).slice(0, MAX_QUICK);
}
