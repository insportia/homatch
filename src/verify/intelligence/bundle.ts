// HOMATCH — the intelligence bundle handed to synthesis.
//
// The evidence package answers "what do we know". This adds the layers a
// buyer actually asks about and that arithmetic — not a language model —
// should decide:
//
//   snapshot   the property at a glance, so prose never has to restate it
//   market     median / mean / range / positioning over a scored micro-market
//   location   city, district, street and general area character
//   people     who is connected, in what role, and how the company is bound
//   fx         what the currency explains about a historical change
//
// Each is optional and each is omitted when the evidence does not support it.
// An absent section is the correct output for absent evidence; a padded one
// would be an invented fact.

import type { EvidencePackage } from './evidencePackage.ts';
import { buildMarketIntelligence, qualityFactorsFrom } from './marketIntelligence.ts';
import type { MarketIntelligence, RawComparable, Subject } from './marketIntelligence.ts';
import { buildLocationIntelligence } from './locationIntelligence.ts';
import type { LocationIntelligence } from './locationIntelligence.ts';
import { buildPeopleIntelligence, toParticipantModel } from './peopleIntelligence.ts';
import type { PeopleIntelligence, ParticipantModel } from './peopleIntelligence.ts';
import type { FxContext } from './fx.ts';

export interface PropertySnapshot {
  cadastralCode?: string;
  propertyType?: string;
  project?: string;
  address?: string;
  district?: string;
  area?: string;
  floor?: string;
  rooms?: string;
  unitNumber?: string;
  condition?: string;
  owner?: string;
  developer?: string;
  constructionStatus?: string;
  parking?: string;
  amenities: string[];
}

export interface IntelligenceBundle {
  snapshot: PropertySnapshot;
  market: MarketIntelligence | null;
  location: LocationIntelligence;
  people: PeopleIntelligence;
  participants: ParticipantModel;
  fx: FxContext | null;
  /** Official checks the BUYER can run themselves, framed as next steps. */
  selfChecks: SelfCheck[];
}

/**
 * A check the buyer can complete themselves on an official portal.
 *
 * These replace the old "could not confirm" inventory. The same underlying
 * situation — an automated lookup this pipeline does not perform — is
 * presented as a useful action with a link and the exact value to paste,
 * rather than as a list of our own shortcomings.
 */
export interface SelfCheck {
  kind: 'PROPERTY_EXTRACT' | 'TAXPAYER_REGISTRY';
  url: string;
  /** The value the buyer pastes into the portal. */
  copyValue: string;
  copyLabel: string;
  /** Secondary value, e.g. the company name beside its ID. */
  contextValue?: string;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));

/*
 * The snapshot is the one place raw research text reaches a customer WITHOUT
 * passing through the model, so it is the one place research formatting can
 * leak. Both of these were found on a live report:
 *
 *   amenities:    "გამწვანებული ეზო. ([villion.ge](https://villion.ge/...))"
 *   propertyType: "MIXED_OR_UNKNOWN"
 *
 * The first put portal links straight into the primary report, which is
 * exactly what Evidence & Sources exists to avoid. The second showed an
 * internal enum to a buyer — and one that means "we do not know", so the
 * honest rendering of it is nothing at all.
 */
const MARKDOWN_LINK = /\[([^\]]*)\]\((?:[^)]*)\)/g;
const BARE_URL = /https?:[^\s]+/gi;
/** SCREAMING_SNAKE is how this codebase writes internal states, never prose. */
const INTERNAL_TOKEN = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;
/*
 * A parenthetical that is nothing but a hostname.
 *
 * Stripping the URL out of "([villion.ge](https://villion.ge/...))" leaves
 * "(villion.ge)" — the link TEXT was the domain, so the portal name survives
 * in the primary report anyway. For a snapshot field the attribution adds
 * nothing a buyer can use; provenance lives in Evidence & Sources. Only a
 * parenthetical that is ENTIRELY a domain goes, so "(მწვანე კარკასი)" and
 * "(94.1 m2)" are untouched.
 */
const BARE_DOMAIN_PAREN = /\s*\(\s*(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+\s*\)/gi;

const clean = (v: unknown): string =>
  str(v)
    // Keep the link TEXT, drop the target.
    .replace(MARKDOWN_LINK, '$1')
    .replace(BARE_URL, '')
    .replace(BARE_DOMAIN_PAREN, '')
    // Tidy the punctuation the removal leaves behind: " ()", " (, )", " .".
    .replace(/\(\s*[),.;:]*\s*\)/g, '')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

const nonEmpty = (v: unknown): string | undefined => {
  const c = clean(v);
  if (!c) return undefined;
  // An internal token is not a value a buyer can read. Omitting the row says
  // "unknown" far better than printing the word for it.
  return INTERNAL_TOKEN.test(c) ? undefined : c;
};
const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

const MYGOV_PROPERTY_SERVICE = 'https://www.my.gov.ge/ka-ge/services/5/service/176';
const RS_TAXPAYER_REGISTRY = 'https://www.rs.ge/TaxPayersRegistry';

export function buildIntelligenceBundle(
  report: unknown,
  pkg: EvidencePackage,
  fx: FxContext | null = null
): IntelligenceBundle {
  const r = obj(report);
  const pr = obj(r.publicResearch);
  const unit = obj(r.exactUnit);
  const project = obj(r.projectProfile);
  const company = obj(r.companyProfile);
  const reconciled = obj(r.reconciledIdentity);

  const address =
    pkg.subject.address ?? nonEmpty(reconciled.address) ?? nonEmpty(unit.address);

  const location = buildLocationIntelligence([
    address,
    nonEmpty(reconciled.address),
    ...arr<unknown>(pr.facts).map(clean),
  ]);

  const snapshot: PropertySnapshot = {
    cadastralCode: pkg.subject.cadastralCode,
    propertyType: nonEmpty(unit.propertyType ?? r.assetClass),
    project: pkg.subject.project ?? nonEmpty(reconciled.project),
    address,
    district: location.district,
    area: pkg.subject.area,
    floor: pkg.subject.floor,
    rooms: nonEmpty(unit.rooms),
    unitNumber: pkg.subject.unitNumber,
    condition: nonEmpty(unit.condition ?? project.handoverCondition),
    owner: nonEmpty(company.name) ?? pkg.subject.legalCompany,
    developer: pkg.subject.developer,
    constructionStatus: nonEmpty(pr.currentPhysicalStatus ?? project.constructionStatus),
    parking: nonEmpty(pr.parking),
    amenities: arr<unknown>(pr.amenities).map(clean).filter(Boolean).slice(0, 8),
  };

  /* ---- market ---- */

  const m = obj(r.market);
  const subject: Subject = {
    project: snapshot.project,
    address,
    area: Number(pkg.subject.area) || undefined,
    rooms: Number(snapshot.rooms) || undefined,
    floor: Number(pkg.subject.floor) || undefined,
    // Verify runs from a cadastral code, so the subject usually has NO asking
    // price of its own. That is why positioning is optional downstream: we
    // never derive a subject price from the comparables.
    pricePerSqm: Number(unit.pricePerSqm) || undefined,
    totalPrice: Number(unit.price) || undefined,
    currency: nonEmpty(unit.currency) ?? 'USD',
  };
  /*
   * Quality goes in WITH the comparables, not after them.
   *
   * Price per square metre on its own invites the wrong conclusion: a
   * lower-density boutique building with parking and concierge is a
   * different product from a corridor block at the same rate. These factors
   * are read from the snapshot the research already produced, so each one
   * traces to recorded evidence — and none of them carries a monetary
   * adjustment, because the data does not support one.
   */
  const market = buildMarketIntelligence(
    subject,
    arr<RawComparable>(m.comparables),
    qualityFactorsFrom(
      snapshot.amenities,
      snapshot.condition,
      snapshot.constructionStatus,
      snapshot.parking
    )
  );

  /* ---- people ---- */

  const people = buildPeopleIntelligence(report);
  const participants = toParticipantModel(people, snapshot.owner);

  /* ---- self-checks ---- */

  const selfChecks: SelfCheck[] = [];
  if (snapshot.cadastralCode) {
    selfChecks.push({
      kind: 'PROPERTY_EXTRACT',
      url: MYGOV_PROPERTY_SERVICE,
      copyValue: snapshot.cadastralCode,
      copyLabel: 'cadastral',
    });
  }
  const companyId = pkg.subject.companyId;
  if (companyId && snapshot.owner) {
    selfChecks.push({
      kind: 'TAXPAYER_REGISTRY',
      url: RS_TAXPAYER_REGISTRY,
      copyValue: companyId,
      copyLabel: 'companyId',
      contextValue: snapshot.owner,
    });
  }

  return { snapshot, market, location, people, participants, fx, selfChecks };
}
