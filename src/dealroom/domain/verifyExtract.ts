// HOMATCH — Verify report -> normalized evidence.
//
// This is the single bridge between the Verify pipeline's `result_json` and
// every downstream product surface (synthesis, buyer plan, Deal Room, Ask
// Homatch AI). Nothing else may read raw report fields: if a new surface
// needs a fact, it is added here once, as a claim with provenance, and every
// consumer gets it.
//
// THE ONE RULE: NO EVIDENCE = NO FACT.
//
// Every claim emitted below carries a `source`. normalizeEvidence() drops any
// claim without one, so a field that Verify left empty simply produces no
// claim — it never becomes a fact, and it never becomes a NEGATIVE fact
// either. "We could not check the debtor registry" and "the owner is not in
// the debtor registry" are different statements, and only the second one is
// evidence. The second is emitted with `negative: true`; the first is emitted
// as nothing at all and shows up in the "could not verify" section instead.
//
// TECHNICAL FAILURE IS NOT PROPERTY RISK. A CAPTCHA that could not be
// completed, a blocked datacenter IP or a crashed worker says something about
// our infrastructure and nothing about the property. Those outcomes are
// collected separately by technicalOutcomes() and are deliberately NOT
// convertible into claims, so computeVerdict() cannot see them.

import type { RawClaim } from '../planning/evidence.ts';

/* ------------------------------------------------------------------ *
 * The subset of Verify's result_json this module reads.                *
 * Deliberately structural and permissive: result_json is produced by a *
 * long-lived pipeline and older jobs will be missing newer fields.     *
 * ------------------------------------------------------------------ */

export interface VerifyReportLike {
  queryType?: string;
  entityName?: string;
  entityType?: string;
  summary?: string;
  identifiedParent?: { code?: string; name?: string; address?: string; developer?: string } | null;
  exactUnit?: Record<string, unknown> | null;
  projectProfile?: Record<string, unknown> | null;
  companyProfile?: Record<string, unknown> | null;
  landProfile?: Record<string, unknown> | null;
  rightsAndRestrictions?: {
    status?: string;
    items?: string[];
    statement?: string;
    asOf?: string;
  } | null;
  legalStatus?: Record<string, { status?: string; statement?: string; evidenceUrl?: string } | undefined> | null;
  market?: Record<string, unknown> | null;
  technicalFacts?: { category?: string; key?: string; value?: string; documentTitle?: string | null; documentDate?: string | null }[] | null;
  officialDocumentsRetrieved?: { source?: string; sourceName?: string; url?: string; title?: string | null; date?: string | null; parsed?: boolean }[];
  officialSourceCoverage?: { source?: string; sourceName?: string; customerStatus?: string }[];
  discoveredEntities?: Record<string, unknown>[];
  sources?: { label?: string; url?: string; sourceCategory?: string }[];
  [k: string]: unknown;
}

/** A source outcome that says something about US, never about the property. */
export interface TechnicalOutcome {
  source: string;
  sourceName: string;
  /** Verify's own customer-facing status vocabulary. */
  status: 'CAPTCHA_REQUIRED' | 'BLOCKED' | 'TECHNICAL_FAILED';
}

/** Sources that were genuinely checked and genuinely produced nothing. */
export interface CheckedOutcome {
  source: string;
  sourceName: string;
  status: 'SUCCESS' | 'NO_RESULT' | 'NOT_CONFIRMED';
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');
const nonEmpty = (v: unknown): string | null => {
  const s = str(v);
  return s.length ? s : null;
};

/** Verify writes markdown emphasis into some prose fields. Customers must
 * never see the asterisks, and neither should a canonicalized fact value. */
const clean = (v: unknown): string =>
  str(v)
    .replace(/\*\*/g, '')
    .replace(/#{1,6}\s*/g, '')
    .trim();

/* ------------------------------------------------------------------ *
 * Source identity                                                     *
 * ------------------------------------------------------------------ */

// Stable internal keys. These appear in `groundedIn` strings and in the
// `grounded_in` column, so they must not drift; the customer-facing name is
// resolved separately at render time and is never persisted as identity.
export const SOURCE_KEYS = Object.freeze({
  REGISTRY: 'napr.registry',
  REGISTRY_DOC: 'napr.document',
  DEBTOR: 'enforcement.debtors',
  TAXPAYER: 'rs.taxpayer',
  COMPANY: 'napr.enreg',
  PERMITS: 'mygov.permits',
  MAP: 'napr.map',
  MARKET: 'market.listings',
  REPORT: 'verify.report',
});

/* ------------------------------------------------------------------ *
 * Claim extraction                                                    *
 * ------------------------------------------------------------------ */

function pushIf(
  out: RawClaim[],
  type: string,
  value: unknown,
  source: string,
  extra: Partial<RawClaim> = {}
): void {
  const v = typeof value === 'string' ? clean(value) : value;
  if (v === null || v === undefined || v === '' || v === false) return;
  out.push({ type, value: v, source, ...extra });
}

/**
 * Property identity: what was actually verified.
 *
 * `exactUnit` is authoritative when present — for a cadastral query Verify
 * deterministically forces it back to the literal code the customer typed, so
 * it is the one field that cannot have drifted onto a neighbouring parcel.
 */
function extractIdentity(r: VerifyReportLike, out: RawClaim[]): void {
  const unit = (r.exactUnit ?? {}) as Record<string, unknown>;
  const parent = r.identifiedParent ?? {};
  const src = SOURCE_KEYS.REGISTRY;

  pushIf(out, 'property.cadastralCode', unit.cadastralCode ?? unit.code ?? parent.code, src);
  pushIf(out, 'property.address', unit.address ?? parent.address, src);
  pushIf(out, 'property.unitNumber', unit.unitNumber ?? unit.apartmentNumber, src);
  pushIf(out, 'property.area', unit.area ?? unit.totalArea, src);
  pushIf(out, 'property.floor', unit.floor, src);

  const kind = str(unit.propertyKind ?? unit.kind ?? r.entityType).toUpperCase();
  if (/LAND|მიწ/.test(kind)) pushIf(out, 'property.kind', 'LAND', src);
  else if (/COMMERCIAL|კომერცი/.test(kind)) pushIf(out, 'property.kind', 'COMMERCIAL', src);
  else if (/HOUSE|სახლ/.test(kind)) pushIf(out, 'property.kind', 'HOUSE', src);
  else if (/APARTMENT|BUILDING|ბინა/.test(kind)) pushIf(out, 'property.kind', 'APARTMENT', src);
}

/**
 * Ownership and encumbrances — the highest-stakes extraction in the file,
 * because these are the only facts computeVerdict() can act on.
 *
 * `rightsAndRestrictions.status` carries Verify's own three-way distinction
 * and it is honoured exactly:
 *
 *   RESTRICTION_IDENTIFIED        -> positive claims per item
 *   NONE_FOUND_IN_CHECKED_SOURCE  -> ONE explicit negative claim
 *   NOT_CONFIRMED (or missing)    -> NOTHING. Not a fact, not a negative.
 *
 * That last branch is the whole mandate in one place: an unchecked registry
 * must never be recorded as "clean".
 */
function extractRights(r: VerifyReportLike, out: RawClaim[]): void {
  const rr = r.rightsAndRestrictions;
  if (!rr) return;
  const src = SOURCE_KEYS.REGISTRY;
  const asOf = nonEmpty(rr.asOf);
  const status = str(rr.status).toUpperCase();

  if (status === 'RESTRICTION_IDENTIFIED') {
    for (const raw of rr.items ?? []) {
      const item = clean(raw);
      if (!item) continue;
      const t = classifyEncumbrance(item);
      if (t) out.push({ type: t, value: item, source: src, effectiveDate: asOf });
    }
    return;
  }

  if (status === 'NONE_FOUND_IN_CHECKED_SOURCE') {
    // An explicit, evidenced absence. This is real evidence and the customer
    // deserves to be told it — but `negative: true` keeps computeVerdict()
    // from scoring it as a restriction.
    out.push({
      type: 'encumbrance.none',
      value: clean(rr.statement) || 'none found in checked source',
      source: src,
      effectiveDate: asOf,
      negative: true,
    });
  }
  // NOT_CONFIRMED and anything unrecognised deliberately produce no claim.
}

/** Maps a registry restriction phrase onto the fact types the verdict uses.
 * Georgian first, because the registry writes Georgian. Anything that does
 * not match a known category becomes a generic restriction, which is visible
 * to the customer but does not silently inflate the risk score. */
export function classifyEncumbrance(item: string): string | null {
  const s = item.toLowerCase();
  if (/ყადაღ|აკრძალვ|seizure|arrest|injunction/.test(s)) return 'encumbrance.seizure';
  if (/საგადასახადო\s*გირავნობ|tax\s*lien/.test(s)) return 'encumbrance.taxLien';
  if (/იპოთეკ|mortgage|pledge|გირავნობ/.test(s)) return 'encumbrance.mortgage';
  if (/მოვალეთ|debtor/.test(s)) return 'encumbrance.debtorRegistry';
  if (!s.trim()) return null;
  return 'encumbrance.other';
}

/**
 * The legal-status matrix. Each entry is one official check with its own
 * status, so each is translated independently and an unchecked entry is
 * skipped rather than defaulted.
 */
function extractLegalStatus(r: VerifyReportLike, out: RawClaim[]): void {
  const ls = r.legalStatus;
  if (!ls) return;

  const map: Record<string, { type: string; source: string }> = {
    companyRegistration: { type: 'company.status', source: SOURCE_KEYS.COMPANY },
    debtorRegistry: { type: 'encumbrance.debtorRegistry', source: SOURCE_KEYS.DEBTOR },
    taxpayerStatus: { type: 'encumbrance.taxLien', source: SOURCE_KEYS.TAXPAYER },
    propertyEncumbrances: { type: 'encumbrance.mortgage', source: SOURCE_KEYS.REGISTRY },
    constructionPermissions: { type: 'permit.reference', source: SOURCE_KEYS.PERMITS },
    commissioning: { type: 'construction.status', source: SOURCE_KEYS.PERMITS },
  };

  for (const [field, cfg] of Object.entries(map)) {
    const entry = ls[field];
    if (!entry) continue;
    const status = str(entry.status).toUpperCase();
    const statement = clean(entry.statement);
    const ref = nonEmpty(entry.evidenceUrl);

    // Verify's matrix vocabulary. Only these three carry evidence; anything
    // else (NOT_CHECKED, UNAVAILABLE, blank) is silence, and silence is not
    // a fact in either direction.
    if (status === 'CONFIRMED' || status === 'IDENTIFIED' || status === 'REGISTERED') {
      if (statement) out.push({ type: cfg.type, value: statement, source: cfg.source, documentRef: ref });
    } else if (status === 'NONE_FOUND' || status === 'CLEAR' || status === 'NOT_REGISTERED') {
      if (statement) {
        out.push({ type: cfg.type, value: statement, source: cfg.source, documentRef: ref, negative: true });
      }
    }
  }
}

/** Company / developer intelligence. Only REGISTRY_CONFIRMED profiles become
 * official company facts; a web-research-only profile is still emitted but
 * attributed to the report rather than to the registry, so corroboration
 * counting stays honest. */
function extractCompany(r: VerifyReportLike, out: RawClaim[]): void {
  const c = (r.companyProfile ?? {}) as Record<string, unknown>;
  if (!Object.keys(c).length) return;
  const confirmed = str(c.sourceBasis).toUpperCase() === 'REGISTRY_CONFIRMED';
  const src = confirmed ? SOURCE_KEYS.COMPANY : SOURCE_KEYS.REPORT;

  pushIf(out, 'company.name', c.name, src);
  pushIf(out, 'company.idCode', c.idCode, src);
  pushIf(out, 'company.status', c.status, src);
  pushIf(out, 'company.registrationDate', c.registrationDate, src);
  pushIf(out, 'company.address', c.address, src);
  for (const d of (c.directors as unknown[]) ?? []) pushIf(out, 'company.director', d, src);
  for (const s of (c.shareholders as unknown[]) ?? []) pushIf(out, 'company.shareholder', s, src);

  // Ownership by a company is what distinguishes a developer unit from a
  // private resale, so record it as an inferable signal rather than leaving
  // inferPropertyType() to guess from the name.
  if (nonEmpty(c.name)) out.push({ type: 'ownership.ownerType', value: 'COMPANY', source: src });
}

/** Project / construction profile. */
function extractProject(r: VerifyReportLike, out: RawClaim[]): void {
  const p = (r.projectProfile ?? {}) as Record<string, unknown>;
  if (!Object.keys(p).length) return;
  const src = SOURCE_KEYS.REPORT;

  pushIf(out, 'construction.status', p.constructionStatus ?? p.observedConstructionStatus, src);
  pushIf(out, 'construction.floors', p.floors, src);
  pushIf(out, 'project.architect', p.architect, src);
  for (const c of (p.contractors as unknown[]) ?? []) pushIf(out, 'project.contractor', c, src);

  const comm = (p.commissioningStatus ?? {}) as Record<string, unknown>;
  if (str(comm.status).toUpperCase() === 'OFFICIALLY_CONFIRMED') {
    out.push({
      type: 'construction.status',
      value: 'commissioned',
      source: SOURCE_KEYS.PERMITS,
      documentRef: nonEmpty(comm.evidenceUrl),
    });
  }
}

/** Land profile — only meaningful for parcels, and skipped entirely when
 * Verify produced none. */
function extractLand(r: VerifyReportLike, out: RawClaim[]): void {
  const l = (r.landProfile ?? {}) as Record<string, unknown>;
  if (!Object.keys(l).length) return;
  pushIf(out, 'land.category', l.category ?? l.designation ?? l.purpose, SOURCE_KEYS.REGISTRY);
  pushIf(out, 'property.area', l.area, SOURCE_KEYS.REGISTRY);
}

/**
 * Technical facts parsed out of official documents. Each already carries its
 * own document title/date, which becomes real provenance — this is the
 * richest evidence Verify produces and it is otherwise buried in a UI dump.
 */
function extractTechnicalFacts(r: VerifyReportLike, out: RawClaim[]): void {
  const CATEGORY_TYPES: Record<string, string> = {
    STRUCTURE: 'construction.structure',
    FACADE: 'construction.facade',
    FLOORS: 'construction.floors',
    AREA: 'construction.totalArea',
    PERMIT: 'permit.reference',
  };
  for (const f of r.technicalFacts ?? []) {
    const type = CATEGORY_TYPES[str(f?.category).toUpperCase()];
    const value = clean(f?.value);
    if (!type || !value) continue;
    out.push({
      type,
      subject: nonEmpty(f?.key),
      value,
      source: SOURCE_KEYS.REGISTRY_DOC,
      documentRef: nonEmpty(f?.documentTitle),
      effectiveDate: nonEmpty(f?.documentDate),
    });
  }
}

/** Market evidence. Kept strictly separate from legal risk: a high asking
 * price is not a defect, and computeVerdict() never reads these. */
function extractMarket(r: VerifyReportLike, out: RawClaim[]): void {
  const m = (r.market ?? {}) as Record<string, unknown>;
  if (!Object.keys(m).length) return;
  const src = SOURCE_KEYS.MARKET;
  pushIf(out, 'market.pricePerSqm', m.activeMedianPricePerSqm, src);
  pushIf(out, 'market.askingRange', rangeOf(m.activeMinPricePerSqm, m.activeMaxPricePerSqm), src);
  pushIf(out, 'price.historical', m.historicalMedianPricePerSqm, src);
}

const rangeOf = (lo: unknown, hi: unknown): string | null => {
  const a = nonEmpty(lo);
  const b = nonEmpty(hi);
  return a && b ? `${a} – ${b}` : null;
};

/**
 * The whole extraction. Order does not matter — normalizeEvidence() groups by
 * (type, subject) and merges — but every extractor is total: it either emits
 * a claim with provenance or emits nothing.
 */
export function extractClaims(report: VerifyReportLike | null | undefined): RawClaim[] {
  if (!report || typeof report !== 'object') return [];
  const out: RawClaim[] = [];
  extractIdentity(report, out);
  extractRights(report, out);
  extractLegalStatus(report, out);
  extractCompany(report, out);
  extractProject(report, out);
  extractLand(report, out);
  extractTechnicalFacts(report, out);
  extractMarket(report, out);
  return out;
}

/* ------------------------------------------------------------------ *
 * Source outcomes                                                     *
 * ------------------------------------------------------------------ */

const TECHNICAL = new Set(['CAPTCHA_REQUIRED', 'BLOCKED', 'TECHNICAL_FAILED']);
const CHECKED = new Set(['SUCCESS', 'NO_RESULT', 'NOT_CONFIRMED']);

/**
 * Sources that failed for reasons that are OUR fault, not the property's.
 *
 * The customer is told about these honestly ("we could not complete this
 * check"), and they are the input to the handoff decision — but they never
 * reach computeVerdict(), and they never become a finding.
 */
export function technicalOutcomes(report: VerifyReportLike | null | undefined): TechnicalOutcome[] {
  return (report?.officialSourceCoverage ?? [])
    .filter((o) => TECHNICAL.has(str(o?.customerStatus).toUpperCase()))
    .map((o) => ({
      source: str(o.source),
      sourceName: str(o.sourceName) || str(o.source),
      status: str(o.customerStatus).toUpperCase() as TechnicalOutcome['status'],
    }))
    .filter((o) => o.source.length > 0);
}

/** Sources that genuinely completed, whatever they found. */
export function checkedOutcomes(report: VerifyReportLike | null | undefined): CheckedOutcome[] {
  return (report?.officialSourceCoverage ?? [])
    .filter((o) => CHECKED.has(str(o?.customerStatus).toUpperCase()))
    .map((o) => ({
      source: str(o.source),
      sourceName: str(o.sourceName) || str(o.source),
      status: str(o.customerStatus).toUpperCase() as CheckedOutcome['status'],
    }))
    .filter((o) => o.source.length > 0);
}

/* ------------------------------------------------------------------ *
 * Verify snapshot                                                     *
 * ------------------------------------------------------------------ */

/**
 * The small, stable header a Deal Room keeps about the Verify it was built
 * on.
 *
 * Deliberately NOT the evidence payload. research_jobs already stores that,
 * and copying a multi-megabyte result_json per deal room would double storage
 * and immediately drift. What is copied is the handful of fields that must
 * stay readable years later even if Verify's own format changes — which is
 * what makes historical research still understandable, per the mandate.
 */
export interface VerifySnapshot {
  jobId: string;
  capturedAt: string;
  /** Format version of THIS snapshot shape, so a future reader can migrate. */
  snapshotVersion: 1;
  cadastralCode: string | null;
  address: string | null;
  entityName: string | null;
  propertyType: string | null;
  area: string | null;
  verdict: string | null;
  verdictReasons: string[];
  factCount: number;
  conflictCount: number;
  /** Source keys that completed, and those that did not — the honest
   * coverage record, kept apart so the two can never be conflated. */
  checkedSources: string[];
  incompleteSources: string[];
}

export function buildVerifySnapshot(args: {
  jobId: string;
  report: VerifyReportLike | null | undefined;
  propertyType?: string | null;
  verdict?: string | null;
  verdictReasons?: string[];
  factCount?: number;
  conflictCount?: number;
  capturedAt?: string;
}): VerifySnapshot {
  const r = args.report ?? {};
  const unit = (r.exactUnit ?? {}) as Record<string, unknown>;
  const parent = r.identifiedParent ?? {};
  return {
    jobId: args.jobId,
    capturedAt: args.capturedAt ?? new Date().toISOString(),
    snapshotVersion: 1,
    cadastralCode: nonEmpty(unit.cadastralCode ?? unit.code ?? parent.code),
    address: nonEmpty(unit.address ?? parent.address),
    entityName: nonEmpty(clean(r.entityName)),
    propertyType: args.propertyType ?? null,
    area: nonEmpty(unit.area ?? unit.totalArea),
    verdict: args.verdict ?? null,
    verdictReasons: args.verdictReasons ?? [],
    factCount: args.factCount ?? 0,
    conflictCount: args.conflictCount ?? 0,
    checkedSources: checkedOutcomes(r).map((o) => o.source),
    incompleteSources: technicalOutcomes(r).map((o) => o.source),
  };
}
