// HOMATCH RESEARCH CORE — did we actually answer the question?
//
// This is the deterministic result. No model is involved and none is needed:
// given a profile and the observations gathered, arithmetic decides which
// objectives were established, at which evidence level, on which price basis,
// and with how much independent support — and which were not, and why.
//
// That matters beyond tidiness. If the only thing that can say whether the
// research succeeded is a language model reading the output, then there is
// nothing to check the model against, and a confident summary of an empty
// bundle looks exactly like a confident summary of a good one. AI is
// downstream interpretation; this is the authority.

import type {
  EvidenceLevel,
  Observation,
  ResearchStatus,
} from '../core/types.ts';
import { evidenceLevelDistance, levelSatisfies, type PriceBasis } from '../core/types.ts';
import type { SupportCount } from '../score/independence.ts';
import type {
  ObjectiveId,
  ProfileId,
  ResearchObjective,
  ResearchProfile,
  UnavailableReason,
} from './types.ts';

export type ObjectiveStatus =
  /** The gate was met. There is something honest to report. */
  | 'ESTABLISHED'
  /** Evidence exists but below the gate. Reportable only as "indications". */
  | 'PARTIAL'
  /** Nothing usable. `unavailableReason` says which kind of nothing. */
  | 'UNAVAILABLE';

export interface ObjectiveOutcome {
  objectiveId: ObjectiveId;
  status: ObjectiveStatus;
  unavailableReason: UnavailableReason | null;
  /**
   * The level the evidence ACTUALLY came from — never the level that was
   * asked for. A report that says "same project" because the profile
   * preferred it, while the evidence was district-wide, is a false statement
   * about provenance.
   */
  achievedLevel: EvidenceLevel | null;
  /** The basis the evidence was on. Never a blend. */
  priceBasis: PriceBasis | null;
  support: SupportCount;
  observationIds: string[];
  /** Operator note carried from the objective when it is knownUnavailable. */
  note: string | null;
}

export interface ProfileCoverage {
  profileId: ProfileId;
  status: ResearchStatus;
  objectives: ObjectiveOutcome[];
  establishedCount: number;
  partialCount: number;
  unavailableCount: number;
}

/** One observation offered toward one objective, on one basis. */
export interface ObjectiveContribution {
  objectiveId: ObjectiveId;
  observation: Observation;
  /** null for non-money objectives. */
  priceBasis: PriceBasis | null;
}

export interface CoverageOptions {
  /** Support computed over the whole observation set, then narrowed. */
  supportOf: (observations: readonly Observation[]) => SupportCount;
  /** Set when the run stopped early, so PARTIAL is reported honestly. */
  stoppedEarly?: { reason: 'DEADLINE_REACHED' | 'BUDGET_EXHAUSTED' } | null;
}

const EMPTY_SUPPORT: SupportCount = {
  observationCount: 0,
  independentSourceCount: 0,
  effectiveSourceCount: 0,
  familyCounts: {},
};

export function evaluateCoverage(
  profile: ResearchProfile,
  contributions: readonly ObjectiveContribution[],
  options: CoverageOptions,
): ProfileCoverage {
  const byObjective = new Map<ObjectiveId, ObjectiveContribution[]>();
  for (const contribution of contributions) {
    const bucket = byObjective.get(contribution.objectiveId);
    if (bucket) bucket.push(contribution);
    else byObjective.set(contribution.objectiveId, [contribution]);
  }

  const outcomes = profile.objectives.map((objective) =>
    evaluateObjective(objective, byObjective.get(objective.id) ?? [], options),
  );

  const establishedCount = outcomes.filter((o) => o.status === 'ESTABLISHED').length;
  const partialCount = outcomes.filter((o) => o.status === 'PARTIAL').length;
  const unavailableCount = outcomes.filter((o) => o.status === 'UNAVAILABLE').length;

  return {
    profileId: profile.id,
    status: overallStatus(outcomes, establishedCount, options),
    objectives: outcomes,
    establishedCount,
    partialCount,
    unavailableCount,
  };
}

function evaluateObjective(
  objective: ResearchObjective,
  contributions: readonly ObjectiveContribution[],
  options: CoverageOptions,
): ObjectiveOutcome {
  // A permanently-unavailable objective can still be answered if a source
  // actually stated it. The flag suppresses derivation and spending, not
  // reporting: if somebody publishes days-on-market tomorrow, we report it.
  if (objective.knownUnavailable && contributions.length === 0) {
    return {
      objectiveId: objective.id,
      status: 'UNAVAILABLE',
      unavailableReason: objective.knownUnavailable.reason,
      achievedLevel: null,
      priceBasis: null,
      support: EMPTY_SUPPORT,
      observationIds: [],
      note: objective.knownUnavailable.note,
    };
  }

  // Money objectives accept only their declared bases. This is where an
  // asking rent offered toward an achieved-rent objective is refused.
  const accepted = contributions.filter((contribution) => {
    if (objective.acceptedPriceBases.length === 0) return contribution.priceBasis === null;
    return (
      contribution.priceBasis !== null &&
      objective.acceptedPriceBases.includes(contribution.priceBasis)
    );
  });

  if (accepted.length === 0) {
    return {
      objectiveId: objective.id,
      status: 'UNAVAILABLE',
      unavailableReason:
        contributions.length > 0 ? 'WRONG_PRICE_BASIS' : notEnoughReason(options),
      achievedLevel: null,
      priceBasis: null,
      support: EMPTY_SUPPORT,
      observationIds: [],
      note: objective.knownUnavailable?.note ?? null,
    };
  }

  // Within the accepted set, take only what is close enough to the subject.
  const inLevel = accepted.filter((contribution) =>
    levelSatisfies(contribution.observation.evidenceLevel, objective.gate.maxEvidenceLevel),
  );

  if (inLevel.length === 0) {
    return {
      objectiveId: objective.id,
      status: 'UNAVAILABLE',
      unavailableReason: 'NO_EVIDENCE_AT_REQUIRED_LEVEL',
      achievedLevel: null,
      priceBasis: null,
      support: EMPTY_SUPPORT,
      observationIds: [],
      note: objective.knownUnavailable?.note ?? null,
    };
  }

  // One basis per outcome. If several accepted bases are present they are
  // genuinely different claims; the best-supported one is reported and the
  // others remain as their own observations rather than being blended in.
  const basis = dominantBasis(inLevel, options);
  const chosen = inLevel.filter((contribution) => contribution.priceBasis === basis);

  const observations = chosen.map((contribution) => contribution.observation);
  const support = options.supportOf(observations);

  // The achieved level is the WORST (furthest) level among the contributing
  // observations, not the best. A set that is mostly district-wide with one
  // same-building listing is district evidence.
  const achievedLevel = observations.reduce<EvidenceLevel>(
    (worst, observation) =>
      evidenceLevelDistance(observation.evidenceLevel) > evidenceLevelDistance(worst)
        ? observation.evidenceLevel
        : worst,
    observations[0]?.evidenceLevel ?? 'SAME_PROPERTY',
  );

  const meetsGate =
    support.independentSourceCount >= objective.gate.minIndependentSources &&
    support.observationCount >= objective.gate.minObservations;

  return {
    objectiveId: objective.id,
    status: meetsGate ? 'ESTABLISHED' : 'PARTIAL',
    unavailableReason: null,
    achievedLevel,
    priceBasis: basis,
    support,
    observationIds: observations.map((observation) => observation.id),
    note: objective.knownUnavailable?.note ?? null,
  };
}

function dominantBasis(
  contributions: readonly ObjectiveContribution[],
  options: CoverageOptions,
): PriceBasis | null {
  const bases = new Set(contributions.map((c) => c.priceBasis));
  if (bases.size <= 1) return contributions[0]?.priceBasis ?? null;

  let best: PriceBasis | null = null;
  let bestScore = -1;
  for (const basis of bases) {
    const observations = contributions
      .filter((c) => c.priceBasis === basis)
      .map((c) => c.observation);
    const support = options.supportOf(observations);
    const score = support.effectiveSourceCount;
    // Ties break on the basis name so the outcome is deterministic.
    if (score > bestScore || (score === bestScore && String(basis) < String(best))) {
      best = basis;
      bestScore = score;
    }
  }
  return best;
}

function notEnoughReason(options: CoverageOptions): UnavailableReason {
  if (options.stoppedEarly?.reason === 'DEADLINE_REACHED') return 'DEADLINE_REACHED';
  if (options.stoppedEarly?.reason === 'BUDGET_EXHAUSTED') return 'BUDGET_EXHAUSTED';
  return 'NOT_ENOUGH_EVIDENCE';
}

function overallStatus(
  outcomes: readonly ObjectiveOutcome[],
  establishedCount: number,
  options: CoverageOptions,
): ResearchStatus {
  if (options.stoppedEarly && establishedCount < outcomes.length) return 'PARTIAL';
  if (establishedCount > 0) return 'COMPLETE';
  if (outcomes.some((outcome) => outcome.status === 'PARTIAL')) return 'PARTIAL';
  // Ran correctly, found nothing trustworthy. Not a failure — Homatch's
  // existing NO_EVIDENCE contract, which homatch-research already returns 200
  // for, and which this deliberately matches rather than inventing a new one.
  return 'NO_EVIDENCE';
}
