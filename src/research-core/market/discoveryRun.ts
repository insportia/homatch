/*
 * THE DISCOVERY RUN — FINDING THE MARKET, AND SAYING WHY IT WAS NOT FOUND.
 *
 * ── THE FAILURE THIS REPLACES ────────────────────────────────────────
 *
 * The Villion verification reported 30 unique listings, of which zero were in
 * the building, zero on the street and zero in the microlocation — thirty
 * broader-city comparables presented as this property's market. Meanwhile the
 * public index carried, for the same street, on the same day:
 *
 *   myhome.ge     „Крцаниси улица 6 ; 97.2 м² ; 7/8 этаж ; 3 Комнаты"
 *   estatehub.ge  „Krtsanisi Street 6, Tbilisi — 97.2 m², 3 rooms, floor 7/8"
 *   korter.ge     the building's own page, with the project name, the
 *                 developer, a floor-size range and coordinates
 *   home.ss.ge    inventory on „ул. Крцаниси"
 *   tranio.ru     „327 предложений на улице Крцаниси"
 *
 * Every zero was ours. So this module treats a local zero as a DISCOVERY
 * FAILURE to be explained, not as a fact about the market: each URL that fails
 * to become evidence is recorded with the reason it failed, and those reasons
 * are a closed vocabulary (see DiscoveryOutcome) so the next post-mortem reads
 * a ledger instead of a shrug.
 *
 * ── WHY IT TAKES ITS PROVIDER AS AN ARGUMENT ─────────────────────────
 *
 * Search is the discovery layer, not an afterthought: a portal that answers
 * 403 to every non-browser client is not a portal without inventory, it is a
 * portal whose inventory must be reached through the index. But WHICH index,
 * and whether it may be paid for, is an operational decision with a cost — so
 * the engine is handed a provider and never chooses one. A locked provider is
 * reported as PROVIDER_LOCKED and changes nothing else.
 *
 * ── AND WHY AN UNKNOWN DOMAIN IS NEVER REJECTED ──────────────────────
 *
 * The single most relevant result of the Krtsanisi harvest — the subject's own
 * 97.2 m² flat — came from estatehub.ge, which was on no list of ours. A
 * registry that discarded unknown domains would have thrown away the only
 * direct evidence there was. Seeds are a head start, never a gate.
 */

import {
  type DiscoveryQuery,
  type QueryLanguage,
  type QueryPrecision,
} from './discoveryPlan.ts';
import {
  type DiscoveryOutcome,
  type DomainClass,
  classifyDomain,
  worthExtracting,
  sourceForUrl,
} from './discoverySources.ts';
import {
  type ExtractedListing,
  type SearchIndexResult,
  fromSearchSnippet,
  fromLdJson,
  fromPageText,
} from './listingExtract.ts';
import {
  type ProjectIdentity,
  distanceMetres,
  matchesProject,
  sameAddress,
  sameStreet,
  MICROLOCATION_M,
} from './geoResolve.ts';
import {
  type GeoTier,
  type ListingLike,
  LOCAL_TIERS,
  TIER_ORDER,
  dedupeSyndicated,
  headlineTier,
  statsByTier,
} from './geoTier.ts';

/* ------------------------------------------------------------------ *
 * What a provider is                                                  *
 * ------------------------------------------------------------------ */

/** One row as a search engine returned it. Raw index evidence. */
export interface SearchHit {
  url: string;
  title: string;
  snippet: string;
}

export type SearchStatus = 'OK' | 'PROVIDER_LOCKED' | 'PROVIDER_ERROR';

export interface SearchResponse {
  status: SearchStatus;
  hits: readonly SearchHit[];
  /** Why, when the status is not OK. Internal diagnostics only. */
  detail?: string;
}

/**
 * Anything that can answer a query with indexed results.
 *
 * Deliberately one method wide. A SERP API, a cached harvest and a browser
 * driven by hand all satisfy it, which is what lets the acceptance fixture run
 * the REAL engine over REAL recorded results without a network or a bill.
 */
export interface SearchProvider {
  id: string;
  search(query: DiscoveryQuery): Promise<SearchResponse>;
}

/**
 * Anything that can read a page we are permitted to read.
 *
 * `canDriveBrowser` is what separates the two access classes in practice.
 * myhome.ge answers 403 to every non-browser client and renders normally in a
 * real one, so its pages are reachable only by a fetcher that says it is a
 * browser — and a plain HTTP fetcher must never be pointed at them, because
 * the 403 it earns would be recorded as a source with no inventory.
 */
export interface PageFetcher {
  id: string;
  /** True when this fetcher renders pages as a real browser does. */
  canDriveBrowser?: boolean;
  fetch(url: string): Promise<{ ok: boolean; status: number; body: string }>;
}

/* ------------------------------------------------------------------ *
 * What a run produces                                                 *
 * ------------------------------------------------------------------ */

/**
 * One discovered URL and what became of it.
 *
 * Every field here is internal. Section 15 of the reporting mandate forbids
 * any of it reaching a buyer: a domain that blocked us is our problem, and
 * saying so in a report is how "we could not read the market" got printed as
 * "the market is thin".
 */
export interface DiscoveryLedgerRow {
  url: string;
  domain: string;
  domainClass: DomainClass;
  query: string;
  language: QueryLanguage;
  precision: QueryPrecision;
  outcome: DiscoveryOutcome;
  tier?: GeoTier;
  /** How the record was obtained, once it became one. */
  via?: 'SEARCH_INDEX_RESULT' | 'DIRECT_PAGE' | 'BROWSER_PAGE';
}

export interface DomainTally {
  domain: string;
  class: DomainClass;
  urlsSeen: number;
  extracted: number;
  failed: number;
  localResults: number;
}

export interface DiscoveredListing extends ExtractedListing {
  tier: GeoTier;
  confidence: 'INDEX' | 'PAGE';
  query: string;
  language: QueryLanguage;
  /**
   * Whether this record states a measurable attribute, or only a location.
   *
   * „327 предложений на улице Крцаниси" is a category page: it proves the
   * street has inventory and it is not a flat. Counting it among comparables
   * would inflate the local sample with rows that can never be priced — the
   * precise way a wider discovery layer becomes worse than the narrow one it
   * replaces, so the two are counted separately and never summed.
   */
  measurable: boolean;
}

export interface DiscoveryReport {
  provider: string;
  providerStatus: SearchStatus;
  queriesPlanned: number;
  queriesExecuted: number;
  queriesWithResults: number;
  languages: readonly QueryLanguage[];
  rawUrlsDiscovered: number;
  domainsDiscovered: readonly string[];
  domainsNew: readonly string[];
  domainsProducingEvidence: readonly string[];
  perDomain: readonly DomainTally[];
  ledger: readonly DiscoveryLedgerRow[];
  outcomes: Readonly<Record<DiscoveryOutcome, number>>;
  listings: readonly DiscoveredListing[];
  duplicatesRemoved: number;
  tierCounts: Readonly<Record<GeoTier, number>>;
  /** The same tiers, counting only records that state an area or a price. */
  tierCountsMeasurable: Readonly<Record<GeoTier, number>>;
  /** Per-tier price statistics. Never merged across tiers. */
  tierStats: ReturnType<typeof statsByTier>;
  headline: ReturnType<typeof headlineTier>;
  /** The acceptance bar: did any TIER 1–3 evidence come back at all? */
  knownPublicLocalEvidenceDiscovered: boolean;
}

export interface DiscoverySubjectGeo extends ProjectIdentity {
  /** Spellings of the street to look for inside a snippet, in every script. */
  streetHints: readonly string[];
  district?: string | null;
  city?: string | null;
}

export interface RunDiscoveryOptions {
  plan: readonly DiscoveryQuery[];
  subject: DiscoverySubjectGeo;
  search: SearchProvider;
  /** Optional, and only ever used on sources whose access permits it. */
  fetchPage?: PageFetcher | null;
  /** Stop asking once this many queries have run. 0 means no ceiling. */
  maxQueries?: number;
  /**
   * Stop early once this much local evidence exists.
   *
   * A budget, not a target: the plan is ordered narrowest-first, so a run that
   * has already found the building has no reason to keep paying for city-wide
   * formulations. Zero disables the short-circuit.
   */
  enoughLocal?: number;
}

/* ------------------------------------------------------------------ *
 * Tiering a discovered record                                         *
 * ------------------------------------------------------------------ */

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    // A provider may return a display URL rather than a link. The domain is
    // still the useful part, so it is read off the text rather than discarded.
    const m = /([a-z0-9-]+(?:\.[a-z0-9-]+)+)/i.exec(url ?? '');
    return m ? m[1].toLowerCase().replace(/^www\./, '') : '';
  }
};

/**
 * Which of the five tiers a discovered record belongs to.
 *
 * COORDINATES FIRST, THEN THE ADDRESS, THEN THE NAME — and a name alone can
 * never reach TIER 1. That last rule is the whole reason matchesProject
 * returns a reason: „Villa Residence" is not „Villion", and a tier assigned on
 * a fuzzy name is a fabricated comparable wearing the most authoritative label
 * the report has.
 */
export function tierOfDiscovered(
  listing: ExtractedListing,
  subject: DiscoverySubjectGeo
): GeoTier {
  const identity = matchesProject(listing, subject);
  if (identity.same) return 'TIER_1_SAME_PROJECT';

  const addr = listing.address ?? '';
  if (subject.address && addr) {
    if (sameAddress(addr, subject.address)) return 'TIER_1_SAME_PROJECT';
    if (sameStreet(addr, subject.address)) return 'TIER_2_SAME_STREET';
  }

  const metres = distanceMetres(listing, subject);
  if (metres !== null && metres <= MICROLOCATION_M) return 'TIER_3_NEARBY_MICROLOCATION';

  const haystack = `${addr} ${listing.title ?? ''}`.toLocaleLowerCase();
  const district = (subject.district ?? '').toLocaleLowerCase().trim();
  if (district && haystack.includes(district)) return 'TIER_4_DISTRICT';
  for (const hint of subject.streetHints) {
    // The street named without a number is still this street.
    if (hint && haystack.includes(hint.toLocaleLowerCase())) return 'TIER_2_SAME_STREET';
  }
  return 'TIER_5_CITY';
}

/* ------------------------------------------------------------------ *
 * The run                                                             *
 * ------------------------------------------------------------------ */

const LD_RE = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

/** ld+json blocks from raw HTML, ignoring the ones that do not parse. */
function ldBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(LD_RE)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      // A portal shipping invalid JSON-LD is common and is not an error here.
    }
  }
  return out;
}

/** Visible text from raw HTML, near enough for the heuristic extractor. */
function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export async function runDiscovery(options: RunDiscoveryOptions): Promise<DiscoveryReport> {
  const { plan, subject, search } = options;
  const maxQueries = options.maxQueries ?? 0;
  const enoughLocal = options.enoughLocal ?? 0;

  const ledger: DiscoveryLedgerRow[] = [];
  const tallies = new Map<string, DomainTally>();
  const found: DiscoveredListing[] = [];
  const seenUrls = new Set<string>();
  const languages = new Set<QueryLanguage>();

  let providerStatus: SearchStatus = 'OK';
  let queriesExecuted = 0;
  let queriesWithResults = 0;
  let localSoFar = 0;

  const tally = (domain: string, cls: DomainClass): DomainTally => {
    let t = tallies.get(domain);
    if (!t) {
      t = { domain, class: cls, urlsSeen: 0, extracted: 0, failed: 0, localResults: 0 };
      tallies.set(domain, t);
    }
    return t;
  };

  for (const query of plan) {
    if (maxQueries && queriesExecuted >= maxQueries) break;
    if (enoughLocal && localSoFar >= enoughLocal) break;

    const response = await search.search(query);
    queriesExecuted += 1;
    languages.add(query.language);

    if (response.status !== 'OK') {
      /*
       * A provider that will not answer is OUR state, never the market's.
       *
       * Recorded and carried out of the run so a caller can say "discovery did
       * not run" instead of computing a median from whatever else turned up
       * and presenting it as this property's competitive environment.
       */
      providerStatus = response.status;
      break;
    }

    if (!response.hits.length) {
      ledger.push({
        url: '', domain: '', domainClass: 'IRRELEVANT',
        query: query.text, language: query.language, precision: query.precision,
        outcome: 'NOT_DISCOVERED',
      });
      continue;
    }
    queriesWithResults += 1;

    for (const hit of response.hits) {
      const domain = hostOf(hit.url);
      const domainClass = classifyDomain(domain);
      const row: DiscoveryLedgerRow = {
        url: hit.url, domain, domainClass,
        query: query.text, language: query.language, precision: query.precision,
        outcome: 'DISCOVERED_BUT_EXTRACTION_FAILED',
      };
      const t = tally(domain, domainClass);
      t.urlsSeen += 1;

      if (!worthExtracting(domainClass)) {
        row.outcome = 'SOURCE_NOT_SUPPORTED';
        ledger.push(row);
        continue;
      }
      if (seenUrls.has(hit.url)) {
        row.outcome = 'DUPLICATE';
        ledger.push(row);
        continue;
      }
      seenUrls.add(hit.url);

      /*
       * THE SNIPPET IS EVIDENCE BEFORE THE PAGE IS.
       *
       * Read first, always — because for myhome.ge it is the ONLY thing we are
       * permitted to read, and because a page fetch that then fails must not
       * be able to erase what the index already stated.
       */
      const indexResult: SearchIndexResult = {
        url: hit.url, domain, title: hit.title, snippet: hit.snippet, query: query.text,
      };
      let listing: ExtractedListing | null = fromSearchSnippet(indexResult, subject.streetHints);
      let confidence: 'INDEX' | 'PAGE' = 'INDEX';
      let via: DiscoveryLedgerRow['via'] = 'SEARCH_INDEX_RESULT';

      /*
       * Enrichment, and only where access permits it. A source recorded as
       * BROWSER or INDEX_ONLY is not fetched here: myhome.ge answers 403 to
       * every non-browser client, and hammering it would be both useless and
       * a control we were asked not to work around.
       */
      /*
       * WHAT MAY BE READ, AND BY WHAT.
       *
       * A registered source states its access and that is obeyed: INDEX_ONLY is
       * not fetched, and a BROWSER source is fetched only by a fetcher that is
       * one — pointing plain HTTP at myhome.ge earns a 403 that would then be
       * recorded as a portal with no inventory.
       *
       * An UNKNOWN domain is tried over plain HTTP, because that is how a
       * discovery layer learns. estatehub.ge was on no list of ours and carried
       * the acceptance listing; a rule that refused to read anything unregistered
       * would have made the registry a gate again, which is the ceiling this
       * whole layer exists to remove. What comes back is an observation, and a
       * refusal is recorded rather than held against the street.
       */
      const source = sourceForUrl(hit.url);
      const readable = source
        ? (source.access === 'DIRECT'
          || (source.access === 'BROWSER' && options.fetchPage?.canDriveBrowser === true))
        : true;
      if (options.fetchPage && readable) {
        const page = await options.fetchPage.fetch(hit.url);
        if (page.ok && page.body) {
          const ctx = { url: hit.url, sourceDomain: domain, streetHints: subject.streetHints };
          const richer = fromLdJson(ldBlocks(page.body), ctx)
            ?? fromPageText(visibleText(page.body), ctx);
          if (richer) {
            listing = richer;
            confidence = 'PAGE';
            via = source?.access === 'BROWSER' ? 'BROWSER_PAGE' : 'DIRECT_PAGE';
          }
        }
      }

      if (!listing) {
        t.failed += 1;
        row.outcome = 'DISCOVERED_BUT_EXTRACTION_FAILED';
        ledger.push(row);
        continue;
      }
      t.extracted += 1;

      if (!listing.address && listing.lat == null && !listing.project) {
        /*
         * Extracted, but with nothing that places it. Distinguished from an
         * extraction failure on purpose: the fix for one is a parser and the
         * fix for the other is address resolution, and a single "failed"
         * counter told us which one neither time.
         */
        row.outcome = 'EXTRACTED_BUT_ADDRESS_FAILED';
        ledger.push(row);
        continue;
      }

      const tier = tierOfDiscovered(listing, subject);
      if (tier === 'TIER_1_SAME_PROJECT' && !matchesProject(listing, subject).same
        && !(subject.address && listing.address && sameAddress(listing.address, subject.address))) {
        row.outcome = 'EXTRACTED_BUT_PROJECT_ID_FAILED';
        ledger.push(row);
        continue;
      }

      row.outcome = LOCAL_TIERS.includes(tier) ? 'VALID_LOCAL_RESULT' : 'VALID_CONTEXT_RESULT';
      row.tier = tier;
      row.via = via;
      ledger.push(row);
      if (LOCAL_TIERS.includes(tier)) { localSoFar += 1; t.localResults += 1; }

      found.push({
        ...listing, tier, confidence, query: query.text, language: query.language,
        measurable: (listing.area ?? 0) > 0 || (listing.pricePerSqm ?? 0) > 0 || (listing.price ?? 0) > 0,
      });
    }
  }

  /*
   * Syndication last, so a duplicate is counted once as a duplicate and not
   * once per portal carrying it. Five copies of one flat is one flat, and a
   * wider discovery layer that inflated the sample would be worse than the
   * narrow one it replaces.
   */
  const { unique, duplicatesRemoved } = dedupeSyndicated(found as (DiscoveredListing & ListingLike)[]);

  const tierCounts = Object.fromEntries(TIER_ORDER.map((t) => [t, 0])) as Record<GeoTier, number>;
  const tierCountsMeasurable = Object.fromEntries(TIER_ORDER.map((t) => [t, 0])) as Record<GeoTier, number>;
  for (const l of unique) {
    tierCounts[l.tier] += 1;
    if (l.measurable) tierCountsMeasurable[l.tier] += 1;
  }

  const outcomes = {
    VALID_LOCAL_RESULT: 0, VALID_CONTEXT_RESULT: 0, NOT_DISCOVERED: 0,
    DISCOVERED_BUT_EXTRACTION_FAILED: 0, EXTRACTED_BUT_ADDRESS_FAILED: 0,
    EXTRACTED_BUT_PROJECT_ID_FAILED: 0, DUPLICATE: 0, SOURCE_NOT_SUPPORTED: 0,
  } as Record<DiscoveryOutcome, number>;
  for (const row of ledger) outcomes[row.outcome] += 1;
  outcomes.DUPLICATE += duplicatesRemoved;

  const stats = statsByTier(unique, (l) => l.tier);
  const domains = [...tallies.keys()].sort();

  return {
    provider: search.id,
    providerStatus,
    queriesPlanned: plan.length,
    queriesExecuted,
    queriesWithResults,
    languages: [...languages],
    rawUrlsDiscovered: ledger.filter((r) => r.url).length,
    domainsDiscovered: domains,
    domainsNew: domains.filter((d) => classifyDomain(d) === 'DISCOVERED_UNCLASSIFIED'),
    domainsProducingEvidence: [...tallies.values()].filter((t) => t.extracted > 0).map((t) => t.domain).sort(),
    perDomain: [...tallies.values()].sort((a, b) => b.extracted - a.extracted || a.domain.localeCompare(b.domain)),
    ledger,
    outcomes,
    listings: unique,
    duplicatesRemoved,
    tierCounts,
    tierCountsMeasurable,
    tierStats: stats,
    headline: headlineTier(stats),
    knownPublicLocalEvidenceDiscovered: LOCAL_TIERS.some((t) => tierCounts[t] > 0),
  };
}
