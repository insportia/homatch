/*
 * ONE PROPERTY, MANY QUESTIONS — THE DISCOVERY PLAN.
 *
 * The Villion run asked the market one question and got 37 answers, none of
 * them from the building and none from the street. That is not a source
 * problem alone: a single formulation of a single query in a single language
 * cannot find a small development, because the words a seller uses for it vary
 * more than the building does.
 *
 * „Villion" is also Вилион and ვილიონ. The street is კრწანისის ქუჩა, Krtsanisi
 * Street and улица Крцаниси. The developer is „მილენიო გრუპი" and Millenio
 * Group. A listing for this exact flat may carry any one of those and none of
 * the others — and the Tbilisi market is advertised to Russian-, English-,
 * Arabic- and Hebrew-speaking buyers on different sites, in different scripts.
 *
 * So this module turns ONE subject into a RANKED SET of queries.
 *
 * ── LANGUAGE IS A DISCOVERY MECHANISM, NOT A FACT ────────────────────
 *
 * Searching in Russian finds listings written in Russian. It says nothing
 * about who owns the flat, who lives in the building, or who the seller
 * expects to buy it. Nothing downstream may read a listing's language as
 * evidence about the property or its market, and nothing here records it as
 * anything other than which query found the result.
 *
 * ── RANK IS ABOUT PRECISION, NOT ABOUT LIKELIHOOD OF A HIT ───────────
 *
 * The narrowest queries run first because their results are worth the most: a
 * listing found by "Villion Krtsanisi 6" describes this building, while one
 * found by "apartment Tbilisi" describes the city. A budget that runs out
 * should run out on the queries whose answers were going to be context.
 */

/** Which script/locale a formulation is written in. Discovery only. */
export type QueryLanguage = 'ka' | 'en' | 'ru' | 'tr' | 'ar' | 'he';

/** How precisely a formulation addresses the subject. Lower is narrower. */
export type QueryPrecision =
  | 'BUILDING'      // names the project or the exact address
  | 'STREET'        // names the street, with or without a number
  | 'MICROLOCATION' // names the immediate area
  | 'DEVELOPER'     // names the company behind it
  | 'DISTRICT'      // names the district only
  | 'CITY';         // the open market

export interface DiscoveryQuery {
  /** The text to ask a source for. */
  text: string;
  language: QueryLanguage;
  precision: QueryPrecision;
  /** Stable id for dedup and for the acceptance report. */
  key: string;
}

export interface DiscoverySubject {
  project?: string | null;
  street?: string | null;
  streetNumber?: string | null;
  district?: string | null;
  city?: string | null;
  developer?: string | null;
}

const clean = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/**
 * Transliterations a Georgian development is actually advertised under.
 *
 * Deliberately a small, explicit table rather than a general transliterator: a
 * generated romanisation produces strings nobody writes ("k'rts'anisi"), and a
 * query nobody writes finds nothing. These are the forms that appear on the
 * portals.
 */
const TRANSLITERATION: Record<string, string[]> = {
  კრწანისი: ['Krtsanisi', 'Крцаниси'],
  ვაკე: ['Vake', 'Ваке'],
  საბურთალო: ['Saburtalo', 'Сабуртало'],
  ისანი: ['Isani', 'Исани'],
  დიდუბე: ['Didube', 'Дидубе'],
  გლდანი: ['Gldani', 'Глдани'],
  ორთაჭალა: ['Ortachala', 'Ортачала'],
  თბილისი: ['Tbilisi', 'Тбилиси'],
};

/** Every written form of a place name, including the one we were given. */
export function nameVariants(name: string): string[] {
  const base = clean(name);
  if (!base) return [];
  const out = [base];
  for (const [ka, forms] of Object.entries(TRANSLITERATION)) {
    if (!base.includes(ka)) continue;
    for (const form of forms) {
      /*
       * THE GENITIVE SUFFIX HAS TO GO WITH THE WORD IT BELONGS TO.
       *
       * Georgian inflects: the street is „კრწანისის ქუჩა" — „კრწანისი" plus
       * the genitive „ს". Replacing the stem alone produced „Krtsanisiს 6",
       * a string in two alphabets that no portal has ever indexed. Caught by
       * the discovery probe's own output, which is what it is for.
       *
       * Georgian case endings are single characters and never carry meaning
       * once the stem is romanised, so the suffix is dropped with the stem.
       */
      out.push(base.replace(new RegExp(`${ka}[ა-ჰ]?`, 'u'), form));
    }
  }
  // A bare Latin project name is already its own variant.
  return [...new Set(out)];
}

const WORD_FOR_STREET: Record<QueryLanguage, string> = {
  ka: 'ქუჩა', en: 'street', ru: 'улица', tr: 'sokak', ar: 'شارع', he: 'רחוב',
};
const WORD_FOR_SALE: Record<QueryLanguage, string> = {
  ka: 'იყიდება ბინა', en: 'apartment for sale', ru: 'продажа квартиры',
  tr: 'satılık daire', ar: 'شقة للبيع', he: 'דירה למכירה',
};

/**
 * The languages worth asking in.
 *
 * ka/en/ru always: the Georgian market is advertised in all three and the
 * portals serve all three. tr/ar/he only when explicitly requested, because
 * they reach international-facing inventory that the local portals do not
 * carry, and asking them by default spends budget for little.
 */
export const CORE_LANGUAGES: readonly QueryLanguage[] = ['ka', 'en', 'ru'];
export const INTERNATIONAL_LANGUAGES: readonly QueryLanguage[] = ['tr', 'ar', 'he'];

/**
 * Builds the ranked query set for one subject.
 *
 * Deterministic: the same subject produces the same plan in the same order,
 * which is what makes a discovery run reproducible and an acceptance count
 * meaningful.
 */
export function buildDiscoveryPlan(
  subject: DiscoverySubject,
  opts: { languages?: readonly QueryLanguage[]; international?: boolean } = {}
): DiscoveryQuery[] {
  const languages = opts.languages
    ?? (opts.international ? [...CORE_LANGUAGES, ...INTERNATIONAL_LANGUAGES] : CORE_LANGUAGES);

  const project = clean(subject.project);
  const street = clean(subject.street);
  const number = clean(subject.streetNumber);
  const district = clean(subject.district);
  const city = clean(subject.city);
  const developer = clean(subject.developer);

  const out: DiscoveryQuery[] = [];
  const push = (text: string, language: QueryLanguage, precision: QueryPrecision) => {
    const t = text.replace(/\s{2,}/g, ' ').trim();
    if (!t) return;
    const key = `${precision}:${language}:${t.toLocaleLowerCase()}`;
    if (out.some((q) => q.key === key)) return;
    out.push({ text: t, language, precision, key });
  };

  for (const language of languages) {
    // BUILDING — the project by every name it is sold under, with the address.
    for (const p of nameVariants(project)) {
      push(p, language, 'BUILDING');
      if (street) {
        for (const s of nameVariants(street)) push(`${p} ${s} ${number}`, language, 'BUILDING');
      }
    }
    // STREET — with and without the number, since sellers omit it.
    for (const s of nameVariants(street)) {
      if (number) push(`${s} ${WORD_FOR_STREET[language]} ${number}`, language, 'STREET');
      push(`${s} ${WORD_FOR_STREET[language]} ${WORD_FOR_SALE[language]}`, language, 'STREET');
    }
    // MICROLOCATION / DISTRICT.
    for (const d of nameVariants(district)) {
      push(`${d} ${WORD_FOR_SALE[language]}`, language, 'MICROLOCATION');
      if (city) {
        for (const c of nameVariants(city)) push(`${d} ${c}`, language, 'DISTRICT');
      }
    }
    // DEVELOPER — finds the company's other inventory, which is its own signal.
    for (const dev of nameVariants(developer)) push(dev, language, 'DEVELOPER');
    // CITY — context of last resort.
    for (const c of nameVariants(city)) push(`${c} ${WORD_FOR_SALE[language]}`, language, 'CITY');
  }

  return out.sort((a, b) => PRECISION_RANK[a.precision] - PRECISION_RANK[b.precision]);
}

const PRECISION_RANK: Record<QueryPrecision, number> = {
  BUILDING: 0, STREET: 1, MICROLOCATION: 2, DEVELOPER: 3, DISTRICT: 4, CITY: 5,
};

/** Queries narrow enough that their results describe this property. */
export function localQueries(plan: DiscoveryQuery[]): DiscoveryQuery[] {
  return plan.filter((q) => PRECISION_RANK[q.precision] <= PRECISION_RANK.MICROLOCATION);
}
