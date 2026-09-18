// HOMATCH RESEARCH CORE — what a piece of research is FOR.
//
// A profile is a contract, not a script. It says what must be established,
// what kinds of evidence count toward it, how close to the subject that
// evidence has to be, and what the minimum is below which nothing may be
// reported at all. It says nothing about how to fetch anything, which is why
// a new provider or adapter can be added later without any profile changing.
//
// THE PROFILE IS THE PLACE WHERE "WE DON'T KNOW" IS A LEGAL ANSWER
//
// Every objective can come back UNAVAILABLE with a reason. That is not a
// degraded mode — for several Investment questions in Georgia it is the
// correct and permanent answer today, because the data does not exist
// publicly. An engine with no way to say so will always find something to say
// instead, and what it finds will be wrong.

import type {
  EvidenceLevel,
  PriceBasis,
  WorkClass,
} from '../core/types.ts';

export type ProfileId =
  | 'MARKET_COMPARABLES'
  | 'INVESTMENT_PRICE_CHECK'
  | 'INVESTMENT_RENT_CHECK'
  | 'INVESTMENT_MARKET_MOVEMENT'
  | 'INVESTMENT_LIQUIDITY'
  | 'INVESTMENT_DEEP_RESEARCH';

export type ObjectiveId = string;

/**
 * Why an objective could not be answered.
 *
 * `SOURCE_DOES_NOT_PUBLISH_IT` is distinct from `NOT_ENOUGH_EVIDENCE` on
 * purpose: one says "try harder", the other says "stop asking". Days on market
 * in Georgia is the second kind, and a profile that reports it as the first
 * will burn budget forever re-checking a thing that is never coming.
 */
export type UnavailableReason =
  | 'NOT_ENOUGH_EVIDENCE'
  | 'NO_EVIDENCE_AT_REQUIRED_LEVEL'
  | 'WRONG_PRICE_BASIS'
  | 'SOURCE_DOES_NOT_PUBLISH_IT'
  | 'CONFLICTING_EVIDENCE'
  | 'BUDGET_EXHAUSTED'
  | 'DEADLINE_REACHED';

export interface ReportingGate {
  /**
   * Distinct publisher families required. NOT observations — nine copies of
   * one feed is one source, and a gate written in observations is a gate that
   * syndication walks straight through.
   */
  minIndependentSources: number;
  /** Raw observations required, as a separate floor. */
  minObservations: number;
  /**
   * The furthest-from-subject level that still counts. A district median may
   * inform context, but if the objective needs SAME_PROJECT, a district
   * number does not satisfy it.
   */
  maxEvidenceLevel: EvidenceLevel;
}

export interface ResearchObjective {
  id: ObjectiveId;
  /**
   * Money bases that answer this objective. Empty for non-money objectives.
   * Listed rather than ranked: the result reports each basis separately and
   * never converts between them.
   */
  acceptedPriceBases: PriceBasis[];
  /** Evidence levels in preference order, closest first. */
  preferredLevels: EvidenceLevel[];
  gate: ReportingGate;
  /**
   * Set when the answer is known to be unobtainable from public sources in
   * this market. The objective is then reported UNAVAILABLE immediately,
   * without spending anything, and the reason is carried through so the
   * customer is told why rather than shown a blank.
   */
  knownUnavailable?: { reason: UnavailableReason; note: string };
  notes: string;
}

export interface ProfileLimits {
  /** Wall-clock budget for the interactive path. */
  softDeadlineMs: number;
  /** Hard stop. Past this the result is PARTIAL, with whatever was gathered. */
  hardDeadlineMs: number;
  /** Maximum documents fetched. A ceiling on work, not on quality. */
  maxDocuments: number;
  /** Maximum distinct sources consulted. */
  maxSources: number;
}

export interface ResearchProfile {
  id: ProfileId;
  /**
   * `billable_products.code` this profile runs under, when it costs money.
   *
   * null means "not independently billable" — the work happens inside another
   * product's grant. There is no pricing here and never will be: billing.ts
   * decides funding, tier, ceilings and priority, and this field is only the
   * key it is asked about.
   */
  productCode: string | null;
  defaultWorkClass: WorkClass;
  objectives: ResearchObjective[];
  limits: ProfileLimits;
  /**
   * True when the profile's output is meaningful with no AI step at all.
   *
   * Every Investment profile is. AI summarisation is downstream
   * interpretation, and a profile that only makes sense once a model has
   * written about it has no deterministic result to check the model against.
   */
  usefulWithoutAi: true;
  notes: string;
}

export class ProfileRegistry {
  private readonly byId = new Map<ProfileId, ResearchProfile>();

  constructor(profiles: readonly ResearchProfile[] = []) {
    for (const profile of profiles) this.register(profile);
  }

  register(profile: ResearchProfile): this {
    this.byId.set(profile.id, profile);
    return this;
  }

  get(id: ProfileId): ResearchProfile | null {
    return this.byId.get(id) ?? null;
  }

  require(id: ProfileId): ResearchProfile {
    const profile = this.byId.get(id);
    if (!profile) throw new Error(`Unknown research profile: ${id}`);
    return profile;
  }

  all(): ResearchProfile[] {
    return [...this.byId.values()];
  }

  /** Product codes these profiles need present in `billable_products`. */
  productCodes(): string[] {
    return [...new Set(this.all().map((p) => p.productCode).filter((c): c is string => !!c))];
  }
}
