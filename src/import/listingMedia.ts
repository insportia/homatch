// Every photo of ONE listing, from the listing page itself — and nothing else
// (no logos, avatars, banners, recommendations or other listings' thumbnails).
//
// Production case (2026-10-04): MyHome listing 25805378 shows many photos;
// HOMATCH stored one. The importer read a single __NEXT_DATA__ path and fell
// back to og:image (one thumbnail) when that path was absent, and every
// gallery source was capped at five. This module reads, in order of trust:
//
//   1. an images array that belongs to the listing object (its id matches the
//      listing id) in __NEXT_DATA__ or the Next.js App Router payload
//      (self.__next_f.push chunks);
//   2. JSON-LD image arrays of the page's own listing;
//   3. as a last resort, statement-CDN uploads that share the cover photo's
//      upload folder (a listing's photos are uploaded together; another
//      listing's thumbnails live in other folders).
//
// Source order is kept; variants of one photo (thumb / large / blur) collapse
// to the largest; an external gallery is never cut to a manual-upload limit.
// Pure: no network, no Deno — the edge importer and the tests both use it.

export const IMPORTED_GALLERY_MAX = 60;

export interface MediaExtraction {
  images: string[];
  /** Distinct listing photos seen before the cap. */
  candidates: number;
  rejected: number;
  method: 'LISTING_OBJECT' | 'APP_ROUTER_PAYLOAD' | 'JSON_LD' | 'COVER_FOLDER' | 'NONE';
}

const REJECT = [
  /logo/i, /\/icons?\//i, /favicon/i, /\/avatars?\//i, /avatar/i, /\/banners?\//i, /placeholder/i,
  /\/ui\//i, /pixel/i, /\.svg(\?|$)/i, /static\.my\.ge\/myhome\/images/i, /1x1\.(png|gif)/i, /spacer\./i,
  /\/(users?|profiles?|agents?|agencies|brokers?|developers?)\//i, /\/ads?\//i, /\/promo/i,
];
const IMAGE_EXT = /\.(webp|jpe?g|png|avif)(\?|#|$)/i;
const SIZE_SUFFIX = /(?:[_-](?:thumb|thumbnail|small|medium|large|big|blur|preview|orig|original|\d{2,4}x\d{2,4}))+(?=\.[a-z0-9]+$)/i;
const SIZE_DIR = /\/(?:thumbs?|small|medium|large|big|blur|preview|original|\d{2,4}x\d{2,4})\//gi;

function unescapeUrl(u: string): string {
  return u.replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&').trim();
}

export function isListingPhotoUrl(raw: string): boolean {
  const u = unescapeUrl(raw);
  if (!/^https:\/\//i.test(u)) return false;
  if (!IMAGE_EXT.test(u.split('?')[0])) return false;
  return !REJECT.some((r) => r.test(u));
}

/** The identity of a photo regardless of size variant (thumb / large / blur). */
export function photoIdentity(raw: string): string {
  const u = unescapeUrl(raw).split('?')[0].split('#')[0];
  const path = u.replace(/^https?:\/\/[^/]+/i, '').replace(SIZE_DIR, '/');
  const file = path.split('/').pop() ?? path;
  return file.replace(SIZE_SUFFIX, '').toLowerCase();
}

function variantRank(raw: string): number {
  const u = raw.toLowerCase();
  if (/(original|orig|large|big)/.test(u)) return 3;
  if (/(thumb|small|blur|preview)/.test(u)) return 0;
  return 2;
}

/** Ordered, de-duplicated (largest variant wins), filtered, capped. */
export function orderedGallery(urls: string[], max = IMPORTED_GALLERY_MAX): { images: string[]; candidates: number; rejected: number } {
  const order: string[] = [];
  const best = new Map<string, string>();
  let rejected = 0;
  for (const raw of urls) {
    const u = unescapeUrl(String(raw ?? ''));
    if (!u) continue;
    if (!isListingPhotoUrl(u)) { rejected++; continue; }
    const id = photoIdentity(u);
    const prev = best.get(id);
    if (!prev) { order.push(id); best.set(id, u); }
    else if (variantRank(u) > variantRank(prev)) best.set(id, u);
  }
  const all = order.map((id) => best.get(id)!) ;
  return { images: all.slice(0, max), candidates: all.length, rejected };
}

/** A URL out of an images-array entry (string or {large,url,src,...}). */
function entryUrl(entry: unknown): string | null {
  if (typeof entry === 'string') return entry;
  if (!entry || typeof entry !== 'object') return null;
  const o = entry as Record<string, unknown>;
  for (const k of ['large', 'original', 'big', 'full', 'url', 'src', 'image', 'path', 'medium', 'thumb', 'thumbnail']) {
    const v = o[k];
    if (typeof v === 'string' && v) return v;
  }
  return null;
}

function idMatches(obj: Record<string, unknown>, listingId: string | null): boolean {
  if (!listingId) return false;
  for (const k of ['id', 'statement_id', 'statementId', 'application_id', 'listing_id', 'listingId', 'uuid']) {
    if (obj[k] != null && String(obj[k]) === listingId) return true;
  }
  return false;
}

/** Depth-first search for the listing object (id match) carrying an images-like array. */
function findListingImages(node: unknown, listingId: string | null, depth = 0): unknown[] | null {
  if (depth > 40 || !node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) { const hit = findListingImages(child, listingId, depth + 1); if (hit) return hit; }
    return null;
  }
  const obj = node as Record<string, unknown>;
  if (idMatches(obj, listingId)) {
    for (const k of ['images', 'photos', 'gallery', 'pictures', 'media']) {
      if (Array.isArray(obj[k]) && (obj[k] as unknown[]).length) return obj[k] as unknown[];
    }
  }
  for (const v of Object.values(obj)) { const hit = findListingImages(v, listingId, depth + 1); if (hit) return hit; }
  return null;
}

function nextData(html: string): unknown | null {
  const m = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
}

/** The Next.js App Router payload: self.__next_f.push([1,"…"]) chunks, decoded and joined. */
export function appRouterPayload(html: string): string {
  const parts: string[] = [];
  for (const m of html.matchAll(/self\.__next_f\.push\(\[\s*\d+\s*,\s*("(?:[^"\\]|\\.)*")\s*\]\)/g)) {
    try { parts.push(JSON.parse(m[1]) as string); } catch { /* a chunk that is not a JSON string */ }
  }
  return parts.join('');
}

/** Bracket-matched JSON array starting at `start` (the '['). */
function arrayAt(text: string, start: number): string | null {
  let depth = 0; let inStr = false; let esc = false;
  for (let i = start; i < text.length && i - start < 200_000; i++) {
    const c = text[i];
    if (inStr) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) return text.slice(start, i + 1); }
  }
  return null;
}

/** In a payload text: the images array whose enclosing object names this listing id. */
function payloadListingImages(text: string, listingId: string | null): unknown[] | null {
  if (!listingId || !text) return null;
  let best: unknown[] | null = null;
  const idRe = new RegExp(`"(?:id|statement_id|statementId|application_id)"\\s*:\\s*"?${listingId}"?(?![0-9])`);
  for (const m of text.matchAll(/"(?:images|photos|gallery)"\s*:\s*\[/g)) {
    const at = (m.index ?? 0) + m[0].length - 1;
    /* The object that owns this array: back to the nearest unmatched '{'. */
    let depth = 0; let open = -1;
    for (let i = m.index ?? 0; i >= 0 && (m.index ?? 0) - i < 60_000; i--) {
      const c = text[i];
      if (c === '}') depth++;
      else if (c === '{') { if (depth === 0) { open = i; break; } depth--; }
    }
    if (open < 0) continue;
    const arr = arrayAt(text, at);
    if (!arr) continue;
    const head = text.slice(open, at);
    const tailEnd = Math.min(text.length, at + arr.length + 4000);
    if (!idRe.test(head) && !idRe.test(text.slice(at + arr.length, tailEnd).split(/\}\s*,\s*\{/)[0])) continue;
    try {
      const parsed = JSON.parse(arr) as unknown[];
      if (Array.isArray(parsed) && (!best || parsed.length > best.length)) best = parsed;
    } catch { /* not plain JSON */ }
  }
  return best;
}

function jsonLdImages(html: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try { data = JSON.parse(m[1]); } catch { continue; }
    const items = Array.isArray(data) ? data : [data];
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const t = String((item as Record<string, unknown>)['@type'] ?? '');
      if (/(Organization|WebSite|BreadcrumbList|Person|SearchAction)/i.test(t)) continue;
      const img = (item as Record<string, unknown>).image;
      const list = Array.isArray(img) ? img : img ? [img] : [];
      for (const e of list) { const u = entryUrl(e); if (u) out.push(u); }
    }
  }
  return out;
}

/** Statement-CDN uploads that share the cover's upload folder, in page order. */
function coverFolderImages(html: string, cover: string | null): string[] {
  if (!cover) return [];
  const c = unescapeUrl(cover).split('?')[0];
  const folder = c.replace(SIZE_DIR, '/').replace(/\/[^/]+$/, '/');
  if (!/\/uploads\/|\/statements\//i.test(folder)) return [];
  const host = c.match(/^https:\/\/[^/]+/i)?.[0] ?? '';
  const text = html.replace(/\\u002[fF]/g, '/').replace(/\\\//g, '/');
  const out: string[] = [];
  const re = /https:\/\/[^\s"'<>()\\]+?\.(?:webp|jpe?g|png|avif)/gi;
  for (const m of text.matchAll(re)) {
    const u = m[0];
    if (!u.startsWith(host)) continue;
    if (u.replace(SIZE_DIR, '/').replace(/\/[^/]+$/, '/') === folder) out.push(u);
  }
  return out;
}

function ogImage(html: string): string | null {
  const m = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  return m ? m[1] : null;
}

export function extractListingMedia(html: string, opts: { listingId?: string | null; coverHint?: string | null } = {}): MediaExtraction {
  const listingId = opts.listingId ? String(opts.listingId) : null;
  const done = (urls: string[], method: MediaExtraction['method']): MediaExtraction | null => {
    const g = orderedGallery(urls);
    return g.images.length ? { ...g, method } : null;
  };

  const nd = nextData(html);
  const fromNext = nd ? findListingImages(nd, listingId) : null;
  const a = fromNext ? done(fromNext.map(entryUrl).filter((u): u is string => !!u), 'LISTING_OBJECT') : null;

  const payload = appRouterPayload(html);
  const fromPayload = payloadListingImages(payload, listingId);
  const b = fromPayload ? done(fromPayload.map(entryUrl).filter((u): u is string => !!u), 'APP_ROUTER_PAYLOAD') : null;

  /* The listing object is the most trusted; between two listing-owned arrays, the fuller one. */
  const owned = [a, b].filter((x): x is MediaExtraction => !!x).sort((x, y) => y.candidates - x.candidates)[0];
  if (owned && owned.candidates > 1) return owned;

  const c = done(jsonLdImages(html), 'JSON_LD');
  if (c && c.candidates > (owned?.candidates ?? 0)) return c;

  const d = done(coverFolderImages(html, opts.coverHint ?? ogImage(html)), 'COVER_FOLDER');
  const best = [owned, c, d].filter((x): x is MediaExtraction => !!x).sort((x, y) => y.candidates - x.candidates)[0];
  return best ?? { images: [], candidates: 0, rejected: 0, method: 'NONE' };
}

/**
 * Merge a refreshed source gallery into what the property holds, without
 * losing anything: existing entries keep their place (owner edits included),
 * newly found source photos are appended in source order, variants of a photo
 * already held are not added twice.
 */
export function mergeGallery(existing: string[], fresh: string[], max = IMPORTED_GALLERY_MAX): string[] {
  const held = new Set(existing.map(photoIdentity));
  const out = [...existing];
  for (const u of fresh) {
    const id = photoIdentity(u);
    if (held.has(id)) continue;
    held.add(id);
    out.push(u);
    if (out.length >= max) break;
  }
  return out;
}
