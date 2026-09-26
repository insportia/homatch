// WHAT IS THIS ROW, ACTUALLY?
//
// source_registry holds 314 rows in DISCOVERED with a null source_family, and
// the website auditor cannot use any of them, because it has no way to tell a
// property portal from a subreddit from a leftover `https://google.com`.
//
// This module is that way. It is pure, it decides from the URL and the declared
// platform, and it produces three separate things that were previously one
// muddle:
//
//   kind     — what sort of thing the row IS (a website, a community
//              identifier, a placeholder that is not a source at all)
//   family   — which SourceFamily it belongs to, or null when it is not a
//              source and a family would be a lie
//   auditable — whether the CANDIDATE-HOST auditor may fetch it
//
// WHY THE URL OVERRULES THE DECLARED PLATFORM
//
// Because in production the declared platform is wrong. 297 rows say
// `platform = FORUM, source_type = FORUM` and every one of them is a subreddit
// on www.reddit.com. A classifier that trusted the column would put Reddit into
// the FORUM family, which is the family forum.ge is in, and then independence
// counting would treat one platform's 296 subreddits as 296 independent
// sources. The URL is the evidence; the column is somebody's earlier guess.
//
// The disagreement is not silently resolved, either — it is REPORTED, because a
// registry whose platform column is wrong on 94% of its DISCOVERED rows is a
// fact worth knowing rather than a fact worth overwriting quietly.
//
// WHAT THIS DELIBERATELY DOES NOT DECIDE
//
// Whether a source is any GOOD. Nothing here reads "Georgia-relevant" off a
// hostname. r/GeorgiaRealEstateExam is about licensing exams in the US state of
// Georgia and r/tbilisifood is about restaurants; both are correctly classified
// here as PUBLIC_COMMUNITY and neither is a lead. Relevance needs evidence from
// the content, which is what the audit and the yield measurement are for.
//
// A NOTE ON THE ONES THAT ARE NOT SOURCES
//
// `https://google.com`, `https://t.me/`, `https://www.facebook.com/groups/` and
// `https://reddit.com/` are platform roots with no identifier after them. They
// are not sources that happen to be empty; they are rows where the identifier
// was never captured. Calling them UNUSABLE and retiring them keeps the history
// and stops them being counted as candidates — which is the difference between
// a registry of 366 sources and a registry of 52 with 314 artefacts in it.

import type { SourceFamily } from './source-lifecycle.ts';

export type CandidateKind =
  /** An ordinary website. The candidate-host auditor can evaluate this. */
  | 'CANDIDATE_WEBSITE'
  /** A group, channel, subreddit or profile. Needs a platform adapter. */
  | 'COMMUNITY_IDENTIFIER'
  /** A search engine URL. A query is not a source. */
  | 'SEARCH_PLACEHOLDER'
  /** A platform's front door with no identifier after it. Never was a source. */
  | 'PLATFORM_ROOT'
  /** Already implemented on the portal path; not a candidate. */
  | 'IMPLEMENTED_SOURCE'
  /** Cannot be understood at all — no host, or not a web URL. */
  | 'UNUSABLE';

export interface CandidateClassification {
  kind: CandidateKind;
  /** Null whenever claiming a family would assert something unearned. */
  family: SourceFamily | null;
  host: string | null;
  /** The identifier inside the platform, when there is one (`r/Batumi`). */
  identifier: string | null;
  /** May the candidate-host auditor fetch this? */
  auditable: boolean;
  /** Should this leave active planning, keeping its history? */
  retire: boolean;
  /** Plain English, stored on the row. Never a code an operator must decode. */
  rationale: string;
  /**
   * Set when the declared platform disagrees with the URL. Reported, not
   * silently corrected, because a wrong column is a finding.
   */
  declaredPlatformMismatch?: string;
}

/**
 * Search engines. A row pointing at one is the remains of a query somebody ran,
 * not a site anybody can read for listings.
 */
const SEARCH_HOSTS = new Set([
  'google.com', 'www.google.com', 'bing.com', 'www.bing.com',
  'duckduckgo.com', 'yandex.ru', 'yandex.com', 'search.brave.com',
]);

/**
 * Platforms whose value is entirely in the path. The bare host is the lobby.
 *
 * `reserved` is the part that took two attempts to get right. A platform path
 * is not simply "one segment means an identifier": `facebook.com/ourpage` names
 * a page in one segment, while `facebook.com/groups/` names nothing at all in
 * one segment, because `groups` is a ROUTE WORD and the identifier comes after
 * it. Instagram stacks two of them — `explore/tags/tbilisihousing`.
 *
 * So reserved segments are stripped from the front, and what has to remain is at
 * least one real identifier. `requireReserved` is for platforms where the route
 * word is mandatory: on Reddit only `/r/<sub>` and `/user/<name>` are things,
 * and `reddit.com/policies` is not a community.
 */
const COMMUNITY_PLATFORMS: Array<{
  hosts: string[];
  family: SourceFamily;
  reserved: string[];
  requireReserved: boolean;
  label: string;
}> = [
  { hosts: ['reddit.com', 'www.reddit.com', 'old.reddit.com', 'np.reddit.com'],
    family: 'PUBLIC_COMMUNITY', reserved: ['r', 'user', 'u'], requireReserved: true,
    label: 'a subreddit or Reddit user' },
  { hosts: ['t.me', 'telegram.me'],
    family: 'TELEGRAM', reserved: ['s'], requireReserved: false,
    label: 'a Telegram channel' },
  { hosts: ['facebook.com', 'www.facebook.com', 'm.facebook.com', 'web.facebook.com'],
    family: 'PUBLIC_COMMUNITY', reserved: ['groups', 'pages', 'pg', 'profile.php', 'people'],
    requireReserved: false, label: 'a Facebook page or group' },
  { hosts: ['vk.com', 'm.vk.com'],
    family: 'PUBLIC_COMMUNITY', reserved: ['club', 'public'], requireReserved: false,
    label: 'a VK community' },
  { hosts: ['instagram.com', 'www.instagram.com'],
    family: 'PUBLIC_COMMUNITY', reserved: ['explore', 'tags', 'p', 'reel', 'reels'],
    requireReserved: false, label: 'an Instagram profile or tag' },
  { hosts: ['threads.net', 'www.threads.net'],
    family: 'PUBLIC_COMMUNITY', reserved: [], requireReserved: false,
    label: 'a Threads profile' },
  { hosts: ['x.com', 'twitter.com', 'www.twitter.com'],
    family: 'PUBLIC_COMMUNITY', reserved: ['i', 'hashtag'], requireReserved: false,
    label: 'an X profile' },
  { hosts: ['linkedin.com', 'www.linkedin.com'],
    family: 'PUBLIC_COMMUNITY', reserved: ['company', 'in', 'groups', 'showcase'],
    requireReserved: true, label: 'a LinkedIn page' },
  { hosts: ['youtube.com', 'www.youtube.com'],
    family: 'PUBLIC_COMMUNITY', reserved: ['c', 'channel', 'user', 'watch'],
    requireReserved: false, label: 'a YouTube channel' },
  { hosts: ['tiktok.com', 'www.tiktok.com'],
    family: 'PUBLIC_COMMUNITY', reserved: ['tag'], requireReserved: false,
    label: 'a TikTok profile' },
];

/**
 * Split a platform path into the route words that led to it and the identifier
 * it ends on. Returns null when there is no identifier — which is what makes a
 * platform root a platform root.
 */
export function platformIdentifier(
  segments: readonly string[],
  reserved: readonly string[],
  requireReserved: boolean,
): string | null {
  const prefix: string[] = [];
  let index = 0;
  while (index < segments.length && reserved.includes((segments[index] ?? '').toLowerCase())) {
    prefix.push(segments[index] as string);
    index += 1;
  }

  if (requireReserved && prefix.length === 0) return null;
  const identifier = segments[index];
  if (!identifier) return null;

  return [...prefix, identifier].join('/');
}

export interface ClassifyRegistryRowInput {
  url: string;
  /** The registry's own `platform` column, which may be wrong. */
  platform?: string | null;
  sourceType?: string | null;
  name?: string | null;
  /**
   * Registrable domains that already have a portal SourcePolicy. Passed in
   * rather than imported, so this module keeps no dependency on the portal
   * catalogue and stays pure.
   */
  implementedDomains?: readonly string[];
}

export function classifyRegistryRow(
  input: ClassifyRegistryRowInput,
): CandidateClassification {
  const parsed = parseWebUrl(input.url);
  if (!parsed) {
    return {
      kind: 'UNUSABLE',
      family: null,
      host: null,
      identifier: null,
      auditable: false,
      retire: true,
      rationale: `"${truncate(input.url)}" is not an http(s) URL, so there is nothing to read.`,
    };
  }

  const { host, segments } = parsed;

  // A search engine, with or without a query. Either way it is a record of a
  // search, and a search is not a source.
  if (SEARCH_HOSTS.has(host)) {
    return {
      kind: 'SEARCH_PLACEHOLDER',
      family: null,
      host,
      identifier: null,
      auditable: false,
      retire: true,
      rationale:
        `${host} is a search engine. This row records a query that was run, not a site that ` +
        'can be read for listings or intent, so it is not a source.',
    };
  }

  const platform = COMMUNITY_PLATFORMS.find((entry) => entry.hosts.includes(host));
  if (platform) {
    const identifier = platformIdentifier(segments, platform.reserved, platform.requireReserved);

    if (!identifier) {
      return {
        kind: 'PLATFORM_ROOT',
        family: null,
        host,
        identifier: null,
        auditable: false,
        retire: true,
        rationale:
          `${truncate(input.url)} is the front door of ${host} with no identifier after it. ` +
          `It never named ${platform.label}, so there is nothing here to read or to audit.`,
        ...mismatch(input, host),
      };
    }

    return {
      kind: 'COMMUNITY_IDENTIFIER',
      family: platform.family,
      host,
      identifier,
      // NOT auditable by the candidate-host auditor. A subreddit is not a
      // website with a sitemap and a robots policy of its own; it is a document
      // inside a platform that has one access model for all of them. Pointing
      // the website auditor at 296 of them would produce 296 findings about
      // reddit.com.
      auditable: false,
      retire: false,
      rationale:
        `${identifier} on ${host} is ${platform.label}. It is a community identifier, not an ` +
        'independent website: reading it needs a platform adapter, and the website auditor ' +
        `would only ever report facts about ${host}.`,
      ...mismatch(input, host),
    };
  }

  const implemented = (input.implementedDomains ?? []).find(
    (domain) => host === domain || host.endsWith(`.${domain}`),
  );
  if (implemented) {
    return {
      kind: 'IMPLEMENTED_SOURCE',
      family: null,
      host,
      identifier: null,
      auditable: false,
      retire: false,
      rationale:
        `${host} already has a source policy and is read on the portal path. Auditing it as a ` +
        'candidate would apply the wrong posture to a site we have already evaluated.',
    };
  }

  return {
    kind: 'CANDIDATE_WEBSITE',
    family: null,
    host,
    identifier: null,
    // The one kind the candidate-host auditor exists for. The family stays NULL
    // until the audit reads the site: guessing PROPERTY_PORTAL from a hostname
    // is exactly the invented metadata this registry already suffers from.
    auditable: true,
    retire: false,
    rationale:
      `${host} is an ordinary website with no policy yet. It is a candidate: the auditor can ` +
      'read its robots.txt, its sitemaps and one page, and the family follows from what it finds.',
    ...mismatch(input, host),
  };
}

/**
 * The declared platform against what the URL actually is.
 *
 * Only reported when the two genuinely conflict. A row saying WEBSITE for a
 * website is not a mismatch, and a row with no platform at all is not a
 * disagreement — it is a gap.
 */
function mismatch(
  input: ClassifyRegistryRowInput,
  host: string,
): { declaredPlatformMismatch?: string } {
  const declared = (input.platform ?? '').toUpperCase();
  if (!declared) return {};

  const expected = expectedPlatform(host);
  if (!expected || expected === declared) return {};

  return {
    declaredPlatformMismatch:
      `the row declares platform ${declared}, but ${host} is ${expected}`,
  };
}

function expectedPlatform(host: string): string | null {
  if (host.endsWith('reddit.com')) return 'a Reddit host (no REDDIT platform exists in the enum)';
  if (host === 't.me' || host === 'telegram.me') return 'TELEGRAM';
  if (host.endsWith('facebook.com')) return 'FACEBOOK';
  if (host.endsWith('vk.com')) return 'VK';
  if (host.endsWith('instagram.com')) return 'INSTAGRAM';
  if (SEARCH_HOSTS.has(host)) return 'a search engine';
  return null;
}

function parseWebUrl(url: string): { host: string; segments: string[] } | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!host) return null;

  const segments = parsed.pathname.split('/').filter((segment) => segment.length > 0);
  return { host, segments };
}

function truncate(value: string, max = 80): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Summarise a whole batch, so a worker can report what it did in one line
 * instead of 314 of them.
 */
export interface ClassificationSummary {
  total: number;
  byKind: Record<string, number>;
  auditable: number;
  retire: number;
  platformMismatches: number;
}

export function summariseClassifications(
  classifications: readonly CandidateClassification[],
): ClassificationSummary {
  const byKind: Record<string, number> = {};
  let auditable = 0;
  let retire = 0;
  let platformMismatches = 0;

  for (const entry of classifications) {
    byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
    if (entry.auditable) auditable += 1;
    if (entry.retire) retire += 1;
    if (entry.declaredPlatformMismatch) platformMismatches += 1;
  }

  return { total: classifications.length, byKind, auditable, retire, platformMismatches };
}
