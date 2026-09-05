// Document classification + pagination-detection helpers (2026-09-05).
//
// Major correction this module encodes (per explicit instruction): a
// document does NOT need to be a downloadable PDF to be "read" — the real
// official workflow frequently opens a document in an in-browser viewer
// instead. The actual page-driving (navigate, click "next page", extract
// innerText per page) still has to happen in Playwright, so it stays in
// index.js — but the DECISIONS about which links are worth opening at all,
// and whether a viewer's own UI is telling us there is more to read, are
// pure and belong here so they can be unit-tested without a browser.
//
// classifyDocumentLink() supersedes the old isRealDocumentLink() boolean:
// it keeps the exact same junk-host/extension/phrase reasoning (confirmed
// live against TAS's Adobe Reader installer link and its own
// ?p=searchdocument self-URL) but returns a reason so a rejected link is
// traceable, and separates "looks like a direct file" from "looks like a
// document worth opening as a page" — a link can be the latter without
// being the former (e.g. a same-domain detail page with no file extension
// at all, which is exactly the "online viewer" case).

const JUNK_DOC_HOSTS = /(get\.adobe\.com|adobe\.com|google\.com\/chrome|facebook\.com|twitter\.com|x\.com|youtube\.com|flickr\.com|instagram\.com)/i;
const DOC_EXT = /\.(pdf|docx?|xlsx?)(?:$|\?)/i;
const DOC_PHRASE = /ამონაწერ|გადმოწერ(?:ა|ეთ)?\s|დოკუმენტ(?:ის|ები)?\s*(გადმოწერ|ჩამოტვირთ)|extract\s*document|download\s*document/i;
// Self/navigation URLs the page's own chrome links to (its own search page,
// its own home page) — confirmed live as false positives on TAS
// (?p=searchdocument is the search page itself, not a retrieved document).
const SELF_NAV_HINT = /[?&]p=(searchdocument|search|home|main|index)\b/i;

/**
 * @param {{url:string,label?:string}} link
 * @param {{pageUrl?:string}} [ctx] optional context: the page this link was
 *   found on, so an exact self-referencing link (same URL) can be excluded
 *   even without matching SELF_NAV_HINT.
 * @returns {{worthOpening:boolean, looksLikeDirectFile:boolean, reason:string}}
 */
function classifyDocumentLink(link, ctx = {}) {
  const u = String(link?.url || '');
  if (!u) return { worthOpening: false, looksLikeDirectFile: false, reason: 'EMPTY_URL' };
  if (ctx.pageUrl && u === ctx.pageUrl) return { worthOpening: false, looksLikeDirectFile: false, reason: 'SELF_URL' };
  if (JUNK_DOC_HOSTS.test(u)) return { worthOpening: false, looksLikeDirectFile: false, reason: 'JUNK_HOST' };
  if (SELF_NAV_HINT.test(u)) return { worthOpening: false, looksLikeDirectFile: false, reason: 'SELF_NAV_URL' };
  if (DOC_EXT.test(u)) return { worthOpening: true, looksLikeDirectFile: true, reason: 'FILE_EXTENSION' };
  if (DOC_PHRASE.test(`${link?.label || ''} ${u}`)) return { worthOpening: true, looksLikeDirectFile: false, reason: 'DOCUMENT_PHRASE' };
  return { worthOpening: false, looksLikeDirectFile: false, reason: 'NO_DOCUMENT_SIGNAL' };
}

/** Backward-compatible boolean form (what index.js's old isRealDocumentLink
 * did) — kept so existing call sites need only swap the import. */
function isRealDocumentLink(link, ctx) { return classifyDocumentLink(link, ctx).worthOpening; }

// Pagination hints an in-browser document viewer typically exposes — either
// an explicit "page N of M" / "გვერდი N / M" caption, or a labeled
// next/forward control. Both Georgian and English forms are recognized
// since TAS/NAPR-hosted viewers mix both depending on the underlying app.
const PAGE_OF_RE = /(?:page|გვერდი)\s*(\d+)\s*(?:of|\/|დან)\s*(\d+)/i;
const NEXT_LABEL_RE = /(შემდეგი(?:\s*გვერდი)?|next(?:\s*page)?|»|›|forward)/i;

/**
 * @param {string} text visible text of the currently-open viewer page
 * @returns {{currentPage:number|null, totalPages:number|null, hasMore:boolean}}
 *   hasMore is true when either a "page N of M" caption with N<M is found,
 *   OR (when no such caption exists at all) a plausible "next" control label
 *   is present in the text — the second case is intentionally weaker
 *   evidence (a "next" WORD appearing in text is not proof of an enabled
 *   button) so callers should treat hasMore:true from that branch as "worth
 *   trying to click next", not as a confirmed page count.
 */
function detectPagination(text) {
  const t = String(text || '');
  const m = PAGE_OF_RE.exec(t);
  if (m) {
    const current = parseInt(m[1], 10), total = parseInt(m[2], 10);
    return { currentPage: current, totalPages: total, hasMore: total > current };
  }
  return { currentPage: null, totalPages: null, hasMore: NEXT_LABEL_RE.test(t) };
}

/** Safety cap shared by every caller that pages through an online viewer —
 * a runaway pagination loop (a "next" control that never disables) must
 * never turn into an unbounded crawl. */
const MAX_VIEWER_PAGES = 25;

export { classifyDocumentLink, isRealDocumentLink, detectPagination, MAX_VIEWER_PAGES, JUNK_DOC_HOSTS, DOC_EXT, DOC_PHRASE };
