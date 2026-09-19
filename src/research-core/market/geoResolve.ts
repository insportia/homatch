/*
 * IS THIS THE SAME PLACE? — ADDRESSES, COORDINATES AND PROJECT IDENTITY.
 *
 * The same building is written six ways across the sources that carry it:
 *
 *   კრწანისის ქუჩა 6      კრწანისის ქ. 6      Krtsanisi Street 6
 *   Krtsanisi St 6        Крцаниси 6          ул. Крцаниси 6
 *
 * Substring matching resolves none of those to each other, which is one of the
 * reasons the Villion run reported SAME_STREET = 0 while myhome.ge was showing
 * a 90 m² flat on "Krtsanisi St". So address identity is normalised to a
 * street STEM plus a number, across three scripts, and compared on that.
 *
 * ── COORDINATES OUTRANK TEXT WHEN BOTH EXIST ─────────────────────────
 *
 * korter.ge publishes geo on its building pages — 41.67653, 44.82462 for
 * Villion. Two points 40 m apart are the same building whatever their address
 * lines say, and no transliteration table has to be right for that to work.
 * Text is the fallback, not the authority.
 *
 * ── AND A NAME ALONE IS NEVER PROOF ──────────────────────────────────
 *
 * SAME_PROJECT from a fuzzy name match is how "Villa Residence" becomes
 * "Villion". Project identity therefore requires a name match PLUS a
 * corroborating fact — the address, the developer, or coordinates — before it
 * will claim two pages describe one development.
 */

/** Metres within which two points are treated as the same building. */
export const SAME_BUILDING_M = 60;
/** Metres within which two points are treated as the immediate microlocation. */
export const MICROLOCATION_M = 400;

const CYRILLIC_TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ж: 'zh', з: 'z', и: 'i', й: 'i',
  к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u',
  ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '',
  э: 'e', ю: 'yu', я: 'ya',
};

const GEORGIAN_TO_LATIN: Record<string, string> = {
  ა: 'a', ბ: 'b', გ: 'g', დ: 'd', ე: 'e', ვ: 'v', ზ: 'z', თ: 't', ი: 'i', კ: 'k',
  ლ: 'l', მ: 'm', ნ: 'n', ო: 'o', პ: 'p', ჟ: 'zh', რ: 'r', ს: 's', ტ: 't',
  უ: 'u', ფ: 'p', ქ: 'k', ღ: 'gh', ყ: 'k', შ: 'sh', ჩ: 'ch', ც: 'ts', ძ: 'dz',
  წ: 'ts', ჭ: 'ch', ხ: 'kh', ჯ: 'j', ჰ: 'h',
};

/** One alphabet, so three scripts can be compared at all. */
export function romanise(input: string): string {
  let out = '';
  for (const ch of (input ?? '').toLowerCase()) {
    out += GEORGIAN_TO_LATIN[ch] ?? CYRILLIC_TO_LATIN[ch] ?? ch;
  }
  return out;
}

/** Words that mean "street" and carry no identity of their own. */
const STREET_WORD = /\b(?:kucha|k|street|st|str|ulitsa|ul|prospekt|avenue|ave)\b\.?/g;
/** The same words, matched as a whole token. */
const STREET_TOKEN = /^(?:kucha|k|street|st|str|ulitsa|ul|prospekt|avenue|ave)$/;
/** Georgian case endings, which change with grammar and not with place. */
const GEORGIAN_TAIL = /(?:is|s|it|ze|shi)$/;

export interface AddressKey {
  /** The street stem, romanised and stripped of grammar. Empty when unknown. */
  street: string;
  /** The building number, when one was stated. */
  number: string;
}

/**
 * The comparable identity of an address line.
 *
 * Everything that varies with language, grammar or punctuation is removed, so
 * all six spellings of Krtsanisi 6 reduce to the same pair.
 */
export function addressKey(line: string): AddressKey {
  const roman = romanise(line ?? '')
    .replace(/[.,№#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!roman) return { street: '', number: '' };

  const tokensAll = roman.split(/\s+/).filter(Boolean);
  const streetIdx = tokensAll.findIndex((t) => STREET_TOKEN.test(t));

  /*
   * THE BUILDING NUMBER IS THE ONE BESIDE THE STREET.
   *
   * This took the first number in the line, which on a clean address is right
   * and on a search snippet is the room count: „Продается 3 комнатная
   * квартира, Крцаниси улица 6" gave 3, so the acceptance fixture resolved to
   * the wrong building. The number that follows the street word is the
   * address; anything earlier belongs to the prose in front of it.
   */
  const numberNear = streetIdx >= 0
    ? (tokensAll.slice(streetIdx + 1, streetIdx + 3).find((t) => /^\d{1,4}[a-z]?$/.test(t)) ?? '')
    : '';
  /*
   * AND THE LETTER STAYS ON IT.
   *
   * This stripped a trailing letter, so 6 and 6a were one building — and since
   * an identical address is what promotes a listing to TIER_1_SAME_PROJECT,
   * the neighbouring block would have been reported as the subject's own
   * development. A suffix is part of the address, not noise in it.
   */
  const number = numberNear
    || (streetIdx < 0 ? (roman.match(/\b(\d{1,4}[a-z]?)\b/) ?? [])[1] ?? '' : '')
    || '';


  /*
   * THE WORD BESIDE "STREET" IS THE STREET.
   *
   * This took the LONGEST remaining word, which works on a clean address line
   * and fails on a search snippet: „Продается 3 комнатная квартира, Крцаниси
   * улица 6" yields `komnatnaya`, and the acceptance fixture then failed to
   * match its own street. Position carries the meaning — a street name sits
   * beside the word "street" in every language here — so that is read first
   * and length is only the fallback.
   */
  const tokens = roman.split(/\s+/).filter(Boolean);
  const streetAt = tokens.findIndex((t) => STREET_TOKEN.test(t));

  /*
   * AND WHICH SIDE OF IT, BECAUSE BOTH ORDERS ARE WRITTEN.
   *
   *   Крцаниси улица 6     name · street · number      (ka, and ru postfix)
   *   ул. Крцаниси 25      street · name · number      (ru prefix, korter.ge)
   *
   * Preferring the word BEFORE resolved the second form to „Тбилиси", because
   * that is what precedes „ул." in „…в Тбилиси, ул. Крцаниси 25" — the city
   * became the street and a real neighbour was lost. The building number
   * disambiguates: it follows the street NAME in both orders, so a non-numeric
   * word after the street word with a number behind it is the name.
   */
  let stem = '';
  if (streetAt >= 0) {
    const before = tokens[streetAt - 1] ?? '';
    const after = tokens[streetAt + 1] ?? '';
    const afterNext = tokens[streetAt + 2] ?? '';
    const named = (w: string) => w.length >= 3 && !/^\d/.test(w);
    // A number on either side is the building, never the street.
    if (named(after) && /^\d{1,4}[a-z]?$/.test(afterNext)) stem = after;
    else if (named(before)) stem = before;
    else if (named(after)) stem = after;
  }

  if (!stem) {
    const words = tokens.filter(
      (w) => !STREET_TOKEN.test(w) && !/^\d/.test(w) && w.length >= 3
    );
    stem = words.sort((a, b) => b.length - a.length)[0] ?? '';
  }

  return { street: stem.replace(/[^a-z]/g, '').replace(GEORGIAN_TAIL, ''), number };
}

/** True when two address lines name the same street, whatever the script. */
export function sameStreet(a: string, b: string): boolean {
  const ka = addressKey(a);
  const kb = addressKey(b);
  if (!ka.street || !kb.street) return false;
  // One may be a prefix of the other where a tail was stripped unevenly.
  return ka.street === kb.street
    || ka.street.startsWith(kb.street)
    || kb.street.startsWith(ka.street);
}

/** True when two address lines name the same street AND the same number. */
export function sameAddress(a: string, b: string): boolean {
  const ka = addressKey(a);
  const kb = addressKey(b);
  return sameStreet(a, b) && !!ka.number && ka.number === kb.number;
}

/* ------------------------------------------------------------------ *
 * Coordinates                                                         *
 * ------------------------------------------------------------------ */

/** Metres between two WGS84 points. Equirectangular: exact enough at 400 m. */
export function distanceMetres(
  a: { lat?: number | null; lon?: number | null },
  b: { lat?: number | null; lon?: number | null }
): number | null {
  if (a?.lat == null || a?.lon == null || b?.lat == null || b?.lon == null) return null;
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const x = toRad(b.lon - a.lon) * Math.cos(toRad((a.lat + b.lat) / 2));
  const y = toRad(b.lat - a.lat);
  return Math.round(Math.sqrt(x * x + y * y) * R);
}

/* ------------------------------------------------------------------ *
 * Project identity                                                    *
 * ------------------------------------------------------------------ */

export interface ProjectIdentity {
  names: readonly string[];
  address?: string | null;
  developer?: string | null;
  lat?: number | null;
  lon?: number | null;
}

export interface ProjectCandidate {
  project?: string | null;
  address?: string | null;
  developer?: string | null;
  lat?: number | null;
  lon?: number | null;
}

const nameKey = (s: string): string => romanise(s).replace(/[^a-z0-9]/g, '');

/**
 * A company name, reduced to what survives translation.
 *
 * „შპს მილენიო გრუპი" and "Millennio Group" are the same company. Romanised
 * they are `shpsmileniogrupi` and `millenniogroup`, and neither contains the
 * other — three separate differences stack up:
 *
 *   · the legal form, which is written in whichever language the source uses
 *   · doubled consonants, which transliteration does not preserve (mileni/milleni)
 *   · Georgian case endings on every noun (grupi/group)
 *
 * Vowels are the part transliteration agrees on least — „გრუპი" romanises to
 * `grupi` while the same word in English is `group`, and no amount of tail
 * stripping reconciles those. So each token is reduced to its CONSONANT
 * SKELETON, which both spellings share: grp, and mln for milleni/mileni.
 *
 * Loose on purpose, and safe because it is only ever a CORROBORATION: the
 * project name must already match before this is consulted, so the worst a
 * generous company comparison can do is confirm a match that was already
 * likely — never create one.
 */
const LEGAL_FORM = /^(?:shps|sps|llc|ltd|ooo|oü|gmbh|sa|ss|jsc|inc|co)$/;

/** First letter plus consonants: the part of a word transliteration keeps. */
function consonantSkeleton(word: string): string {
  const collapsed = word.replace(/(.)\1+/g, '$1');
  const head = collapsed.slice(0, 1);
  const rest = collapsed.slice(1).replace(/[aeiou]/g, '');
  return (head + rest).replace(/(.)\1+/g, '$1');
}

export function companyKey(name: string): string {
  return romanise(name ?? '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.replace(/(.)\1+/g, '$1'))
    .filter((w) => !LEGAL_FORM.test(w) && w.length >= 3)
    .map(consonantSkeleton)
    .filter(Boolean)
    .sort()
    .join(' ');
}

export interface ProjectMatch {
  same: boolean;
  /** What corroborated the name, so a reader can disagree with the reason. */
  reason: 'COORDINATES' | 'ADDRESS' | 'DEVELOPER' | 'NAME_ONLY' | 'NO_MATCH';
}

/**
 * Whether a candidate page describes the subject's development.
 *
 * A NAME MATCH ALONE IS NEVER ENOUGH. Names repeat across cities and
 * developers reuse them; "Villa" appears in dozens of Tbilisi projects. The
 * name must be corroborated by coordinates, the address or the developer
 * before this returns true — and the reason is returned so a caller can
 * record WHY, which is what makes a wrong classification debuggable.
 */
export function matchesProject(
  candidate: ProjectCandidate,
  identity: ProjectIdentity
): ProjectMatch {
  const near = distanceMetres(candidate, identity);
  if (near !== null && near <= SAME_BUILDING_M) return { same: true, reason: 'COORDINATES' };

  const candName = nameKey(candidate.project ?? '');
  const nameHit = !!candName && identity.names.some((n) => {
    const k = nameKey(n);
    return !!k && (k === candName || candName.includes(k) || k.includes(candName));
  });
  if (!nameHit) return { same: false, reason: 'NO_MATCH' };

  if (identity.address && candidate.address && sameAddress(candidate.address, identity.address)) {
    return { same: true, reason: 'ADDRESS' };
  }
  if (identity.developer && candidate.developer) {
    const a = companyKey(identity.developer);
    const b = companyKey(candidate.developer);
    if (a && b && (a === b || a.includes(b) || b.includes(a))) {
      return { same: true, reason: 'DEVELOPER' };
    }
  }

  // A name and nothing else. Real, but not proof.
  return { same: false, reason: 'NAME_ONLY' };
}
