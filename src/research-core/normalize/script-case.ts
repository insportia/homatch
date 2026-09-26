// UPPERCASING GEORGIAN DOES NOT LEAVE IT ALONE.
//
// This module exists because of a bug that had been shipped and green for as long
// as the matcher has existed, and that no test caught because every test wrote its
// Georgian fixtures in the same lowercase the code then destroyed.
//
// `'რიელტორი'.toUpperCase()` is `'ᲠᲘᲔᲚᲢᲝᲠᲘ'`.
//
// Georgian has two cases in Unicode. Mkhedruli (U+10D0–U+10FA) is the alphabet
// everything is written in; Mtavruli (U+1C90–U+1CBA) was added in Unicode 11 for
// all-caps display text, and `String.prototype.toUpperCase` maps one to the other.
// So the extremely ordinary idiom
//
//     const text = String(value).trim().toUpperCase();
//     if (/ქირავდ/.test(text)) return 'RENT';
//
// is a test that can never pass. Three functions in participants.ts were written
// that way — supplyRoleFrom, demandRoleFrom and dealKindFrom — which means every
// Georgian branch in all three was unreachable: `ქირავდ` (for rent), `იყიდ` (for
// sale), `მიწ` (land), `სააგენტ` (agency), `მესაკუთრ` (owner). In a Georgian
// real-estate product, `ქირავდება` is the most common word on a rental listing.
//
// THE FIX IS NOT TO WRITE THE PATTERNS IN MTAVRULI. Fixtures, portal slugs and
// live rows are all in Mkhedruli, so a Mtavruli pattern would only be reachable
// through the uppercasing and would break the moment a caller compared raw text.
// Instead: fold to one case, and fold Georgian back to the script it is written in.
//
// RELATED, AND THE SAME LESSON TWICE. `\b` never matches a Georgian letter either,
// so word boundaries are per-script. Case is per-script too, and the two traps are
// not the same trap — this one is silent in both directions.

/** Mkhedruli U+10D0, Mtavruli U+1C90. The blocks are parallel and offset by this. */
const MTAVRULI_START = 0x1c90;
const MTAVRULI_END = 0x1cba;
const MKHEDRULI_START = 0x10d0;
const OFFSET = MTAVRULI_START - MKHEDRULI_START;

/**
 * Map any Mtavruli in the string back to Mkhedruli.
 *
 * Also handles the two codepoints outside the parallel run — U+1CBD..U+1CBF exist
 * in Mtavruli and map to U+10FD..U+10FF — so that a folded string is never left
 * holding a letter no pattern will match.
 */
export function toMkhedruli(value: string): string {
  let changed = false;
  let out = '';
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code >= MTAVRULI_START && code <= MTAVRULI_END) {
      out += String.fromCodePoint(code - OFFSET);
      changed = true;
    } else if (code >= 0x1cbd && code <= 0x1cbf) {
      out += String.fromCodePoint(code - OFFSET);
      changed = true;
    } else {
      out += char;
    }
  }
  return changed ? out : value;
}

/**
 * Trim, uppercase, and undo what uppercasing did to Georgian.
 *
 * The replacement for `String(value).trim().toUpperCase()` everywhere the result is
 * matched against patterns that include Georgian. Latin and Cyrillic come out
 * uppercased as before — `а` → `А` is a real and lossless case mapping — so
 * existing uppercase patterns keep working unchanged, and Georgian patterns start
 * working for the first time.
 */
export function foldCase(value: string | null | undefined): string {
  return toMkhedruli(String(value ?? '').trim().toUpperCase());
}
