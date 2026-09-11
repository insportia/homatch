// HOMATCH — what a finished verification teaches the graph.
//
// Every completed Verify should leave Homatch knowing more than it did. Not
// "a report exists for this code" — a report cannot be partially refreshed and
// cannot say which of its claims has gone out of date — but a set of facts,
// each with a source, a validity and a freshness class, that the next
// verification of this property, or of its neighbour in the same building, can
// stand on.
//
// WHAT MAY BE HARVESTED, AND WHAT MAY NOT
//
// Only STRUCTURED, EVIDENCED fields. Never the narrative. The report's prose is
// a model's interpretation of evidence written for one buyer; promoting it to
// shared truth would mean the next report cites the last report's writing as
// though it were a source, and after two rounds nobody can tell what was
// actually established.
//
// NOT FOUND IS NOT ABSENT, and this is where that rule earns its keep. The
// pipeline records "we could not confirm the encumbrances" as a status. That
// is a fact about OUR SEARCH, not about the property, and storing it would be
// worse than useless: a later verification would find it, treat it as known,
// and skip the check that was never completed. Only a status that positively
// establishes something is harvested.
//
// AN UNVERIFIED LINK IS NOT A LINK. When the research says the unit's
// connection to a project is unconfirmed, no relationship is written. That is
// how a developer's reputation gets attached to a building they never touched.

import { policyFor, type FreshnessClass, type FreshnessPolicy } from './freshness.ts';

export type EntityType =
  | 'PROPERTY_UNIT' | 'PARENT_PARCEL' | 'BUILDING' | 'PROJECT'
  | 'DEVELOPER' | 'COMPANY' | 'LOCATION' | 'LISTING';

export type KeyKind = 'CADASTRAL_CODE' | 'COMPANY_ID' | 'PROJECT_SLUG' | 'LISTING_URL' | 'LOCATION_SLUG';

export type SourceKind =
  | 'OFFICIAL_REGISTRY' | 'OFFICIAL_DOCUMENT' | 'PUBLIC_WEB' | 'MARKET_LISTING'
  | 'PARTNER_PUBLICATION' | 'DEVELOPER_STATEMENT' | 'MEDIA_REPORT' | 'DETERMINISTIC_DERIVATION';

export type RelationKind =
  | 'HAS_PARENT_PARCEL' | 'IN_BUILDING' | 'PART_OF_PROJECT' | 'DEVELOPED_BY'
  | 'IS_COMPANY' | 'LOCATED_IN' | 'LISTED_AS' | 'COMPARABLE_TO';

export interface HarvestedEntity {
  entityType: EntityType;
  keyKind: KeyKind;
  naturalKey: string;
  displayName?: string | null;
}

export interface HarvestedFact {
  entity: HarvestedEntity;
  factKey: string;
  valueText?: string | null;
  valueNumber?: number | null;
  valueJson?: unknown;
  valueUnit?: string | null;
  sourceKind: SourceKind;
  sourceRef?: string | null;
  evidenceRef?: string | null;
  confidence?: number | null;
  freshnessClass: FreshnessClass;
}

export interface HarvestedRelationship {
  from: HarvestedEntity;
  to: HarvestedEntity;
  relation: RelationKind;
  sourceKind: SourceKind;
  sourceRef?: string | null;
  evidenceRef?: string | null;
  confidence?: number | null;
}

export interface Harvest {
  entities: HarvestedEntity[];
  facts: HarvestedFact[];
  relationships: HarvestedRelationship[];
  /** Things deliberately NOT harvested, and why. Internal diagnostics. */
  skipped: { what: string; why: string }[];
}

/* ------------------------------------------------------------------ *
 * Normalisation                                                       *
 * ------------------------------------------------------------------ */

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** Groups of a Georgian cadastral code. Five is a parcel; more is a unit in one. */
export const PARCEL_GROUPS = 5;

/**
 * A cadastral code, stripped of everything that is not part of it.
 *
 * The same property arrives spelled several ways — spaces inside the code,
 * a stray label, full-width punctuation. Without normalising, one flat becomes
 * several entities and the graph learns nothing.
 */
export function normalizeCadastral(v: unknown): string | null {
  const t = text(v).replace(/\s+/g, '');
  if (!/^[\d.]+$/.test(t)) return null;
  const groups = t.split('.').filter(Boolean);
  if (groups.length < PARCEL_GROUPS) return null;
  return groups.join('.');
}

/** A company identification code: nine digits in Georgia, and nothing else. */
export function normalizeCompanyId(v: unknown): string | null {
  const t = text(v).replace(/\D/g, '');
  return t.length === 9 ? t : null;
}

/**
 * A stable key for a project name.
 *
 * Lower-cased, punctuation removed, whitespace collapsed. Deliberately not
 * transliterated: two spellings of one project become two entities, which is
 * a real limitation and a smaller error than merging two different projects
 * that happen to share a word.
 */
export function projectSlug(v: unknown): string | null {
  const t = text(v).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
  return t.length >= 3 ? t : null;
}

/** The parent parcel a unit code sits inside, or null when it is already one. */
export function parentParcelOf(code: string): string | null {
  const groups = code.split('.');
  return groups.length > PARCEL_GROUPS ? groups.slice(0, PARCEL_GROUPS).join('.') : null;
}

const CONFIDENCE: Record<string, number> = { HIGH: 0.9, MEDIUM: 0.6, LOW: 0.3 };

/**
 * Which statuses actually establish something.
 *
 * CONFIRMED_POSITIVE and CONFIRMED_NEGATIVE are findings: a source was
 * checked and said so. NOT_CONFIRMED, UNKNOWN and the rest describe our
 * search, and a later verification that found one of those stored as a fact
 * would treat the unfinished check as done.
 */
const ESTABLISHED = new Set(['CONFIRMED_POSITIVE', 'CONFIRMED_NEGATIVE', 'CONFIRMED']);

/* ------------------------------------------------------------------ *
 * The harvest                                                         *
 * ------------------------------------------------------------------ */

export function harvestReport(
  report: Record<string, unknown> | null | undefined,
  policies: readonly FreshnessPolicy[] | null | undefined
): Harvest {
  const out: Harvest = { entities: [], facts: [], relationships: [], skipped: [] };
  if (!report || typeof report !== 'object') return out;

  const freshnessFor = (factKey: string): FreshnessClass =>
    policyFor(factKey, policies)?.freshness_class ?? 'MEDIUM_VOLATILITY';

  const entity = (e: HarvestedEntity): HarvestedEntity => {
    if (!out.entities.some((x) => x.keyKind === e.keyKind && x.naturalKey === e.naturalKey)) {
      out.entities.push(e);
    }
    return e;
  };

  const fact = (f: Omit<HarvestedFact, 'freshnessClass'>): void => {
    const hasValue =
      (f.valueText != null && String(f.valueText).trim() !== '') ||
      f.valueNumber != null ||
      (f.valueJson != null && (!Array.isArray(f.valueJson) || f.valueJson.length > 0));
    if (!hasValue) return;
    out.facts.push({ ...f, freshnessClass: freshnessFor(f.factKey) });
  };

  /* ── the property itself ───────────────────────────────────────────── */

  const unitCode = normalizeCadastral((report.exactUnit as any)?.code);
  const unit = unitCode
    ? entity({
        entityType: parentParcelOf(unitCode) ? 'PROPERTY_UNIT' : 'PARENT_PARCEL',
        keyKind: 'CADASTRAL_CODE',
        naturalKey: unitCode,
        displayName: text((report.exactUnit as any)?.name) || unitCode,
      })
    : null;

  /*
   * THE PARENT PARCEL, DERIVED RATHER THAN BELIEVED.
   *
   * A Georgian cadastral code nests: five groups is a parcel, and anything
   * longer is a unit inside that exact parcel. So when the codes genuinely
   * nest, the relationship is arithmetic and needs no external evidence —
   * that is precisely what a deterministic derivation is.
   *
   * When the report NAMES a parent that is not a prefix of the unit code,
   * that is somebody's claim rather than arithmetic, and it is recorded as a
   * claim with the report's own confidence attached — or skipped entirely if
   * the report itself is unsure.
   */
  if (unit && unitCode) {
    const derivedParent = parentParcelOf(unitCode);
    const claimedParent = normalizeCadastral((report.identifiedParent as any)?.code);

    if (derivedParent) {
      const parcel = entity({
        entityType: 'PARENT_PARCEL',
        keyKind: 'CADASTRAL_CODE',
        naturalKey: derivedParent,
        displayName: text((report.identifiedParent as any)?.name) || derivedParent,
      });
      out.relationships.push({
        from: unit, to: parcel, relation: 'HAS_PARENT_PARCEL',
        sourceKind: 'DETERMINISTIC_DERIVATION',
        evidenceRef: 'exactUnit.code',
        confidence: 1,
      });
      fact({
        entity: unit, factKey: 'parcel.code', valueText: derivedParent,
        sourceKind: 'DETERMINISTIC_DERIVATION', evidenceRef: 'exactUnit.code', confidence: 1,
      });
    }

    if (claimedParent && derivedParent && claimedParent !== derivedParent) {
      out.skipped.push({
        what: `identifiedParent ${claimedParent}`,
        why: `does not contain the unit code ${unitCode}; a named parent that is not a prefix is a claim, not the hierarchy`,
      });
    }
  }

  /*
   * WHAT KIND OF PROPERTY THIS IS.
   *
   * Read off the report's own classification rather than guessed, and stored
   * because the next verification needs it before it has researched anything:
   * a private resale has no commissioning status to establish, and a planner
   * that does not know that counts it as MISSING on every run and can never
   * reuse the public research it already paid for.
   *
   * MIXED_OR_UNKNOWN is deliberately not stored. "We could not classify it"
   * is a fact about our research, and storing it would let a later run treat
   * an unclassified property as classified.
   */
  if (unit) {
    const assetClass = text(report.assetClass).toUpperCase();
    if (assetClass && assetClass !== 'MIXED_OR_UNKNOWN') {
      fact({
        entity: unit, factKey: 'property.assetClass', valueText: assetClass,
        sourceKind: 'DETERMINISTIC_DERIVATION', evidenceRef: 'assetClass', confidence: 0.8,
      });
    }
  }

  /* ── the registry checks that actually established something ───────── */

  const legal = (report.legalStatus ?? {}) as Record<string, any>;
  for (const [key, block] of Object.entries(legal)) {
    if (!block || typeof block !== 'object') continue;
    const status = text(block.status).toUpperCase();
    if (!status) continue;
    if (!ESTABLISHED.has(status)) {
      // A fact about our search, not about the property. Storing it would let
      // a later verification treat an unfinished check as a completed one.
      out.skipped.push({ what: `legalStatus.${key}`, why: `status ${status} establishes nothing` });
      continue;
    }
    if (!unit) continue;
    fact({
      entity: unit,
      factKey: `registry.${key}`,
      valueText: status,
      valueJson: { label: text(block.label) || null },
      sourceKind: 'OFFICIAL_REGISTRY',
      evidenceRef: `legalStatus.${key}`,
      confidence: 0.9,
    });
  }

  /* ── the company ───────────────────────────────────────────────────── */

  const companyProfile = (report.companyProfile ?? {}) as Record<string, any>;
  const companyId = normalizeCompanyId(companyProfile.idCode);
  const registryBacked = text(companyProfile.sourceBasis).toUpperCase() === 'REGISTRY_CONFIRMED';
  const companySource: SourceKind = registryBacked ? 'OFFICIAL_REGISTRY' : 'PUBLIC_WEB';

  const company = companyId
    ? entity({
        entityType: 'COMPANY',
        keyKind: 'COMPANY_ID',
        naturalKey: companyId,
        displayName: text(companyProfile.name) || companyId,
      })
    : null;

  if (company) {
    for (const [field, factKey] of [
      ['name', 'company.name'],
      ['legalForm', 'company.legalForm'],
      ['status', 'company.status'],
      ['registrationDate', 'company.registrationDate'],
    ] as const) {
      fact({
        entity: company, factKey, valueText: text(companyProfile[field]) || null,
        sourceKind: companySource, evidenceRef: `companyProfile.${field}`,
        confidence: registryBacked ? 0.9 : 0.6,
      });
    }
    // Directors are people, and only the names and the representation mode —
    // never the personal identification numbers that sit beside them in the
    // registry extract.
    const directors = Array.isArray(companyProfile.directors)
      ? companyProfile.directors.map((d: unknown) => text(d)).filter(Boolean)
      : [];
    if (directors.length) {
      fact({
        entity: company, factKey: 'company.directors', valueJson: directors,
        sourceKind: companySource, evidenceRef: 'companyProfile.directors',
        confidence: registryBacked ? 0.9 : 0.6,
      });
    }
    if (text(companyProfile.representation)) {
      fact({
        entity: company, factKey: 'company.representation',
        valueText: text(companyProfile.representation),
        sourceKind: companySource, evidenceRef: 'companyProfile.representation',
        confidence: registryBacked ? 0.9 : 0.6,
      });
    }
  }

  /* ── the project ───────────────────────────────────────────────────── */

  const projectProfile = (report.projectProfile ?? {}) as Record<string, any>;
  const slug = projectSlug(projectProfile.name);
  const project = slug
    ? entity({
        entityType: 'PROJECT',
        keyKind: 'PROJECT_SLUG',
        naturalKey: slug,
        displayName: text(projectProfile.name),
      })
    : null;

  if (project) {
    const num = (v: unknown): number | null => {
      const m = text(v).match(/\d+(?:[.,]\d+)?/);
      if (!m) return null;
      const x = Number(m[0].replace(',', '.'));
      return Number.isFinite(x) ? x : null;
    };

    fact({ entity: project, factKey: 'project.floors', valueNumber: num(projectProfile.floors), sourceKind: 'PUBLIC_WEB', evidenceRef: 'projectProfile.floors', confidence: 0.6 });
    fact({ entity: project, factKey: 'project.buildings', valueNumber: num(projectProfile.buildings), sourceKind: 'PUBLIC_WEB', evidenceRef: 'projectProfile.buildings', confidence: 0.6 });
    fact({ entity: project, factKey: 'project.units', valueNumber: num(projectProfile.unitCounts), sourceKind: 'PUBLIC_WEB', evidenceRef: 'projectProfile.unitCounts', confidence: 0.6 });
    fact({ entity: project, factKey: 'address.full', valueText: text(projectProfile.address) || null, sourceKind: 'PUBLIC_WEB', evidenceRef: 'projectProfile.address', confidence: 0.6 });
    fact({ entity: project, factKey: 'project.identity', valueText: text(projectProfile.name) || null, sourceKind: 'PUBLIC_WEB', evidenceRef: 'projectProfile.name', confidence: 0.6 });

    const aliases = Array.isArray(projectProfile.aliases)
      ? projectProfile.aliases.map((a: unknown) => text(a)).filter(Boolean)
      : [];
    fact({ entity: project, factKey: 'project.aliases', valueJson: aliases, sourceKind: 'PUBLIC_WEB', evidenceRef: 'projectProfile.aliases', confidence: 0.6 });

    const amenities = Array.isArray(projectProfile.amenities)
      ? projectProfile.amenities.map((a: unknown) => text(a)).filter(Boolean)
      : [];
    fact({ entity: project, factKey: 'amenities.list', valueJson: amenities, sourceKind: 'DEVELOPER_STATEMENT', evidenceRef: 'projectProfile.amenities', confidence: 0.5 });

    /*
     * The developer link, only where the company is actually identified.
     *
     * A developer NAME with no identification code is a string, and attaching
     * a reputation to a string is how the wrong company ends up in somebody's
     * report.
     */
    if (company) {
      out.relationships.push({
        from: project, to: company, relation: 'DEVELOPED_BY',
        sourceKind: companySource, evidenceRef: 'projectProfile.developerCompany',
        confidence: registryBacked ? 0.9 : 0.6,
      });
    } else if (text(projectProfile.developer)) {
      out.skipped.push({
        what: `developer "${text(projectProfile.developer)}"`,
        why: 'named without an identification code, so the company cannot be identified',
      });
    }

    /*
     * THE UNIT'S LINK TO THE PROJECT IS NOT AUTOMATIC.
     *
     * The research says outright when it could not tie the exact unit to the
     * project, and a real report in production says exactly that. Writing the
     * relationship anyway would attach this project — and its developer, and
     * its reputation — to a flat nobody has shown belongs to it.
     */
    if (unit) {
      const unitVerified = (report.exactUnit as any)?.verified === true;
      if (unitVerified) {
        out.relationships.push({
          from: unit, to: project, relation: 'PART_OF_PROJECT',
          sourceKind: 'OFFICIAL_REGISTRY', evidenceRef: 'exactUnit.verified',
          confidence: CONFIDENCE[text((report.identifiedParent as any)?.confidence).toUpperCase()] ?? 0.8,
        });
      } else {
        out.skipped.push({
          what: `${unitCode} → project ${slug}`,
          why: 'the research did not verify that this exact unit belongs to this project',
        });
      }
    }
  }

  return out;
}
