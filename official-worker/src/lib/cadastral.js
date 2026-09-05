// Cadastral-code parent/base-parcel resolution (2026-09-05, per the TAS
// "parent cadastral fallback" requirement).
//
// TAS's document-history search frequently exposes records only under the
// PARENT/BASE PARCEL identifier, not the full unit/apartment code — e.g. the
// demonstrated workflow found real history for the base parcel
// "01.18.06.019.055" when the full unit code was
// "01.18.06.019.055.03.01.603" (unit-level segments 6/7/8 stripped).
//
// This module is deliberately NOT hardcoded to "always strip exactly 3
// segments" — a cadastral code's segment count and meaning can vary. Instead
// it exposes the full ordered list of progressively-shorter prefixes (same
// "try the longest specific candidate first, then broader" idea already used
// by msmapSuggestion() in index.js for a different purpose) and a single
// recommended "parent" guess (5 segments, matching the one demonstrated
// example) for callers that want one best-first candidate without walking
// the whole list.
//
// Nothing here ever discards the ORIGINAL full code — every caller is
// expected to keep both the original and whichever resolved code actually
// produced evidence, and to record both explicitly (ORIGINAL_CADASTRAL_CODE /
// RESOLVED_SEARCH_CADASTRAL_CODE) rather than silently replacing one with
// the other.

const CADASTRAL_SEGMENT_RE = /^[0-9]+$/;

/** True only for strings that look like a real dot-segmented cadastral code
 * (all-numeric segments, at least 2 of them) — never asserted for arbitrary
 * free text, so a non-cadastral query is simply left alone by callers. */
function isCadastralCode(s) {
  if (!s || typeof s !== 'string') return false;
  const segs = s.trim().split('.');
  return segs.length >= 2 && segs.every(seg => CADASTRAL_SEGMENT_RE.test(seg));
}

/** All progressively-shorter dot-joined prefixes of `code`, longest first,
 * down to `minSegments` (default 3 — a bare 2-segment code is usually too
 * broad to be a meaningful "parcel", so it is not offered as a fallback
 * target by default, though isCadastralCode() itself still accepts 2). Does
 * NOT include the full code's own trailing single-segment prefixes below
 * minSegments. Returns [] for a non-cadastral-looking input. */
function cadastralPrefixes(code, { minSegments = 3 } = {}) {
  if (!isCadastralCode(code)) return [];
  const segs = code.trim().split('.');
  const floor = Math.min(minSegments, segs.length);
  const out = [];
  for (let n = segs.length; n >= floor; n--) out.push(segs.slice(0, n).join('.'));
  return out;
}

/** The single recommended "parent/base parcel" candidate: 5 segments when
 * the full code has more than 5 (matching the demonstrated
 * 01.18.06.019.055.03.01.603 -> 01.18.06.019.055 example), otherwise null
 * (the full code IS already at or below parcel granularity, so there is no
 * shorter, still-meaningful parent to try). This is a best-first GUESS, not
 * a claim that it is correct for every code shape — candidateSequence()
 * below is what a caller should actually iterate for a real fallback. */
function recommendedParentCode(code) {
  if (!isCadastralCode(code)) return null;
  const segs = code.trim().split('.');
  return segs.length > 5 ? segs.slice(0, 5).join('.') : null;
}

/** The full ordered sequence a TAS-style fallback resolver should try:
 * the original code first (never skipped — it may well be correct), then
 * the recommended 5-segment parent (if different and shorter), then every
 * other progressively-shorter prefix down to minSegments, deduplicated and
 * with the original never repeated. */
function candidateSequence(code, opts = {}) {
  if (!isCadastralCode(code)) return [code];
  const original = code.trim();
  const parent = recommendedParentCode(original);
  const rest = cadastralPrefixes(original, opts);
  const seen = new Set([original]);
  const out = [original];
  for (const c of [parent, ...rest]) {
    if (c && !seen.has(c)) { seen.add(c); out.push(c); }
  }
  return out;
}

export { isCadastralCode, cadastralPrefixes, recommendedParentCode, candidateSequence };
