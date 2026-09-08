// EntityValidation.ts — the "a company name must never be copied into
// idCode" invariant (2026-09-06 production-trace mandate, real job
// 08379309-bb2e-4ac6-9d97-727edb3af2b8). Confirmed live: ENREG received
// forEntity: { name: "Millenio Group", idCode: "Millenio Group" } while the
// real companyProfile carried idCode: null. Root cause was
// ResearchOrchestrator.startEntity() falling back to the entity's NAME
// whenever idCode was absent, corrupting the idCode field itself instead of
// leaving it honestly null and letting EnregWorkflow's own ID_CODE/NAME
// method selection (which already existed and was already correct) make
// the real choice.
//
// Pure, dependency-free, and applied at every point a candidate idCode
// enters the system: EntityDeduplicator.merge() (so the EntityQueue itself
// can never store a name-shaped identificationCode — the field
// RsTaxpayerWorker/DebtorWorker treat as a ready-to-use numeric TIN with no
// name fallback of their own), ResearchOrchestrator.startEntity() (the
// confirmed production entry point for the bug), and
// EnregWorkflow.runEnregWorkflow() (the last line of defense right before
// the ID_CODE vs NAME search-method decision is made).
export function looksLikeCompanyId(v: unknown): v is string {
  const s = String(v || '').trim();
  return /^\d{9,11}$/.test(s);
}

// ---------------------------------------------------------------------
// isValidCompanyCandidate() — 2026-09 "report intelligence v2" mandate,
// Section 5. Real production regression (job 1aa45cdf-a5cf-4dcc-b7a9-
// 524cedb596ae): the entity-name marker regex's individual-entrepreneur
// alternative accepted the bare adjective "ინდივიდუალური" ("individual") on
// its own — not just "ინდივიდუალური მეწარმე" ("individual entrepreneur") —
// so an unrelated construction-permit phrase, "ინდივიდუალური საცხოვრებელი
// სახლის მშენებლობისა" ("[permit for] individual residential house
// construction"), got misread as a LEGAL_ENTITY candidate with that whole
// phrase as its "name". LEGAL_FORM_RE below requires "მეწარმე" alongside
// "ინდივიდუალურ*" so the adjective alone can never match.
// NOTE: no \b (word-boundary) around the Georgian alternatives. \b is
// defined relative to ASCII \w ([A-Za-z0-9_]) in a non-unicode-flag regex,
// and Georgian letters are never \w — so `\bშპს\b` can NEVER match
// anywhere a Georgian marker is surrounded only by other Georgian letters
// or string boundaries (this exact mistake silently broke every Georgian
// branch of this regex during initial development; \b is kept only around
// the Latin abbreviations, where it works as expected).
const GEORGIAN_LEGAL_FORM = '(?:შპს|სს|სპს|კოოპერატივი|ააიპ|ინდივიდუალურ(?:ი|მა|ის|ს)?\\s+მეწარმე)';
export const LEGAL_FORM_RE = new RegExp(`(?:${GEORGIAN_LEGAL_FORM}|\\b(?:llc|ltd|jsc)\\b)`, 'i');

// Construction/permit vocabulary that shows up in exactly the kind of
// sentence fragment the bug above produced — used as a secondary reject
// signal for names that passed the (now-tightened) marker regex but still
// look like a description of a PROJECT/PERMIT rather than a company name.
const NON_ENTITY_CONTEXT_RE = /(მშენებლობ|საცხოვრებელი\s+სახლის|ნებართვ|განაშენიან|ნაკვეთის|დემონტაჟ)/;

/** Secondary validation gate for a candidate LEGAL_ENTITY name, applied on
 * top of (never instead of) the marker regex a candidate was already found
 * with. A real numeric id code is decisive on its own (mandate: "company ID
 * is the identity anchor"); otherwise the name itself must contain a real
 * legal-form marker, or the surrounding context must actually call it out
 * as a company/applicant/developer AND the name must not read like a
 * construction/permit description. */
export function isValidCompanyCandidate(name: string, idCode?: string | null, context?: string | null): boolean {
  const clean = String(name || '').trim();
  if (!clean) return false;
  /*
   * A candidate whose NAME begins with a dash/quote fragment, or which is
   * only a legal form with no actual name after it, is a truncation artifact
   * of the surrounding sentence rather than a company. Production job
   * 3aa36828 recorded eleven of these ("სს იპ –", "სს იპ – ქ", …). Rejected
   * even when an id code is present, because an id code attached to a
   * sentence fragment is a mis-association, not a company.
   */
  if (/^[-–—«»"'„:;,.\s]+/.test(clean)) return false;
  const withoutForm = clean.replace(LEGAL_FORM_RE, '').replace(/^[-–—«»"'„:;,.\s]+/, '').trim();
  if (withoutForm.length < 2) return false;
  if (looksLikeCompanyId(idCode)) return true;
  if (LEGAL_FORM_RE.test(clean)) return true;
  if (
    context &&
    /(დეველოპერი|განმცხადებელი|კომპანია|მესაკუთრე|developer|company|applicant)/i.test(context) &&
    clean.length >= 4 &&
    clean.length <= 120 &&
    !NON_ENTITY_CONTEXT_RE.test(clean)
  ) {
    return true;
  }
  return false;
}
