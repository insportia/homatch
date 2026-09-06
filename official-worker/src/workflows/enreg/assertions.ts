// assertions.ts (ENREG) — pure predicates for mandate Sections 12-15.
export { canMarkEnregExhausted } from '../../state/transitions.js';
import { selectLatestDate } from '../../util/dateParse.js';

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

/** Section 15: "Do not assume first row = latest." Parses every date
 * actually printed in the applications section and returns the one with
 * max(applicationDate) — never invented, never positional. Delegates to the
 * shared date parser (util/dateParse.ts) so Georgian prose dates ("29
 * ოქტომბერი 2023") are recognized here too, not just DD.MM.YYYY/YYYY-MM-DD —
 * an ENREG applications list is not guaranteed to only ever print numeric
 * dates. */
export const selectLatestApplicationDate = selectLatestDate;
