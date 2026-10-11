// korter/feed.ts — Korter market data, ONLY through a licensed feed.
//
// There is no documented Korter API today and its terms forbid scraping (see
// access.ts). This module is the contract a licensed feed would plug into:
// KORTER_FEED_URL + KORTER_FEED_KEY (both absent in production). Without
// them fetchKorterFeed refuses before any network call.
//
// What the normaliser guarantees, matching the Verify market comparable
// contract (VerifyMarketRuntime.VerifyComparable):
//   - provenance on every row (provider, feed, item id, fetchedAt);
//   - timestamps kept as the feed stated them, never invented;
//   - price kind is EXPLICIT: ASKING (on the market) or HISTORICAL (a past
//     ask or a recorded sale). A row that does not say which is rejected,
//     and the two kinds are returned in separate lists, never mixed;
//   - no seller identity, phone, e-mail, description or photo survives;
//   - a dedupe key (address + area + floor + price window) so a flat already
//     found on MyHome.ge / SS.ge is not counted twice.

import type { VerifyComparable } from '../VerifyMarketRuntime.js';
import { korterFeedConfigured } from './access.js';

export type KorterPriceKind = 'ASKING' | 'HISTORICAL';

export interface KorterComparable extends Omit<VerifyComparable, 'source' | 'scope' | 'phoneHash' | 'imageHashes'> {
  source: 'KORTER';
  priceKind: KorterPriceKind;
  /** The project / residential complex name, when the feed names one. */
  project: string | null;
  scope: 'DISTRICT' | 'CITY';
  imageHashes: string[];
  phoneHash: null;
  provenance: { provider: 'KORTER'; channel: 'LICENSED_FEED'; feedItemId: string; fetchedAt: string };
}

export interface KorterNormalized {
  asking: KorterComparable[];
  historical: KorterComparable[];
  rejected: Array<{ id: string | null; reason: string }>;
}

const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : typeof v === 'number' && Number.isFinite(v) ? String(v) : null);
const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.').replace(/[^\d.-]/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const int = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.trim()) : NaN;
  return Number.isInteger(n) ? n : null;
};
const iso = (v: unknown): string | null => {
  const s = str(v, 40);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
};

/** ASKING / HISTORICAL from what the feed states; null when it does not say. */
export function korterPriceKind(item: Record<string, unknown>): KorterPriceKind | null {
  const k = String(item.priceKind ?? item.priceType ?? item.price_type ?? '').trim().toLowerCase();
  if (/^(asking|ask|offer|list(ing)?|active|current)$/.test(k)) return 'ASKING';
  if (/^(historical|history|sold|sale|transaction|closed|archived|past)$/.test(k)) return 'HISTORICAL';
  return null;
}

/** One feed item → a Verify comparable, or a reason it was rejected. */
export function normalizeKorterItem(
  item: Record<string, unknown>,
  ctx: { fetchedAt: string; scope?: 'DISTRICT' | 'CITY' },
): { ok: KorterComparable } | { rejected: string } {
  const id = str(item.id ?? item.listingId ?? item.listing_id, 80);
  if (!id) return { rejected: 'NO_ID' };
  const url = str(item.url ?? item.link, 500);
  if (!url || !/^https:\/\/(?:[a-z0-9-]+\.)*korter\.[a-z.]+\//i.test(url)) return { rejected: 'NO_KORTER_URL' };
  const priceKind = korterPriceKind(item);
  if (!priceKind) return { rejected: 'PRICE_KIND_UNSTATED' };
  const price = num(item.price);
  const area = num(item.areaSqm ?? item.area ?? item.area_m2);
  const currency = str(item.currency, 8)?.toUpperCase() ?? null;
  if (!price || !currency) return { rejected: 'NO_PRICE' };
  const stated = num(item.pricePerSqm ?? item.price_per_sqm);
  const pricePerSqm = stated ?? (area ? Math.round((price / area) * 100) / 100 : null);
  return {
    ok: {
      source: 'KORTER',
      sourceListingId: id,
      exactUrl: url,
      price,
      currency,
      pricePerSqm,
      areaSqm: area,
      rooms: num(item.rooms),
      bedrooms: num(item.bedrooms),
      floor: int(item.floor),
      totalFloors: num(item.totalFloors ?? item.floors),
      city: str(item.city, 80),
      district: str(item.district, 80),
      address: str(item.address, 200),
      latitude: typeof item.latitude === 'number' ? item.latitude : null,
      longitude: typeof item.longitude === 'number' ? item.longitude : null,
      propertyType: str(item.propertyType, 40),
      transactionType: str(item.transactionType ?? item.dealType, 40),
      buildingStatus: str(item.buildingStatus ?? item.constructionStatus, 60),
      renovationStatus: str(item.condition ?? item.renovationStatus, 60),
      title: str(item.title, 160),
      project: str(item.project ?? item.complex ?? item.complexName, 160),
      publishedAt: iso(item.publishedAt ?? item.listedAt),
      updatedAt: iso(item.updatedAt),
      observedAt: iso(item.observedAt) ?? ctx.fetchedAt,
      imageHashes: [],
      phoneHash: null,
      scope: ctx.scope ?? 'CITY',
      priceKind,
      provenance: { provider: 'KORTER', channel: 'LICENSED_FEED', feedItemId: id, fetchedAt: ctx.fetchedAt },
    },
  };
}

export function normalizeKorterFeed(items: unknown, ctx: { fetchedAt: string; scope?: 'DISTRICT' | 'CITY' }): KorterNormalized {
  const out: KorterNormalized = { asking: [], historical: [], rejected: [] };
  const seen = new Set<string>();
  for (const raw of Array.isArray(items) ? items : []) {
    if (!raw || typeof raw !== 'object') {
      out.rejected.push({ id: null, reason: 'NOT_AN_OBJECT' });
      continue;
    }
    const r = normalizeKorterItem(raw as Record<string, unknown>, ctx);
    if ('rejected' in r) {
      out.rejected.push({ id: str((raw as any).id, 80), reason: r.rejected });
      continue;
    }
    const k = `${r.ok.priceKind}:${r.ok.sourceListingId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    (r.ok.priceKind === 'ASKING' ? out.asking : out.historical).push(r.ok);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Dedupe against MyHome.ge / SS.ge                                    *
 * ------------------------------------------------------------------ */

/** Street + house number, Georgian/Latin street suffixes and city tail folded. */
export function addressKey(address: string | null | undefined): string | null {
  if (!address) return null;
  // Token-wise: \b is ASCII-only and would not see Georgian word boundaries.
  const DROP = new Set(['tbilisi', 'თბილისი', 'тбилиси', 'georgia', 'საქართველო', 'ქუჩა', 'ქ', 'გამზ', 'გამზირი', 'str', 'st', 'street', 'ave', 'avenue', 'ул', 'улица', 'пр']);
  const tokens = address
    .toLowerCase()
    .split(/[\s,.;]+/u)
    .filter((t) => t && !DROP.has(t))
    // Georgian genitive: კრწანისის → კრწანის, so "კრწანისის ქ." and "კრწანისის ქუჩა" agree.
    .map((t) => t.replace(/ის$/u, ''));
  const s = tokens.join(' ').trim();
  return s || null;
}

/** The coarse bucket key: address + rounded area + floor. Price is compared in a window. */
export function dedupeKey(c: { address: string | null; areaSqm: number | null; floor: number | null }): string | null {
  const a = addressKey(c.address);
  if (!a || !c.areaSqm) return null;
  return `${a}|${Math.round(c.areaSqm)}|${c.floor ?? '?'}`;
}

const within = (a: number | null, b: number | null, tol: number) => a != null && b != null && Math.abs(a - b) <= tol * Math.max(a, b);

/**
 * The same flat on two platforms: same address, area within 2 %, same floor
 * (or one unknown) and the price within ±7 % (same currency). Two identical
 * layouts at different prices in one building stay two flats.
 */
export function sameFlat(
  a: { address: string | null; areaSqm: number | null; floor: number | null; price: number | null; currency: string | null },
  b: { address: string | null; areaSqm: number | null; floor: number | null; price: number | null; currency: string | null },
): boolean {
  const ka = addressKey(a.address);
  if (!ka || ka !== addressKey(b.address)) return false;
  if (!within(a.areaSqm, b.areaSqm, 0.02)) return false;
  if (a.floor != null && b.floor != null && a.floor !== b.floor) return false;
  if (a.currency && b.currency && a.currency !== b.currency) return false;
  return within(a.price, b.price, 0.07);
}

/** Korter ASKING rows minus any already found on MyHome.ge / SS.ge. HISTORICAL rows are never deduped against live asks. */
export function dedupeKorterAgainstMarketplace(korter: KorterComparable[], marketplace: VerifyComparable[]): { kept: KorterComparable[]; duplicates: Array<{ korterId: string; matched: string }> } {
  const kept: KorterComparable[] = [];
  const duplicates: Array<{ korterId: string; matched: string }> = [];
  for (const k of korter) {
    const hit = k.priceKind === 'ASKING' ? marketplace.find((m) => sameFlat(k, m)) : undefined;
    if (hit) duplicates.push({ korterId: k.sourceListingId, matched: `${hit.source}:${hit.sourceListingId}` });
    else kept.push(k);
  }
  return { kept, duplicates };
}

/* ------------------------------------------------------------------ *
 * The licensed feed (absent today)                                    *
 * ------------------------------------------------------------------ */

export class KorterFeedNotConfigured extends Error {
  constructor() {
    super('KORTER_FEED_NOT_CONFIGURED');
  }
}

/**
 * Reads the licensed feed. Refuses without KORTER_FEED_URL + KORTER_FEED_KEY;
 * there is no fallback to the public site.
 */
export async function fetchKorterFeed(
  query: { city: string; district?: string | null; areaMinSqm?: number | null; areaMaxSqm?: number | null },
  opts: { env?: Record<string, string | undefined>; fetchImpl?: (url: string, init?: any) => Promise<{ status: number; json: () => Promise<any> }>; now?: () => Date; timeoutMs?: number } = {},
): Promise<KorterNormalized> {
  const env = opts.env ?? process.env;
  if (!korterFeedConfigured(env)) throw new KorterFeedNotConfigured();
  const base = String(env.KORTER_FEED_URL).trim();
  if (!/^https:\/\//i.test(base)) throw new Error('KORTER_FEED_URL_NOT_HTTPS');
  const params: Array<[string, string]> = [['city', query.city]];
  if (query.district) params.push(['district', query.district]);
  if (query.areaMinSqm) params.push(['areaMin', String(query.areaMinSqm)]);
  if (query.areaMaxSqm) params.push(['areaMax', String(query.areaMaxSqm)]);
  const qs = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  const url = `${base}${base.includes('?') ? '&' : '?'}${qs}`;
  const fetchImpl = opts.fetchImpl ?? (globalThis.fetch as any);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 20_000);
  try {
    const r = await fetchImpl(url, { headers: { Authorization: `Bearer ${env.KORTER_FEED_KEY}`, Accept: 'application/json' }, signal: controller.signal });
    if (r.status !== 200) throw new Error(`KORTER_FEED_HTTP_${r.status}`);
    const body = await r.json();
    const items = Array.isArray(body) ? body : Array.isArray(body?.items) ? body.items : [];
    return normalizeKorterFeed(items, { fetchedAt: (opts.now ?? (() => new Date()))().toISOString(), scope: query.district ? 'DISTRICT' : 'CITY' });
  } finally {
    clearTimeout(timer);
  }
}
