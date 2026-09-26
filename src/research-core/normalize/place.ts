// HOMATCH RESEARCH CORE — comparing two place names written by two sources.
//
// The question this answers is not "are these the same string". It is "did
// two sources name the same place, name different places, or is this a
// comparison I cannot make" — and the third answer is the one that matters.
//
// WHY A COMPARISON CAN BE IMPOSSIBLE
//
// place.ge writes a district as "საბურთალო". home.ss.ge writes the same
// district as "Saburtalo". A comparison that folded case and compared bytes
// would call those DIFFERENT, and in the entity resolver "different districts"
// is a contradiction that returns DISTINCT.
//
// The consequence is precise and bad: the one case cross-source resolution
// exists for — the same flat advertised on a Georgian-language portal and an
// English-language one — becomes the case it can never find. And it fails
// silently, because DISTINCT is the safe-looking answer.
//
// So when two names are in different scripts and the table below does not
// resolve them, this returns UNKNOWN. Not agreement, which would invent a
// fact. Not conflict, which would destroy a merge on the strength of an
// alphabet. A comparison that cannot be made is not a disagreement — the same
// rule the adapters use when a listing does not state a field.
//
// A LOOKUP, NOT A TRANSLITERATOR
//
// Every entry is a name observed from a source this repository actually
// reads. A mechanical script-mapping rule would eventually equate two real
// places that merely transliterate alike, and that error would be a false
// MERGE — the irreversible direction.
//
// Missing entries cost a merge opportunity and nothing else: an unknown
// cross-script pair yields UNKNOWN, which is neutral. So this table can grow
// from observation, safely, one verified name at a time.
//
// VERIFIED IN PRODUCTION, 2026-09-25, on four sources and three scripts.
// These are real decisions from supply_resolution_decisions, each one past
// the area check, so the city comparison actually decided something:
//
//   realting-com:3707388   tbilisi   vs  place-ge:1317855   თბილისი
//     -> "same city(0)", RELATED 0.600
//   estatemarket-ge        Батуми   vs  ss-ge:36826158     Batumi
//     -> "same city(0)", RELATED 0.450
//   ss-ge:35804803         Tbilisi   vs  place-ge:1317870   თბილისი
//     -> "same city(0)", UNRESOLVED 0.050
//
// Under the byte-equality rule this replaced, every one of those was a CITY
// CONFLICT returning DISTINCT at 0.85 confidence -- with "different cities"
// written into the decision log about two listings in the same city. Latin
// against Georgian and Latin against Cyrillic both resolve, and none of the
// pairs reached the merge threshold, which is the other half of being right.

export type PlaceComparison = 'AGREE' | 'CONFLICT' | 'UNKNOWN';

type Script = 'GEORGIAN' | 'LATIN' | 'CYRILLIC' | 'OTHER';

/**
 * Names for one place, as the sources write them.
 *
 * Cities first, then the Tbilisi districts these adapters have actually
 * returned. Georgian and Latin in every row; Russian where a source is known
 * to publish it.
 */
const PLACES: readonly (readonly string[])[] = [
  // ── cities ──────────────────────────────────────────────────────────
  ['tbilisi', 'თბილისი', 'тбилиси', 'tiflis'],
  ['batumi', 'ბათუმი', 'батуми'],
  ['kutaisi', 'ქუთაისი', 'кутаиси'],
  ['rustavi', 'რუსთავი', 'рустави'],
  ['gudauri', 'გუდაური', 'гудаури'],
  ['bakuriani', 'ბაკურიანი', 'бакуриани'],
  ['chakvi', 'ჩაქვი', 'чакви'],
  ['kobuleti', 'ქობულეთი', 'кобулети'],
  // ── Tbilisi districts, as observed in supply_observations ───────────
  ['saburtalo', 'საბურთალო', 'сабуртало'],
  ['vake', 'ვაკე', 'ваке'],
  ['chughureti', 'ჩუღურეთი', 'чугурети'],
  ['didube', 'დიდუბე', 'дидубе'],
  ['krtsanisi', 'კრწანისი', 'крцаниси'],
  ['sololaki', 'სოლოლაკი', 'сололаки'],
  ['vera', 'ვერა', 'вера'],
  ['digomi', 'დიღომი', 'дигоми'],
  ['didi digomi', 'დიდი დიღომი', 'диди дигоми'],
  ['gldani', 'გლდანი', 'глдани'],
  ['isani', 'ისანი', 'исани'],
  ['samgori', 'სამგორი', 'самгори'],
  ['mtatsminda', 'მთაწმინდა', 'мтацминда'],
  ['nadzaladevi', 'ნაძალადევი', 'надзаладеви'],
  ['avlabari', 'ავლაბარი', 'авлабари'],
  ['ortachala', 'ორთაჭალა', 'ортачала'],
];

/** name -> the index of the row it belongs to. Built once. */
const INDEX: Map<string, number> = (() => {
  const map = new Map<string, number>();
  PLACES.forEach((row, i) => row.forEach((name) => map.set(name, i)));
  return map;
})();

const norm = (value: string | null | undefined) =>
  String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Which alphabet a name is written in.
 *
 * Only the ranges the audited sources actually use. A name mixing scripts —
 * "Vake-საბურთალო" — is OTHER, which makes it unresolvable rather than
 * wrongly assigned.
 */
function scriptOf(value: string): Script {
  const georgian = /[Ⴀ-ჿ]/.test(value);
  const cyrillic = /[Ѐ-ӿ]/.test(value);
  const latin = /[a-z]/i.test(value);
  const count = Number(georgian) + Number(cyrillic) + Number(latin);
  if (count !== 1) return 'OTHER';
  if (georgian) return 'GEORGIAN';
  if (cyrillic) return 'CYRILLIC';
  return 'LATIN';
}

/**
 * Did two sources name the same place?
 *
 * AGREE    the same name, or two names the table says are one place
 * CONFLICT two different names in the SAME script, so one source's own
 *          vocabulary distinguishes them
 * UNKNOWN  either name is absent, or they are in different scripts and the
 *          table does not resolve them
 *
 * The CONFLICT rule is deliberately narrow. Within one script a portal that
 * writes "Saburtalo" and "Vake" is making a distinction in its own words, and
 * that is real evidence. Across scripts nothing here can tell a different
 * place from a different spelling, and guessing either way would be inventing
 * a fact — one that either destroys a merge or creates a false one.
 */
export function comparePlaces(a: string | null | undefined, b: string | null | undefined): PlaceComparison {
  const left = norm(a);
  const right = norm(b);
  if (!left || !right) return 'UNKNOWN';
  if (left === right) return 'AGREE';

  const leftRow = INDEX.get(left);
  const rightRow = INDEX.get(right);
  if (leftRow !== undefined && rightRow !== undefined) {
    return leftRow === rightRow ? 'AGREE' : 'CONFLICT';
  }

  /*
   * At least one name is not in the table. Same script means the source's own
   * vocabulary separates them and we can believe it; different scripts means
   * we are looking at an alphabet, not a place.
   */
  const leftScript = scriptOf(left);
  const rightScript = scriptOf(right);
  if (leftScript === 'OTHER' || rightScript === 'OTHER') return 'UNKNOWN';
  return leftScript === rightScript ? 'CONFLICT' : 'UNKNOWN';
}

/** True only when two names are the same place. UNKNOWN is not agreement. */
export function samePlace(a: string | null | undefined, b: string | null | undefined): boolean {
  return comparePlaces(a, b) === 'AGREE';
}

/**
 * The Latin spelling of a place, for sources that transliterate into a URL.
 *
 * home.ge writes its slugs as ...-tbilisi-saburtalo-26565, so a campaign
 * asking about თბილისი has to reach the same string before its sitemap can
 * be filtered. Every row of PLACES already carries the Latin form first, so
 * this reads the table rather than adding a transliteration of its own --
 * there is exactly one place vocabulary in this core and this is not a
 * second one.
 *
 * Null for a place the table does not know, and null is the honest answer: a
 * caller that guessed a transliteration would filter a sitemap down to
 * nothing and report an empty market.
 */
/**
 * Every spelling of a place this core knows, for narrowing a query.
 *
 * A coverage check has to ask the database for rows about one city, and
 * `city = 'Tbilisi'` finds 11 of the 20 Tbilisi rows in production because the
 * other nine are written 'თბილისი' and 'tbilisi'. The filter therefore has to
 * carry every spelling, and they must come from THIS table rather than a list
 * assembled at the call site -- a second vocabulary would drift from this one and
 * the drift would look like missing data.
 *
 * Returns the name as given when the table does not know it, so a caller always
 * has something to filter on. That narrows to one spelling and finds only exact
 * matches, which is the same honest outcome comparePlaces() reaches for an
 * unknown name: no claim either way, and nothing invented.
 */
export function placeNamesFor(place: string | null | undefined): string[] {
  const needle = norm(place);
  if (!needle) return [];
  for (const group of PLACES) {
    if (group.some((name) => norm(name) === needle)) return [...group];
  }
  return [String(place)];
}

export function latinNameFor(place: string | null | undefined): string | null {
  const needle = norm(place);
  if (!needle) return null;
  for (const group of PLACES) {
    if (group.some((name) => norm(name) === needle)) return group[0];
  }
  return null;
}
