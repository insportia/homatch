// HOMATCH RESEARCH CORE — Facebook, as a source adapter.
//
// Not a Facebook research system. A source adapter behind the same interface
// Telegram, Reddit or a property portal will use, running on the same
// fetching, caching, coalescing, dedupe, scoring and evidence machinery as
// every other job. Everything Facebook-specific is in this file, so a layout
// change breaks this file and nothing else.
//
// THE HONEST POSITION ON WHAT IS REACHABLE
//
// Anonymous HTTP gets a public page's Open Graph tags and often nothing else.
// Group post lists, comment threads and most profile content are served to a
// logged-in session or not at all, and what comes back instead is a login
// interstitial with a 200 status.
//
// So this adapter does three things, in order of how much value they deliver
// per unit of trouble:
//
//   1. IDENTIFY a source from whatever the public page still returns — name,
//      description, canonical URL — which is enough to record it, classify
//      it by market and topic, and put it in front of an operator.
//   2. READ its content when an operator has legitimately connected a session
//      and the platform serves it.
//   3. SAY SO, precisely, when neither is possible: LOGIN_WALL when a session
//      would help, JOIN_REQUIRED when a human has to ask for access.
//
// Number 3 is not a failure mode, it is a feature. "We cannot see inside this
// group" is a true and actionable statement; "this group contained nothing"
// is a false one, and it is what a scraper that does not detect the wall
// reports instead.

import type {
  AdapterContext,
  AdapterOutcome,
  DiscoverRequest,
  DiscoveredSource,
  ScanRequest,
  ScanResult,
  SourceAdapter,
} from '../discovery/adapter.ts';
import {
  assessDocument,
  buildSignal,
  harvestSourceLinks,
  readPageIdentity,
  wallToFailure,
  type ExtractedItem,
} from './meta-platform.ts';
import { parseHtml } from '../parse/html.ts';
import { extractJsonLd } from '../parse/json-ld.ts';
import type { ResearchLanguage } from '../discovery/lexicon.ts';

const HOST = /(^|\.)facebook\.com$/i;

/** A Facebook URL that names a source we could usefully remember. */
export function isFacebookSourceUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (!HOST.test(url.hostname)) return false;
    return /^\/(groups|pages)\//.test(url.pathname) || /^\/[A-Za-z0-9.\-_]{5,}\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

/**
 * The identity form of a Facebook URL.
 *
 * Query strings on Facebook carry referral and session context that changes
 * per visit, so an identity that kept them would treat the same group as a
 * new source on every encounter. Matches the canonicalisation the existing
 * discovery function already used, so rows written by either agree.
 */
export function canonicalizeFacebookUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!HOST.test(url.hostname)) return null;

    const group = url.pathname.match(/\/groups\/([^/?#]+)/);
    if (group?.[1]) return `https://www.facebook.com/groups/${group[1]}/`;

    const page = url.pathname.match(/\/pages\/[^/]+\/([^/?#]+)/);
    if (page?.[1]) return `https://www.facebook.com/pages/${page[1]}/`;

    const handle = url.pathname.match(/^\/([A-Za-z0-9.\-_]{5,})\/?$/);
    if (handle?.[1] && !RESERVED_PATHS.has(handle[1].toLowerCase())) {
      return `https://www.facebook.com/${handle[1]}/`;
    }
    return null;
  } catch {
    return null;
  }
}

/** Paths that look like a handle and are not one. */
const RESERVED_PATHS = new Set([
  'login', 'privacy', 'policies', 'help', 'about', 'settings', 'legal',
  'watch', 'marketplace', 'events', 'gaming', 'business', 'search',
]);

/** The post id inside a permalink, when there is one. */
function permalinkOf(sourceUrl: string, href: string): string | null {
  try {
    const url = new URL(href, sourceUrl);
    if (!HOST.test(url.hostname)) return null;
    const post = url.pathname.match(/\/(posts|permalink|videos)\/([^/?#]+)/);
    if (post) return `${url.origin}${url.pathname}`.replace(/\/$/, '');
    return null;
  } catch {
    return null;
  }
}

export class FacebookAdapter implements SourceAdapter {
  readonly id = 'facebook';
  readonly platform = 'FACEBOOK' as const;
  readonly capabilities = ['discover', 'fetch', 'extract', 'scanIncremental'] as const;

  private readonly languages: readonly ResearchLanguage[];

  constructor(options: { languages?: readonly ResearchLanguage[] } = {}) {
    this.languages = options.languages ?? ['ka', 'en', 'ru', 'tr', 'ar', 'he', 'hi'];
  }

  handles(url: string): boolean {
    return isFacebookSourceUrl(url);
  }

  canonicalize(url: string): string | null {
    return canonicalizeFacebookUrl(url);
  }

  /**
   * Discovery here is identification, not search.
   *
   * There is no search vendor and this adapter does not pretend to be one. It
   * confirms and classifies candidate URLs — from operator seeds, from
   * community_directory, and from links harvested out of content we could
   * already read — by fetching the public page and reading whatever identity
   * survives. A candidate that turns out to be private is still recorded,
   * marked JOIN_REQUIRED, and becomes an access-queue entry rather than
   * being discarded.
   */
  async discover(
    request: DiscoverRequest,
    context: AdapterContext,
  ): Promise<AdapterOutcome<DiscoveredSource[]>> {
    const candidates = new Set<string>();
    for (const query of request.queries) {
      // A planned query may itself name a source when an operator seeded one.
      const canonical = canonicalizeFacebookUrl(query.text);
      if (canonical) candidates.add(canonical);
    }

    if (candidates.size === 0) {
      // Not an error: this adapter simply has nothing to confirm this round.
      // The registry still grows from links harvested during scans.
      return { ok: true, value: [] };
    }

    const found: DiscoveredSource[] = [];
    for (const url of [...candidates].slice(0, request.limit)) {
      const document = await context.fetchDocument(url);
      const identity = readPageIdentity(document);
      const assessment = assessDocument(document);

      found.push({
        canonicalUrl: url,
        externalId: url,
        name: identity.title,
        accessState:
          assessment.wall === 'JOIN' ? 'JOIN_REQUIRED'
            : assessment.wall === 'GONE' ? 'INACCESSIBLE'
            : assessment.wall === 'LOGIN' ? 'AUTHENTICATED_ACCESS'
            : 'PUBLIC',
        languages: [],
        rationale:
          assessment.wall === 'NONE'
            ? 'Public page readable without a session.'
            : `Identified but not readable anonymously (${assessment.wall.toLowerCase()} wall).`,
      });
    }

    return { ok: true, value: found };
  }

  async scan(request: ScanRequest, context: AdapterContext): Promise<AdapterOutcome<ScanResult>> {
    const url = request.source.canonicalUrl;
    const document = await context.fetchDocument(url);
    const assessment = assessDocument(document);

    if (!assessment.usable) {
      // The whole point. A wall is reported as a wall.
      return {
        ok: false,
        reason: wallToFailure(assessment.wall),
        detail: context.authenticatedSession
          ? 'the connected session was not served this content'
          : 'no authenticated research session is connected',
      };
    }

    const discoveredAt = new Date(context.now()).toISOString();
    const items = extractFacebookItems(document.body, url, request.includeComments);

    const signals = items.map((item) =>
      buildSignal({
        item,
        platform: 'FACEBOOK',
        sourceUrl: url,
        accessClass: context.authenticatedSession ? 'AUTHENTICATED' : 'PUBLIC',
        discoveredAt,
        language: null,
        languages: this.languages,
      }),
    );

    // Only what is new. The cursor is the newest published timestamp we have
    // already seen; anything at or before it was returned by an earlier scan.
    const cursor = request.cursor;
    const filtered = cursor
      ? signals.filter((signal) => isNewerThan(signal.publishedAt, cursor))
      : signals;

    const limited = filtered.slice(0, request.limit);

    const discovered = harvestSourceLinks(
      document.body,
      isFacebookSourceUrl,
      canonicalizeFacebookUrl,
    )
      .filter((link) => link !== url)
      .map((link) => ({
        canonicalUrl: link,
        externalId: link,
        name: null,
        accessState: 'PUBLIC' as const,
        languages: [],
        rationale: 'Linked from content already readable in a scanned source.',
      }));

    return {
      ok: true,
      value: {
        signals: limited,
        cursor: newestTimestamp(limited) ?? request.cursor,
        truncated: filtered.length > limited.length,
        discovered,
      },
    };
  }
}

/**
 * Pull items out of whatever Facebook served.
 *
 * Structured data first — it is stable and meant to be read. The `<article>`
 * fallback reads DOM semantics, not positions: there is deliberately no
 * "third div inside the second container" anywhere here, because that is a
 * bug with a delay fuse.
 */
export function extractFacebookItems(
  html: string,
  sourceUrl: string,
  includeComments: boolean,
): ExtractedItem[] {
  const out: ExtractedItem[] = [];
  const doc = parseHtml(html);

  for (const node of extractJsonLd(doc).nodes) {
    const type = String(node['@type'] ?? '').toLowerCase();
    if (!['socialmediaposting', 'discussionforumposting', 'article', 'blogposting'].includes(type)) {
      continue;
    }
    const text = readString(node, 'articleBody') ?? readString(node, 'text');
    if (!text) continue;

    const author = node['author'];
    const authorName = typeof author === 'object' && author !== null
      ? readString(author as Record<string, unknown>, 'name')
      : readString(node, 'author');
    const authorUrl = typeof author === 'object' && author !== null
      ? readString(author as Record<string, unknown>, 'url')
      : null;

    out.push({
      contentUrl: permalinkOf(sourceUrl, readString(node, 'url') ?? '') ?? readString(node, 'url'),
      parentUrl: null,
      parentExcerpt: null,
      text,
      authorName,
      authorUrl,
      publishedAt: readString(node, 'datePublished') ?? readString(node, 'dateCreated'),
      contentType: 'POST',
    });

    if (!includeComments) continue;

    const comments = node['comment'];
    if (!Array.isArray(comments)) continue;
    for (const raw of comments) {
      if (typeof raw !== 'object' || raw === null) continue;
      const comment = raw as Record<string, unknown>;
      const commentText = readString(comment, 'text') ?? readString(comment, 'articleBody');
      if (!commentText) continue;

      const commentAuthor = comment['author'];
      out.push({
        contentUrl: readString(comment, 'url'),
        // A comment without its parent is a fragment: "is this still
        // available?" means nothing alone and a great deal under a listing.
        parentUrl: readString(node, 'url'),
        parentExcerpt: text.slice(0, 280),
        text: commentText,
        authorName: typeof commentAuthor === 'object' && commentAuthor !== null
          ? readString(commentAuthor as Record<string, unknown>, 'name')
          : null,
        authorUrl: typeof commentAuthor === 'object' && commentAuthor !== null
          ? readString(commentAuthor as Record<string, unknown>, 'url')
          : null,
        publishedAt: readString(comment, 'datePublished'),
        contentType: 'COMMENT',
      });
    }
  }

  return out;
}

function readString(node: Record<string, unknown>, key: string): string | null {
  const value = node[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}

function isNewerThan(publishedAt: string | null, cursor: string): boolean {
  if (!publishedAt) {
    // An undated item cannot be shown to be new, so an incremental scan does
    // not claim it is. It will be caught by content-hash dedupe if it is old.
    return true;
  }
  const a = Date.parse(publishedAt);
  const b = Date.parse(cursor);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
  return a > b;
}

function newestTimestamp(signals: ReadonlyArray<{ publishedAt: string | null }>): string | null {
  let newest: number | null = null;
  for (const signal of signals) {
    if (!signal.publishedAt) continue;
    const value = Date.parse(signal.publishedAt);
    if (!Number.isFinite(value)) continue;
    if (newest === null || value > newest) newest = value;
  }
  return newest === null ? null : new Date(newest).toISOString();
}
