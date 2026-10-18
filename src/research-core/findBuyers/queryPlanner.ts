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

import { FAMILY_BUY, FAMILY_MARKET, FAMILY_RENT, REAL_ESTATE_IN, propertyFamily, propertyNom, propertyNoun } from './propertyFamily.ts';
import { SEARCH_LANGUAGES, type SearchLanguage } from './languages.ts';
import { placeNamesFor } from './places.ts';
import type { PropertyDna } from './propertyDna.ts';
import type { BuyerStrategy, SearchTier } from './buyerStrategy.ts';

/* fb-qp-2: property-specific strategy queries; cached generic phrasings of fb-qp-1 are not reused.
   fb-qp-4: subtype-aware model phrasings with a tier; fb-qp-3 cached phrasings are not reused. */
export const QUERY_PLAN_VERSION = 'fb-qp-4';

/** listing: how a comparable property is ADVERTISED ("for sale: 3-room flat in X"), used to
    find competitor / agency / developer listing posts whose comments hold the buyers. */
export type QueryKind = 'community' | 'demand' | 'hashtag' | 'listing';
export type QueryFamily =
  | 'COMMUNITY' | 'WANT_BUY' | 'LOOKING_FOR' | 'NEED' | 'RELOCATING' | 'INVESTMENT' | 'TYPE_IN_PLACE'
  | 'WANT_RENT' | 'HASHTAG' | 'MODEL' | 'LISTING';

export interface PlannedQuery {
  language: SearchLanguage;
  kind: QueryKind;
  family: QueryFamily;
  query: string;
  /** Demand queries: the strategy's search tier (buyerStrategy.ts), kept as provenance. */
  tier?: SearchTier;
}

export interface QueryPlan {
  version: string;
  dnaKey: string;
  languages: SearchLanguage[];
  queries: PlannedQuery[];
}

/* community: 6 — the first two are the classic group searches; the rest rotate per campaign so
   each search can find groups the earlier ones did not (owner, 2026-10-18; campaignPlan). */
export const PER_LANGUAGE_CAPS: Readonly<Record<QueryKind, number>> = { community: 6, demand: 4, hashtag: 1, listing: 2 };

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
    community: [({ city }) => `ბინები ${city}`, ({ city }) => `უძრავი ქონება ${city}`,
      ({ city }) => `ბინების ყიდვა გაყიდვა ${city}`, ({ city }) => `ბინა მეპატრონისგან ${city}`, ({ city }) => `ბინის ყიდვა ${city}`, () => `უძრავი ქონება საქართველო`],
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
    community: [({ city }) => `квартиры ${city}`, ({ city }) => `недвижимость ${city}`,
      ({ city }) => `купить квартиру ${city}`, ({ city }) => `квартиры ${city} без посредников`, ({ city }) => `русские в ${city}`, () => `недвижимость Грузии`],
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
    community: [({ city }) => `${city} apartments`, ({ city }) => `${city} real estate`,
      ({ city }) => `buy apartment ${city}`, ({ city }) => `expats in ${city}`, ({ city }) => `${city} property for sale`, () => `Georgia real estate investment`],
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
    community: [({ city }) => `عقارات ${city}`, ({ city }) => `شقق ${city}`,
      ({ city }) => `شراء شقة ${city}`, ({ city }) => `العرب في ${city}`, () => `عقارات جورجيا`, ({ city }) => `الاستثمار العقاري ${city}`],
    sale: [
      /* v6 (2026-10-17): the property's own district and rooms, in native script (places.ts),
         not one generic city query translated six times. */
      ['WANT_BUY', ({ beds, place }) => `أبحث عن ${beds} للشراء في ${place}`],
      ['LOOKING_FOR', ({ city }) => `أريد شراء شقة في ${city}`],
      ['TYPE_IN_PLACE', ({ beds, place }) => `${beds} ${place}`],
      ['INVESTMENT', ({ city }) => `استثمار عقاري ${city}`],
    ],
    rent: [
      ['WANT_RENT', ({ beds, place }) => `أبحث عن ${beds} للإيجار في ${place}`],
      ['LOOKING_FOR', ({ city }) => `أريد استئجار شقة في ${city}`],
      ['TYPE_IN_PLACE', ({ beds, place }) => `${beds} للإيجار ${place}`],
      ['RELOCATING', ({ city }) => `الانتقال إلى ${city} سكن`],
    ],
    hashtag: () => '#عقارات_جورجيا',
    typeWord: (t) => (t === 'HOUSE' ? 'منزل' : 'شقة'),
    beds: (b, r) => { const n = r ?? (b != null ? b + 1 : null); return n ? `شقة ${n} غرف` : 'شقة'; },
  },
  he: {
    community: [({ city }) => `דירות ב${city}`, ({ city }) => `נדל"ן ${city}`,
      ({ city }) => `ישראלים ב${city}`, ({ city }) => `קניית דירה ב${city}`, () => `נדל"ן גאורגיה`, ({ city }) => `השקעות נדל"ן ${city}`],
    sale: [
      ['WANT_BUY', ({ beds, place }) => `מחפש ${beds} לקנייה ב${place}`],
      ['LOOKING_FOR', ({ city }) => `רוצה לקנות דירה ב${city}`],
      ['TYPE_IN_PLACE', ({ beds, place }) => `${beds} ב${place}`],
      ['INVESTMENT', ({ city }) => `השקעה בנדל"ן ב${city}`],
    ],
    rent: [
      ['WANT_RENT', ({ beds, place }) => `מחפש ${beds} להשכרה ב${place}`],
      ['LOOKING_FOR', ({ city }) => `רוצה לשכור דירה ב${city}`],
      ['TYPE_IN_PLACE', ({ beds, place }) => `${beds} להשכרה ב${place}`],
      ['RELOCATING', ({ city }) => `רילוקיישן ל${city} דירה`],
    ],
    hashtag: () => '#נדלןבגאורגיה',
    typeWord: (t) => (t === 'HOUSE' ? 'בית' : 'דירה'),
    beds: (b, r) => { const n = r ?? (b != null ? b + 1 : null); return n ? `דירת ${n} חדרים` : 'דירה'; },
  },
  tr: {
    community: [({ city }) => `${city} emlak`, ({ city }) => `${city} kiralık satılık daire`,
      ({ city }) => `${city} satılık daire`, ({ city }) => `${city}'de yaşayan Türkler`, () => `Gürcistan emlak`, ({ city }) => `${city} yatırımlık daire`],
    sale: [
      ['WANT_BUY', ({ beds, place }) => `${place} satılık ${beds} arıyorum`],
      ['LOOKING_FOR', ({ city }) => `${city} daire almak istiyorum`],
      ['TYPE_IN_PLACE', ({ beds, place }) => `${place} satılık ${beds}`],
      ['INVESTMENT', ({ city }) => `${city} yatırımlık daire`],
    ],
    rent: [
      ['WANT_RENT', ({ beds, place }) => `${place} kiralık ${beds} arıyorum`],
      ['LOOKING_FOR', ({ city }) => `${city} kiralık ev arıyorum`],
      ['TYPE_IN_PLACE', ({ beds, place }) => `${place} kiralık ${beds}`],
      ['RELOCATING', ({ city }) => `${city} taşınıyorum ev`],
    ],
    hashtag: ({ city }) => `#${city.replace(/\s+/g, '').toLowerCase()}emlak`,
    typeWord: (t) => (t === 'HOUSE' ? 'müstakil ev' : 'daire'),
    /* Turkish writes rooms as bedrooms + living room: "2+1 daire". */
    beds: (b, r) => { const bd = b ?? (r != null && r > 1 ? r - 1 : null); return bd ? `${bd}+1 daire` : 'daire'; },
  },
};

/** Listing phrasing per language: the words an agency or owner uses to ADVERTISE. */
const LISTING: Record<SearchLanguage, { sale: T[]; rent: T[] }> = {
  ka: {
    sale: [({ beds, place }) => `იყიდება ${beds} ${place}`, ({ city }) => `იყიდება ბინა ${city}`],
    rent: [({ beds, place }) => `ქირავდება ${beds} ${place}`, ({ city }) => `ქირავდება ბინა ${city}`],
  },
  ru: {
    sale: [({ beds, place }) => `продается ${beds} ${place}`, ({ city }) => `продажа квартир ${city}`],
    rent: [({ beds, place }) => `сдается ${beds} ${place}`, ({ city }) => `аренда квартир ${city}`],
  },
  en: { sale: [({ beds, place }) => `${beds} for sale ${place}`], rent: [({ beds, place }) => `${beds} for rent ${place}`] },
  ar: { sale: [({ place }) => `شقة للبيع ${place}`], rent: [({ place }) => `شقة للإيجار ${place}`] },
  he: { sale: [({ place }) => `דירה למכירה ב${place}`], rent: [({ place }) => `דירה להשכרה ב${place}`] },
  tr: { sale: [({ place }) => `${place} satılık daire`], rent: [({ place }) => `${place} kiralık daire`] },
};

/** A non-apartment listing headline ("იყიდება საწყობი საბურთალოზე", "сдается склад Сабуртало"). */
type FL = (p: { nom: string; place: string }) => string;
const FAMILY_LISTING: Record<SearchLanguage, { sale: FL[]; rent: FL[] }> = {
  ka: { sale: [({ nom, place }) => `იყიდება ${nom} ${place}`], rent: [({ nom, place }) => `ქირავდება ${nom} ${place}`] },
  ru: { sale: [({ nom, place }) => `продается ${nom} ${place}`], rent: [({ nom, place }) => `сдается ${nom} ${place}`] },
  en: { sale: [({ nom, place }) => `${nom} for sale ${place}`], rent: [({ nom, place }) => `${nom} for rent ${place}`] },
  ar: { sale: [({ nom, place }) => `${nom} للبيع ${place}`], rent: [({ nom, place }) => `${nom} للإيجار ${place}`] },
  he: { sale: [({ nom, place }) => `${nom} למכירה ב${place}`], rent: [({ nom, place }) => `${nom} להשכרה ב${place}`] },
  tr: { sale: [({ nom, place }) => `${place} satılık ${nom}`], rent: [({ nom, place }) => `${place} kiralık ${nom}`] },
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
  const add = (language: SearchLanguage, kind: QueryKind, family: QueryFamily, query: string, tier?: SearchTier) => {
    const norm = normalizeQuery(query);
    if (!norm || norm.length < 3) return;
    const key = `${language}|${norm}`;
    const ck = `${language}|${kind}`;
    if (seen.has(key) || (counts.get(ck) ?? 0) >= PER_LANGUAGE_CAPS[kind]) return;
    seen.add(key);
    counts.set(ck, (counts.get(ck) ?? 0) + 1);
    out.push({ language, kind, family, query: query.trim(), ...(tier ? { tier } : {}) });
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
    /* Not an apartment: the family's own noun, not "ბინა" / "квартира" (2026-10-12). */
    const family = dna.family ?? propertyFamily(dna.propertyType);
    const noun = family === 'APARTMENT' ? null : propertyNoun(family, dna.subtype, lang);
    const params = { city, place, type: noun ?? t.typeWord(dna.propertyType), beds: noun ?? t.beds(dna.bedrooms, dna.rooms) };
    /* Groups where THIS family's market gathers: apartment groups never hold warehouse tenants. */
    if (noun) {
      const nom = propertyNom(family, dna.subtype, lang);
      for (const c of [`${FAMILY_MARKET[family][lang]} ${cityNames[0]}`, `${nom} ${cityNames[0]}`, REAL_ESTATE_IN[lang](cityNames[0]), FAMILY_MARKET[family][lang]]) add(lang, 'community', 'COMMUNITY', c);
    } else for (const c of t.community) add(lang, 'community', 'COMMUNITY', c({ ...params, city: cityNames[0] }));
    const own = strategy && strategy.transaction === dna.transaction ? strategy.queries.filter((q) => q.language === lang) : [];
    for (const q of own) add(lang, 'demand', q.persona === 'INVESTOR' ? 'INVESTMENT' : q.persona === 'RELOCATING' ? 'RELOCATING' : dna.transaction === 'RENT' ? 'WANT_RENT' : 'WANT_BUY', q.query, q.tier);
    /* No strategy phrase in this language. An apartment uses the language's own templates; any
       other property the family templates with its own noun — the apartment templates' persona
       lines ("ინვესტიცია ბინა", "переезжаю … квартира", "daire almak") never search for it. */
    if (!own.length && noun) {
      for (const f of (dna.transaction === 'RENT' ? FAMILY_RENT : FAMILY_BUY)[lang]) add(lang, 'demand', dna.transaction === 'RENT' ? 'WANT_RENT' : 'WANT_BUY', f({ noun, place, city }));
      add(lang, 'demand', 'TYPE_IN_PLACE', `${noun} ${place}`);
    } else if (!own.length) for (const [family, f] of dna.transaction === 'RENT' ? t.rent : t.sale) add(lang, 'demand', family, f(params));
    add(lang, 'hashtag', 'HASHTAG', t.hashtag({ cityLatin, city: cityNames[0] }));
    /* Comparable listings (their comments hold the buyers): this family's own headline. */
    if (noun) for (const f of dna.transaction === 'RENT' ? FAMILY_LISTING[lang].rent : FAMILY_LISTING[lang].sale) add(lang, 'listing', 'LISTING', f({ nom: propertyNom(family, dna.subtype, lang), place }));
    else for (const f of dna.transaction === 'RENT' ? LISTING[lang].rent : LISTING[lang].sale) add(lang, 'listing', 'LISTING', f(params));
  }
  return { version: QUERY_PLAN_VERSION, dnaKey: dna.dnaKey, languages: [...languages], queries: out };
}

/**
 * Merge model-proposed phrasings (structured output: {language, query}[]).
 * Only demand queries, only the six languages, deduplicated against the plan,
 * and still under the per-language cap (+2 for model phrasings).
 */
const TIERS: readonly SearchTier[] = ['EXACT', 'SEMANTIC', 'NEAR', 'SIZE', 'INVESTOR'];
export function mergeModelQueries(plan: QueryPlan, proposed: Array<{ language?: unknown; query?: unknown; tier?: unknown }>): QueryPlan {
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
    const tier = TIERS.find((t) => t === String(p?.tier ?? '').toUpperCase());
    queries.push({ language, kind: 'demand', family: 'MODEL', query, ...(tier ? { tier } : {}) });
  }
  return { ...plan, queries };
}

export function queriesFor(plan: QueryPlan, kind: QueryKind, language?: SearchLanguage): PlannedQuery[] {
  return plan.queries.filter((q) => q.kind === kind && (!language || q.language === language));
}
