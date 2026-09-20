/*
 * DISCOVERY WITHOUT A SEARCH ENGINE.
 *
 * ── WHY THIS EXISTS ──────────────────────────────────────────────────
 *
 * Discovery was written to take a SearchProvider: give it a question, get back
 * indexed results. That works, and it makes the market visible only for as
 * long as someone pays per question — a per-property SERP bill, or a model
 * spending web searches to do a crawler's job. Neither is a thing Homatch
 * should have to buy in order to know what is for sale on a street.
 *
 * The public web already answers this by itself. korter.ge publishes a sitemap
 * index; `sitemap/building_landing.xml` lists every building landing page it
 * has, and among the 55 Krtsanisi entries is
 *
 *     https://korter.ge/house-on-krtsanisi-6-tbilisi
 *
 * which is the subject building, carrying Apartment+Product JSON-LD with the
 * project name, the developer, a floor-size range and coordinates. No search
 * API discovered that. A sitemap fetch, a slug filter and a JSON-LD parse did.
 *
 * ── WHAT THE SHAPE IS ────────────────────────────────────────────────
 *
 *   PUBLIC WEB -> targets -> fetch -> extract -> normalize -> resolve -> tier
 *
 * Every step is code. AI sees the finished dataset and not one moment before,
 * because a model asked to find listings will write listings, and a fabricated
 * comparable is indistinguishable from evidence once it is in the table.
 *
 * ── AND WHAT IT REFUSES TO DO ────────────────────────────────────────
 *
 * robots.txt decides what may be fetched, every time, using the parser this
 * repository already has. Nothing here authenticates, solves a challenge,
 * guesses a private endpoint or pretends to be a browser it is not. A source
 * that declines to be read is recorded as exactly that — our limitation, never
 * the street's.
 */

import { isAllowed, parseRobotsTxt, type RobotsFile, EMPTY_ROBOTS } from '../net/robots.ts';
import { classifyIp, isBlockedCategory, parseIpLiteral } from '../net/ip.ts';
import {
  type DiscoveryOutcome,
  type DomainClass,
  classifyDomain,
  worthExtracting,
} from './discoverySources.ts';
import {
  type ExtractedListing,
  fromLdJson,
  fromPageText,
} from './listingExtract.ts';
import { romanise } from './geoResolve.ts';
import {
  type GeoTier,
  type ListingLike,
  LOCAL_TIERS,
  TIER_ORDER,
  dedupeSyndicated,
  headlineTier,
  statsByTier,
} from './geoTier.ts';
import {
  type DiscoveredListing,
  type DiscoverySubjectGeo,
  tierOfDiscovered,
} from './discoveryRun.ts';

/* ------------------------------------------------------------------ *
 * Capabilities                                                        *
 * ------------------------------------------------------------------ */

/**
 * What a source turned out to support.
 *
 * OBSERVED, not declared. A capability written down in advance is a guess that
 * outlives the site it describes; korter.ge was recorded as BROWSER-only in
 * this repository and serves its building pages perfectly over plain HTTP.
 */
export type SourceCapability =
  | 'STATIC_HTML'
  | 'SERVER_RENDERED'
  | 'JSON_LD'
  | 'BROWSER_PAGE'
  | 'SITEMAP'
  | 'CATEGORY_PAGE'
  | 'LISTING_PAGE'
  | 'PROJECT_PAGE'
  | 'DEVELOPER_INVENTORY'
  | 'AGENCY_INVENTORY';

/** How a URL came to be worth fetching. Reported per local result. */
export type DiscoveryPath =
  | 'SEED_DOMAIN_SITEMAP'
  | 'SEED_DOMAIN_CATEGORY'
  | 'CONSTRUCTED_URL'
  | 'PAGE_LINK'
  | 'CANONICAL_LINK'
  | 'SITEMAP_INDEX_CHILD';

export interface DiscoveryTarget {
  url: string;
  path: DiscoveryPath;
  /** Why this URL was believed relevant, for the ledger. */
  reason: string;
  depth: number;
}

/* ------------------------------------------------------------------ *
 * The subject, as search terms a URL can be built from                *
 * ------------------------------------------------------------------ */

export interface CodeDiscoverySubject extends DiscoverySubjectGeo {
  /** Street name with no number and no word for "street", any script. */
  streetStem?: string | null;
  streetNumber?: string | null;
  countryCode?: string | null;
}

/**
 * The tokens a URL slug would contain if it were about this property.
 *
 * Romanised and lowercased, because a slug is romanised and lowercased —
 * `krtsanisis-kucha-21-tbilisshi` and `21-krtsanisi-street-tbilisi` are the
 * same street in the same sitemap, and neither contains the Georgian.
 */
const SLUG_STOPWORD = new Set([
  // Words meaning "street" or "avenue", romanised. A slug token of `kucha`
  // matches every street in Georgia: the first run of this crawler pulled
  // `tsitlanadze-kucha-7` out of korter's sitemap and called it local
  // evidence, and the subject's own building never made the shortlist.
  'kucha', 'quchа', 'street', 'str', 'ulitsa', 'prospekt', 'avenue', 'gamziri',
  // And the city, which is true of a quarter of a million pages.
  'tbilisi', 'tbilisshi', 'tbilisi-ge', 'georgia', 'sakartvelo',
]);

/** Georgian case endings, which change with grammar and not with place. */
const GEORGIAN_TAIL = /(?:is|s|it|ze|shi)$/;

export function slugTokens(subject: CodeDiscoverySubject): string[] {
  const out = new Set<string>();
  const add = (v: string | null | undefined) => {
    const r = romanise(v ?? '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    for (const word of r.split(/\s+/)) {
      // Two-letter tokens match half the web; a street name is longer.
      if (word.length < 4 || SLUG_STOPWORD.has(word)) continue;
      out.add(word);
      /*
       * And the stem without its Georgian ending, because a slug is written
       * from the nominative: the address says „კრწანისის" (krtsanisis) and
       * every URL says `krtsanisi`.
       */
      const stem = word.replace(GEORGIAN_TAIL, '');
      if (stem.length >= 4 && !SLUG_STOPWORD.has(stem)) out.add(stem);
    }
  };
  add(subject.streetStem);
  add(subject.address);
  add(subject.district);
  for (const n of subject.names) add(n);
  for (const h of subject.streetHints) add(h);
  return [...out];
}

/**
 * Whether a URL looks like it concerns this property's location.
 *
 * Deliberately generous about WHAT the page is and strict about WHERE: a
 * sitemap holds hundreds of thousands of URLs, and the street name is the only
 * cheap signal that separates this street from the rest of the country.
 */
export function urlMatchesSubject(url: string, tokens: readonly string[]): boolean {
  const lower = romanise(decodeURIComponent(url)).toLowerCase();
  return tokens.some((t) => lower.includes(t));
}

/*
 * WHICH OF THE MATCHES TO OPEN FIRST.
 *
 * building_landing.xml holds 55 URLs naming this street and the budget allows
 * a fraction of that. Taken in sitemap order, the subject's own building was
 * not among the ones opened — discovered, shortlisted, and then never read,
 * which is the most expensive way to miss something.
 *
 * So the shortlist is ordered by how specifically each URL names the subject:
 * the house number counts most, then a project name, then the street. That is
 * what puts `house-on-krtsanisi-6-tbilisi` above `krtsanisis-kucha-88`.
 */
export function rankSubjectUrls(
  urls: readonly string[],
  tokens: readonly string[],
  streetNumber: string | null,
): string[] {
  const score = (url: string): number => {
    const lower = romanise(decodeURIComponent(url)).toLowerCase();
    let n = 0;
    for (const t of tokens) if (lower.includes(t)) n += 2;
    if (streetNumber) {
      // The number as its own slug segment, never as part of another number:
      // `krtsanisi-6` scores, `krtsanisi-63` does not.
      const re = new RegExp(`(?:^|[^0-9])${streetNumber}(?:[^0-9]|$)`);
      if (re.test(lower)) n += 5;
    }
    return n;
  };
  return urls
    .filter((u) => urlMatchesSubject(u, tokens))
    .map((u) => ({ u, s: score(u) }))
    .sort((a, b) => b.s - a.s || a.u.length - b.u.length)
    .map((x) => x.u);
}

/*
 * HOSTS THAT ARE NEVER A PROPERTY SOURCE.
 *
 * The first crawl followed a link out of korter.ge into play.google.com and
 * spent seven page fetches there. Cross-domain discovery is the point of this
 * layer — that is how a source nobody registered gets found — but an app
 * store, a CDN and an analytics host are infrastructure, not inventory, and a
 * budget spent on them is a budget not spent on the street.
 */
const NEVER_A_SOURCE =
  /(?:^|\.)(?:play\.google\.com|apps\.apple\.com|itunes\.apple\.com|goo\.gl|maps\.google\.[a-z.]+|google\.[a-z.]+|gstatic\.com|googleapis\.com|gravatar\.com|w3\.org|schema\.org|wa\.me|api\.whatsapp\.com|cdn\.[a-z0-9-]+\.[a-z]+)$/i;

export function couldBeAPropertySource(host: string): boolean {
  return !NEVER_A_SOURCE.test(host.toLowerCase());
}

/* ------------------------------------------------------------------ *
 * Fetching, under rules                                               *
 * ------------------------------------------------------------------ */

export interface CrawlFetchResult {
  ok: boolean;
  status: number;
  body: string;
  contentType?: string;
}

export interface CrawlFetcher {
  id: string;
  canDriveBrowser?: boolean;
  fetch(url: string): Promise<CrawlFetchResult>;
}

export interface CrawlBudget {
  /** Total pages this run may fetch, across every domain. */
  maxPages: number;
  /** Pages per domain, so one generous sitemap cannot consume the run. */
  maxPagesPerDomain: number;
  /** How far a link may be followed from a seed. */
  maxDepth: number;
  /** Wall clock. This runs inside someone else's timeout. */
  deadlineMs: number;
  /** Stop once this much local evidence exists. */
  enoughLocal: number;
}

export const DEFAULT_CRAWL_BUDGET: CrawlBudget = {
  maxPages: 60,
  maxPagesPerDomain: 20,
  maxDepth: 2,
  deadlineMs: 90_000,
  enoughLocal: 12,
};

/**
 * A host we are willing to open a connection to at all.
 *
 * Not an allowlist of domains — the registry is a seed and the architecture
 * has no domain ceiling. This is the narrower question of whether a name is a
 * public internet host rather than something inside our own network, because
 * a crawler that follows links is exactly the thing that turns a stray URL
 * into a request against an internal address.
 */
export function isPublicHttpUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase();
  if (!host.includes('.') || host.endsWith('.local') || host === 'localhost') return false;
  const literal = parseIpLiteral(host);
  if (literal && isBlockedCategory(classifyIp(literal))) return false;
  return true;
}

/* ------------------------------------------------------------------ *
 * Sitemaps                                                            *
 * ------------------------------------------------------------------ */

const LOC_RE = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;

/** Every <loc> in a sitemap or sitemap index. */
export function sitemapLocations(xml: string): string[] {
  return [...xml.matchAll(LOC_RE)].map((m) => m[1].trim()).filter(Boolean);
}

/** True when the document is an index of other sitemaps rather than of pages. */
export function isSitemapIndex(xml: string): boolean {
  return /<sitemapindex[\s>]/i.test(xml);
}

/**
 * Which child sitemaps are worth opening.
 *
 * A sitemap index names dozens of files and each is megabytes. Fetching all of
 * them for one property would be a crawl of the whole site, so the names are
 * read for what they say they contain: buildings, developers and listings are
 * where a property lives; blog and news archives are not.
 */
const USEFUL_SITEMAP = /(building|realty|listing|object|property|flat|apartment|sale|developer|project|house|estate)/i;
const USELESS_SITEMAP = /(blog|news|article|press|help|faq|static|page_|author|tag)/i;

export function rankChildSitemaps(locs: readonly string[]): string[] {
  return locs
    .filter((l) => !USELESS_SITEMAP.test(l))
    .sort((a, b) => Number(USEFUL_SITEMAP.test(b)) - Number(USEFUL_SITEMAP.test(a)));
}

/* ------------------------------------------------------------------ *
 * Links out of a page                                                 *
 * ------------------------------------------------------------------ */

/*
 * A FRAGMENT IS PART OF THE ATTRIBUTE, NOT PART OF THE URL.
 *
 * This excluded `#` from the captured group AND required the closing quote
 * straight after it, so every href carrying a fragment matched nothing at all
 * and was invisible to the crawler. The whole attribute is taken and the
 * fragment is dropped afterwards, where dropping it is a parse rather than a
 * pattern.
 */
const HREF_RE = /<a\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi;
const CANONICAL_RE = /<link\b[^>]*\brel\s*=\s*["']canonical["'][^>]*\bhref\s*=\s*["']([^"'#]+)["']/i;

export function canonicalOf(html: string, base: string): string | null {
  const m = CANONICAL_RE.exec(html);
  if (!m) return null;
  try {
    return new URL(m[1], base).toString();
  } catch {
    return null;
  }
}

/** Absolute links out of a page, deduplicated and fragment-free. */
export function linksFrom(html: string, base: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(HREF_RE)) {
    try {
      const u = new URL(m[1], base);
      u.hash = '';
      out.add(u.toString());
    } catch {
      // A malformed href is not a link.
    }
  }
  return [...out];
}

/* ------------------------------------------------------------------ *
 * The run                                                             *
 * ------------------------------------------------------------------ */

export interface CodeDiscoveryLedgerRow {
  url: string;
  domain: string;
  domainClass: DomainClass;
  path: DiscoveryPath;
  depth: number;
  httpStatus: number;
  outcome: DiscoveryOutcome | 'ROBOTS_DISALLOWED' | 'FETCH_FAILED' | 'NOT_A_LISTING';
  tier?: GeoTier;
  capabilities?: SourceCapability[];
}

export interface DomainLearning {
  domain: string;
  class: DomainClass;
  seeded: boolean;
  capabilities: SourceCapability[];
  pagesFetched: number;
  extracted: number;
  localResults: number;
  robotsAllowed: boolean;
  accepted: boolean;
  reason: string;
}

export interface CodeDiscoveryReport {
  /* Cost, stated so it cannot be assumed. */
  searchApiCalls: 0;
  codeDiscoveryRequests: number;
  pagesFetched: number;
  browserPagesFetched: number;
  sitemapsUsed: number;
  categoryPagesUsed: number;
  robotsDisallowed: number;
  fetchFailures: number;
  truncatedByDeadline: boolean;

  domainsVisited: readonly string[];
  newDomainsDiscovered: readonly string[];
  newDomainsAccepted: readonly string[];
  newDomainsRejected: readonly string[];
  perDomain: readonly DomainLearning[];

  rawListings: number;
  listings: readonly DiscoveredListing[];
  duplicatesRemoved: number;
  ledger: readonly CodeDiscoveryLedgerRow[];
  outcomes: Record<string, number>;

  tierCounts: Readonly<Record<GeoTier, number>>;
  tierCountsMeasurable: Readonly<Record<GeoTier, number>>;
  tierStats: ReturnType<typeof statsByTier>;
  headline: ReturnType<typeof headlineTier>;
  knownPublicLocalEvidenceDiscovered: boolean;
}

export interface RunCodeDiscoveryOptions {
  subject: CodeDiscoverySubject;
  /** Seed entry points, in the order they should be tried. */
  seeds: readonly DiscoveryTarget[];
  fetcher: CrawlFetcher;
  budget?: Partial<CrawlBudget>;
  userAgent?: string;
  now?: () => number;
  /** Domains already known, so newly met ones can be reported as new. */
  seededDomains?: ReadonlySet<string>;
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

const LD_RE = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

function ldBlocks(html: string): unknown[] {
  const out: unknown[] = [];
  for (const m of html.matchAll(LD_RE)) {
    try {
      const parsed = JSON.parse(m[1].trim());
      if (Array.isArray(parsed)) out.push(...parsed);
      else out.push(parsed);
    } catch {
      // Invalid JSON-LD is common and is not an error here.
    }
  }
  return out;
}

function visibleText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, '\n')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}

export async function runCodeDiscovery(
  options: RunCodeDiscoveryOptions,
): Promise<CodeDiscoveryReport> {
  const budget: CrawlBudget = { ...DEFAULT_CRAWL_BUDGET, ...(options.budget ?? {}) };
  const clock = options.now ?? (() => Date.now());
  const startedAt = clock();
  const userAgent = options.userAgent ?? 'HomatchResearch/1.0';
  const seeded = options.seededDomains ?? new Set<string>();
  const tokens = slugTokens(options.subject);

  const ledger: CodeDiscoveryLedgerRow[] = [];
  const learnings = new Map<string, DomainLearning>();
  const robotsByHost = new Map<string, RobotsFile>();
  const perDomainCount = new Map<string, number>();
  const seenUrls = new Set<string>();
  const found: DiscoveredListing[] = [];

  let requests = 0;
  let pagesFetched = 0;
  let browserPages = 0;
  let sitemapsUsed = 0;
  let categoryPages = 0;
  let robotsDisallowed = 0;
  let fetchFailures = 0;
  let localSoFar = 0;
  let truncatedByDeadline = false;

  const outOfTime = () => clock() - startedAt >= budget.deadlineMs;

  const learningFor = (domain: string): DomainLearning => {
    let l = learnings.get(domain);
    if (!l) {
      l = {
        domain,
        class: classifyDomain(domain),
        seeded: seeded.has(domain),
        capabilities: [],
        pagesFetched: 0,
        extracted: 0,
        localResults: 0,
        robotsAllowed: true,
        accepted: false,
        reason: '',
      };
      learnings.set(domain, l);
    }
    return l;
  };
  const learn = (l: DomainLearning, cap: SourceCapability) => {
    if (!l.capabilities.includes(cap)) l.capabilities.push(cap);
  };

  /**
   * robots.txt for a host, fetched once and obeyed.
   *
   * A host whose robots cannot be read is treated as permitting the fetch,
   * matching the standard: an ABSENT robots file is not a prohibition. A file
   * that says no is final and is recorded, because "we were asked not to read
   * this" and "there was nothing here" are different facts.
   */
  const robotsFor = async (host: string): Promise<RobotsFile> => {
    const cached = robotsByHost.get(host);
    if (cached) return cached;
    let file = EMPTY_ROBOTS;
    try {
      requests += 1;
      const res = await options.fetcher.fetch(`https://${host}/robots.txt`);
      if (res.ok && res.body) file = parseRobotsTxt(res.body);
    } catch {
      // Unreadable robots is an absent robots.
    }
    robotsByHost.set(host, file);
    return file;
  };

  const allowedByRobots = async (url: string): Promise<boolean> => {
    try {
      const parsed = new URL(url);
      const file = await robotsFor(parsed.hostname.toLowerCase());
      return isAllowed(file, userAgent, `${parsed.pathname}${parsed.search}`).allowed;
    } catch {
      return false;
    }
  };

  /* The frontier. Seeds first, discovered links after, never deeper than the
   * budget allows — breadth first, because a listing is usually one hop from a
   * category page and never twenty. */
  const queue: DiscoveryTarget[] = [...options.seeds];

  while (queue.length) {
    if (outOfTime()) { truncatedByDeadline = true; break; }
    if (pagesFetched >= budget.maxPages) break;
    if (localSoFar >= budget.enoughLocal) break;

    const target = queue.shift() as DiscoveryTarget;
    if (seenUrls.has(target.url)) continue;
    seenUrls.add(target.url);
    if (!isPublicHttpUrl(target.url)) continue;

    const domain = hostOf(target.url);
    if (!domain) continue;
    const learning = learningFor(domain);

    if (!worthExtracting(learning.class)) {
      learning.reason = learning.reason || `classified ${learning.class}`;
      ledger.push({
        url: target.url, domain, domainClass: learning.class, path: target.path,
        depth: target.depth, httpStatus: 0, outcome: 'SOURCE_NOT_SUPPORTED',
      });
      continue;
    }

    const used = perDomainCount.get(domain) ?? 0;
    if (used >= budget.maxPagesPerDomain) continue;

    if (!(await allowedByRobots(target.url))) {
      robotsDisallowed += 1;
      learning.robotsAllowed = false;
      learning.reason = 'robots.txt disallows this path';
      ledger.push({
        url: target.url, domain, domainClass: learning.class, path: target.path,
        depth: target.depth, httpStatus: 0, outcome: 'ROBOTS_DISALLOWED',
      });
      continue;
    }

    let res: CrawlFetchResult;
    try {
      requests += 1;
      res = await options.fetcher.fetch(target.url);
    } catch {
      res = { ok: false, status: 0, body: '' };
    }
    perDomainCount.set(domain, used + 1);

    if (!res.ok || !res.body) {
      fetchFailures += 1;
      learning.reason = learning.reason || `fetch returned ${res.status}`;
      ledger.push({
        url: target.url, domain, domainClass: learning.class, path: target.path,
        depth: target.depth, httpStatus: res.status, outcome: 'FETCH_FAILED',
      });
      continue;
    }
    pagesFetched += 1;
    learning.pagesFetched += 1;
    if (options.fetcher.canDriveBrowser) browserPages += 1;

    const looksXml = /^\s*<\?xml|<urlset[\s>]|<sitemapindex[\s>]/i.test(res.body);

    /* ---------------- a sitemap ---------------- */
    if (looksXml) {
      sitemapsUsed += 1;
      learn(learning, 'SITEMAP');
      const locs = sitemapLocations(res.body);
      if (isSitemapIndex(res.body)) {
        for (const child of rankChildSitemaps(locs).slice(0, 4)) {
          queue.push({
            url: child, path: 'SITEMAP_INDEX_CHILD', depth: target.depth,
            reason: 'child sitemap likely to hold property pages',
          });
        }
      } else {
        /*
         * THE SLUG FILTER IS THE WHOLE DISCOVERY STEP.
         *
         * building_landing.xml holds every building korter.ge knows. Fetching
         * all of them would be a crawl of Georgia; matching the street name
         * against the slug reduces it to the 55 that say Krtsanisi, one of
         * which is the subject's own building.
         */
        const matched = rankSubjectUrls(locs, tokens, options.subject.streetNumber ?? null);
        for (const url of matched.slice(0, budget.maxPagesPerDomain)) {
          queue.push({
            url, path: 'SEED_DOMAIN_SITEMAP', depth: target.depth + 1,
            reason: 'sitemap url names the subject street or project',
          });
        }
      }
      ledger.push({
        url: target.url, domain, domainClass: learning.class, path: target.path,
        depth: target.depth, httpStatus: res.status, outcome: 'VALID_CONTEXT_RESULT',
        capabilities: ['SITEMAP'],
      });
      continue;
    }

    /* ---------------- a page ---------------- */
    const blocks = ldBlocks(res.body);
    if (blocks.length) learn(learning, 'JSON_LD');
    learn(learning, 'STATIC_HTML');

    const ctx = {
      url: target.url,
      sourceDomain: domain,
      streetHints: options.subject.streetHints,
    };
    const listing: ExtractedListing | null =
      fromLdJson(blocks, ctx) ?? fromPageText(visibleText(res.body), ctx);

    if (target.depth < budget.maxDepth) {
      /*
       * Links are followed only where they name the subject. A category page
       * lists the street's inventory; following everything else would turn a
       * bounded discovery into an unbounded crawl of somebody's whole site.
       */
      const links = linksFrom(res.body, target.url)
        .filter((l) => isPublicHttpUrl(l)
          && couldBeAPropertySource(hostOf(l))
          && urlMatchesSubject(l, tokens));
      for (const url of links.slice(0, 10)) {
        queue.push({
          url, path: 'PAGE_LINK', depth: target.depth + 1,
          reason: 'link on a relevant page names the subject street or project',
        });
      }
      if (links.length) { categoryPages += 1; learn(learning, 'CATEGORY_PAGE'); }
    }

    if (!listing) {
      ledger.push({
        url: target.url, domain, domainClass: learning.class, path: target.path,
        depth: target.depth, httpStatus: res.status, outcome: 'NOT_A_LISTING',
        capabilities: learning.capabilities.slice(),
      });
      continue;
    }
    learning.extracted += 1;
    learn(learning, listing.isProjectPage ? 'PROJECT_PAGE' : 'LISTING_PAGE');

    if (!listing.address && listing.lat == null && !listing.project) {
      ledger.push({
        url: target.url, domain, domainClass: learning.class, path: target.path,
        depth: target.depth, httpStatus: res.status,
        outcome: 'EXTRACTED_BUT_ADDRESS_FAILED',
      });
      continue;
    }

    const tier = tierOfDiscovered(listing, options.subject);
    const isLocal = LOCAL_TIERS.includes(tier);
    if (isLocal) { localSoFar += 1; learning.localResults += 1; }
    learning.accepted = true;
    learning.reason = learning.reason || 'public page yielded a normalized listing';

    ledger.push({
      url: target.url, domain, domainClass: learning.class, path: target.path,
      depth: target.depth, httpStatus: res.status,
      outcome: isLocal ? 'VALID_LOCAL_RESULT' : 'VALID_CONTEXT_RESULT',
      tier,
      capabilities: learning.capabilities.slice(),
    });

    found.push({
      ...listing,
      tier,
      confidence: 'PAGE',
      query: target.reason,
      language: 'en',
      measurable:
        (listing.area ?? 0) > 0 || (listing.pricePerSqm ?? 0) > 0 || (listing.price ?? 0) > 0,
    });
  }

  const { unique, duplicatesRemoved } = dedupeSyndicated(
    found as (DiscoveredListing & ListingLike)[],
  );

  const tierCounts = Object.fromEntries(TIER_ORDER.map((t) => [t, 0])) as Record<GeoTier, number>;
  const tierCountsMeasurable = Object.fromEntries(
    TIER_ORDER.map((t) => [t, 0]),
  ) as Record<GeoTier, number>;
  for (const l of unique) {
    tierCounts[l.tier] += 1;
    if (l.measurable) tierCountsMeasurable[l.tier] += 1;
  }

  const outcomes: Record<string, number> = {};
  for (const row of ledger) outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;
  outcomes.DUPLICATE = (outcomes.DUPLICATE ?? 0) + duplicatesRemoved;

  const visited = [...learnings.keys()].sort();
  const fresh = visited.filter((d) => !seeded.has(d));
  const stats = statsByTier(unique, (l) => l.tier);

  return {
    searchApiCalls: 0,
    codeDiscoveryRequests: requests,
    pagesFetched,
    browserPagesFetched: browserPages,
    sitemapsUsed,
    categoryPagesUsed: categoryPages,
    robotsDisallowed,
    fetchFailures,
    truncatedByDeadline,

    domainsVisited: visited,
    newDomainsDiscovered: fresh,
    newDomainsAccepted: fresh.filter((d) => learnings.get(d)?.accepted),
    newDomainsRejected: fresh.filter((d) => !learnings.get(d)?.accepted),
    perDomain: [...learnings.values()].sort((a, b) => b.extracted - a.extracted),

    rawListings: found.length,
    listings: unique,
    duplicatesRemoved,
    ledger,
    outcomes,

    tierCounts,
    tierCountsMeasurable,
    tierStats: stats,
    headline: headlineTier(stats),
    knownPublicLocalEvidenceDiscovered: LOCAL_TIERS.some((t) => tierCounts[t] > 0),
  };
}
