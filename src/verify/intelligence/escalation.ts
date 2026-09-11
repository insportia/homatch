// HOMATCH — how hard a stage should work, given what we already know.
//
// The ladder the mandate describes has five rungs:
//
//   0  existing validated intelligence
//   1  deterministic / direct refresh
//   2  a fast model for bounded work
//   3  targeted web search for what is missing or stale
//   4  the main research model for genuinely hard discovery
//
// This module decides which rung a stage starts on and how much searching it
// is authorised to do. Rungs 0 and 3 are where the money actually is: a web
// search is billed per call, and a stage that already holds nine of its ten
// facts has no business running a full discovery sweep to re-find them.
//
// WHAT THIS DOES NOT DO, AND WHY.
//
// It does not route legal or ownership interpretation to a cheaper model.
// That is rung 2, and the mandate is explicit that it needs benchmark
// evidence first. The registry stage is also the one where being wrong costs
// somebody their flat, so it keeps the main model and a full budget whatever
// the graph holds — see ALWAYS_FULL_EFFORT.
//
// It does not reduce a budget to zero. A stage with nothing left to find
// still runs, still reads, and may still contradict what we believed: a
// budget of zero would turn "we already know this" into "do not look", and
// those are different instructions.

import type { StageDecision, StageName } from './stagePlan.ts';

export type EscalationLevel =
  /** Everything needed is in hand. Confirm, do not discover. */
  | 'KNOWN'
  /** Most of it is in hand. Search only for the gaps. */
  | 'TARGETED'
  /** Little or nothing is in hand. Full discovery. */
  | 'FULL';

export interface StageEffort {
  stage: StageName;
  level: EscalationLevel;
  /** How many web searches this stage is authorised to spend. */
  searchBudget: number;
  /** Internal explanation, recorded against the job and never shown. */
  reason: string;
}

/**
 * The stage that always works at full effort.
 *
 * official_collection establishes ownership, mortgages, seizures and
 * restrictions. It is re-read on every verification by design, so throttling
 * its searching would be throttling exactly the check a buyer is exposed to.
 */
const ALWAYS_FULL_EFFORT: StageName[] = ['official_collection'];

/**
 * What a stage is allowed to spend when it knows nothing.
 *
 * Chosen from what production actually did rather than invented: across two
 * complete verifications the stages spent between 0 and 6 searches each, and
 * these are the observed ceilings rounded up. A budget below what a stage
 * already does would be a cut dressed as a policy.
 */
const FULL_BUDGET: Record<StageName, number> = {
  identity: 4,
  official_collection: 4,
  public_research: 8,
  market: 8,
  synthesis: 0,
};

/**
 * How much of a stage's work is already done.
 *
 * Counted over the facts the planner assessed for that stage, so it means the
 * same thing the plan means.
 */
export function knownFraction(d: StageDecision): number {
  const total = d.reused.length + d.missing.length + d.stale.length + d.conflicting.length;
  return total ? d.reused.length / total : 0;
}

/**
 * The effort one stage should make.
 *
 * The budget falls with what is already known, and never to zero: a stage
 * that holds everything still runs and may still find that something changed.
 */
export function effortFor(d: StageDecision): StageEffort {
  const full = FULL_BUDGET[d.stage] ?? 4;

  if (ALWAYS_FULL_EFFORT.includes(d.stage)) {
    return {
      stage: d.stage,
      level: 'FULL',
      searchBudget: full,
      reason: 'transaction-critical: re-read at full effort whatever is already known',
    };
  }

  if (full === 0) {
    return { stage: d.stage, level: 'KNOWN', searchBudget: 0, reason: 'this stage does not search' };
  }

  const known = knownFraction(d);
  const outstanding = d.missing.length + d.stale.length + d.conflicting.length;

  if (outstanding === 0 && d.reused.length > 0) {
    // Everything is in hand. One search, because confirming is not the same
    // as not looking, and a contradiction is worth finding.
    return {
      stage: d.stage,
      level: 'KNOWN',
      searchBudget: 1,
      reason: `all ${d.reused.length} facts already established; confirming only`,
    };
  }

  if (known >= 0.5) {
    // Enough is known that a sweep would mostly re-find it. Budget scales
    // with what is actually outstanding rather than with the stage's size.
    const budget = Math.max(2, Math.min(full, outstanding + 1));
    return {
      stage: d.stage,
      level: 'TARGETED',
      searchBudget: budget,
      reason: `${d.reused.length} known, ${outstanding} outstanding; searching for the gaps`,
    };
  }

  return {
    stage: d.stage,
    level: 'FULL',
    searchBudget: full,
    reason: outstanding ? `${outstanding} outstanding of ${outstanding + d.reused.length}` : 'nothing known yet',
  };
}

export interface EscalationPlan {
  efforts: StageEffort[];
  /** Searches this run is authorised to spend, across every stage. */
  totalBudget: number;
  /** What the same run would have been allowed knowing nothing. */
  fullBudget: number;
  summary: string;
}

export function planEscalation(decisions: readonly StageDecision[] | null | undefined): EscalationPlan {
  const efforts = (decisions ?? []).map(effortFor);
  const totalBudget = efforts.reduce((a, e) => a + e.searchBudget, 0);
  const fullBudget = efforts.reduce((a, e) => a + (FULL_BUDGET[e.stage] ?? 4), 0);
  const throttled = efforts.filter((e) => e.level !== 'FULL').map((e) => e.stage);

  return {
    efforts,
    totalBudget,
    fullBudget,
    summary: throttled.length
      ? `${totalBudget}/${fullBudget} searches authorised; eased off on ${throttled.join(', ')}`
      : `${totalBudget}/${fullBudget} searches authorised; full effort everywhere`,
  };
}

/** The instruction a stage carries into its prompt. */
export function searchBudgetInstruction(effort: StageEffort | null | undefined): string {
  if (!effort || effort.searchBudget <= 0) return '';
  if (effort.level === 'FULL') return '';

  return [
    '',
    `SEARCH BUDGET: about ${effort.searchBudget} web ${effort.searchBudget === 1 ? 'search' : 'searches'} for this step.`,
    'Most of what this step covers is already established above, so searching is',
    'for what is missing, unclear or contradicted — not for confirming what you',
    'have already been given. This is a budget, not a prohibition: if the',
    'evidence genuinely requires another search to avoid stating something',
    'wrong, take it. Being right outranks being cheap, every time.',
  ].join('\n');
}
