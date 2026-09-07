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

/** The full ordered sequence TasWorkflow should try.
 *
 * SUPERSEDES the 2026-09-06 "final alignment pass" design (full/exact code
 * tried first, base/parent only as a fallback). The 2026-09-07 "Verify
 * mandate" source-routing rule is explicit and the opposite: "TAS=parent/
 * base" — TAS's own document/permit history is filed at the parcel level,
 * and entering the full apartment/unit-level code into TAS's search is a
 * real, observed false-empty-result cause (confirmed against the mandate's
 * own fixture: full code 01.18.06.019.055.03.01.603, required TAS query
 * 01.18.06.019.055). MY.GOV's own Service 176 is the one source that gets
 * the FULL exact code instead — see MyGovWorkflow.ts — so this is a genuine
 * per-source routing difference, not a regression of either rule.
 *
 * The BASE/PARENT parcel (recommendedParentCode's 5-segment guess, when the
 * input has more than 5 segments) is therefore tried FIRST and is the only
 * candidate TasWorkflow will normally need. When the input code already IS
 * the base parcel (5 or fewer segments — i.e. it was entered directly),
 * `base === original` here: it is tried exactly as given, not truncated
 * further before that first attempt. A short, progressively-broader
 * fallback chain (4, then 3 segments) below the base is kept only as a
 * defensive last resort for a base guess that itself finds nothing — the
 * full apartment/unit-level code is deliberately never a candidate here.
 *
 * TasWorkflow keeps both originalCadastralCode (always the exact code as
 * supplied, never overwritten) and resolvedSearchCadastralCode (whichever
 * candidate below the results actually came from) explicit and separate. */
export function candidateSequence(code: string, opts: { minSegments?: number } = {}): string[] {
  if (!isCadastralCode(code)) return [code];
  const original = code.trim();
  const base = recommendedParentCode(original) || original;
  return cadastralPrefixes(base, opts);
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
