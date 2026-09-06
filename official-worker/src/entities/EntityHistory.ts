// EntityHistory.ts — pure text parsing for a company's own registered-name
// history (2026-09 "report intelligence v2" mandate, Section 6). ENREG's
// entity/extract page prints a company's former/previous registered
// name(s) inline with its current name and identification code — Georgian
// "ყოფილი დასახელება" / "წინანდელი სახელწოდება" ("former name") — but
// nothing in this codebase previously recognized that field, so a
// former-name mention got queued by EntityQueue.scanText() as an entirely
// separate, unlinked LEGAL_ENTITY candidate. Real production regression:
// "შპს ქეი-ელ გრუპი" rendered as its own "discovered related company"
// instead of being folded into "შპს მილენიო გრუპი" (company ID 404670272)
// as that same company's name history — "company ID is the identity
// anchor," never two cards for one company.
const PRIMARY_ID_RE = /საიდენტიფიკაციო\s*(?:კოდი|ნომერი)?\s*[:։]?\s*([0-9]{9,11})/i;
const FORMER_NAME_RE = /(?:ყოფილი\s*(?:დასახელება|სახელწოდება)|წინანდელი\s*(?:დასახელება|სახელწოდება)|ძველი\s*დასახელება)\s*[:։]?\s*([^\n,;.]{2,150})/gi;

/** The entity/extract page's OWN identification code — the company whose
 * page this is, independent of which search method (ID_CODE or NAME) found
 * it. Used to anchor a discovered former name to the right company even
 * when the search itself was a NAME lookup and no idCode was known before
 * this page was opened. */
export function extractPrimaryIdCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = PRIMARY_ID_RE.exec(text);
  return m ? m[1] : null;
}

/** Every distinct former/previous registered name mentioned on the page,
 * trimmed of stray quotes. Never invents a name that isn't actually
 * printed, and never returns more than one entry for the same normalized
 * name. */
export function extractPreviousCompanyNames(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  FORMER_NAME_RE.lastIndex = 0;
  while ((m = FORMER_NAME_RE.exec(text))) {
    const name = m[1]
      .trim()
      .replace(/["'«»„“”]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const key = name.toLowerCase();
    if (name.length >= 2 && !seen.has(key)) {
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}
