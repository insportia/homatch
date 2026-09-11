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

      /*
       * THE PROJECT IS ON THE LAND, WHICH IS A DIFFERENT CLAIM.
       *
       * Measured in production: with only the unit→project link available and
       * correctly refused, seven researched project facts sat in the graph
       * unreachable, and reuse came out at 3 facts of 18. The expensive
       * research was already paid for and could not be found again.
       *
       * But a project standing on a parcel is a PARCEL-level statement, and a
       * far better supported one: this verification researched this parcel
       * and that research produced this project. Recording it is recording
       * what we actually did, with the job as its evidence.
       *
       * It is emphatically NOT the claim that was refused above. "This flat
       * is in that development" needs the registry to say so. "That
       * development is on this land" does not, and the two must never be
       * collapsed — which is exactly why this edge hangs off the PARCEL and
       * the loader keeps parcel facts in a separate bucket from the unit's
       * own. A parent-parcel fact is still not an exact-unit fact.
       */
      const derivedParent = unitCode ? parentParcelOf(unitCode) : null;
      if (derivedParent) {
        const parcel = entity({
          entityType: 'PARENT_PARCEL',
          keyKind: 'CADASTRAL_CODE',
          naturalKey: derivedParent,
        });
        out.relationships.push({
          from: parcel, to: project, relation: 'PART_OF_PROJECT',
          sourceKind: 'PUBLIC_WEB', evidenceRef: 'projectProfile',
          confidence: 0.5,
        });
      }
    }
  }

  /* ── the comparables ───────────────────────────────────────────────── */

  harvestComparables(report, unit, entity, fact, out);

  return out;
}

/**
 * At most this many listings per verification.
 *
 * A report typically carries seven. The cap exists so a run that somehow
 * returns hundreds cannot flood the graph with listings nobody will look at
 * again — the value is in the few genuinely comparable ones, which is the
 * same reason the market module scores them in the first place.
 */
export const MAX_COMPARABLES_HARVESTED = 20;

/**
 * A stable identity for a listing.
 *
 * The URL, stripped of the query string and fragment — trackers and session
 * parameters differ between two sightings of the same page and would make one
 * flat into several listings, which is exactly what breaks a price history.
 */
export function listingKey(url: unknown): string | null {
  const u = text(url);
  if (!/^https?:\/\//i.test(u)) return null;
  return u.split('#')[0].split('?')[0].replace(/\/+$/, '').toLowerCase() || null;
}

/*
 * WHY COMPARABLES LIVE IN THE SAME GRAPH AS EVERYTHING ELSE.
 *
 * A listing is an entity, its price is a fact about that entity, and a price
 * that changes is a fact that supersedes another. So the price history the
 * mandate asks for — 160000 → 155000, with both provenances and the date the
 * first stopped being true — falls out of the machinery already built rather
 * than needing a table of its own. So does status history: ACTIVE → EXPIRED
 * is the same mechanism.
 *
 * The alternative, a separate comparables store, would be a second knowledge
 * system beside the first, and every read would have to ask which of the two
 * was right.
 *
 * Nothing here decides anything about the market. The medians, the bands and
 * the positioning stay deterministic in marketIntelligence.ts, computed from
 * the comparables in hand — a model never recomputes them and the graph never
 * caches a conclusion, only the observations underneath it.
 */
function harvestComparables(
  report: Record<string, unknown>,
  subject: HarvestedEntity | null,
  entity: (e: HarvestedEntity) => HarvestedEntity,
  fact: (f: Omit<HarvestedFact, 'freshnessClass'>) => void,
  out: Harvest
): void {
  const raw = (report.market as any)?.comparables;
  if (!Array.isArray(raw)) return;

  let kept = 0;
  const seen = new Set<string>();

  for (const c of raw) {
    if (kept >= MAX_COMPARABLES_HARVESTED) break;
    if (!c || typeof c !== 'object') continue;

    const key = listingKey(c.url);
    // A listing with no URL cannot be recognised again, so it cannot have a
    // history and is not worth storing as an entity. It still counts towards
    // this verification's own statistics, which is computed elsewhere.
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept += 1;

    const listing = entity({
      entityType: 'LISTING',
      keyKind: 'LISTING_URL',
      naturalKey: key,
      displayName: text(c.project) || text(c.address) || key,
    });

    const evidence = `market.comparables[${key}]`;
    const num = (v: unknown): number | null => {
      const n = Number(text(v).replace(/[^\d.-]/g, ''));
      return Number.isFinite(n) && n > 0 ? n : null;
    };

    // The price and the status are what actually move, and each change becomes
    // a superseded row with the date it stopped being true.
    fact({ entity: listing, factKey: 'listing.price', valueNumber: num(c.price), valueUnit: text(c.currency) || 'USD', sourceKind: 'MARKET_LISTING', sourceRef: key, evidenceRef: evidence, confidence: 0.7 });
    fact({ entity: listing, factKey: 'listing.pricePerSqm', valueNumber: num(c.pricePerSqm), valueUnit: text(c.currency) || 'USD', sourceKind: 'MARKET_LISTING', sourceRef: key, evidenceRef: evidence, confidence: 0.7 });
    fact({ entity: listing, factKey: 'listing.status', valueText: text(c.listingStatus).toUpperCase() || null, sourceKind: 'MARKET_LISTING', sourceRef: key, evidenceRef: evidence, confidence: 0.7 });

    // The rest describes the flat and essentially does not move, so a second
    // sighting confirms it rather than rewriting it.
    fact({ entity: listing, factKey: 'listing.area', valueNumber: num(c.area), valueUnit: 'm2', sourceKind: 'MARKET_LISTING', sourceRef: key, evidenceRef: evidence, confidence: 0.7 });
    fact({ entity: listing, factKey: 'listing.rooms', valueNumber: num(c.rooms), sourceKind: 'MARKET_LISTING', sourceRef: key, evidenceRef: evidence, confidence: 0.7 });
    fact({ entity: listing, factKey: 'listing.floor', valueText: text(c.floor) || null, sourceKind: 'MARKET_LISTING', sourceRef: key, evidenceRef: evidence, confidence: 0.7 });
    fact({ entity: listing, factKey: 'listing.condition', valueText: text(c.condition) || null, sourceKind: 'MARKET_LISTING', sourceRef: key, evidenceRef: evidence, confidence: 0.7 });
    fact({ entity: listing, factKey: 'listing.address', valueText: text(c.address) || null, sourceKind: 'MARKET_LISTING', sourceRef: key, evidenceRef: evidence, confidence: 0.7 });
    fact({ entity: listing, factKey: 'listing.source', valueText: text(c.source) || null, sourceKind: 'MARKET_LISTING', sourceRef: key, evidenceRef: evidence, confidence: 0.7 });

    /*
     * The link to what it was a comparable FOR.
     *
     * Recorded because a comparable is only comparable to something: the same
     * listing is a close comparison for the flat next door and a poor one for
     * a warehouse across the city, and the band it fell into was a judgement
     * this verification made about this property.
     */
    if (subject) {
      /*
       * FROM THE PROPERTY TO THE LISTING, not the other way round.
       *
       * The question ever asked is "what was this property compared against",
       * and the graph is walked outward from the property. Recorded the other
       * way, the comparables sat one edge away in the wrong direction and
       * were unreachable from the only place anyone starts — which is exactly
       * what the production graph showed.
       */
      out.relationships.push({
        from: subject, to: listing, relation: 'COMPARABLE_TO',
        sourceKind: 'MARKET_LISTING', sourceRef: key, evidenceRef: evidence,
        confidence: 0.6,
      });
    }
  }
}
