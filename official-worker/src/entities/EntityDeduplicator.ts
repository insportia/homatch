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
    const existingById = candidate.idCode ? this.byId.get(candidate.idCode) : undefined;
    const existingByName = this.byName.get(nameKey);
    let rec = existingById || existingByName;

    if (!rec) {
      rec = {
        id: nextId(),
        type: candidate.type || 'LEGAL_ENTITY',
        name: candidate.name,
        identificationCode: candidate.idCode || null,
        discoveredFrom: [],
        enregStatus: 'NOT_QUEUED',
      };
      this.byName.set(nameKey, rec);
      if (rec.identificationCode) this.byId.set(rec.identificationCode, rec);
    } else if (candidate.idCode && !rec.identificationCode) {
      rec.identificationCode = candidate.idCode;
      this.byId.set(rec.identificationCode, rec);
    } else if (candidate.idCode && rec.identificationCode && rec.identificationCode !== candidate.idCode) {
      rec = {
        id: nextId(),
        type: candidate.type || 'LEGAL_ENTITY',
        name: candidate.name,
        identificationCode: candidate.idCode,
        discoveredFrom: [],
        enregStatus: 'NOT_QUEUED',
      };
      this.byId.set(candidate.idCode, rec);
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
}
