// META ADS — HOMATCH'S READING OF THE WHOLE BUILD. Pure: no React, no Deno,
// no network. Shared by the builder (live guidance, the review's campaign
// story, the consistency check) and meta-ads-api (the brief reader's
// fallback and its vocabulary, the translation fact guard).
//
// Everything here is derived from the build itself — the places, ages,
// languages, creatives, budget and the owner's brief. Nothing predicts
// performance: breadth is geometry, language is the script the copy is
// written in, and every expectation is a statement about room to learn,
// never a promise of results.

import type { InternationalIntent, LanguageChoice, LocationChoice, TargetingIntent } from './targeting.ts';
import { effectiveLocations, housingRule, reachedCountries, CITY_RADIUS_KM_DEFAULT } from './targeting.ts';

/* ── LANGUAGES ─────────────────────────────────────────────────────── */

/** Languages HOMATCH can name, write in and look up in Meta's locale list. */
export const LANGUAGE_CODES = [
  'ka', 'en', 'ru', 'tr', 'ar', 'he', 'uk', 'az', 'hy', 'de', 'fr', 'it', 'es', 'pt', 'pl', 'ro', 'nl', 'fa', 'zh', 'kk', 'be', 'hi', 'ja', 'ko',
] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];
/** The English name Meta's locale search (type=adlocale) answers to. */
export const LANGUAGE_ENGLISH: Record<LanguageCode, string> = {
  ka: 'Georgian', en: 'English', ru: 'Russian', tr: 'Turkish', ar: 'Arabic', he: 'Hebrew', uk: 'Ukrainian', az: 'Azerbaijani',
  hy: 'Armenian', de: 'German', fr: 'French', it: 'Italian', es: 'Spanish', pt: 'Portuguese', pl: 'Polish', ro: 'Romanian',
  nl: 'Dutch', fa: 'Persian', zh: 'Chinese', kk: 'Kazakh', be: 'Belarusian', hi: 'Hindi', ja: 'Japanese', ko: 'Korean',
};
export const isLanguageCode = (v: unknown): v is LanguageCode => (LANGUAGE_CODES as readonly string[]).includes(String(v));
/** The copy languages HOMATCH AI writes (AiCopyPanel, ai_copy). */
export const COPY_LANGUAGES = ['ka', 'en', 'ru', 'tr', 'ar', 'he'] as const;

/**
 * The language a piece of copy is written in, from its script — a fact about
 * the text, not a guess about the reader. Latin script is English unless it
 * carries Turkish letters; Cyrillic is Russian unless it carries Ukrainian
 * letters. Too little text → null.
 */
export function detectCopyLanguage(text: string | null | undefined): LanguageCode | null {
  const s = String(text ?? '');
  const count = (re: RegExp) => (s.match(re) ?? []).length;
  const scripts: Array<[LanguageCode, number]> = [
    ['ka', count(/[Ⴀ-ჿᲐ-Ჿ]/g)],
    ['ru', count(/[Ѐ-ӿ]/g)],
    ['ar', count(/[؀-ۿ]/g)],
    ['he', count(/[֐-׿]/g)],
    ['en', count(/[A-Za-zÀ-ÿĞğŞşİıÇçÖöÜü]/g)],
  ];
  const total = scripts.reduce((n, [, c]) => n + c, 0);
  if (total < 12) return null;
  const [top, n] = scripts.sort((a, b) => b[1] - a[1])[0];
  if (n / total < 0.6) return null;
  if (top === 'ru' && /[іїєґІЇЄҐ]/.test(s)) return 'uk';
  if (top === 'en' && /[ĞğŞşİıÇçÖöÜü]/.test(s)) return 'tr';
  return top;
}

/** The languages of a set of creatives' copy, most used first. */
export function copyLanguages(creatives: Array<{ headline?: string | null; primary_text?: string | null }>): LanguageCode[] {
  const counts = new Map<LanguageCode, number>();
  for (const c of creatives) {
    const l = detectCopyLanguage(`${c.primary_text ?? ''} ${c.headline ?? ''}`);
    if (l) counts.set(l, (counts.get(l) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
}

/* ── WHERE: HOW BROAD ──────────────────────────────────────────────── */

export type Breadth = 'VERY_SPECIFIC' | 'BALANCED' | 'BROAD';

/** Upper bounds, km², of the area a city/pin selection covers. */
export const VERY_SPECIFIC_MAX_KM2 = 800;
export const BALANCED_MAX_KM2 = 8_000;

const circleKm2 = (r: number) => Math.PI * r * r;

/**
 * Geometry, not prediction: a country or two regions is broad; otherwise the
 * area the cities and pins cover decides it (Tbilisi at 17 km ≈ 900 km² is
 * balanced; a 10 km circle is very specific).
 */
export function locationBreadth(all: LocationChoice[], minRadiusKm: number | null = null): { breadth: Breadth; areaKm2: number | null } {
  // What runs: a country refined by places inside it is measured as those places.
  const locations = effectiveLocations(all);
  if (!locations.length) return { breadth: 'BROAD', areaKm2: null };
  if (locations.some((l) => l.type === 'country')) return { breadth: 'BROAD', areaKm2: null };
  const regions = locations.filter((l) => l.type === 'region').length;
  if (regions >= 2) return { breadth: 'BROAD', areaKm2: null };
  const area = locations.filter((l) => l.type === 'city' || l.type === 'pin')
    .reduce((sum, l) => sum + circleKm2(Math.max(minRadiusKm ?? 0, Number(l.radiusKm ?? CITY_RADIUS_KM_DEFAULT))), 0);
  if (regions === 1) return { breadth: area > BALANCED_MAX_KM2 ? 'BROAD' : 'BALANCED', areaKm2: null };
  const rounded = Math.round(area);
  return { breadth: area <= VERY_SPECIFIC_MAX_KM2 ? 'VERY_SPECIFIC' : area <= BALANCED_MAX_KM2 ? 'BALANCED' : 'BROAD', areaKm2: rounded };
}

/* ── THE OWNER'S BRIEF ─────────────────────────────────────────────── */

export const BRIEF_AUDIENCES = [
  'LOCAL_RESIDENTS', 'FOREIGNERS_IN_COUNTRY', 'MOVING_HERE', 'INVESTORS_ABROAD', 'INVESTORS', 'FAMILIES',
  'YOUNG_PROFESSIONALS', 'STUDENTS', 'RETIREES', 'BUSINESS_BUYERS', 'TENANTS', 'FIRST_TIME_BUYERS',
] as const;
export type BriefAudience = (typeof BRIEF_AUDIENCES)[number];
export const BRIEF_EXPECTATIONS = ['LEADS', 'MESSAGES', 'VIEWINGS', 'AWARENESS', 'FAST_SALE', 'RIGHT_BUYER'] as const;
export type BriefExpectation = (typeof BRIEF_EXPECTATIONS)[number];
export const BRIEF_IGNORED_REASONS = ['NOT_RELEVANT', 'NOT_POSSIBLE', 'CONTRADICTS_FACTS', 'NOT_ALLOWED_TARGETING'] as const;
export type BriefIgnoredReason = (typeof BRIEF_IGNORED_REASONS)[number];

export interface BriefUnderstanding {
  /** briefHash() of the brief this was read from. */
  hash: string;
  source: 'AI' | 'RULES';
  at: string;
  /** One plain sentence in the owner's language, or null. */
  summary: string | null;
  audiences: BriefAudience[];
  languages: LanguageCode[];
  /** ISO-3166 alpha-2 countries the people are from / connected to. */
  markets: string[];
  /** Places named in the brief, as written (searched, never auto-targeted). */
  places: string[];
  /** What the owner says matters most about the property, in their words. */
  sellingPoints: string[];
  expectation: BriefExpectation | null;
  /** Parts HOMATCH deliberately did not use, and why. */
  ignored: Array<{ reason: BriefIgnoredReason; text: string }>;
  /** True once the owner removed something HOMATCH understood. */
  edited?: boolean;
}

export const BRIEF_MAX = 1500;

/** FNV-1a over the trimmed brief — the same in the browser and the edge. */
export function briefHash(text: string | null | undefined): string {
  const s = String(text ?? '').trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `b${h.toString(16)}_${s.length}`;
}

const clipText = (v: unknown, n: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const COUNTRY = /^[A-Z]{2}$/;

/**
 * Closed vocabularies and length limits for whatever produced an
 * understanding (the model or the rules): anything outside them is dropped,
 * never stored.
 */
export function sanitizeUnderstanding(raw: unknown, hash: string, source: 'AI' | 'RULES', at: string, knownCountries?: Set<string>): BriefUnderstanding {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const uniq = <T,>(xs: T[]) => [...new Set(xs)];
  return {
    hash, source, at,
    summary: clipText(r.summary, 400) || null,
    audiences: uniq(list(r.audiences).map(String).filter((a): a is BriefAudience => (BRIEF_AUDIENCES as readonly string[]).includes(a))).slice(0, 6),
    languages: uniq(list(r.languages).map((l) => String(l).toLowerCase()).filter(isLanguageCode)).slice(0, 4),
    markets: uniq(list(r.markets).map((m) => String(m).toUpperCase()).filter((m) => COUNTRY.test(m) && (!knownCountries || knownCountries.has(m)))).slice(0, 6),
    places: uniq(list(r.places).map((p) => clipText(p, 60)).filter(Boolean)).slice(0, 5),
    sellingPoints: uniq(list(r.sellingPoints).map((p) => clipText(p, 80)).filter(Boolean)).slice(0, 5),
    expectation: (BRIEF_EXPECTATIONS as readonly string[]).includes(String(r.expectation)) ? r.expectation as BriefExpectation : null,
    ignored: list(r.ignored).map((x) => (x && typeof x === 'object' ? x as Record<string, unknown> : {}))
      .filter((x) => (BRIEF_IGNORED_REASONS as readonly string[]).includes(String(x.reason)))
      .map((x) => ({ reason: x.reason as BriefIgnoredReason, text: clipText(x.text, 120) }))
      .filter((x) => x.text).slice(0, 4),
  };
}

/* Words for the rules reader — six interface languages, lower-case stems. */
const LANG_WORDS: Array<[LanguageCode, RegExp]> = [
  ['ru', /russian|русск|русскоязыч|რუს|rusça|rus dili|روس|רוסית/i],
  ['en', /english|англ|ინგლის|ingilizce|إنجليز|אנגלית/i],
  ['ka', /georgian|грузин|ქართ|gürcüce|جورجي|גאורגית/i],
  ['tr', /turkish|турец|თურქ|türkçe|ترك|טורקית/i],
  ['ar', /arabic|араб|არაბ|arapça|عرب|ערבית/i],
  ['he', /hebrew|иврит|ებრა|ibranice|عبري|עברית/i],
  ['uk', /ukrainian|украин|უკრაინ|ukraynaca/i],
  ['az', /azerbaijani|азербайдж|აზერბაიჯან|azerice/i],
  ['hy', /armenian|армян|სომხ|ermenice/i],
  ['de', /german|немец|გერმან|almanca/i],
];
const AUDIENCE_WORDS: Array<[BriefAudience, RegExp]> = [
  ['FOREIGNERS_IN_COUNTRY', /expat|foreigner|иностран|экспат|უცხოელ|ექსპატ|yabancı|أجانب|מהגר|זרים/i],
  ['MOVING_HERE', /moving (to|here)|move here|relocat|переезж|переехать|релокац|გადმოსვლ|გადმოსახლ|taşın|انتقال|לעבור/i],
  ['INVESTORS', /invest|инвест|ინვესტ|yatırım|استثمار|השקע/i],
  ['FAMILIES', /famil|семь|семей|ოჯახ|aile|عائل|משפח/i],
  ['STUDENTS', /student|студент|სტუდენტ|öğrenci|طلاب|סטודנט/i],
  ['RETIREES', /retire|пенсион|პენსიონ|emekli|متقاعد|גמלא/i],
  ['TENANTS', /tenant|renter|арендатор|снять|მოიჯარ|kiracı|مستأجر|שוכר/i],
  ['LOCAL_RESIDENTS', /local|locals|местн|ადგილობრ|yerel|محلي|מקומי/i],
];

/** A careful reading without a model: only what the words plainly say. */
export function readBriefRules(text: string): Record<string, unknown> {
  const s = String(text ?? '');
  const languages = LANG_WORDS.filter(([, re]) => re.test(s)).map(([l]) => l);
  const audiences = AUDIENCE_WORDS.filter(([, re]) => re.test(s)).map(([a]) => a);
  return { audiences, languages, markets: [], places: [], sellingPoints: [], expectation: null, ignored: [], summary: null };
}

/* ── THE TRANSLATION FACT GUARD ────────────────────────────────────── */

/** Every number in a text (prices, sizes, floors, years), separators ignored. */
export function numbersIn(text: string | null | undefined): string[] {
  const s = String(text ?? '').replace(/(\d)[\s.,'’ ](?=\d{3}\b)/g, '$1');
  return [...new Set((s.match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(',', '.').replace(/^0+(?=\d)/, '')))];
}

/** A rewrite keeps every number of the source (a price is never translated away). */
export function factsPreserved(source: string, candidate: string): boolean {
  const have = new Set(numbersIn(candidate));
  return numbersIn(source).every((n) => have.has(n));
}

/* ── THE WHOLE BUILD ───────────────────────────────────────────────── */

export interface BuildFacts {
  goal: string;
  dailyBudgetCents: number;
  durationDays: number;
  /** strategy.minAdSetDailyCents × the objective's factor, when known. */
  minAdSetDailyCents?: number | null;
  targeting: TargetingIntent;
  housingOffer: boolean;
  creatives: Array<{ id: string; headline?: string | null; primary_text?: string | null; media?: unknown[] | null; priority?: boolean | null }>;
  brief?: BriefUnderstanding | null;
  /** Meta's audience size estimate, when Meta returned one. */
  estimate?: { lower: number; upper: number } | null;
}

export type FixAction =
  | { kind: 'ADD_LANGUAGE'; code: LanguageCode }
  | { kind: 'TRANSLATE_COPY'; code: LanguageCode }
  | { kind: 'ADD_MARKETS'; markets: string[] }
  | { kind: 'WIDEN_AREA' }
  | { kind: 'ADD_CREATIVES' }
  | { kind: 'BROADEN_AGES' }
  | { kind: 'GO'; step: string };

export interface ConsistencyIssue {
  code: string;
  severity: 'WARNING' | 'SUGGESTION';
  vars?: Record<string, string>;
  fix?: FixAction;
}

const usable = (b: BuildFacts) => b.creatives.filter((c) => Array.isArray(c.media) && c.media.length > 0);
const ABROAD: InternationalIntent[] = ['MOVING_HERE', 'INVESTORS_ABROAD', 'COUNTRY_CONNECTED'];

/**
 * One holistic check before launch. It looks for contradictions between the
 * choices — never re-decides them — and every issue names the one change
 * that resolves it.
 */
export function campaignConsistency(b: BuildFacts): ConsistencyIssue[] {
  const out: ConsistencyIssue[] = [];
  const t = b.targeting;
  const chosen = (t.languages ?? []).map((l) => l.code).filter(isLanguageCode);
  const copy = copyLanguages(usable(b));
  const intl = t.international?.enabled ? t.international : null;
  const reached = reachedCountries(t);
  const rule = housingRule(b.housingOffer, reached);
  const breadth = locationBreadth(t.locations, rule.minRadiusKm).breadth;

  // Copy in one language, the audience limited to others.
  if (chosen.length && copy.length && !copy.some((l) => chosen.includes(l))) {
    out.push({ code: 'COPY_LANGUAGE_NOT_TARGETED', severity: 'WARNING', vars: { copy: copy[0], chosen: chosen.join(',') }, fix: { kind: 'TRANSLATE_COPY', code: chosen[0] } });
  }
  // The brief asks for a language the copy and audience do not have.
  for (const l of b.brief?.languages ?? []) {
    if (!chosen.includes(l) && !copy.includes(l)) {
      out.push({ code: 'BRIEF_LANGUAGE_MISSING', severity: 'SUGGESTION', vars: { lang: l }, fix: { kind: 'TRANSLATE_COPY', code: l } });
      break;
    }
  }
  // Foreigners already in the country: their language is the best signal there is.
  if (intl?.intents.includes('FOREIGNERS_IN_COUNTRY') && !chosen.length) {
    const lang = copy.find((l) => l !== 'ka') ?? b.brief?.languages.find((l) => l !== 'ka');
    out.push({ code: 'FOREIGNERS_WITHOUT_LANGUAGE', severity: 'SUGGESTION', vars: lang ? { lang } : {}, fix: lang ? { kind: 'ADD_LANGUAGE', code: lang } : { kind: 'GO', step: 'audience' } });
  }
  // People abroad, but the ads only run at home.
  const markets = intl?.markets ?? [];
  if (intl && intl.intents.some((i) => ABROAD.includes(i)) && markets.length && !markets.some((m) => reached.includes(m))) {
    out.push({ code: 'ABROAD_NOT_REACHED', severity: 'WARNING', vars: { markets: markets.join(',') }, fix: { kind: 'ADD_MARKETS', markets } });
  }
  // A very small area for people who are not there yet.
  if (breadth === 'VERY_SPECIFIC' && intl && intl.intents.some((i) => ABROAD.includes(i))) {
    out.push({ code: 'TINY_AREA_FOR_ABROAD', severity: 'WARNING', fix: { kind: 'WIDEN_AREA' } });
  }
  // A narrow area AND a narrow audience: very little room to learn.
  const narrowPeople = t.gender !== 'ALL' || t.ageMin > 25 || t.ageMax < 55;
  if (!rule.restricted && breadth === 'VERY_SPECIFIC' && narrowPeople) {
    out.push({ code: 'NARROW_EVERYWHERE', severity: 'SUGGESTION', fix: { kind: 'BROADEN_AGES' } });
  }
  // One creative carrying a sizeable budget.
  const min = Number(b.minAdSetDailyCents ?? 800);
  if (usable(b).length <= 1 && b.dailyBudgetCents >= 2 * min) {
    out.push({ code: 'FEW_CREATIVES_FOR_BUDGET', severity: 'SUGGESTION', vars: { n: String(usable(b).length) }, fix: { kind: 'ADD_CREATIVES' } });
  }
  // Many places on a small budget: HOMATCH combines them, which is fine — say so.
  if (t.locations.length >= 4 && b.dailyBudgetCents < 2 * min) {
    out.push({ code: 'MANY_PLACES_SMALL_BUDGET', severity: 'SUGGESTION', vars: { n: String(t.locations.length) }, fix: { kind: 'GO', step: 'audience' } });
  }
  // Meta's audience estimate says the audience is very small.
  if (b.estimate && b.estimate.upper > 0 && b.estimate.upper < 5_000) {
    out.push({ code: 'AUDIENCE_VERY_SMALL', severity: 'WARNING', fix: { kind: 'WIDEN_AREA' } });
  }
  return out;
}

/* ── THE CAMPAIGN STORY (the review, explained) ────────────────────── */

export interface StoryLine { key: string; vars?: Record<string, string> }
export interface StorySection { key: 'goal' | 'who' | 'where' | 'language' | 'creative' | 'optimise' | 'first_days' | 'brief'; lines: StoryLine[] }

/**
 * The review in sentences, each one a fact of the build. Section keys and
 * line keys map to i18n; the builder fills in names it already has.
 */
export function campaignStory(b: BuildFacts & { goalKey: string; placeNames: string[]; languageNames: string[]; marketNames: string[] }): StorySection[] {
  const t = b.targeting;
  const rule = housingRule(b.housingOffer, reachedCountries(t));
  const breadth = locationBreadth(t.locations, rule.minRadiusKm).breadth;
  const intl = t.international?.enabled ? t.international : null;
  const crs = usable(b);
  const priority = crs.filter((c) => c.priority).length;
  const sections: StorySection[] = [];

  sections.push({ key: 'goal', lines: [{ key: `goal_${b.goalKey}` }] });

  const who: StoryLine[] = [];
  if (rule.restricted) who.push({ key: 'who_meta_rule', vars: { countries: rule.countries.join(', ') } });
  else if (t.gender === 'ALL' && t.ageMin <= 18 && t.ageMax >= 65) who.push({ key: 'who_broad' });
  else who.push({ key: 'who_chosen', vars: { min: String(t.ageMin), max: t.ageMax >= 65 ? '65+' : String(t.ageMax), gender: t.gender } });
  for (const a of b.brief?.audiences ?? []) who.push({ key: `who_brief_${a}` });
  sections.push({ key: 'who', lines: who.slice(0, 4) });

  sections.push({ key: 'where', lines: [{ key: 'where_places', vars: { places: b.placeNames.join(', ') } }, { key: `where_${breadth}` }] });

  const lang: StoryLine[] = [];
  if (b.languageNames.length) lang.push({ key: 'lang_chosen', vars: { langs: b.languageNames.join(', ') } });
  else lang.push({ key: 'lang_all' });
  const copy = copyLanguages(crs);
  if (copy.length) lang.push({ key: 'lang_copy', vars: { lang: copy[0] } });
  if (intl) lang.push({ key: 'lang_international', vars: { markets: b.marketNames.join(', ') } });
  sections.push({ key: 'language', lines: lang });

  sections.push({
    key: 'creative', lines: [
      { key: crs.length === 1 ? 'creative_one' : 'creative_many', vars: { n: String(crs.length) } },
      ...(priority ? [{ key: 'creative_priority', vars: { n: String(priority) } }] : []),
    ],
  });
  sections.push({ key: 'optimise', lines: [{ key: 'optimise_managed' }] });
  sections.push({ key: 'first_days', lines: [{ key: 'first_days_learning' }] });
  const brief = b.brief;
  if (brief && (brief.summary || brief.sellingPoints.length)) {
    sections.push({
      key: 'brief', lines: [
        ...(brief.summary ? [{ key: 'brief_summary', vars: { text: brief.summary } }] : []),
        ...(brief.sellingPoints.length ? [{ key: 'brief_points', vars: { points: brief.sellingPoints.join(', ') } }] : []),
      ],
    });
  }
  return sections;
}

/* ── WHAT CAN I EXPECT ─────────────────────────────────────────────── */

export type Room = 'GOOD_ROOM' | 'SOME_ROOM' | 'TIGHT';

/**
 * Room to learn — never a forecast of leads. Budget per day against what one
 * ad set needs to learn, the days available to learn and then improve, and
 * how many creatives there are to compare.
 */
export function expectationGuide(b: BuildFacts): { room: Room; notes: StoryLine[] } {
  const min = Number(b.minAdSetDailyCents ?? 800);
  const notes: StoryLine[] = [];
  const perDay = b.dailyBudgetCents / Math.max(1, min);
  const n = usable(b).length;
  let score = 0;
  if (perDay >= 1) score += 1;
  if (perDay >= 2) score += 1;
  if (b.durationDays >= 7) score += 1;
  if (n >= 2) score += 1;
  notes.push({ key: perDay >= 1 ? 'exp_budget_ok' : 'exp_budget_low' });
  notes.push({ key: b.durationDays >= 7 ? 'exp_days_ok' : 'exp_days_short', vars: { days: String(b.durationDays) } });
  notes.push({ key: n >= 2 ? 'exp_creatives_ok' : 'exp_creatives_few', vars: { n: String(n) } });
  if (b.estimate && b.estimate.upper > 0) notes.push({ key: 'exp_audience_size', vars: { lower: String(b.estimate.lower), upper: String(b.estimate.upper) } });
  return { room: score >= 4 ? 'GOOD_ROOM' : score >= 2 ? 'SOME_ROOM' : 'TIGHT', notes };
}

export type { LanguageChoice };

/** ISO-3166 alpha-2 codes a market can be (named in the UI language via Intl). */
export const COUNTRY_CODES = 'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BG BH BR BY CA CH CL CN CO CY CZ DE DK DZ EE EG ES FI FR GB GE GR HR HU ID IE IL IN IQ IR IS IT JO JP KG KR KW KZ LB LT LU LV MA MD ME MK MT MX MY NL NO NZ OM PH PK PL PT QA RO RS RU SA SE SG SI SK SY TH TJ TM TN TR TW UA US UZ VN ZA'.split(' ');
