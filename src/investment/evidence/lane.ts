// HOMATCH INVESTMENT INTELLIGENCE — the market-evidence lane.
//
// THIS BUILDS NO CRAWLER, NO CACHE, NO SOURCE REGISTRY AND NO FETCH PATH.
//
// Every one of those already exists in src/research-core and is shared with
// Verify's own market lane. This file is a CONSUMER: it shapes an
// InvestmentContext into the core's ResearchSeed, asks discoverComparables
// for a sale sweep and a rent sweep, and reduces what comes back into the
// two things Investment Intelligence needs — a rent range and a sale range,
// each on ONE price basis, each with the support behind it.
//
// The pooling, the duplicate collapse, the independence weighting and the
// conflict preservation are all the core's own functions. Nothing here
// re-implements a statistic, and nothing here resolves a disagreement: a
// price conflict is counted and carried, never averaged away.
//
// TWO SWEEPS, NEVER ONE
//
// A rent envelope and a sale envelope are different questions with
// different price bases, and the core refuses to pool across bases for
// exactly the reason this product must respect: an asking rent and an
// asking sale price do not average into anything that exists. So they are
// two runs and two ranges, and the UI shows them as two.
//
// WHAT IT DELIBERATELY DOES NOT PRODUCE
//
// A market VALUE. The sale sweep establishes what comparable units are
// ASKING, which positions a price among listings and is not the same claim
// as what the property is worth. INVESTMENT_PRICE_CHECK's own notes in the
// core say this in more words; the range returned here carries its basis so
// no renderer can quietly drop the distinction.

import type { AdapterContext } from '../../research-core/discovery/adapter.ts';
import type { PortalRegistry } from '../../research-core/adapters/portal/types.ts';
import type { MarketEvidence } from '../../research-core/market/comparables.ts';
import { discoverComparables, toObservation } from '../../research-core/market/comparables.ts';
import { emptySeed, seeded, seedSupportsMarketSearch, type ResearchSeed } from '../../research-core/plan/seed.ts';
import type { EvidenceLevel, Observation } from '../../research-core/core/types.ts';
import { dedupeObservations } from '../../research-core/score/document-dedupe.ts';
import { computeIndependence, supportFor } from '../../research-core/score/independence.ts';
import { pool, type Pool } from '../../research-core/score/pooling.ts';
import { median as medianOf } from '../../research-core/normalize/numbers.ts';
import type { ResearchLanguage } from '../../research-core/discovery/lexicon.ts';
import type { InvestmentContext } from '../consultant/context.ts';
import type { EvidencePriceBasis, EvidenceRange } from './compare.ts';

/**
 * The languages an investment sweep looks in.
 *
 * Not the UI language. A flat in Tbilisi is advertised in Georgian, Russian
 * and English by different agents to different buyers, and a Georgian-only
 * sweep misses most of the expat rental market — which is exactly the
 * segment an investor asking about rental yield is buying into.
 */
export const INVESTMENT_RESEARCH_LANGUAGES: ResearchLanguage[] = ['ka', 'ru', 'en'];

export interface LaneSubject {
  city: string;
  district?: string | null;
  areaSqm?: number | null;
  rooms?: number | null;
  bedrooms?: number | null;
  propertyType?: string | null;
  projectName?: string | null;
  countryCode?: string | null;
}

/** Everything the caller has to know to decide whether a sweep is worth it. */
export function subjectFromContext(context: InvestmentContext): LaneSubject | null {
  const city = context.city?.value;
  if (!city) return null;
  return {
    city,
    district: context.district?.value ?? null,
    areaSqm: context.areaSqm?.value ?? null,
    rooms: context.rooms?.value ?? null,
    bedrooms: context.bedrooms?.value ?? null,
    propertyType: context.propertyType?.value ?? null,
    projectName: context.projectName?.value ?? null,
  };
}

/**
 * The subject, as a ResearchSeed the core already understands.
 *
 * Every value is marked with the evidence level that established it, and
 * for an investment consultation that level is honest about its source: the
 * investor told us, so it is SAME_PROPERTY evidence about the subject and
 * `origin` says where it came from. A value nobody supplied is absent, not
 * guessed — an absent area produces no area filter, while a wrong area
 * produces a confident envelope around the wrong property.
 */
export function buildInvestmentSeed(
  subject: LaneSubject,
  transaction: 'SALE' | 'RENT',
  subjectRef: string,
): ResearchSeed {
  const seed = emptySeed(subjectRef);
  const level: EvidenceLevel = 'SAME_PROPERTY';
  const origin = 'investment consultation';

  seed.location.countryCode = seeded(subject.countryCode ?? 'GE', level, origin);
  seed.location.city = seeded(subject.city, level, origin);
  seed.location.district = seeded(subject.district ?? null, level, origin);
  seed.property.propertyType = seeded(subject.propertyType ?? null, level, origin);
  seed.property.areaSqm = seeded(subject.areaSqm ?? null, level, origin);
  seed.property.rooms = seeded(subject.rooms ?? null, level, origin);
  seed.property.bedrooms = seeded(subject.bedrooms ?? null, level, origin);
  seed.project.name = seeded(subject.projectName ?? null, level, origin);
  seed.property.transaction = transaction;
  seed.languages = INVESTMENT_RESEARCH_LANGUAGES;
  return seed;
}

/** The core's own bar: a city alone is not a comparable set. */
export function subjectSupportsResearch(subject: LaneSubject): boolean {
  return seedSupportsMarketSearch(buildInvestmentSeed(subject, 'SALE', 'probe'));
}

export interface LaneOutcome {
  transaction: 'SALE' | 'RENT';
  /** Null when nothing usable came back. Never an empty fabricated range. */
  range: EvidenceRange | null;
  /** Per-portal outcomes, so a blocked source is visible rather than absent. */
  portals: Array<{ id: string; sourceFamily: string; state: string; found: number; detail: string | null }>;
  /** Individual adverts, for the evidence drawer. Capped. */
  comparables: Array<{
    url: string;
    sourceFamily: string;
    price: number | null;
    currency: string | null;
    pricePerSqm: number | null;
    areaSqm: number | null;
    rooms: number | null;
    bedrooms: number | null;
    floor: number | null;
    title: string | null;
    retrievedAt: string;
    /** Other adverts for what is probably the same property. */
    alsoListedAt: string[];
  }>;
  uniquePropertyCount: number;
  crossPostedCount: number;
  uncertainDuplicateCount: number;
  conflictCount: number;
  truncatedByDeadline: boolean;
  widened: boolean;
  networkRequests: number;
  startedAt: string;
  finishedAt: string;
  /** Set when the lane could not run at all, with the reason. */
  refusal: 'SUBJECT_TOO_BROAD' | 'NO_ADAPTER' | 'NO_EVIDENCE' | null;
}

const MAX_COMPARABLES_RETURNED = 40;

function basisFor(transaction: 'SALE' | 'RENT'): EvidencePriceBasis {
  return transaction === 'RENT' ? 'ASKING_RENT' : 'ASKING_SALE_PRICE';
}

/**
 * Reduce a sweep to ONE pooled range, using the core's own pooling.
 *
 * pool() refuses a mixed basis and a mixed currency rather than blending
 * them, so a sweep that returned both USD and GEL adverts produces a range
 * for the dominant currency and says how many observations it was built
 * from — which is more useful and far more honest than converting at a rate
 * this layer has no business choosing.
 */
async function poolRange(
  evidence: MarketEvidence,
  transaction: 'SALE' | 'RENT',
  field: EvidenceRange['field'],
): Promise<EvidenceRange | null> {
  const basis = basisFor(transaction);

  let periodAssumedMonthly = false;

  const priced = evidence.advertisements
    .map((advert) => {
      const money = transaction === 'RENT' ? advert.listing.rent : advert.listing.sale;
      if (!money || !Number.isFinite(money.amount) || money.amount <= 0) return null;
      if (money.basis !== basis) return null;
      if (transaction === 'RENT') {
        const period = advert.listing.rentPeriod;
        // A daily short-let rate pooled with monthly rents would overstate
        // the yield by roughly thirty times. An explicitly non-monthly
        // period is dropped; an UNSTATED one is kept and the assumption is
        // carried out to the customer on the range itself.
        if (period === 'DAY' || period === 'YEAR') return null;
        if (period === null) periodAssumedMonthly = true;
      }
      return { advert, money };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  if (!priced.length) return null;

  // One currency: the most common one. Mixing is refused by pool() anyway,
  // and picking the dominant one is better than returning nothing.
  const counts = new Map<string, number>();
  for (const entry of priced) counts.set(entry.money.currency, (counts.get(entry.money.currency) ?? 0) + 1);
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const inCurrency = priced.filter((entry) => entry.money.currency === currency);

  const observations: Observation[] = [];
  const poolInputs: Array<{ observation: Observation; value: { amount: number; currency: string; basis: typeof basis }; perSqm?: number | null }> = [];
  for (const entry of inCurrency) {
    const observation = await toObservation(entry.advert, 'MICRO_LOCATION');
    observations.push(observation);
    const area = entry.advert.listing.area as { value: number } | null | undefined;
    poolInputs.push({
      observation,
      value: { amount: entry.money.amount, currency, basis },
      perSqm: area && area.value > 0 ? entry.money.amount / area.value : null,
    });
  }

  const deduped = dedupeObservations(observations);
  const independence = computeIndependence(deduped.observations);
  const supportOf = (obs: readonly Observation[]) => supportFor(obs, independence);

  const result = pool(poolInputs as never, supportOf);
  if (!result.ok) return null;
  const p: Pool = result.pool;

  return {
    field,
    basis,
    currency: p.currency,
    low: p.p25,
    median: p.median,
    high: p.p75,
    evidenceLevel: p.evidenceLevel,
    observationCount: p.count,
    independentSourceCount: p.support.independentSourceCount,
    uniquePropertyCount: evidence.uniqueProperties.length,
    conflictCount: evidence.uniqueProperties.filter((u) => u.priceConflict !== null).length,
    retrievedAt: evidence.finishedAt,
    ...(periodAssumedMonthly ? { periodAssumedMonthly: true } : {}),
  };
}

export interface RunLaneOptions {
  budgetMs?: number;
  limit?: number;
  now?: () => number;
}

/**
 * One sweep, for one transaction type.
 *
 * Returns a LaneOutcome in every case including failure: a blocked portal,
 * a deadline, or an envelope that found nothing are all real answers the
 * customer should see, and returning null for all three would collapse
 * "the source refused us" into "there is nothing there".
 */
export async function runInvestmentLane(
  subject: LaneSubject,
  transaction: 'SALE' | 'RENT',
  registry: PortalRegistry,
  context: AdapterContext,
  options: RunLaneOptions = {},
): Promise<LaneOutcome> {
  const startedAt = new Date(options.now ? options.now() : Date.now()).toISOString();
  const empty = (refusal: LaneOutcome['refusal']): LaneOutcome => ({
    transaction,
    range: null,
    portals: [],
    comparables: [],
    uniquePropertyCount: 0,
    crossPostedCount: 0,
    uncertainDuplicateCount: 0,
    conflictCount: 0,
    truncatedByDeadline: false,
    widened: false,
    networkRequests: 0,
    startedAt,
    finishedAt: new Date(options.now ? options.now() : Date.now()).toISOString(),
    refusal,
  });

  if (!subjectSupportsResearch(subject)) return empty('SUBJECT_TOO_BROAD');

  const seed = buildInvestmentSeed(subject, transaction, `investment:${transaction.toLowerCase()}`);
  const evidence = await discoverComparables(seed, registry, context, {
    budgetMs: options.budgetMs ?? 20_000,
    limit: options.limit ?? 40,
  });
  if (!evidence) return empty('NO_ADAPTER');

  const field: EvidenceRange['field'] = transaction === 'RENT' ? 'monthlyRent' : 'askingPrice';
  const range = await poolRange(evidence, transaction, field);

  /*
   * CONFIRMED cross-posts only.
   *
   * `uncertain` adverts MIGHT be the same property. Listing one under "also
   * listed at" states that they are, which is a confident claim built on an
   * explicitly unconfirmed premise. The uncertainty is reported as a count
   * instead, which is where it belongs.
   */
  const alsoListed = new Map<string, string[]>();
  for (const unique of evidence.uniqueProperties) {
    const group = [unique.primary, ...unique.crossPosted];
    if (group.length < 2) continue;
    const urls = group.map((a) => a.url);
    for (const advert of group) {
      alsoListed.set(advert.url, urls.filter((u) => u !== advert.url));
    }
  }

  const comparables = evidence.advertisements.slice(0, MAX_COMPARABLES_RETURNED).map((advert) => {
    const money = transaction === 'RENT' ? advert.listing.rent : advert.listing.sale;
    const area = advert.listing.area as { value: number } | null | undefined;
    return {
      url: advert.url,
      sourceFamily: advert.sourceFamily,
      price: money?.amount ?? null,
      currency: money?.currency ?? null,
      pricePerSqm:
        money && area && area.value > 0 ? Math.round((money.amount / area.value) * 100) / 100 : null,
      areaSqm: area?.value ?? null,
      rooms: advert.listing.rooms ?? null,
      bedrooms: advert.listing.bedrooms ?? null,
      floor: advert.listing.floor ?? null,
      title: advert.listing.title ?? null,
      retrievedAt: advert.retrievedAt,
      alsoListedAt: alsoListed.get(advert.url) ?? [],
    };
  });

  return {
    transaction,
    range,
    portals: evidence.portals.map((p) => ({
      id: p.portalId,
      sourceFamily: p.sourceFamily,
      state: p.state,
      found: p.listingsFound,
      detail: p.detail,
    })),
    comparables,
    uniquePropertyCount: evidence.uniqueProperties.length,
    crossPostedCount: evidence.crossPostedCount,
    uncertainDuplicateCount: evidence.uncertainDuplicateCount,
    conflictCount: evidence.uniqueProperties.filter((u) => u.priceConflict !== null).length,
    truncatedByDeadline: evidence.truncatedByDeadline,
    widened: evidence.widened,
    networkRequests: evidence.networkRequests,
    startedAt: evidence.startedAt,
    finishedAt: evidence.finishedAt,
    refusal: range === null && comparables.length === 0 ? 'NO_EVIDENCE' : null,
  };
}

/**
 * The per-square-metre picture, which is how a Georgian market is quoted.
 *
 * Kept separate from the pooled range because it is a different statistic
 * over a different subset — only the adverts that published an area — and
 * silently folding it into the same object would let a caller read a
 * per-sqm median as though it had the same support as the price median.
 */
export function pricePerSqmSummary(
  comparables: LaneOutcome['comparables'],
): { median: number; count: number; currency: string } | null {
  const withArea = comparables.filter(
    (c) => c.pricePerSqm !== null && c.pricePerSqm > 0 && c.currency !== null,
  );
  if (withArea.length < 3) return null;
  const counts = new Map<string, number>();
  for (const c of withArea) counts.set(c.currency as string, (counts.get(c.currency as string) ?? 0) + 1);
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const values = withArea
    .filter((c) => c.currency === currency)
    .map((c) => c.pricePerSqm as number);
  if (values.length < 3) return null;
  const mid = medianOf(values);
  if (mid === null) return null;
  return {
    median: Math.round(mid * 100) / 100,
    count: values.length,
    currency,
  };
}
