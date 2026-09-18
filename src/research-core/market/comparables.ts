// HOMATCH RESEARCH CORE — deterministic comparable discovery.
//
// WHAT THIS REPLACES
//
// A model was handed "Research actual public listing/post URLs and
// comparables... Include MyHome, SS, Korter, developer/project/agency sites"
// and asked to go and look. It did its best, in prose, at multi-minute latency,
// and what came back could not be filtered, counted, deduplicated or traced,
// because it had never been structured in the first place.
//
// This lane asks a portal an exact question and reads the answer it publishes.
// Everything after the fetch — normalization, identity, conflicts, source
// independence — is arithmetic over structured records, which means it is
// testable, repeatable and explainable. The model still writes the report; it
// no longer does the looking.
//
// THE THREE COUNTS THAT MUST NEVER BE THE SAME NUMBER
//
//   advertisements          how many adverts were read
//   likely unique properties how many distinct flats those adverts describe
//   independent sources     how many unrelated publishers contributed
//
// Collapsing them is the failure this file exists to prevent. Five adverts for
// one flat on two portals is 5, 1 and 2 — never 5, 5 and 5.

import type { EvidenceLevel, Observation } from '../core/types.ts';
import { sha256Hex } from '../core/sha256.ts';
import { Deadline } from '../flow/deadline.ts';
import { Semaphore } from '../flow/semaphore.ts';
import { dedupeObservations } from '../score/document-dedupe.ts';
import { computeIndependence } from '../score/independence.ts';
import type { ResearchSeed } from '../plan/seed.ts';
import { buildComparableEnvelope, widenEnvelope } from '../plan/envelope.ts';
import type {
  AdapterContext,
  ListingQuery,
  PortalListing,
  PortalRegistry,
} from '../adapters/portal/types.ts';
import { compareListings, identityBlockKey, type IdentityVerdict } from './property-identity.ts';

/** How a single portal answered. Reported per source, never averaged away. */
export type PortalOutcomeState =
  | 'OK'
  | 'PARTIAL'
  | 'BLOCKED'
  | 'RATE_LIMITED'
  | 'LOGIN_WALL'
  | 'JOIN_REQUIRED'
  | 'UNAVAILABLE'
  | 'NOT_SUPPORTED'
  | 'DEADLINE';

export interface PortalOutcome {
  portalId: string;
  sourceFamily: string;
  state: PortalOutcomeState;
  listingsFound: number;
  totalAvailable: number | null;
  pagesFetched: number;
  networkRequests: number;
  serverFilters: string[];
  clientFilters: string[];
  unsupportedFilters: string[];
  detail: string | null;
  durationMs: number;
}

/** One distinct property, and every advert that describes it. */
export interface UniqueProperty {
  /** Deterministic id derived from the primary advert's canonical URL. */
  id: string;
  primary: PortalListing;
  /** Adverts confirmed to describe the same property. */
  crossPosted: PortalListing[];
  /** Adverts that probably describe it. Never merged into the count. */
  uncertain: PortalListing[];
  /** Distinct publisher families that carried this property. */
  sourceFamilies: string[];
  /**
   * Different prices for what appears to be one property. PRESERVED, never
   * averaged: this is Buyer Intelligence, not noise.
   */
  priceConflict: PriceConflict | null;
  /** Why these adverts were grouped, in one readable line. */
  groupingReason: string;
}

export interface PriceConflict {
  basis: string;
  currency: string;
  values: Array<{ amount: number; url: string; sourceFamily: string; retrievedAt: string }>;
  spreadPct: number;
}

export interface MarketEvidence {
  /** The envelope(s) that were actually executed. */
  queries: ListingQuery[];
  advertisements: PortalListing[];
  uniqueProperties: UniqueProperty[];
  uncertainDuplicateCount: number;
  crossPostedCount: number;
  independentSourceCount: number;
  observationCount: number;
  portals: PortalOutcome[];
  /** True when the deadline cut the lane short. The evidence is still valid. */
  truncatedByDeadline: boolean;
  networkRequests: number;
  /** Set when a widened envelope had to be used to find enough evidence. */
  widened: boolean;
  startedAt: string;
  finishedAt: string;
}

export interface DiscoverOptions {
  /** Hard bound. Whatever has arrived by then is the answer. */
  budgetMs?: number;
  /** Concurrent portal requests. Per-source limits live in HttpClient. */
  concurrency?: number;
  /** Minimum unique properties before the envelope is considered sufficient. */
  sufficientUniqueProperties?: number;
  limit?: number;
  now?: () => number;
}

export const DEFAULT_SUFFICIENT_UNIQUE = 5;

/**
 * How close to the subject this advert actually is.
 *
 * A comparable is never SAME_PROPERTY: it is, by construction, a DIFFERENT
 * property being used as context. The ladder below only ever says how near
 * that context sits, and it says it from what the portal published rather
 * than from how the search was phrased.
 */
export function evidenceLevelFor(
  listing: PortalListing,
  query: ListingQuery,
  subjectProject: string | null,
): EvidenceLevel {
  const project = listing.listing.projectName;
  if (subjectProject && project && norm(project) === norm(subjectProject)) return 'SAME_PROJECT';
  const wantedSub = query.subDistrict;
  const district = listing.listing.district;
  if (wantedSub && district && norm(district) === norm(wantedSub)) return 'MICRO_LOCATION';
  if (query.district && district && norm(district) === norm(query.district)) return 'DISTRICT';
  /*
   * A district the envelope did not ask for is not "district-level evidence".
   * When the portal could not be constrained to the subject's district, the
   * rows it returned are the wider market, and calling them DISTRICT would
   * overstate how close they are.
   */
  return 'COMPARABLE_SEGMENT';
}

const norm = (v: unknown): string => String(v ?? '').toLowerCase().trim();

/** A listing becomes an Observation so the shared scorers can read it. */
export async function toObservation(
  listing: PortalListing,
  evidenceLevel: EvidenceLevel = 'COMPARABLE_SEGMENT',
): Promise<Observation> {
  const l = listing.listing;
  const identity = [
    l.listingId ?? '',
    l.area ? String((l.area as { value: number }).value) : '',
    l.bedrooms ?? '',
    l.floor ?? '',
    l.sale?.amount ?? l.rent?.amount ?? '',
  ].join('|');

  return {
    id: `${listing.portalId}:${listing.externalId ?? (await sha256Hex(listing.url)).slice(0, 16)}`,
    requestedUrl: listing.url,
    fetchUrl: listing.url,
    canonicalIdentityUrl: listing.url,
    source: {
      sourceKey: `portal:${listing.sourceFamily}`,
      sourceFamily: listing.sourceFamily,
      kind: 'PROPERTY_PORTAL',
    },
    evidenceLevel,
    observedAt: l.publishedAt,
    retrievedAt: listing.retrievedAt,
    contentHash: await sha256Hex(identity),
    nearDuplicateFingerprint: null,
    structuredSourceId: listing.externalId,
    payload: {
      area: l.area ? (l.area as { value: number }).value : null,
      bedrooms: l.bedrooms,
      floor: l.floor,
      salePricePerSqm: l.salePricePerSqm,
      priceBasis: listing.priceBasis,
    },
    fieldOrigins: l.fieldOrigins,
    supportingText: l.title,
  };
}

function priceOf(listing: PortalListing): { amount: number; currency: string; basis: string } | null {
  const money = listing.listing.sale ?? listing.listing.rent ?? null;
  if (!money || !Number.isFinite(money.amount) || money.amount <= 0) return null;
  return { amount: money.amount, currency: money.currency, basis: money.basis };
}

/**
 * Different prices for one property, kept as a conflict.
 *
 * Only ever within ONE basis and ONE currency. An asking sale price and an
 * asking rent are not two opinions about the same number, and comparing them
 * would manufacture a conflict out of a category error.
 */
export function priceConflictFor(adverts: PortalListing[]): PriceConflict | null {
  const priced = adverts
    .map((a) => ({ advert: a, price: priceOf(a) }))
    .filter((x): x is { advert: PortalListing; price: NonNullable<ReturnType<typeof priceOf>> } => x.price !== null);
  if (priced.length < 2) return null;

  const basis = priced[0].price.basis;
  const currency = priced[0].price.currency;
  const comparable = priced.filter(
    (x) => x.price.basis === basis && x.price.currency === currency,
  );
  if (comparable.length < 2) return null;

  const amounts = comparable.map((x) => x.price.amount);
  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  if (min <= 0) return null;
  const spreadPct = ((max - min) / min) * 100;
  // Below this the two adverts are the same price written by two people.
  if (spreadPct < 1) return null;

  return {
    basis,
    currency,
    spreadPct: Math.round(spreadPct * 10) / 10,
    values: comparable.map((x) => ({
      amount: x.price.amount,
      url: x.advert.url,
      sourceFamily: x.advert.sourceFamily,
      retrievedAt: x.advert.retrievedAt,
    })),
  };
}

/**
 * Group adverts into properties.
 *
 * Blocked by district and rounded area so this stays linear in practice, and
 * every merge records the attributes that justified it.
 */
export function groupIntoProperties(adverts: readonly PortalListing[]): UniqueProperty[] {
  const blocks = new Map<string, PortalListing[]>();
  for (const advert of adverts) {
    const key = identityBlockKey(advert.listing);
    const bucket = blocks.get(key);
    if (bucket) bucket.push(advert);
    else blocks.set(key, [advert]);
  }

  const groups: UniqueProperty[] = [];
  for (const bucket of blocks.values()) {
    const assigned = new Set<number>();
    for (let i = 0; i < bucket.length; i += 1) {
      if (assigned.has(i)) continue;
      assigned.add(i);
      const primary = bucket[i];
      const crossPosted: PortalListing[] = [];
      const uncertain: PortalListing[] = [];
      const reasons: string[] = [];

      for (let j = i + 1; j < bucket.length; j += 1) {
        if (assigned.has(j)) continue;
        const decision = compareListings(primary.listing, bucket[j].listing);
        const verdict: IdentityVerdict = decision.verdict;
        if (verdict === 'SAME') {
          crossPosted.push(bucket[j]);
          assigned.add(j);
          reasons.push(decision.reason);
        } else if (verdict === 'UNCERTAIN') {
          uncertain.push(bucket[j]);
          // Deliberately NOT assigned: an uncertain match stays available as
          // its own property too, because forcing it either way loses the
          // very thing that makes it uncertain.
          reasons.push(`possible duplicate — ${decision.reason}`);
        }
      }

      const all = [primary, ...crossPosted];
      const families = Array.from(new Set(all.map((a) => a.sourceFamily))).sort();
      groups.push({
        id: primary.url,
        primary,
        crossPosted,
        uncertain,
        sourceFamilies: families,
        priceConflict: priceConflictFor([...all, ...uncertain]),
        groupingReason: reasons.length ? reasons.join('; ') : 'no other advert matched this property',
      });
    }
  }
  return groups;
}

/**
 * Run the deterministic market lane.
 *
 * The deadline is the contract: whatever arrived is returned, marked, and
 * usable. A portal that hangs costs its own slot and nothing else.
 */
export async function discoverComparables(
  seed: ResearchSeed,
  registry: PortalRegistry,
  context: AdapterContext,
  options: DiscoverOptions = {},
): Promise<MarketEvidence | null> {
  const now = options.now ?? (() => Date.now());
  const startedAt = new Date(now()).toISOString();
  const primary = buildComparableEnvelope(seed, { limit: options.limit ?? 40 });
  if (!primary) return null;

  const deadline = new Deadline(options.budgetMs ?? 25_000, now, now());
  const gate = new Semaphore(Math.max(1, options.concurrency ?? 2));
  const sufficient = options.sufficientUniqueProperties ?? DEFAULT_SUFFICIENT_UNIQUE;

  const queries: ListingQuery[] = [primary];
  const adverts: PortalListing[] = [];
  const outcomes: PortalOutcome[] = [];
  let networkRequests = 0;
  let widened = false;

  const runQuery = async (query: ListingQuery): Promise<void> => {
    const adapters = registry.for(query);
    if (!adapters.length) return;
    await Promise.all(
      adapters.map((adapter) =>
        gate.withPermit(async () => {
          if (deadline.hasExpired) {
            outcomes.push(emptyOutcome(adapter.id, adapter.sourceFamily, 'DEADLINE', 'budget spent before this source was reached'));
            return;
          }
          const began = now();
          try {
            const result = await adapter.searchListings(query, context);
            const durationMs = now() - began;
            if (!result.ok) {
              outcomes.push({
                ...emptyOutcome(adapter.id, adapter.sourceFamily, mapFailure(result.reason), result.detail ?? null),
                durationMs,
              });
              return;
            }
            networkRequests += result.value.networkRequests;
            adverts.push(...result.value.listings);
            outcomes.push({
              portalId: adapter.id,
              sourceFamily: adapter.sourceFamily,
              state: result.value.truncated ? 'PARTIAL' : 'OK',
              listingsFound: result.value.listings.length,
              totalAvailable: result.value.totalAvailable,
              pagesFetched: result.value.pagesFetched,
              networkRequests: result.value.networkRequests,
              serverFilters: result.value.appliedFilters.server,
              clientFilters: result.value.appliedFilters.client,
              unsupportedFilters: result.value.appliedFilters.unsupported,
              detail: null,
              durationMs,
            });
          } catch (error) {
            outcomes.push({
              ...emptyOutcome(
                adapter.id,
                adapter.sourceFamily,
                deadline.hasExpired ? 'DEADLINE' : 'UNAVAILABLE',
                String(error).slice(0, 200),
              ),
              durationMs: now() - began,
            });
          }
        }, deadline.signal),
      ),
    );
  };

  await runQuery(primary);

  let grouped = groupIntoProperties(adverts);
  // Only widen when the tight envelope genuinely could not characterise the
  // market — and say so, so the report never presents a loose comparable as a
  // close one.
  if (grouped.length < sufficient && !deadline.hasExpired) {
    const wider = widenEnvelope(primary);
    queries.push(wider);
    widened = true;
    await runQuery(wider);
    grouped = groupIntoProperties(dedupeByUrl(adverts));
  }

  const unique = dedupeByUrl(adverts);
  const subjectProject = seed.project.name?.value ?? null;
  const observations = await Promise.all(
    unique.map((advert) =>
      toObservation(
        advert,
        evidenceLevelFor(advert, queries.find((q) => q.id === advert.queryId) ?? primary, subjectProject),
      ),
    ),
  );
  const deduped = dedupeObservations(observations, {
    entityIdOf: (o) => (typeof o.structuredSourceId === 'string' ? o.structuredSourceId : null),
  });
  const independence = computeIndependence(deduped.observations, {
    // Three listings on one portal are three different properties. Without
    // this the whole portal would be discounted to a single voice.
    subjectOf: (o) => o.contentHash,
  });

  // cancel() expires the deadline by design, so whether the BUDGET ran out
  // has to be read before the timer is torn down. Reading it after would
  // report every completed run as truncated.
  const ranOutOfTime = deadline.hasExpired;
  deadline.cancel();

  return {
    queries,
    advertisements: unique,
    uniqueProperties: grouped,
    uncertainDuplicateCount: grouped.reduce((n, g) => n + g.uncertain.length, 0),
    crossPostedCount: grouped.reduce((n, g) => n + g.crossPosted.length, 0),
    independentSourceCount: independence.independentSourceCount,
    observationCount: independence.observationCount,
    portals: outcomes,
    truncatedByDeadline: ranOutOfTime,
    networkRequests,
    widened,
    startedAt,
    finishedAt: new Date(now()).toISOString(),
  };
}

function dedupeByUrl(adverts: readonly PortalListing[]): PortalListing[] {
  const seen = new Set<string>();
  const out: PortalListing[] = [];
  for (const advert of adverts) {
    if (seen.has(advert.url)) continue;
    seen.add(advert.url);
    out.push(advert);
  }
  return out;
}

function mapFailure(reason: string): PortalOutcomeState {
  if (reason === 'BLOCKED') return 'BLOCKED';
  if (reason === 'RATE_LIMITED') return 'RATE_LIMITED';
  if (reason === 'LOGIN_WALL') return 'LOGIN_WALL';
  if (reason === 'JOIN_REQUIRED') return 'JOIN_REQUIRED';
  if (reason === 'CAPABILITY_NOT_SUPPORTED') return 'NOT_SUPPORTED';
  return 'UNAVAILABLE';
}

function emptyOutcome(
  portalId: string,
  sourceFamily: string,
  state: PortalOutcomeState,
  detail: string | null,
): PortalOutcome {
  return {
    portalId,
    sourceFamily,
    state,
    listingsFound: 0,
    totalAvailable: null,
    pagesFetched: 0,
    networkRequests: 0,
    serverFilters: [],
    clientFilters: [],
    unsupportedFilters: [],
    detail,
    durationMs: 0,
  };
}
