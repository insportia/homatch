// HOMATCH RESEARCH CORE — reading a forum, which is not a listing portal.
//
// A portal publishes inventory: one page, one property, a price, a shape you
// can put in a table. A forum publishes PEOPLE TALKING, and the valuable part
// is usually the opposite of a listing — somebody saying what they are
// looking for. That is Demand, and Homatch has had no live source of it since
// the providers were retired.
//
// WHY THIS IS NOT PortalSourceConfig WITH DIFFERENT PATTERNS
//
// The portal family asks "what does this page say about one property". This
// asks "who posted, when, in what language, and were they offering or
// asking". A post has an author and a parent thread and no price basis; a
// listing has a price basis and no author. Forcing one into the other would
// produce a NormalizedListing with every field null and a description, which
// is how a forum ends up looking like a broken portal instead of a working
// forum.
//
// So this produces PublicSignal — the model the demand side already had —
// and the direction classifier decides what the post IS. Nothing here guesses
// at intent: classifyDirection() in signals/direction.ts owns that, in seven
// languages, and it has already been through the inversion bug where four
// languages classified their own buyers as sellers.
//
// WHAT IT WILL NOT DO
//
// Read a page robots.txt disallows, follow a login, or touch a private
// message. forum.ge disallows act=Print, act=Search, act=Online and act=Msg;
// none of those is reachable from here, and the fetch path refuses them
// anyway.
//
// It also does not read past the first page of a thread. A ten-year-old
// discussion with four hundred replies is not four hundred leads, and paging
// through it would be a crawler rather than a reader.

import { contentHash } from '../../normalize/hash.ts';
import { detectLanguage } from '../../normalize/language.ts';
import { classifyDirection } from '../../signals/direction.ts';
import type { ResearchLanguage } from '../../discovery/lexicon.ts';

export const FORUM_READER_VERSION = 'forum-board-1.0.0';

export interface ForumSourceConfig {
  /** Stable key. Appears in provenance and in the registry. */
  id: string;
  host: string;
  countryCode: string;
  /** The languages this board is actually written in. */
  languages: readonly ResearchLanguage[];
  /** A board (index of threads) URL for this source. */
  boardUrl: { pattern: RegExp };
  /** A thread URL, with the thread id in a capture group. */
  topicUrl: { pattern: RegExp; idGroup: number };
  /**
   * How the page separates one post from the next.
   *
   * forum.ge writes an HTML COMMENT before each one — "Begin Msg Number
   * 14172410" — which is a deliberate, stable marker and a better anchor than
   * a CSS class somebody will rename. The id in it is the post's own.
   */
  postDelimiter: { pattern: RegExp; idGroup: number };
  /** The poster's public name, inside a post block. */
  authorPattern?: RegExp;
  /** When the post says it was written, inside a post block. */
  datePattern?: RegExp;
  /**
   * Text this board puts in every post block that belongs to the FURNITURE
   * rather than to the post: signatures, quote chrome, the ignore notice.
   *
   * Removed before classification, because "this member is on your ignore
   * list" is not a property statement and a lexicon that sees it in every
   * post learns nothing.
   */
  boilerplate?: readonly RegExp[];
}

/** One post, as the board published it. */
export interface ForumPost {
  postId: string;
  /** The thread it belongs to. A reply's subject comes from its parent. */
  topicId: string;
  topicUrl: string;
  authorName: string | null;
  /** ISO day, when the board states one. Never the time we read it. */
  publishedAt: string | null;
  text: string;
}

const MONTHS: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

/**
 * "7 Jun 2009, 14:11" as an ISO day.
 *
 * The day only. The board states a time in a timezone it does not name, and
 * inventing one would be inventing precision — the same rule the portal
 * family applies to a published date.
 */
export function isoDay(raw: string): string | null {
  const m = /(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,})\s+(\d{4})/.exec(String(raw));
  if (!m) return null;
  const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (!month) return null;
  const day = m[1].padStart(2, '0');
  return `${m[3]}-${month}-${day}`;
}

/**
 * Visible text, with numeric entities decoded.
 *
 * forum.ge serves Georgian as &#4332; and friends, so a reader that only
 * stripped tags would hand the classifier a string of ampersands and decide
 * every Georgian post was unclassifiable.
 */
export function visibleText(html: string): string {
  return decodeEntities(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  ).replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
}

function decodeEntities(value: string): string {
  return String(value)
    .replace(/&#(\d+);/g, (_, code) => safeFromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => safeFromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    /* Ampersand LAST, or &amp;#4332; decodes to a literal &#4332;. */
    .replace(/&amp;/gi, '&');
}

function safeFromCodePoint(code: number): string {
  return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
}

/**
 * Thread URLs a board page links to, de-duplicated.
 *
 * SESSION IDS ARE STRIPPED. forum.ge puts ?s=<32 hex> on many of its own
 * links, and it changes every request. Left in, the same thread would be a
 * new external_id on every scan: the store would fill with duplicates that
 * no dedupe could catch, because nothing about them would match.
 */
export function topicUrls(html: string, base: string, config: ForumSourceConfig): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of decodeEntities(String(html)).matchAll(/href=["']([^"'#\s]+)["']/gi)) {
    let url: URL;
    try {
      url = new URL(match[1], base);
    } catch {
      continue;
    }
    const id = config.topicUrl.pattern.exec(url.toString())?.[config.topicUrl.idGroup];
    if (!id) continue;
    /* Canonical: the thread id and nothing else the session added. */
    const canonical = `${url.origin}${url.pathname}?showtopic=${id}`;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
  }
  return out;
}

/** Every post on one thread page, in document order. */
export function readTopic(html: string, url: string, config: ForumSourceConfig): ForumPost[] {
  const topicId = config.topicUrl.pattern.exec(url)?.[config.topicUrl.idGroup] ?? '';
  const source = String(html);
  const posts: ForumPost[] = [];

  /*
   * Split on the delimiter, keeping the id it carries. The first chunk is
   * everything before the first post — page chrome — and is dropped.
   */
  const parts = source.split(config.postDelimiter.pattern);
  const stride = config.postDelimiter.idGroup + 1;
  for (let i = 1; i < parts.length; i += stride) {
    const postId = parts[i];
    const block = parts[i + stride - 1] ?? '';
    if (!postId || !block) continue;

    let text = visibleText(block);
    for (const rule of config.boilerplate ?? []) text = text.replace(rule, ' ');
    text = text.replace(/\s+/g, ' ').trim();
    if (!text) continue;

    const authorName = config.authorPattern
      ? decodeEntities(config.authorPattern.exec(block)?.[1] ?? '').trim() || null
      : null;
    const publishedAt = config.datePattern
      ? isoDay(config.datePattern.exec(visibleText(block))?.[1] ?? '')
      : null;

    posts.push({ postId, topicId, topicUrl: url, authorName, publishedAt, text });
  }
  return posts;
}

/** What a post is: a request, an offer, or neither. */
export interface ForumObservation {
  externalId: string;
  sourceUrl: string;
  contentUrl: string;
  authorName: string | null;
  originalText: string;
  language: ResearchLanguage | null;
  publishedAt: string | null;
  contentFingerprint: string;
  direction: string;
  directionConfidence: number;
  agencyVoice: boolean;
  matchedPhrases: string[];
  readerVersion: string;
}

/**
 * A post, classified.
 *
 * THE LANGUAGE IS OBSERVED, NOT ASSUMED. A Russian post on a Georgian board
 * is a Russian post; stamping the board's language onto it would put the
 * wrong language on the evidence and, worse, would make a campaign's language
 * coverage a statement about where we looked rather than what we found.
 *
 * The direction is whatever the classifier decided, INCLUDING when it
 * decided nothing. An UNKNOWN post is stored as UNKNOWN: the alternative is
 * to drop it, and then nobody can ever see how much of a source this reader
 * cannot read.
 */
export function observe(post: ForumPost, config: ForumSourceConfig): ForumObservation {
  const detected = detectLanguage(post.text);
  const verdict = classifyDirection(post.text, { languages: config.languages });
  return {
    externalId: post.postId,
    sourceUrl: post.topicUrl,
    contentUrl: `${post.topicUrl}&view=findpost&p=${post.postId}`,
    authorName: post.authorName,
    originalText: post.text,
    language: detected?.reliable ? (detected.language as ResearchLanguage) : null,
    publishedAt: post.publishedAt,
    contentFingerprint: contentHash(post.text),
    direction: verdict.direction,
    directionConfidence: verdict.confidence,
    agencyVoice: verdict.agencyVoice,
    matchedPhrases: verdict.matched,
    readerVersion: FORUM_READER_VERSION,
  };
}
