// EntityDeduplicator.ts — the pure merge-by-identity algorithm behind
// EntityQueue (mandate Section 16: "ID is the preferred canonical dedup
// key ... name-only entities queue as incomplete candidates and get merged/
// upgraded when an ID appears later"). Extracted as its own module so the
// merge RULES are independently unit-testable from the queue's bookkeeping.
//
// Ported from the pre-refactor lib/entityDiscovery.js's EntityLedger merge
// logic (already correct and unit-tested) — behavior unchanged, only the
// storage shape moved to the new ResearchEntity type and explicit
// EnregEntityStatus.
import type { ResearchEntity, EntityDiscoveryRef, EntityType } from './EntityTypes.js';
import { looksLikeCompanyId } from './EntityValidation.js';

export const normalizeName = (n: string | null | undefined): string =>
  String(n || '')
    .toLowerCase()
    .replace(/[«»"“”'„“]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

export interface EntityCandidate {
  name: string;
  idCode: string | null;
  type?: EntityType;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `ent_${Date.now().toString(36)}_${counter}`;
}

export class EntityDeduplicator {
  private byId = new Map<string, ResearchEntity>();
  private byName = new Map<string, ResearchEntity>();

  /**
   * Merge one discovered candidate into the store. Never merges two
   * DIFFERENT id codes into one record (a name collision between two real,
   * distinct companies is a known real-world case — e.g. common LLC
   * names — and must not corrupt either record); upgrades a name-only
   * INCOMPLETE candidate to CONFIRMED the moment an id-code discovery for
   * the same normalized name arrives.
   */
  merge(candidate: EntityCandidate, ref: Partial<EntityDiscoveryRef> = {}): ResearchEntity | null {
    if (!candidate?.name) return null;
    const nameKey = normalizeName(candidate.name);
    if (!nameKey) return null;
    // Required invariant (2026-09-06 production-trace mandate): never let a
    // name (or any other non-numeric string) masquerade as a registry
    // identification code inside the EntityQueue — confirmed()/
    // notYetQueued() treat identificationCode !== null as "safe to search
    // deterministically by ID_CODE" and to auto-queue for
    // RS_TAXPAYER/DEBTOR (neither of which has a name fallback of its
    // own), so a corrupted idCode here would silently propagate well
    // beyond ENREG.
    const idCode = looksLikeCompanyId(candidate.idCode) ? candidate.idCode : null;
    const existingById = idCode ? this.byId.get(idCode) : undefined;
    const existingByName = this.byName.get(nameKey);
    let rec = existingById || existingByName;

    if (!rec) {
      rec = {
        id: nextId(),
        type: candidate.type || 'LEGAL_ENTITY',
        name: candidate.name,
        identificationCode: idCode,
        previousNames: [],
        discoveredFrom: [],
        enregStatus: 'NOT_QUEUED',
      };
      this.byName.set(nameKey, rec);
      if (rec.identificationCode) this.byId.set(rec.identificationCode, rec);
    } else if (idCode && !rec.identificationCode) {
      rec.identificationCode = idCode;
      this.byId.set(rec.identificationCode, rec);
    } else if (idCode && rec.identificationCode && rec.identificationCode !== idCode) {
      rec = {
        id: nextId(),
        type: candidate.type || 'LEGAL_ENTITY',
        name: candidate.name,
        identificationCode: idCode,
        previousNames: [],
        discoveredFrom: [],
        enregStatus: 'NOT_QUEUED',
      };
      this.byId.set(idCode, rec);
    }

    rec.discoveredFrom.push({
      source: ref.source ?? null,
      sourceDocument: ref.sourceDocument ?? null,
      documentDate: ref.documentDate ?? null,
      relationship: ref.relationship ?? null,
      evidenceRef: ref.evidenceRef ?? null,
      retrievedAt: ref.retrievedAt ?? null,
    });
    return rec;
  }

  all(): ResearchEntity[] {
    return [...new Set([...this.byId.values(), ...this.byName.values()])];
  }

  getById(idCode: string): ResearchEntity | undefined {
    return this.byId.get(idCode);
  }

  /**
   * Records a former/previous registered name for the company identified by
   * `idCode` (mandate Section 6: "company ID is the identity anchor"). If a
   * SEPARATE phantom record already exists under that previous name's
   * normalized key (because it was discovered as a bare name mention before
   * its link to this company ID was known — exactly the real production
   * bug), that phantom is absorbed into the real record instead of being
   * left as a second, unlinked "discovered company": its discovery
   * references and any previousNames it had already collected are merged
   * in, and the name key is repointed at the real record so it drops out of
   * all() on its own. A no-op when idCode is unknown or the "previous" name
   * is actually just the current name restated.
   */
  mergePreviousName(idCode: string, previousName: string, opts: { from?: string | null; to?: string | null } = {}): void {
    const rec = this.byId.get(idCode);
    if (!rec) return;
    const nameKey = normalizeName(previousName);
    if (!nameKey || nameKey === normalizeName(rec.name)) return;

    if (!rec.previousNames.some((p) => normalizeName(p.name) === nameKey)) {
      rec.previousNames.push({ name: previousName, from: opts.from ?? null, to: opts.to ?? null });
    }

    const phantom = this.byName.get(nameKey);
    if (phantom && phantom !== rec) {
      rec.discoveredFrom.push(...phantom.discoveredFrom);
      for (const pn of phantom.previousNames || []) {
        if (!rec.previousNames.some((p) => normalizeName(p.name) === normalizeName(pn.name))) rec.previousNames.push(pn);
      }
      // Phantom's own idCode (if any) was already required to differ from
      // idCode here (same-idCode would have made it `rec` itself via
      // byId.get()), so it is left untouched in byId — only the shared name
      // key is repointed. A genuinely different real company must never be
      // silently absorbed just because it once shared a name string.
      if (!phantom.identificationCode) this.byName.set(nameKey, rec);
    }
  }
}
