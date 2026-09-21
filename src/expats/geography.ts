// HOMATCH FOR EXPATS — the places, and only the places that are real.
//
// WHY THE NAMES ARE HERE AND THE NUMBERS ARE NOT
//
// A district's name, its Georgian spelling and roughly where it sits in
// Tbilisi are stable geographic facts. They do not go out of date, they
// cannot be got wrong by a month's delay, and hard-coding them costs nobody
// anything. So they are here.
//
// Everything a foreigner actually wants to KNOW about a district — what rent
// costs there, what a square metre sells for, how many listings exist, how
// long the commute is — changes weekly and belongs to evidence, not to a
// constant. None of it is in this file. A district entry is a key into the
// real data, plus the handful of unchanging things needed to render the page
// before that data arrives.
//
// WHY THERE IS NO `vibe`, `score` OR `familyFriendly` FIELD
//
// §22 forbids invented lifestyle ratings, and the cheapest way to produce
// one is a field like this filled in by whoever wrote the file. There is no
// such field, so there is nowhere for an opinion to be stored as if it were
// a measurement. What a district is LIKE has to be said by sourced content
// or not said.
//
// THE GEORGIAN SPELLINGS MATTER OPERATIONALLY
//
// `nameKa` is not decoration. market_snapshots stores city and district in
// Georgian — production holds `თბილისი` / `ვაკე` — because that is what the
// portals publish. Matching a foreigner's "Vake" to the evidence requires
// this mapping, and getting it wrong means a district silently shows a
// coverage gap while its data sits in the table.

/** Cities with enough of a foreign-resident presence to be worth a page. */
export interface ExpatCity {
  /** Slug, and the URL segment. */
  key: string;
  nameEn: string;
  /** As Georgian sources spell it. Used to match evidence rows. */
  nameKa: string;
  /** Rough centre, for the map. Not a claim about anything. */
  lat: number;
  lon: number;
  /** i18n key for the one-line orientation shown under the name. */
  blurbKey: string;
}

export const EXPAT_CITIES: readonly ExpatCity[] = [
  {
    key: 'tbilisi',
    nameEn: 'Tbilisi',
    nameKa: 'თბილისი',
    lat: 41.7151,
    lon: 44.8271,
    blurbKey: 'expat_city_tbilisi_blurb',
  },
  {
    key: 'batumi',
    nameEn: 'Batumi',
    nameKa: 'ბათუმი',
    lat: 41.6168,
    lon: 41.6367,
    blurbKey: 'expat_city_batumi_blurb',
  },
  {
    key: 'kutaisi',
    nameEn: 'Kutaisi',
    nameKa: 'ქუთაისი',
    lat: 42.2679,
    lon: 42.6946,
    blurbKey: 'expat_city_kutaisi_blurb',
  },
] as const;

export function findCity(key: string | null | undefined): ExpatCity | null {
  if (!key) return null;
  const k = key.toLowerCase();
  return EXPAT_CITIES.find((c) => c.key === k) ?? null;
}

/**
 * The city's name as the reader's own language writes it.
 *
 * Georgian is the only one of the six with its own spelling of these, and
 * it is the one that was getting the Latin form: the two largest headings
 * on the Georgian page read "Tbilisi-ში". Everybody else writes the Latin
 * name, so everybody else keeps it.
 */
export function cityName(city: ExpatCity, lang: string): string {
  return lang === 'ka' ? city.nameKa : city.nameEn;
}

/**
 * A district inside a city.
 *
 * `nameKa` carries the name as the Georgian portals write it. `aliasesKa`
 * carries the other spellings the same district appears under — Georgian
 * declines its nouns, and a listing site writing `ვაკეში` ("in Vake") is
 * describing the district in `nameKa`. Without the aliases the evidence
 * lookup misses rows that are sitting right there.
 */
export interface ExpatDistrict {
  key: string;
  cityKey: string;
  nameEn: string;
  nameKa: string;
  aliasesKa: readonly string[];
  lat: number;
  lon: number;
}

/**
 * Tbilisi districts a foreigner is realistically choosing between.
 *
 * Not all 10 administrative raions: an administrative boundary is not a
 * place somebody lives in, and listing Didube next to Vake as equal options
 * would be padding a page rather than answering a question. These are the
 * areas that appear in foreign-resident housing searches.
 */
export const EXPAT_DISTRICTS: readonly ExpatDistrict[] = [
  {
    key: 'vake',
    cityKey: 'tbilisi',
    nameEn: 'Vake',
    nameKa: 'ვაკე',
    aliasesKa: ['ვაკეში', 'ვაკის'],
    lat: 41.7099,
    lon: 44.7549,
  },
  {
    key: 'saburtalo',
    cityKey: 'tbilisi',
    nameEn: 'Saburtalo',
    nameKa: 'საბურთალო',
    aliasesKa: ['საბურთალოზე', 'საბურთალოს'],
    lat: 41.7325,
    lon: 44.7473,
  },
  {
    key: 'vera',
    cityKey: 'tbilisi',
    nameEn: 'Vera',
    nameKa: 'ვერა',
    aliasesKa: ['ვერაზე', 'ვერის'],
    lat: 41.7076,
    lon: 44.7821,
  },
  {
    key: 'old-tbilisi',
    cityKey: 'tbilisi',
    nameEn: 'Old Tbilisi',
    nameKa: 'ძველი თბილისი',
    aliasesKa: ['ძველ თბილისში', 'ძველი ქალაქი'],
    lat: 41.6913,
    lon: 44.8073,
  },
  {
    key: 'krtsanisi',
    cityKey: 'tbilisi',
    nameEn: 'Krtsanisi',
    nameKa: 'კრწანისი',
    aliasesKa: ['კრწანისში', 'კრწანისის'],
    lat: 41.6759,
    lon: 44.8125,
  },
  {
    key: 'mtatsminda',
    cityKey: 'tbilisi',
    nameEn: 'Mtatsminda',
    nameKa: 'მთაწმინდა',
    aliasesKa: ['მთაწმინდაზე', 'მთაწმინდის'],
    lat: 41.6938,
    lon: 44.7889,
  },
  {
    key: 'isani',
    cityKey: 'tbilisi',
    nameEn: 'Isani',
    nameKa: 'ისანი',
    aliasesKa: ['ისანში', 'ისნის'],
    lat: 41.6839,
    lon: 44.8394,
  },
  {
    key: 'digomi',
    cityKey: 'tbilisi',
    nameEn: 'Digomi',
    nameKa: 'დიღომი',
    aliasesKa: ['დიღომში', 'დიდი დიღომი'],
    lat: 41.7789,
    lon: 44.7549,
  },
] as const;

export function districtsOf(cityKey: string): ExpatDistrict[] {
  return EXPAT_DISTRICTS.filter((d) => d.cityKey === cityKey);
}

export function findDistrict(key: string | null | undefined): ExpatDistrict | null {
  if (!key) return null;
  const k = key.toLowerCase();
  return EXPAT_DISTRICTS.find((d) => d.key === k) ?? null;
}

/**
 * Every Georgian spelling that should be treated as naming this district.
 *
 * Returned lower-cased and deduplicated so a caller can match without
 * thinking about it. Georgian has no letter case, so `toLowerCase` is a
 * no-op on the Georgian itself and is applied for the caller's benefit on
 * any Latin alias that is ever added.
 */
export function districtMatchTerms(d: ExpatDistrict): string[] {
  return [...new Set([d.nameKa, ...d.aliasesKa, d.nameEn].map((s) => s.toLowerCase()))];
}

/**
 * Does an evidence row's free-text district field name this district?
 *
 * Substring rather than equality, because the portals write
 * "ვაკე, ჭავჭავაძის გამზირი" as one field and an equality test would
 * silently drop it. The terms are distinctive enough that a substring
 * match does not collide — none of the district names above is a substring
 * of another, which `geography.test.mjs` asserts so a future addition
 * cannot quietly break it.
 */
export function districtMatches(d: ExpatDistrict, value: string | null | undefined): boolean {
  if (!value) return false;
  const haystack = value.toLowerCase();
  return districtMatchTerms(d).some((term) => haystack.includes(term));
}
