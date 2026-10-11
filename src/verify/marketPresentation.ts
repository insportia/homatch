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
 *   - Context-only tiers are secondary, and the citywide WIDER_MARKET band is
 *     never shown at all — not even for a report stored before 2026-10-11
 *     (job 8ba97da9 showed "Wider market · 1,600 USD/m²" beside a Krtsanisi flat).
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
  /*
   * The curated hierarchy fields (2026-10-11 final polish). Present when the
   * stored market carries `hierarchy`; older shapes leave them null/empty.
   */
  /** i18n key for the hierarchy level (same project … broader nearby). */
  levelKey?: string | null;
  /** Level 5: shown for orientation only, never priced. */
  broader?: boolean;
  /** Real project / building name, only when the listing stated one. */
  project?: string | null;
  /** Street-level public listing address. */
  address?: string | null;
  floor?: number | null;
  conditionKey?: string | null;
  statusKey?: string | null;
  listingDate?: string | null;
  totalPrice?: number | null;
  /** Plain differences from the subject, as i18n keys with variables. */
  differences?: Array<{ key: string; vars?: Record<string, string> }>;
}

/** Why there is no valuation number, and what would make one possible. */
export interface MarketInsufficiency {
  have: number;
  need: number;
  /** Listings left out because they are in another or an unknown district (no prices shown). */
  otherDistricts: number;
  /** Local listings left out because they are far from the subject's size. */
  sizeOutOfBand: number;
  sizeBand: { min: number; max: number } | null;
  subjectAreaKnown: boolean;
  /** i18n keys, in order: what is missing, then what would make a valuation possible. */
  missingKeys: string[];
  nextStepKeys: string[];
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
  /** Present only when the deterministic valuation is INSUFFICIENT_EVIDENCE. */
  insufficiency?: MarketInsufficiency | null;
}

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const isTier = (t: unknown): t is MarketTier => typeof t === 'string' && t in TIER_KEY;
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);

/** Max comparables in the interactive comparison. */
export const MAX_COMPARABLES = 6;

/* ------------------------------------------------------------------ *
 * The curated hierarchy set                                            *
 * ------------------------------------------------------------------ */

const LEVEL_TIER: Record<number, MarketTier> = { 1: 'SAME_PROJECT', 2: 'SAME_STREET', 3: 'SAME_STREET', 4: 'PEER_PROJECT', 5: 'SAME_DISTRICT' };
export const LEVEL_I18N: Record<number, string> = {
  1: 'vfm_level_same_project',
  2: 'vfm_level_same_address',
  3: 'vfm_level_same_street',
  4: 'vfm_level_premium_peer',
  5: 'vfm_level_broader',
};
const CONDITION_I18N: Record<string, string> = {
  BLACK_FRAME: 'vfm_cond_black_frame',
  GREEN_FRAME: 'vfm_cond_green_frame',
  WHITE_FRAME: 'vfm_cond_white_frame',
  RENOVATED: 'vfm_cond_renovated',
  NEWLY_RENOVATED: 'vfm_cond_newly_renovated',
};
const LADDER = ['BLACK_FRAME', 'GREEN_FRAME', 'WHITE_FRAME', 'RENOVATED', 'NEWLY_RENOVATED'];
const STATUS_I18N: Record<string, string> = { ACTIVE: 'vfm_status_active', EXPIRED: 'vfm_status_expired', UNKNOWN: 'vfm_status_unknown' };

const isoDay = (v: unknown): string | null => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
/** A public street address only: no URL, no long free text. */
const cleanAddress = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s && s.length <= 140 && !/https?:|www\./i.test(s) ? s : null;
};
const cleanName = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s && s.length <= 80 && !/https?:|www\.|@/i.test(s) ? s : null;
};

/** Plain differences from the subject: size, condition, listing status. */
export function differencesFromSubject(
  c: { area?: unknown; condition?: unknown; state?: unknown; freshness?: unknown; priceKind?: unknown },
  subject: { area?: unknown; condition?: unknown },
): Array<{ key: string; vars?: Record<string, string> }> {
  const out: Array<{ key: string; vars?: Record<string, string> }> = [];
  const a = n(c.area);
  const sa = n(subject.area);
  if (a && sa) {
    const pct = Math.round(((a - sa) / sa) * 100);
    if (Math.abs(pct) >= 5) out.push({ key: pct > 0 ? 'vfm_diff_larger' : 'vfm_diff_smaller', vars: { pct: String(Math.abs(pct)) } });
    else out.push({ key: 'vfm_diff_size_similar' });
  }
  const cg = typeof c.condition === 'string' ? LADDER.indexOf(c.condition) : -1;
  const sg = typeof subject.condition === 'string' ? LADDER.indexOf(subject.condition) : -1;
  if (cg >= 0 && sg >= 0 && cg !== sg) out.push({ key: cg > sg ? 'vfm_diff_better_condition' : 'vfm_diff_worse_condition' });
  else if (cg < 0) out.push({ key: 'vfm_diff_condition_unknown' });
  if (c.state === 'EXPIRED') out.push({ key: 'vfm_diff_not_active' });
  else if (c.state !== 'ACTIVE') out.push({ key: 'vfm_diff_status_unconfirmed' });
  if (c.freshness === 'UNDATED') out.push({ key: 'vfm_diff_undated' });
  if (c.priceKind !== 'TRANSACTION') out.push({ key: 'vfm_diff_asking' });
  return out;
}

function hierarchyComparables(m: Record<string, any>, currency: string): MarketComparableView[] | null {
  const h = obj(m.hierarchy);
  if (!Array.isArray(h.comparables)) return null;
  const subject = { area: m.subjectArea, condition: m.subjectCondition };
  return arr(h.comparables)
    .map(obj)
    .filter((c) => [1, 2, 3, 4, 5].includes(c.level) && n(c.pricePerSqm) && c.dealType !== 'RENT')
    .sort((a, b) => a.level - b.level)
    .slice(0, MAX_COMPARABLES)
    .map((c): MarketComparableView => {
      const area = n(c.area);
      const total = n(c.totalPrice);
      return {
        tier: LEVEL_TIER[c.level],
        pricePerSqm: Math.round(c.pricePerSqm),
        currency: typeof c.currency === 'string' && c.currency ? c.currency : currency,
        area,
        rooms: n(c.rooms),
        districtKey: areaKey(c.district),
        fits: [],
        differs: [],
        expired: c.state === 'EXPIRED',
        levelKey: LEVEL_I18N[c.level],
        broader: c.level === 5,
        project: cleanName(c.project),
        address: cleanAddress(c.address),
        floor: typeof c.floor === 'number' && Number.isFinite(c.floor) ? c.floor : null,
        conditionKey: typeof c.condition === 'string' ? CONDITION_I18N[c.condition] ?? null : null,
        statusKey: typeof c.state === 'string' ? STATUS_I18N[c.state] ?? null : null,
        listingDate: isoDay(c.listingDate),
        totalPrice: total ?? (area ? Math.round(c.pricePerSqm * area) : null),
        differences: differencesFromSubject(c, subject),
      };
    });
}

/**
 * INSUFFICIENT_EVIDENCE, explained: how many defensible comparables there
 * are against how many are needed, what was set aside and why, and what
 * evidence would make a valuation possible. Never a number for the home.
 */
export function insufficiencyOf(m: Record<string, any>): MarketInsufficiency | null {
  const v = obj(m.valuation);
  if (v.state !== 'INSUFFICIENT_EVIDENCE') return null;
  const h = obj(m.hierarchy);
  const ex = obj(h.excluded);
  const sb = obj(v.sizeBand ?? h.sizeBand);
  const sizeBand = n(sb.min) && n(sb.max) ? { min: sb.min as number, max: sb.max as number } : null;
  const have = Number(v.defensibleComparables) || 0;
  const need = Number(v.minimumComparables) || 3;
  const otherDistricts = (Number(ex.UNRELATED_DISTRICT) || 0) + (Number(ex.DISTRICT_UNKNOWN) || 0);
  const sizeOutOfBand = Number(ex.SIZE_OUT_OF_BAND) || 0;
  const subjectAreaKnown = !!n(m.subjectArea) || !!sizeBand;
  const missingKeys = ['vfm_missing_local'];
  if (!subjectAreaKnown) missingKeys.push('vfm_missing_area');
  if (sizeOutOfBand > 0) missingKeys.push('vfm_missing_size');
  if (otherDistricts > 0) missingKeys.push('vfm_missing_other_districts');
  missingKeys.push('vfm_missing_transactions');
  const nextStepKeys = ['vfm_next_same_project', 'vfm_next_same_street', 'vfm_next_registered_sales', 'vfm_next_developer_prices'];
  if (!subjectAreaKnown) nextStepKeys.push('vfm_next_subject_area');
  return { have, need, otherDistricts, sizeOutOfBand, sizeBand, subjectAreaKnown, missingKeys, nextStepKeys };
}

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
  // The curated location hierarchy, when the stored market carries it; the
  // older ranked pool only for reports built before it existed.
  const comparables = hierarchyComparables(m, currency) ?? pool
    .map(obj)
    .filter((c) => c.headlineEligible === true && c.outlier !== true && isTier(c.tier) && c.tier !== 'WIDER_MARKET'
      && !(Array.isArray(c.exclusions) && c.exclusions.length) && n(c.pricePerSqm))
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
    .filter((t) => t.contextOnly === true && isTier(t.tier) && t.tier !== 'WIDER_MARKET' && n(t.median) && Number(t.count) > 0)
    .map((t) => ({ tier: t.tier as MarketTier, median: t.median as number, count: Number(t.count) }));

  return { currency, headline, asking, askingRange, comparables, context, insufficiency: insufficiencyOf(m) };
}
