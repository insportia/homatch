// HOMATCH FOR EXPATS — the vocabulary.
//
// A foreigner reading this product is being asked to make expensive,
// irreversible decisions about a country they have never lived in. Almost
// every sentence the product says is a claim about a changing world: a fee
// that was raised last spring, a rule that applies to some nationalities and
// not others, a rent that was observed in one district on one day.
//
// So the types here are built around one idea: A FACT WITHOUT ITS PROVENANCE
// IS NOT A FACT THIS PRODUCT IS ALLOWED TO STATE. Every changing value in
// the model carries where it came from, when it was seen, and whether the
// source was official. There is deliberately no shape in this file that can
// express "the residence fee is 210 GEL" without also expressing who said so
// and when.
//
// THREE THINGS THAT ARE NOT THE SAME, AND ARE NEVER COLLAPSED
//
//   A REAL-WORLD NEGATIVE   the world says no. Foreigners may not buy
//                           agricultural land: that is a rule, sourced.
//   UNKNOWN                 nobody has established it either way.
//   COVERAGE_GAP            our research could not reach enough sources.
//
// The third is an internal condition of our crawler and it must never be
// rendered as either of the first two. "We found no reputable lawyers" is a
// statement about Georgia; "we could not read enough sources to say" is a
// statement about us. Section 36 of the product brief exists because these
// get confused, and `Availability` below is the type that keeps them apart.
//
// WHAT THIS FILE DOES NOT CONTAIN
//
// No customer-facing English. Everything here is a code or a datum; the
// wording lives in the i18n bundle across six languages, and the evidence
// text stays in whatever language its source published it in. That is the
// same rule `src/research-core` keeps, for the same reason.

/* ── Where a statement sits in the hierarchy of authority ─────────────── */

/**
 * The four registers a FOR EXPATS statement can be in, in descending order
 * of authority for anything legal, fiscal or administrative.
 *
 * The ordering matters and is enforced, not merely documented: a forum post
 * describing how somebody actually got their residence permit is genuinely
 * useful and genuinely subordinate to the decree. `outranks()` is the only
 * place that comparison is made.
 */
export const AUTHORITY_REGISTERS = [
  /** A law, decree, official fee schedule, or a government agency's own page. */
  'OFFICIAL_REQUIREMENT',
  /** How the process actually runs in practice. Reputable, non-binding. */
  'PRACTICAL_CONTEXT',
  /** What people report from experience. Context only; never a rule. */
  'COMMUNITY_EXPERIENCE',
  /** Our own arithmetic or synthesis over the above, labelled as ours. */
  'HOMATCH_ANALYSIS',
] as const;

export type AuthorityRegister = (typeof AUTHORITY_REGISTERS)[number];

/** True when `a` carries more authority than `b`. */
export function outranks(a: AuthorityRegister, b: AuthorityRegister): boolean {
  return AUTHORITY_REGISTERS.indexOf(a) < AUTHORITY_REGISTERS.indexOf(b);
}

/**
 * Whether a community claim is permitted to displace an official one.
 *
 * It never is. The function exists so the rule has one implementation and a
 * test can point at it, rather than being an assumption spread across the
 * synthesis code.
 */
export function mayOverride(claim: AuthorityRegister, existing: AuthorityRegister): boolean {
  if (existing === 'OFFICIAL_REQUIREMENT') return claim === 'OFFICIAL_REQUIREMENT';
  return outranks(claim, existing);
}

/* ── Availability: the distinction §36 is about ───────────────────────── */

export const AVAILABILITY = [
  /** Established, with evidence attached. */
  'ESTABLISHED',
  /** Established as absent or prohibited IN THE WORLD, with evidence. */
  'ESTABLISHED_NEGATIVE',
  /** Nobody has established it. Honest ignorance. */
  'UNKNOWN',
  /** Our research could not reach enough sources. A fact about US. */
  'COVERAGE_GAP',
  /** We had it, and it is now too old to repeat without rechecking. */
  'STALE',
] as const;

export type Availability = (typeof AVAILABILITY)[number];

/**
 * May this availability be presented to a customer as a statement about
 * the world?
 *
 * Only the two ESTABLISHED forms may. The rest describe the state of our
 * knowledge and must be rendered as such.
 */
export function isWorldClaim(a: Availability): boolean {
  return a === 'ESTABLISHED' || a === 'ESTABLISHED_NEGATIVE';
}

/* ── Provenance ───────────────────────────────────────────────────────── */

/**
 * Where something came from.
 *
 * `url` is nullable because an official fee read off a printed schedule at
 * a Public Service Hall is still a source; `publisher` never is, because a
 * claim whose publisher we cannot name is a claim we do not make.
 */
export interface SourceRef {
  /** Stable id, so the same source cited twice counts once. */
  sourceId: string;
  /** Who published it, in their own name. Not translated. */
  publisher: string;
  url: string | null;
  /** True only for a government body, regulator, or the legal text itself. */
  official: boolean;
  /** ISO date the source itself carries, where it carries one. */
  publishedOn: string | null;
  /**
   * When the law/fee/rule TAKES EFFECT, where the source states it.
   * Distinct from publishedOn: a decree published in March can take effect
   * in September, and a foreigner planning a move needs the second date.
   */
  effectiveFrom: string | null;
  /** ISO timestamp we last read it. */
  observedAt: string;
  /** The language the source published in. Evidence is kept in it. */
  language: string;
}

/**
 * How much confidence the passage of time still permits.
 *
 * Deliberately a judgement about AGE ALONE. Whether a fact was ever right is
 * a different question, answered by its sources; this only answers "how long
 * ago did we look".
 */
export const FRESHNESS = ['FRESH', 'AGEING', 'STALE', 'UNKNOWN'] as const;
export type Freshness = (typeof FRESHNESS)[number];

/**
 * How long a class of fact stays believable without rechecking.
 *
 * These are review intervals, not expiry dates: a residence rule does not
 * become false on day 91. They decide when the product stops presenting
 * something as current and starts saying when it last checked.
 *
 * Legal and fee information is deliberately the shortest. It is the
 * information a foreigner is most likely to act on and the most expensive
 * to get wrong.
 */
export const REVIEW_INTERVAL_DAYS: Record<FactClass, number> = {
  LEGAL: 90,
  FEE: 90,
  DEADLINE: 90,
  PROCESS: 180,
  PRICE: 120,
  MARKET: 45,
  GENERAL: 365,
};

export const FACT_CLASSES = [
  'LEGAL',
  'FEE',
  'DEADLINE',
  'PROCESS',
  'PRICE',
  'MARKET',
  'GENERAL',
] as const;
export type FactClass = (typeof FACT_CLASSES)[number];

/** Age in whole days between an ISO timestamp and `now`. */
export function ageInDays(observedAt: string, now: number = Date.now()): number | null {
  const t = Date.parse(observedAt);
  if (!Number.isFinite(t)) return null;
  return Math.floor((now - t) / 86_400_000);
}

/**
 * Freshness from age and class.
 *
 * AGEING begins at two thirds of the review interval so the review queue has
 * somewhere to draw from before anything is actually stale.
 */
export function judgeFreshness(
  observedAt: string | null | undefined,
  factClass: FactClass,
  now: number = Date.now(),
): Freshness {
  if (!observedAt) return 'UNKNOWN';
  const age = ageInDays(observedAt, now);
  if (age === null || age < 0) return 'UNKNOWN';
  const interval = REVIEW_INTERVAL_DAYS[factClass];
  if (age >= interval) return 'STALE';
  if (age >= Math.floor((interval * 2) / 3)) return 'AGEING';
  return 'FRESH';
}

/* ── A stated fact ────────────────────────────────────────────────────── */

/**
 * One claim the product is prepared to make, with everything needed to
 * defend it.
 *
 * `valueKey` and `vars` rather than a string: the sentence is assembled in
 * the reader's language by the i18n layer. A `Fact` carrying English prose
 * would be a seventh translation path, which is exactly the bug the mortgage
 * rendering contract was written to end.
 */
export interface Fact {
  id: string;
  factClass: FactClass;
  register: AuthorityRegister;
  availability: Availability;
  /** i18n key for the statement. Absent when availability is not a claim. */
  valueKey: string | null;
  /** Substitutions for the key. Numbers stay numbers until formatted. */
  vars?: Record<string, string | number>;
  sources: SourceRef[];
  /**
   * Which nationalities this applies to, as ISO 3166-1 alpha-2, or null
   * for "everyone". Never an empty array — that would read as "nobody" and
   * is almost always a data-entry slip for null.
   */
  appliesToNationalities: string[] | null;
  /** Set when a human must look before this is shown as current again. */
  needsReview: boolean;
}

/** The most authoritative register among a fact's sources. */
export function strongestSource(fact: Fact): SourceRef | null {
  if (fact.sources.length === 0) return null;
  const official = fact.sources.filter((s) => s.official);
  const pool = official.length > 0 ? official : fact.sources;
  return pool.reduce((best, s) => (s.observedAt > best.observedAt ? s : best), pool[0]);
}

/** Freshness of a fact, judged from the most recently observed source. */
export function factFreshness(fact: Fact, now: number = Date.now()): Freshness {
  if (fact.sources.length === 0) return 'UNKNOWN';
  const newest = fact.sources.reduce((a, b) => (a.observedAt > b.observedAt ? a : b));
  return judgeFreshness(newest.observedAt, fact.factClass, now);
}

/**
 * Does this fact apply to a person of this nationality?
 *
 * An unknown nationality does NOT hide nationality-specific facts — it shows
 * them with their applicability visible. Hiding a rule because we have not
 * asked where somebody is from would silently answer a legal question by
 * omission, which is the failure mode §50 names.
 */
export function appliesTo(fact: Fact, nationality: string | null): 'YES' | 'NO' | 'DEPENDS' {
  if (fact.appliesToNationalities === null) return 'YES';
  if (!nationality) return 'DEPENDS';
  return fact.appliesToNationalities.includes(nationality.toUpperCase()) ? 'YES' : 'NO';
}

/* ── Money, as actually observed ──────────────────────────────────────── */

/**
 * An observed amount or range.
 *
 * A range with a sample count, not a single number, because "rent in Vake is
 * 1,340 GEL" is false precision over a handful of listings and a foreigner
 * will budget against it. `low === high` is allowed for a published official
 * fee, which genuinely is one number.
 */
export interface ObservedMoney {
  low: number;
  high: number;
  currency: string;
  /** What one unit of the amount buys: a month, a visit, a square metre. */
  unit: MoneyUnit;
  /** How many independent observations the range rests on. */
  sampleSize: number;
  /** How many distinct sources those observations came from. */
  sourceCount: number;
  observedAt: string;
  /** City or district the observation belongs to. */
  locality: string | null;
}

export const MONEY_UNITS = [
  'PER_MONTH',
  'PER_YEAR',
  'ONE_OFF',
  'PER_SQM',
  'PER_VISIT',
  'PER_ITEM',
] as const;
export type MoneyUnit = (typeof MONEY_UNITS)[number];

/** True when the range is wide enough that quoting a midpoint would mislead. */
export function isWideRange(m: ObservedMoney): boolean {
  if (m.low <= 0) return m.high > 0;
  return m.high / m.low >= 1.5;
}

/**
 * The midpoint, for arithmetic only.
 *
 * Returns the midpoint of the range and nothing else — no rounding to a
 * pleasing number, because a budget total built from prettified inputs is a
 * number nobody can reproduce. Display code shows the RANGE; only the
 * summing engine uses this.
 */
export function midpoint(m: ObservedMoney): number {
  return (m.low + m.high) / 2;
}

/* ── Intents ──────────────────────────────────────────────────────────── */

/**
 * Why somebody is here.
 *
 * A person may hold several at once — an investor who also intends to move
 * is ordinary — so these are a set, never a funnel. The roadmap engine reads
 * the set; nothing forces a single choice.
 */
export const EXPAT_INTENTS = [
  'MOVE',
  'LIVE',
  'BUY',
  'INVEST',
  'BUSINESS',
  'FAMILY',
  'STUDY',
  'RETIRE',
] as const;
export type ExpatIntent = (typeof EXPAT_INTENTS)[number];

/** The four front-door pathways. A presentation grouping over intents. */
export const EXPAT_PATHWAYS = ['MOVE', 'LIVE', 'BUY', 'INVEST'] as const;
export type ExpatPathway = (typeof EXPAT_PATHWAYS)[number];

/* ── Who is asking ────────────────────────────────────────────────────── */

/**
 * Everything the plan engine is allowed to personalise on.
 *
 * Every field is optional and every field is asked for only at the moment it
 * changes an answer (§40). A profile that is entirely empty must still
 * produce a usable roadmap, and `roadmapFor` is tested on exactly that.
 */
export interface ExpatProfile {
  intents: ExpatIntent[];
  /** ISO 3166-1 alpha-2. The one field that can change a legal answer. */
  nationality: string | null;
  currentCountry: string | null;
  household: Household | null;
  childrenCount: number | null;
  pets: boolean | null;
  /** ISO date. Drives the relative timing of the whole roadmap. */
  arrivalDate: string | null;
  intendedStayMonths: number | null;
  city: string | null;
  workStatus: WorkStatus | null;
  housingPlan: HousingPlan | null;
  /** True for someone who already owns Georgian property (§61). */
  alreadyOwnsProperty: boolean | null;
  hasVehicle: boolean | null;
  /** The currency they think in. Not necessarily the one they will spend. */
  homeCurrency: string | null;
}

export const HOUSEHOLDS = ['ALONE', 'COUPLE', 'FAMILY'] as const;
export type Household = (typeof HOUSEHOLDS)[number];

export const WORK_STATUSES = [
  'REMOTE',
  'EMPLOYED_LOCALLY',
  'BUSINESS_OWNER',
  'STUDENT',
  'RETIRED',
  'NOT_WORKING',
] as const;
export type WorkStatus = (typeof WORK_STATUSES)[number];

export const HOUSING_PLANS = ['RENT', 'BUY', 'ALREADY_OWN', 'UNDECIDED'] as const;
export type HousingPlan = (typeof HOUSING_PLANS)[number];

/** An empty profile. The starting point, and a valid input everywhere. */
export const EMPTY_PROFILE: ExpatProfile = {
  intents: [],
  nationality: null,
  currentCountry: null,
  household: null,
  childrenCount: null,
  pets: null,
  arrivalDate: null,
  intendedStayMonths: null,
  city: null,
  workStatus: null,
  housingPlan: null,
  alreadyOwnsProperty: null,
  hasVehicle: null,
  homeCurrency: null,
};

/* ── Research status, borrowed rather than reinvented ─────────────────── */

/**
 * The honest states a research run can end in (§69).
 *
 * BLOCKED and INACCESSIBLE are separated on purpose: the first is a source
 * that told us no (robots, a login wall), the second is one we could not
 * reach at all. They lead to different operator action and neither is a
 * finding about the subject.
 */
export const EXPAT_RESEARCH_STATUS = [
  'LIVE_PROVEN',
  'PARTIAL',
  'BLOCKED',
  'INACCESSIBLE',
  'NO_EVIDENCE',
  'STALE',
  'NEEDS_REVIEW',
] as const;
export type ExpatResearchStatus = (typeof EXPAT_RESEARCH_STATUS)[number];

/** True when the run reached enough sources for its output to mean anything. */
export function statusIsConclusive(s: ExpatResearchStatus): boolean {
  return s === 'LIVE_PROVEN' || s === 'PARTIAL';
}
