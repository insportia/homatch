// HOMATCH RESEARCH CORE — the parts Facebook and Instagram share.
//
// WHAT THESE ADAPTERS CAN AND CANNOT DO, STATED PLAINLY
//
// Meta serves a little of this content to anonymous HTTP and most of it only
// to a logged-in session. A public page's meta tags and a public post's
// structured data usually come back; a group's post list usually does not,
// and an Instagram profile's grid usually does not. What arrives instead is
// a login interstitial with HTTP 200 — a page that looks like a successful
// fetch and contains no content.
//
// That interstitial is the single most important thing these adapters
// detect. A scraper that does not recognise it reports "this group contained
// nothing", which is a false statement about the world: the group contains
// plenty and we could not see it. `detectWall()` below is what turns that
// into LOGIN_WALL or JOIN_REQUIRED, which the ladder records, the admin area
// shows, and the access queue acts on.
//
// WHAT IS DELIBERATELY ABSENT
//
// No CAPTCHA solving, no challenge handling, no fingerprint or stealth
// evasion, no proxy rotation, no account rotation, no automated joining, and
// no attempt to reach anything a legitimate session would not be shown. A
// JOIN_REQUIRED source is recorded and queued for a human to decide about.
// That is the whole mechanism, and it is the mechanism on purpose.
//
// DISCOVERY WITHOUT A SEARCH VENDOR
//
// There is no paid search provider here. Sources arrive three ways, all of
// them ours: links encountered while reading content we could already see,
// operator-supplied seeds from the admin area, and the rows Homatch already
// holds in community_directory and source_registry. It is slower to start
// than buying SERPs and it compounds — every scan teaches the registry — and
// it does not depend on a vendor the product has decided not to use.

import { parseHtml } from '../parse/html.ts';
import { extractJsonLd } from '../parse/json-ld.ts';
import { extractMetadata } from '../parse/metadata.ts';
import { contentHash } from '../normalize/hash.ts';
import { deterministicId } from '../core/ids.ts';
import { normalizeTimestamp } from '../normalize/dates.ts';
import { classifyDirection } from '../signals/direction.ts';
import type { AdapterDocument, AdapterFailure } from '../discovery/adapter.ts';
import type { ResearchLanguage } from '../discovery/lexicon.ts';
import type {
  AccessClass,
  ContentType,
  PublicSignal,
  SignalPlatform,
} from '../signals/types.ts';

/**
 * Signs that what came back is a wall rather than the content.
 *
 * Deliberately conservative: a false positive costs one skipped source, a
 * false negative costs a silent "this group is empty" that nobody notices.
 */
const LOGIN_WALL = [
  'you must log in to continue',
  'log into facebook',
  'log in to facebook',
  'see more of',
  'create new account',
  'შედით facebook',
  'войдите в facebook',
  'connectez-vous',
  'iniciar sesión',
  'login • instagram',
  'log in • instagram',
  'sign up to see',
  'please log in',
];

const JOIN_WALL = [
  'this group is private',
  'private group',
  'join group to see',
  'members only',
  'ask to join',
  'this account is private',
  'private account',
  'დახურული ჯგუფი',
  'закрытая группа',
];

const GONE = [
  'this content isn\'t available right now',
  'page not found',
  'sorry, this page isn\'t available',
  'content unavailable',
];

export type WallKind = 'NONE' | 'LOGIN' | 'JOIN' | 'GONE';

export function detectWall(html: string): WallKind {
  const text = html.slice(0, 20_000).toLowerCase();
  for (const marker of JOIN_WALL) if (text.includes(marker)) return 'JOIN';
  for (const marker of GONE) if (text.includes(marker)) return 'GONE';
  for (const marker of LOGIN_WALL) if (text.includes(marker)) return 'LOGIN';
  return 'NONE';
}

export function wallToFailure(wall: WallKind): AdapterFailure {
  switch (wall) {
    case 'LOGIN':
      return 'LOGIN_WALL';
    case 'JOIN':
      return 'JOIN_REQUIRED';
    case 'GONE':
      return 'NOT_FOUND';
    case 'NONE':
      return 'PARSE_FAILED';
  }
}

/**
 * Whether a document is worth parsing at all.
 *
 * A 200 that is a wall is not a success, and treating it as one is how the
 * registry fills up with sources recorded as "scanned, nothing found".
 */
export function assessDocument(document: AdapterDocument): { usable: boolean; wall: WallKind } {
  if (document.status >= 400) return { usable: false, wall: 'GONE' };
  const wall = detectWall(document.body);
  return { usable: wall === 'NONE', wall };
}

export interface ExtractedItem {
  contentUrl: string | null;
  parentUrl: string | null;
  parentExcerpt: string | null;
  text: string;
  authorName: string | null;
  authorUrl: string | null;
  publishedAt: string | null;
  contentType: ContentType;
}

export interface BuildSignalInput {
  item: ExtractedItem;
  platform: SignalPlatform;
  sourceUrl: string;
  accessClass: AccessClass;
  discoveredAt: string;
  language: ResearchLanguage | null;
  languages: readonly ResearchLanguage[];
}

/**
 * One extracted item becomes one signal.
 *
 * Note what is NOT done here: no translation is written over the original, no
 * contact detail is mined out of the text, no identity is resolved, and the
 * published date is whatever the source actually stated — null when it stated
 * nothing. `discoveredAt` is a separate field precisely so the two can never
 * be confused.
 */
export function buildSignal(input: BuildSignalInput): PublicSignal {
  const verdict = classifyDirection(input.item.text, {
    languages: input.languages,
    // A comment under a listing inherits the listing's subject — the property
    // and the price — and none of its direction.
    parentContext: input.item.parentExcerpt,
  });

  return {
    // Deterministic on (platform, content url or hashed text): the same item
    // seen again on the next scan is the same signal, which is what makes
    // incremental re-scans idempotent instead of duplicating.
    id: deterministicId(
      'sig',
      input.platform,
      input.item.contentUrl ?? contentHash(input.item.text),
    ),
    platform: input.platform,
    contentType: input.item.contentType,
    sourceUrl: input.sourceUrl,
    contentUrl: input.item.contentUrl,
    parentUrl: input.item.parentUrl,
    parentExcerpt: input.item.parentExcerpt,
    author: {
      publicName: input.item.authorName,
      publicUrl: input.item.authorUrl,
    },
    originalText: input.item.text,
    translatedText: null,
    language: input.language ?? (verdict.languages[0] ?? null),
    publishedAt: normalizeTimestamp(input.item.publishedAt) ?? null,
    discoveredAt: input.discoveredAt,
    lastSeenAt: input.discoveredAt,
    contentFingerprint: contentHash(input.item.text),
    direction: verdict.direction,
    directionConfidence: verdict.confidence,
    locationHints: { countryCode: null, city: null, district: null, mentions: [] },
    requirementHints: {
      bedrooms: null,
      areaSqm: null,
      budgetAmount: null,
      budgetCurrency: null,
    },
    accessClass: input.accessClass,
  };
}

/**
 * What a public Meta page will still tell an anonymous fetch.
 *
 * Open Graph tags and any JSON-LD survive the wall on most public pages, so a
 * source can be identified and classified even when its contents cannot be
 * read. That is worth doing: knowing a group exists, what it is called and
 * what it is about is exactly what the access queue needs in order to ask a
 * human whether to join it.
 */
export interface PageIdentity {
  title: string | null;
  description: string | null;
  canonicalUrl: string | null;
}

export function readPageIdentity(document: AdapterDocument): PageIdentity {
  try {
    const doc = parseHtml(document.body);
    const meta = extractMetadata(doc, document.url);
    const jsonLd = extractJsonLd(doc).nodes;
    const fromJsonLd = jsonLd.find((node) => typeof node['name'] === 'string');

    return {
      title: meta.title ?? (typeof fromJsonLd?.['name'] === 'string' ? (fromJsonLd['name'] as string) : null),
      description: meta.description ?? null,
      canonicalUrl: meta.canonicalUrl ?? null,
    };
  } catch {
    return { title: null, description: null, canonicalUrl: null };
  }
}

/**
 * Links to other sources found inside content we could already read.
 *
 * This is the compounding half of discovery: every group we can see names
 * other groups, and each one is a candidate the registry did not have. It
 * costs nothing beyond a request we already made.
 */
export function harvestSourceLinks(
  html: string,
  isSourceUrl: (url: string) => boolean,
  canonicalize: (url: string) => string | null,
  limit = 50,
): string[] {
  const found = new Set<string>();
  const pattern = /https?:\/\/[^\s"'<>\\)]+/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    if (found.size >= limit) break;
    const raw = match[0];
    if (!isSourceUrl(raw)) continue;
    const canonical = canonicalize(raw);
    if (canonical) found.add(canonical);
  }
  return [...found];
}
