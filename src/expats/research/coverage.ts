// HOMATCH FOR EXPATS — saying what we could not reach, instead of concluding
// from it.
//
// A crawler that could open four sources out of thirty has learned almost
// nothing, and the temptation at that moment is enormous: the screen needs
// to say something, the person is waiting, and "we found no well-reviewed
// immigration lawyers in Tbilisi" is a sentence that fits. It is also a
// libel about an entire profession produced by a rate limiter.
//
// This file is the arithmetic that stops it. A run's status is derived from
// what the run actually managed to READ — not from how many results it
// produced — and a run that reached too little cannot be labelled
// conclusive whatever it found.
//
// WHY BLOCKED AND INACCESSIBLE ARE DIFFERENT
//
// BLOCKED is a source that said no: robots.txt, a login wall, a deliberate
// refusal we are honouring. INACCESSIBLE is one we could not reach at all:
// a timeout, DNS, a circuit breaker that had already opened. The first is a
// standing fact about that source and should change what we plan to fetch
// next time; the second is probably transient and should be retried. An
// operator needs to tell them apart, so the product does.

import type { ExpatResearchStatus } from '../types.ts';

/** What happened to one source in one run. */
export const SOURCE_OUTCOMES = [
  'READ',
  /** Reached, and it had nothing about this subject. A real finding. */
  'READ_EMPTY',
  /** The source told us not to. robots, a wall, an explicit refusal. */
  'BLOCKED',
  /** We never got a usable response. Timeout, DNS, breaker open. */
  'INACCESSIBLE',
  /** Not attempted: budget, deadline, or the plan deprioritised it. */
  'SKIPPED',
] as const;
export type SourceOutcome = (typeof SOURCE_OUTCOMES)[number];

export interface SourceAttempt {
  sourceId: string;
  /** The publisher family, so two mirrors do not count as two sources. */
  family: string;
  outcome: SourceOutcome;
  /** True for a government or regulator source. Weighted separately. */
  official: boolean;
}

export interface CoverageReport {
  planned: number;
  read: number;
  readEmpty: number;
  blocked: number;
  inaccessible: number;
  skipped: number;
  /** Distinct publisher families successfully read. The number that counts. */
  familiesRead: number;
  /** Official sources planned, and how many of them were read. */
  officialPlanned: number;
  officialRead: number;
  /** read + readEmpty, over planned. */
  reachRatio: number;
}

export function summarise(attempts: readonly SourceAttempt[]): CoverageReport {
  const count = (o: SourceOutcome): number => attempts.filter((a) => a.outcome === o).length;
  const reachedOutcomes: ReadonlySet<SourceOutcome> = new Set(['READ', 'READ_EMPTY']);
  const reached = attempts.filter((a) => reachedOutcomes.has(a.outcome));

  return {
    planned: attempts.length,
    read: count('READ'),
    readEmpty: count('READ_EMPTY'),
    blocked: count('BLOCKED'),
    inaccessible: count('INACCESSIBLE'),
    skipped: count('SKIPPED'),
    familiesRead: new Set(attempts.filter((a) => a.outcome === 'READ').map((a) => a.family)).size,
    officialPlanned: attempts.filter((a) => a.official).length,
    officialRead: attempts.filter((a) => a.official && reachedOutcomes.has(a.outcome)).length,
    reachRatio: attempts.length === 0 ? 0 : reached.length / attempts.length,
  };
}

/**
 * The reach a run needs before its emptiness means anything.
 *
 * Two independent families is the floor. One family that came back empty is
 * one website having a bad day; two unrelated publishers both silent on a
 * subject is the beginning of a finding, and even then the product says
 * "nothing found in the sources we could read" rather than "none exist".
 */
export const MINIMUM_FAMILIES_FOR_A_FINDING = 2;
/** Below this share of the plan, a run describes our reach, not the world. */
export const MINIMUM_REACH_RATIO = 0.5;

/**
 * The honest status of a run.
 *
 * Note the order of the checks. Reach is tested BEFORE results, because a
 * run that reached almost nothing is not LIVE_PROVEN however many results
 * it scraped out of the one source it did open — and a run that reached
 * plenty and found nothing is a genuine NO_EVIDENCE, which is a different
 * and much more useful answer.
 */
export function statusFor(
  coverage: CoverageReport,
  resultCount: number,
): ExpatResearchStatus {
  if (coverage.planned === 0) return 'NO_EVIDENCE';

  const reachedEnough =
    coverage.familiesRead >= MINIMUM_FAMILIES_FOR_A_FINDING &&
    coverage.reachRatio >= MINIMUM_REACH_RATIO;

  if (!reachedEnough) {
    if (resultCount > 0) return 'PARTIAL';
    // Nothing found AND we could not reach much: the honest answer names
    // whichever obstruction dominated, and neither is a finding.
    if (coverage.blocked >= coverage.inaccessible && coverage.blocked > 0) return 'BLOCKED';
    if (coverage.inaccessible > 0) return 'INACCESSIBLE';
    return 'PARTIAL';
  }

  if (resultCount === 0) return 'NO_EVIDENCE';
  // Reached enough, found something, but some of the plan is still missing.
  return coverage.reachRatio >= 0.8 ? 'LIVE_PROVEN' : 'PARTIAL';
}

/**
 * May the product state a real-world negative from this run?
 *
 * The single question the whole file exists to answer, and the only
 * function anything outside should need. NO_EVIDENCE after genuine reach
 * is the one status that permits "we looked and found none", and even then
 * the copy is obliged to name the sources that were read.
 */
export function mayStateAbsence(
  coverage: CoverageReport,
  status: ExpatResearchStatus,
): boolean {
  return (
    status === 'NO_EVIDENCE' &&
    coverage.familiesRead >= MINIMUM_FAMILIES_FOR_A_FINDING &&
    coverage.reachRatio >= MINIMUM_REACH_RATIO
  );
}

/**
 * What the reader should be told about the limits of this run.
 *
 * Returned as i18n keys so the sentence is written once per language and
 * not assembled from fragments — Georgian and Arabic do not concatenate
 * the way English does.
 */
export function coverageNoteKeys(
  coverage: CoverageReport,
  status: ExpatResearchStatus,
): string[] {
  const keys: string[] = [];
  if (coverage.blocked > 0) keys.push('expat_research_note_blocked');
  if (coverage.inaccessible > 0) keys.push('expat_research_note_unreachable');
  if (coverage.officialPlanned > 0 && coverage.officialRead === 0) {
    keys.push('expat_research_note_no_official');
  }
  if (coverage.familiesRead < MINIMUM_FAMILIES_FOR_A_FINDING) {
    keys.push('expat_research_note_few_sources');
  }
  if (status === 'NO_EVIDENCE' && !mayStateAbsence(coverage, status)) {
    keys.push('expat_research_note_not_an_absence');
  }
  return keys;
}
