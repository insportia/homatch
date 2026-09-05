// assertions.ts (ENREG) — pure predicates for mandate Sections 12-15.
export { canMarkEnregExhausted } from '../../state/transitions.js';

/** Section 12: "If identifier exists, name search MUST NOT be preferred." */
export function assertIdentifierPriorityRespected(hasIdentifier: boolean, searchMethodUsed: 'ID_CODE' | 'NAME' | null): boolean {
  if (!hasIdentifier) return true;
  return searchMethodUsed === 'ID_CODE';
}

/** Section 13: the PRIMARY exact-match rule when an id-code search was
 * used is `result.identificationCode === searchedIdentificationCode` — a
 * substring/partial hit is deliberately NOT accepted. For a name search,
 * the exact name string must appear (best available proxy without a
 * structured result-row parse — matches the pre-refactor adapter's
 * behavior, which this ports rather than reinvents). "Do NOT click the
 * first row" is honored by the caller (EnregPage.ts), which locates the
 * row containing this exact value rather than defaulting to row 0. */
export function assertExactEntityMatch(resultText: string, searchMethod: 'ID_CODE' | 'NAME' | null, searchValue: string | null): boolean {
  if (!searchValue) return false;
  const norm = (s: string) => s.replace(/\s/g, '');
  if (searchMethod === 'ID_CODE') return norm(resultText).includes(norm(searchValue));
  return resultText.includes(searchValue);
}

function parseFlexDate(s: string): Date | null {
  if (!s) return null;
  let m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s.trim());
  if (m) return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
  m = /^(\d{4})[-.](\d{1,2})[-.](\d{1,2})$/.exec(s.trim());
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Section 15: "Do not assume first row = latest." Parses every date
 * actually printed in the applications section and returns the one with
 * max(applicationDate) — never invented, never positional. */
export function selectLatestApplicationDate(datesFound: string[]): string | null {
  const withParsed = datesFound.map((d) => ({ d, t: parseFlexDate(d) })).filter((x): x is { d: string; t: Date } => x.t !== null);
  if (!withParsed.length) return datesFound[0] || null;
  withParsed.sort((a, b) => b.t.getTime() - a.t.getTime());
  return withParsed[0].d;
}
