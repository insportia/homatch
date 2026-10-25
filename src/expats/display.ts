// HOMATCH FOR EXPATS — small display rules for Georgian (and every language).
//
// Three things the page got wrong on a phone in Georgian:
//   · a case ending joined by a hyphen ("2-ის", "კვ.მ-ზე") started a new line
//     on its own, because a hyphen is a break opportunity;
//   · dates fell back to English ("Sep 20, 2026") where the browser has no
//     Georgian month names, and ISO dates ("2026-09-20") broke at a hyphen;
//   · an internal development key ("villion-krtsanisi-homes") was shown as
//     if it were a name.

const WORD_JOINER = '⁠';
const NBSP = ' ';

/** A hyphen followed by a Georgian letter keeps the ending on the same line. */
export function keepSuffix(text: string): string {
  return text.replace(/-(?=[ა-ჿ])/g, `-${WORD_JOINER}`);
}

const KA_MONTHS = [
  'იანვარი', 'თებერვალი', 'მარტი', 'აპრილი', 'მაისი', 'ივნისი',
  'ივლისი', 'აგვისტო', 'სექტემბერი', 'ოქტომბერი', 'ნოემბერი', 'დეკემბერი',
];

/**
 * A calendar date in the reader's language, never split across lines.
 * Georgian is written out by hand: browsers without Georgian locale data
 * print English month names for `ka`. Dates are calendar days (the sources
 * record a day, not a moment), so they are read in UTC.
 */
export function formatExpatDate(iso: string | null | undefined, lang: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (lang === 'ka') {
    return [d.getUTCDate(), KA_MONTHS[d.getUTCMonth()], d.getUTCFullYear()].join(NBSP);
  }
  try {
    return new Intl.DateTimeFormat(lang, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
      .format(d)
      .replace(/ /g, NBSP);
  } catch {
    return d.toISOString().slice(0, 10).replace(/-/g, '‑');
  }
}

/** "villion-krtsanisi-homes" → "Villion Krtsanisi Homes": a readable name from a scope key. */
export function projectLabel(key: string | null | undefined): string {
  if (!key) return '';
  return key
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
