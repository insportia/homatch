// HOMATCH RESEARCH CORE — how many of these are actually different sources?
//
// Agreement is only evidence when the agreeing parties COULD have disagreed.
// Ten portals republishing one agency's feed agree by construction. So does a
// news site that quotes a developer's press release. Counting either as ten
// confirmations, or as two, produces a confidence number that is wrong in the
// dangerous direction.
//
// THREE COUNTS, NEVER COLLAPSED INTO ONE
//
//   observationCount        how many times we saw it.  "Seen on 9 pages."
//   independentSourceCount  how many distinct publishers said it. "3 sources."
//   effectiveSourceCount    the family-discounted weight. "worth about 1.6."
//
// These are three different facts about the same evidence and the report needs
// all three. Collapsing them into a single "sources: 9" is how a syndicated
// figure comes to look better-attested than a registry record. They are
// carried separately, all the way out, and the bridge writes them to the
// EvidenceItem's supporting metadata rather than averaging them away.
//
// THE DISCOUNT IS SCOPED TO (family, subject), NOT TO family ALONE
//
// Three comparable listings on one portal are three observations of three
// DIFFERENT properties and must not discount each other. Only repeated claims
// about the SAME subject are redundant. Getting this wrong deletes the primary
// listing's price because a comparable happened to sort above it.

import type { Observation } from '../core/types.ts';
import type { DedupedObservation } from './document-dedupe.ts';

/**
 * How much a second, third, … member of a publisher family is worth.
 *
 * Declared per family by the operator, because syndication is a commercial
 * relationship and nothing in a URL reveals it. A family with siblingWeight 0
 * is a pure mirror network and contributes exactly one observation however
 * many domains it publishes under.
 */
export interface SourceFamilyWeights {
  /** familyKey -> sibling weight in [0, 1]. */
  siblingWeight: Record<string, number>;
  /** Applied to a family with no entry. Pessimistic on purpose. */
  defaultSiblingWeight: number;
}

export const DEFAULT_FAMILY_WEIGHTS: SourceFamilyWeights = {
  siblingWeight: {},
  defaultSiblingWeight: 0.25,
};

const MINIMUM_WEIGHT = 0.05;

/** The subject every observation shares when the caller names none. */
const SHARED_SUBJECT = '\u0000all';

export interface SupportCount {
  /** Times the claim was observed at all, duplicates excluded. */
  observationCount: number;
  /** Distinct publisher families contributing. NOT the same number. */
  independentSourceCount: number;
  /** Family-discounted weight: what the agreement is actually worth. */
  effectiveSourceCount: number;
  /** Per-family observation counts, so the discount is auditable. */
  familyCounts: Record<string, number>;
}

export interface IndependenceResult extends SupportCount {
  /** Voting weight per observation id, 0..1. */
  weights: Map<string, number>;
}

export interface IndependenceOptions {
  weights?: SourceFamilyWeights;
  /**
   * What this observation is ABOUT. Two observations sharing a subject within
   * one family are redundant; two observations of different subjects are not.
   *
   * THE DEFAULT IS THE CAUTIOUS ONE: with no subject function, every
   * observation in a family is treated as being about the same thing, so a
   * family is discounted to roughly one voice. That under-states independence.
   * The opposite default — every observation its own subject — would mean a
   * caller who simply forgot to pass this got NINE independent sources out of
   * nine copies of one feed, which is the error that actually costs something.
   *
   * A caller gathering comparables must pass a real subject function, because
   * three listings on one portal are three different properties.
   */
  subjectOf?: (observation: Observation) => string;
  /** Rank within a family group; the highest keeps full weight. */
  rank?: (observation: Observation) => number;
}

export function computeIndependence(
  deduped: readonly DedupedObservation[],
  options: IndependenceOptions = {},
): IndependenceResult {
  const familyWeights = options.weights ?? DEFAULT_FAMILY_WEIGHTS;
  const subjectOf = options.subjectOf ?? (() => SHARED_SUBJECT);
  const rank = options.rank ?? (() => 0);

  const weights = new Map<string, number>();
  const familyCounts: Record<string, number> = {};
  const familiesSeen = new Set<string>();
  const byGroup = new Map<string, Observation[]>();
  let observationCount = 0;

  for (const entry of deduped) {
    if (!entry.independent) {
      // A duplicate has already been accounted for by its primary. It keeps
      // its row; it just does not vote.
      weights.set(entry.observation.id, 0);
      continue;
    }

    const observation = entry.observation;
    const family = observation.source.sourceFamily;
    observationCount += 1;
    familiesSeen.add(family);
    familyCounts[family] = (familyCounts[family] ?? 0) + 1;

    const groupKey = `${family}\u001f${subjectOf(observation)}`;
    const bucket = byGroup.get(groupKey);
    if (bucket) bucket.push(observation);
    else byGroup.set(groupKey, [observation]);
  }

  let effective = 0;

  for (const [groupKey, members] of byGroup) {
    const family = groupKey.split('\u001f')[0] as string;
    const siblingWeight =
      familyWeights.siblingWeight[family] ?? familyWeights.defaultSiblingWeight;

    const ranked = [...members].sort((a, b) => rank(b) - rank(a) || a.id.localeCompare(b.id));

    ranked.forEach((observation, index) => {
      const weight =
        index === 0
          ? 1
          : siblingWeight === 0
            ? 0
            : Math.max(MINIMUM_WEIGHT, siblingWeight ** index);
      weights.set(observation.id, weight);
      effective += weight;
    });
  }

  return {
    weights,
    familyCounts,
    observationCount,
    independentSourceCount: familiesSeen.size,
    effectiveSourceCount: Math.round(effective * 100) / 100,
  };
}

/**
 * Summarise support for a SUBSET of observations — the ones that carried a
 * particular claim — using weights already computed over the whole set.
 *
 * Computing independence per claim from scratch would let a claim made by one
 * member of a family look fully independent simply because its siblings
 * happened to talk about something else.
 */
export function supportFor(
  observations: readonly Observation[],
  independence: IndependenceResult,
): SupportCount {
  const familyCounts: Record<string, number> = {};
  const families = new Set<string>();
  let effective = 0;
  let observationCount = 0;

  for (const observation of observations) {
    const weight = independence.weights.get(observation.id);
    if (weight === undefined || weight === 0) continue;
    observationCount += 1;
    const family = observation.source.sourceFamily;
    families.add(family);
    familyCounts[family] = (familyCounts[family] ?? 0) + 1;
    effective += weight;
  }

  return {
    observationCount,
    independentSourceCount: families.size,
    effectiveSourceCount: Math.round(effective * 100) / 100,
    familyCounts,
  };
}
