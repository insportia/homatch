// Matching workspace — everything the customer chose lives in the URL, so a refresh, a
// bookmark or Back restores it exactly:
//
//   ?view=available|unlocked &product=internal|external
//   &country=GE,DE &lang=en,unknown &interest=BUY,RENT &q=…            (both products)
//   &channel=PHONE &category=EXPAT &source=PARTNER &added=yyyy-mm-dd
//   &verified=yyyy-mm-dd &loc=…                                         (External only)
//   &f=EXACT,STRONG &district=… &type=APARTMENT                         (Internal only)
//   &page=2 &size=200 &sort=…
//
// Unknown values are dropped on read; the server applies every filter.

import type { LeadFilter, LeadSort } from '@/services/homatchLeads';
import type { CatalogPageSize, CatalogSort, Channel, Interest, LeadCategoryCode, MatchingFilters, SourceClass } from '@/services/matchingWorkspace';

export type WsView = 'available' | 'unlocked';
export type WsProduct = 'internal' | 'external';

export const INTERESTS: Interest[] = ['BUY', 'RENT', 'INVEST'];
export const CHANNELS: Channel[] = ['PHONE', 'WHATSAPP', 'TELEGRAM', 'FACEBOOK', 'LINKEDIN', 'SOCIAL'];
export const CATEGORIES: LeadCategoryCode[] = ['PRIVATE', 'CORPORATE', 'DIASPORA', 'EXPAT', 'OTHER'];
export const SOURCES: SourceClass[] = ['PARTNER', 'EVENT', 'WEB_FORM', 'REFERRAL', 'DIRECTORY', 'OTHER'];
export const PAGE_SIZES: CatalogPageSize[] = [100, 200, 500];
export const CATALOG_SORTS: CatalogSort[] = ['NEWEST', 'NAME', 'COUNTRY', 'VERIFIED', 'UNLOCKED'];

/** The internal feed's own criteria: one choice per group (the server ANDs them). */
export const INTERNAL_GROUPS: LeadFilter[][] = [
  ['EXACT', 'NEARBY', 'VIP'],
  ['STRONG', 'POTENTIAL'],
  ['HIGH_CONFIDENCE'],
  ['DIRECT', 'BROKER'],
  ['FRESH'],
  ['MORTGAGE'],
  ['EXPAT'],
];
export const INTERNAL_CRITERIA: LeadFilter[] = INTERNAL_GROUPS.flat();
export const INTERNAL_SORTS: LeadSort[] = ['CATEGORY', 'BEST', 'NEWEST', 'ACTIVE', 'UPDATED', 'BUDGET_DESC', 'BUDGET_ASC'];

export interface InternalCriteria {
  criteria: LeadFilter[];
  district: string | null;
  propertyType: string | null;
}

export interface WsUrlState {
  view: WsView;
  product: WsProduct | null;
  filters: MatchingFilters;
  internal: InternalCriteria;
  page: number;
  pageSize: CatalogPageSize;
  sort: string | null;
}

const list = (v: string | null) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean);
const date = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
function pick<T extends string>(values: string[], allowed: readonly T[], upper = true): T[] {
  const out: T[] = [];
  for (const raw of values) {
    const v = (upper ? raw.toUpperCase() : raw) as T;
    if (allowed.includes(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

export function parseWsUrl(params: URLSearchParams): WsUrlState {
  const view: WsView = params.get('view') === 'unlocked' ? 'unlocked' : 'available';
  const p = params.get('product');
  const product: WsProduct | null = p === 'internal' || p === 'external' ? p : null;
  const size = Number(params.get('size'));
  return {
    view,
    product,
    filters: {
      countries: [...new Set(list(params.get('country')).map((c) => c.toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)))],
      languages: [...new Set(list(params.get('lang')).map((c) => c.toLowerCase()).filter((c) => /^[a-z]{2,3}$|^unknown$/.test(c)))],
      interests: pick(list(params.get('interest')), INTERESTS),
      channels: pick(list(params.get('channel')), CHANNELS),
      categories: pick(list(params.get('category')), CATEGORIES),
      sources: pick(list(params.get('source')), SOURCES),
      q: params.get('q') ?? '',
      addedSince: date(params.get('added')),
      verifiedSince: date(params.get('verified')),
      location: params.get('loc') ?? '',
    },
    internal: {
      criteria: oneOfEachGroup(pick(list(params.get('f')), INTERNAL_CRITERIA)),
      district: params.get('district') || null,
      propertyType: params.get('type') || null,
    },
    page: Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1),
    pageSize: (PAGE_SIZES as number[]).includes(size) ? (size as CatalogPageSize) : 100,
    sort: params.get('sort') || null,
  };
}

/** At most one criterion per group: a later choice in the same group wins. */
export function oneOfEachGroup(criteria: LeadFilter[]): LeadFilter[] {
  const out: LeadFilter[] = [];
  for (const c of criteria) {
    const group = INTERNAL_GROUPS.find((g) => g.includes(c)) ?? [c];
    for (let i = out.length - 1; i >= 0; i -= 1) if (group.includes(out[i])) out.splice(i, 1);
    out.push(c);
  }
  return out;
}

/** Toggle one internal criterion: it replaces any other in its group; choosing it again clears it. */
export function toggleCriterion(current: LeadFilter[], c: LeadFilter): LeadFilter[] {
  if (current.includes(c)) return current.filter((x) => x !== c);
  return oneOfEachGroup([...current, c]);
}

const FILTER_PARAMS = ['country', 'lang', 'interest', 'channel', 'category', 'source', 'q', 'added', 'verified', 'loc', 'f', 'district', 'type'] as const;

/** Write the filters into a copy of the params; paging restarts. */
export function writeFilters(prev: URLSearchParams, f: MatchingFilters, internal: InternalCriteria): URLSearchParams {
  const next = new URLSearchParams(prev);
  for (const k of FILTER_PARAMS) next.delete(k);
  next.delete('page');
  const set = (k: string, v: string | null | undefined) => { if (v) next.set(k, v); };
  set('country', f.countries.join(','));
  set('lang', f.languages.join(','));
  set('interest', f.interests.join(','));
  set('channel', f.channels.join(','));
  set('category', f.categories.join(','));
  set('source', f.sources.join(','));
  set('q', f.q.trim());
  set('added', f.addedSince);
  set('verified', f.verifiedSince);
  set('loc', f.location.trim());
  set('f', internal.criteria.join(','));
  set('district', internal.district);
  set('type', internal.propertyType);
  return next;
}

/** A stable identity for "the same filters" (an all-matching selection belongs to one). */
export function filtersKey(product: WsProduct, f: MatchingFilters, internal: InternalCriteria): string {
  return JSON.stringify(product === 'external'
    ? [f.countries, f.languages, f.interests, f.channels, f.categories, f.sources, f.q.trim(), f.addedSince, f.verifiedSince, f.location.trim()]
    : [f.countries, f.languages, f.interests, f.q.trim(), internal.criteria, internal.district, internal.propertyType]);
}

/** How many filters are set for this product (for the summary). */
export function activeFilters(product: WsProduct, f: MatchingFilters, internal: InternalCriteria): number {
  const shared = f.countries.length + f.languages.length + f.interests.length + (f.q.trim() ? 1 : 0);
  if (product === 'external') {
    return shared + f.channels.length + f.categories.length + f.sources.length
      + (f.addedSince ? 1 : 0) + (f.verifiedSince ? 1 : 0) + (f.location.trim() ? 1 : 0);
  }
  return shared + internal.criteria.length + (internal.district ? 1 : 0) + (internal.propertyType ? 1 : 0);
}
