// HOMATCH RESEARCH CORE — CANDIDATE portals: run by the live check, never by a customer.
//
// myhome.ge and livo.ge are the two Georgian portals Phase 2 still lacks. The
// rule this directory lives by (market/runtime.ts survey note) is that an
// adapter is written against a CAPTURED page, never a guessed one -- and
// neither page can be captured from where this was written (the sandbox
// cannot reach Georgian hosts; myhome.ge answers 403 to every non-browser
// client). So these are not configured the usual way. They guess NOTHING
// site-specific:
//
//   where listings are   read from the site's own robots.txt `Sitemap:`
//                        declarations at run time, never a hard-coded path
//   which URL is a       a listing URL carries a numeric id of 6-10 digits in
//   listing              its path (the shape every audited Georgian portal
//                        uses); anything else in the sitemap is ignored
//   what the page says   schema.org JSON-LD and OpenGraph -- standards, not
//                        selectors -- plus multilingual text patterns for
//                        area / rooms / floor that every portal prints
//   sale vs rent         the Georgian transliteration in the path
//                        (iyideba = for sale, qiravdeba = for rent), a
//                        language convention shared by place.ge and home.ge;
//                        otherwise the page's own Offer decides
//
// They are registered ONLY when createPortalRuntime({ includeCandidates: true })
// asks -- which only the source-audit live check does -- so no Find Property
// run, campaign or Verify comparable can reach them. A passing live check is
// evidence to pin a real configuration from (captured fixture, exact routes);
// it does not promote anything by itself.

import type { AdapterContext, AdapterOutcome } from '../../discovery/adapter.ts';
import { DEFAULT_SOURCE_POLICY, type SourcePolicy } from '../../net/source-policy.ts';
import { unwrapRenderedText } from '../../fetch/browser-transport.ts';
import { ConfiguredPortalAdapter } from './configured.ts';

export { unwrapRenderedText };
import type { EnrichmentRule, PortalSourceConfig } from './family.ts';
import type { ListingPortalAdapter, ListingQuery, ListingSearchResult } from './types.ts';

export const CANDIDATE_ADAPTER_VERSION = 'candidate-portal-1.0.0';

/* Multilingual, generic, and recorded as TEXT provenance (the weakest kind). */
const TEXT_RULES: EnrichmentRule[] = [
  { field: 'areaSqm', from: 'TEXT_PATTERN', pattern: /(\d{1,5}(?:[.,]\d{1,2})?)\s*(?:მ²|მ2|კვ\.?\s?მ|м²|м2|кв\.?\s?м|m²|m2|sq\.?\s?m)(?![\p{L}\d])/iu },
  { field: 'rooms', from: 'TEXT_PATTERN', pattern: /(\d{1,2})\s*(?:-?\s*ოთახიან|\s*ოთახ|-?\s*комн|\s*rooms?\b)/iu },
  { field: 'bedrooms', from: 'TEXT_PATTERN', pattern: /(\d{1,2})\s*(?:საძინებ|спальн|bedrooms?\b)/iu },
  { field: 'floor', from: 'TEXT_PATTERN', pattern: /(\d{1,3})\s*\/\s*\d{1,3}\s*(?:სართ|этаж|floor)/iu },
];

const TRANSACTION_FROM_URL = [
  { match: /(?:^|[/-])iyideba(?:[/-]|$)|for-sale|prodaet/i, transaction: 'SALE' as const },
  { match: /(?:^|[/-])qiravdeba(?:[/-]|$)|for-rent|sdaet|arenda/i, transaction: 'RENT' as const },
];

export const MYHOME_GE: PortalSourceConfig = {
  id: 'myhome-ge',
  host: 'www.myhome.ge',
  family: 'PROPERTY_PORTAL',
  strategy: 'SCHEMA_ORG',
  countryCode: 'GE',
  languages: ['ka', 'en', 'ru'],
  /* A 6-10 digit id as a path segment or the tail of a slug. Public listing
     links seen in search results take this shape (…/krtsanisi-20592132). */
  detailUrl: { pattern: /myhome\.ge\/(?:[a-z]{2}\/)?(?:[^?#]*?[/-])?(\d{6,10})(?:[/-][^?#]*)?\/?(?:[?#].*)?$/i, idGroup: 1 },
  transactionFromUrl: TRANSACTION_FROM_URL,
  saleBasis: 'ASKING_SALE_PRICE',
  rentBasis: 'ASKING_RENT',
  enrich: TEXT_RULES,
};

export const LIVO_GE: PortalSourceConfig = {
  id: 'livo-ge',
  host: 'livo.ge',
  family: 'PROPERTY_PORTAL',
  strategy: 'SCHEMA_ORG',
  countryCode: 'GE',
  languages: ['ka', 'en', 'ru'],
  detailUrl: { pattern: /livo\.ge\/(?:[a-z]{2}\/)?(?:[^?#]*?[/-])?(\d{6,10})(?:[/-][^?#]*)?\/?(?:[?#].*)?$/i, idGroup: 1 },
  transactionFromUrl: TRANSACTION_FROM_URL,
  saleBasis: 'ASKING_SALE_PRICE',
  rentBasis: 'ASKING_RENT',
  enrich: TEXT_RULES,
};

/** How each candidate must be fetched. myhome.ge refuses non-browser clients. */
export const CANDIDATE_RENDERING: Readonly<Record<string, 'HTTP' | 'BROWSER'>> = {
  'myhome-ge': 'BROWSER',
  'livo-ge': 'HTTP',
};

export const CANDIDATE_POLICIES: SourcePolicy[] = [
  {
    ...DEFAULT_SOURCE_POLICY,
    id: 'portal:myhome.ge',
    domains: ['myhome.ge'],
    hosts: ['www.myhome.ge', 'myhome.ge'],
    sourceFamily: 'myhome.ge',
    kind: 'PROPERTY_PORTAL',
    enabled: true,
    allowedMethods: ['GET'],
    /* First contact, and every page may be a browser render: one at a time, slowly. */
    rate: { concurrency: 1, requestsPerSecond: 0.2, burst: 1 },
    robots: 'RESPECT',
    browserRenderingAllowed: true,
    maxResponseBytes: 4_000_000,
    timeoutMs: 40_000,
    cacheTtlMs: 30 * 60 * 1000,
    cacheStaleMs: 2 * 60 * 60 * 1000,
    visibility: 'PUBLIC',
    authority: 0.5,
    notes: 'CANDIDATE. 403 to non-browser clients (2026-09-20). Read only through the discovery browser; a challenge page is a refusal, never worked around.',
  },
  {
    ...DEFAULT_SOURCE_POLICY,
    id: 'portal:livo.ge',
    domains: ['livo.ge'],
    hosts: ['livo.ge', 'www.livo.ge'],
    sourceFamily: 'livo.ge',
    kind: 'PROPERTY_PORTAL',
    enabled: true,
    allowedMethods: ['GET'],
    rate: { concurrency: 1, requestsPerSecond: 0.2, burst: 1 },
    robots: 'RESPECT',
    browserRenderingAllowed: false,
    maxResponseBytes: 8_000_000,
    timeoutMs: 20_000,
    cacheTtlMs: 30 * 60 * 1000,
    cacheStaleMs: 2 * 60 * 60 * 1000,
    visibility: 'PUBLIC',
    authority: 0.5,
    notes: 'CANDIDATE. Never surveyed; the live check reads its declared sitemaps and structured data.',
  },
];

/** Sitemap URLs a robots.txt declares, same host only, http(s) only. */
export function declaredSitemaps(robotsTxt: string, host: string): string[] {
  const out: string[] = [];
  for (const m of String(robotsTxt).matchAll(/^\s*sitemap\s*:\s*(\S+)\s*$/gim)) {
    try {
      const url = new URL(m[1]);
      const sameSite = url.hostname === host || url.hostname.endsWith(`.${host.replace(/^www\./, '')}`) || host.endsWith(url.hostname);
      if ((url.protocol === 'https:' || url.protocol === 'http:') && sameSite && !out.includes(url.toString())) out.push(url.toString());
    } catch { /* not a URL */ }
  }
  return out.slice(0, 10);
}

/** A sitemap index's children, listing-looking names first. */
export function childSitemaps(xml: string): string[] {
  if (!/<sitemapindex/i.test(xml)) return [];
  const locs = [...String(xml).matchAll(/<sitemap>[\s\S]*?<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
  const listingLike = /(statement|listing|ads?\b|product|realty|real-estate|property|udzravi|binebi|pr[-_])/i;
  return [...locs.filter((l) => listingLike.test(l)), ...locs.filter((l) => !listingLike.test(l))].slice(0, 6);
}

export class CandidatePortalAdapter implements ListingPortalAdapter {
  readonly id: string;
  readonly sourceFamily: string;
  readonly countries: readonly string[];
  readonly candidate = true;
  private readonly config: PortalSourceConfig;

  constructor(config: PortalSourceConfig) {
    this.config = config;
    this.id = config.id;
    this.sourceFamily = config.host;
    this.countries = [config.countryCode];
  }

  supports(query: ListingQuery): boolean {
    return this.countries.includes(String(query.countryCode ?? '').toUpperCase())
      && (query.transaction === 'SALE' || query.transaction === 'RENT');
  }

  handles(url: string): boolean {
    return this.config.detailUrl.pattern.test(url);
  }

  canonicalize(url: string): string | null {
    if (!this.handles(url)) return null;
    try {
      const parsed = new URL(url);
      parsed.hash = '';
      return parsed.toString();
    } catch {
      return null;
    }
  }

  async searchListings(query: ListingQuery, context: AdapterContext): Promise<AdapterOutcome<ListingSearchResult>> {
    let robots;
    try {
      robots = await context.fetchDocument(`https://${this.config.host}/robots.txt`);
    } catch (error) {
      return { ok: false, reason: 'NETWORK_ERROR', detail: `robots.txt: ${error instanceof Error ? error.message : String(error)}` };
    }
    if (robots.status === 401 || robots.status === 403) {
      return { ok: false, reason: 'BLOCKED', detail: `robots.txt answered HTTP ${robots.status}` };
    }
    const declared = declaredSitemaps(unwrapRenderedText(robots.body), this.config.host);
    if (!declared.length) {
      return { ok: false, reason: 'PARSE_FAILED', detail: 'robots.txt declares no sitemap; no listing URL can be found without guessing' };
    }

    /* Expand one level of sitemap index, listing-looking children first. */
    const sitemaps: string[] = [];
    let networkRequests = 1;
    for (const url of declared.slice(0, 2)) {
      try {
        const doc = await context.fetchDocument(url);
        networkRequests += 1;
        if (doc.status >= 400) continue;
        const children = childSitemaps(unwrapRenderedText(doc.body));
        if (children.length) sitemaps.push(...children);
        else sitemaps.push(url);
      } catch { /* the next declared sitemap may answer */ }
      if (sitemaps.length >= 4) break;
    }
    if (!sitemaps.length) return { ok: false, reason: 'NOT_FOUND', detail: 'no declared sitemap could be read' };

    const delegate = new ConfiguredPortalAdapter({
      config: this.config,
      routes: [{
        transaction: query.transaction as 'SALE' | 'RENT',
        url: sitemaps[0],
        sitemap: { pathPattern: this.config.detailUrl.pattern, alsoTry: sitemaps.slice(1, 4) },
      }],
    });
    /* The delegate reads the sitemap through a context that unwraps a rendered XML view. */
    const unwrapping: AdapterContext = {
      ...context,
      fetchDocument: async (url, options) => {
        const doc = await context.fetchDocument(url, options);
        return /\.xml(\?|$)/i.test(url) ? { ...doc, body: unwrapRenderedText(doc.body) } : doc;
      },
    };
    const outcome = await delegate.searchListings(query, unwrapping);
    if (!outcome.ok) return outcome;
    return {
      ok: true,
      value: {
        ...outcome.value,
        networkRequests: outcome.value.networkRequests + networkRequests,
        listings: outcome.value.listings.map((l) => ({ ...l, matchRationale: `candidate ${this.id}: robots-declared sitemap, structured data` })),
      },
    };
  }
}

export function candidateAdapters(): CandidatePortalAdapter[] {
  return [new CandidatePortalAdapter(MYHOME_GE), new CandidatePortalAdapter(LIVO_GE)];
}
