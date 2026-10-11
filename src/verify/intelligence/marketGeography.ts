// HOMATCH Verify — which Tbilisi neighbourhood a comparable is in, and which
// neighbourhoods are next to each other.
//
// WHY THIS EXISTS (production job 220ed087, Villion Krtsanisi Homes)
//
// The report headlined "$928–3,000/m², 39 PEER_PROJECT listings" for a
// building on Krtsanisi St. in Ortachala. Those 39 listings were in
// Saburtalo, Navtlughi, Didi Dighomi and Didube. Nothing tested WHERE a
// "peer" development was; carrying a project name was enough. A comparable
// development has to be in the same or an ADJACENT neighbourhood before it may
// describe this property's price — everything else is city background.
//
// WHAT THIS IS, AND WHAT IT IS NOT
//
//   - A canonical key per neighbourhood, recognised in Georgian, Latin and
//     Russian, with Georgian case endings ("ვაკეში", "კრწანისის").
//   - A deliberately SMALL adjacency map covering the Old Tbilisi cluster
//     (Old Tbilisi, Krtsanisi, Ortachala, Sololaki, Mtatsminda, Vera, Vake,
//     Avlabari, Chughureti) plus a few well-known pairs elsewhere. A pair that
//     is not listed is NOT adjacent: unknown geography reduces confidence, it
//     never counts as a match.
//   - A street NAMED after a neighbourhood ("კრწანისის ქუჩა", "Krtsanisi St")
//     is only a weak hint: it is used for the subject when nothing better is
//     known, and it is reported as such.
//
// Pure: no clock, no network.

export type AreaKey =
  | 'OLD_TBILISI' | 'KRTSANISI' | 'ORTACHALA' | 'SOLOLAKI' | 'MTATSMINDA'
  | 'VERA' | 'VAKE' | 'AVLABARI' | 'CHUGHURETI' | 'ISANI' | 'SABURTALO'
  | 'DIDUBE' | 'DIDI_DIGHOMI' | 'DIGHOMI' | 'VASHLIJVARI' | 'NADZALADEVI'
  | 'GLDANI' | 'SAMGORI' | 'NAVTLUGHI' | 'LISI' | 'BAGEBI' | 'VARKETILI'
  /* 2026-10-11 v6 (job eeefada9, Digomi): portals file the Digomi massif apart from Digomi 1-9. */
  | 'DIGHOMI_MASSIVE';

/** Longest/most specific aliases first within each area; areas are tried in this order. */
const AREA_ALIASES: ReadonlyArray<readonly [AreaKey, readonly string[]]> = [
  ['DIDI_DIGHOMI', ['დიდი დიღომი', 'didi dighomi', 'didi digomi', 'диди дигоми']],
  ['DIGHOMI_MASSIVE', ['დიღმის მასივი', 'dighomi massive', 'digomi massive', 'dighomi massif', 'дигомский массив']],
  ['OLD_TBILISI', ['ძველი თბილისი', 'old tbilisi', 'старый тбилиси', 'აბანოთუბანი', 'abanotubani', 'მეტეხი', 'metekhi']],
  ['KRTSANISI', ['კრწანისი', 'krtsanisi', 'крцаниси']],
  ['ORTACHALA', ['ორთაჭალა', 'ortachala', 'ortatchala', 'орточала', 'ортачала']],
  ['SOLOLAKI', ['სოლოლაკი', 'sololaki', 'сололаки']],
  ['MTATSMINDA', ['მთაწმინდა', 'mtatsminda', 'мтацминда']],
  ['VERA', ['ვერა', 'vera', 'вера']],
  ['VAKE', ['ვაკე', 'vake', 'ваке']],
  ['AVLABARI', ['ავლაბარი', 'avlabari', 'авлабари']],
  ['CHUGHURETI', ['ჩუღურეთი', 'chughureti', 'chugureti', 'чугурети']],
  ['ISANI', ['ისანი', 'isani', 'исани']],
  ['SABURTALO', ['საბურთალო', 'saburtalo', 'сабуртало']],
  ['DIDUBE', ['დიდუბე', 'didube', 'дидубе']],
  ['DIGHOMI', ['დიღომი', 'dighomi', 'digomi', 'дигоми']],
  ['VASHLIJVARI', ['ვაშლიჯვარი', 'vashlijvari', 'вашлиджвари']],
  ['NADZALADEVI', ['ნაძალადევი', 'nadzaladevi', 'надзаладеви']],
  ['GLDANI', ['გლდანი', 'gldani', 'глдани']],
  ['SAMGORI', ['სამგორი', 'samgori', 'самгори']],
  ['NAVTLUGHI', ['ნავთლუღი', 'navtlughi', 'navtlugi', 'навтлуги']],
  ['LISI', ['ლისი', 'lisi', 'лиси']],
  ['BAGEBI', ['ბაგები', 'bagebi', 'багеби']],
  ['VARKETILI', ['ვარკეთილი', 'varketili', 'варкетили']],
];

/*
 * ADJACENCY — small on purpose, and symmetric by construction.
 *
 * Old Tbilisi cluster (the case that broke): Krtsanisi and Ortachala sit on
 * the right bank south of the old town; Sololaki and Mtatsminda rise behind
 * it; Vera and Vake continue west. Avlabari and Chughureti face it across the
 * Mtkvari. Outside the cluster only pairs that genuinely share a border and a
 * housing market are listed. Anything not here is "not adjacent".
 */
const ADJACENT_PAIRS: ReadonlyArray<readonly [AreaKey, AreaKey]> = [
  ['KRTSANISI', 'ORTACHALA'],
  ['KRTSANISI', 'OLD_TBILISI'],
  ['KRTSANISI', 'SOLOLAKI'],
  ['KRTSANISI', 'MTATSMINDA'],
  ['ORTACHALA', 'OLD_TBILISI'],
  ['OLD_TBILISI', 'SOLOLAKI'],
  ['OLD_TBILISI', 'MTATSMINDA'],
  ['OLD_TBILISI', 'AVLABARI'],
  ['OLD_TBILISI', 'CHUGHURETI'],
  ['SOLOLAKI', 'MTATSMINDA'],
  ['SOLOLAKI', 'VERA'],
  ['MTATSMINDA', 'VERA'],
  ['MTATSMINDA', 'VAKE'],
  ['VERA', 'VAKE'],
  ['VERA', 'CHUGHURETI'],
  ['VAKE', 'SABURTALO'],
  ['VAKE', 'LISI'],
  ['SABURTALO', 'LISI'],
  ['SABURTALO', 'VASHLIJVARI'],
  ['SABURTALO', 'DIDUBE'],
  ['DIDUBE', 'DIGHOMI'],
  ['DIGHOMI', 'DIDI_DIGHOMI'],
  ['DIGHOMI', 'DIGHOMI_MASSIVE'],
  ['DIDI_DIGHOMI', 'DIGHOMI_MASSIVE'],
  ['AVLABARI', 'ISANI'],
  ['ISANI', 'SAMGORI'],
  ['ISANI', 'NAVTLUGHI'],
  ['SAMGORI', 'NAVTLUGHI'],
  ['SAMGORI', 'VARKETILI'],
  ['GLDANI', 'NADZALADEVI'],
  ['DIDUBE', 'NADZALADEVI'],
];

const ADJ = new Map<AreaKey, Set<AreaKey>>();
for (const [a, b] of ADJACENT_PAIRS) {
  if (!ADJ.has(a)) ADJ.set(a, new Set());
  if (!ADJ.has(b)) ADJ.set(b, new Set());
  ADJ.get(a)!.add(b);
  ADJ.get(b)!.add(a);
}

/** The Georgian display name of an area key (its first alias), for callers that store a name. */
export function areaName(key: AreaKey | null | undefined): string | undefined {
  return key ? AREA_ALIASES.find(([k]) => k === key)?.[1][0] : undefined;
}

export function areAdjacent(a: AreaKey | null | undefined, b: AreaKey | null | undefined): boolean {
  if (!a || !b || a === b) return false;
  return ADJ.get(a)?.has(b) ?? false;
}

/** Georgian letters, Latin letters and Cyrillic letters: what counts as "inside a word". */
const GEO = '\\u10D0-\\u10FF';
const LAT = 'a-z';
const CYR = '\\u0430-\\u044f\\u0451';

/** A street word right after a place name means the place is the street's NAME. */
const STREET_AFTER = /^\s*(?:ქ\.|ქ\s|ქუჩ|გამზ|ჩიხ|გზატკ|გზა|ხეივ|შესახვ|st\b|st\.|str\b|str\.|street|ave\b|avenue|road|rd\b|lane|ул\b|ул\.|улиц|проспект|пр-т)/;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function scriptOf(alias: string): 'GEO' | 'LAT' | 'CYR' {
  if (/[ა-ჿ]/.test(alias)) return 'GEO';
  if (/[а-яё]/.test(alias)) return 'CYR';
  return 'LAT';
}

/*
 * Georgian declines place names. The suffixes allowed after an alias are the
 * ordinary case endings that appear in listing text ("ვაკეში", "ვაკეზე",
 * "კრწანისის"), and nothing else — so "ვერა" never matches inside "ვერანდა".
 */
const SUFFIX: Record<'GEO' | 'LAT' | 'CYR', string> = {
  GEO: '(?:ში|ზე|ის|ს|თან|დან|ელი|ელ)?',
  LAT: '(?:s)?',
  CYR: '(?:е|а|у)?',
};
const LETTERS: Record<'GEO' | 'LAT' | 'CYR', string> = { GEO, LAT, CYR };

const MATCHERS = AREA_ALIASES.flatMap(([key, aliases]) =>
  aliases.map((alias) => {
    const s = scriptOf(alias);
    return {
      key,
      re: new RegExp(`(^|[^${LETTERS[s]}])${escape(alias)}${SUFFIX[s]}(?![${LETTERS[s]}])`, 'gu'),
    };
  }),
);

export interface AreaMatch {
  area: AreaKey;
  /** True when the only mention is a street NAMED after the area. */
  viaStreetName: boolean;
}

/**
 * The neighbourhood a free-text address or district names, or null.
 *
 * A standalone mention ("Krtsanisi, Ortachala Rd 4", "ორთაჭალა") wins over a
 * street that merely carries a neighbourhood's name ("კრწანისის ქუჩა 6"). The
 * latter is returned only when nothing else is present, flagged as such.
 */
export function areaOf(text: unknown): AreaMatch | null {
  const t = typeof text === 'string' ? text.toLowerCase() : '';
  if (!t.trim()) return null;
  let streetOnly: AreaMatch | null = null;
  let best: { area: AreaKey; at: number } | null = null;
  for (const { key, re } of MATCHERS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(t))) {
      const end = m.index + m[0].length;
      const at = m.index + m[1].length;
      if (STREET_AFTER.test(t.slice(end))) {
        if (!streetOnly) streetOnly = { area: key, viaStreetName: true };
        continue;
      }
      // Earliest standalone mention wins: addresses run narrow → wide
      // ("street, neighbourhood, district, city").
      if (!best || at < best.at) best = { area: key, at };
      break;
    }
  }
  if (best) return { area: best.area, viaStreetName: false };
  return streetOnly;
}

/** The first area any of the given texts resolves to, preferring standalone mentions. */
export function firstAreaOf(...texts: unknown[]): AreaMatch | null {
  let fallback: AreaMatch | null = null;
  for (const t of texts) {
    const m = areaOf(t);
    if (m && !m.viaStreetName) return m;
    if (m && !fallback) fallback = m;
  }
  return fallback;
}

/* ------------------------------------------------------------------ *
 * Streets (2026-10-11 location hierarchy, job 8ba97da9)               *
 * ------------------------------------------------------------------ */

/*
 * WHY STREETS ARE PARSED, NOT COMPARED AS WHOLE ADDRESSES.
 *
 * The subject was "თბილისი, კრწანისის ქ. 6" and two listings were
 * "კრწანისის ქ., ორთაჭალა, თბილისი". The old test normalised BOTH WHOLE
 * ADDRESSES and compared them for equality, so the city/district tail and
 * its order decided the answer — and `\b` never matches next to a Georgian
 * letter, so "ქ" was not even stripped. Two listings on the subject's own
 * street fell to WIDER_MARKET beside Didi Dighomi.
 *
 * The registry also spells the street "ქრწანისის" (ქ for კ). Both letters
 * transliterate to "k", so the stem comparison below is spelling-tolerant
 * by construction.
 */

export type StreetKind = 'STREET' | 'AVENUE' | 'LANE' | 'DEAD_END' | 'OTHER';

export interface StreetRef {
  /** Transliterated, case ending removed: "კრწანისის" / "Krtsanisi" / "ქრწანისის" → "krtsanis". */
  stem: string;
  /** The street words as written (lower-case), e.g. "კრწანისის მეორე". */
  name: string;
  kind: StreetKind;
  /** House number when stated ("6", "12ა"). */
  number: string | null;
}

const STREET_TRANSLIT: Record<string, string> = {
  ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 't', ი: 'i',
  კ: 'k', ლ: 'l', მ: 'm', ნ: 'n', ო: 'o', პ: 'p', ჟ: 'zh', რ: 'r', ს: 's',
  ტ: 't', უ: 'u', ფ: 'p', ქ: 'k', ღ: 'g', ყ: 'k', შ: 'sh', ჩ: 'ch', ც: 'ts',
  ძ: 'dz', წ: 'ts', ჭ: 'ch', ხ: 'kh', ჯ: 'j', ჰ: 'h',
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'p',
  х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sh', ы: 'i', э: 'e', ю: 'iu', я: 'ia', ъ: '', ь: '',
};

/** Georgian marker words AFTER the name ("კრწანისის ქ. 6"), Latin likewise ("Krtsanisi St. 6"). */
const MARKER_AFTER: ReadonlyArray<readonly [RegExp, StreetKind]> = [
  [/^(?:ქუჩა|ქუჩის|ქუჩაზე|ქ\.?)$/u, 'STREET'],
  [/^(?:გამზირი|გამზ\.?)$/u, 'AVENUE'],
  [/^(?:შესახვევი|შეს\.?)$/u, 'LANE'],
  [/^(?:ჩიხი)$/u, 'DEAD_END'],
  [/^(?:ხეივანი|აღმართი|სანაპირო|დაღმართი)$/u, 'OTHER'],
  [/^(?:st\.?|str\.?|street)$/u, 'STREET'],
  [/^(?:ave\.?|avenue)$/u, 'AVENUE'],
  [/^(?:lane|ln\.?)$/u, 'LANE'],
  [/^(?:rd\.?|road)$/u, 'OTHER'],
];
/** Russian puts the marker BEFORE the name ("ул. Крцаниси 6"). */
const MARKER_BEFORE: ReadonlyArray<readonly [RegExp, StreetKind]> = [
  [/^(?:ул\.?|улица)$/u, 'STREET'],
  [/^(?:пр\.?|пр-т|проспект)$/u, 'AVENUE'],
  [/^(?:пер\.?|переулок)$/u, 'LANE'],
];

const isNumberToken = (w: string) => /^\d+[\p{L}]?$/u.test(w);

/*
 * The distinctive word of a street name: the longest one. "არტურ ლაისტის"
 * and "ა. ლაისტის" are one street; "კრწანისის მეორე" is named after Krtsanisi.
 */
const keyWord = (nameWords: string[]): string =>
  nameWords.flatMap((w) => w.split('.')).filter(Boolean)
    .reduce((best, w) => (w.length > best.length ? w : best), '');

function stemOf(word: string): string {
  const t = [...word.toLowerCase()].map((ch) => STREET_TRANSLIT[ch] ?? ch).join('')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/(.)\1+/gu, '$1');
  // Georgian genitive / nominative endings: "krtsanisis" and "krtsanisi" are one street.
  return t.length > 5 ? t.replace(/(?:is|i|s)$/u, '') : t;
}

/**
 * The street an address names, or null. Reads each comma-separated part on
 * its own, so the city/district tail never decides whether two streets match.
 */
export function streetOf(address: unknown): StreetRef | null {
  if (typeof address !== 'string' || !address.trim()) return null;
  for (const part of address.toLowerCase().split(/[,;]/)) {
    const words = part.replace(/№/g, ' ').trim().split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length; i++) {
      const after = MARKER_AFTER.find(([re]) => re.test(words[i]));
      if (after && i > 0) {
        const nameWords = words.slice(0, i).filter((w) => !isNumberToken(w));
        if (!nameWords.length) continue;
        const next = words[i + 1];
        return {
          stem: stemOf(keyWord(nameWords)),
          name: nameWords.join(' '),
          kind: after[1],
          number: next && isNumberToken(next) ? next : null,
        };
      }
      const before = MARKER_BEFORE.find(([re]) => re.test(words[i]));
      if (before && i + 1 < words.length) {
        const rest = words.slice(i + 1);
        const nameWords = rest.filter((w) => !isNumberToken(w));
        if (!nameWords.length) continue;
        const num = rest.find(isNumberToken) ?? null;
        return { stem: stemOf(keyWord(nameWords)), name: nameWords.join(' '), kind: before[1], number: num };
      }
    }
  }
  return null;
}

/**
 * How two addresses relate at street level.
 *
 *   SAME_ADDRESS  same street, same house number (the same building)
 *   SAME_STREET   same street, different or unstated number
 *   STREET_BRANCH a lane/dead-end named after the same street (e.g.
 *                 "კრწანისის მეორე შესახვევი" off Krtsanisi St.) — the same
 *                 micro-location, reported as such
 *   null          different streets, or a street could not be read
 */
export type StreetRelation = 'SAME_ADDRESS' | 'SAME_STREET' | 'STREET_BRANCH';

export function streetRelation(a: unknown, b: unknown): StreetRelation | null {
  const sa = streetOf(a);
  const sb = streetOf(b);
  if (!sa || !sb || sa.stem.length < 3 || sa.stem !== sb.stem) return null;
  const sameKind = sa.kind === sb.kind && sa.name === sb.name;
  if (!sameKind) {
    // "კრწანისის ქ." vs "კრწანისის მეორე შესახვევი": a branch of the same street.
    const isBranch = (s: StreetRef) => s.kind === 'LANE' || s.kind === 'DEAD_END';
    if (isBranch(sa) || isBranch(sb)) return 'STREET_BRANCH';
    // Same stem, different marker words (ქ. vs ქუჩა, St vs Street): one street.
    if (sa.kind !== sb.kind) return null;
  }
  return sa.number && sb.number && sa.number === sb.number ? 'SAME_ADDRESS' : 'SAME_STREET';
}
