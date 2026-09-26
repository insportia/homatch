// HOMATCH RESEARCH CORE — deciding what a candidate source actually is.
//
// scripts/audit-source-shape.mjs has done this by hand for every source in the
// registry, and it says so in as many words: "This script decides nothing. A
// shape here is a finding to read, not a source to enable." A person read the
// output and wrote the row.
//
// That is why the registry has 47 sources and not 470. The ladder in
// source-lifecycle.ts models DISCOVERED -> AUDITED -> ... and nothing in
// production ever advanced a source along it, because the only thing that
// could was a script on somebody's laptop.
//
// So this is the same judgement, made by code, from documents somebody else
// fetched. It is deliberately PURE: no network, no database, no clock. The
// caller fetches at most five documents through the runtime that owns robots,
// rate limiting and the host allowlist, and hands them here.
//
// WHAT IT WILL NOT DO
//
// Decide that a source is worth implementing. It reports what the site
// publishes and what stands in the way; whether that is worth an adapter is a
// business judgement that belongs to priority_tier and to a person.
//
// Guess. Every field it cannot establish comes back null or UNKNOWN. A source
// audit that fills gaps with plausible defaults is how a registry ends up
// full of confident fiction about sites nobody has read.

/** What the audit concluded about reaching this source at all. */
export type AuditAccess =
  /** robots permits the listing paths and a page was read. */
  | 'PUBLIC_HTML'
  /** robots is served and forbids what we would need. */
  | 'ROBOTS_DISALLOWED'
  /** The host answered 401/403 to an identifying agent. */
  | 'ANTI_BOT'
  /** Nothing answered at all. */
  | 'UNREACHABLE'
  /** Reached, but nothing here says whether it can be read usefully. */
  | 'UNKNOWN';

/** Whether the site publishes anything a deterministic reader can use. */
export type AuditShape =
  /** schema.org or embedded data on a detail page. */
  | 'STRUCTURED'
  /** Server-rendered prose and links, no structured data. */
  | 'SERVER_RENDERED'
  /** Large document, almost no text: rendered in the browser. */
  | 'CLIENT_RENDERED'
  /** Not enough was read to say. */
  | 'UNKNOWN';

export interface FetchedDocument {
  url: string;
  status: number;
  body: string;
}

export interface AuditInput {
  host: string;
  /** /robots.txt, whatever it answered. */
  robots: FetchedDocument | null;
  /** /sitemap.xml or the index a robots Sitemap: line named. */
  sitemap: FetchedDocument | null;
  /** One child sitemap, when the first was an index. */
  childSitemap?: FetchedDocument | null;
  /** One page believed to be a listing. */
  detail?: FetchedDocument | null;
}

export interface AuditFinding {
  host: string;
  access: AuditAccess;
  shape: AuditShape;
  /** Disallow rules that apply to every agent, ours included. */
  robotsDisallow: string[];
  /** Seconds the site asked crawlers to wait, when it said. */
  crawlDelaySeconds: number | null;
  /** How many <loc> entries were seen across the sitemaps read. */
  sitemapUrls: number;
  /** Child sitemaps a sitemap index named. */
  childSitemaps: string[];
  /** Path shapes seen in the sitemap, most frequent first. */
  pathShapes: Array<{ shape: string; count: number }>;
  /** schema.org @type values a detail page published. */
  jsonLdTypes: string[];
  /** Bytes and visible text of the detail page, when one was read. */
  detailBytes: number | null;
  detailVisibleText: number | null;
  /**
   * One sentence a person can read, assembled from what was actually seen.
   * Never a recommendation, and never a number nothing measured.
   */
  evidence: string;
}

/* ── robots ──────────────────────────────────────────────────────────────── */

interface RobotsGroup {
  agents: string[];
  disallow: string[];
  crawlDelay: number | null;
  started: boolean;
}

/**
 * The rules that apply to US, which is the `*` group.
 *
 * A site granting one named crawler generous rules tells us nothing about our
 * own permission, so named groups are counted and not obeyed on our behalf.
 */
export function parseRobots(text: string): { disallow: string[]; crawlDelay: number | null; groups: number } {
  const groups: RobotsGroup[] = [];
  let current: RobotsGroup | null = null;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [keyRaw, ...rest] = line.split(':');
    const key = keyRaw.trim().toLowerCase();
    const value = rest.join(':').trim();
    if (key === 'user-agent') {
      if (!current || current.started) {
        current = { agents: [], disallow: [], crawlDelay: null, started: false };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
    } else if (current) {
      current.started = true;
      if (key === 'disallow' && value) current.disallow.push(value);
      if (key === 'crawl-delay' && value) {
        const n = Number(value);
        current.crawlDelay = Number.isFinite(n) ? n : null;
      }
    }
  }
  const star = groups.find((g) => g.agents.includes('*'));
  return {
    disallow: star?.disallow ?? [],
    crawlDelay: star?.crawlDelay ?? null,
    groups: groups.length,
  };
}

/** True when a `*` rule forbids the whole site. */
export function disallowsEverything(disallow: readonly string[]): boolean {
  return disallow.some((rule) => rule.trim() === '/');
}

/* ── sitemaps ────────────────────────────────────────────────────────────── */

export function sitemapLocs(xml: string): string[] {
  return [...String(xml).matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
}

/** A path with id-looking runs collapsed, so shapes can be counted. */
export function pathShape(url: string): string {
  try {
    return new URL(url).pathname
      .replace(/\d{3,}/g, '<id>')
      .replace(/\/[^/]{30,}/g, '/<slug>');
  } catch {
    return url;
  }
}

/* ── what a page publishes ───────────────────────────────────────────────── */

/**
 * Visible text as a fraction of bytes is what separates a server-rendered page
 * from a shell.
 *
 * Measured across the sources audited on 2026-09-26: readable detail pages ran
 * 2,590 to 4,191 characters of text; shells ran 435 to 1,721 in documents of
 * 44KB to 1MB. origencollection.com published 1,346 characters inside
 * 1,085,385 bytes.
 */
const SHELL_TEXT_CEILING = 2000;
const SHELL_BYTES_FLOOR = 40_000;

export function documentShape(html: string): {
  jsonLdTypes: string[];
  bytes: number;
  visibleText: number;
} {
  const types = new Set<string>();
  for (const block of String(html).matchAll(
    /<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    for (const t of block[1].matchAll(/"@type"\s*:\s*"([^"]+)"/g)) types.add(t[1]);
  }
  const visible = String(html)
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length;
  return { jsonLdTypes: [...types].sort(), bytes: String(html).length, visibleText: visible };
}

/* ── the verdict ─────────────────────────────────────────────────────────── */

/** Property-bearing schema.org types. Anything else is a page ABOUT property. */
const PROPERTY_TYPES = new Set([
  'RealEstateListing', 'Apartment', 'House', 'SingleFamilyResidence',
  'Residence', 'Offer', 'AggregateOffer', 'Product', 'Place', 'Accommodation',
]);

export function auditSource(input: AuditInput): AuditFinding {
  const robotsText = input.robots?.status === 200 ? input.robots.body : '';
  const robots = parseRobots(robotsText);

  const locs: string[] = [];
  if (input.sitemap?.status === 200) locs.push(...sitemapLocs(input.sitemap.body));
  const childSitemaps = locs.filter((u) => /\.xml(\.gz)?$/i.test(u));
  if (input.childSitemap?.status === 200) locs.push(...sitemapLocs(input.childSitemap.body));

  const listingLocs = locs.filter((u) => !/\.xml(\.gz)?$/i.test(u));
  const counts = new Map<string, number>();
  for (const url of listingLocs) {
    const shape = pathShape(url);
    counts.set(shape, (counts.get(shape) ?? 0) + 1);
  }
  const pathShapes = [...counts.entries()]
    .map(([shape, count]) => ({ shape, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 12);

  const detail = input.detail && input.detail.status === 200
    ? documentShape(input.detail.body)
    : null;

  /*
   * ACCESS, in the order the evidence settles it.
   *
   * A blanket robots Disallow is decided before anything else: house.ge serves
   * a sitemap of 385 URLs and forbids all of them, and reading its shape would
   * be reading something we may not fetch.
   */
  let access: AuditAccess;
  if (disallowsEverything(robots.disallow)) {
    access = 'ROBOTS_DISALLOWED';
  } else if (
    input.robots?.status === 403 || input.robots?.status === 401
    || input.sitemap?.status === 403 || input.detail?.status === 403
  ) {
    /* dazhomes.com and properstar.com answered 403 to robots.txt ITSELF. */
    access = 'ANTI_BOT';
  } else if (!input.robots && !input.sitemap && !input.detail) {
    access = 'UNREACHABLE';
  } else if (detail || listingLocs.length > 0) {
    access = 'PUBLIC_HTML';
  } else {
    access = 'UNKNOWN';
  }

  let shape: AuditShape;
  if (!detail) {
    shape = 'UNKNOWN';
  } else if (detail.jsonLdTypes.some((t) => PROPERTY_TYPES.has(t))) {
    shape = 'STRUCTURED';
  } else if (detail.visibleText < SHELL_TEXT_CEILING && detail.bytes > SHELL_BYTES_FLOOR) {
    shape = 'CLIENT_RENDERED';
  } else if (detail.visibleText >= SHELL_TEXT_CEILING) {
    shape = 'SERVER_RENDERED';
  } else {
    shape = 'UNKNOWN';
  }

  const parts: string[] = [];
  parts.push(input.robots
    ? `robots ${input.robots.status}, ${robots.disallow.length} disallow for *`
      + (robots.crawlDelay !== null ? `, crawl-delay ${robots.crawlDelay}` : '')
    : 'robots.txt was not read');
  parts.push(input.sitemap
    ? `sitemap ${input.sitemap.status}, ${listingLocs.length} url(s), ${childSitemaps.length} child sitemap(s)`
    : 'no sitemap read');
  if (detail) {
    parts.push(`detail ${detail.bytes} bytes carrying ${detail.visibleText} chars of visible text`);
    parts.push(detail.jsonLdTypes.length
      ? `json-ld: ${detail.jsonLdTypes.join(', ')}`
      : 'no json-ld on the detail page');
  } else {
    parts.push('no detail page read');
  }

  return {
    host: input.host,
    access,
    shape,
    robotsDisallow: robots.disallow,
    crawlDelaySeconds: robots.crawlDelay,
    sitemapUrls: listingLocs.length,
    childSitemaps: childSitemaps.slice(0, 40),
    pathShapes,
    jsonLdTypes: detail?.jsonLdTypes ?? [],
    detailBytes: detail?.bytes ?? null,
    detailVisibleText: detail?.visibleText ?? null,
    evidence: parts.join('; '),
  };
}
