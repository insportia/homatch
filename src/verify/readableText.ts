// HOMATCH — customer-visible text must be readable text.
//
// Georgian that has travelled through a mis-decoded byte stream arrives as
// runs of U+FFFD (the replacement character) and Latin-1 mojibake. Official
// registry pages, scraped listings and PDF extractions all produce it, and a
// due-diligence report that prints "������" beside a real finding looks broken
// in exactly the place a customer most needs to trust it.
//
// The rule is deliberately asymmetric:
//
//   a stray bad byte in an otherwise good sentence   -> keep the sentence
//   a string that is mostly damage                   -> show nothing
//
// Dropping is safe here in a way it would not be in the evidence ledger. This
// governs DISPLAY only; the original text is still stored, so nothing is lost
// for audit and nothing is silently rewritten. Showing nothing is honest —
// showing garbage is not, and guessing at the intended characters would be
// inventing content.

/** Fraction of replacement characters above which a string is treated as
 *  damaged beyond display. One bad byte in a short label is tolerated; a
 *  string that is a tenth replacement characters is not text any more. */
const DAMAGE_LIMIT = 0.1;

export function readable(text: string | null | undefined): string {
  if (!text) return '';
  const stripped = text.replace(/�/g, '');
  const damaged = text.length - stripped.length;
  if (damaged > 0 && damaged / text.length > DAMAGE_LIMIT) return '';
  return stripped.replace(/\s+/g, ' ').trim();
}
