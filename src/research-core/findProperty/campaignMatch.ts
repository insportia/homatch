/*
 * FIND PROPERTY — Deep Search: every stored offer judged against the customer's EXACT request.
 *
 * A paid campaign reads communities' recent posts; most of them are real offers in the
 * right city that are still not what this customer asked for (production, 2026-10-18:
 * 600 Tbilisi sale offers stored, 1 compatible with "Vake, 3 rooms, 2 bedrooms,
 * 80-110 m², new build, $120-160k"). This module is the strict step between "an offer"
 * and "a match":
 *
 *   EXACT       every mandatory requirement is stated in the post and satisfied
 *   POTENTIAL   nothing contradicts the request, some requirements are not stated
 *               (each one is listed as UNVERIFIED; nothing is ever inferred)
 *   ALTERNATIVE exactly one numeric requirement (price or area) misses by at most 15%,
 *               nothing else fails; shown only when the customer asks for alternatives
 *   REJECTED    a mandatory requirement fails, the post is older than 30 days, or it
 *               states too little to be checked at all
 *
 * Reposts of one flat (same text fingerprint or URL) count once. Deterministic: no model,
 * no network; the same rows and request always give the same verdicts.
 */
import { comparePlaces, resolvePlace } from '../normalize/place.ts';
import { descriptionSignals } from '../marketplace/description-signals.ts';

export const CAMPAIGN_MATCH_VERSION = 'fp-campaign-match-2';

export type MatchCategory = 'EXACT' | 'POTENTIAL' | 'ALTERNATIVE' | 'REJECTED';
export type CheckState = 'MATCH' | 'UNVERIFIED' | 'FAIL';
export type CheckKey = 'transaction' | 'city' | 'district' | 'propertyType' | 'price' | 'area' | 'rooms' | 'bedrooms' | 'buildingStatus' | 'fresh';
export type RejectReason = 'TRANSACTION' | 'CITY' | 'DISTRICT' | 'PROPERTY_TYPE' | 'PRICE' | 'AREA' | 'ROOMS' | 'BEDROOMS' | 'BUILDING_STATUS'
  | 'OLDER_THAN_30_DAYS' | 'INSUFFICIENT_DETAIL';

export interface Range { min: number | null; max: number | null }
export type BuildingStatus = 'NEW_BUILD' | 'UNDER_CONSTRUCTION' | 'OLD_BUILD';

/** The customer's mandatory requirements, as confirmed in the search brief. */
export interface CampaignCriteria {
  transaction: 'SALE' | 'RENT';
  city: string | null;
  districts: string[];
  propertyType: 'APARTMENT' | 'HOUSE' | 'LAND' | 'COMMERCIAL' | null;
  priceUsd: Range | null;
  areaSqm: Range | null;
  rooms: Range | null;
  bedrooms: Range | null;
  buildingStatuses: BuildingStatus[];
}

/** One stored offer (a supply_observations row, as read by the server). */
export interface CampaignOffer {
  id: string;
  canonical_url: string | null;
  transaction: string | null;
  property_type: string | null;
  city: string | null;
  district: string | null;
  sale_amount: number | null; sale_currency: string | null;
  rent_amount: number | null; rent_currency: string | null;
  area_sqm: number | null;
  rooms: number | null;
  bedrooms: number | null;
  floor?: number | null; total_floors?: number | null;
  title?: string | null;
  description: string | null;
  published_at: string | null;
  content_fingerprint?: string | null;
  image_urls?: string[] | null;
  field_origins?: Record<string, unknown> | null;
}

export interface Check { key: CheckKey; state: CheckState; expected: string | null; actual: string | null }

export interface OfferVerdict {
  offerId: string;
  category: MatchCategory;
  checks: Check[];
  rejectReasons: RejectReason[];
  /** Ranking only: more confirmed requirements first, then fewer unknowns, then newer. */
  score: number;
  priceUsd: number | null;
  /** Other stored posts of the same flat (reposts), not counted again. */
  duplicateIds: string[];
}

export interface CampaignFunnel {
  version: string;
  /** Posts the providers returned (billed or fetched), before anything was read. */
  fetched: number;
  /** Posts recognised as an offer of the searched kind in the searched city (stored). */
  candidates: number;
  /** Distinct flats among the candidates (reposts counted once). */
  unique: number;
  duplicates: number;
  exact: number;
  potential: number;
  alternative: number;
  rejected: number;
  rejectedBy: Partial<Record<RejectReason, number>>;
  /** What the customer can open: exact + potential (alternatives on request). */
  available: number;
}

/* An asking price in USD, through a converter the CALLER supplies from current, dated rates
   (fx_rates / the NBG, src/research-core/match/structured-gates.ts). No rate table lives here:
   without a trustworthy rate a non-USD price is unknown — the price check reads UNVERIFIED and
   never rejects a property on a guessed rate. */
export type ToUsd = (amount: number, currency: string) => number | null;
export const usdOnly: ToUsd = (amount, currency) => (currency === 'USD' ? amount : null);
const STALE_MS = 30 * 86_400_000;
const NEAR = 0.15;

export function offerPriceUsd(o: Pick<CampaignOffer, 'sale_amount' | 'sale_currency' | 'rent_amount' | 'rent_currency'>, transaction: 'SALE' | 'RENT', toUsd: ToUsd = usdOnly): number | null {
  const amount = Number(transaction === 'RENT' ? o.rent_amount : o.sale_amount);
  const currency = String((transaction === 'RENT' ? o.rent_currency : o.sale_currency) ?? '').toUpperCase();
  if (!Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency)) return null;
  const usd = toUsd(amount, currency);
  return usd != null && Number.isFinite(usd) && usd > 0 ? Math.round(usd) : null;
}

const OLD_BUILD = /ძველ(?:ად)?\s*აშენებულ|ძველ(?:ი)?\s*(?:კორპუს|ფონდ)|старый\s+фонд|вторичк|сталинк|хрущ[её]вк|\bold[- ]build|\bsoviet[- ]era\b/iu;

/** What the post says about its building, never guessed: null when it says nothing. */
export function statedBuildingStatus(text: string | null | undefined): BuildingStatus | null {
  const t = String(text ?? '');
  const signals = descriptionSignals(t).filter((s) => s.polarity === 'MENTIONED');
  if (signals.some((s) => s.code === 'UNDER_CONSTRUCTION')) return 'UNDER_CONSTRUCTION';
  if (signals.some((s) => s.code === 'NEW_BUILD')) return 'NEW_BUILD';
  if (OLD_BUILD.test(t)) return 'OLD_BUILD';
  return null;
}

const fmtRange = (r: Range | null, unit = '') => (!r || (r.min == null && r.max == null) ? null
  : r.min != null && r.max != null ? (r.min === r.max ? `${r.min}${unit}` : `${r.min}–${r.max}${unit}`)
    : r.min != null ? `≥${r.min}${unit}` : `≤${r.max}${unit}`);

const inRange = (v: number, r: Range) => (r.min == null || v >= r.min) && (r.max == null || v <= r.max);
/** Relative miss outside the range (0 when inside). */
const miss = (v: number, r: Range) => (r.min != null && v < r.min ? (r.min - v) / r.min : r.max != null && v > r.max ? (v - r.max) / r.max : 0);
const hasRange = (r: Range | null): r is Range => !!r && (r.min != null || r.max != null);

function numericCheck(key: CheckKey, value: number | null | undefined, range: Range | null, unit = ''): Check | null {
  if (!hasRange(range)) return null;
  const expected = fmtRange(range, unit);
  if (value == null || !Number.isFinite(Number(value))) return { key, state: 'UNVERIFIED', expected, actual: null };
  return { key, state: inRange(Number(value), range) ? 'MATCH' : 'FAIL', expected, actual: `${value}${unit}` };
}

const placeKey = (name: string | null | undefined) => resolvePlace(name ?? null)?.key ?? (name ? String(name).trim().toLowerCase() : null);

/* Georgian case endings, and the vowel a stem drops before them ("ისნის" = of Isani,
   "დიღმის" = of Digomi): the place table holds the nominative. */
const KA_CASE = /(ში|ის|ზე|დან|თან|ით|ად|მდე|ისკენ)$/u;
function kaForms(word: string): string[] {
  const out = [word];
  if (!KA_CASE.test(word)) return out;
  const stem = word.replace(KA_CASE, '');
  out.push(stem, ...['ი', 'ე', 'ა', 'ო'].map((v) => `${stem}${v}`));
  const m = stem.match(/^(.*\p{L})(\p{L})$/u);
  if (m) for (const v of ['ა', 'ო', 'ე']) out.push(`${m[1]}${v}${m[2]}ი`);
  return out;
}

/* Well-known Tbilisi neighbourhoods the shared place table does not list, mapped to the
   district that contains them (only to a district the table already knows). */
const NEIGHBOURHOOD: Record<string, string> = {
  ვარკეთილი: 'samgori', варкетили: 'samgori', varketili: 'samgori',
  ნავთლუღი: 'isani', навтлуги: 'isani', navtlughi: 'isani',
  ნუცუბიძე: 'saburtalo', нуцубидзе: 'saburtalo', nutsubidze: 'saburtalo',
  ვაშლიჯვარი: 'saburtalo', вашлиджвари: 'saburtalo', vashlijvari: 'saburtalo',
  ბაგები: 'vake', багеби: 'vake', bagebi: 'vake',
  ვაზისუბანი: 'samgori', вазисубани: 'samgori', vazisubani: 'samgori',
  ლილო: 'samgori', лило: 'samgori',
  ვარაზისხევი: 'vake',
};
const districtOf = (name: string) => {
  const place = resolvePlace(name);
  if (place?.kind === 'DISTRICT') return place.key;
  return NEIGHBOURHOOD[name.toLowerCase()] ?? null;
};

/** Every Tbilisi district the post names (nominative or declined), in order of appearance. */
export function districtsNamed(text: string | null | undefined): string[] {
  const words = String(text ?? '').split(/[^\p{L}-]+/u).filter((w) => w.length >= 3);
  const found: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const tries = [...kaForms(words[i]), ...(i + 1 < words.length ? [`${words[i]} ${words[i + 1]}`] : [])];
    for (const t of tries) {
      const key = districtOf(t);
      if (key) { if (!found.includes(key)) found.push(key); break; }
    }
  }
  return found;
}

/** One offer against the request. Pure. */
export function judgeOffer(o: CampaignOffer, c: CampaignCriteria, now = Date.now(), toUsd: ToUsd = usdOnly): Omit<OfferVerdict, 'duplicateIds'> {
  const checks: Check[] = [];
  const tx = String(o.transaction ?? '').toUpperCase();
  checks.push({ key: 'transaction', state: !tx ? 'UNVERIFIED' : tx === c.transaction ? 'MATCH' : 'FAIL', expected: c.transaction, actual: tx || null });

  /* Place. A district inside the city confirms the city too; a city only known from the
     community it was posted in (SOURCE_CONTEXT) is not the post saying so. */
  const districtKeys = c.districts.map(placeKey).filter((k): k is string => !!k);
  /* The parsed district, else every district the text names: the wanted one named = match,
     only other districts named = fail, none named = unverified. */
  const named = o.district ? [placeKey(o.district)!] : districtsNamed(`${o.title ?? ''}\n${o.description ?? ''}`);
  const wanted = (d: string) => districtKeys.some((k) => k === d || comparePlaces(k, d) === 'AGREE');
  const districtMatch = named.some(wanted);
  const offerDistrict = districtMatch ? named.find(wanted)! : named[0] ?? null;
  if (c.city) {
    const cmp = comparePlaces(o.city, c.city);
    const fromContext = (o.field_origins as Record<string, unknown> | null | undefined)?.city === 'SOURCE_CONTEXT';
    const state: CheckState = cmp === 'CONFLICT' ? 'FAIL' : districtMatch || (cmp === 'AGREE' && !fromContext) ? 'MATCH' : 'UNVERIFIED';
    checks.push({ key: 'city', state, expected: c.city, actual: o.city ?? null });
  }
  if (districtKeys.length) {
    checks.push({ key: 'district', state: !offerDistrict ? 'UNVERIFIED' : districtMatch ? 'MATCH' : 'FAIL', expected: c.districts.join(', '), actual: o.district ?? null });
  }
  if (c.propertyType) {
    const t = String(o.property_type ?? '').toUpperCase();
    checks.push({ key: 'propertyType', state: !t ? 'UNVERIFIED' : t === c.propertyType ? 'MATCH' : 'FAIL', expected: c.propertyType, actual: t || null });
  }
  const priceUsd = offerPriceUsd(o, c.transaction, toUsd);
  for (const ck of [
    numericCheck('price', priceUsd, c.priceUsd, ''),
    numericCheck('area', o.area_sqm, c.areaSqm, ' m²'),
    numericCheck('rooms', o.rooms, c.rooms),
    numericCheck('bedrooms', o.bedrooms, c.bedrooms),
  ]) if (ck) checks.push(ck);
  if (c.buildingStatuses.length) {
    const stated = statedBuildingStatus(`${o.title ?? ''}\n${o.description ?? ''}`);
    checks.push({ key: 'buildingStatus', state: !stated ? 'UNVERIFIED' : c.buildingStatuses.includes(stated) ? 'MATCH' : 'FAIL',
      expected: c.buildingStatuses.join(' / '), actual: stated });
  }
  const published = o.published_at ? Date.parse(o.published_at) : NaN;
  checks.push({ key: 'fresh', state: !Number.isFinite(published) ? 'UNVERIFIED' : now - published > STALE_MS ? 'FAIL' : 'MATCH',
    expected: '≤30d', actual: Number.isFinite(published) ? new Date(published).toISOString().slice(0, 10) : null });

  const fails = checks.filter((k) => k.state === 'FAIL');
  const rejectReasons: RejectReason[] = fails.map((k) => REASON[k.key]);
  const matches = checks.filter((k) => k.state === 'MATCH').length;
  const unknown = checks.filter((k) => k.state === 'UNVERIFIED').length;
  /* "Nothing contradicts" is not enough to show a post: at least two of the flat's own
     facts (type, price, area, rooms, bedrooms) must be stated and right. */
  const factsConfirmed = checks.filter((k) => FACTS.has(k.key) && k.state === 'MATCH').length;

  let category: MatchCategory;
  if (!fails.length) {
    if (!unknown) category = 'EXACT';
    else if (factsConfirmed >= 2) category = 'POTENTIAL';
    else { category = 'REJECTED'; rejectReasons.push('INSUFFICIENT_DETAIL'); }
  } else if (fails.length === 1 && (fails[0].key === 'price' || fails[0].key === 'area') && factsConfirmed >= 1) {
    const r = fails[0].key === 'price' ? c.priceUsd! : c.areaSqm!;
    const v = fails[0].key === 'price' ? priceUsd! : Number(o.area_sqm);
    category = miss(v, r) <= NEAR ? 'ALTERNATIVE' : 'REJECTED';
  } else category = 'REJECTED';

  const age = Number.isFinite(published) ? Math.max(0, now - published) / 86_400_000 : 30;
  const score = Math.round((matches * 10 - unknown * 3 - Math.min(age, 30) / 10) * 100) / 100;
  return { offerId: o.id, category, checks, rejectReasons: [...new Set(rejectReasons)], score, priceUsd };
}

const FACTS = new Set<CheckKey>(['propertyType', 'price', 'area', 'rooms', 'bedrooms']);
const REASON: Record<CheckKey, RejectReason> = {
  transaction: 'TRANSACTION', city: 'CITY', district: 'DISTRICT', propertyType: 'PROPERTY_TYPE', price: 'PRICE', area: 'AREA',
  rooms: 'ROOMS', bedrooms: 'BEDROOMS', buildingStatus: 'BUILDING_STATUS', fresh: 'OLDER_THAN_30_DAYS',
};

const RANK: Record<MatchCategory, number> = { EXACT: 0, POTENTIAL: 1, ALTERNATIVE: 2, REJECTED: 3 };
/* Reposts of one flat with different wording: the same contact number and the same area. */
const PHONE = /(?<!\d)(?:\+?995[\s-]?)?(5\d{2})[\s-]?(\d{2})[\s-]?(\d{2})[\s-]?(\d{2})(?!\d)/u;
export function repostKey(o: CampaignOffer): string | null {
  const m = String(o.description ?? '').match(PHONE);
  if (!m || o.area_sqm == null) return null;
  return `tel:${m.slice(1, 5).join('')}:${Math.round(Number(o.area_sqm))}`;
}
const known = (o: CampaignOffer) => [o.property_type, o.sale_amount ?? o.rent_amount, o.area_sqm, o.rooms, o.bedrooms, o.district].filter((v) => v != null).length;

/**
 * Every stored offer of one campaign, judged and deduplicated: one verdict per flat,
 * the best-described post standing for its reposts. Sorted best first.
 */
export function judgeCampaign(offers: CampaignOffer[], c: CampaignCriteria, fetched: number, now = Date.now(), toUsd: ToUsd = usdOnly): { verdicts: OfferVerdict[]; funnel: CampaignFunnel } {
  const groups = new Map<string, CampaignOffer[]>();
  for (const o of offers) {
    const key = repostKey(o) ?? (o.content_fingerprint || o.canonical_url || o.id);
    const g = groups.get(key);
    if (g) g.push(o); else groups.set(key, [o]);
  }
  const verdicts: OfferVerdict[] = [];
  for (const g of groups.values()) {
    const lead = [...g].sort((a, b) => known(b) - known(a) || String(b.published_at ?? '').localeCompare(String(a.published_at ?? '')))[0];
    verdicts.push({ ...judgeOffer(lead, c, now, toUsd), duplicateIds: g.filter((o) => o !== lead).map((o) => o.id) });
  }
  verdicts.sort((a, b) => RANK[a.category] - RANK[b.category] || b.score - a.score);
  const count = (cat: MatchCategory) => verdicts.filter((v) => v.category === cat).length;
  const rejectedBy: Partial<Record<RejectReason, number>> = {};
  for (const v of verdicts) if (v.category === 'REJECTED') for (const r of v.rejectReasons) rejectedBy[r] = (rejectedBy[r] ?? 0) + 1;
  const exact = count('EXACT'), potential = count('POTENTIAL');
  return {
    verdicts,
    funnel: {
      version: CAMPAIGN_MATCH_VERSION, fetched: Math.max(0, Math.round(fetched)), candidates: offers.length, unique: groups.size,
      duplicates: offers.length - groups.size, exact, potential, alternative: count('ALTERNATIVE'), rejected: count('REJECTED'),
      rejectedBy, available: exact + potential,
    },
  };
}

const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const range = (v: unknown): Range | null => {
  if (!v || typeof v !== 'object') return null;
  const r = { min: num((v as Range).min), max: num((v as Range).max) };
  return r.min == null && r.max == null ? null : r;
};
const TYPE: Record<string, CampaignCriteria['propertyType']> = {
  APARTMENT: 'APARTMENT', STUDIO: 'APARTMENT', HOUSE: 'HOUSE', VILLA: 'HOUSE', COUNTRY_HOUSE: 'HOUSE', LAND: 'LAND',
  COMMERCIAL: 'COMMERCIAL', OFFICE: 'COMMERCIAL', RETAIL: 'COMMERCIAL', HOTEL: 'COMMERCIAL',
};

/**
 * The request a campaign answers, from its marketplace search (`request` is the confirmed,
 * normalised brief the free search ran with). Unknown fields stay unset — never defaulted.
 */
export function criteriaFromSearchRequest(request: Record<string, any> | null | undefined, fallback?: { transaction: 'SALE' | 'RENT'; city: string | null; districts?: string[]; propertyType?: string | null }): CampaignCriteria {
  const r = request ?? {};
  const tx = String(r.transactionType ?? '').toUpperCase();
  const transaction: 'SALE' | 'RENT' = tx === 'BUY' ? 'SALE' : tx.includes('RENT') ? 'RENT' : fallback?.transaction ?? 'SALE';
  const districts = (Array.isArray(r.districts) ? r.districts : fallback?.districts ?? []).map((d: unknown) => String(d)).filter(Boolean);
  const statuses = (Array.isArray(r.buildingStatuses) ? r.buildingStatuses : []).map((s: unknown) => String(s).toUpperCase())
    .filter((s: string): s is BuildingStatus => s === 'NEW_BUILD' || s === 'UNDER_CONSTRUCTION' || s === 'OLD_BUILD');
  const price = range({ min: r.priceMinUsd, max: r.priceMaxUsd });
  const area = range({ min: r.areaMinSqm, max: r.areaMaxSqm });
  return {
    transaction,
    city: (typeof r.city === 'string' && r.city) ? r.city : fallback?.city ?? null,
    districts,
    propertyType: TYPE[String(r.propertyType ?? fallback?.propertyType ?? '').toUpperCase()] ?? null,
    priceUsd: price, areaSqm: area, rooms: range(r.rooms), bedrooms: range(r.bedrooms),
    buildingStatuses: statuses.length === 3 ? [] : statuses,
  };
}
