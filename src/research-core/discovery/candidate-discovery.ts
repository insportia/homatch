// THE DISCOVER STEP. Where a candidate source actually comes from.
//
// Until now it came from a person running a script, and the audit step had no
// producer at all — 314 rows sat in DISCOVERED and not one of them was a
// candidate website. This is the producer.
//
// WHERE CANDIDATES COME FROM, AND WHY IT IS THIS
//
// From the outbound links of sources Homatch is ALREADY permitted to read.
//
// That is not a compromise forced by DataForSEO and Apify being retired. It is
// the better mechanism, for a reason that matters: a Georgian property portal's
// partner list, an agency directory's members page and a developer index are
// pages whose whole purpose is to name the other real participants in this
// market. A search API returns what ranks; a market's own cross-references
// return what exists. And every candidate arrives with its provenance attached
// — "linked from THIS url, under THIS anchor text" — which is evidence a human
// can check, not a score a vendor asserted.
//
// WHAT IT WILL NOT DO
//
//   - It will not invent a domain. Every candidate is a link that was present
//     in a document we fetched, and the document URL is recorded with it.
//   - It will not activate anything. Output is CANDIDATE rows for the
//     DISCOVERED rung; nothing here sets active, adapter_id or priority_tier.
//   - It will not follow its own output. Harvesting from an unaudited candidate
//     would let one site nominate a thousand, and the nominee's nominees are not
//     evidence of anything. Only sources that have reached PERMITTED or beyond
//     are harvested from, and that list is passed in.
//   - It will not claim a family. A hostname does not tell you whether a site
//     is a portal or a blog; the audit reads it and decides.
//
// THE OBJECTIVE
//
// A DiscoveryObjective says what we are looking for — market, languages, the
// intent side (supply, demand or both), and family hints. It is used to SCORE
// and to explain, never to fabricate: a candidate with no signal scores zero and
// is still reported as a candidate with zero, because "we found this and it
// looks unpromising" is information and silently dropping it is not.

import type { ResearchLanguage } from './lexicon.ts';
import type { SourceFamily } from './source-lifecycle.ts';

export type DiscoveryIntent = 'SUPPLY' | 'DEMAND' | 'BOTH';

export interface DiscoveryObjective {
  /** ISO country code. 'GE' for Georgia. */
  market: string;
  /** Languages the market is discussed in. */
  languages: readonly ResearchLanguage[];
  /** Are we short of listings, of buyers, or of both? */
  intent: DiscoveryIntent;
  /** Families worth having more of. A hint for ranking, never a filter. */
  familyHints?: readonly SourceFamily[];
  /** City or region, when the gap is geographic rather than national. */
  region?: string | null;
}

export interface HarvestSource {
  /** The document the links came from. Provenance, and it is mandatory. */
  url: string;
  /** Its registrable domain, so self-links can be told from outbound ones. */
  domain: string;
  /** The HTML. */
  html: string;
  /** The lifecycle rung it had reached. Only PERMITTED and beyond are harvested. */
  lifecycle: string;
}

export interface CandidateLink {
  /** Normalised absolute URL of the candidate's front page. */
  url: string;
  host: string;
  domain: string;
  /** Every anchor text this host was linked under, deduplicated. */
  anchors: string[];
  /** How many separate links on the page pointed at this host. */
  linkCount: number;
  /** The documents that linked to it. Provenance, never empty. */
  discoveredFrom: string[];
  /** 0..1. A ranking hint with a stated reason, not a quality claim. */
  relevance: number;
  /** Why that number. Written to the row so nobody has to guess. */
  rationale: string;
}

/** Lifecycle rungs whose documents may be harvested for links. */
const HARVESTABLE = new Set([
  'PERMITTED', 'IMPLEMENTED', 'FIXTURE_TESTED', 'LIVE_TESTED', 'PRODUCTIVE',
]);

/**
 * Hosts that are never candidates, however often they are linked.
 *
 * Every page on the internet links to these and none of them is a Georgian
 * property source. Without this list the top twenty candidates from any harvest
 * are Facebook, Google Maps, a CDN and a cookie-consent vendor.
 *
 * Community platforms are here too, and that is not a judgement about their
 * value: a link to `facebook.com/SomeAgency` is worth following up, but it is
 * a COMMUNITY_IDENTIFIER (see candidate-classification.ts) and reaches the
 * registry through that route, not as a candidate website.
 */
const NEVER_A_CANDIDATE = [
  // Search, ads, analytics, tag managers.
  'google.com', 'google.ge', 'gstatic.com', 'googleapis.com', 'googletagmanager.com',
  'google-analytics.com', 'doubleclick.net', 'bing.com', 'yandex.ru', 'yandex.net',
  'yandex.com', 'mc.yandex.ru', 'duckduckgo.com',
  // Social and messaging.
  'facebook.com', 'fb.com', 'fbcdn.net', 'instagram.com', 'twitter.com', 'x.com',
  't.me', 'telegram.me', 'telegram.org', 'whatsapp.com', 'wa.me', 'vk.com',
  'linkedin.com', 'youtube.com', 'youtu.be', 'tiktok.com', 'pinterest.com',
  'threads.net', 'viber.com', 'messenger.com', 'ok.ru', 'reddit.com',
  // Infrastructure, CDNs, fonts, frameworks.
  'cloudflare.com', 'cloudflareinsights.com', 'jquery.com', 'bootstrapcdn.com',
  'jsdelivr.net', 'unpkg.com', 'cdnjs.com', 'fontawesome.com', 'w3.org',
  'schema.org', 'gravatar.com', 'wp.com', 'gmpg.org',
  // App stores, payment, maps, generic utilities.
  'apple.com', 'apps.apple.com', 'play.google.com', 'microsoft.com',
  'openstreetmap.org', 'mapbox.com', 'paypal.com', 'visa.com', 'mastercard.com',
  'wikipedia.org', 'wikimedia.org', 'archive.org',
  // Platform vendors whose subdomains are other people's sites, not sources.
  'wordpress.org', 'wordpress.com', 'wix.com', 'squarespace.com', 'shopify.com',
  'godaddy.com', 'namecheap.com', 'blogspot.com', 'medium.com',
];

/**
 * Anchor and URL words that suggest a link points at a market participant.
 *
 * Latin and Georgian, because a Georgian portal's partner list is written in
 * Georgian. Russian and Turkish are included where the term is the common one.
 * This is a RANKING signal: a hit raises relevance and is named in the
 * rationale, a miss lowers it and says so. Neither decides membership.
 */
const MARKET_WORDS: Array<{ words: string[]; weight: number; why: string }> = [
  { weight: 0.40, why: 'names itself an estate agency',
    words: ['უძრავი ქონება', 'სააგენტო', 'real estate', 'realestate', 'estate agency',
      'realty', 'realtor', 'недвижимость', 'агентство', 'emlak', 'gayrimenkul'] },
  { weight: 0.30, why: 'names itself a developer',
    words: ['დეველოპერი', 'სამშენებლო', 'developer', 'development', 'construction',
      'девелопер', 'застройщик', 'insaat', 'inşaat'] },
  { weight: 0.25, why: 'offers property for sale or rent',
    words: ['იყიდება', 'ქირავდება', 'ბინები', 'for sale', 'for rent', 'apartments',
      'properties', 'listings', 'продажа', 'аренда', 'квартиры', 'satılık', 'kiralık'] },
  { weight: 0.20, why: 'names a Georgian market',
    words: ['tbilisi', 'თბილისი', 'batumi', 'ბათუმი', 'kutaisi', 'ქუთაისი',
      'georgia', 'საქართველო', 'sakartvelo', 'тбилиси', 'батуми', 'грузия'] },
  { weight: 0.15, why: 'is an investment or yield page',
    words: ['investment', 'invest', 'yield', 'rental income', 'ინვესტიცია',
      'инвестиции', 'доходность', 'yatırım'] },
];

/**
 * Anchor words that mark a link as something other than a source, even on a
 * page full of good ones. A privacy policy on a portal is still a privacy
 * policy.
 */
const NOT_A_SOURCE_WORDS = [
  'privacy', 'cookie', 'terms', 'conditions', 'sitemap', 'login', 'sign in',
  'register', 'უფლებები', 'კონფიდენციალურობა', 'политика', 'вход',
  'advertise', 'careers', 'vacancy', 'support', 'help', 'faq',
];

/**
 * Harvest candidate hosts from documents we are permitted to read.
 *
 * Returns candidates ordered by relevance. Nothing is filtered out for scoring
 * low — the caller decides how many to take, and a zero-relevance candidate with
 * honest provenance is still a better row than an invented one.
 */
export function harvestCandidates(
  sources: readonly HarvestSource[],
  objective: DiscoveryObjective,
): CandidateLink[] {
  const byDomain = new Map<string, CandidateLink>();
  const selfDomains = new Set(sources.map((source) => source.domain.toLowerCase()));

  for (const source of sources) {
    // The rule that stops one site nominating a thousand: only a source that
    // has earned PERMITTED or better is allowed to introduce others.
    if (!HARVESTABLE.has(source.lifecycle)) continue;

    for (const link of extractLinks(source.html, source.url)) {
      const parsed = parseLink(link.href);
      if (!parsed) continue;

      const { host, domain } = parsed;

      // Its own pages, and the pages of any other source in this harvest.
      if (selfDomains.has(domain)) continue;
      if (isNeverACandidate(domain, host)) continue;
      if (isNotASource(link.text)) continue;

      const existing = byDomain.get(domain);
      if (existing) {
        existing.linkCount += 1;
        if (link.text && !existing.anchors.includes(link.text)) existing.anchors.push(link.text);
        if (!existing.discoveredFrom.includes(source.url)) existing.discoveredFrom.push(source.url);
        continue;
      }

      byDomain.set(domain, {
        url: `https://${host}/`,
        host,
        domain,
        anchors: link.text ? [link.text] : [],
        linkCount: 1,
        discoveredFrom: [source.url],
        relevance: 0,
        rationale: '',
      });
    }
  }

  const candidates = [...byDomain.values()];
  for (const candidate of candidates) {
    const scored = score(candidate, objective);
    candidate.relevance = scored.relevance;
    candidate.rationale = scored.rationale;
  }

  // Relevance first; then the number of independent documents that linked it,
  // which is the more honest tie-break than raw link count (a footer repeated
  // on every page of one site is one endorsement, not forty).
  return candidates.sort((a, b) =>
    b.relevance - a.relevance
    || b.discoveredFrom.length - a.discoveredFrom.length
    || a.domain.localeCompare(b.domain));
}

export interface Scored {
  relevance: number;
  rationale: string;
}

/**
 * Score a candidate, and say why in words.
 *
 * The rationale is the point. A bare 0.55 tells an operator nothing and cannot
 * be argued with; "linked from 2 permitted sources, anchor names itself an
 * estate agency, names a Georgian market" can be checked and can be wrong out
 * loud.
 */
export function score(candidate: CandidateLink, objective: DiscoveryObjective): Scored {
  const haystack = [candidate.domain, candidate.host, ...candidate.anchors]
    .join(' ')
    .toLowerCase();

  const reasons: string[] = [];
  let relevance = 0;

  for (const group of MARKET_WORDS) {
    const hit = group.words.find((word) => haystack.includes(word.toLowerCase()));
    if (hit) {
      relevance += group.weight;
      reasons.push(group.why);
    }
  }

  // A country-code domain for the market is a genuine signal and a cheap one.
  const ccTld = `.${objective.market.toLowerCase()}`;
  if (candidate.domain.endsWith(ccTld)) {
    relevance += 0.15;
    reasons.push(`a ${ccTld} domain`);
  }

  // Independent endorsement: two permitted sources linking the same host is a
  // much stronger signal than one doing it twice.
  if (candidate.discoveredFrom.length > 1) {
    relevance += 0.10 * Math.min(3, candidate.discoveredFrom.length - 1);
    reasons.push(`linked from ${candidate.discoveredFrom.length} permitted sources`);
  }

  if (reasons.length === 0) {
    return {
      relevance: 0,
      rationale:
        `nothing in ${candidate.domain} or its anchor text names this market, a property ` +
        'business or an intent. Recorded as a candidate with zero relevance rather than ' +
        'discarded, because the link is real and the judgement may be wrong.',
    };
  }

  return {
    relevance: Math.min(1, Number(relevance.toFixed(2))),
    rationale:
      `${reasons.join('; ')}. Discovered from ${candidate.discoveredFrom.length} ` +
      `document(s) while looking for ${objective.intent.toLowerCase()} sources in ` +
      `${objective.market}${objective.region ? `/${objective.region}` : ''}.`,
  };
}

export interface ExtractedLink {
  href: string;
  text: string;
}

/**
 * Pull hrefs and their anchor text out of HTML.
 *
 * A regex, not a DOM, because the core has no DOM in any of the three runtimes
 * it runs in. That is a real limitation and it is the right trade here: a missed
 * link costs us one candidate we will see again on the next harvest, whereas a
 * DOM dependency costs us the Edge Function.
 *
 * Anchor text has its tags stripped and its whitespace collapsed, so
 * `<a href="x"><span>Estate </span> Agency</a>` reads as "Estate Agency" rather
 * than as markup.
 */
export function extractLinks(html: string, baseUrl: string): ExtractedLink[] {
  const out: ExtractedLink[] = [];
  const pattern = /<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))[^>]*>([\s\S]{0,400}?)<\/a>/gi;

  for (const match of html.matchAll(pattern)) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (!raw) continue;

    const absolute = absolutise(raw, baseUrl);
    if (!absolute) continue;

    const text = (match[4] ?? '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120);

    out.push({ href: absolute, text });
  }

  return out;
}

function absolutise(href: string, baseUrl: string): string | null {
  if (/^(?:javascript|mailto|tel|data|blob|ftp|file):/i.test(href)) return null;
  if (href.startsWith('#')) return null;
  try {
    const resolved = new URL(href, baseUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    return resolved.toString();
  } catch {
    return null;
  }
}

function parseLink(url: string): { host: string; domain: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || !host.includes('.')) return null;
  // An IP literal is never a discovered property source, and letting one through
  // would hand the auditor a target whose only description is a number.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;

  return { host, domain: registrable(host) };
}

/**
 * Registrable domain, by the same "last two labels, plus a third for a known
 * two-part suffix" rule the rest of the core uses.
 *
 * `com.ge` matters here: `example.com.ge` must reduce to `example.com.ge` and
 * not to `com.ge`, or every Georgian commercial site becomes one domain.
 */
const TWO_PART_SUFFIXES = new Set([
  'com.ge', 'org.ge', 'net.ge', 'edu.ge', 'gov.ge', 'pvt.ge', 'school.ge',
  'co.uk', 'org.uk', 'com.tr', 'com.ua', 'com.ru', 'co.il', 'org.il',
  'com.au', 'co.nz', 'com.br', 'com.cn',
]);

export function registrable(host: string): string {
  const labels = host.split('.');
  if (labels.length <= 2) return host;

  const lastTwo = labels.slice(-2).join('.');
  if (TWO_PART_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.');
  return lastTwo;
}

function isNeverACandidate(domain: string, host: string): boolean {
  return NEVER_A_CANDIDATE.some(
    (entry) => domain === entry || host === entry || host.endsWith(`.${entry}`),
  );
}

function isNotASource(anchorText: string): boolean {
  if (!anchorText) return false;
  const lower = anchorText.toLowerCase();
  return NOT_A_SOURCE_WORDS.some((word) => lower.includes(word));
}

/**
 * What a harvest produced, for a worker to report without recounting.
 */
export interface HarvestSummary {
  documentsRead: number;
  documentsSkippedUnpermitted: number;
  candidates: number;
  withRelevance: number;
  zeroRelevance: number;
}

export function summariseHarvest(
  sources: readonly HarvestSource[],
  candidates: readonly CandidateLink[],
): HarvestSummary {
  const permitted = sources.filter((source) => HARVESTABLE.has(source.lifecycle));
  return {
    documentsRead: permitted.length,
    documentsSkippedUnpermitted: sources.length - permitted.length,
    candidates: candidates.length,
    withRelevance: candidates.filter((candidate) => candidate.relevance > 0).length,
    zeroRelevance: candidates.filter((candidate) => candidate.relevance === 0).length,
  };
}
