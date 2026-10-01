// The builder's master-layer rules, pure so node:test can import them
// directly (relative imports with the extension, no React, no network).
//
//   · housing           the same classification the server applies
//                       (engine.strategyInputFor → classifySpecialAdCategories)
//   · strategy copy     one sentence per StrategyReason / targeting adjustment;
//                       only codes the server sent are ever explained
//   · creative advice   grouped per creative; ONLY BLOCKING_ERROR blocks
//   · funding           the Add-funds amount for a server-computed shortfall
import { classifySpecialAdCategories, type DealKind, type MetaGoal } from '../../../lib/metaAds/strategy.ts';
import type { AdviceItem, AdviceSeverity } from '../../../lib/metaAds/creativeAdvice.ts';
import { CITY_RADIUS_KM_DEFAULT, HOUSING_MIN_RADIUS_KM, MAX_LOCATIONS, META_AGE_MAX, META_AGE_MIN, housingRule, type HousingRule } from '../../../lib/metaAds/targeting.ts';

/* ── HOUSING ─────────────────────────────────────────────────────────── */

/** The offer is a residential sale or rental (strategy.classifySpecialAdCategories). */
export function isHousingOffer(c: { property_id?: string | null; offer?: Record<string, unknown> | null }): boolean {
  const offer = c.offer as { isProperty?: boolean; dealKind?: string } | null | undefined;
  const cats = classifySpecialAdCategories({
    isProperty: !!c.property_id || !!(offer && offer.isProperty !== false),
    dealKind: (offer?.dealKind ?? (c.property_id ? 'SALE' : 'OTHER')) as DealKind,
  });
  return cats.includes('HOUSING');
}

/**
 * Meta's housing restrictions for this campaign as the server will apply them
 * (engine.strategyInputFor → targeting.declaredSpecialAdCategories): only a
 * housing offer that reaches the US, Canada or the European list.
 */
export function housingRuleFor(c: { property_id?: string | null; offer?: Record<string, unknown> | null }, locations: Array<{ countryCode?: string | null }>, advertiserCountry?: string | null): HousingRule {
  return housingRule(isHousingOffer(c), [...new Set(locations.map((l) => String(l.countryCode ?? '').toUpperCase()).filter(Boolean))], advertiserCountry);
}

/** The selected ad account's business country, when Meta reported it. */
export function advertiserCountryOf(status: { assets?: Array<{ kind: string; selected?: boolean; capabilities?: Record<string, unknown> | null }> } | null): string | null {
  const acct = status?.assets?.find((a) => a.kind === 'AD_ACCOUNT' && a.selected);
  const cc = String(acct?.capabilities?.business_country_code ?? '').toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : null;
}

/** Back-compat name: true only when Meta's restrictions apply to the campaign as targeted. */
export function isHousingCampaign(c: {
  property_id?: string | null; offer?: Record<string, unknown> | null; special_ad_categories?: string[] | null;
  targeting?: { locations?: Array<{ countryCode?: string | null }> } | null;
}, defaultCountries: string[] = ['GE']): boolean {
  const locs = c.targeting?.locations?.length ? c.targeting.locations : defaultCountries.map((cc) => ({ countryCode: cc }));
  return housingRuleFor(c, locs).restricted;
}

/** A city's radius as it will actually run: Meta's floor where its housing rule applies. */
export function effectiveRadiusKm(radiusKm: number | null | undefined, minRadiusKm: number | null | boolean): number {
  const r = Number(radiusKm ?? CITY_RADIUS_KM_DEFAULT);
  const min = minRadiusKm === true ? HOUSING_MIN_RADIUS_KM : typeof minRadiusKm === 'number' ? minRadiusKm : 0;
  return Math.max(min, r);
}

/**
 * The audience as HOMATCH will run it where Meta's housing rule applies — all
 * adults, everyone, and radii at Meta's floor for the reached countries — so
 * the draft stores exactly what the server sends (applyTargeting). Places,
 * languages and everything else are kept. Not restricted: unchanged.
 */
export function housingNormalized<T extends { locations: Array<{ type: string; radiusKm?: number | null; countryCode?: string | null }>; ageMin: number; ageMax: number; gender: string }>(t: T, minRadiusKm: number = HOUSING_MIN_RADIUS_KM): T {
  return {
    ...t, ageMin: META_AGE_MIN, ageMax: META_AGE_MAX, gender: 'ALL',
    locations: t.locations.map((l) => (l.type === 'city' || l.type === 'pin' ? { ...l, radiusKm: effectiveRadiusKm(l.radiusKm, minRadiusKm) } : l)),
  };
}

/**
 * When HOMATCH shows its (non-blocking) broad-audience recommendation: a single
 * gender, or an age range noticeably tighter than Meta's 18–65+. Advice only —
 * the customer's choice is saved and sent as chosen. Housing ads never get
 * here: Meta itself fixes their ages and gender.
 */
export const NARROW_AGE_MIN_OVER = 25;
export const NARROW_AGE_MAX_UNDER = 55;
export function isNarrowAudience(a: { ageMin: number; ageMax: number; gender: string }): boolean {
  return a.gender !== 'ALL' || a.ageMin > NARROW_AGE_MIN_OVER || a.ageMax < NARROW_AGE_MAX_UNDER;
}

/* ── STRATEGY COPY ───────────────────────────────────────────────────── */

/** Every StrategyReason the engine can emit (strategy.ts). */
export const STRATEGY_REASON_CODES = [
  'COMPACT_BUDGET_ONE_AD_SET', 'BUDGET_CONCENTRATED_ON_STRONGEST_CREATIVES', 'ALL_CREATIVES_TESTED',
  'SINGLE_CREATIVE', 'LOCATIONS_TESTED_SEPARATELY', 'LOCATIONS_COMBINED_FOR_BUDGET', 'FORMATS_TESTED_SEPARATELY',
  'SHORT_DURATION_SIMPLIFIED', 'BROAD_AUDIENCE_META_OPTIMIZES', 'HOUSING_AUDIENCE_RULES', 'CUSTOM_AUDIENCE_USED',
  'PRIORITY_CREATIVE_FIRST',
] as const;

/** Every adjustment applyTargeting can report (targeting.ts). */
export const TARGETING_ADJUSTMENT_CODES = ['HOUSING_AGE_ALL_ADULTS', 'HOUSING_ALL_GENDERS', 'HOUSING_RADIUS_WIDENED'] as const;

/** Plan issues the strategy preview can return (validatePlanInput + validateTargeting). */
export const PLAN_ISSUE_CODES = [
  'GOAL_UNSUPPORTED', 'DURATION_BELOW_MINIMUM', 'BUDGET_BELOW_MINIMUM', 'BUDGET_ABOVE_MAXIMUM', 'CREATIVE_REQUIRED',
  'DESTINATION_URL_INVALID', 'DESTINATION_GOAL_MISMATCH', 'LOCATION_REQUIRED', 'TOO_MANY_LOCATIONS', 'AGE_RANGE_INVALID',
  'PIN_INVALID', 'TOO_MANY_LANGUAGES', 'LANGUAGE_KEY_INVALID',
] as const;

const known = <T extends string>(list: readonly T[], codes: readonly string[] | null | undefined): T[] =>
  [...new Set((codes ?? []).filter((c): c is T => (list as readonly string[]).includes(c)))];

/** The explanation keys, in the server's order, for codes we can explain. */
export function strategyExplanationKeys(reasonCodes: readonly string[] | null | undefined, adjustments: readonly string[] | null | undefined): string[] {
  return [
    ...known(STRATEGY_REASON_CODES, reasonCodes).map((c) => `mm_b_reason_${c}`),
    ...known(TARGETING_ADJUSTMENT_CODES, adjustments).map((c) => `mm_b_adj_${c}`),
  ];
}

export function planIssueKey(code: string): string {
  return (PLAN_ISSUE_CODES as readonly string[]).includes(code) ? `mm_b_issue_${code}` : 'mm_b_issue_OTHER';
}

/* ── CREATIVE ADVICE ─────────────────────────────────────────────────── */

/** Every advice code creativeAdvice() can emit (checkMedia reasons upper-cased included). */
export const ADVICE_CODES = [
  'CREATIVE_REQUIRED', 'MEDIA_REQUIRED', 'PRIMARY_TEXT_REQUIRED', 'HEADLINE_REQUIRED', 'TEXT_TOO_LONG',
  'MEDIA_FORMAT_UNSUPPORTED', 'MEDIA_TOO_LARGE', 'MEDIA_RESOLUTION_TOO_LOW', 'MEDIA_VIDEO_TOO_SHORT', 'MEDIA_VIDEO_TOO_LONG',
  'MEDIA_NO_COMPATIBLE_PLACEMENT', 'MEDIA_DIMENSIONS_UNKNOWN', 'MEDIA_RESOLUTION_LOW', 'MEDIA_VIDEO_LONG_FOR_STORIES',
  'MEDIA_RATIO_CROPPED_ON_SOME_PLACEMENTS', 'ADD_VERTICAL_VERSION', 'ADD_CREATIVE_VARIATION', 'STRONGEST_CREATIVES_RUN_FIRST',
  'MEDIA_TOO_DARK', 'MEDIA_WASHED_OUT', 'MEDIA_LOW_CONTRAST', 'MEDIA_STRONG',
] as const;

export const adviceKey = (code: string) =>
  (ADVICE_CODES as readonly string[]).includes(code) ? `mm_b_adv_${code}` : 'mm_b_adv_OTHER';

/** The one severity that stops the customer. Everything else is advice. */
export const BLOCKING_SEVERITY: AdviceSeverity = 'BLOCKING_ERROR';
export const isBlocking = (a: { severity: string }) => a.severity === BLOCKING_SEVERITY;
export const adviceBlocks = (items: ReadonlyArray<{ severity: string }>) => items.some(isBlocking);

export type AdviceTone = 'neutral' | 'amber' | 'red';
export function adviceTone(severity: string): AdviceTone {
  if (severity === BLOCKING_SEVERITY) return 'red';
  if (severity === 'WARNING' || severity === 'RECOMMENDATION') return 'amber';
  return 'neutral';
}

const RANK: Record<string, number> = { BLOCKING_ERROR: 0, WARNING: 1, RECOMMENDATION: 2, INFO: 3 };

/** Per-creative advice (in the creatives' order) and campaign-wide advice. */
export function groupAdvice(items: readonly AdviceItem[]): { byCreative: Map<string, AdviceItem[]>; general: AdviceItem[] } {
  const byCreative = new Map<string, AdviceItem[]>();
  const general: AdviceItem[] = [];
  const seen = new Set<string>();
  for (const a of items) {
    const sig = `${a.creativeId ?? ''}|${a.code}|${JSON.stringify(a.params ?? {})}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    if (a.creativeId) byCreative.set(a.creativeId, [...(byCreative.get(a.creativeId) ?? []), a]);
    else general.push(a);
  }
  const sort = (xs: AdviceItem[]) => xs.sort((x, y) => (RANK[x.severity] ?? 9) - (RANK[y.severity] ?? 9));
  for (const [k, v] of byCreative) byCreative.set(k, sort(v));
  return { byCreative, general: sort(general) };
}

/* ── FUNDING ─────────────────────────────────────────────────────────── */

export const MIN_DEPOSIT_CENTS = 500;

/** Add funds for a server-computed shortfall: rounded up to a whole unit, never under the minimum. */
export function depositAmountCents(shortfallCents: number): number {
  const s = Math.max(0, Math.round(Number(shortfallCents) || 0));
  if (s === 0) return 0;
  return Math.max(MIN_DEPOSIT_CENTS, Math.ceil(s / 100) * 100);
}

/* ── GOAL → DESTINATION ──────────────────────────────────────────────── */

type Dest = { type: string; url?: string; formId?: string | null; messagingApp?: 'MESSENGER' | 'INSTAGRAM_DIRECT' | 'WHATSAPP' | null };

/** The destination a goal needs, keeping what the customer already chose. */
export function destinationForGoal(goal: MetaGoal, prev: Dest | null | undefined, hasPage: boolean): Dest {
  if (goal === 'LEADS_ON_META') return { type: 'META_FORM', formId: prev?.formId ?? null };
  if (goal === 'MESSAGES') return { type: 'MESSAGING', messagingApp: prev?.messagingApp ?? (hasPage ? 'MESSENGER' : null) };
  if (goal === 'ENGAGEMENT') return { type: 'ON_POST' };
  return { type: 'WEBSITE', url: prev?.url };
}

/* ── LOCATIONS ───────────────────────────────────────────────────────── */

export interface LocationLike { type: 'country' | 'region' | 'city' | 'pin'; key: string; name: string; countryCode: string; radiusKm?: number | null }

export const locationId = (l: LocationLike) => `${l.type}:${l.key}`;

/**
 * Add a place. Countries and the places inside them COEXIST: a city, region
 * or pin inside a chosen country REFINES it (the ads run in the refined
 * places only — targeting.effectiveLocations / applyTargeting), and removing
 * the refinement brings the whole country back. Nothing the owner chose is
 * silently deleted, so the same action can always be repeated.
 */
export function addLocation<T extends LocationLike>(list: readonly T[], next: T): { list: T[]; replaced: string[]; full: boolean } {
  if (list.some((l) => locationId(l) === locationId(next))) return { list: [...list], replaced: [], full: false };
  if (list.length >= MAX_LOCATIONS) return { list: [...list], replaced: [], full: true };
  return { list: [...list, next], replaced: [], full: false };
}

/** Countries that have a city, region or pin chosen inside them (they run only as those places). */
export function refinedCountries(list: ReadonlyArray<LocationLike>): Set<string> {
  return new Set(list.filter((l) => l.type !== 'country').map((l) => l.countryCode));
}

/**
 * What will actually run, grouped by country: "Georgia → Tbilisi · 15 km +
 * Kazakhstan". A country with places inside it runs only as those places
 * (targeting.effectiveLocations); a country alone runs whole.
 */
export function geographyGroups<T extends LocationLike>(list: readonly T[]): Array<{ countryCode: string; whole: boolean; places: T[] }> {
  const order: string[] = [];
  const by = new Map<string, { whole: boolean; places: T[] }>();
  for (const l of list) {
    const cc = String(l.countryCode ?? '').toUpperCase();
    if (!by.has(cc)) { by.set(cc, { whole: false, places: [] }); order.push(cc); }
    const g = by.get(cc)!;
    if (l.type === 'country') g.whole = true; else g.places.push(l);
  }
  return order.map((cc) => { const g = by.get(cc)!; return { countryCode: cc, whole: g.whole && g.places.length === 0, places: g.places }; });
}

/* ── LEAD FORMS ──────────────────────────────────────────────────────── */

/** Every issue validateLeadFormSpec() can return (leadForms.ts). */
export const LEAD_FORM_ISSUE_CODES = [
  'FORM_NAME_REQUIRED', 'PRIVACY_URL_REQUIRED', 'FOLLOW_UP_URL_INVALID', 'CONTACT_FIELD_REQUIRED', 'QUESTION_UNKNOWN',
  'TOO_MANY_QUESTIONS', 'HEADLINE_TOO_LONG', 'MESSAGE_TOO_LONG', 'LOCALE_UNSUPPORTED',
] as const;

export const leadFormIssueKey = (code: string) =>
  (LEAD_FORM_ISSUE_CODES as readonly string[]).includes(code) ? `mm_b_lf_issue_${code}` : 'mm_b_lf_issue_OTHER';

export const MAX_FORM_QUESTIONS = 5;

/**
 * A useful first name for a campaign: what is advertised · the goal · the
 * month — e.g. "Krtsanisi apartment · Messages · October 2026". Only a
 * suggestion: the customer edits it before launch, and can rename later.
 */
export function defaultCampaignName(a: { subject?: string | null; goalLabel: string; now?: Date; lang: string }): string {
  const month = (a.now ?? new Date()).toLocaleDateString(a.lang, { month: 'long', year: 'numeric' });
  const subject = String(a.subject ?? '').replace(/\s+/g, ' ').trim().slice(0, 60);
  return [subject, a.goalLabel, month].filter(Boolean).join(' · ').slice(0, 120);
}
