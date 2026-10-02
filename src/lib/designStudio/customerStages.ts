// What the customer is told while their home is generated: four stages in
// their own words, each derived only from the real stages behind it — never a
// percentage, never a timer pretending to be progress. Pure.

import type { Stage } from './hybrid/contract.ts';

export type StageState = 'PENDING' | 'RUNNING' | 'DONE' | 'SKIPPED';

export const CUSTOMER_STAGES = ['PLAN', 'DESIGN', 'BUILD', 'FINISH'] as const;
export type CustomerStage = typeof CUSTOMER_STAGES[number];

/** The real stages each customer stage stands for. */
export const CUSTOMER_STAGE_OF: Record<CustomerStage, readonly Stage[]> = {
  PLAN: ['UNDERSTANDING', 'MEASURING'],
  DESIGN: ['PLANNING'],
  BUILD: ['ARCHITECTURE', 'FURNISHING', 'MATERIALS', 'LIGHTING'],
  FINISH: ['CHECKING', 'PREPARING', 'FINALIZING'],
};

const ended = (s: StageState) => s === 'DONE' || s === 'SKIPPED';

/**
 * A customer stage is done when every real stage behind it has ended (all
 * skipped → skipped), running while any of them runs or while it is part-way
 * (some ended, some not), and pending otherwise.
 */
export function customerStages(stages: Partial<Record<Stage, StageState>>): Record<CustomerStage, StageState> {
  const out = {} as Record<CustomerStage, StageState>;
  for (const c of CUSTOMER_STAGES) {
    const states = CUSTOMER_STAGE_OF[c].map((s) => stages[s] ?? 'PENDING');
    if (states.every((s) => s === 'SKIPPED')) out[c] = 'SKIPPED';
    else if (states.every(ended)) out[c] = 'DONE';
    else if (states.some((s) => s === 'RUNNING') || states.some(ended)) out[c] = 'RUNNING';
    else out[c] = 'PENDING';
  }
  return out;
}
