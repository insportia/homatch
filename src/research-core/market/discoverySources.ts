/*
 * WHERE MARKET EVIDENCE COMES FROM, AND HOW EACH SOURCE IS REACHED.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 *
 * The Villion run reported SAME_PROJECT = 0, SAME_STREET = 0. That was never
 * true of the world. A single search of the public index returns, today:
 *
 *   korter.ge/house-on-krtsanisi-6-tbilisi   the building's own page, with
 *                                            ld+json naming the project
 *                                            "Villion", the developer
 *                                            "Millennio Group", 3–4 rooms,
 *                                            82.2–168 m², and COORDINATES
 *                                            41.67653, 44.82462
 *   myhome.ge/.../krtsanisi-20592132         a live 90 m² listing on
 *                                            "Krtsanisi St" at ~$2,056/m²
 *   home.ss.ge/ka/udzravi-qoneba/30233493    an ss.ge listing
 *   villion.ge                               the developer's own site
 *
 * Every one of those is TIER 1 or TIER 2 evidence. The system found none of
 * them because it asked one portal, one question, by district id. The zeros
 * described our search, not the market — which is precisely the failure the
 * customer-facing rules now forbid us from printing, and the reason the real
 * fix is here rather than in the wording.
 *
 * ── ACCESS IS A PROPERTY OF THE SOURCE, NOT AN AFTERTHOUGHT ──────────
 *
 * Each source records HOW it may be reached, because that differs per domain
 * and changes what the pipeline can promise:
 *
 *   DIRECT      plain HTTP to a clean path; server-rendered
 *   BROWSER     JS-rendered, or behind a WAF that refuses non-browsers.
 *               myhome.ge answers 403 to every non-browser agent tried,
 *               including a full Chrome UA, and renders normally in a real
 *               browser. That is an access control, so it is reached the way
 *               it permits or not at all.
 *   INDEX_ONLY  its URLs are useful as search results; the pages themselves
 *               are not fetched by us.
 *
 * Nothing here bypasses a control, guesses a private API, or ignores robots.
 * korter.ge disallows /api/, /pyapi/ and /node-api/ — so the building page is
 * read and the lazy-loaded plan endpoint is not, which costs per-unit prices
 * and is the correct trade.
 */

export type AccessMethod = 'DIRECT' | 'BROWSER' | 'INDEX_ONLY';

export type SourceKind =
  | 'PORTAL'          // general property marketplace
  | 'PROJECT_INDEX'   // new-build/project directory
  | 'DEVELOPER'       // a developer's own site
  | 'AGENCY'          // broker or agency inventory
  | 'INTERNATIONAL';  // foreign-facing portal indexing Georgia

export interface MarketSource {
  domain: string;
  kind: SourceKind;
  access: AccessMethod;
  /** Which extractor understands this domain's pages. */
  extractor: 'LDJSON' | 'REALTING_CARDS' | 'HEURISTIC';
  countries: readonly string[];
  languages: readonly string[];
  /**
   * What was observed when this source was last checked by hand, and when.
   * A registry that cannot say why it believes something is a list of guesses.
   */
  note: string;
  verifiedOn: string;
}

/*
 * Every entry below was probed over real HTTP or in a real browser on
 * 2026-09-20 before it was written down. Domains that refused are recorded
 * with the refusal rather than omitted, so the next attempt starts from
 * evidence instead of repeating the probe.
 */
export const MARKET_SOURCES: readonly MarketSource[] = [
  {
    domain: 'korter.ge',
    kind: 'PROJECT_INDEX',
    access: 'BROWSER',
    extractor: 'LDJSON',
    countries: ['GE'],
    languages: ['ka', 'en', 'ru'],
    note:
      'Building pages carry Apartment+Product ld+json with project name, developer brand, '
      + 'room range, floor-size range, yearBuilt and geo coordinates. Clean paths are '
      + 'allowed; /api/, /pyapi/ and /node-api/ are disallowed by robots, so the '
      + 'lazy-loaded per-unit plan prices are deliberately out of reach.',
    verifiedOn: '2026-09-20',
  },
  {
    domain: 'myhome.ge',
    kind: 'PORTAL',
    access: 'BROWSER',
    extractor: 'HEURISTIC',
    countries: ['GE'],
    languages: ['ka', 'en', 'ru'],
    note:
      'Answers 403 to every non-browser agent tried, including a full Chrome UA, on both '
      + 'the site and api.myhome.ge. Renders normally in a real browser: a listing page '
      + 'yields street, area and price per m². Reached only the way it permits.',
    verifiedOn: '2026-09-20',
  },
  {
    domain: 'home.ss.ge',
    kind: 'PORTAL',
    access: 'BROWSER',
    extractor: 'HEURISTIC',
    countries: ['GE'],
    languages: ['ka', 'en', 'ru'],
    note:
      'Already has a first-class adapter for category search (see adapters/portal/ss-ge.ts). '
      + 'Individual listing pages are JS-rendered, so a discovered listing URL needs the '
      + 'browser path rather than the category API.',
    verifiedOn: '2026-09-20',
  },
  {
    domain: 'villion.ge',
    kind: 'DEVELOPER',
    access: 'DIRECT',
    extractor: 'HEURISTIC',
    countries: ['GE'],
    languages: ['ka', 'en'],
    note:
      "The subject project's own site — the strongest possible SAME_PROJECT signal for "
      + 'identity, though a developer states availability rather than an open market.',
    verifiedOn: '2026-09-20',
  },
  {
    domain: 'realting.com',
    kind: 'INTERNATIONAL',
    access: 'DIRECT',
    extractor: 'REALTING_CARDS',
    countries: ['GE'],
    languages: ['en', 'ru'],
    note:
      'Server-rendered; listing cards expose data-object-id and data-price-USD. robots '
      + 'disallows any URL with a query string, so only clean paths are fetched. Indexes '
      + 'city-wide inventory, so it contributes context rather than local evidence.',
    verifiedOn: '2026-09-20',
  },
  {
    domain: 'tranio.com',
    kind: 'INTERNATIONAL',
    access: 'INDEX_ONLY',
    countries: ['GE'],
    languages: ['en', 'ru'],
    extractor: 'HEURISTIC',
    note: 'Returns 403 to plain HTTP. Left as index-only until a compliant path is established.',
    verifiedOn: '2026-09-20',
  },
];

/** Sources this run may actually fetch, given what the caller can drive. */
export function fetchableSources(
  canDriveBrowser: boolean
): readonly MarketSource[] {
  return MARKET_SOURCES.filter(
    (s) => s.access === 'DIRECT' || (s.access === 'BROWSER' && canDriveBrowser)
  );
}

/** The source a discovered URL belongs to, when it is one we understand. */
export function sourceForUrl(url: string): MarketSource | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  return (
    MARKET_SOURCES.find((s) => host === s.domain || host.endsWith(`.${s.domain}`)) ?? null
  );
}

/**
 * Why a discovered URL produced no evidence.
 *
 * Kept as a closed vocabulary because the Villion post-mortem needs to
 * distinguish "the market has nothing" from "we could not read what it has" —
 * and only one of those is a fact about the property.
 */
export type DiscoveryOutcome =
  | 'VALID_LOCAL_RESULT'
  | 'VALID_CONTEXT_RESULT'
  | 'NOT_DISCOVERED'
  | 'DISCOVERED_BUT_EXTRACTION_FAILED'
  | 'EXTRACTED_BUT_ADDRESS_FAILED'
  | 'EXTRACTED_BUT_PROJECT_ID_FAILED'
  | 'DUPLICATE'
  | 'SOURCE_NOT_SUPPORTED';

/* ------------------------------------------------------------------ *
 * The seed registry, and everything beyond it                         *
 * ------------------------------------------------------------------ */

/*
 * SEEDS, NOT AN ALLOWLIST.
 *
 * A fixed list of portals is what produced SAME_STREET = 0 for a street the
 * public index carries hundreds of listings on. These are starting points that
 * save a discovery run from rediscovering the obvious; a domain's absence here
 * must never be a reason to discard it.
 *
 * Kept as bare domains with a category rather than as full capability records,
 * because capability is something a run OBSERVES (see DomainObservation below)
 * and writing it down in advance is how a registry starts lying.
 */
export const SEED_DOMAINS: Readonly<Record<string, SourceKind>> = {
  // Georgian portals and classifieds
  'myhome.ge': 'PORTAL',
  'ss.ge': 'PORTAL',
  'home.ss.ge': 'PORTAL',
  'place.ge': 'PORTAL',
  'home24.ge': 'PORTAL',
  'makler.ge': 'PORTAL',
  'myhomesale.ge': 'PORTAL',
  'estatemarket.ge': 'PORTAL',
  'xeli.ge': 'PROJECT_INDEX',
  'korter.ge': 'PROJECT_INDEX',
  // Agencies and brokers
  'realtor.ge': 'AGENCY',
  'brokeri.ge': 'AGENCY',
  'topbroker.ge': 'AGENCY',
  'cgagency.ge': 'AGENCY',
  'caucasusestate.ge': 'AGENCY',
  'origencollection.com': 'AGENCY',
  'zarayaproperties.com': 'AGENCY',
  // Project and developer sites
  'krtsanisi.com': 'DEVELOPER',
  'villion.ge': 'DEVELOPER',
  // International and expat facing
  'realting.com': 'INTERNATIONAL',
  'tranio.com': 'INTERNATIONAL',
  'tranio.ru': 'INTERNATIONAL',
  'expathome.ge': 'INTERNATIONAL',
};

/**
 * What a domain turned out to be.
 *
 * A discovered domain starts UNCLASSIFIED and earns a category from what its
 * pages actually contain. Rejecting an unknown domain on sight is the ceiling
 * this architecture exists to remove.
 */
export type DomainClass =
  | 'DISCOVERED_UNCLASSIFIED'
  | SourceKind
  | 'CLASSIFIEDS'
  | 'EDITORIAL'
  | 'SOCIAL'
  | 'IRRELEVANT';

/** Hosts that carry property talk but are never property records. */
const SOCIAL = /(?:facebook|instagram|t\.me|telegram|linkedin|youtube|twitter|x)\.com$/i;
const EDITORIAL = /(?:wikipedia|bm\.ge|agenda\.ge|civil\.ge|forbes|bloomberg)\./i;

/**
 * A first guess at what a newly discovered domain is.
 *
 * Deliberately shallow — it decides where a domain ENTERS the pipeline, not
 * whether it stays. A domain whose pages later yield structured property data
 * is reclassified by observation, which is the only evidence that counts.
 */
export function classifyDomain(domain: string): DomainClass {
  const d = domain.toLowerCase().replace(/^www\./, '');
  const seeded = SEED_DOMAINS[d];
  if (seeded) return seeded;
  if (SOCIAL.test(d)) return 'SOCIAL';
  if (EDITORIAL.test(d)) return 'EDITORIAL';
  return 'DISCOVERED_UNCLASSIFIED';
}

/** True when a domain is worth attempting extraction on at all. */
export function worthExtracting(cls: DomainClass): boolean {
  return cls !== 'SOCIAL' && cls !== 'EDITORIAL' && cls !== 'IRRELEVANT';
}

/**
 * What a run learned about a domain.
 *
 * Accumulated rather than declared, so the registry improves by being used and
 * a single failure never condemns a source permanently — which is how a
 * transient 403 turns into a permanent blind spot.
 */
export interface DomainObservation {
  domain: string;
  class: DomainClass;
  urlsSeen: number;
  extracted: number;
  failed: number;
  /** Fields the extractions actually populated, for field-coverage scoring. */
  fieldsSeen: readonly string[];
  lastProbeAt: string;
  lastSuccessAt?: string | null;
}

/** Share of attempts that produced evidence. Null until something was tried. */
export function successRate(o: DomainObservation): number | null {
  const tried = o.extracted + o.failed;
  return tried ? Math.round((o.extracted / tried) * 100) / 100 : null;
}
