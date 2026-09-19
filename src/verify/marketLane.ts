// HOMATCH VERIFY — the deterministic market lane, as the report sees it.
//
// WHERE THIS RUNS, AND WHY THERE
//
// It runs WHILE the official browser worker is still going. That is the whole
// point. The registry work takes minutes and cannot be hurried; the market
// question can be answered in seconds and used to be queued behind it, so a
// customer who wanted to know whether a price was reasonable waited for a
// cadastral traversal to finish before anyone even started looking.
//
// Nothing is reordered and no stage is skipped: the lane simply uses the time
// that was already being spent waiting.
//
// WHAT IT HANDS THE REST OF THE PIPELINE
//
// Comparables in the EXACT shape the report already uses — same keys, same
// string formatting, same comparableType vocabulary — so the synthesis
// contract and every renderer downstream are untouched. The MARKET stage then
// receives them as established evidence instead of a instruction to go
// searching, which is the actual replacement of AI broad research.
//
// It also writes `_marketLane`: the counters the progressive UI reads. Those
// are internal and are stripped from the customer payload like every other
// underscore-prefixed key.

import { discoverComparables, type MarketEvidence, type UniqueProperty } from '../research-core/market/comparables.ts';
import type { PortalRegistry } from '../research-core/adapters/portal/types.ts';
import type { AdapterContext } from '../research-core/discovery/adapter.ts';
import { seedSupportsMarketSearch, type ResearchSeed } from '../research-core/plan/seed.ts';
import { buildDiscoveryPlan } from '../research-core/market/discoveryPlan.ts';
import {
  runDiscovery,
  type DiscoverySubjectGeo,
  type SearchProvider,
  type SearchStatus,
} from '../research-core/market/discoveryRun.ts';
import type { GeoTier } from '../research-core/market/geoTier.ts';

/** The report's own comparable shape. Strings, because that is what it uses. */
export interface ReportComparable {
  source: string;
  url: string | null;
  listingId: string | null;
  project: string | null;
  address: string | null;
  area: string | null;
  rooms: string | null;
  floor: string | null;
  condition: string | null;
  /**
   * ACTIVE / EXPIRED / REMOVED / SOLD / UNKNOWN.
   *
   * Only ACTIVE + RESIDENTIAL comparables may drive a CURRENT price range —
   * `computeMarketRanges` filters on exactly this, so a comparable without it
   * is silently excluded from the median and the market positioning.
   */
  listingStatus: 'ACTIVE' | 'EXPIRED' | 'REMOVED' | 'SOLD' | 'UNKNOWN';
  propertyType: 'RESIDENTIAL' | 'COMMERCIAL' | 'LAND' | 'OTHER' | null;
  price: string | null;
  currency: string | null;
  pricePerSqm: string | null;
  listingDate: string | null;
  similarity: string | null;
  retrievedAt: string | null;
  comparableType: 'SAME_PROJECT' | 'MICRO_LOCATION' | 'PEER_PROJECT';
  /** How this advert was found. Present so a reader can check the claim. */
  discoveryMethod: 'DETERMINISTIC_PORTAL_SEARCH';
  /** Other adverts for the same property, and their prices. */
  alsoListedAt?: Array<{ url: string; source: string; price: string | null }>;
}

/** The counters sections.ts reads. Internal; never shown to a customer raw. */
export interface MarketLaneSummary {
  advertisements: number;
  uniqueProperties: number;
  crossPosted: number;
  uncertainDuplicates: number;
  independentSourceCount: number;
  observationCount: number;
  priceConflicts: number;
  widened: boolean;
  truncatedByDeadline: boolean;
  networkRequests: number;
  blockedSources: string[];
  portals: Array<{ id: string; state: string; found: number; detail: string | null }>;
  queries: Array<{ id: string; rationale: string }>;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  /*
   * WHAT THE SEARCH-ENGINE DISCOVERY LANE DID, OR WHY IT DID NOT RUN.
   *
   * The Villion report said 0 same-project, 0 same-street, 0 microlocation for
   * a street the public index carries hundreds of listings on. The portal lane
   * above asks portals it already knows, by district id; it cannot find a
   * source nobody registered, and a source that answers 403 to a crawler looks
   * to it exactly like a source with no inventory.
   *
   * This carries the second lane's ledger so the difference is legible:
   * a provider that was locked is `providerStatus: 'PROVIDER_LOCKED'`, which is
   * a statement about us, and must never be rendered as a statement about the
   * market. Internal only — section 15 forbids any of it reaching a buyer.
   */
  discovery?: {
    provider: string;
    providerStatus: SearchStatus;
    queriesExecuted: number;
    rawUrlsDiscovered: number;
    domainsDiscovered: number;
    domainsNew: number;
    tierCounts: Record<GeoTier, number>;
    outcomes: Record<string, number>;
    localEvidenceFound: boolean;
  } | null;
}

export interface MarketLaneResult {
  comparables: ReportComparable[];
  summary: MarketLaneSummary;
  /** Preserved price disagreements, in the report's own conflict vocabulary. */
  conflicts: Array<{ description: string; severity: 'MATERIAL' | 'MINOR'; evidence: string[] }>;
  evidence: MarketEvidence;
}

function tierFor(property: UniqueProperty, subjectProject: string | null): ReportComparable['comparableType'] {
  const project = property.primary.listing.projectName;
  if (subjectProject && project && project.toLowerCase().trim() === subjectProject.toLowerCase().trim()) {
    return 'SAME_PROJECT';
  }
  // The envelope's district filter is what makes this micro-location rather
  // than "somewhere in the city", so it is only claimed when the adapter
  // actually applied a district constraint.
  const usedDistrict = property.primary.matchRationale.includes('same district');
  return usedDistrict ? 'MICRO_LOCATION' : 'PEER_PROJECT';
}

/**
 * The report's own property vocabulary, which is coarser than the portal's.
 *
 * A flat and a house are both RESIDENTIAL for the purpose of a price range;
 * land and commercial space are not, and must not be averaged into one. An
 * unknown type stays null, which the range filter treats as "do not exclude"
 * — the same reading the model's own output has always had.
 */
function residentialClass(
  propertyType: string | null,
): 'RESIDENTIAL' | 'COMMERCIAL' | 'LAND' | 'OTHER' | null {
  if (propertyType === 'APARTMENT' || propertyType === 'HOUSE') return 'RESIDENTIAL';
  if (propertyType === 'COMMERCIAL') return 'COMMERCIAL';
  if (propertyType === 'LAND') return 'LAND';
  return null;
}

const numberText = (value: number | null | undefined): string | null =>
  typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value * 100) / 100) : null;

function toReportComparable(
  property: UniqueProperty,
  subjectProject: string | null,
): ReportComparable {
  const advert = property.primary;
  const l = advert.listing;
  const money = l.sale ?? l.rent ?? null;

  const alsoListedAt = [...property.crossPosted].map((other) => {
    const otherMoney = other.listing.sale ?? other.listing.rent ?? null;
    return {
      url: other.url,
      source: other.sourceFamily,
      price: otherMoney ? `${Math.round(otherMoney.amount)}` : null,
    };
  });

  return {
    source: advert.sourceFamily,
    url: advert.url,
    listingId: l.listingId,
    project: l.projectName,
    address: l.address?.display ?? l.district ?? l.city,
    area: l.area ? `${l.area.value}` : null,
    // The portal publishes no room count distinct from bedrooms. Saying
    // nothing is correct; reusing bedrooms here would invent the number.
    rooms: numberText(l.rooms),
    floor: numberText(l.floor),
    condition: null,
    /*
     * ACTIVE, because of HOW this was obtained rather than what it says.
     *
     * The lane reads the portal's live search of currently-published adverts.
     * Every record it returns is on the market at the moment it was read —
     * that is a property of the endpoint, not a guess about the listing. A
     * live search cannot surface an expired advert, and it equally cannot
     * tell us one expired yesterday, which is why nothing here ever claims
     * EXPIRED, REMOVED or SOLD.
     *
     * This matters concretely: computeMarketRanges only counts ACTIVE +
     * RESIDENTIAL rows, so leaving it unset excluded all 36 comparables from
     * the median and left the report's positioning UNKNOWN — measured on
     * production job a7d09fef, which returned 36 comparables and no price
     * range at all.
     */
    listingStatus: 'ACTIVE',
    propertyType: residentialClass(l.propertyType),
    price: money ? String(Math.round(money.amount)) : null,
    currency: money?.currency ?? null,
    pricePerSqm: numberText(l.salePricePerSqm),
    // The portal's own publication time. Never the moment we read the page.
    listingDate: l.publishedAt,
    similarity: advert.matchRationale,
    retrievedAt: advert.retrievedAt,
    comparableType: tierFor(property, subjectProject),
    discoveryMethod: 'DETERMINISTIC_PORTAL_SEARCH',
    ...(alsoListedAt.length ? { alsoListedAt } : {}),
  };
}

export interface RunMarketLaneOptions {
  budgetMs?: number;
  limit?: number;
  now?: () => number;
  /*
   * The search-engine discovery lane, when the caller has one to give.
   *
   * Passed in rather than constructed here, because every provider worth
   * having bills per request and that is not a decision a library makes. When
   * it is absent the lane behaves exactly as before.
   */
  search?: SearchProvider | null;
  /** Where the subject actually is, for tiering discovered results. */
  subjectGeo?: DiscoverySubjectGeo | null;
  /** Discovery query ceiling, since each one has a price. */
  maxDiscoveryQueries?: number;
}

/**
 * Run the lane, or say why it could not run.
 *
 * Returns null when the seed cannot support a meaningful question. That is not
 * a failure: "we do not know enough about this property to define a comparable
 * set" is a true statement, and issuing a city-wide sweep instead would be a
 * worse answer dressed as a better one.
 */
export async function runMarketLane(
  seed: ResearchSeed,
  registry: PortalRegistry,
  context: AdapterContext,
  options: RunMarketLaneOptions = {},
): Promise<MarketLaneResult | null> {
  if (!seedSupportsMarketSearch(seed)) return null;

  const now = options.now ?? (() => Date.now());
  const began = now();
  const evidence = await discoverComparables(seed, registry, context, {
    budgetMs: options.budgetMs ?? 25_000,
    limit: options.limit ?? 40,
    now,
  });
  if (!evidence) return null;

  const subjectProject = seed.project.name?.value ?? null;
  const comparables = evidence.uniqueProperties.map((property) =>
    toReportComparable(property, subjectProject),
  );

  /*
   * Price disagreements become CONFLICTS, not averages.
   *
   * MINOR rather than MATERIAL on purpose: two adverts for one flat at
   * different prices is genuinely useful to a buyer and genuinely common, and
   * escalating every one of them to MATERIAL would bury the findings that
   * actually threaten a transaction.
   */
  const conflicts = evidence.uniqueProperties
    .filter((property) => property.priceConflict !== null)
    .map((property) => {
      const conflict = property.priceConflict as NonNullable<UniqueProperty['priceConflict']>;
      const amounts = conflict.values.map((v) => `${Math.round(v.amount)} ${conflict.currency}`);
      return {
        description:
          `The same property appears to be advertised at ${amounts.join(' and ')} ` +
          `(${conflict.spreadPct}% apart, both ${conflict.basis.replace(/_/g, ' ').toLowerCase()}).`,
        severity: 'MINOR' as const,
        evidence: conflict.values.map((v) => v.url),
      };
    });

  const blockedSources = evidence.portals
    .filter((p) => ['BLOCKED', 'RATE_LIMITED', 'LOGIN_WALL', 'JOIN_REQUIRED'].includes(p.state))
    .map((p) => p.state);

  const summary: MarketLaneSummary = {
    advertisements: evidence.advertisements.length,
    uniqueProperties: evidence.uniqueProperties.length,
    crossPosted: evidence.crossPostedCount,
    uncertainDuplicates: evidence.uncertainDuplicateCount,
    independentSourceCount: evidence.independentSourceCount,
    observationCount: evidence.observationCount,
    priceConflicts: conflicts.length,
    widened: evidence.widened,
    truncatedByDeadline: evidence.truncatedByDeadline,
    networkRequests: evidence.networkRequests,
    blockedSources: Array.from(new Set(blockedSources)),
    portals: evidence.portals.map((p) => ({
      id: p.portalId,
      state: p.state,
      found: p.listingsFound,
      detail: p.detail,
    })),
    queries: evidence.queries.map((q) => ({ id: q.id, rationale: q.rationale })),
    startedAt: evidence.startedAt,
    finishedAt: evidence.finishedAt,
    durationMs: now() - began,
    discovery: null,
  };

  /*
   * THE SECOND LANE.
   *
   * Additive: the portal lane's comparables are untouched, and discovery runs
   * beside it to answer the question the portal lane structurally cannot —
   * "what is on this street, anywhere, in any language". A failure here can
   * never take the portal results down with it, because a report with 30
   * city-wide comparables is worse than one with local evidence and better
   * than none at all.
   */
  if (options.search && options.subjectGeo) {
    try {
      const plan = buildDiscoveryPlan(
        {
          project: subjectProject,
          street: options.subjectGeo.address ?? null,
          streetNumber: null,
          district: options.subjectGeo.district ?? null,
          city: options.subjectGeo.city ?? null,
          developer: options.subjectGeo.developer ?? null,
        },
        { international: true },
      );
      const report = await runDiscovery({
        plan,
        subject: options.subjectGeo,
        search: options.search,
        maxQueries: options.maxDiscoveryQueries ?? 24,
      });
      summary.discovery = {
        provider: report.provider,
        providerStatus: report.providerStatus,
        queriesExecuted: report.queriesExecuted,
        rawUrlsDiscovered: report.rawUrlsDiscovered,
        domainsDiscovered: report.domainsDiscovered.length,
        domainsNew: report.domainsNew.length,
        tierCounts: report.tierCounts,
        outcomes: report.outcomes,
        localEvidenceFound: report.knownPublicLocalEvidenceDiscovered,
      };
    } catch (e) {
      // Recorded as a lane that did not run, never as a market that is empty.
      summary.discovery = {
        provider: options.search.id,
        providerStatus: 'PROVIDER_ERROR',
        queriesExecuted: 0,
        rawUrlsDiscovered: 0,
        domainsDiscovered: 0,
        domainsNew: 0,
        tierCounts: {
          TIER_1_SAME_PROJECT: 0, TIER_2_SAME_STREET: 0, TIER_3_NEARBY_MICROLOCATION: 0,
          TIER_4_DISTRICT: 0, TIER_5_CITY: 0,
        },
        outcomes: {},
        localEvidenceFound: false,
      };
      console.error('marketLane: discovery lane failed', e);
    }
  }

  return { comparables, summary, conflicts, evidence };
}

/**
 * The instruction the MARKET stage receives instead of "go and search".
 *
 * This is the line where AI stops doing broad research. The comparables are
 * already gathered, deduplicated and priced; the model's job becomes reading
 * them, and the prompt says so explicitly so it does not spend searches
 * re-finding what it has been handed.
 */
export function marketLaneBrief(result: MarketLaneResult): string {
  const s = result.summary;
  if (!result.comparables.length) {
    return (
      'DETERMINISTIC MARKET RESEARCH ran and found no comparable listings within ' +
      'the subject\'s envelope. Do not present an absence of comparables as a ' +
      'low price or a high one — say that the market could not be characterised.'
    );
  }

  const lines = result.comparables.slice(0, 25).map((c) => {
    const parts = [
      c.area ? `${c.area}m²` : null,
      c.rooms ? `${c.rooms} rooms` : null,
      c.floor ? `floor ${c.floor}` : null,
      c.address,
      c.price && c.currency ? `${c.price} ${c.currency}` : null,
      c.pricePerSqm ? `${c.pricePerSqm}/m²` : null,
      c.listingDate ? `listed ${String(c.listingDate).slice(0, 10)}` : null,
    ].filter(Boolean);
    return `- ${parts.join(', ')} [${c.comparableType}] ${c.url ?? ''}`;
  });

  return [
    'DETERMINISTIC MARKET RESEARCH HAS ALREADY BEEN PERFORMED IN CODE.',
    '',
    `${s.advertisements} advertisement(s) were read from ${s.portals.length} portal(s) and ` +
      `resolved to ${s.uniqueProperties} likely-unique properties ` +
      `(${s.crossPosted} confirmed cross-posted, ${s.uncertainDuplicates} uncertain duplicates kept separate). ` +
      `Independent publisher families: ${s.independentSourceCount}.`,
    s.widened
      ? 'The envelope had to be WIDENED to find enough evidence — treat these as looser comparables and say so.'
      : 'All comparables come from the subject\'s own comparable envelope.',
    '',
    'These are ASKING prices from listings, never transaction prices, and they must ' +
      'never be described as what a property sold for.',
    '',
    'COMPARABLES ALREADY GATHERED — restate and interpret these. Do NOT spend ' +
      'searches re-finding listings; spend them only on questions these do not answer:',
    ...lines,
    '',
    result.conflicts.length
      ? `${result.conflicts.length} price disagreement(s) were detected between adverts for what ` +
        'appears to be the same property. Explain them; do not average them away.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}
