// HOMATCH INTELLIGENCE — the owner's optional, evidence-based optimisation
// layer over the campaign's recommendations (analysis.recommend). Pure.
//
// What it may propose is bounded by HARD CONSTRAINTS that no setting, signal
// or model output can lift. It may never, by itself:
//   · raise the daily budget or the approved total,
//   · reach a place outside the approved locations,
//   · change the campaign objective,
//   · activate a paused campaign (or ad set),
//   · narrow by age or gender where Meta's housing rule applies,
//   · undo an exclusion the owner made,
//   · do anything Meta's policy does not allow.
// Proposals that would cross one are returned BLOCKED with the reason — they
// can only ever become a suggestion the owner approves.
//
// No fixed percentage splits: an audience focus is proposed only from
// the campaign's own measured segments, with a sample threshold, and the
// share comes from the data. No oscillation: one change per entity per
// cooldown, and never the reverse of a recent change.
import { DEFAULT_ANALYSIS_PARAMS, type AnalysisParams, type Evidence, type Recommendation } from './analysis.ts';

export interface IntelligencePrefs {
  enabled: boolean;
  /** QUALITY: judge by qualified leads, not the cheapest lead. VOLUME: by results. */
  optimiseFor: 'QUALITY' | 'VOLUME';
}
export const DEFAULT_PREFS: IntelligencePrefs = { enabled: false, optimiseFor: 'QUALITY' };

/** The stored preference, sanitised — anything unknown falls back to off. */
export function prefsOf(raw: unknown): IntelligencePrefs {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  return { enabled: r.enabled === true, optimiseFor: r.optimiseFor === 'VOLUME' ? 'VOLUME' : 'QUALITY' };
}

export type ProposalKind =
  | 'SHIFT_TO_CREATIVE' | 'REDUCE_DAILY' | 'RAISE_DAILY' | 'FOCUS_AGE' | 'CHANGE_GEOGRAPHY'
  | 'CHANGE_OBJECTIVE' | 'ACTIVATE' | 'DROP_EXCLUSION' | 'REFRESH_CREATIVE';

export interface Proposal {
  kind: ProposalKind;
  /** 'campaign', 'ad:<id>', 'age:<min>-<max>' … */
  entity: string;
  /** Direction for the oscillation rule: +1 more, -1 less, 0 neutral. */
  direction: -1 | 0 | 1;
  dailyMinor?: number;
  locations?: string[];
  ageMin?: number;
  /** Measured share of qualified results in the segment (0–1), when FOCUS_AGE. */
  measuredShare?: number;
  evidence: Evidence;
  reasonCodes: string[];
}

export interface Constraints {
  approvedDailyMinor: number;
  status: string;
  approvedLocationIds: string[];
  housingRestricted: boolean;
  exclusions: string[];
}

export type Violation =
  | 'BUDGET_INCREASE' | 'GEO_EXPANSION' | 'OBJECTIVE_CHANGE' | 'ACTIVATE_PAUSED'
  | 'SPECIAL_AD_CATEGORY' | 'EXCLUSION_OVERRIDE';

/** The hard line. Null = within the owner's limits. */
export function violates(p: Proposal, c: Constraints): Violation | null {
  switch (p.kind) {
    case 'RAISE_DAILY': return 'BUDGET_INCREASE';
    case 'REDUCE_DAILY': return Number(p.dailyMinor) > c.approvedDailyMinor ? 'BUDGET_INCREASE' : null;
    case 'CHANGE_GEOGRAPHY': return (p.locations ?? []).some((l) => !c.approvedLocationIds.includes(l)) ? 'GEO_EXPANSION' : null;
    case 'CHANGE_OBJECTIVE': return 'OBJECTIVE_CHANGE';
    case 'ACTIVATE': return c.status === 'PAUSED' ? 'ACTIVATE_PAUSED' : null;
    case 'FOCUS_AGE': return c.housingRestricted ? 'SPECIAL_AD_CATEGORY' : null;
    case 'DROP_EXCLUSION': return 'EXCLUSION_OVERRIDE';
    default: return null;
  }
}

export interface HistoryItem { entity: string; direction: -1 | 0 | 1; at: number }
export interface Decision { proposal: Proposal; verdict: 'WITHIN_LIMITS' | 'NEEDS_APPROVAL' | 'HELD'; reason: Violation | 'COOLDOWN' | 'WOULD_REVERSE' | 'NOT_ENOUGH_EVIDENCE' | null }

const RANK: Record<Evidence, number> = { INSUFFICIENT_DATA: 0, EARLY_SIGNAL: 1, MEANINGFUL_SIGNAL: 2, HIGH_CONFIDENCE: 3 };
const DAY = 86_400_000;

/** A recommendation, read as a concrete proposal. */
export function proposalOf(r: Recommendation): Proposal | null {
  const base = { evidence: r.confidence, reasonCodes: r.reasonCodes };
  switch (r.type) {
    case 'REALLOCATE': {
      const strongest = r.reasonCodes.find((c) => c.startsWith('STRONGEST:'))?.slice(10);
      return strongest ? { ...base, kind: 'SHIFT_TO_CREATIVE', entity: `ad:${strongest}`, direction: 1 } : null;
    }
    case 'REDUCE': return { ...base, kind: 'REDUCE_DAILY', entity: 'campaign', direction: -1, dailyMinor: r.proposedDailyMinor };
    case 'INCREASE': return { ...base, kind: 'RAISE_DAILY', entity: 'campaign', direction: 1, dailyMinor: r.proposedDailyMinor };
    case 'REFRESH_CREATIVE': return { ...base, kind: 'REFRESH_CREATIVE', entity: r.affected, direction: 0 };
    default: return null;
  }
}

/**
 * Every proposal, judged: within the owner's limits, needing their approval
 * (a hard constraint), or held (too little evidence, too soon, or the
 * reverse of a recent change).
 */
export function decide(proposals: Proposal[], prefs: IntelligencePrefs, c: Constraints, history: HistoryItem[], now: number,
  p: AnalysisParams = DEFAULT_ANALYSIS_PARAMS): Decision[] {
  if (!prefs.enabled) return [];
  return proposals.map((proposal) => {
    const v = violates(proposal, c);
    if (v) return { proposal, verdict: 'NEEDS_APPROVAL', reason: v };
    if (RANK[proposal.evidence] < RANK.MEANINGFUL_SIGNAL) return { proposal, verdict: 'HELD', reason: 'NOT_ENOUGH_EVIDENCE' };
    const recent = history.filter((h) => h.entity === proposal.entity && now - h.at < p.cooldownDays * DAY);
    if (recent.length) return { proposal, verdict: 'HELD', reason: 'COOLDOWN' };
    const reversal = history.some((h) => h.entity === proposal.entity && h.direction !== 0 && h.direction === -proposal.direction
      && now - h.at < p.cooldownDays * 2 * DAY);
    if (reversal) return { proposal, verdict: 'HELD', reason: 'WOULD_REVERSE' };
    return { proposal, verdict: 'WITHIN_LIMITS', reason: null };
  });
}

export interface AgeSegment { ageMin: number; ageMax: number; results: number; qualified: number; spendMinor: number }

/**
 * An age focus from the campaign's OWN numbers — never a preset split. It is
 * proposed only when the older band already delivers a clear majority of the
 * qualified results on a meaningful sample, and only where Meta allows age
 * choices (not under the housing rule). The share proposed IS the measured one.
 */
export function ageFocus(segments: AgeSegment[], cutoff: number, c: Pick<Constraints, 'housingRestricted'>,
  p: AnalysisParams = DEFAULT_ANALYSIS_PARAMS): Proposal | null {
  if (c.housingRestricted) return null;
  const metric = (s: AgeSegment) => s.qualified;
  const total = segments.reduce((n, s) => n + metric(s), 0);
  if (total < p.meaningfulResults) return null;
  const older = segments.filter((s) => s.ageMin >= cutoff).reduce((n, s) => n + metric(s), 0);
  const share = older / total;
  const spendShare = segments.filter((s) => s.ageMin >= cutoff).reduce((n, s) => n + s.spendMinor, 0)
    / Math.max(1, segments.reduce((n, s) => n + s.spendMinor, 0));
  // A clear majority of qualified results for clearly less than that share of spend.
  if (share < 0.6 || share - spendShare < p.minCostGap) return null;
  return {
    kind: 'FOCUS_AGE', entity: `age:${cutoff}+`, direction: 1, ageMin: cutoff, measuredShare: Math.round(share * 100) / 100,
    evidence: total >= p.highResults ? 'HIGH_CONFIDENCE' : 'MEANINGFUL_SIGNAL', reasonCodes: ['AGE_BAND_QUALIFIES_BETTER'],
  };
}
