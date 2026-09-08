// EntityQueue.ts — mandate Section 16. Source-agnostic entity discovery:
// it does not matter which official source or document a company name +
// identification code is found in — whenever both appear together in
// retrieved text, that is a candidate worth queuing for ENREG research.
// This module does the deterministic TEXT EXTRACTION + queue bookkeeping;
// it has no knowledge of Playwright/HTTP and is fully unit-testable with
// plain fixture text (ported unchanged in behavior from the pre-refactor
// lib/entityDiscovery.js's extractEntityCandidates()).
//
// "Do not interrupt current document traversal just because an entity was
// discovered. Finish current document, then orchestrator processes entity
// queue" — enforced by the orchestrator (which only calls pending()/
// confirmed() once between primary-source steps), not by this class.
import { EntityDeduplicator, type EntityCandidate } from './EntityDeduplicator.js';
import type { ResearchEntity, EntityDiscoveryRef } from './EntityTypes.js';
import { isValidCompanyCandidate } from './EntityValidation.js';

// Georgian legal-entity markers this recognizes (deliberately conservative
// — real markers actually used in registry documents):
//   შპს   - შეზღუდული პასუხისმგებლობის საზოგადოება (LLC)
//   სს    - სააქციო საზოგადოება (JSC)
//   ააიპ  - non-profit legal entity
//   ინდივიდუალური მეწარმე - individual entrepreneur
//
// 2026-09 "report intelligence v2" mandate, Section 5 regression (real
// production job 1aa45cdf-a5cf-4dcc-b7a9-524cedb596ae): the previous
// pattern's individual-entrepreneur alternative, `ინდივიდუალურ(?:ი|ი\s*
// მეწარმე)`, matched the bare adjective "ინდივიდუალური" ("individual") ON
// ITS OWN via its first branch — so a construction-permit phrase like
// "ინდივიდუალური საცხოვრებელი სახლის მშენებლობისა" ("[permit for]
// individual residential house construction") was misread as a
// LEGAL_ENTITY candidate. "მეწარმე" (entrepreneur) is now mandatory
// alongside "ინდივიდუალურ*" — the adjective alone can never match.
/*
 * `სს` (JSC) must be a STANDALONE marker.
 *
 * Real production job 3aa36828-471a-4cd0-8a46-4e3f2b4c4c92 recorded eleven
 * junk LEGAL_ENTITY candidates, all variants of:
 *
 *   "სს იპ – ქ", "სს იპ –", "სს იპ - ქ", "სს იპ – ქალაქ",
 *   "სს იპ – ქალაქ თბილისის", "სს იპ – ქალაქ თბილისის მუნიციპალიტეტის", …
 *
 * They come from ONE phrase: "სსიპ – ქალაქ თბილისის მუნიციპალიტეტი"
 * (სსიპ = LEPL, a legal entity of PUBLIC law — a state body, not a company).
 * The bare `სს` alternative matched the first two characters of `სსიპ`, and
 * the name group then swallowed a different amount of the following sentence
 * at each match position, producing a family of near-duplicate ghosts.
 *
 * Two guards, both required:
 *   - `(?!იპ)` so `სსიპ` can never be read as `სს` + a name;
 *   - a following separator, so the marker must be its own token rather than
 *     a prefix of any longer Georgian word.
 */
const ENTITY_MARKER = /(?:შპს|ააიპ|სს(?!იპ)(?=[\s«"""'„])|ინდივიდუალურ(?:ი|მა|ის|ს)?\s+მეწარმე)/;
const ENTITY_NAME_RE = new RegExp(`(${ENTITY_MARKER.source})\\s*[«"“”'„“]?\\s*([^,.;\\n()«»"“”]{2,80})`, 'g');
// Georgian legal-entity id codes are 9-digit numbers; only accepted within
// a short window of a matched entity name (same sentence/line), never as a
// bare 9-digit number found anywhere in a document (which could be a phone
// number, a cadastral fragment, a case number).
const ID_CODE_RE = /\b(\d{9})\b/;
/** Any legal-form marker — used to stop an id search before it crosses into
 * the NEXT company named in the same document. */
const NEXT_MARKER_RE = new RegExp(ENTITY_MARKER.source, 'g');

export function extractEntityCandidates(text: string | null | undefined, { windowChars = 120 }: { windowChars?: number } = {}): EntityCandidate[] {
  if (!text) return [];
  const out: EntityCandidate[] = [];
  let m: RegExpExecArray | null;
  ENTITY_NAME_RE.lastIndex = 0;
  while ((m = ENTITY_NAME_RE.exec(text))) {
    const marker = m[1].trim();
    /*
     * NAME BOUNDARY — the second half of the 3aa36828 mis-association fix.
     *
     * The name group runs to the next delimiter, so in a document that writes
     * two companies with NO punctuation between them —
     *
     *     "შპს ალფა 111111111 შპს ბეტა 222222222"
     *
     * — it swallowed both, producing ONE candidate named
     * "შპს ალფა 111111111 შპს ბეტა" carrying 222222222 (which belongs to
     * ბეტა), while ბეტა itself was never discovered at all. That is exactly
     * the Millenio/Artitexi failure mode, just without the comma that made
     * the first fix sufficient.
     *
     * So the name ends at whichever comes first inside it:
     *   - a 9-digit id  -> that id is THIS company's (nothing intervenes), or
     *   - the next legal-form marker -> everything after belongs to that one.
     *
     * The regex cursor is then rewound to the cut so the next company is
     * still matched, with a guard that always forces forward progress.
     */
    const nameGroup = m[2];
    const nameStart = m.index + m[0].length - nameGroup.length;

    NEXT_MARKER_RE.lastIndex = 0;
    const markerInName = NEXT_MARKER_RE.exec(nameGroup);
    const idInName = /\b(\d{9})\b/.exec(nameGroup);

    let cut = nameGroup.length;
    let inlineId: string | null = null;
    if (idInName && (!markerInName || idInName.index < markerInName.index)) {
      inlineId = idInName[1];
      cut = idInName.index;
    } else if (markerInName) {
      cut = markerInName.index;
    }

    const consumedTo = nameStart + cut + (inlineId ? inlineId.length : 0);
    // Never move the cursor backwards, and always advance past this marker.
    ENTITY_NAME_RE.lastIndex = Math.max(consumedTo, m.index + marker.length);

    const namePart = nameGroup.slice(0, cut).trim();
    const rawName = `${marker} ${namePart}`.replace(/\s+/g, ' ').trim();
    if (rawName.length < marker.length + 2) continue; // marker with no real name after it
    /*
     * ID PAIRING — production job 3aa36828-471a-4cd0-8a46-4e3f2b4c4c92.
     *
     * The window used to span BOTH sides of the name and accept the first
     * 9-digit number found anywhere in it. In a Tbilisi architecture-permit
     * response (docs.tbilisi.gov.ge/NewArchitectureResponse?documentId=
     * 1101896) the developer and the architect are named a few dozen
     * characters apart, so "შპს მილენიო გრუპი" was paired with 405068386 —
     * which the registry says is a different company entirely
     * (შპს არტიტექსი). That mis-association then scheduled a whole
     * enreg/rstax/debtor triple against the wrong entity.
     *
     * Two rules fix it deterministically:
     *   1. Look FORWARD from the end of the name only. In these documents the
     *      id follows its own company; text before the name belongs to
     *      whatever was named before it.
     *   2. Stop at the next entity marker. An id that sits beyond another
     *      "შპს"/"სს"/"ააიპ" belongs to THAT company, not this one.
     */
    const searchFrom = consumedTo;
    let searchTo = Math.min(text.length, searchFrom + windowChars);
    const forward = text.slice(searchFrom, searchTo);
    NEXT_MARKER_RE.lastIndex = 0;
    const nextMarker = NEXT_MARKER_RE.exec(forward);
    if (nextMarker) searchTo = searchFrom + nextMarker.index;
    const window = text.slice(searchFrom, searchTo);
    const idMatch = ID_CODE_RE.exec(window);
    // An id captured inside the name belongs to this company by construction.
    const idCode = inlineId ?? (idMatch ? idMatch[1] : null);
    // The validity guard still gets context from both sides.
    const contextWindow = text.slice(Math.max(0, m.index - windowChars), searchTo);
    // Secondary guard (Section 5): even with the marker regex tightened,
    // require the full candidate to independently look like a company
    // before queueing it — never a description of a permit/project that
    // merely happens to contain a legal-form word.
    if (!isValidCompanyCandidate(rawName, idCode, contextWindow)) continue;
    out.push({ name: rawName, idCode });
  }
  return out;
}

export class EntityQueue {
  private dedup = new EntityDeduplicator();

  add(candidate: EntityCandidate, ref: Partial<EntityDiscoveryRef> = {}): ResearchEntity | null {
    return this.dedup.merge(candidate, ref);
  }

  /** Scan a block of retrieved text (a page's own text, or one document's
   * extracted text) and merge every entity candidate found in it, all
   * tagged with the same shared discovery metadata. */
  scanText(text: string | null | undefined, ref: Partial<EntityDiscoveryRef> = {}): void {
    for (const c of extractEntityCandidates(text)) this.add(c, ref);
  }

  all(): ResearchEntity[] {
    return this.dedup.all();
  }

  getById(idCode: string): ResearchEntity | undefined {
    return this.dedup.getById(idCode);
  }

  /** See EntityDeduplicator.mergePreviousName() — folds a company's own
   * former/previous registered name into its existing record instead of
   * letting it surface as a separate "discovered related company". */
  recordPreviousName(idCode: string | null | undefined, previousName: string, opts: { from?: string | null; to?: string | null } = {}): void {
    if (!idCode || !previousName) return;
    this.dedup.mergePreviousName(idCode, previousName, opts);
  }

  /** Entities with a confirmed identification code — the only ones ENREG
   * can search deterministically by ID_CODE (mandate Section 12: "If
   * identifier exists, name search MUST NOT be preferred"). */
  confirmed(): ResearchEntity[] {
    return this.all().filter((e) => e.identificationCode !== null);
  }

  incomplete(): ResearchEntity[] {
    return this.all().filter((e) => e.identificationCode === null);
  }

  /** Entities not yet queued for ENREG research, confirmed-id-code first —
   * the orchestrator pulls from here (bounded by MAX_AUTO_ENREG_ENTITIES)
   * once all primary source steps for the job have run. */
  notYetQueued(): ResearchEntity[] {
    return this.confirmed().filter((e) => e.enregStatus === 'NOT_QUEUED');
  }

  markQueued(entityId: string): void {
    const e = this.all().find((x) => x.id === entityId);
    if (e) e.enregStatus = 'QUEUED';
  }

  markResult(entityId: string, status: ResearchEntity['enregStatus']): void {
    const e = this.all().find((x) => x.id === entityId);
    if (e) e.enregStatus = status;
  }
}
