// dateParse.ts — shared, pure date-normalization used by both TAS/ENREG
// official-document date extraction and ENREG's "select the latest
// application by actual parsed date" logic (2026-09 "report intelligence
// v2" mandate, Section 13: "13 TAS docs were parsed but historicalComparison
// still said not enough dated docs" — root cause was extractDateFromText()
// only recognizing DD.MM.YYYY/YYYY-MM-DD, silently leaving every TAS
// document whose printed date is Georgian prose, e.g. "2023 წლის 29
// ოქტომბერი" or "29 ოქტომბერი 2023", with documentDate=null, so
// HistoricalComparison.ts's ">= 2 dated documents" gate never had enough
// evidence even though the documents themselves were fully read).
//
// Every parse here is a real, printed date actually found in the text —
// never invented, never a default/current-date fallback. Output is always
// normalized to ISO yyyy-mm-dd so every downstream consumer (chronology
// sort, historical-comparison dedup, "latest application" selection) can
// compare dates as plain strings/timestamps without re-parsing.
const GEORGIAN_MONTHS: Record<string, number> = {
  იანვარი: 1,
  იანვარს: 1,
  იანვრის: 1,
  თებერვალი: 2,
  თებერვალს: 2,
  თებერვლის: 2,
  მარტი: 3,
  მარტს: 3,
  მარტის: 3,
  აპრილი: 4,
  აპრილს: 4,
  აპრილის: 4,
  მაისი: 5,
  მაისს: 5,
  მაისის: 5,
  ივნისი: 6,
  ივნისს: 6,
  ივნისის: 6,
  ივლისი: 7,
  ივლისს: 7,
  ივლისის: 7,
  აგვისტო: 8,
  აგვისტოს: 8,
  სექტემბერი: 9,
  სექტემბერს: 9,
  სექტემბრის: 9,
  ოქტომბერი: 10,
  ოქტომბერს: 10,
  ოქტომბრის: 10,
  ნოემბერი: 11,
  ნოემბერს: 11,
  ნოემბრის: 11,
  დეკემბერი: 12,
  დეკემბერს: 12,
  დეკემბრის: 12,
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toIso(y: number, mo: number, d: number): string | null {
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  if (y < 1900 || y > 2100) return null;
  if (mo < 1 || mo > 12) return null;
  if (d < 1 || d > 31) return null;
  return `${y}-${pad(mo)}-${pad(d)}`;
}

/** Parses the FIRST recognizable date out of free text into normalized ISO
 * yyyy-mm-dd. Supports DD.MM.YYYY, DD/MM/YYYY, YYYY-MM-DD, YYYY.MM.DD,
 * "29 ოქტომბერი 2023" / "29 ოქტომბერს, 2023", and "2023 წლის 29
 * ოქტომბერი". Returns null when nothing recognizable is printed — never a
 * guessed/current date. */
export function parseAnyDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const s = String(text);

  let m = /\b(\d{1,2})[./](\d{1,2})[./](\d{4})\b/.exec(s);
  if (m) return toIso(Number(m[3]), Number(m[2]), Number(m[1]));

  m = /\b(\d{4})[-.](\d{1,2})[-.](\d{1,2})\b/.exec(s);
  if (m) return toIso(Number(m[1]), Number(m[2]), Number(m[3]));

  m = /\b(\d{1,2})\s+([ა-ჰ]+)[,\s]+(\d{4})\b/.exec(s);
  if (m) {
    const mo = GEORGIAN_MONTHS[m[2]];
    if (mo) return toIso(Number(m[3]), mo, Number(m[1]));
  }

  // No trailing \b here: \b is defined against ASCII \w, so a Georgian
  // letter immediately followed by end-of-string/punctuation is NEVER a
  // "word boundary" in a non-unicode regex — a trailing \b after a Georgian
  // character class silently fails to match at all.
  m = /\b(\d{4})\s*წლის\s+(\d{1,2})\s+([ა-ჰ]+)/.exec(s);
  if (m) {
    const mo = GEORGIAN_MONTHS[m[3]];
    if (mo) return toIso(Number(m[1]), mo, Number(m[2]));
  }

  return null;
}

const DATE_SCAN_PATTERNS = [
  /\b\d{1,2}[./]\d{1,2}[./]\d{4}\b/g,
  /\b\d{4}[-.]\d{1,2}[-.]\d{1,2}\b/g,
  /\b\d{1,2}\s+[ა-ჰ]+[,\s]+\d{4}\b/g,
  // No trailing \b — see the comment on the equivalent branch in
  // parseAnyDate() above (a Georgian letter is never a \b word boundary in
  // a non-unicode regex).
  /\b\d{4}\s*წლის\s+\d{1,2}\s+[ა-ჰ]+/g,
];

/** Extracts every distinct date mentioned in text, normalized to ISO, in
 * first-seen order. Used where more than one printed date must be compared
 * (e.g. selecting the latest of several application dates on one page). */
export function extractAllDates(text: string | null | undefined): string[] {
  if (!text) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  for (const re of DATE_SCAN_PATTERNS) {
    for (const mm of String(text).matchAll(re)) {
      const iso = parseAnyDate(mm[0]);
      if (iso && !seen.has(iso)) {
        seen.add(iso);
        found.push(iso);
      }
    }
  }
  return found;
}

/** Given a list of raw date strings (as printed — any supported format,
 * possibly mixed), returns the ORIGINAL string whose parsed value is
 * latest (max), never a positional ("first row") guess. Falls back to the
 * first string only when none of them parse at all. */
export function selectLatestDate(datesFound: string[]): string | null {
  const withParsed = datesFound.map((d) => ({ d, iso: parseAnyDate(d) })).filter((x): x is { d: string; iso: string } => x.iso !== null);
  if (!withParsed.length) return datesFound[0] || null;
  withParsed.sort((a, b) => (a.iso < b.iso ? 1 : a.iso > b.iso ? -1 : 0));
  return withParsed[0].d;
}
