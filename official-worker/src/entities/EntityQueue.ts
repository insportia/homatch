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
const ENTITY_MARKER = /(?:შპს|ააიპ|სს|ინდივიდუალურ(?:ი|მა|ის|ს)?\s+მეწარმე)/;
const ENTITY_NAME_RE = new RegExp(`(${ENTITY_MARKER.source})\\s*[«"“”'„“]?\\s*([^,.;\\n()«»"“”]{2,80})`, 'g');
// Georgian legal-entity id codes are 9-digit numbers; only accepted within
// a short window of a matched entity name (same sentence/line), never as a
// bare 9-digit number found anywhere in a document (which could be a phone
// number, a cadastral fragment, a case number).
const ID_CODE_RE = /\b(\d{9})\b/;

export function extractEntityCandidates(text: string | null | undefined, { windowChars = 120 }: { windowChars?: number } = {}): EntityCandidate[] {
  if (!text) return [];
  const out: EntityCandidate[] = [];
  let m: RegExpExecArray | null;
  ENTITY_NAME_RE.lastIndex = 0;
  while ((m = ENTITY_NAME_RE.exec(text))) {
    const marker = m[1].trim();
    const rawName = `${marker} ${m[2].trim()}`.replace(/\s+/g, ' ').trim();
    if (rawName.length < marker.length + 2) continue; // marker with no real name after it
    const start = Math.max(0, m.index - windowChars);
    const end = Math.min(text.length, m.index + m[0].length + windowChars);
    const window = text.slice(start, end);
    const idMatch = ID_CODE_RE.exec(window);
    const idCode = idMatch ? idMatch[1] : null;
    // Secondary guard (Section 5): even with the marker regex tightened,
    // require the full candidate to independently look like a company
    // before queueing it — never a description of a permit/project that
    // merely happens to contain a legal-form word.
    if (!isValidCompanyCandidate(rawName, idCode, window)) continue;
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
