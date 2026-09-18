// HOMATCH RESEARCH CORE — the discovery jobs.
//
// One engine, many jobs. The networking, caching, coalescing, scheduling,
// dedupe, provenance and evidence rules are shared and identical for all of
// them. What is NOT shared — and must never be — is the meaning of a valid
// result.
//
// THE DISTINCTION THIS FILE EXISTS FOR
//
//   "Looking to buy a 2BR in Tbilisi"          BUYER_SEARCH: yes
//                                              PROPERTY_SEARCH: no
//   "2BR for sale in Krtsanisi, $145,000"      PROPERTY_SEARCH: yes
//                                              BUYER_SEARCH: no
//
// It is enforced by `job.direction` here, `classifyDirection()` in
// signals/direction.ts, and a comparison of two enum values in the filter.
// Not by a prompt, and not by a final AI pass — both of those get it right
// most of the time, which for a filter means wrong often enough to invert a
// result set, differently on every run, with nothing to diff.
//
// REUSING WHAT ALREADY EXISTS
//
// The instruction that produced this file named MARKET_RESEARCH,
// VERIFY_RESEARCH and INVESTMENT_RESEARCH. None of the three is declared as a
// profile, because Homatch already has all three and a second name for one
// thing is two places to change it:
//
//   MARKET_RESEARCH      -> MARKET_COMPARABLES (./investment.ts)
//   VERIFY_RESEARCH      -> the research-agent five-stage pipeline, which
//                           owns research_jobs and is authoritative
//   INVESTMENT_RESEARCH  -> INVESTMENT_DEEP_RESEARCH (./investment.ts)
//
// `JOB_ALIASES` records the mapping so the vocabulary still resolves.

import type { ResearchObjective, ResearchProfile } from './types.ts';
import { ProfileRegistry } from './types.ts';
import { INVESTMENT_PROFILES } from './investment.ts';

/**
 * Discovery jobs have no reporting objectives in the Investment sense: they
 * return signals, not an established figure. The single objective below keeps
 * the coverage machinery honest — "we found nothing" is still an answer that
 * must be reported as NO_EVIDENCE rather than as an empty success.
 */
function signalObjective(id: string, notes: string): ResearchObjective {
  return {
    id,
    acceptedPriceBases: [],
    preferredLevels: ['MICRO_LOCATION', 'DISTRICT', 'COMPARABLE_SEGMENT'],
    gate: {
      // ONE independent source is enough for a discovery signal, and that is
      // not a lowered standard: a buyer who posts once has posted once, and
      // demanding two publishers would mean only syndicated leads qualify —
      // exactly backwards. Corroboration matters for a market FIGURE, which
      // is what the Investment profiles gate hard on.
      minIndependentSources: 1,
      minObservations: 1,
      maxEvidenceLevel: 'COMPARABLE_SEGMENT',
    },
    notes,
  };
}

const DEMAND_FRESHNESS = { window: 'LAST_14_DAYS' as const, includeUndated: false };
const SUPPLY_FRESHNESS = { window: 'LAST_30_DAYS' as const, includeUndated: false };

export const BUYER_SEARCH: ResearchProfile = {
  id: 'BUYER_SEARCH',
  // Homatch's existing lead product. NOT a new product code.
  productCode: 'FIND_CLIENTS',
  defaultWorkClass: 'INTERACTIVE_NORMAL',
  usefulWithoutAi: true,
  job: {
    direction: 'DEMAND',
    transaction: 'SALE',
    propertyTerms: ['apartment', 'house', 'commercial', 'property'],
    minDirectionConfidence: 0.6,
    rejectAgencyVoice: true,
    defaultFreshness: DEMAND_FRESHNESS,
    includeComments: true,
  },
  limits: { softDeadlineMs: 30_000, hardDeadlineMs: 90_000, maxDocuments: 200, maxSources: 40 },
  objectives: [
    signalObjective(
      'buyers.purchase_intent',
      'People stating an intention to BUY. A listing is not a buyer, however ' +
        'well it matches the location and the price band.',
    ),
  ],
  notes:
    'The highest-value comments in a housing group are usually replies under ' +
    'somebody else\'s listing, which is why includeComments is true — and why ' +
    'rejectAgencyVoice is too: half of those replies are agents.',
};

export const RENTER_SEARCH: ResearchProfile = {
  id: 'RENTER_SEARCH',
  productCode: 'FIND_CLIENTS',
  defaultWorkClass: 'INTERACTIVE_NORMAL',
  usefulWithoutAi: true,
  job: {
    direction: 'DEMAND',
    transaction: 'RENT',
    propertyTerms: ['apartment', 'house', 'property'],
    minDirectionConfidence: 0.6,
    rejectAgencyVoice: true,
    // Rental demand decays faster than purchase demand: somebody who needed a
    // flat three weeks ago has one.
    defaultFreshness: { window: 'LAST_7_DAYS', includeUndated: false },
    includeComments: true,
  },
  limits: { softDeadlineMs: 30_000, hardDeadlineMs: 90_000, maxDocuments: 200, maxSources: 40 },
  objectives: [
    signalObjective(
      'renters.rental_intent',
      'People stating rental demand. A "for rent" advertisement is the ' +
        'opposite of this and belongs to PROPERTY_SEARCH.',
    ),
  ],
  notes: 'Same shape as BUYER_SEARCH on the rent side, with a shorter window.',
};

export const PROPERTY_SEARCH: ResearchProfile = {
  id: 'PROPERTY_SEARCH',
  // Supply discovery feeds the product catalogue rather than a lead product,
  // and is not independently billable today.
  productCode: null,
  defaultWorkClass: 'INTERACTIVE_NORMAL',
  usefulWithoutAi: true,
  job: {
    direction: 'SUPPLY',
    transaction: 'ANY',
    propertyTerms: ['apartment', 'house', 'commercial', 'property'],
    minDirectionConfidence: 0.6,
    // An agency posting real inventory is exactly what was wanted here.
    rejectAgencyVoice: false,
    defaultFreshness: SUPPLY_FRESHNESS,
    // A comment is rarely the listing itself.
    includeComments: false,
  },
  limits: { softDeadlineMs: 30_000, hardDeadlineMs: 90_000, maxDocuments: 250, maxSources: 40 },
  objectives: [
    signalObjective(
      'supply.listings',
      'Actual inventory: something is being offered. A post saying "looking ' +
        'to buy a 2BR in Tbilisi" matches every keyword here and is not a ' +
        'property.',
    ),
  ],
  notes:
    'The mirror of BUYER_SEARCH, and the reason direction is a type. The two ' +
    'profiles share every line of infrastructure and agree on nothing about ' +
    'what counts as a result.',
};

export const LAND_SEARCH: ResearchProfile = {
  id: 'LAND_SEARCH',
  productCode: null,
  defaultWorkClass: 'INTERACTIVE_NORMAL',
  usefulWithoutAi: true,
  job: {
    direction: 'SUPPLY',
    transaction: 'SALE',
    // ONLY land. A land search that accepts an apartment is not a land search,
    // and the single-element list is what makes that structural.
    propertyTerms: ['land'],
    minDirectionConfidence: 0.6,
    rejectAgencyVoice: false,
    // Land moves slowly. A three-month-old plot listing is usually still a
    // plot; a three-month-old rental advert is not.
    defaultFreshness: { window: 'ANY', includeUndated: true },
    includeComments: false,
  },
  limits: { softDeadlineMs: 30_000, hardDeadlineMs: 120_000, maxDocuments: 200, maxSources: 30 },
  objectives: [
    signalObjective(
      'land.parcels',
      'Plots and parcels. Land has its own vocabulary in every language ' +
        '(ნაკვეთი, участок, arsa, أرض, מגרש, प्लॉट) and its own sources.',
    ),
  ],
  notes:
    'Deliberately the narrowest property-term list in the file, and the ' +
    'widest freshness window. Both differ from every other job, which is the ' +
    'point of per-job contracts.',
};

export const INVESTOR_SEARCH: ResearchProfile = {
  id: 'INVESTOR_SEARCH',
  productCode: 'FIND_CLIENTS',
  defaultWorkClass: 'INTERACTIVE_NORMAL',
  usefulWithoutAi: true,
  job: {
    direction: 'DEMAND',
    transaction: 'SALE',
    propertyTerms: ['apartment', 'commercial', 'land', 'property'],
    // Investment intent is stated more explicitly than ordinary purchase
    // intent, so the bar is higher: a vague "thinking about property" is not
    // an investor.
    minDirectionConfidence: 0.65,
    rejectAgencyVoice: true,
    defaultFreshness: DEMAND_FRESHNESS,
    includeComments: true,
  },
  limits: { softDeadlineMs: 30_000, hardDeadlineMs: 90_000, maxDocuments: 200, maxSources: 40 },
  objectives: [
    signalObjective(
      'investors.investment_intent',
      'Explicit investment demand — yield, rental return, portfolio. Not ' +
        'every buyer is an investor and the distinction is stated, not guessed.',
    ),
  ],
  notes:
    'Demand direction, like BUYER_SEARCH, with a higher confidence floor and ' +
    'commercial and land included.',
};

export const DEVELOPER_SEARCH: ResearchProfile = {
  id: 'DEVELOPER_SEARCH',
  productCode: null,
  defaultWorkClass: 'BACKGROUND',
  usefulWithoutAi: true,
  job: {
    direction: 'SUPPLY',
    transaction: 'SALE',
    propertyTerms: ['apartment', 'commercial', 'property'],
    minDirectionConfidence: 0.6,
    rejectAgencyVoice: false,
    defaultFreshness: { window: 'ANY', includeUndated: true },
    includeComments: false,
  },
  limits: { softDeadlineMs: 60_000, hardDeadlineMs: 240_000, maxDocuments: 300, maxSources: 40 },
  objectives: [
    signalObjective(
      'developers.primary_inventory',
      'Developers and their primary-market inventory. A developer\'s own ' +
        'price list is DEVELOPER_PRICE, never an asking resale price — see ' +
        'PriceBasis in core/types.ts.',
    ),
  ],
  notes:
    'Background by default: this is catalogue-building, and nobody is ' +
    'watching a spinner for four minutes. Identity verification of a ' +
    'discovered company stays with official-worker\'s ENREG workflows, which ' +
    'remain the only path to OFFICIAL evidence.',
};

export const JOB_PROFILES: readonly ResearchProfile[] = [
  BUYER_SEARCH,
  RENTER_SEARCH,
  PROPERTY_SEARCH,
  LAND_SEARCH,
  INVESTOR_SEARCH,
  DEVELOPER_SEARCH,
];

/**
 * Vocabulary that maps onto something Homatch already has.
 *
 * Resolving a name rather than declaring a duplicate profile is the whole
 * point: a caller may ask for MARKET_RESEARCH and get MARKET_COMPARABLES,
 * and there is still exactly one definition of what market research means.
 *
 * VERIFY_RESEARCH resolves to null on purpose. Verify is not a Research Core
 * profile: it is the research-agent five-stage pipeline, it owns
 * research_jobs, and it stays authoritative. Returning null is the honest
 * answer, and it is what stops somebody quietly reimplementing Verify here.
 */
export const JOB_ALIASES: Record<string, ResearchProfile | null> = {
  MARKET_RESEARCH: INVESTMENT_PROFILES.find((p) => p.id === 'MARKET_COMPARABLES') ?? null,
  INVESTMENT_RESEARCH: INVESTMENT_PROFILES.find((p) => p.id === 'INVESTMENT_DEEP_RESEARCH') ?? null,
  VERIFY_RESEARCH: null,
};

/** Every profile the core knows: discovery jobs plus Investment. */
export function researchProfileRegistry(): ProfileRegistry {
  return new ProfileRegistry([...JOB_PROFILES, ...INVESTMENT_PROFILES]);
}

/**
 * Resolve a job name, including the aliases.
 *
 * Returns null for a name that maps to a system outside the core (Verify), so
 * a caller has to handle that rather than receiving a plausible substitute.
 */
export function resolveJob(name: string): ResearchProfile | null {
  const registry = researchProfileRegistry();
  const direct = registry.all().find((profile) => profile.id === name);
  if (direct) return direct;
  if (name in JOB_ALIASES) return JOB_ALIASES[name] ?? null;
  return null;
}
