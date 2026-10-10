/*
 * HOMATCH Verify — what the "Market position" chapter may show.
 *
 * React-free and tested. The rules:
 *
 *   - The headline range appears ONLY when headline.state === 'RANGE'.
 *     Otherwise the chapter says, honestly, that the evidence is limited —
 *     and never substitutes a district or city spread for a missing range.
 *   - The project's own asking evidence is always labelled ASKING: an asking
 *     price is not a sale price.
 *   - Comparables are the closest headline-eligible ones, described with
 *     plain-word reasons and a district name — never a raw id or URL.
 *   - Context-only tiers (same district / wider market) are secondary.
 *   - A payload in an older market shape (no `headline`) yields no numbers.
 */

export type MarketTier = 'SAME_PROJECT' | 'SAME_STREET' | 'SAME_DISTRICT' | 'PEER_PROJECT' | 'WIDER_MARKET';

export const TIER_KEY: Record<MarketTier, string> = {
  SAME_PROJECT: 'cmp_reason_same_project',
  SAME_STREET: 'cmp_reason_same_street',
  SAME_DISTRICT: 'cmp_reason_same_district',
  PEER_PROJECT: 'cmp_reason_peer_project',
  WIDER_MARKET: 'cmp_reason_wider_market',
};

/** Reasons a comparable fits, in plain words. Internal codes are not listed and never shown. */
export const REASON_KEY: Record<string, { key: string; fits: boolean }> = {
  SAME_PROJECT: { key: 'vrx_mr_same_project', fits: true },
  SAME_STREET: { key: 'vrx_mr_same_street', fits: true },
  WITHIN_600M: { key: 'vrx_mr_within_600m', fits: true },
  SAME_DISTRICT: { key: 'vrx_mr_same_district', fits: true },
  ADJACENT_DISTRICT: { key: 'vrx_mr_adjacent_district', fits: true },
  NAMED_DEVELOPMENT: { key: 'vrx_mr_named_development', fits: true },
  PRICE_BAND_MATCH: { key: 'vrx_mr_price_band_match', fits: true },
  CONDITION_MATCH: { key: 'vrx_mr_condition_match', fits: true },
  SIZE_NEAR_IDENTICAL: { key: 'vrx_mr_size_near_identical', fits: true },
  SIZE_SIMILAR: { key: 'vrx_mr_size_similar', fits: true },
  SAME_ROOMS: { key: 'vrx_mr_same_rooms', fits: true },
  SIMILAR_FLOOR: { key: 'vrx_mr_similar_floor', fits: true },
  ACTIVE: { key: 'vrx_mr_active', fits: true },
  PRICE_BAND_MISMATCH: { key: 'vrx_mr_price_band_mismatch', fits: false },
  CONDITION_MISMATCH: { key: 'vrx_mr_condition_mismatch', fits: false },
  SIZE_VERY_DIFFERENT: { key: 'vrx_mr_size_very_different', fits: false },
};

export const AREA_KEYS = [
  'OLD_TBILISI', 'KRTSANISI', 'ORTACHALA', 'SOLOLAKI', 'MTATSMINDA', 'VERA', 'VAKE', 'AVLABARI', 'CHUGHURETI', 'ISANI',
  'SABURTALO', 'DIDUBE', 'DIDI_DIGHOMI', 'DIGHOMI', 'VASHLIJVARI', 'NADZALADEVI', 'GLDANI', 'SAMGORI', 'NAVTLUGHI',
  'LISI', 'BAGEBI', 'VARKETILI',
] as const;
export const areaKey = (a: unknown): string | null =>
  typeof a === 'string' && (AREA_KEYS as readonly string[]).includes(a) ? `vrx_area_${a.toLowerCase()}` : null;

export const ORIGIN_KEY: Record<string, string> = {
  SAME_PROJECT_LISTING: 'vrx_mkt_origin_same_project_listing',
  ARCHIVED_OFFER: 'vrx_mkt_origin_archived_offer',
  DEVELOPER_MARKETING: 'vrx_mkt_origin_developer_marketing',
};

export interface MarketComparableView {
  tier: MarketTier;
  pricePerSqm: number;
  currency: string;
  area: number | null;
  rooms: number | null;
  districtKey: string | null;
  fits: string[];
  differs: string[];
  expired: boolean;
}

export interface MarketView {
  currency: string;
  headline:
    | { state: 'RANGE'; min: number; max: number; median: number; count: number; tiers: MarketTier[]; outliersTrimmed: number }
    | { state: 'EVIDENCE_LIMITED'; count: number; minimumSample: number }
    | null;
  asking: Array<{ originKey: string; pricePerSqm: number; currency: string; date: string | null; expired: boolean }>;
  askingRange: { min: number; max: number; median: number; count: number; currency: string } | null;
  comparables: MarketComparableView[];
  context: Array<{ tier: MarketTier; median: number; count: number }>;
}

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const isTier = (t: unknown): t is MarketTier => typeof t === 'string' && t in TIER_KEY;
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** Max comparables in the interactive comparison. */
export const MAX_COMPARABLES = 6;

export function marketView(raw: unknown): MarketView | null {
  const m = obj(raw);
  const h = obj(m.headline);
  if (!h.state) return null; // an older market shape: prose only
  const currency = typeof m.currency === 'string' && m.currency ? m.currency : 'USD';

  let headline: MarketView['headline'] = null;
  if (h.state === 'RANGE' && n(h.min) && n(h.max) && n(h.median)) {
    headline = {
      state: 'RANGE', min: h.min, max: h.max, median: h.median, count: Number(h.count) || 0,
      tiers: arr(h.tiersUsed).filter(isTier), outliersTrimmed: Number(h.outliersTrimmed) || 0,
    };
  } else {
    headline = { state: 'EVIDENCE_LIMITED', count: Number(h.count) || 0, minimumSample: Number(h.minimumSample) || 3 };
  }

  const asking = arr(m.projectAskingEvidence)
    .map(obj)
    .filter((a) => a.kind === 'ASKING' && n(a.pricePerSqm) && ORIGIN_KEY[a.origin])
    .slice(0, 6)
    .map((a) => ({
      originKey: ORIGIN_KEY[a.origin],
      pricePerSqm: a.pricePerSqm as number,
      currency: typeof a.currency === 'string' && a.currency ? a.currency : currency,
      date: typeof a.date === 'string' && /^\d{4}-\d{2}/.test(a.date) ? a.date.slice(0, 10) : null,
      expired: a.state === 'EXPIRED',
    }));
  const ar = obj(m.projectAskingRange);
  const askingRange = n(ar.min) && n(ar.max) && n(ar.median) && Number(ar.count) > 1
    ? { min: ar.min, max: ar.max, median: ar.median, count: Number(ar.count), currency: typeof ar.currency === 'string' && ar.currency ? ar.currency : currency }
    : null;

  const pool = arr(m.ranked).length ? arr(m.ranked) : arr(m.closest);
  const comparables = pool
    .map(obj)
    .filter((c) => c.headlineEligible === true && c.outlier !== true && isTier(c.tier) && n(c.pricePerSqm))
    .slice(0, MAX_COMPARABLES)
    .map((c) => {
      const reasons = arr(c.relevanceReasons).filter((r) => typeof r === 'string' && REASON_KEY[r]);
      return {
        tier: c.tier as MarketTier,
        pricePerSqm: c.pricePerSqm as number,
        currency: typeof c.currency === 'string' && c.currency ? c.currency : currency,
        area: n(c.area),
        rooms: n(c.rooms),
        districtKey: areaKey(c.district),
        fits: reasons.filter((r) => REASON_KEY[r].fits).map((r) => REASON_KEY[r].key),
        differs: reasons.filter((r) => !REASON_KEY[r].fits).map((r) => REASON_KEY[r].key),
        expired: c.state === 'EXPIRED',
      };
    });

  const context = arr(m.tiers)
    .map(obj)
    .filter((t) => t.contextOnly === true && isTier(t.tier) && n(t.median) && Number(t.count) > 0)
    .map((t) => ({ tier: t.tier as MarketTier, median: t.median as number, count: Number(t.count) }));

  return { currency, headline, asking, askingRange, comparables, context };
}
