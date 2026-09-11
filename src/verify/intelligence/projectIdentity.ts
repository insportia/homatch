// HOMATCH — one development, one key.
//
// A project is identified by whatever name the research happened to read off
// whichever page it found. The same building in Digomi came back as
//
//   "Kristian Stiven Street, 18"      from one source
//   "Kristian Stiven St, 18"          from another
//   "18 Kristian Stiven Street"       from a third
//
// and the first two became two separate PROJECT entities in production, seven
// facts each, neither knowing about the other. Every fact learned about one was
// invisible to a verification that arrived through the other, so the graph held
// the project's floors twice and could reuse them half the time.
//
// WHAT THIS DOES, AND THE LINE IT WILL NOT CROSS.
//
// It canonicalises the parts of an address that have a RIGHT ANSWER: the word
// for "street" is the same word however it was abbreviated, and a house number
// means the same thing whether it leads or trails. Those are deterministic
// rewrites and two names that differ only by them are the same address.
//
// It does NOT touch proper nouns. "Kristian Stiven" and "Kristiana Steven" are
// two transliterations of one Georgian name, and a rule loose enough to merge
// them is loose enough to merge two genuinely different developments that
// happen to share a syllable. The original code chose to keep two entities
// rather than risk one wrong merge, and that judgement was right — it was only
// applied too early, before the deterministic normalisation had been done.
//
// So: everything with a right answer is normalised, everything else is left
// alone, and a name that still differs after that is still two entities.

/** Words that mean "street" and friends, in the spellings sources actually use. */
const STREET_TYPES: Record<string, string> = {
  // Latin, abbreviated and full.
  st: 'street',
  str: 'street',
  street: 'street',
  ave: 'avenue',
  av: 'avenue',
  avenue: 'avenue',
  rd: 'road',
  road: 'road',
  blvd: 'boulevard',
  boulevard: 'boulevard',
  ln: 'lane',
  lane: 'lane',
  dr: 'drive',
  drive: 'drive',
  sq: 'square',
  square: 'square',
  hwy: 'highway',
  highway: 'highway',
  // Georgian. These are the real words on Georgian listing and registry pages,
  // and the mapping between them and the Latin terms is fixed, not a guess.
  ქუჩა: 'street',
  ქ: 'street',
  გამზირი: 'avenue',
  გამზ: 'avenue',
  მოედანი: 'square',
  ჩიხი: 'lane',
  გზატკეცილი: 'highway',
  // Russian, which appears on some cross-posted listings.
  улица: 'street',
  ул: 'street',
  проспект: 'avenue',
  пр: 'avenue',
};

/**
 * Noise words that carry no address meaning.
 *
 * Deliberately short. Anything that might distinguish two developments —
 * "residence", "tower", "park" — stays, because those are names.
 */
const DROPPED = new Set(['the', 'a', 'an', 'no', 'n', '№', 'nr', 'house', 'building']);

const normaliseToken = (t: string): string => STREET_TYPES[t] ?? t;

/**
 * The canonical key for a project name.
 *
 * Tokens are lower-cased and split on anything that is not a letter or digit.
 * Street-type words collapse to one spelling. Numbers are pulled out and
 * appended in the order they appeared, so a leading house number and a
 * trailing one produce the same key — "18 Kristian Stiven Street" and
 * "Kristian Stiven St, 18" are one development, and they were two.
 *
 * Word order among the remaining words is PRESERVED. Sorting them would merge
 * "Park Avenue Residence" with "Residence Avenue Park", and nothing in the
 * data suggests that is a real variation worth the risk.
 */
export function canonicalProjectKey(v: unknown): string | null {
  const raw = typeof v === 'string' ? v : v == null ? '' : String(v);
  const tokens = raw
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

  const words: string[] = [];
  const numbers: string[] = [];

  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      // A leading zero is a spelling, not a different house.
      numbers.push(String(Number(t)));
      continue;
    }
    const n = normaliseToken(t);
    if (DROPPED.has(n)) continue;
    words.push(n);
  }

  const key = [...words, ...numbers].join('-');
  // Same floor as the old slug: two characters is not a project name.
  return key.length >= 3 ? key : null;
}

/**
 * Whether two project names denote the same development.
 *
 * Only ever used for reporting and for the merge tool; the graph keys on
 * canonicalProjectKey directly.
 */
export function sameProject(a: unknown, b: unknown): boolean {
  const ka = canonicalProjectKey(a);
  const kb = canonicalProjectKey(b);
  return !!ka && ka === kb;
}

/**
 * Which script a name is written in.
 *
 * Deterministic and only as precise as it needs to be: this decides how an
 * alias is labelled for an operator reading the table, never whether two names
 * are the same thing.
 */
export type NameScript = 'LATIN' | 'GEORGIAN' | 'CYRILLIC' | 'MIXED' | 'UNKNOWN';

export function scriptOf(v: unknown): NameScript {
  const s = typeof v === 'string' ? v : v == null ? '' : String(v);
  const has = {
    LATIN: /\p{Script=Latin}/u.test(s),
    GEORGIAN: /\p{Script=Georgian}/u.test(s),
    CYRILLIC: /\p{Script=Cyrillic}/u.test(s),
  };
  const present = (Object.keys(has) as NameScript[]).filter((k) => has[k as 'LATIN']);
  if (!present.length) return 'UNKNOWN';
  return present.length > 1 ? 'MIXED' : present[0];
}

/**
 * Every spelling of a project worth remembering as pointing at it.
 *
 * WHY ALIASES AND NOT TRANSLITERATION. "Kristian Stiven Street, 18" and
 * "კრისტიან სტივენის ქუჩა №18" are the same development, and canonicalisation
 * gets the street-type word but not the name: transliterating the Georgian
 * gives "kristian stivenis" — the genitive "-ის" is part of the word — and
 * stripping case endings is morphology, not a deterministic rewrite. Guessing
 * there risks fusing two real developments, which is far worse than holding
 * two entities.
 *
 * So nothing is guessed. A name observed for a project is REMEMBERED as
 * pointing at it, and the next verification that sees that spelling resolves
 * to the same entity. Evidence, not inference.
 */
export function aliasKeysFor(names: readonly unknown[]): { key: string; raw: string; script: NameScript }[] {
  const out: { key: string; raw: string; script: NameScript }[] = [];
  const seen = new Set<string>();
  for (const n of names ?? []) {
    const raw = typeof n === 'string' ? n.trim() : n == null ? '' : String(n).trim();
    if (!raw) continue;
    const key = canonicalProjectKey(raw);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, raw: raw.slice(0, 300), script: scriptOf(raw) });
  }
  return out;
}
