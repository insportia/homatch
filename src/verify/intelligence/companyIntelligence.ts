// HOMATCH — COMPANY & OWNERSHIP, read from the registry rather than inferred.
//
// WHY THIS LAYER EXISTS
//
// Company intelligence used to reach a report as four prose claims — name,
// status, registration date, address — emitted as tier-2 evidence strings. An
// identification code, a director, a shareholder or an ownership percentage
// had no way to arrive at all: the model's schema has no field for ownership,
// and the deterministic parser that reads it out of an official extract was
// wired to nothing (see official-worker/src/evidence/RegistryExtractParser.ts
// and the 2026-09-19 incident).
//
// So ownership was either missing or left to be inferred from prose. This
// module is the other half of the repair: it takes the registry-derived
// companyProfile that research-agent now assembles and turns it into a typed,
// arithmetic-checked structure that synthesis and the UI both read. Nothing
// here interprets, ranks or softens. It reads what the registry stated.
//
// THE DISTINCTION THIS MODULE EXISTS TO ENCODE
//
// "We looked and found nothing" and "we could not look" are different facts
// and must never render as the same sentence. When the official browser
// failed — which is exactly what happened to every job in the incident window
// — status is SOURCE_UNAVAILABLE, and a report may say the registry check did
// not run. It may NOT say no shareholders were found, because nobody looked.
//
// The second distinction is about scope. An entrepreneur-registry extract
// describes a COMPANY. A pledge recorded there is a charge over the company
// or its assets as registered — it is not, on its own, a statement about the
// specific apartment a buyer is looking at, whose encumbrances live in the
// property registry. Both are real; conflating them would either alarm a
// buyer about the wrong thing or reassure them about the wrong thing.

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
const nonEmpty = (v: unknown): string | null => str(v) || null;
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/**
 * How much the official registry actually established about this company.
 *
 * SOURCE_UNAVAILABLE is the member that matters: it is the difference
 * between an answer and a missing attempt.
 */
export type CompanyEvidenceStatus =
  | 'REGISTRY_CONFIRMED'
  | 'WEB_RESEARCH_ONLY'
  | 'SOURCE_UNAVAILABLE'
  | 'NO_COMPANY_IDENTIFIED';

export interface OwnershipStake {
  name: string;
  /** Exactly as registered. Never rounded, never reconstructed from units. */
  percentage: number | null;
  units: number | null;
}

export interface DirectorRecord {
  name: string;
  /** The registry's own word, e.g. ერთობლივი / ერთპიროვნული. */
  representation: string | null;
}

/**
 * A charge registered against the COMPANY in the entrepreneur registry.
 * `scope` is fixed rather than inferred: this register cannot describe a
 * specific apartment, so nothing read from it may be presented as one.
 */
export interface RegistryEncumbrance {
  kind: string | null;
  reference: string | null;
  creditor: string | null;
  registeredAt: string | null;
  scope: 'COMPANY';
}

/** How the directors bind the company, collapsed to one answer when they agree. */
export type RepresentationRule = 'JOINT' | 'SOLE' | 'MIXED' | 'UNKNOWN';

export interface CompanyIntelligence {
  status: CompanyEvidenceStatus;
  legalName: string | null;
  idCode: string | null;
  legalForm: string | null;
  registrationDate: string | null;
  registeredAddress: string | null;
  governanceBody: string | null;
  directors: DirectorRecord[];
  representationRule: RepresentationRule;
  ownership: OwnershipStake[];
  /** Sum of stated percentages, when every holder states one. */
  ownershipTotal: number | null;
  /** The registry's own consistency signal, preserved rather than recomputed. */
  ownershipConsistent: boolean | null;
  /** Registered charges only. A "not registered" row is not a finding. */
  encumbrances: RegistryEncumbrance[];
  liquidationRegistered: boolean | null;
  /** Extract number and preparation date — the evidence and its date. */
  extractNumber: string | null;
  extractPreparedAt: string | null;
  /** Precisely which fields the registry supplied. Provenance, not a claim. */
  registryFields: string[];
  /** True when at least one field above came from the official extract. */
  registryBacked: boolean;
}

const JOINT = /ერთობლივ/i;
const SOLE = /ერთპიროვნულ/i;

/** Collapses director representation to a single rule, or reports that the
 * directors do not share one. Never guesses from a count of directors. */
export function representationRule(directors: DirectorRecord[]): RepresentationRule {
  const words = directors.map((d) => str(d.representation)).filter(Boolean);
  if (!words.length) return 'UNKNOWN';
  const joint = words.filter((w) => JOINT.test(w)).length;
  const sole = words.filter((w) => SOLE.test(w)).length;
  if (joint && !sole) return 'JOINT';
  if (sole && !joint) return 'SOLE';
  if (joint && sole) return 'MIXED';
  return 'UNKNOWN';
}

/**
 * Whether the official registry lane ran at all for this job.
 *
 * The flag the worker sets on failure is the authority here. A job whose
 * browser never launched has no official results, and that absence must not
 * be read as a negative finding anywhere downstream.
 */
export function officialSourceUnavailable(report: unknown): boolean {
  const bo = obj(obj(report).browserOfficial);
  if (bo.unavailable === true) return true;
  // No results and no attempt recorded is the same situation wearing a
  // different shape — several historical jobs carry only one of the two.
  const results = arr<unknown>(bo.results);
  return results.length === 0 && bo.unavailable !== false && Object.keys(bo).length > 0;
}

/**
 * Builds the company layer from the report's companyProfile.
 *
 * Returns null only when no company is involved at all — an absent section is
 * the correct output for a private resale, and is not the same as a company
 * whose registry check failed.
 */
export function buildCompanyIntelligence(report: unknown): CompanyIntelligence | null {
  const r = obj(report);
  const c = obj(r.companyProfile);
  const legalName = nonEmpty(c.name);
  const idCode = nonEmpty(c.idCode);

  const sourceUnavailable = officialSourceUnavailable(report);

  if (!legalName && !idCode) {
    // Nothing names a company. If the official lane simply never ran, that is
    // worth saying once; if there is genuinely no company, say nothing.
    if (!sourceUnavailable) return null;
    const developer = nonEmpty(obj(r.reconciledIdentity).developer);
    if (!developer) return null;
    return emptyProfile('SOURCE_UNAVAILABLE', developer);
  }

  const directors: DirectorRecord[] = arr<unknown>(c.directors)
    .map((d) => {
      // Tolerates both shapes: structured records from the registry overlay,
      // and the plain strings older reports and web research produce.
      if (typeof d === 'string') return { name: str(d), representation: null };
      const o = obj(d);
      return { name: str(o.name), representation: nonEmpty(o.representation) };
    })
    .filter((d) => d.name);

  const ownership: OwnershipStake[] = arr<unknown>(c.shareholders)
    .map((s) => {
      if (typeof s === 'string') return { name: str(s), percentage: null, units: null };
      const o = obj(s);
      return { name: str(o.name), percentage: num(o.percentage), units: num(o.units) };
    })
    .filter((s) => s.name);

  const stated = ownership.map((o) => o.percentage).filter((p): p is number => p !== null);
  const ownershipTotal =
    stated.length && stated.length === ownership.length
      ? Math.round(stated.reduce((a, b) => a + b, 0) * 100) / 100
      : null;

  const encumbrances: RegistryEncumbrance[] = arr<unknown>(c.encumbrances).map((e) => {
    const o = obj(e);
    return {
      kind: nonEmpty(o.kind),
      reference: nonEmpty(o.reference),
      creditor: nonEmpty(o.creditor),
      registeredAt: nonEmpty(o.registeredAt),
      scope: 'COMPANY',
    };
  });

  const registryFields = arr<unknown>(c.registryFields).map(str).filter(Boolean);
  const registryBacked =
    registryFields.length > 0 || str(c.sourceBasis).toUpperCase() === 'REGISTRY_CONFIRMED';

  const status: CompanyEvidenceStatus = registryBacked
    ? 'REGISTRY_CONFIRMED'
    : sourceUnavailable
      ? 'SOURCE_UNAVAILABLE'
      : 'WEB_RESEARCH_ONLY';

  return {
    status,
    legalName,
    idCode,
    legalForm: nonEmpty(c.legalForm),
    registrationDate: nonEmpty(c.registrationDate),
    // The overlay writes registeredAddress; older reports carry `address`.
    registeredAddress: nonEmpty(c.registeredAddress) ?? nonEmpty(c.address),
    governanceBody: nonEmpty(c.governanceBody),
    directors,
    representationRule: representationRule(directors),
    ownership,
    ownershipTotal,
    ownershipConsistent: typeof c.shareholdingConsistent === 'boolean' ? c.shareholdingConsistent : null,
    encumbrances,
    liquidationRegistered: typeof c.liquidationRegistered === 'boolean' ? c.liquidationRegistered : null,
    extractNumber: nonEmpty(c.extractNumber),
    extractPreparedAt: nonEmpty(c.extractPreparedAt),
    registryFields,
    registryBacked,
  };
}

function emptyProfile(status: CompanyEvidenceStatus, legalName: string | null): CompanyIntelligence {
  return {
    status,
    legalName,
    idCode: null,
    legalForm: null,
    registrationDate: null,
    registeredAddress: null,
    governanceBody: null,
    directors: [],
    representationRule: 'UNKNOWN',
    ownership: [],
    ownershipTotal: null,
    ownershipConsistent: null,
    encumbrances: [],
    liquidationRegistered: null,
    extractNumber: null,
    extractPreparedAt: null,
    registryFields: [],
    registryBacked: false,
  };
}

/**
 * The company facts that are MATERIAL — the ones a report must not bury.
 *
 * Deliberately narrow. A registered pledge and a registered liquidation are
 * material because they change what a buyer should ask next. An ownership
 * split, a registration date or a joint-representation rule are useful
 * context, not risk, and inflating them into warnings is how a report starts
 * sounding alarmed about nothing.
 *
 * Note what is NOT here: a pledge is returned as evidence of a registered
 * charge over the COMPANY, never as a verdict about the property or about
 * the company's soundness. Development companies routinely pledge assets to
 * finance construction; the fact is worth stating plainly and worth checking
 * against the property's own extract, which is a different document.
 */
export function materialCompanyFindings(company: CompanyIntelligence | null): RegistryEncumbrance[] {
  if (!company) return [];
  return company.encumbrances.filter((e) => e.reference || e.creditor || e.kind);
}
