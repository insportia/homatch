// SIX-LANGUAGE SEARCH PLAN — language-native intent families, not one
// keyword translated six times.
//
// Three kinds of query, because the sources answer different questions:
//   community  finds WHERE demand lives (Facebook/LinkedIn group search)
//   demand     finds WHO is asking (post/keyword search, VK/LinkedIn/TikTok)
//   hashtag    finds content clusters (TikTok/Instagram)
//
// Deterministic templates give every campaign a sound plan at zero cost; an
// optional OpenAI enrichment (mergeModelQueries) may add native phrasings,
// which are deduplicated and capped exactly like the templates.

import { SEARCH_LANGUAGES, type SearchLanguage } from './languages.ts';
import { placeNamesFor } from './places.ts';
import type { PropertyDna } from './propertyDna.ts';
import type { BuyerStrategy } from './buyerStrategy.ts';

/* fb-qp-2: property-specific strategy queries; cached generic phrasings of fb-qp-1 are not reused. */
export const QUERY_PLAN_VERSION = 'fb-qp-2';

export type QueryKind = 'community' | 'demand' | 'hashtag';
export type QueryFamily =
  | 'COMMUNITY' | 'WANT_BUY' | 'LOOKING_FOR' | 'NEED' | 'RELOCATING' | 'INVESTMENT' | 'TYPE_IN_PLACE'
  | 'WANT_RENT' | 'HASHTAG' | 'MODEL';

export interface PlannedQuery {
  language: SearchLanguage;
  kind: QueryKind;
  family: QueryFamily;
  query: string;
}

export interface QueryPlan {
  version: string;
  dnaKey: string;
  languages: SearchLanguage[];
  queries: PlannedQuery[];
}

export const PER_LANGUAGE_CAPS: Readonly<Record<QueryKind, number>> = { community: 2, demand: 4, hashtag: 1 };

type T = (p: { city: string; place: string; type: string; beds: string }) => string;
interface LangTemplates {
  community: T[];
  sale: Array<[QueryFamily, T]>;
  rent: Array<[QueryFamily, T]>;
  hashtag: (p: { cityLatin: string; city: string }) => string;
  typeWord: (type: string | null) => string;
  beds: (bedrooms: number | null, rooms: number | null) => string;
}

const TYPE_EN: Record<string, string> = { APARTMENT: 'apartment', HOUSE: 'house', VILLA: 'villa', LAND: 'land', COMMERCIAL: 'commercial space', OFFICE: 'office' };

const TEMPLATES: Record<SearchLanguage, LangTemplates> = {
  ka: {
    community: [({ city }) => `ბინები ${city}`, ({ city }) => `უძრავი ქონება ${city}`],
    sale: [
      ['WANT_BUY', ({ type, city }) => `ვყიდულობ ${type} ${city}`],
      ['LOOKING_FOR', ({ type, city }) => `ვეძებ ${type} ${city}`],
      ['TYPE_IN_PLACE', ({ beds, place }) => `${beds} ${place}`.trim()],
      ['INVESTMENT', ({ city }) => `ინვესტიცია ბინა ${city}`],
    ],
    rent: [
      ['WANT_RENT', ({ type, city }) => `ვქირაობ ${type} ${city}`],
      ['LOOKING_FOR', ({ type, city }) => `ვეძებ ${type} ქირით ${city}`],
      ['TYPE_IN_PLACE', ({ beds, place }) => `${beds} ქირით ${place}`.trim()],
      ['NEED', ({ city }) => `მჭირდება ბინა ქირით ${city}`],
    ],
    hashtag: ({ city }) => `#${city.replace(/\s+/g, '')}`,
    typeWord: (t) => (t === 'HOUSE' ? 'სახლს' : 'ბინას'),
    beds: (b, r) => (r ?? (b != null ? b + 1 : null)) ? `${r ?? (b as number) + 1}-ოთახიანი ბინა` : 'ბინა',
  },
  ru: {
    community: [({ city }) => `квартиры ${city}`, ({ city }) => `недвижимость ${city}`],
    sale: [
      ['WANT_BUY', ({ type, city }) => `куплю ${type} в ${city}`],
      ['LOOKING_FOR', ({ type, city }) => `ищу ${type} ${city}`],
      ['TYPE_IN_PLACE', ({ beds, place }) => `${beds} ${place}`.trim()],
      ['RELOCATING', ({ city }) => `переезжаю в ${city} квартира`],
    ],
    rent: [
      ['WANT_RENT', ({ type, city }) => `сниму ${type} ${city}`],
      ['LOOKING_FOR', ({ type, city }) => `ищу ${type} в аренду ${city}`],
      ['TYPE_IN_PLACE', ({ beds, place }) => `${beds} аренда ${place}`.trim()],
      ['RELOCATING', ({ city }) => `переезжаю в ${city} сниму`],
    ],
    hashtag: ({ city }) => `#квартира${city.replace(/\s+/g, '').toLowerCase()}`,
    typeWord: (t) => (t === 'HOUSE' ? 'дом' : 'квартиру'),
    beds: (b, r) => (r ?? (b != null ? b + 1 : null)) ? `${r ?? (b as number) + 1}-комнатная квартира` : 'квартира',
  },
  en: {
    community: [({ city }) => `${city} apartments`, ({ city }) => `${city} real estate`],
    sale: [
      ['WANT_BUY', ({ type, city }) => `looking to buy ${type} in ${city}`],
      ['NEED', ({ type, city }) => `need ${type} ${city}`],
      ['TYPE_IN_PLACE', ({ beds, place }) => `${beds} ${place}`.trim()],
      ['INVESTMENT', ({ city }) => `investment property ${city}`],
    ],
    rent: [
      ['WANT_RENT', ({ type, city }) => `looking to rent ${type} in ${city}`],
      ['NEED', ({ type, city }) => `need ${type} for rent ${city}`],
      ['TYPE_IN_PLACE', ({ beds, place }) => `${beds} rent ${place}`.trim()],
      ['RELOCATING', ({ city }) => `relocating to ${city} apartment`],
    ],
    hashtag: ({ cityLatin }) => `#${cityLatin.replace(/\s+/g, '').toLowerCase()}apartment`,
    typeWord: (t) => TYPE_EN[t ?? 'APARTMENT'] ?? 'apartment',
    beds: (b) => (b != null && b > 0 ? `${b} bedroom apartment` : 'apartment'),
  },
  ar: {
    community: [({ city }) => `عقارات ${city}`, ({ city }) => `شقق ${city}`],
    sale: [
      ['WANT_BUY', ({ city }) => `أبحث عن شقة للشراء في ${city}`],
      ['LOOKING_FOR', ({ city }) => `أريد شراء شقة في ${city}`],
      ['TYPE_IN_PLACE', ({ city }) => `شقة للبيع ${city}`],
      ['INVESTMENT', ({ city }) => `استثمار عقاري ${city}`],
    ],
    rent: [
      ['WANT_RENT', ({ city }) => `أبحث عن شقة للإيجار في ${city}`],
      ['LOOKING_FOR', ({ city }) => `أريد استئجار شقة في ${city}`],
      ['TYPE_IN_PLACE', ({ city }) => `شقة للإيجار ${city}`],
      ['RELOCATING', ({ city }) => `الانتقال إلى ${city} سكن`],
    ],
    hashtag: () => '#عقارات_جورجيا',
    typeWord: () => 'شقة',
    beds: () => 'شقة',
  },
  he: {
    community: [({ city }) => `דירות ב${city}`, ({ city }) => `נדל"ן ${city}`],
    sale: [
      ['WANT_BUY', ({ city }) => `מחפש דירה לקנייה ב${city}`],
      ['LOOKING_FOR', ({ city }) => `רוצה לקנות דירה ב${city}`],
      ['TYPE_IN_PLACE', ({ city }) => `דירה למכירה ב${city}`],
      ['INVESTMENT', ({ city }) => `השקעה בנדל"ן ב${city}`],
    ],
    rent: [
      ['WANT_RENT', ({ city }) => `מחפש דירה להשכרה ב${city}`],
      ['LOOKING_FOR', ({ city }) => `רוצה לשכור דירה ב${city}`],
      ['TYPE_IN_PLACE', ({ city }) => `דירה להשכרה ב${city}`],
      ['RELOCATING', ({ city }) => `רילוקיישן ל${city} דירה`],
    ],
    hashtag: () => '#נדלןבגאורגיה',
    typeWord: () => 'דירה',
    beds: () => 'דירה',
  },
  tr: {
    community: [({ city }) => `${city} emlak`, ({ city }) => `${city} kiralık satılık daire`],
    sale: [
      ['WANT_BUY', ({ city }) => `${city} satılık daire arıyorum`],
      ['LOOKING_FOR', ({ city }) => `${city} daire almak istiyorum`],
      ['TYPE_IN_PLACE', ({ place }) => `${place} satılık daire`],
      ['INVESTMENT', ({ city }) => `${city} yatırımlık daire`],
    ],
    rent: [
      ['WANT_RENT', ({ city }) => `${city} kiralık daire arıyorum`],
      ['LOOKING_FOR', ({ city }) => `${city} kiralık ev arıyorum`],
      ['TYPE_IN_PLACE', ({ place }) => `${place} kiralık daire`],
      ['RELOCATING', ({ city }) => `${city} taşınıyorum ev`],
    ],
    hashtag: ({ city }) => `#${city.replace(/\s+/g, '').toLowerCase()}emlak`,
    typeWord: () => 'daire',
    beds: () => 'daire',
  },
};

export const normalizeQuery = (q: string) =>
  q.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}#\s"'-]/gu, ' ').replace(/\s+/g, ' ').trim();

/** Stable, short hash for query performance rows (FNV-1a, hex). */
export function queryHash(q: string): string {
  let h = 0x811c9dc5;
  for (const ch of normalizeQuery(q)) { h ^= ch.codePointAt(0)!; h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/**
 * With a buyer strategy, demand queries are the strategy's property-specific
 * phrasings (explicit purchase/rent intent + place + specs + budget) instead
 * of the generic templates; community and hashtag queries are unchanged.
 */
export function buildQueryPlan(dna: PropertyDna, languages: readonly SearchLanguage[] = SEARCH_LANGUAGES, strategy?: BuyerStrategy | null): QueryPlan {
  const out: PlannedQuery[] = [];
  const seen = new Set<string>();
  const counts = new Map<string, number>();
  const add = (language: SearchLanguage, kind: QueryKind, family: QueryFamily, query: string) => {
    const norm = normalizeQuery(query);
    if (!norm || norm.length < 3) return;
    const key = `${language}|${norm}`;
    const ck = `${language}|${kind}`;
    if (seen.has(key) || (counts.get(ck) ?? 0) >= PER_LANGUAGE_CAPS[kind]) return;
    seen.add(key);
    counts.set(ck, (counts.get(ck) ?? 0) + 1);
    out.push({ language, kind, family, query: query.trim() });
  };
  const cityLatin = dna.city ?? '';
  for (const lang of languages) {
    const t = TEMPLATES[lang];
    const cityNames = placeNamesFor('city', dna.city, lang);
    if (!cityNames.length) continue;
    /* Georgian: the locative form ("თბილისში") reads naturally in a request. */
    const city = lang === 'ka' ? cityNames[cityNames.length - 1] : cityNames[0];
    const districtNames = placeNamesFor('district', dna.district, lang);
    const place = districtNames.length ? (lang === 'ka' ? districtNames[districtNames.length - 1] : districtNames[0]) : city;
    const params = { city, place, type: t.typeWord(dna.propertyType), beds: t.beds(dna.bedrooms, dna.rooms) };
    for (const c of t.community) add(lang, 'community', 'COMMUNITY', c({ ...params, city: cityNames[0] }));
    const own = strategy && strategy.transaction === dna.transaction ? strategy.queries.filter((q) => q.language === lang) : [];
    for (const q of own) add(lang, 'demand', q.persona === 'INVESTOR' ? 'INVESTMENT' : q.persona === 'RELOCATING' ? 'RELOCATING' : dna.transaction === 'RENT' ? 'WANT_RENT' : 'WANT_BUY', q.query);
    if (!own.length) for (const [family, f] of dna.transaction === 'RENT' ? t.rent : t.sale) add(lang, 'demand', family, f(params));
    add(lang, 'hashtag', 'HASHTAG', t.hashtag({ cityLatin, city: cityNames[0] }));
  }
  return { version: QUERY_PLAN_VERSION, dnaKey: dna.dnaKey, languages: [...languages], queries: out };
}

/**
 * Merge model-proposed phrasings (structured output: {language, query}[]).
 * Only demand queries, only the six languages, deduplicated against the plan,
 * and still under the per-language cap (+2 for model phrasings).
 */
export function mergeModelQueries(plan: QueryPlan, proposed: Array<{ language?: unknown; query?: unknown }>): QueryPlan {
  const seen = new Set(plan.queries.map((q) => `${q.language}|${normalizeQuery(q.query)}`));
  const extra = new Map<string, number>();
  const queries = [...plan.queries];
  for (const p of proposed ?? []) {
    const language = String(p?.language ?? '').toLowerCase() as SearchLanguage;
    const query = String(p?.query ?? '').trim();
    if (!SEARCH_LANGUAGES.includes(language) || query.length < 3 || query.length > 120) continue;
    const key = `${language}|${normalizeQuery(query)}`;
    if (seen.has(key) || (extra.get(language) ?? 0) >= 2) continue;
    seen.add(key);
    extra.set(language, (extra.get(language) ?? 0) + 1);
    queries.push({ language, kind: 'demand', family: 'MODEL', query });
  }
  return { ...plan, queries };
}

export function queriesFor(plan: QueryPlan, kind: QueryKind, language?: SearchLanguage): PlannedQuery[] {
  return plan.queries.filter((q) => q.kind === kind && (!language || q.language === language));
}
