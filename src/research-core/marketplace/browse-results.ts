import type { ResultProperty } from './pipeline.ts';
import { listingActivity } from './freshness.ts';
import { RESULT_SECTIONS, type ResultSection } from './result-evidence.ts';

export type CustomerProperty = Omit<ResultProperty, 'internal'> & { tradeoffs?: string[] };
export interface ResultFilters {
  priceMin?: number; priceMax?: number; areaMin?: number; areaMax?: number;
  bedroomsMin?: number; roomsMin?: number; district?: string; ageDays?: number;
  building?: string; condition?: string; seller?: string; source?: string;
  strongOnly?: boolean; hidePossibleDuplicates?: boolean; verification?: 'CLEAR' | 'NEEDS';
  section?: ResultSection; sort?: 'RANKED' | 'FRESHEST' | 'PRICE' | 'VALUE';
}
export const RESULT_PAGE_SIZE = 12;
const NUMBERS = ['priceMin', 'priceMax', 'areaMin', 'areaMax', 'bedroomsMin', 'roomsMin', 'ageDays'] as const;
const STRINGS = ['district', 'building', 'condition', 'seller', 'source'] as const;
export function sanitizeResultFilters(raw: unknown): ResultFilters {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const source = raw as Record<string, unknown>;
  const filters: ResultFilters = {};
  for (const key of NUMBERS) {
    const value = source[key];
    if ((typeof value === 'number' || typeof value === 'string') && value !== '' && Number.isFinite(Number(value)) && Number(value) >= 0) filters[key] = Math.min(Number(value), key === 'ageDays' ? 30 : 1e9);
  }
  for (const key of STRINGS) if (typeof source[key] === 'string' && source[key].trim()) filters[key] = source[key].trim().slice(0, 160);
  for (const key of ['strongOnly', 'hidePossibleDuplicates'] as const) if (source[key] === true || source[key] === 'true') filters[key] = true;
  if (source.verification === 'CLEAR' || source.verification === 'NEEDS') filters.verification = source.verification;
  if (RESULT_SECTIONS.includes(source.section as ResultSection)) filters.section = source.section as ResultSection;
  if (['RANKED', 'FRESHEST', 'PRICE', 'VALUE'].includes(String(source.sort))) filters.sort = source.sort as ResultFilters['sort'];
  return filters;
}

export function filtersFromParams(params: URLSearchParams): ResultFilters {
  return sanitizeResultFilters(Object.fromEntries([...params].filter(([key]) => key.startsWith('fp_')).map(([key, value]) => [key.slice(3), value])));
}
export function resultParams(params: URLSearchParams, patch: Partial<ResultFilters>, page?: number): URLSearchParams {
  const next = new URLSearchParams(params);
  const filters = sanitizeResultFilters({ ...filtersFromParams(params), ...patch });
  for (const key of [...next.keys()]) if (key.startsWith('fp_')) next.delete(key);
  for (const [key, value] of Object.entries(filters)) next.set(`fp_${key}`, String(value));
  next.set('page', String(page === undefined ? 1 : Math.max(1, Math.trunc(page) || 1)));
  return next;
}
export function currentActivity(p: CustomerProperty, now = new Date()) {
  // Representative source activity only: a new cross-post cannot silently re-date an old one.
  const primary = p.listings.find((l) => l.listingId === p.intelligence?.primaryListingId) ?? p.listings[0];
  if (primary?.publishedAt || primary?.updatedAt) return listingActivity(primary.publishedAt, primary.updatedAt, now);
  const known = p.intelligence?.activity;
  return listingActivity(known?.basis === 'PUBLISHED' ? known.at : null, known?.basis === 'UPDATED' ? known.at : null, now);
}
export const isCurrentResult = (p: CustomerProperty, now = new Date()) => !currentActivity(p, now).expired;

/** A live catalogue is never silently reordered under an existing page URL. */
export async function catalogueRevision(properties: readonly CustomerProperty[], now = new Date()): Promise<string> {
  const stable = [...properties].sort((a, b) => a.key.localeCompare(b.key));
  const current = stable.filter((p) => isCurrentResult(p, now)).map((p) => [p.key, p.intelligence?.section === 'FRESH' && (currentActivity(p, now).ageDays ?? 31) <= 2]);
  const bytes = new TextEncoder().encode(JSON.stringify({ properties: stable, current }));
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface BrowsePage {
  items: CustomerProperty[]; page: number; pageSize: number; pages: number; total: number; totalCurrent: number;
  sections: Record<ResultSection, number>;
  summary: { strong: number; close: number; verification: number; unknownDates: number; excludedOld: number };
  facets: { districts: string[]; buildings: string[]; conditions: string[]; sellers: string[]; sources: Array<{ key: string; name: string }> };
}
const sectionOf = (p: CustomerProperty): ResultSection => p.intelligence?.section ?? (p.group === 'UPGRADE' ? 'UPGRADE' : p.group === 'BEST' ? 'BEST' : 'CLOSE');
export function browseResults(properties: readonly CustomerProperty[], rawFilters: unknown = {}, requestedPage = 1, now = new Date()): BrowsePage {
  const filters = sanitizeResultFilters(rawFilters);
  const byKey = new Map<string, CustomerProperty>();
  for (const p of [...properties].sort((a, b) => b.score - a.score || a.key.localeCompare(b.key))) if (!byKey.has(p.key)) byKey.set(p.key, p);
  const unique = [...byKey.values()];
  const current = unique.filter((p) => isCurrentResult(p, now)).map((p) => {
    const activity = currentActivity(p, now);
    if (!p.intelligence) return p;
    const section = p.intelligence.section === 'FRESH' && (activity.ageDays === null || activity.ageDays > 2) ? 'CLOSE' : p.intelligence.section;
    return { ...p, intelligence: { ...p.intelligence, activity, section } };
  });
  const fitNumber = (value: number | null, min?: number, max?: number) => (min === undefined && max === undefined)
    || value !== null && (min === undefined || value >= min) && (max === undefined || value <= max);
  const matches = current.filter((p) => {
    const f = p.facts, intel = p.intelligence, age = currentActivity(p, now).ageDays;
    return fitNumber(f.priceUsd, filters.priceMin, filters.priceMax) && fitNumber(f.areaSqm, filters.areaMin, filters.areaMax)
      && fitNumber(f.bedrooms, filters.bedroomsMin) && fitNumber(f.rooms, filters.roomsMin)
      && (!filters.district || f.district === filters.district)
      && (filters.ageDays === undefined || age !== null && age <= filters.ageDays)
      && (!filters.building || f.buildingStatus === filters.building)
      && (!filters.condition || f.renovationStatus === filters.condition)
      && (!filters.seller || p.seller.classification === filters.seller)
      && (!filters.source || p.listings.some((l) => l.source === filters.source))
      && (!filters.strongOnly || intel?.strong === true)
      && (!filters.hidePossibleDuplicates || !intel?.warnings.includes('POSSIBLE_DUPLICATE'))
      && (!filters.verification || (filters.verification === 'NEEDS') === !!intel?.verificationNeeded);
  });
  const sections = Object.fromEntries(RESULT_SECTIONS.map((s) => [s, matches.filter((p) => sectionOf(p) === s).length])) as Record<ResultSection, number>;
  const ranked = matches.filter((p) => !filters.section || sectionOf(p) === filters.section).sort((a, b) => {
    const ageA = currentActivity(a, now).ageDays ?? 31, ageB = currentActivity(b, now).ageDays ?? 31;
    if (filters.sort === 'FRESHEST') return ageA - ageB || b.score - a.score || a.key.localeCompare(b.key);
    if (filters.sort === 'PRICE') return (a.facts.priceUsd ?? Infinity) - (b.facts.priceUsd ?? Infinity) || a.key.localeCompare(b.key);
    if (filters.sort === 'VALUE') return (a.vsComparable ?? Infinity) - (b.vsComparable ?? Infinity) || b.score - a.score || a.key.localeCompare(b.key);
    return RESULT_SECTIONS.indexOf(sectionOf(a)) - RESULT_SECTIONS.indexOf(sectionOf(b)) || b.score - a.score || ageA - ageB || a.key.localeCompare(b.key);
  });
  const pages = Math.max(1, Math.ceil(ranked.length / RESULT_PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Math.trunc(Number(requestedPage)) || 1));
  const distinct = (values: Array<string | null>) => [...new Set(values.filter((v): v is string => !!v))].sort();
  const sources = new Map<string, string>();
  for (const p of current) for (const l of p.listings) sources.set(l.source, l.sourceName ?? l.source);
  return {
    items: ranked.slice((page - 1) * RESULT_PAGE_SIZE, page * RESULT_PAGE_SIZE), page, pageSize: RESULT_PAGE_SIZE, pages, total: ranked.length, totalCurrent: current.length, sections,
    summary: { strong: matches.filter((p) => p.intelligence?.strong).length, close: sections.CLOSE, verification: sections.VERIFY,
      unknownDates: current.filter((p) => currentActivity(p, now).at === null).length, excludedOld: unique.length - current.length },
    facets: { districts: distinct(current.map((p) => p.facts.district)), buildings: distinct(current.map((p) => p.facts.buildingStatus)),
      conditions: distinct(current.map((p) => p.facts.renovationStatus)), sellers: distinct(current.map((p) => p.seller.classification)),
      sources: [...sources].sort(([a], [b]) => a.localeCompare(b)).map(([key, name]) => ({ key, name })) },
  };
}

/** Bounded numbered control, including both ends and gaps, for mobile as well as desktop. */
export function pageNumbers(page: number, pages: number): Array<number | 'gap'> {
  const chosen = [...new Set([1, pages, page - 1, page, page + 1].filter((n) => n >= 1 && n <= pages))].sort((a, b) => a - b);
  const result: Array<number | 'gap'> = [];
  chosen.forEach((n, i) => { if (i && n - chosen[i - 1] > 1) result.push('gap'); result.push(n); });
  return result;
}
