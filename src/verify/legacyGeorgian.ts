// legacyGeorgian.ts — Georgian typed in a pre-Unicode font, read back as Latin-1. Same table as official-worker/src/documents/legacyGeorgian.ts (a test keeps them equal); this copy decodes results stored before the worker did.
//
// Older NAPR extracts (the "ABSTRACT N:…" PDFs of 2023-2024 that the TAS map
// lists beside the newer ones) were typeset with a legacy Georgian font that
// sits on the Windows-1252 code points À..ä. A PDF text extractor returns those
// code points, so "მიწის (უძრავი ქონების) საკადასტრო კოდი" arrives as
// "ÌÉßÉÓ (ÖÞÒÀÅÉ ØÏÍÄÁÉÓ) ÓÀÊÀÃÀÓÔÒÏ ÊÏÃÉ" — unreadable to the report model,
// so half the documents of a parcel said nothing (live test 307a60b1: 9 of 19).
//
// The font order is the Georgian alphabet with the four archaic letters in
// their historical places (ჱ ჲ ჳ ჴ). Only text that is mostly in that range is
// decoded, so real Latin-1 text (a French accent, a name) is never touched.

const LEGACY = 'აბგდევზჱთიკლმნჲოპჟრსტჳუფქღყშჩცძწჭხჴჯჰ';
const FIRST = 0xc0;
const LAST = FIRST + LEGACY.length - 1; // 0xE4

const isLegacy = (c: number) => c >= FIRST && c <= LAST;

/** Whether the text reads as legacy-font Georgian rather than real Latin-1. */
export function looksLegacyGeorgian(text: string): boolean {
  let legacy = 0;
  let letters = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    if (isLegacy(c)) legacy++;
    if (isLegacy(c) || /[A-Za-zა-ჿ]/.test(ch)) letters++;
  }
  return legacy >= 20 && legacy / Math.max(1, letters) >= 0.3;
}

/** The text with legacy-font Georgian decoded; unchanged when it is not legacy text. */
export function decodeLegacyGeorgian(text: string): string {
  if (typeof text !== 'string' || !text || !looksLegacyGeorgian(text)) return text;
  let out = '';
  for (const ch of text) {
    const c = ch.codePointAt(0)!;
    out += isLegacy(c) ? LEGACY[c - FIRST] : ch;
  }
  return out;
}
