// cadastral.ts — mandate Section 6: "Do NOT blindly strip a fixed number of
// characters. Implement cadastral hierarchy resolution as a dedicated
// function/module." Ported unchanged in behavior from the pre-refactor
// lib/cadastral.js (already correct, already unit-tested — 13 tests).
//
// TAS's document-history search frequently exposes records only under the
// PARENT/BASE PARCEL identifier, not the full unit/apartment code — e.g. the
// regression case 01.18.06.019.055.03.01.603 found real history for the
// base parcel 01.18.06.019.055 (unit-level segments 6/7/8 stripped). This
// is deliberately NOT hardcoded to "always strip exactly 3 segments" — it
// exposes the full ordered list of progressively-shorter prefixes and a
// single recommended "parent" guess (5 segments) for TasWorkflow's
// PARENT_CODE_RESOLUTION state.
//
// Nothing here ever discards the ORIGINAL full code — TasWorkflow keeps
// both `originalCadastralCode` and `resolvedSearchCadastralCode` explicit
// and separate, per the mandate's explicit example.

const CADASTRAL_SEGMENT_RE = /^[0-9]+$/;

/** True only for strings that look like a real dot-segmented cadastral code
 * (all-numeric segments, at least 2 of them) — never asserted for arbitrary
 * free text, so a non-cadastral query is simply left alone by callers. */
export function isCadastralCode(s: string | null | undefined): boolean {
  if (!s || typeof s !== 'string') return false;
  const segs = s.trim().split('.');
  return segs.length >= 2 && segs.every((seg) => CADASTRAL_SEGMENT_RE.test(seg));
}

/** All progressively-shorter dot-joined prefixes of `code`, longest first,
 * down to `minSegments` (default 3). Returns [] for a non-cadastral input. */
export function cadastralPrefixes(code: string, { minSegments = 3 }: { minSegments?: number } = {}): string[] {
  if (!isCadastralCode(code)) return [];
  const segs = code.trim().split('.');
  const floor = Math.min(minSegments, segs.length);
  const out: string[] = [];
  for (let n = segs.length; n >= floor; n--) out.push(segs.slice(0, n).join('.'));
  return out;
}

/** The single recommended "parent/base parcel" candidate: 5 segments when
 * the full code has more than 5, otherwise null. A best-first GUESS, not a
 * claim it is correct for every code shape — candidateSequence() is what a
 * caller should actually iterate for a real fallback. */
export function recommendedParentCode(code: string): string | null {
  if (!isCadastralCode(code)) return null;
  const segs = code.trim().split('.');
  return segs.length > 5 ? segs.slice(0, 5).join('.') : null;
}

/** The full ordered sequence TasWorkflow should try. 2026-09-06 "final
 * alignment pass" mandate: the FULL, EXACT code the user/property actually
 * carries is the FIRST candidate tried, always — it is the real identifier
 * and TAS's search frequently does resolve it directly. The base/parent
 * parcel (the recommended 5-segment parent, when the code has more than 5
 * segments) is tried only as a FALLBACK, after the full code's own search
 * comes back a confirmed empty — not tried first as a guess. When the input
 * code has 5 or fewer segments it already IS the base parcel
 * (recommendedParentCode returns null), so there is nothing to add as a
 * distinct fallback.
 *
 * Neither candidate is ever discarded — TasWorkflow keeps both
 * originalCadastralCode and resolvedSearchCadastralCode explicit regardless
 * of which candidate the results actually came from. */
export function candidateSequence(code: string, opts: { minSegments?: number } = {}): string[] {
  if (!isCadastralCode(code)) return [code];
  const original = code.trim();
  const parent = recommendedParentCode(original);
  const rest = cadastralPrefixes(original, opts);
  const seen = new Set([original]);
  const out = [original];
  for (const c of [...(parent ? [parent] : []), ...rest]) {
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}

/** Real production job 08379309-bb2e-4ac6-9d97-727edb3af2b8: TasWorkflow's
 * parent/base-parcel fallback used to trigger ONLY on
 * `searchRes.noResultConfirmed` — but TasPage.searchCadastral() can
 * independently report `resultsDiscovered: 0` with `noResultConfirmed:
 * false` (a literal "0" count read from the page with no textual
 * no-result phrase matched), exactly the observed trace for
 * 01.18.06.019.055.03.01.601: resultsDiscovered=0, resultsVisited=0, yet
 * the fallback never fired and cadastralFallbackAttempts contained only
 * the one exact-code attempt. This is the single, consistent "did this
 * attempt actually find something" definition TasWorkflow now uses for
 * the fallback trigger, the fallback loop's own break condition, and the
 * final exhaustion decision — so the three can never again silently
 * disagree about what counts as a real result. */
export function hasMeaningfulTasResults(sr: { resultsDiscovered: number | null; noResultConfirmed?: boolean }): boolean {
  return !sr.noResultConfirmed && typeof sr.resultsDiscovered === 'number' && sr.resultsDiscovered > 0;
}
