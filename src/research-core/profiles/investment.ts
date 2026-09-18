// HOMATCH RESEARCH CORE — the Investment research contracts.
//
// CONTRACTS ONLY. No UI, no pricing, no execution. These say what each
// Investment question needs in order to be answerable, so that when the
// Investment product is built it inherits the honesty rules structurally
// instead of re-deriving them.
//
// Three rules are encoded here rather than written down:
//
//   1. Asking is not achieved. Every objective names the bases that answer it,
//      and no objective accepts both an asking and an achieved basis, because
//      accepting both is the same as converting between them.
//   2. A district median does not answer a question about one flat. Each
//      objective names the furthest level that still counts.
//   3. Days on market is not computable from a scrape. It is marked
//      permanently unavailable for this market, with the reason, so nothing
//      spends money re-checking it and nothing derives it from a first-seen
//      timestamp.
//
// PRODUCT CODES. Each profile names the `billable_products.code` it would run
// under. Those rows DO NOT EXIST YET and this file does not create them —
// creating a product row is a pricing decision, and pricing lives in the
// database with the rest of billing v2. The codes are declared so the future
// migration has something to match, and `ProfileRegistry.productCodes()`
// exists so a test can assert that no profile silently starts billing against
// a product nobody defined.

import type { ResearchProfile, ResearchObjective } from './types.ts';
import { ProfileRegistry } from './types.ts';

/** Shared floor: never report a market claim on a single publisher. */
const MARKET_GATE = {
  minIndependentSources: 2,
  minObservations: 3,
  maxEvidenceLevel: 'MICRO_LOCATION' as const,
};

const SEGMENT_GATE = {
  minIndependentSources: 2,
  minObservations: 5,
  maxEvidenceLevel: 'COMPARABLE_SEGMENT' as const,
};

/**
 * Days on market, stated as permanently unavailable.
 *
 * Georgian portals do not publish a listing date that survives an edit, and
 * "first time our crawler saw it" is a fact about the crawler. There is no
 * honest way to produce this number today, so the objective exists, is always
 * UNAVAILABLE, and says why. That is more useful than omitting it: a customer
 * who asks "how long do these take to sell" gets an answer, and the answer is
 * that nobody publishes it.
 */
const DAYS_ON_MARKET: ResearchObjective = {
  id: 'liquidity.days_on_market',
  acceptedPriceBases: [],
  preferredLevels: ['SAME_PROJECT', 'MICRO_LOCATION', 'DISTRICT'],
  gate: SEGMENT_GATE,
  knownUnavailable: {
    reason: 'SOURCE_DOES_NOT_PUBLISH_IT',
    note:
      'No Georgian portal publishes a stable listing date, and a first-seen ' +
      'crawl timestamp is a fact about the crawler rather than about the ' +
      'market. Reported only when a source states it explicitly.',
  },
  notes: 'Never derived. Only ever passed through from a source that states it.',
};

export const MARKET_COMPARABLES: ResearchProfile = {
  id: 'MARKET_COMPARABLES',
  productCode: 'MARKET_COMPARABLES',
  defaultWorkClass: 'INTERACTIVE_NORMAL',
  usefulWithoutAi: true,
  limits: {
    softDeadlineMs: 20_000,
    hardDeadlineMs: 45_000,
    maxDocuments: 60,
    maxSources: 8,
  },
  objectives: [
    {
      id: 'comparables.asking_sale',
      acceptedPriceBases: ['ASKING_SALE_PRICE'],
      preferredLevels: ['SAME_BUILDING', 'SAME_PROJECT', 'MICRO_LOCATION', 'DISTRICT'],
      gate: MARKET_GATE,
      notes: 'Listed sale prices. Reported as asking prices, never as values.',
    },
    {
      id: 'comparables.developer_price',
      acceptedPriceBases: ['DEVELOPER_PRICE'],
      preferredLevels: ['SAME_PROJECT', 'MICRO_LOCATION'],
      gate: { minIndependentSources: 1, minObservations: 1, maxEvidenceLevel: 'SAME_PROJECT' },
      notes:
        'A developer\'s own price list is first-party and needs only one source, ' +
        'but it is a primary-market price and is reported separately from resale.',
    },
    {
      id: 'comparables.transaction',
      acceptedPriceBases: ['TRANSACTION_PRICE'],
      preferredLevels: ['SAME_BUILDING', 'SAME_PROJECT', 'MICRO_LOCATION'],
      gate: { minIndependentSources: 1, minObservations: 1, maxEvidenceLevel: 'MICRO_LOCATION' },
      knownUnavailable: {
        reason: 'SOURCE_DOES_NOT_PUBLISH_IT',
        note:
          'Georgia\'s Public Registry does not publish transaction prices in a ' +
          'form public research can read. Included so the gap is visible rather ' +
          'than filled in with asking prices.',
      },
      notes: 'Recorded sale prices. Never inferred from a listing that disappeared.',
    },
  ],
  notes:
    'The comparable set other Investment profiles build on. Each basis is a ' +
    'separate objective so no caller can pool them by accident.',
};

export const INVESTMENT_PRICE_CHECK: ResearchProfile = {
  id: 'INVESTMENT_PRICE_CHECK',
  productCode: 'INVESTMENT_PRICE_CHECK',
  defaultWorkClass: 'INTERACTIVE_HIGH',
  usefulWithoutAi: true,
  limits: {
    softDeadlineMs: 25_000,
    hardDeadlineMs: 55_000,
    maxDocuments: 80,
    maxSources: 10,
  },
  objectives: [
    {
      id: 'price_check.subject_asking',
      acceptedPriceBases: ['ASKING_SALE_PRICE', 'DEVELOPER_PRICE'],
      preferredLevels: ['SAME_PROPERTY'],
      gate: { minIndependentSources: 1, minObservations: 1, maxEvidenceLevel: 'SAME_PROPERTY' },
      notes:
        'The subject\'s own price. SAME_PROPERTY only — a price from the ' +
        'building next door is not this flat\'s price at any confidence.',
    },
    {
      id: 'price_check.peer_asking',
      acceptedPriceBases: ['ASKING_SALE_PRICE'],
      preferredLevels: ['SAME_BUILDING', 'SAME_PROJECT', 'MICRO_LOCATION'],
      gate: MARKET_GATE,
      notes: 'What comparable units are asking, on the same basis as the subject.',
    },
  ],
  notes:
    'Positions an asking price against other asking prices. It does NOT ' +
    'produce a valuation: an asking price compared to asking prices says where ' +
    'the listing sits among listings, and calling that a value would be the ' +
    'conversion this core exists to prevent.',
};

export const INVESTMENT_RENT_CHECK: ResearchProfile = {
  id: 'INVESTMENT_RENT_CHECK',
  productCode: 'INVESTMENT_RENT_CHECK',
  defaultWorkClass: 'INTERACTIVE_HIGH',
  usefulWithoutAi: true,
  limits: {
    softDeadlineMs: 25_000,
    hardDeadlineMs: 55_000,
    maxDocuments: 80,
    maxSources: 10,
  },
  objectives: [
    {
      id: 'rent.asking',
      acceptedPriceBases: ['ASKING_RENT'],
      preferredLevels: ['SAME_BUILDING', 'SAME_PROJECT', 'MICRO_LOCATION', 'DISTRICT'],
      gate: MARKET_GATE,
      notes: 'Advertised rents. This is what the public web can establish.',
    },
    {
      id: 'rent.achieved',
      acceptedPriceBases: ['ACHIEVED_RENT'],
      preferredLevels: ['SAME_BUILDING', 'SAME_PROJECT'],
      gate: { minIndependentSources: 1, minObservations: 1, maxEvidenceLevel: 'SAME_PROJECT' },
      knownUnavailable: {
        reason: 'SOURCE_DOES_NOT_PUBLISH_IT',
        note:
          'Rents actually paid are private. They are not derivable from asking ' +
          'rents by any discount, and this objective stays UNAVAILABLE rather ' +
          'than being answered with one.',
      },
      notes: 'A separate objective precisely so it can never be filled by rent.asking.',
    },
  ],
  notes:
    'Yield arithmetic built on rent.asking must be labelled a GROSS ASKING ' +
    'yield by whatever presents it. This profile does not compute yield; it ' +
    'establishes the two rent bases separately and keeps them separate.',
};

export const INVESTMENT_MARKET_MOVEMENT: ResearchProfile = {
  id: 'INVESTMENT_MARKET_MOVEMENT',
  productCode: 'INVESTMENT_MARKET_MOVEMENT',
  defaultWorkClass: 'BACKGROUND',
  usefulWithoutAi: true,
  limits: {
    softDeadlineMs: 40_000,
    hardDeadlineMs: 120_000,
    maxDocuments: 150,
    maxSources: 12,
  },
  objectives: [
    {
      id: 'movement.asking_sale_over_time',
      acceptedPriceBases: ['ASKING_SALE_PRICE'],
      preferredLevels: ['SAME_PROJECT', 'MICRO_LOCATION', 'DISTRICT', 'COMPARABLE_SEGMENT'],
      gate: SEGMENT_GATE,
      notes:
        'Direction of asking prices. Requires dated observations: an undated ' +
        'price contributes to a level, never to a trend.',
    },
    {
      id: 'movement.asking_rent_over_time',
      acceptedPriceBases: ['ASKING_RENT'],
      preferredLevels: ['MICRO_LOCATION', 'DISTRICT', 'COMPARABLE_SEGMENT'],
      gate: SEGMENT_GATE,
      notes: 'Direction of asking rents, on the asking basis only.',
    },
  ],
  notes:
    'Movement is measured within one basis and one level. A series that ' +
    'silently changes level halfway through is not a trend, it is two ' +
    'different questions plotted on one axis.',
};

export const INVESTMENT_LIQUIDITY: ResearchProfile = {
  id: 'INVESTMENT_LIQUIDITY',
  productCode: 'INVESTMENT_LIQUIDITY',
  defaultWorkClass: 'BACKGROUND',
  usefulWithoutAi: true,
  limits: {
    softDeadlineMs: 30_000,
    hardDeadlineMs: 90_000,
    maxDocuments: 100,
    maxSources: 10,
  },
  objectives: [
    DAYS_ON_MARKET,
    {
      id: 'liquidity.active_supply',
      acceptedPriceBases: [],
      preferredLevels: ['SAME_PROJECT', 'MICRO_LOCATION', 'DISTRICT'],
      gate: SEGMENT_GATE,
      notes:
        'How many comparable units are on the market at once. Countable from ' +
        'listings, and the honest half of liquidity.',
    },
  ],
  notes:
    'Deliberately shipped with its headline objective permanently ' +
    'UNAVAILABLE. Supply is real and countable; time-to-sell is not, and a ' +
    'liquidity product that invents one would be worse than no product.',
};

export const INVESTMENT_DEEP_RESEARCH: ResearchProfile = {
  id: 'INVESTMENT_DEEP_RESEARCH',
  productCode: 'INVESTMENT_DEEP_RESEARCH',
  defaultWorkClass: 'BACKGROUND',
  usefulWithoutAi: true,
  limits: {
    softDeadlineMs: 120_000,
    hardDeadlineMs: 600_000,
    maxDocuments: 400,
    maxSources: 20,
  },
  objectives: [
    ...MARKET_COMPARABLES.objectives,
    ...INVESTMENT_RENT_CHECK.objectives,
    ...INVESTMENT_MARKET_MOVEMENT.objectives,
    ...INVESTMENT_LIQUIDITY.objectives,
  ],
  notes:
    'The union, run on the BACKGROUND class with a long deadline. Nobody is ' +
    'watching a spinner for ten minutes, so it must never occupy an ' +
    'interactive slot.',
};

export const INVESTMENT_PROFILES: readonly ResearchProfile[] = [
  MARKET_COMPARABLES,
  INVESTMENT_PRICE_CHECK,
  INVESTMENT_RENT_CHECK,
  INVESTMENT_MARKET_MOVEMENT,
  INVESTMENT_LIQUIDITY,
  INVESTMENT_DEEP_RESEARCH,
];

export function investmentProfileRegistry(): ProfileRegistry {
  return new ProfileRegistry(INVESTMENT_PROFILES);
}
