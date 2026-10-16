/*
 * GEORGIAN TEXT FROM NAPR EXTRACT PDFs.
 *
 * The public registry's extract PDFs (ამონაწერი საჯარო რეესტრიდან) embed a
 * legacy 8-bit Georgian font: the glyphs are Georgian, the code points are
 * Latin-1. Text extraction therefore yields "ÀÌÏÍÀßÄÒÉ" where the page reads
 * "ამონაწერი". Until this module existed, that text went into the report
 * undecoded, the model could not read the owner or the mortgages, and the
 * job c80f7237 report named the developer as owner of a flat a private buyer
 * had owned since May 2026.
 *
 * The mapping is the Georgian alphabet in Unicode order (archaic letters
 * included) laid over 0xC0–0xE5 — the layout of the classic "Academy"
 * Georgian fonts. ASCII (digits, Latin letters, punctuation) is untouched,
 * which is why cadastral codes, dates and agreement numbers survive as-is.
 *
 * The decision documents (HTML) are already Unicode; decodeGeorgianLegacy()
 * leaves any text that is not predominantly legacy-encoded unchanged.
 */

/* ა ბ გ დ ე ვ ზ ჱ თ ი კ ლ მ ნ ჲ ო პ ჟ რ ს ტ ჳ უ ფ ქ ღ ყ შ ჩ ც ძ წ ჭ ხ ჴ ჯ ჰ ჵ */
const ALPHABET = 'აბგდევზჱთიკლმნჲოპჟრსტჳუფქღყშჩცძწჭხჴჯჰჵ';
const FIRST = 0xc0;
const LAST = FIRST + ALPHABET.length - 1; // 0xE5

const isLegacy = (code: number) => code >= FIRST && code <= LAST;
const isGeorgian = (code: number) => code >= 0x10d0 && code <= 0x10ff;

/**
 * True when the text reads as legacy-encoded Georgian: a real amount of
 * Latin-1 letters in the mapped range and almost no Unicode Georgian. A
 * French or German word with an "é" never qualifies.
 */
export function looksLegacyGeorgian(text: string): boolean {
  if (typeof text !== 'string' || !text) return false;
  let legacy = 0;
  let georgian = 0;
  let letters = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (isLegacy(c)) legacy++;
    else if (isGeorgian(c)) georgian++;
    if (isLegacy(c) || isGeorgian(c) || /[A-Za-z]/.test(ch)) letters++;
  }
  return legacy >= 20 && legacy > georgian * 4 && legacy / Math.max(1, letters) > 0.5;
}

/** Decodes legacy-encoded Georgian; any other text is returned unchanged. */
export function decodeGeorgianLegacy(text: string): string {
  if (!looksLegacyGeorgian(text)) return text;
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    out += isLegacy(c) ? ALPHABET[c - FIRST] : ch;
  }
  return out;
}
