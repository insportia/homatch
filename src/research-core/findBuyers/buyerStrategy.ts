// BUYER STRATEGY — who would plausibly buy (or rent) THIS property, where
// they talk, in which language and words, built from the property's own
// facts before a single paid search. Pure and deterministic.
//
// A premium apartment in Krtsanisi and an economy flat in Gldani get
// different personas, places, languages and phrasings:
//   segment      PREMIUM / MIDDLE / ECONOMY from the market segmentation layer
//                when it has evidence (property_market_segments), else UNKNOWN
//                — never guessed from the price alone
//   budget band  what a compatible buyer would state (the DNA's tolerance band)
//   places       the district, its micro-areas and the nearby districts, with
//                every spelling people use (Krtsanisi / Крцаниси / კრწანისი,
//                Ortachala, Sololaki …)
//   personas     hypotheses only (local family, relocating, investor, first-time
//                buyer …) — each with the languages and phrasings it implies;
//                a persona is a search hypothesis, never a claim about a person
//   queries      explicit purchase (or rent) intent + place + specs + budget;
//                generic "looking for apartment" (which pulls rentals and job
//                posts) is never generated for a sale
//   depth        how many platforms/languages/probes the budget unlocks
//
// Learning is bounded: query performance (find_buyers_query_stats) can only
// re-order and retire queries proven useless, never invent new intent.

import { SEARCH_LANGUAGES, type SearchLanguage } from './languages.ts';
import { DISTRICT_NAMES, NEARBY_DISTRICTS, AREA_PARENT, placeNamesFor, normKey } from './places.ts';
import type { PropertyDna } from './propertyDna.ts';

export const STRATEGY_VERSION = 'fb-strategy-1';

export type Segment = 'PREMIUM' | 'MIDDLE' | 'ECONOMY' | 'UNKNOWN';
export type PersonaKey = 'LOCAL_FAMILY' | 'UPGRADER' | 'RELOCATING' | 'INVESTOR' | 'DIASPORA' | 'FIRST_TIME' | 'LUXURY' | 'STUDENT_TENANT' | 'EXPAT_TENANT' | 'FAMILY_TENANT';

export interface Persona {
  key: PersonaKey;
  /** Why this hypothesis fits the property (facts, not assumptions about people). */
  basis: string;
  languages: SearchLanguage[];
  weight: number;
}

export interface StrategyQuery {
  language: SearchLanguage;
  persona: PersonaKey | 'PLACE';
  query: string;
}

export interface Depth {
  tier: 'FOCUSED' | 'STANDARD' | 'BROAD';
  /** Languages to search, in priority order (owner choice still filters). */
  languages: SearchLanguage[];
  /** Max demand queries per language. */
  queriesPerLanguage: number;
  /** Examine comments under comparable listings. */
  comments: boolean;
  /** Platforms worth paying for at this depth (others only via known sources). */
  platforms: string[];
}

export interface BuyerStrategy {
  version: string;
  transaction: 'SALE' | 'RENT';
  segment: Segment;
  segmentConfidence: number | null;
  budgetBand: { min: number; max: number; currency: string } | null;
  places: { city: string | null; district: string | null; areas: string[]; nearby: string[] };
  personas: Persona[];
  queries: StrategyQuery[];
  /** Words that mark the wrong side of the market for this campaign. */
  excludeSignals: string[];
  depth: Depth;
  requirements: { strong: string[]; flexible: string[] };
}

const fmtMoney = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(Math.round(n)));
const sep = (n: number) => String(Math.round(n / 1000) * 1000).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

/** Micro-areas inside the property's district (Ortachala, Ponichala … for Krtsanisi). */
export function areasOf(district: string | null): string[] {
  const d = normKey(district);
  if (!d) return [];
  return Object.entries(AREA_PARENT).filter(([, parent]) => parent === d).map(([area]) => area);
}

/** Every way people write a place, across languages (search aliases). */
export function placeAliases(key: string): string[] {
  const names = DISTRICT_NAMES[key];
  if (!names) return [key];
  return [...new Set(Object.values(names).flat())];
}

function personasFor(dna: PropertyDna, segment: Segment): Persona[] {
  const rooms = dna.rooms ?? (dna.bedrooms != null ? dna.bedrooms + 1 : null);
  const family = (rooms ?? 0) >= 3 || (dna.bedrooms ?? 0) >= 2;
  const p: Persona[] = [];
  if (dna.transaction === 'RENT') {
    if (family) p.push({ key: 'FAMILY_TENANT', basis: `${rooms ?? '?'} rooms suit a household`, languages: ['ka', 'ru', 'en'], weight: 0.4 });
    p.push({ key: 'EXPAT_TENANT', basis: 'Tbilisi rental demand from relocated professionals', languages: ['en', 'ru', 'tr', 'he', 'ar'], weight: 0.35 });
    if (!family) p.push({ key: 'STUDENT_TENANT', basis: 'small unit', languages: ['ka', 'en', 'ru', 'ar'], weight: 0.25 });
    return p;
  }
  if (segment === 'PREMIUM') {
    p.push({ key: 'LUXURY', basis: 'premium segment for its area', languages: ['ru', 'en', 'he', 'ar', 'ka'], weight: 0.3 });
    p.push({ key: 'INVESTOR', basis: 'premium central stock attracts yield/capital buyers', languages: ['en', 'ru', 'he', 'ar', 'tr'], weight: 0.25 });
    p.push({ key: 'RELOCATING', basis: 'relocation buyers concentrate in central districts', languages: ['ru', 'en', 'he'], weight: 0.2 });
    if (family) p.push({ key: 'UPGRADER', basis: `${rooms} rooms: a family upgrade`, languages: ['ka', 'ru'], weight: 0.25 });
  } else if (segment === 'ECONOMY') {
    p.push({ key: 'FIRST_TIME', basis: 'affordable for its area; mortgage/instalment buyers', languages: ['ka', 'ru'], weight: 0.45 });
    if (family) p.push({ key: 'LOCAL_FAMILY', basis: `${rooms} rooms`, languages: ['ka', 'ru'], weight: 0.35 });
    p.push({ key: 'INVESTOR', basis: 'low entry price for rental yield', languages: ['ru', 'en', 'tr'], weight: 0.2 });
  } else {
    if (family) p.push({ key: 'LOCAL_FAMILY', basis: `${rooms ?? '?'} rooms`, languages: ['ka', 'ru'], weight: 0.35 });
    p.push({ key: 'RELOCATING', basis: 'relocation demand into Tbilisi', languages: ['ru', 'en', 'he'], weight: 0.25 });
    p.push({ key: 'INVESTOR', basis: 'apartments in central Tbilisi are bought for yield', languages: ['en', 'ru', 'he', 'ar', 'tr'], weight: 0.2 });
    p.push({ key: 'DIASPORA', basis: 'Georgians abroad buying at home', languages: ['ka', 'en'], weight: 0.2 });
  }
  return p;
}

/* Explicit-intent phrasings per language. {place}=district or city in the
   language, {rooms}/{beds}=specs, {budget}=a budget expression. Purchase
   verbs only for SALE (never a bare "looking for"). */
type Q = (v: { place: string; city: string; rooms: string; beds: string; budget: string }) => string;
const BUY: Record<SearchLanguage, Partial<Record<PersonaKey | 'PLACE', Q[]>>> = {
  ka: {
    PLACE: [({ rooms, place }) => `ვიყიდი ${rooms} ${place}`, ({ place }) => `ვყიდულობ ბინას ${place}`],
    LOCAL_FAMILY: [({ rooms, city }) => `ვიყიდი ${rooms} ${city} მეპატრონისგან`],
    UPGRADER: [({ rooms, place }) => `შევიძენ ${rooms} ${place}`],
    FIRST_TIME: [({ city }) => `ვიყიდი ბინას იპოთეკით ${city}`],
    DIASPORA: [({ city }) => `საზღვარგარეთიდან ვყიდულობ ბინას ${city}`],
    LUXURY: [({ place }) => `ვიყიდი პრემიუმ ბინას ${place}`],
  },
  ru: {
    PLACE: [({ rooms, place }) => `куплю ${rooms} ${place}`, ({ place, budget }) => `куплю квартиру ${place} ${budget}`.trim()],
    LOCAL_FAMILY: [({ rooms, city }) => `куплю ${rooms} в ${city} от собственника`],
    UPGRADER: [({ rooms, place }) => `хотим купить ${rooms} ${place}`],
    RELOCATING: [({ city }) => `переезжаем в ${city} купить квартиру`],
    INVESTOR: [({ city }) => `купить квартиру в ${city} для инвестиций`],
    FIRST_TIME: [({ city }) => `куплю квартиру в ипотеку ${city}`],
    LUXURY: [({ place }) => `куплю квартиру премиум ${place}`],
  },
  en: {
    PLACE: [({ beds, place }) => `looking to buy ${beds} in ${place}`, ({ place, budget }) => `buy apartment ${place} ${budget}`.trim()],
    RELOCATING: [({ city }) => `moving to ${city} want to buy apartment`],
    INVESTOR: [({ city }) => `buy apartment in ${city} for investment`],
    DIASPORA: [({ city }) => `buying an apartment in ${city} from abroad`],
    LUXURY: [({ place }) => `buy luxury apartment ${place}`],
    UPGRADER: [({ beds, city }) => `buy ${beds} ${city}`],
  },
  ar: {
    PLACE: [({ city }) => `أريد شراء شقة في ${city}`],
    INVESTOR: [({ city }) => `شراء شقة في ${city} للاستثمار`],
    LUXURY: [({ city }) => `شراء شقة فاخرة في ${city}`],
  },
  he: {
    PLACE: [({ city }) => `רוצה לקנות דירה ב${city}`],
    INVESTOR: [({ city }) => `קניית דירה להשקעה ב${city}`],
    RELOCATING: [({ city }) => `עוברים ל${city} קונים דירה`],
  },
  tr: {
    PLACE: [({ city }) => `${city} satılık daire almak istiyorum`],
    INVESTOR: [({ city }) => `${city} yatırımlık daire satın almak`],
  },
};
const RENT: Record<SearchLanguage, Partial<Record<PersonaKey | 'PLACE', Q[]>>> = {
  ka: { PLACE: [({ rooms, place }) => `ვიქირავებ ${rooms} ${place}`, ({ place }) => `ვეძებ ბინას ქირით ${place}`] },
  ru: { PLACE: [({ rooms, place }) => `сниму ${rooms} ${place}`, ({ place, budget }) => `сниму квартиру ${place} ${budget}`.trim()], EXPAT_TENANT: [({ city }) => `переезжаю в ${city} сниму квартиру`] },
  en: { PLACE: [({ beds, place }) => `looking to rent ${beds} in ${place}`], EXPAT_TENANT: [({ city }) => `relocating to ${city} need apartment for rent`] },
  ar: { PLACE: [({ city }) => `أبحث عن شقة للإيجار في ${city}`] },
  he: { PLACE: [({ city }) => `מחפש דירה להשכרה ב${city}`] },
  tr: { PLACE: [({ city }) => `${city} kiralık daire arıyorum`] },
};

const ROOMS: Record<SearchLanguage, (rooms: number | null, beds: number | null) => { rooms: string; beds: string }> = {
  ka: (r) => ({ rooms: r ? `${r} ოთახიან ბინას` : 'ბინას', beds: r ? `${r} ოთახიანი ბინა` : 'ბინა' }),
  ru: (r) => ({ rooms: r ? `${r}-комнатную квартиру` : 'квартиру', beds: r ? `${r}-комнатная квартира` : 'квартира' }),
  en: (_r, b) => ({ rooms: b ? `${b} bedroom apartment` : 'apartment', beds: b ? `${b} bedroom apartment` : 'apartment' }),
  ar: () => ({ rooms: 'شقة', beds: 'شقة' }),
  he: () => ({ rooms: 'דירה', beds: 'דירה' }),
  tr: (r) => ({ rooms: r ? `${Math.max(1, r - 1)}+1 daire` : 'daire', beds: r ? `${Math.max(1, r - 1)}+1 daire` : 'daire' }),
};

function budgetWords(lang: SearchLanguage, band: BuyerStrategy['budgetBand'], tx: 'SALE' | 'RENT'): string {
  if (!band) return '';
  const max = band.max;
  if (tx === 'RENT') return lang === 'ru' ? `до ${Math.round(max)}$` : lang === 'en' ? `up to $${Math.round(max)}` : '';
  if (lang === 'ru') return `до ${sep(max)}$`;
  if (lang === 'en') return `budget $${fmtMoney(max)}`;
  return '';
}

/** Budget → depth. More money unlocks more platforms, languages and comments. */
export function depthFor(providerBudgetMicros: number, persona: Persona[], chosen?: readonly string[] | null): Depth {
  const usd = Math.max(0, providerBudgetMicros) / 1e6;
  const tier: Depth['tier'] = usd < 4 ? 'FOCUSED' : usd < 12 ? 'STANDARD' : 'BROAD';
  /* Languages ordered by the personas' weights (the owner's choice filters later). */
  const score = new Map<SearchLanguage, number>();
  for (const p of persona) p.languages.forEach((l, i) => score.set(l, (score.get(l) ?? 0) + p.weight * (1 - i * 0.12)));
  let languages = [...SEARCH_LANGUAGES].sort((a, b) => (score.get(b) ?? 0) - (score.get(a) ?? 0));
  if (chosen?.length) languages = languages.filter((l) => chosen.includes(l));
  const keep = tier === 'FOCUSED' ? 3 : tier === 'STANDARD' ? 5 : 6;
  return {
    tier,
    languages: chosen?.length ? languages : languages.slice(0, keep),
    queriesPerLanguage: tier === 'FOCUSED' ? 2 : tier === 'STANDARD' ? 3 : 4,
    comments: true,
    platforms: tier === 'FOCUSED' ? ['FACEBOOK', 'TELEGRAM'] : tier === 'STANDARD' ? ['FACEBOOK', 'TELEGRAM', 'INSTAGRAM', 'TIKTOK'] : ['FACEBOOK', 'TELEGRAM', 'INSTAGRAM', 'TIKTOK', 'LINKEDIN', 'VK', 'BLUESKY', 'REDDIT', 'X', 'THREADS', 'YOUTUBE'],
  };
}

export interface StrategyInput {
  dna: PropertyDna;
  segment?: { segment: Segment; confidence?: number | null } | null;
  providerBudgetMicros: number;
  targetLanguages?: readonly string[] | null;
}

export function buildBuyerStrategy(input: StrategyInput): BuyerStrategy {
  const { dna } = input;
  const segment: Segment = input.segment?.segment ?? 'UNKNOWN';
  const personas = personasFor(dna, segment);
  const depth = depthFor(input.providerBudgetMicros, personas, input.targetLanguages ?? null);
  const district = normKey(dna.district) || null;
  const areas = areasOf(district);
  const nearby = district ? (NEARBY_DISTRICTS[district] ?? []) : [];
  const band = dna.tolerances.price ? { min: dna.tolerances.price.min, max: dna.tolerances.price.max, currency: dna.currency ?? 'USD' } : null;
  const rooms = dna.rooms ?? (dna.bedrooms != null ? dna.bedrooms + 1 : null);
  const table = dna.transaction === 'RENT' ? RENT : BUY;
  const queries: StrategyQuery[] = [];
  const seen = new Set<string>();
  for (const lang of depth.languages) {
    const cityNames = placeNamesFor('city', dna.city, lang);
    const city = cityNames.length ? (lang === 'ka' ? cityNames[cityNames.length - 1] : cityNames[0]) : (dna.city ?? '');
    const dNames = district ? placeNamesFor('district', district, lang) : [];
    const place = dNames.length ? (lang === 'ka' ? dNames[dNames.length - 1] : dNames[0]) : city;
    const r = ROOMS[lang](rooms, dna.bedrooms);
    const v = { place, city, rooms: r.rooms, beds: r.beds, budget: budgetWords(lang, band, dna.transaction) };
    const out: string[] = [];
    const push = (persona: StrategyQuery['persona'], f: Q) => {
      const q = f(v).replace(/\s+/g, ' ').trim();
      const key = `${lang}|${q.toLowerCase()}`;
      if (q.length < 4 || seen.has(key) || out.length >= depth.queriesPerLanguage) return;
      seen.add(key); out.push(q); queries.push({ language: lang, persona, query: q });
    };
    for (const f of table[lang]?.PLACE ?? []) push('PLACE', f);
    for (const p of [...personas].sort((a, b) => b.weight - a.weight)) {
      if (!p.languages.includes(lang)) continue;
      for (const f of table[lang]?.[p.key] ?? []) push(p.key, f);
    }
    /* A nearby area, in this language, when room is left (Ortachala, Sololaki …). */
    const near = [...areas, ...nearby].map((k) => placeNamesFor('district', k, lang)[0]).filter(Boolean);
    if (near[0] && out.length < depth.queriesPerLanguage) {
      for (const f of (table[lang]?.PLACE ?? []).slice(0, 1)) push('PLACE', (x) => f({ ...x, place: near[0] }));
    }
  }
  return {
    version: STRATEGY_VERSION,
    transaction: dna.transaction,
    segment,
    segmentConfidence: input.segment?.confidence ?? null,
    budgetBand: band,
    places: { city: dna.city, district, areas, nearby },
    personas,
    queries,
    excludeSignals: dna.transaction === 'SALE' ? ['RENT_SEEKER', 'RENT_OFFER', 'SALE_OFFER', 'JOB', 'SERVICE'] : ['BUY_SEEKER', 'SALE_OFFER', 'RENT_OFFER', 'JOB', 'SERVICE'],
    depth,
    requirements: {
      strong: [dna.transaction === 'SALE' ? 'purchase intent' : 'rental intent', dna.city ? `city: ${dna.city}` : null, band ? `budget ≥ ${Math.round(band.min)}` : null].filter(Boolean) as string[],
      flexible: [district ? `district: ${district} or nearby (${[...areas, ...nearby].join(', ')})` : null, rooms ? `rooms: ${rooms} ± 1` : null, dna.areaSqm ? `area: ${Math.round(dna.areaSqm)} m² ± 20%` : null].filter(Boolean) as string[],
    },
  };
}

export interface QueryStat { query: string; language: string; runs: number; items: number; qualified: number; spendMicros: number }

/**
 * Bounded learning: order strategy queries by their observed qualified
 * yield per dollar, and retire a query that already ran ≥3 times, returned
 * content and never qualified anyone. Never adds a query, never changes words.
 */
export function prioritizeQueries<T extends { query: string; language: string }>(queries: T[], stats: QueryStat[]): T[] {
  const key = (q: { query: string; language: string }) => `${q.language}|${q.query.trim().toLowerCase()}`;
  const by = new Map(stats.map((s) => [key(s), s]));
  return queries
    .filter((q) => { const s = by.get(key(q)); return !(s && s.runs >= 3 && s.items > 0 && s.qualified === 0); })
    .map((q, i) => { const s = by.get(key(q)); const y = s && s.spendMicros > 0 ? s.qualified / (s.spendMicros / 1e6) : null; return { q, i, y }; })
    .sort((a, b) => (b.y ?? -1) - (a.y ?? -1) || a.i - b.i)
    .map((x) => x.q);
}
