// HOMATCH RESEARCH CORE — Instagram, as a source adapter.
//
// Same architecture as Facebook, same shared pipeline, and deliberately no
// Instagram-specific business logic: the direction classifier, the job
// filter, the dedupe, the scoring and the evidence mapping are the ones every
// other job uses. What lives here is URL identity, wall detection and
// extraction — the three things that genuinely differ per platform.
//
// WHAT IS REACHABLE, HONESTLY
//
// A public profile and a public post still return Open Graph tags to an
// anonymous fetch, which is enough to identify a source and read a caption.
// The post grid, the comment threads and anything on a private account are
// not, and what comes back instead is a login interstitial with a 200. That
// is detected and reported as LOGIN_WALL or JOIN_REQUIRED rather than as an
// empty result — the same rule as Facebook, for the same reason.
//
// Captions are where property intent actually lives on Instagram, and a
// caption is usually the whole post. Reels are treated as posts carrying a
// caption, because for this purpose that is what they are.

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
import { extractMetadata } from '../parse/metadata.ts';
import type { ResearchLanguage } from '../discovery/lexicon.ts';
import type { ContentType } from '../signals/types.ts';

const HOST = /(^|\.)instagram\.com$/i;

const RESERVED_PATHS = new Set([
  'accounts', 'explore', 'directory', 'about', 'legal', 'developer',
  'p', 'reel', 'reels', 'stories', 'tv', 'privacy', 'terms',
]);

export function isInstagramSourceUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (!HOST.test(url.hostname)) return false;
    if (/^\/(p|reel|reels|tv)\/[^/]+/.test(url.pathname)) return true;
    const handle = url.pathname.match(/^\/([A-Za-z0-9._]{2,30})\/?$/);
    return !!handle?.[1] && !RESERVED_PATHS.has(handle[1].toLowerCase());
  } catch {
    return false;
  }
}

export function canonicalizeInstagramUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!HOST.test(url.hostname)) return null;

    // A reel and a post are the same object under two paths; folding them to
    // /p/ stops the same item being remembered twice.
    const content = url.pathname.match(/^\/(?:p|reel|reels|tv)\/([^/?#]+)/);
    if (content?.[1]) return `https://www.instagram.com/p/${content[1]}/`;

    const handle = url.pathname.match(/^\/([A-Za-z0-9._]{2,30})\/?$/);
    if (handle?.[1] && !RESERVED_PATHS.has(handle[1].toLowerCase())) {
      return `https://www.instagram.com/${handle[1].toLowerCase()}/`;
    }
    return null;
  } catch {
    return null;
  }
}

function contentTypeFor(url: string): ContentType {
  try {
    const path = new URL(url).pathname;
    if (/^\/(reel|reels)\//.test(path)) return 'REEL';
    if (/^\/(p|tv)\//.test(path)) return 'POST';
    return 'PROFILE';
  } catch {
    return 'POST';
  }
}

export class InstagramAdapter implements SourceAdapter {
  readonly id = 'instagram';
  readonly platform = 'INSTAGRAM' as const;
  readonly capabilities = ['discover', 'fetch', 'extract', 'scanIncremental'] as const;

  private readonly languages: readonly ResearchLanguage[];

  constructor(options: { languages?: readonly ResearchLanguage[] } = {}) {
    this.languages = options.languages ?? ['ka', 'en', 'ru', 'tr', 'ar', 'he', 'hi'];
  }

  handles(url: string): boolean {
    return isInstagramSourceUrl(url);
  }

  canonicalize(url: string): string | null {
    return canonicalizeInstagramUrl(url);
  }

  async discover(
    request: DiscoverRequest,
    context: AdapterContext,
  ): Promise<AdapterOutcome<DiscoveredSource[]>> {
    const candidates = new Set<string>();
    for (const query of request.queries) {
      const canonical = canonicalizeInstagramUrl(query.text);
      if (canonical) candidates.add(canonical);
    }
    if (candidates.size === 0) return { ok: true, value: [] };

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
            ? 'Public profile or post readable without a session.'
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
      return {
        ok: false,
        reason: wallToFailure(assessment.wall),
        detail: context.authenticatedSession
          ? 'the connected session was not served this content'
          : 'no authenticated research session is connected',
      };
    }

    const discoveredAt = new Date(context.now()).toISOString();
    const items = extractInstagramItems(document.body, url, request.includeComments);

    const signals = items.map((item) =>
      buildSignal({
        item,
        platform: 'INSTAGRAM',
        sourceUrl: url,
        accessClass: context.authenticatedSession ? 'AUTHENTICATED' : 'PUBLIC',
        discoveredAt,
        language: null,
        languages: this.languages,
      }),
    );

    const limited = signals.slice(0, request.limit);

    const discovered = harvestSourceLinks(
      document.body,
      isInstagramSourceUrl,
      canonicalizeInstagramUrl,
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
        // Instagram exposes no dependable chronological cursor to an
        // anonymous fetch, so this adapter does not invent one. Re-scans rely
        // on content-hash dedupe instead, which is slower but true.
        cursor: null,
        truncated: signals.length > limited.length,
        discovered,
      },
    };
  }
}

export function extractInstagramItems(
  html: string,
  sourceUrl: string,
  includeComments: boolean,
): ExtractedItem[] {
  const out: ExtractedItem[] = [];
  const doc = parseHtml(html);
  const meta = extractMetadata(doc, sourceUrl);

  for (const node of extractJsonLd(doc).nodes) {
    const type = String(node['@type'] ?? '').toLowerCase();
    if (!['socialmediaposting', 'imageobject', 'videoobject', 'article'].includes(type)) continue;

    const text = readString(node, 'articleBody') ?? readString(node, 'caption') ?? readString(node, 'description');
    if (!text) continue;

    const author = node['author'];
    out.push({
      contentUrl: readString(node, 'url') ?? sourceUrl,
      parentUrl: null,
      parentExcerpt: null,
      text,
      authorName: typeof author === 'object' && author !== null
        ? readString(author as Record<string, unknown>, 'alternateName')
          ?? readString(author as Record<string, unknown>, 'name')
        : null,
      authorUrl: typeof author === 'object' && author !== null
        ? readString(author as Record<string, unknown>, 'url')
        : null,
      publishedAt: readString(node, 'uploadDate') ?? readString(node, 'datePublished'),
      contentType: contentTypeFor(readString(node, 'url') ?? sourceUrl),
    });

    if (!includeComments) continue;
    const comments = node['comment'];
    if (!Array.isArray(comments)) continue;
    for (const raw of comments) {
      if (typeof raw !== 'object' || raw === null) continue;
      const comment = raw as Record<string, unknown>;
      const commentText = readString(comment, 'text');
      if (!commentText) continue;
      const commentAuthor = comment['author'];
      out.push({
        contentUrl: readString(comment, 'url'),
        parentUrl: readString(node, 'url') ?? sourceUrl,
        parentExcerpt: text.slice(0, 280),
        text: commentText,
        authorName: typeof commentAuthor === 'object' && commentAuthor !== null
          ? readString(commentAuthor as Record<string, unknown>, 'alternateName')
          : null,
        authorUrl: null,
        publishedAt: readString(comment, 'datePublished'),
        contentType: 'COMMENT',
      });
    }
  }

  // A public post with no JSON-LD still carries its caption in og:description,
  // which is the only thing on the page that matters for intent.
  if (out.length === 0 && meta.description && meta.description.trim().length > 20) {
    out.push({
      contentUrl: sourceUrl,
      parentUrl: null,
      parentExcerpt: null,
      text: meta.description,
      authorName: null,
      authorUrl: null,
      // og tags carry no date, and inventing one from the crawl time would
      // turn "we found this today" into "this was posted today".
      publishedAt: null,
      contentType: contentTypeFor(sourceUrl),
    });
  }

  return out;
}

function readString(node: Record<string, unknown>, key: string): string | null {
  const value = node[key];
  if (typeof value === 'string' && value.trim()) return value.trim();
  return null;
}
