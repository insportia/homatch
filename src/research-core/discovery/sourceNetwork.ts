// HOMATCH RESEARCH CORE — THE SOURCE NETWORK A CAMPAIGN GROWS AND READS.
//
// Source discovery is the first stage of every Find Buyers / Find Tenants
// campaign: before any lead is looked for, the campaign searches for public
// communities about ITS property (city, deal) in every language HOMATCH is
// offered in, registers what it finds once for everyone, and audits it.
//
// Two facts this module owns, both pure and deterministic:
//   1. the discovery queries for a property — six site languages, the
//      property's own city and deal, rotated across campaigns so the network
//      keeps growing instead of re-running the same six searches;
//   2. which city a community is about, read from its name / the query that
//      found it — so a Tbilisi sale never spends its reads on Batumi rentals.

import { SEARCH_LANGUAGES, type SearchLanguage } from '../findBuyers/languages.ts';

/** The languages HOMATCH is offered in (= Find Buyers' search languages). Discovery always covers all of them. */
export const SITE_LANGUAGES = SEARCH_LANGUAGES;
export type SiteLanguage = SearchLanguage;

export type CityKey = 'TBILISI' | 'BATUMI' | 'KUTAISI' | 'RUSTAVI' | 'GUDAURI' | 'BAKURIANI' | 'KOBULETI';

/** How each city is written, per language (lower-case stems; inflections match by prefix). */
const CITY_NAMES: Record<CityKey, Record<SiteLanguage, string>> = {
  TBILISI:   { ka: 'თბილის', en: 'tbilisi', ru: 'тбилис', ar: 'تبليسي', he: 'טביליסי', tr: 'tiflis' },
  BATUMI:    { ka: 'ბათუმ',  en: 'batumi',  ru: 'батум',  ar: 'باتومي', he: 'בטומי',  tr: 'batum' },
  KUTAISI:   { ka: 'ქუთაის', en: 'kutaisi', ru: 'кутаис', ar: 'كوتايسي', he: 'קוטאיסי', tr: 'kutais' },
  RUSTAVI:   { ka: 'რუსთავ', en: 'rustavi', ru: 'рустав', ar: 'روستافي', he: 'רוסטאבי', tr: 'rustavi' },
  GUDAURI:   { ka: 'გუდაურ', en: 'gudauri', ru: 'гудаур', ar: 'غوداوري', he: 'גודאורי', tr: 'gudauri' },
  BAKURIANI: { ka: 'ბაკურიან', en: 'bakuriani', ru: 'бакуриан', ar: 'باكورياني', he: 'בקוריאני', tr: 'bakuriani' },
  KOBULETI:  { ka: 'ქობულეთ', en: 'kobuleti', ru: 'кобулет', ar: 'كوبوليتي', he: 'קובולטי', tr: 'kobuleti' },
};
/* Transliterations people use in channel usernames / titles. */
const CITY_EXTRA: Partial<Record<CityKey, string[]>> = {
  TBILISI: ['tbilisy', 'tbilissi', 'tiflis', 'tbilisskaya', 'tiblisi', 'tbs'],
  BATUMI: ['batumy', 'batum', 'batoumi'],
};

const CITY_KEYS = Object.keys(CITY_NAMES) as CityKey[];

/** The city key for a city value as HOMATCH stores it (any script), or null. */
export function cityKeyOf(city: string | null | undefined): CityKey | null {
  const v = String(city ?? '').trim().toLowerCase();
  if (!v) return null;
  for (const key of CITY_KEYS) {
    if (key.toLowerCase() === v) return key;
  }
  return citiesMentioned(v)[0] ?? null;
}

/** Every city a text (community name, username, query) names. */
export function citiesMentioned(text: string | null | undefined): CityKey[] {
  const t = String(text ?? '').toLowerCase();
  if (!t) return [];
  return CITY_KEYS.filter((key) => {
    const names = [...Object.values(CITY_NAMES[key]), ...(CITY_EXTRA[key] ?? [])];
    /* 'tbs' is only an abbreviation in a handle, never inside a word. */
    return names.some((n) => (n.length <= 3 ? new RegExp(`(^|[^a-z])${n}([^a-z]|$)`).test(t) : t.includes(n)));
  });
}

/**
 * How a community relates to a campaign's city:
 *   MATCH     names the campaign's city (alone or among others)
 *   NATIONAL  names no city (country-wide, or unknown) — still worth reading
 *   OTHER     names only other cities — never read for this campaign
 */
export type CityFit = 'MATCH' | 'NATIONAL' | 'OTHER';
export function communityCityFit(texts: Array<string | null | undefined>, campaignCity: string | null | undefined): CityFit {
  const want = cityKeyOf(campaignCity);
  const named = new Set(texts.flatMap((t) => citiesMentioned(t)));
  if (!named.size) return 'NATIONAL';
  if (want && named.has(want)) return 'MATCH';
  return want ? 'OTHER' : 'NATIONAL';
}

/* Deal words per language: how people name buy / rent communities. */
const DEAL_TERMS: Record<'SALE' | 'RENT', Record<SiteLanguage, string[]>> = {
  SALE: {
    ka: ['ბინების ყიდვა', 'უძრავი ქონება', 'იყიდება ბინა'],
    en: ['apartments for sale', 'real estate', 'buy apartment'],
    ru: ['купить квартиру', 'недвижимость', 'продажа квартир'],
    ar: ['شقق للبيع', 'عقارات'],
    he: ['דירות למכירה', 'נדל"ן'],
    tr: ['satılık daire', 'emlak'],
  },
  RENT: {
    ka: ['ბინების ქირაობა', 'ქირავდება ბინა', 'ბინა ქირით'],
    en: ['apartments for rent', 'rent apartment', 'flat rent'],
    ru: ['аренда квартир', 'снять квартиру', 'сдам квартиру'],
    ar: ['شقق للإيجار', 'إيجار شقق'],
    he: ['דירות להשכרה', 'השכרת דירות'],
    tr: ['kiralık daire', 'kiralık ev'],
  },
};
/* Country-wide fall-backs, for a city with no localized name here. */
const COUNTRY_NAMES: Record<SiteLanguage, string> = { ka: 'საქართველო', en: 'georgia', ru: 'грузия', ar: 'جورجيا', he: 'גאורגיה', tr: 'gürcistan' };
/* Relocation / expat communities carry real demand from abroad. */
const RELOCATION: Record<SiteLanguage, string> = { ka: 'ემიგრანტები საქართველოში', en: 'expats georgia', ru: 'релокация грузия', ar: 'العرب في جورجيا', he: 'ישראלים בגאורגיה', tr: 'gürcistan türkler' };

export interface CampaignSourceQuery { language: SiteLanguage; query: string; kind: 'CITY_DEAL' | 'CITY' | 'COUNTRY' | 'RELOCATION' }

/**
 * The discovery searches for one property: every site language, the
 * property's city and deal first. ROUND-ROBIN by language, so any cap still
 * covers all six languages (the old fixed list ran ka/ru only: its first six
 * entries). `rotation` shifts the start inside each language's list so the
 * next campaign on the same market searches different phrases.
 */
export function campaignSourceQueries(input: {
  city: string | null | undefined;
  transaction: 'SALE' | 'RENT' | string | null | undefined;
  rotation?: number;
  /** The owner's chosen languages; absent or empty means every site language. */
  languages?: readonly string[] | null;
}): CampaignSourceQuery[] {
  const cityKey = cityKeyOf(input.city);
  const deal: 'SALE' | 'RENT' = String(input.transaction ?? '').toUpperCase().includes('RENT') ? 'RENT' : 'SALE';
  const chosen = new Set((input.languages ?? []).map((l) => String(l).toLowerCase()));
  const languages = chosen.size ? SITE_LANGUAGES.filter((l) => chosen.has(l)) : [...SITE_LANGUAGES];
  const perLanguage = languages.map((language) => {
    const place = cityKey ? CITY_NAMES[cityKey][language] : COUNTRY_NAMES[language];
    const placeWord = cityKey ? cityWord(cityKey, language) : place;
    const list: CampaignSourceQuery[] = [
      ...DEAL_TERMS[deal][language].map((term) => ({ language, query: `${term} ${placeWord}`, kind: (cityKey ? 'CITY_DEAL' : 'COUNTRY') as CampaignSourceQuery['kind'] })),
      ...(cityKey ? [{ language, query: placeWord, kind: 'CITY' as const }] : []),
      { language, query: `${DEAL_TERMS[deal][language][0]} ${COUNTRY_NAMES[language]}`, kind: 'COUNTRY' },
      { language, query: RELOCATION[language], kind: 'RELOCATION' },
    ];
    const seen = new Set<string>();
    const unique = list.filter((q) => { const k = q.query.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
    const shift = unique.length ? Math.abs(Math.trunc(input.rotation ?? 0)) % unique.length : 0;
    return [...unique.slice(shift), ...unique.slice(0, shift)];
  });
  const out: CampaignSourceQuery[] = [];
  for (let i = 0; perLanguage.some((l) => i < l.length); i += 1) {
    for (const list of perLanguage) if (i < list.length) out.push(list[i]);
  }
  return out;
}

/** A searchable form of the city name (full word where the stem is not one). */
function cityWord(key: CityKey, language: SiteLanguage): string {
  const full: Partial<Record<CityKey, Partial<Record<SiteLanguage, string>>>> = {
    TBILISI: { ka: 'თბილისი', ru: 'тбилиси' },
    BATUMI: { ka: 'ბათუმი', ru: 'батуми' },
    KUTAISI: { ka: 'ქუთაისი', ru: 'кутаиси' },
    RUSTAVI: { ka: 'რუსთავი', ru: 'рустави' },
    GUDAURI: { ka: 'გუდაური', ru: 'гудаури' },
    BAKURIANI: { ka: 'ბაკურიანი', ru: 'бакуриани' },
    KOBULETI: { ka: 'ქობულეთი', ru: 'кобулети' },
  };
  return full[key]?.[language] ?? CITY_NAMES[key][language];
}

/**
 * A community's fit: its own name and handle decide; the search that found it
 * counts only when the name names no city (a "Batumi apartments" channel found
 * by a Tbilisi search is still a Batumi channel).
 */
export function communityFitFor(
  row: { name?: string | null; external_id?: string | null; metadata?: Record<string, unknown> | null },
  campaignCity: string | null | undefined,
): CityFit {
  const own = communityCityFit([row.name, row.external_id], campaignCity);
  if (own !== 'NATIONAL') return own;
  const query = (row.metadata?.discovered_query as string | undefined) ?? null;
  return query ? communityCityFit([query], campaignCity) : own;
}

/**
 * Order communities for a campaign read: the campaign's city first, then
 * country-wide; another city's communities are dropped. Within a fit,
 * least-recently-read first (stable).
 */
export function rankCommunitiesForCampaign<T extends { name?: string | null; external_id?: string | null; metadata?: Record<string, unknown> | null; last_checked_at?: string | null }>(
  rows: readonly T[],
  campaignCity: string | null | undefined,
): Array<T & { cityFit: CityFit }> {
  const order: Record<CityFit, number> = { MATCH: 0, NATIONAL: 1, OTHER: 2 };
  return rows
    .map((r) => ({ ...r, cityFit: communityFitFor(r, campaignCity) }))
    .filter((r) => r.cityFit !== 'OTHER')
    .sort((a, b) => order[a.cityFit] - order[b.cityFit]
      || (Date.parse(a.last_checked_at ?? '') || 0) - (Date.parse(b.last_checked_at ?? '') || 0));
}
