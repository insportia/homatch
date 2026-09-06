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

/** The full ordered sequence TasWorkflow should try. TAS's document/
 * application history is filed against the BASE/PARENT parcel far more
 * often than a full unit-level code, so the base parcel (the recommended
 * 5-segment parent, when the code has more than 5 segments) is the FIRST
 * candidate tried — not a fallback attempted only after an empty full-code
 * search. When the input code has 5 or fewer segments it already IS the
 * base parcel (recommendedParentCode returns null), so it is used directly
 * with no truncation at all, matching the mandate's explicit "if the user
 * already entered the base parcel, do not strip it further."
 *
 * The full original code is NEVER discarded — it is always the second
 * candidate (tried only if the base parcel's own search comes back a
 * confirmed empty), and TasWorkflow keeps both originalCadastralCode and
 * resolvedSearchCadastralCode explicit regardless of which candidate the
 * results actually came from. */
export function candidateSequence(code: string, opts: { minSegments?: number } = {}): string[] {
  if (!isCadastralCode(code)) return [code];
  const original = code.trim();
  const parent = recommendedParentCode(original);
  const rest = cadastralPrefixes(original, opts);
  const primary = parent || original;
  const seen = new Set([primary]);
  const out = [primary];
  for (const c of [original, ...rest]) {
    if (c && !seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return out;
}
