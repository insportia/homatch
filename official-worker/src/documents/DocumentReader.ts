// DocumentReader.ts — shared, PURE (no Playwright/HTTP) decision logic used
// by both concrete readers (OnlineDocumentReader.ts, PdfDocumentReader.ts).
// Ported unchanged in behavior from the pre-refactor lib/documentReader.js
// (already correct, already unit-tested — 12 tests) per Section 27's
// "migrate sound existing logic rather than rewriting it."
//
// classifyDocumentLink(): which discovered links are worth opening at all —
// keeps the exact junk-host/extension/phrase reasoning confirmed live
// against TAS's Adobe Reader installer link and its own ?p=searchdocument
// self-URL (both are here as concrete evidence, not a guess).
// detectPagination(): whether an already-open viewer page claims there is
// more to read — used by OnlineDocumentReader to decide whether to click
// "next" again or stop.

const JUNK_DOC_HOSTS = /(get\.adobe\.com|adobe\.com|google\.com\/chrome|facebook\.com|twitter\.com|x\.com|youtube\.com|flickr\.com|instagram\.com)/i;
const DOC_EXT = /\.(pdf|docx?|xlsx?)(?:$|\?)/i;
const DOC_PHRASE = /ამონაწერ|გადმოწერ(?:ა|ეთ)?\s|დოკუმენტ(?:ის|ები)?\s*(გადმოწერ|ჩამოტვირთ)|extract\s*document|download\s*document/i;
// Self/navigation URLs the page's own chrome links to (its own search page,
// its own home page) — confirmed live as false positives on TAS
// (?p=searchdocument is the search page itself, not a retrieved document).
const SELF_NAV_HINT = /[?&]p=(searchdocument|search|home|main|index)\b/i;

export interface DocumentLinkLike {
  url: string;
  label?: string;
}

export interface DocumentLinkClassification {
  worthOpening: boolean;
  looksLikeDirectFile: boolean;
  reason: string;
}

export function classifyDocumentLink(link: DocumentLinkLike, ctx: { pageUrl?: string } = {}): DocumentLinkClassification {
  const u = String(link?.url || '');
  if (!u) return { worthOpening: false, looksLikeDirectFile: false, reason: 'EMPTY_URL' };
  if (ctx.pageUrl && u === ctx.pageUrl) return { worthOpening: false, looksLikeDirectFile: false, reason: 'SELF_URL' };
  if (JUNK_DOC_HOSTS.test(u)) return { worthOpening: false, looksLikeDirectFile: false, reason: 'JUNK_HOST' };
  if (SELF_NAV_HINT.test(u)) return { worthOpening: false, looksLikeDirectFile: false, reason: 'SELF_NAV_URL' };
  if (DOC_EXT.test(u)) return { worthOpening: true, looksLikeDirectFile: true, reason: 'FILE_EXTENSION' };
  if (DOC_PHRASE.test(`${link?.label || ''} ${u}`)) return { worthOpening: true, looksLikeDirectFile: false, reason: 'DOCUMENT_PHRASE' };
  return { worthOpening: false, looksLikeDirectFile: false, reason: 'NO_DOCUMENT_SIGNAL' };
}

export function isRealDocumentLink(link: DocumentLinkLike, ctx?: { pageUrl?: string }): boolean {
  return classifyDocumentLink(link, ctx).worthOpening;
}

const PAGE_OF_RE = /(?:page|გვერდი)\s*(\d+)\s*(?:of|\/|დან)\s*(\d+)/i;
const NEXT_LABEL_RE = /(შემდეგი(?:\s*გვერდი)?|next(?:\s*page)?|»|›|forward)/i;

export interface PaginationInfo {
  currentPage: number | null;
  totalPages: number | null;
  hasMore: boolean;
}

export function detectPagination(text: string | null | undefined): PaginationInfo {
  const t = String(text || '');
  const m = PAGE_OF_RE.exec(t);
  if (m) {
    const current = parseInt(m[1], 10);
    const total = parseInt(m[2], 10);
    return { currentPage: current, totalPages: total, hasMore: total > current };
  }
  return { currentPage: null, totalPages: null, hasMore: NEXT_LABEL_RE.test(t) };
}

/** Safety cap shared by every caller that pages through an online viewer —
 * a runaway pagination loop (a "next" control that never disables) must
 * never turn into an unbounded crawl. */
export const MAX_VIEWER_PAGES = 25;

const DATE_PATTERNS = [/\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/, /\b(\d{4})[-.](\d{1,2})[-.](\d{1,2})\b/];
export function extractDateFromText(t: string | null | undefined): string | null {
  if (!t) return null;
  for (const re of DATE_PATTERNS) {
    const m = re.exec(t);
    if (m) return m[0];
  }
  return null;
}

import { createHash } from 'node:crypto';
/** Hashes the exact retrieved bytes (works for any document type, not just
 * parsed PDFs) so a document's authenticity/identity can be checked
 * independently of whether its text was extractable. Never guesses — a
 * hashing failure returns null rather than a fabricated value. */
export function sha256(buf: Buffer | string): string | null {
  try {
    return createHash('sha256').update(buf).digest('hex');
  } catch {
    return null;
  }
}
