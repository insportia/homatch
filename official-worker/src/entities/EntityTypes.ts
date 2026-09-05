// EntityTypes.ts — mandate Section 16 ("Entity Queue"). A ResearchEntity is
// a company or person discovered while researching a property on any
// official source or document — never a primary search of its own, always
// something FOUND while reading something else.

export type EntityType = 'LEGAL_ENTITY' | 'PERSON';

/** Where ENREG research for this entity currently stands. NOT_QUEUED means
 * it was discovered but the orchestrator has not (yet, or ever, due to the
 * MAX_AUTO_ENREG_ENTITIES bound) scheduled an ENREG workflow for it. */
export type EnregEntityStatus = 'NOT_QUEUED' | 'QUEUED' | 'RESEARCHED' | 'NO_MATCH' | 'SKIPPED';

export interface EntityDiscoveryRef {
  source: string | null;
  sourceDocument: string | null;
  documentDate: string | null;
  relationship: string | null;
  evidenceRef: string | null;
  retrievedAt: string | null;
}

export interface ResearchEntity {
  id: string;
  type: EntityType;
  name: string;
  /** The registry identification code — the preferred, reliable dedup key.
   * null for a name-only candidate awaiting an id-code discovery
   * elsewhere (mandate: "name-only entities queue as incomplete candidates
   * and get merged/upgraded when an ID appears later"). */
  identificationCode: string | null;
  discoveredFrom: EntityDiscoveryRef[];
  enregStatus: EnregEntityStatus;
}
