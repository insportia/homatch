// HOMATCH RESEARCH CORE — disagreement is a finding, not a problem.
//
// When two sources say different things, the core records BOTH and says they
// disagree. It never picks a winner, never averages them, and never drops the
// minority view. Homatch already has the vocabulary for this outcome —
// VerificationState 'DISPUTED' and EvidenceItem.contradiction — and this is
// what fills them.
//
// The reason is not squeamishness. A property whose registry says one owner
// and whose portal listing says another is not a data-quality problem to be
// smoothed over; it is the single most valuable thing the research found, and
// a pipeline that resolves it silently has destroyed its own best output.
//
// WHAT IS NOT A CONFLICT
//
// Two of the three checks below exist to stop the detector crying wolf, and
// both came from real false positives:
//
//   - Different PRICE BASIS. An asking price of 200k and a transaction price
//     of 185k do not disagree. They are answers to different questions, and
//     flagging them wastes the customer's attention on the one signal that
//     should never be ignored.
//   - Different EVIDENCE LEVEL. A district median and a specific unit's price
//     do not disagree either. Only claims made at the same level about the
//     same subject can contradict one another.
//
// The third is ordinary numeric tolerance: 201,000 and 200,000 are the same
// price quoted by two people.

import { relativeDifference, round } from '../normalize/numbers.ts';
import { deterministicId } from '../core/ids.ts';
import {
  basesArePoolable,
  type EvidenceLevel,
  type Money,
  type Observation,
  type PriceBasis,
} from '../core/types.ts';
import type { SupportCount } from './independence.ts';

export type ConflictSeverity = 'LOW' | 'MEDIUM' | 'HIGH';

export type ConflictCode =
  | 'NUMERIC_DISAGREEMENT'
  | 'CATEGORICAL_DISAGREEMENT'
  | 'PRESENCE_DISAGREEMENT';

/** One of the competing answers, with who said it and how well attested it is. */
export interface ConflictAlternative {
  value: string | number | boolean;
  /** Observations asserting this value. Kept whole for the audit trail. */
  observationIds: string[];
  support: SupportCount;
}

export interface Conflict {
  id: string;
  code: ConflictCode;
  severity: ConflictSeverity;
  /** What the disagreement is about, e.g. `ownership.owner`. */
  claimKey: string;
  /** The level all alternatives were observed at. Mixed levels never conflict. */
  evidenceLevel: EvidenceLevel;
  /** For money claims, the basis all alternatives share. */
  priceBasis: PriceBasis | null;
  /**
   * EVERY competing answer, in descending order of support. The order is for
   * presentation only: nothing here marks one of them correct, and there is
   * deliberately no `resolved` or `winner` field for a caller to reach for.
   */
  alternatives: ConflictAlternative[];
}

/** One asserted value, from one observation. */
export interface Claim {
  observation: Observation;
  claimKey: string;
  value: string | number | boolean;
  /** Set when the value is money, so bases are compared rather than amounts. */
  money?: Money | null;
}

export interface ConflictOptions {
  /** Relative difference below which two numbers are the same number. */
  numericTolerance?: number;
  /** Support computed over the whole observation set. */
  supportOf: (observations: readonly Observation[]) => SupportCount;
}

/**
 * Group claims by (claimKey, evidenceLevel, priceBasis) and report every group
 * that holds more than one distinct value.
 */
export function detectConflicts(
  claims: readonly Claim[],
  options: ConflictOptions,
): Conflict[] {
  const tolerance = options.numericTolerance ?? 0.02;
  const groups = new Map<string, Claim[]>();

  for (const claim of claims) {
    const basis = claim.money?.basis ?? null;
    const key = [claim.claimKey, claim.observation.evidenceLevel, basis ?? '-'].join('\u001f');
    const bucket = groups.get(key);
    if (bucket) bucket.push(claim);
    else groups.set(key, [claim]);
  }

  const conflicts: Conflict[] = [];

  for (const [key, members] of groups) {
    const [claimKey, level, basisRaw] = key.split('\u001f') as [string, EvidenceLevel, string];
    const basis = basisRaw === '-' ? null : (basisRaw as PriceBasis);

    // A money group where the bases are not poolable is not a group at all.
    // UNKNOWN never pools, so a mystery figure cannot contradict a real one.
    if (basis !== null && !basesArePoolable(basis, basis)) continue;

    const clusters = clusterValues(members, tolerance);
    if (clusters.length < 2) continue;

    const alternatives: ConflictAlternative[] = clusters
      .map((cluster) => ({
        value: cluster.representative,
        observationIds: cluster.claims.map((c) => c.observation.id),
        support: options.supportOf(cluster.claims.map((c) => c.observation)),
      }))
      .sort(
        (a, b) =>
          b.support.effectiveSourceCount - a.support.effectiveSourceCount ||
          b.support.observationCount - a.support.observationCount,
      );

    const numeric = typeof clusters[0]?.representative === 'number';
    conflicts.push({
      id: deterministicId('conflict', claimKey, level, basis ?? '-'),
      code: numeric ? 'NUMERIC_DISAGREEMENT' : 'CATEGORICAL_DISAGREEMENT',
      severity: severityFor(alternatives, numeric, tolerance),
      claimKey,
      evidenceLevel: level,
      priceBasis: basis,
      alternatives,
    });
  }

  return conflicts.sort((a, b) => a.id.localeCompare(b.id));
}

interface Cluster {
  representative: string | number | boolean;
  claims: Claim[];
}

function clusterValues(claims: readonly Claim[], tolerance: number): Cluster[] {
  const clusters: Cluster[] = [];

  for (const claim of claims) {
    const value = claim.value;
    const match = clusters.find((cluster) => sameValue(cluster.representative, value, tolerance));
    if (match) {
      match.claims.push(claim);
      continue;
    }
    clusters.push({ representative: value, claims: [claim] });
  }

  return clusters;
}

function sameValue(a: unknown, b: unknown, tolerance: number): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return relativeDifference(a, b) <= tolerance;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return a.trim().toLowerCase() === b.trim().toLowerCase();
  }
  return a === b;
}

/**
 * How loudly to surface the disagreement.
 *
 * HIGH when two well-attested answers are far apart — the case where a person
 * has to look. LOW when one answer is barely supported, which is more likely a
 * stale page than a genuine dispute. Never zero: a conflict is always reported.
 */
function severityFor(
  alternatives: readonly ConflictAlternative[],
  numeric: boolean,
  tolerance: number,
): ConflictSeverity {
  const [first, second] = alternatives;
  if (!first || !second) return 'LOW';

  const contested =
    second.support.independentSourceCount >= 2 ||
    second.support.effectiveSourceCount >= first.support.effectiveSourceCount * 0.5;

  if (!numeric) return contested ? 'HIGH' : 'MEDIUM';

  const spread = relativeDifference(Number(first.value), Number(second.value));
  const material = spread >= Math.max(0.1, tolerance * 5);
  if (contested && material) return 'HIGH';
  if (contested || material) return 'MEDIUM';
  return 'LOW';
}

/** Round-trip helper for callers presenting a numeric spread. */
export function conflictSpread(conflict: Conflict): number | null {
  if (conflict.code !== 'NUMERIC_DISAGREEMENT') return null;
  const values = conflict.alternatives
    .map((alternative) => Number(alternative.value))
    .filter((value) => Number.isFinite(value));
  if (values.length < 2) return null;
  return round(Math.max(...values) - Math.min(...values), 2);
}
