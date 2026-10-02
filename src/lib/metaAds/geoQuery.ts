// META ADS — LOCATION SEARCH IN THE CUSTOMER'S OWN LANGUAGE. Pure.
//
// Meta's targeting catalogue (/search?type=adgeolocation) is searched with
// what the customer typed, in their own locale; when that finds nothing, the
// same words are asked again transliterated to Latin (Georgian and Cyrillic
// script), because Meta's catalogue spells many Georgian places in Latin. No
// city table, no invented ids: every result is a key Meta issued.
//
// Meta targets countries, regions, cities and neighbourhoods — not streets.
// A query that names a street is recognised, so the builder can say so and
// offer the precise tool (a pin and a radius) instead of an empty list.

export type UiLang = 'en' | 'ka' | 'ru' | 'tr' | 'ar' | 'he';

/** Meta's locale for each HOMATCH interface language (Meta locales are lang_REGION). */
export const META_LOCALES: Record<UiLang, string> = { en: 'en_US', ka: 'ka_GE', ru: 'ru_RU', tr: 'tr_TR', ar: 'ar_AR', he: 'he_IL' };

export function metaLocale(lang: string): string {
  return META_LOCALES[(String(lang).slice(0, 2).toLowerCase() as UiLang)] ?? 'en_US';
}

/* Georgian (Mkhedruli) → national romanisation; Cyrillic → a plain Latin form. */
const KA: Record<string, string> = {
  ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 't', ი: 'i', კ: 'k', ლ: 'l', მ: 'm', ნ: 'n', ო: 'o', პ: 'p',
  ჟ: 'zh', რ: 'r', ს: 's', ტ: 't', უ: 'u', ფ: 'p', ქ: 'k', ღ: 'gh', ყ: 'q', შ: 'sh', ჩ: 'ch', ც: 'ts', ძ: 'dz', წ: 'ts',
  ჭ: 'ch', ხ: 'kh', ჯ: 'j', ჰ: 'h',
};
const RU: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n',
  о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

export function transliterate(text: string): string {
  return [...String(text ?? '')].map((ch) => {
    const lower = ch.toLowerCase();
    const t = KA[ch] ?? RU[lower];
    if (t === undefined) return ch;
    return ch !== lower && t ? t[0].toUpperCase() + t.slice(1) : t;
  }).join('');
}

const NON_LATIN = /[Ⴀ-ჿЀ-ӿ]/;

/* Words that only add noise to a place name ("city", "district" …), in six languages. */
const NOISE = /(^|\s)(city|town|district|municipality|ქალაქი|რაიონი|უბანი|город|г\.|район|şehir|ilçe|مدينة|حي|עיר|שכונה)(?=\s|$)/giu;

/* A street, avenue or address — something Meta's catalogue does not target by name. */
const STREET = /(^|\s)(street|st\.|avenue|ave\.|ave|road|rd\.|boulevard|blvd|lane|ქუჩა|ქ\.|გამზირი|გამზ\.|შესახვევი|ჩიხი|улица|ул\.|проспект|пр-т|просп\.|переулок|бульвар|sokak|sokağı|caddesi|cadde|bulvarı|شارع|طريق|רחוב|שדרות)(?=\s|$)|\d+[a-z]?\s*$/iu;

export function looksLikeStreet(q: string): boolean {
  return STREET.test(String(q ?? '').trim());
}

/** What to ask Meta, in order: the words as typed, then (non-Latin) the Latin spelling. */
export function queryVariants(q: string): string[] {
  const clean = String(q ?? '').replace(NOISE, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!clean) return [];
  const out = [clean];
  if (NON_LATIN.test(clean)) {
    const latin = transliterate(clean).replace(/\s+/g, ' ').trim();
    if (latin && latin.toLowerCase() !== clean.toLowerCase()) out.push(latin);
  }
  return out;
}

/** Country names in all six interface languages + English, so any of them finds the country. */
export function countryNameMatches(code: string, needle: string, langs: readonly string[] = ['en', 'ka', 'ru', 'tr', 'ar', 'he']): boolean {
  const n = String(needle ?? '').trim().toLowerCase();
  if (!n) return true;
  if (code.toLowerCase() === n) return true;
  const latin = NON_LATIN.test(n) ? transliterate(n) : null;
  for (const l of langs) {
    let name = '';
    try { name = new Intl.DisplayNames([l], { type: 'region' }).of(code) ?? ''; } catch { /* runtime without this locale */ }
    const low = name.toLowerCase();
    if (low && (low.includes(n) || (latin && low.includes(latin)))) return true;
  }
  return false;
}

/** Meta's location types the builder searches, per tab. */
export const SEARCH_TYPES = {
  place: ['city', 'neighborhood', 'subcity'],
  region: ['region'],
} as const;

/** Meta's result type → the builder's location type (subcity and neighbourhood target the same way). */
export function locationTypeOf(metaType: string): 'city' | 'region' | 'neighborhood' {
  if (metaType === 'region') return 'region';
  if (metaType === 'neighborhood' || metaType === 'subcity') return 'neighborhood';
  return 'city';
}
