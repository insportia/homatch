// PROPERTY IMPORT — the source registry.
//
// The importer is source-agnostic: URL → canonicalise → identify the source →
// that source's adapter → fetch what is publicly readable → extract →
// normalise → store with provenance. Each supported listing site is ONE entry
// here (how to recognise it, where its listing id lives, which public URLs
// address the same listing, and how to tell its listing page from a portal
// homepage or search page). Field extraction stays in the per-site adapters
// of import-property; an unknown domain goes to the generic extractor and
// fails truthfully when nothing reliable is found.
//
// THE 2026-10-04 CASE. myhome.ge answered the stored listing URL with 200 and
// its generic portal page (title "უძრავი ქონების პორტალი საქართველოში…",
// listing cards with prices). The old "has listing content" test accepted any
// page with a price or an area, so the homepage passed, extraction found none
// of THIS listing's facts, and the owner was told the listing "could not be
// read". A listing page must now show the listing itself (its id), and a page
// that does not is reported as the listing no longer being shown publicly.
// Nothing here bypasses a login, a CAPTCHA or an anti-bot wall.

export interface ListingSourceAdapter {
  /** Stable id stored as provenance (adapter_used). */
  id: string;
  label: string;
  matches(host: string): boolean;
  /** The site's listing id in this URL, or null when the URL carries none. */
  listingId(url: URL): string | null;
  /** Public URLs that address the same listing, original first (deduplicated). */
  candidateUrls(url: URL, id: string | null): string[];
  /** True only when the HTML is THIS listing's page, not a homepage or search page. */
  showsListing(html: string, id: string | null): boolean;
}

const titleOf = (html: string): string => (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
const uniq = (xs: string[]): string[] => [...new Set(xs)];

const MYHOME_PORTAL_TITLE = /უძრავი ქონების პორტალი საქართველოში|Real estate portal in Georgia|Портал недвижимости в Грузии/i;

export const MYHOME: ListingSourceAdapter = {
  id: 'myhome',
  label: 'MyHome.ge',
  matches: (host) => /(^|\.)myhome\.ge$/i.test(host),
  listingId: (url) => {
    const p = url.pathname;
    return p.match(/\/pr\/(\d{5,12})(?:\/|$)/)?.[1]
      ?? p.match(/-(\d{5,12})\/?$/)?.[1]
      ?? p.match(/\/(\d{6,12})\/?$/)?.[1]
      ?? null;
  },
  candidateUrls: (url, id) => uniq([url.toString(), ...(id ? [`https://www.myhome.ge/pr/${id}/`, `https://www.myhome.ge/ka/pr/${id}/`] : [])]),
  showsListing: (html, id) => {
    if (!id || !html.includes(id)) return false;
    const title = titleOf(html);
    /* The portal homepage carries the generic portal title and no listing id in it. */
    return !(MYHOME_PORTAL_TITLE.test(title) && !title.includes(id));
  },
};

export const SS: ListingSourceAdapter = {
  id: 'ss',
  label: 'SS.ge',
  matches: (host) => /(^|\.)ss\.ge$/i.test(host),
  listingId: (url) => url.pathname.match(/-(\d{5,12})\/?$/)?.[1] ?? url.pathname.match(/\/(\d{5,12})\/?$/)?.[1] ?? null,
  candidateUrls: (url) => [url.toString()],
  showsListing: (html, id) => Boolean(id && html.includes(id)),
};

/** Every supported listing source. A new site is one new entry. */
export const LISTING_SOURCES: readonly ListingSourceAdapter[] = [MYHOME, SS];

export interface ResolvedListingSource {
  adapter: ListingSourceAdapter;
  url: URL;
  listingId: string | null;
  candidates: string[];
}

/** The adapter for this URL, or null for a domain no adapter covers (generic extraction). */
export function resolveListingSource(raw: string): ResolvedListingSource | null {
  let url: URL;
  try { url = new URL(raw.trim()); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;
  url.hash = '';
  const adapter = LISTING_SOURCES.find((a) => a.matches(url.hostname));
  if (!adapter) return null;
  const listingId = adapter.listingId(url);
  return { adapter, url, listingId, candidates: adapter.candidateUrls(url, listingId) };
}
