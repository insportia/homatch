// HOMATCH Verify — the customer LOCATION HIERARCHY and the deterministic
// valuation (2026-10-11).
//
// WHY THIS EXISTS (production job 8ba97da9, flat N601, Krtsanisi St. 6)
//
// The market section listed Didi Dighomi, Gldani, Varketili and Saburtalo
// listings beside a premium Krtsanisi flat, and its prose said no reliable
// valuation was possible while a metric beside it read "≈ $900–3,000/m²".
// Three faults, one root: nothing between "what the research gathered" and
// "what a buyer reads" applied a location hierarchy.
//
//   1. Two listings ON KRTSANISI STREET were scored WIDER_MARKET: the street
//      test compared whole addresses (city/district tail included), so
//      "თბილისი, კრწანისის ქ. 6" ≠ "კრწანისის ქ., ორთაჭალა, თბილისი".
//      Fixed in marketGeography.streetRelation().
//   2. The citywide pool reached the customer three ways: the WIDER_MARKET
//      band median (UI context chip), comparableSelection.context, and every
//      gathered listing as a citable MARKET evidence item.
//   3. The model was handed the whole ranked pool, so it could print a city
//      spread while saying no valuation was possible.
//
// THE HIERARCHY (customer-facing comparables and any valuation)
//
//   1 same project / building
//   2 same address (same street + house number)
//   3 same street micro-location (incl. a lane named after it, ≤600 m measured)
//   4 comparable premium development in the same/adjacent neighbourhood
//   5 broader nearby — same or adjacent neighbourhood stock, shown ONLY when
//     levels 1–4 are too thin, with an explicit reason, and NEVER priced
//   —  any other district, or an unknown one: excluded entirely.
//
// Every shown listing must also be inside the size band, the same deal type,
// the same building class, not three condition rungs apart, not expired and
// not stale. A valuation needs MIN_DEFENSIBLE_COMPARABLES from levels 1–4;
// otherwise the state is INSUFFICIENT_EVIDENCE and there is NO number.
//
// Pure: no clock, no network.

import type {
  MarketIntelligence,
  RawComparable,
  ScoredComparable,
  Subject,
} from './marketIntelligence.ts';
import type { AreaKey } from './marketGeography.ts';
import { buildLocationIntelligence } from './locationIntelligence.ts';
import { buildPropertyRegister } from './propertyRegister.ts';

/** ±35% of the subject's area. 94.10 m² → 61.2–127.0 m². */
export const SIZE_BAND = 0.35;

/** Fewer defensible (level 1–4) comparables than this: no valuation number. Mirrors MIN_RELIABLE_SAMPLE. */
export const MIN_DEFENSIBLE_COMPARABLES = 3;

/** Most comparables a customer is shown from levels 1–4. */
export const MAX_CUSTOMER_COMPARABLES = 6;
/** Level 5 (broader nearby) is shown only below the threshold, and at most this many. */
export const MAX_BROADER_NEARBY = 2;

export type HierarchyLevel = 1 | 2 | 3 | 4 | 5;
export type DealType = 'SALE' | 'RENT' | 'UNKNOWN';
export type PriceKind = 'ASKING' | 'TRANSACTION';
export type Freshness = 'FRESH' | 'AGING' | 'STALE' | 'UNDATED';

export type CustomerExclusion =
  | 'UNRELATED_DISTRICT'
  | 'DISTRICT_UNKNOWN'
  | 'SIZE_OUT_OF_BAND'
  | 'SIZE_UNKNOWN'
  | 'DEAL_TYPE_MISMATCH'
  | 'CLASS_MISMATCH'
  | 'CONDITION_FAR'
  | 'EXPIRED'
  | 'STALE';

export type HierarchyReason =
  | 'SAME_PROJECT'
  | 'SAME_ADDRESS'
  | 'SAME_STREET'
  | 'STREET_BRANCH'
  | 'WITHIN_600M'
  | 'NEARBY_PREMIUM_PEER'
  | 'BROADER_NEARBY_SAME_DISTRICT'
  | 'BROADER_NEARBY_ADJACENT_DISTRICT';

export const LEVEL_KEY: Record<HierarchyLevel, string> = {
  1: 'SAME_PROJECT',
  2: 'SAME_ADDRESS',
  3: 'SAME_STREET',
  4: 'NEARBY_PREMIUM_PROJECT',
  5: 'BROADER_NEARBY',
};

export interface CustomerComparable {
  level: HierarchyLevel;
  levelKey: string;
  reason: HierarchyReason;
  /** True only when this listing is in the valuation's numbers (never level 5, never when insufficient). */
  valuationUse: boolean;
  address?: string;
  district?: AreaKey;
  area?: number;
  rooms?: number;
  pricePerSqm: number;
  totalPrice?: number;
  currency: string;
  dealType: DealType;
  priceKind: PriceKind;
  listingDate?: string;
  freshness: Freshness;
  /** Plain flags a reader should see: an undated or ageing ask. */
  flags: Array<'LISTING_DATE_UNKNOWN' | 'AGING_LISTING' | 'ASKING_NOT_TRANSACTION'>;
  url?: string;
  source?: string;
}

export interface MarketValuation {
  state: 'ESTIMATE' | 'INSUFFICIENT_EVIDENCE';
  minimumComparables: number;
  /** Level 1–4 listings that passed every gate (before outlier trimming). */
  defensibleComparables: number;
  /** Listings the numbers come from (after trimming). 0 when insufficient. */
  usedComparables: number;
  /** Null whenever the state is INSUFFICIENT_EVIDENCE — by construction. */
  pricePerSqm: { median: number; min: number; max: number } | null;
  currency: string;
  /** ASKING when every listing used is an ask. Never silently a "value". */
  priceBasis: 'ASKING' | 'TRANSACTION' | 'MIXED' | null;
  levelsUsed: HierarchyLevel[];
  sizeBand: { min: number; max: number } | null;
  reasonCode: 'TOO_FEW_DEFENSIBLE_COMPARABLES' | null;
  /** Always true: no district or citywide listing is ever in these numbers. */
  localOnly: true;
}

export interface LocationHierarchy {
  /** What a buyer reads as comparable, in hierarchy order. */
  comparables: CustomerComparable[];
  /** How many listings each level holds after the gate. */
  levelCounts: Record<HierarchyLevel, number>;
  /** Why listings were kept away from the customer, as counts (a listing may carry several). */
  excluded: Partial<Record<CustomerExclusion | 'OUTLIER', number>>;
  sizeBand: { min: number; max: number } | null;
  minimumComparables: number;
  valuation: MarketValuation;
}

/* ------------------------------------------------------------------ *
 * Listing attributes                                                  *
 * ------------------------------------------------------------------ */

const txt = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

const RENT_HINT = /qiravdeba|for[-_\s]?rent|\brent(?:al)?\b|ქირავდება|ქირით|ქირაობ|аренд|сда[её]тся|kiral[ıi]k/i;
const SALE_HINT = /iyideba|for[-_\s]?sale|\bsale\b|\bbuy\b|იყიდება|продаж|прода[её]тся|sat[ıi]l[ıi]k/i;

/**
 * SALE or RENT, from what the source stated, then its URL/text. A price per
 * m² under 100 is a monthly rent, never a Tbilisi sale ask.
 */
export function dealTypeOf(c: RawComparable, pricePerSqm?: number): DealType {
  const stated = `${txt(c.dealType)} ${txt(c.transactionType)}`;
  if (RENT_HINT.test(stated)) return 'RENT';
  if (SALE_HINT.test(stated)) return 'SALE';
  const loose = [c.comparableType, c.similarity, c.url, c.propertyType].map(txt).join(' ');
  if (RENT_HINT.test(loose)) return 'RENT';
  if (typeof pricePerSqm === 'number' && pricePerSqm > 0 && pricePerSqm < 100) return 'RENT';
  if (SALE_HINT.test(loose)) return 'SALE';
  return 'UNKNOWN';
}

/** TRANSACTION only when the source says so; a listing is an ask. */
export function priceKindOf(c: RawComparable): PriceKind {
  const k = `${txt(c.priceKind)} ${txt(c.comparableType)}`.toLowerCase();
  return /transaction|registered[_\s]?sale|გარიგებ/.test(k) ? 'TRANSACTION' : 'ASKING';
}

const OLD_STOCK = /ძველი\s*აშენებ|old[-\s]?build|старый\s*фонд|хрущ|სტალინურ|ჩეხურ|ლენინგრადურ|მოსკოვურ|ქალაქური\s*ტიპის|თბილისური\s*ეზო/i;
const NEW_BUILD = /ახალი\s*აშენებ|ახალაშენებ|new[-\s]?build|новостро|მშენებარე|under\s*construction|კარკას|frame/i;

/** NEW_BUILD / OLD_STOCK when the listing says which; null when it does not. */
export function buildingClassOf(c: RawComparable): 'NEW_BUILD' | 'OLD_STOCK' | null {
  const t = [c.condition, c.similarity, c.propertyType, c.url].map(txt).join(' ');
  if (OLD_STOCK.test(t)) return 'OLD_STOCK';
  if (NEW_BUILD.test(t)) return 'NEW_BUILD';
  return null;
}

/* ------------------------------------------------------------------ *
 * The hierarchy                                                       *
 * ------------------------------------------------------------------ */

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function reasonOf(c: ScoredComparable): HierarchyReason {
  const has = (r: string) => (c.relevanceReasons as string[]).includes(r);
  switch (c.level) {
    case 1: return 'SAME_PROJECT';
    case 2: return 'SAME_ADDRESS';
    case 3: return has('STREET_BRANCH') ? 'STREET_BRANCH' : has('WITHIN_600M') ? 'WITHIN_600M' : 'SAME_STREET';
    case 4: return 'NEARBY_PREMIUM_PEER';
    default: return has('ADJACENT_DISTRICT') ? 'BROADER_NEARBY_ADJACENT_DISTRICT' : 'BROADER_NEARBY_SAME_DISTRICT';
  }
}

function toCustomer(c: ScoredComparable, used: ReadonlySet<ScoredComparable>): CustomerComparable {
  const level = c.level as HierarchyLevel;
  const flags: CustomerComparable['flags'] = [];
  if (c.freshness === 'UNDATED') flags.push('LISTING_DATE_UNKNOWN');
  if (c.freshness === 'AGING') flags.push('AGING_LISTING');
  if (c.priceKind === 'ASKING') flags.push('ASKING_NOT_TRANSACTION');
  return {
    level,
    levelKey: LEVEL_KEY[level],
    reason: reasonOf(c),
    valuationUse: used.has(c),
    ...(c.address ? { address: c.address } : {}),
    ...(c.district ? { district: c.district } : {}),
    ...(c.area ? { area: c.area } : {}),
    ...(c.rooms ? { rooms: c.rooms } : {}),
    pricePerSqm: Math.round(c.pricePerSqm),
    ...(c.totalPrice ? { totalPrice: c.totalPrice } : {}),
    currency: c.currency,
    dealType: c.dealType,
    priceKind: c.priceKind,
    ...(c.listingDate ? { listingDate: c.listingDate } : {}),
    freshness: c.freshness,
    flags,
    ...(c.url ? { url: c.url } : {}),
    ...(c.source ? { source: c.source } : {}),
  };
}

/**
 * The curated customer set and the valuation, from the scored pool.
 *
 * `chosen` is the headline set marketIntelligence already computed over the
 * same gate (levels 1–4, every exclusion empty, IQR-trimmed), so the
 * valuation and the headline can never disagree.
 */
export function buildLocationHierarchy(
  subject: Subject,
  scored: ScoredComparable[],
  chosen: ScoredComparable[],
): LocationHierarchy {
  const sizeBand = subject.area && subject.area > 0
    ? { min: Math.round(subject.area * (1 - SIZE_BAND) * 10) / 10, max: Math.round(subject.area * (1 + SIZE_BAND) * 10) / 10 }
    : null;

  const passed = scored.filter((c) => c.level !== null && c.exclusions.length === 0 && !c.outlier);
  const levelCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<HierarchyLevel, number>;
  for (const c of passed) levelCounts[c.level as HierarchyLevel] += 1;

  const byLevel = (a: ScoredComparable, b: ScoredComparable) =>
    (a.level as number) - (b.level as number) || b.relevance - a.relevance;
  const strong = passed.filter((c) => (c.level as number) <= 4).sort(byLevel).slice(0, MAX_CUSTOMER_COMPARABLES);
  // Broader nearby only when the local set is too thin to stand alone — and
  // then labelled as exactly that, never as a price for this home.
  const broader = strong.length < MIN_DEFENSIBLE_COMPARABLES
    ? passed.filter((c) => c.level === 5).sort(byLevel).slice(0, MAX_BROADER_NEARBY)
    : [];

  const excluded: LocationHierarchy['excluded'] = {};
  for (const c of scored) {
    for (const e of c.exclusions) excluded[e] = (excluded[e] ?? 0) + 1;
    if (c.outlier) excluded.OUTLIER = (excluded.OUTLIER ?? 0) + 1;
  }

  const defensible = scored.filter((c) => c.headlineEligible).length;
  const enough = chosen.length >= MIN_DEFENSIBLE_COMPARABLES;
  const values = chosen.map((c) => c.pricePerSqm);
  const kinds = new Set(chosen.map((c) => c.priceKind));
  const valuation: MarketValuation = {
    state: enough ? 'ESTIMATE' : 'INSUFFICIENT_EVIDENCE',
    minimumComparables: MIN_DEFENSIBLE_COMPARABLES,
    defensibleComparables: defensible,
    usedComparables: enough ? chosen.length : 0,
    pricePerSqm: enough
      ? { median: Math.round(median(values)), min: Math.round(Math.min(...values)), max: Math.round(Math.max(...values)) }
      : null,
    currency: chosen[0]?.currency ?? subject.currency ?? 'USD',
    priceBasis: !enough ? null : kinds.size > 1 ? 'MIXED' : kinds.has('TRANSACTION') ? 'TRANSACTION' : 'ASKING',
    levelsUsed: enough ? [...new Set(chosen.map((c) => c.level as HierarchyLevel))].sort() : [],
    sizeBand,
    reasonCode: enough ? null : 'TOO_FEW_DEFENSIBLE_COMPARABLES',
    localOnly: true,
  };

  const used = new Set<ScoredComparable>(enough ? chosen : []);
  return {
    comparables: [...strong, ...broader].map((c) => toCustomer(c, used)),
    levelCounts,
    excluded,
    sizeBand,
    minimumComparables: MIN_DEFENSIBLE_COMPARABLES,
    valuation,
  };
}

/* ------------------------------------------------------------------ *
 * What the synthesis model may see                                    *
 * ------------------------------------------------------------------ */

/**
 * The market as the model is allowed to read it: the curated comparables,
 * the bands that passed the gate and the deterministic valuation — never the
 * excluded citywide pool, so it cannot quote a city spread.
 */
export function marketForPrompt(m: MarketIntelligence | null | undefined): Record<string, unknown> | null {
  if (!m) return null;
  const shown = new Set((m.hierarchy?.comparables ?? []).map((c) => `${c.url ?? ''}|${c.pricePerSqm}|${c.area ?? ''}`));
  const isShown = (c: ScoredComparable) => shown.has(`${c.url ?? ''}|${Math.round(c.pricePerSqm)}|${c.area ?? ''}`);
  const strip = ({ url: _u, ...c }: ScoredComparable) => c;
  const { ranked: _r, closest: _c, ...rest } = m;
  return {
    ...rest,
    closest: (m.closest ?? []).filter(isShown).map(strip),
    ranked: (m.ranked ?? []).filter(isShown).map(strip),
    hierarchy: m.hierarchy
      ? { ...m.hierarchy, comparables: m.hierarchy.comparables.map(({ url: _u, ...c }) => c) }
      : undefined,
  };
}

/* ------------------------------------------------------------------ *
 * Deterministic valuation overrides prose                              *
 * ------------------------------------------------------------------ */

/*
 * A money figure: a currency next to a number, or a price per area unit.
 * Areas alone ("94.10 მ²") are NOT money and are left alone.
 */
const MONEY = new RegExp(
  [
    String.raw`[$€₾]\s?\d`,
    String.raw`\d[\d\s.,]*(?:\s?[-–—]\s?[$€₾]?\s?\d[\d\s.,]*)?\s?(?:\$|usd|eur|gel|დოლარ|ლარ|ევრო|долл|евро|лари|dolar)`,
    String.raw`\d\s?(?:\/|per\s|за\s|ერთ\s)\s?(?:მ²|მ2|კვ\.?\s?მ|m²|m2|sq\.?\s?m|sqm|кв\.?\s?м)`,
  ].join('|'),
  'iu',
);

/*
 * A PRICE PER AREA: market pricing wherever it appears ("$1,900/m²",
 * "1 900 დოლარი კვადრატულ მეტრზე"). Outside the market section only this is
 * scrubbed — a registered mortgage amount is a legal fact, not a valuation.
 */
const PER_AREA = new RegExp(
  [
    String.raw`\d\s?(?:[$€₾]|usd|gel)?\s?(?:\/|per\s|за\s)\s?(?:მ²|მ2|კვ\.?\s?მ|m²|m2|sq\.?\s?m|sqm|кв\.?\s?м)`,
    String.raw`(?:[$€₾]\s?\d|\d[\d\s.,]*\s?(?:\$|usd|eur|gel|დოლარ|ლარ|долл))[^.!?]{0,60}(?:კვადრატულ\s+მეტრ|კვ\.?\s?მ|მ²|m²|sq\.?\s?m|square\s+met|кв\.?\s?м|квадратн)`,
  ].join('|'),
  'iu',
);

/* "No reliable valuation / range is possible", in the languages observed. */
const VALUATION_DENIAL = [
  /სანდო[^.!?]{0,40}(?:დიაპაზონ|შეფასებ|ღირებულებ|ფას)[^.!?]{0,120}(?:ვერ|არ\s|შეუძლებ|არასწორ|ზედმეტ)/u,
  /(?:ვერ|შეუძლებ)[^.!?]{0,60}სანდო[^.!?]{0,40}(?:დიაპაზონ|შეფასებ|ღირებულებ|ფას)/u,
  /no\s+reliable\s+(?:market\s+)?(?:valuation|range|estimate|price|value)/i,
  /(?:cannot|can't|not\s+possible\s+to)\s+(?:give|provide|estimate|determine|state)\s+(?:a\s+)?(?:reliable\s+)?(?:market\s+)?(?:valuation|range|price|value)/i,
  /(?:нет|невозможно)[^.!?]{0,40}(?:надежн|достоверн)[^.!?]{0,40}(?:оценк|диапазон|стоимост)/i,
];

// A full stop after an abbreviation ("ქ. 6", "St. 6") does not end a sentence.
const splitSentences = (t: string): string[] =>
  t.split(/(?<=(?:\p{L}{3}|\d|[)»"”%²])[.!?։])\s+/u).filter((s) => s.trim());

function scrub(text: string, drop: (s: string) => boolean, removed: string[]): string {
  if (!text) return text;
  const kept = splitSentences(text).filter((s) => {
    if (!drop(s)) return true;
    removed.push(s.slice(0, 120));
    return false;
  });
  return kept.join(' ');
}

type AnyReport = Record<string, any>;

/**
 * Makes the prose agree with the deterministic valuation.
 *
 *   INSUFFICIENT_EVIDENCE → no money figure anywhere in the report's prose
 *     or metrics (sentences carrying one are removed; a priced metric is
 *     dropped). The report may say a valuation is not possible; it may not
 *     ALSO print a number.
 *   ESTIMATE → a sentence claiming no reliable valuation is possible is
 *     removed; the deterministic range is the answer.
 *
 * The project's own asking prices are still told structurally (the market
 * card's ASKING block); prose numbers are where contradictions are born.
 */
export function enforceValuation<T extends AnyReport>(report: T, market: MarketIntelligence | null | undefined): T {
  const v = market?.valuation;
  if (!report || !v) return report;
  const insufficient = v.state === 'INSUFFICIENT_EVIDENCE';
  const removed: string[] = [];
  const marketish = (dim?: string, key?: string) => key === 'MARKET' || dim === 'MARKET_POSITION';
  // In market prose any money figure is a price claim; elsewhere only a price
  // per area is. A denial of the valuation only matters in market prose.
  const scope = (text: string, isMarket: boolean): string =>
    insufficient
      ? scrub(text, (s) => (isMarket ? MONEY : PER_AREA).test(s), removed)
      : isMarket
        ? scrub(text, (s) => VALUATION_DENIAL.some((re) => re.test(s)), removed)
        : text;

  const sections = (report.sections ?? []).map((sec: AnyReport) => {
    const isMarket = marketish(undefined, sec.key);
    const metrics = (sec.metrics ?? []).filter((m: AnyReport) => {
      const pattern = isMarket ? MONEY : PER_AREA;
      const bad = insufficient && (pattern.test(`${m.value ?? ''}`) || pattern.test(`${m.label ?? ''}`));
      if (bad) removed.push(`metric: ${m.label} ${m.value}`.slice(0, 120));
      return !bad;
    });
    return { ...sec, body: scope(sec.body ?? '', isMarket), metrics };
  }).filter((sec: AnyReport) => `${sec.body}`.trim() || (sec.metrics ?? []).length);

  const summary = report.summary
    ? {
        ...report.summary,
        statement: scope(report.summary.statement ?? '', false),
        highlights: (report.summary.highlights ?? [])
          .map((h: AnyReport) => {
            const isMarket = marketish(h.dimension);
            return { ...h, headline: scope(h.headline ?? '', isMarket), detail: scope(h.detail ?? '', isMarket) };
          })
          .filter((h: AnyReport) => `${h.headline}`.trim()),
      }
    : report.summary;
  const keyFindings = (report.keyFindings ?? [])
    .map((f: AnyReport) => ({ ...f, finding: scope(f.finding ?? '', false), whyItMatters: scope(f.whyItMatters ?? '', false) }))
    .filter((f: AnyReport) => `${f.finding}`.trim());
  const attentionPoints = (report.attentionPoints ?? [])
    .map((a: AnyReport) => ({ ...a, point: scope(a.point ?? '', false), why: scope(a.why ?? '', false) }))
    .filter((a: AnyReport) => `${a.point}`.trim());
  const finalView = typeof report.finalView === 'string' ? scope(report.finalView, false) : report.finalView;

  if (!removed.length) return report;
  return {
    ...report,
    summary,
    sections,
    keyFindings,
    attentionPoints,
    finalView,
    rejectedBecause: [
      ...(report.rejectedBecause ?? []),
      ...removed.map((r) => `contradicts deterministic valuation (${v.state}): ${r}`),
    ],
  };
}

/**
 * Whether a gathered listing may even be CITED in the report (evidence
 * package). Same location rule as the hierarchy: an unrelated or unknown
 * district is never evidence about this home's market.
 */
export function isCitableComparable(scored: ScoredComparable | null): boolean {
  if (!scored || scored.level === null) return false;
  // The project's own past asks (archived / withdrawn offers) stay citable as
  // the project's ASKING history; every other gate still applies.
  const allowed = scored.level === 1 ? ['EXPIRED', 'STALE'] : [];
  return scored.exclusions.every((e) => allowed.includes(e));
}

/* ------------------------------------------------------------------ *
 * The subject, as the market gate needs it                             *
 * ------------------------------------------------------------------ */

const objOf = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const numOf = (v: unknown): number | undefined => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.').replace(/[^\d.]/g, '')) : NaN;
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/**
 * Address, neighbourhood, area and building class of the subject, read the
 * same way wherever the market gate runs (bundle and evidence package).
 *
 * The area falls back to the property extract: a cadastral Verify usually
 * has no unit area in exactUnit, and without it there is no size band
 * (job 8ba97da9: 94.1 m² was in the register, not in exactUnit).
 */
export function subjectMarketFacts(report: unknown): {
  address?: string; district?: string; area?: number; project?: string; buildingClass?: 'NEW_BUILD';
} {
  const r = objOf(report);
  const unit = objOf(r.exactUnit);
  const parent = objOf(r.identifiedParent);
  const rec = objOf(r.reconciledIdentity);
  const proj = objOf(r.projectProfile);
  const pr = objOf(r.publicResearch);
  const address = txt(unit.address) || txt(parent.address) || txt(r.address) || txt(rec.address) || txt(proj.address) || undefined;
  const facts = Array.isArray(pr.facts) ? pr.facts.filter((f: unknown) => typeof f === 'string') : [];
  const loc = buildLocationIntelligence([address, txt(rec.address) || undefined, ...facts]);
  const reg = buildPropertyRegister(r.browserOfficial);
  const area = numOf(unit.area ?? unit.areaSqm) ?? numOf(reg?.latest?.unitAreaSqm);
  const project = txt(pr.project) || txt(proj.name) || txt(rec.project) || undefined;
  const underConstruction = reg?.latest?.unitUnderConstruction === true || reg?.latest?.buildingsUnderConstruction === true;
  return {
    ...(address ? { address } : {}),
    ...(loc.district ? { district: loc.district } : {}),
    ...(area ? { area } : {}),
    ...(project ? { project } : {}),
    // A named development or a unit the register shows under construction is a new build.
    ...(project || underConstruction ? { buildingClass: 'NEW_BUILD' as const } : {}),
  };
}
