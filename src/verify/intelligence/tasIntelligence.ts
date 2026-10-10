// HOMATCH Verify — TAS property intelligence.
//
// RAW SOURCE DATA → STRUCTURED EXTRACTION → FACTS AND ENTITIES →
// SOURCE-BOUND EVIDENCE → TRUE DEDUPLICATION → CHRONOLOGY → RELATIONSHIPS →
// PROPERTY INTELLIGENCE → (final AI synthesis, elsewhere).
//
// Deterministic and pure. It reads what the official worker returned for
// TAS (the API_FIRST structured cases when present, the LEGACY documents
// otherwise) and produces ONE consolidated picture:
//
//   facts         each unique material fact once, with every source that
//                 carries it; versions of the same matter ordered by REAL
//                 date and marked CURRENT / SUPERSEDED / HISTORICAL /
//                 CONFLICTING — never by document id;
//   timeline      dated official events (applications, permits, approvals,
//                 amendments, extensions, refusals, commissioning…);
//   participants  people and organisations in the roles the documents give
//                 them. An applicant is never promoted to owner. Two people
//                 are never merged because their names look alike;
//   technical     documented SPECIFICATIONS (never claims of built quality);
//   story         chronological chapters — the skeleton the narrative is
//                 written on;
//   digest        a bounded text for the model that ALWAYS carries every
//                 HIGH-materiality fact, and says how much lower-importance
//                 detail it archived rather than silently dropping it.
//
// Everything here is internal. Document ids, attachment ids and hashes stay
// in this structure for audit; none of it is customer prose.

import { revalidateDecision, legalClaims, type LegalClaim } from './legalStatus.ts';

export type FactStatus = 'CURRENT' | 'SUPERSEDED' | 'HISTORICAL' | 'CONFLICTING';
export type Materiality = 'HIGH' | 'MEDIUM' | 'LOW';
export type FactBasis = 'DOCUMENTED_SPECIFICATION' | 'OFFICIAL_DECISION' | 'OFFICIAL_RECORD';

export interface FactSource {
  documentId: string | null;
  caseRef: string | null;
  date: string | null;
  label: string | null;
}

export interface TasFact {
  id: string;
  /** The matter this fact is about: same key = same matter. */
  key: string;
  label: string;
  category: 'PROJECT' | 'PERMIT' | 'STRUCTURAL' | 'FOUNDATION' | 'GEOTECHNICAL' | 'MEP' | 'LANDSCAPE' | 'MATERIAL' | 'REVISION' | 'DEADLINE' | 'OTHER';
  value: string;
  /** Building block / liter the document is about, when it names one. */
  block: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  sources: FactSource[];
  status: FactStatus;
  materiality: Materiality;
  basis: FactBasis;
  /** For a SUPERSEDED fact: the value that replaced it. */
  supersededBy?: string;
}

export type EventKind =
  | 'APPLICATION'
  | 'PERMIT'
  | 'APPROVAL'
  | 'AMENDMENT'
  | 'EXTENSION'
  | 'REFUSAL'
  | 'SUSPENSION'
  | 'INSPECTION'
  | 'COMMISSIONING'
  | 'DECISION'
  | 'OTHER';

export type DecisionOutcome =
  | 'PERMIT_ISSUED' | 'APPROVED' | 'AMENDMENT_APPROVED' | 'DEADLINE_EXTENDED' | 'COMMISSIONED'
  | 'INTERMEDIATE' | 'DEFICIENCY' | 'REFUSED' | 'SUSPENDED' | 'CANCELLED' | 'INFORMATIONAL' | 'UNDETERMINED';

export interface TimelineEvent {
  id: string;
  date: string;
  kind: EventKind;
  title: string;
  caseRef: string | null;
  documentId: string | null;
  status: string | null;
  materiality: Materiality;
  /** The official decision this event carries, when its response was read. */
  decision?: { number: string | null; outcome: DecisionOutcome; evidence: string | null; validUntil: string | null } | null;
  /** Deterministic relevance 0..100 (legal effect, status impact, recency, uniqueness). */
  relevance: number;
}

/** The property's official situation as the decisions establish it. */
export type OfficialState =
  | 'COMMISSIONED'
  | 'PERMITTED'
  | 'PROJECT_APPROVED'
  | 'SUSPENDED'
  | 'CANCELLED'
  | 'APPLICATION_PENDING'
  | 'APPLICATION_REFUSED'
  | 'NOT_ESTABLISHED';

export interface CurrentOfficialStatus {
  state: OfficialState;
  /** Date of the decision that established it. */
  since: string | null;
  basis: { caseRef: string | null; decisionNumber: string | null; date: string | null; outcome: DecisionOutcome; evidence: string | null } | null;
  /** A permit / deadline date stated by the controlling decisions. */
  validUntil: string | null;
  /** Later applications still without a final decision. */
  pending: Array<{ caseRef: string | null; date: string; outcome: DecisionOutcome }>;
  /** True only when decisions establish the state and nothing material is unread. */
  conclusive: boolean;
  caveats: Array<'RESPONSES_UNREAD' | 'LATER_UNDETERMINED_DECISION' | 'PROCESSING_INCOMPLETE' | 'PROCESSING_UNVERIFIED' | 'CASES_DISAGREE' | 'NO_DECISIONS_READ' | 'VALIDITY_PASSED'>;
}

export interface TasFunnel {
  discoveredDocuments: number;
  discoveredMotions: number;
  discoveredAttachments: number;
  processedResponses: number;
  processedAttachments: number;
  deferredAttachments: number;
  retainedFacts: number;
  retainedEvents: number;
  milestones: number;
  visualsSelected: number;
  incomplete: boolean;
  incompleteReasons: string[];
}

export type ParticipantRole =
  | 'APPLICANT'
  | 'CO_APPLICANT'
  | 'CLIENT'
  | 'DEVELOPER'
  | 'PARCEL_OWNER'
  | 'ARCHITECT'
  | 'CO_ARCHITECT'
  | 'STRUCTURAL_ENGINEER'
  | 'GEOTECHNICAL_SPECIALIST'
  | 'EXPERT_REVIEW'
  | 'TECHNICAL_SUPERVISOR'
  | 'CONTRACTOR'
  | 'MEP_ENGINEER'
  | 'LANDSCAPE_ARCHITECT'
  | 'FIRE_SAFETY'
  | 'SURVEYOR'
  | 'INTERIOR_DESIGNER'
  | 'OTHER';

export interface Participant {
  id: string;
  name: string;
  kind: 'PERSON' | 'ORGANIZATION' | 'UNKNOWN';
  organizationId: string | null;
  roles: ParticipantRole[];
  firstSeen: string | null;
  lastSeen: string | null;
  cases: number;
  /** Appears in the most recent case that names anyone in this role. */
  current: boolean;
  /**
   * Private individuals named only as applicants/owners/clients are kept
   * internal; professionals and organisations may be named to a buyer.
   */
  customerVisible: boolean;
}

export interface StoryChapter {
  key: 'EARLIEST' | 'INITIAL_PROJECT' | 'APPROVALS' | 'CONSTRUCTION' | 'CHANGES' | 'RECENT' | 'TODAY';
  from: string | null;
  to: string | null;
  eventIds: string[];
  factIds: string[];
}

export interface VisualRef {
  id: string;
  role: 'LATEST_RENDER' | 'EARLIEST_RENDER' | 'SUPPORTING';
  kind: string;
  date: string | null;
  /** The chapter this visual explains, so the UI places it beside the story. */
  chapter: StoryChapter['key'] | null;
  /** The dated event nearest the visual, when one is within a year. */
  eventId: string | null;
  width: number | null;
  height: number | null;
  /**
   * CURRENT_APPROVED only when the visual's own case carries the latest
   * approving decision; HISTORICAL_APPROVED for an earlier approved case;
   * otherwise UNDETERMINED (a submitted design is not an approved one).
   */
  versionStatus: 'CURRENT_APPROVED' | 'HISTORICAL_APPROVED' | 'UNDETERMINED';
  documentId: string | null;
  attachedFileId: string | null;
}

export interface TasCoverage {
  implementation: 'API_FIRST' | 'LEGACY' | 'UNKNOWN';
  cases: number;
  sourceTotal: number | null;
  reconciled: boolean | null;
  motions: number;
  officialResponses: number;
  attachmentsAccounted: number;
  attachmentsRead: number;
  /** Pages of the attachments actually read (the worker's own page counts). */
  pagesRead?: number;
  scanOnly: number;
  unsupportedFormats: number;
  notProcessed: number;
  earliestDate: string | null;
  latestDate: string | null;
}

export interface TasIntelligence {
  available: boolean;
  coverage: TasCoverage;
  facts: TasFact[];
  timeline: TimelineEvent[];
  participants: Participant[];
  story: StoryChapter[];
  visuals: VisualRef[];
  conflicts: Array<{ key: string; label: string; block: string | null; values: Array<{ value: string; date: string | null }> }>;
  currentFactIds: string[];
  /** Authority-based current official situation. */
  officialStatus: CurrentOfficialStatus;
  /** The 5–10 events a buyer needs, chosen by relevance; never drops a negative decision. */
  milestoneIds: string[];
  funnel: TasFunnel;
  /** Distinct legal states, each CONFIRMED / … / NOT_VERIFIED on its own evidence. */
  legalClaims: LegalClaim[];
}

// ─────────────────────────────── helpers ───────────────────────────────

const arr = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const s = (v: unknown): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v == null ? '' : String(v).trim());
const day = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(iso));
  if (m) return m[1];
  const g = /^(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(String(iso));
  if (g && +g[2] <= 12) return `${g[3]}-${g[2].padStart(2, '0')}-${g[1].padStart(2, '0')}`;
  return null;
};

/** Normalise a value for identity: case, spacing, decimal comma, units. */
export function valueIdentity(v: string): string {
  return v
    .toLowerCase()
    .replace(/(\d),(\d)/g, '$1.$2')
    // \b does not see Georgian letters as word characters: explicit ends.
    .replace(/\s*(მ²|მ2|კვ\.?\s?მ|sq\.?\s?m|m²|m2)(?=$|[\s.,;)])/g, 'm2')
    .replace(/\s*(მეტრი|მ\.|მ)(?=$|[\s.,;)])/g, 'm')
    .replace(/(\d)\s+(m2|m)(?=$|[\s.,;)])/g, '$1$2')
    .replace(/[“”"«»'`]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.;:,]+$/, '')
    .trim();
}

interface KeyRule {
  key: string;
  category: TasFact['category'];
  materiality: Materiality;
  re: RegExp;
  /** One value per matter at a time: a later dated value supersedes. */
  single: boolean;
}

/**
 * Field labels → the matter they describe. Government form labels, never a
 * project's values. Order matters: the first match wins.
 */
const KEY_RULES: KeyRule[] = [
  { key: 'constructionDeadline', category: 'DEADLINE', materiality: 'HIGH', single: true, re: /(მშენებლობის|ნებართვის|სამშენებლო)\s+(დასრულების\s+)?ვად|construction\s+deadline|permit\s+(validity|expiry)|срок\s+(строительства|действия)/i },
  { key: 'undergroundFloors', category: 'PROJECT', materiality: 'HIGH', single: true, re: /მიწისქვეშა\s+სართულ|underground\s+floors?|подземн/i },
  { key: 'floors', category: 'PROJECT', materiality: 'HIGH', single: true, re: /სართულ(?:ების|ის)?\s+რაოდენობა|სართულიანობა|^floors?$|number of floors|этажност/i },
  { key: 'height', category: 'PROJECT', materiality: 'HIGH', single: true, re: /სიმაღლ|height|высот/i },
  { key: 'buildingClass', category: 'PERMIT', materiality: 'MEDIUM', single: true, re: /შენობის\s+(კლას|კატეგორი)|კლასი|construction class|класс/i },
  { key: 'buildingFunction', category: 'PROJECT', materiality: 'HIGH', single: true, re: /ფუნქცი|დანიშნულებ|purpose|building use|назначени/i },
  { key: 'landArea', category: 'PROJECT', materiality: 'MEDIUM', single: true, re: /(მიწის\s+)?ნაკვეთის\s+ფართ|land\s+(plot\s+)?area|площадь\s+участка/i },
  { key: 'footprintArea', category: 'PROJECT', materiality: 'MEDIUM', single: true, re: /განაშენიანების\s+ფართ|footprint/i },
  { key: 'totalArea', category: 'PROJECT', materiality: 'MEDIUM', single: true, re: /საერთო\s+ფართ|სამშენებლო\s+ფართ|total\s+(floor\s+)?area|общая\s+площадь/i },
  { key: 'residentialArea', category: 'PROJECT', materiality: 'MEDIUM', single: true, re: /საცხოვრებელი\s+ფართ|residential\s+area/i },
  { key: 'commercialArea', category: 'PROJECT', materiality: 'MEDIUM', single: true, re: /კომერციული\s+ფართ|commercial\s+area/i },
  { key: 'units', category: 'PROJECT', materiality: 'HIGH', single: true, re: /ბინ(ებ)?ის\s+რაოდენობა|number of (apartments|units)|количество квартир/i },
  { key: 'parking', category: 'PROJECT', materiality: 'MEDIUM', single: true, re: /პარკინგ|ავტოსადგომ|parking|парковк/i },
  { key: 'K1', category: 'PERMIT', materiality: 'MEDIUM', single: true, re: /^(კ-?1|k-?1|kz1)$|\bK1\b/i },
  { key: 'K2', category: 'PERMIT', materiality: 'MEDIUM', single: true, re: /^(კ-?2|k-?2|kz2)$|\bK2\b/i },
  { key: 'K3', category: 'PERMIT', materiality: 'LOW', single: true, re: /^(კ-?3|k-?3|kz3)$|\bK3\b/i },
  { key: 'structuralScheme', category: 'STRUCTURAL', materiality: 'MEDIUM', single: true, re: /კონსტრუქციული\s+(სქემა|სისტემა)|structural\s+(system|scheme)|კარკას/i },
  { key: 'maxStructuralSpan', category: 'STRUCTURAL', materiality: 'LOW', single: true, re: /მალი|span/i },
  { key: 'foundationType', category: 'FOUNDATION', materiality: 'MEDIUM', single: true, re: /საძირკვ|ფუნდამენტ|foundation|фундамент/i },
  { key: 'piles', category: 'FOUNDATION', materiality: 'MEDIUM', single: true, re: /ხიმინჯ|piles?|сва/i },
  { key: 'geologicalSurvey', category: 'GEOTECHNICAL', materiality: 'LOW', single: false, re: /გეოლოგ|geolog|геолог/i },
  { key: 'slabThickness', category: 'STRUCTURAL', materiality: 'MEDIUM', single: true, re: /ფილ(?:ის|ების)\s+სისქე|slab\s+thickness|толщина\s+плит/i },
  { key: 'concreteClass', category: 'STRUCTURAL', materiality: 'MEDIUM', single: true, re: /ბეტონის\s+(?:კლასი|მარკა|სიმტკიცის)|concrete\s+(?:class|grade)|класс\s+бетона/i },
  { key: 'concreteVolume', category: 'STRUCTURAL', materiality: 'MEDIUM', single: true, re: /ბეტონის\s+(?:მოცულობა|ხარჯი|საერთო)|concrete\s+volume|объ[её]м\s+бетона/i },
  { key: 'rebarClass', category: 'STRUCTURAL', materiality: 'LOW', single: true, re: /არმატურ|rebar|арматур/i },
  { key: 'foundationSlab', category: 'FOUNDATION', materiality: 'MEDIUM', single: true, re: /ფილოვან\S*\s+საძირკვ|raft|mat\s+foundation|плитн/i },
  { key: 'pileSize', category: 'FOUNDATION', materiality: 'LOW', single: true, re: /ხიმინჯ\S*\s+(?:სიგრძე|დიამეტრი|სიღრმე)|pile\s+(?:length|diameter)/i },
  { key: 'wallMaterial', category: 'MATERIAL', materiality: 'LOW', single: true, re: /კედლ(?:ის|ების)\s+(?:მასალა|შევსება)|wall\s+material/i },
  { key: 'facadeMaterial', category: 'MATERIAL', materiality: 'LOW', single: true, re: /ფასადის\s+(?:მოპირკეთება|მასალა|დამუშავება)|facade\s+(?:cladding|material)/i },
  { key: 'insulation', category: 'MATERIAL', materiality: 'LOW', single: true, re: /თბოიზოლაცი|insulation|утепл/i },
  { key: 'seismic', category: 'STRUCTURAL', materiality: 'MEDIUM', single: true, re: /სეისმ|seismic|сейсм/i },
  { key: 'seismicZone', category: 'STRUCTURAL', materiality: 'MEDIUM', single: true, re: /სეისმურ(?:ობა|ი\s+(?:ზონა|ბალი|მედეგობა))|seismic\s+(?:zone|intensity)/i },
  { key: 'energyEfficiency', category: 'MEP', materiality: 'LOW', single: true, re: /ენერგოეფექტ|energy/i },
  { key: 'fireSafety', category: 'MEP', materiality: 'MEDIUM', single: true, re: /ხანძარ|fire|пожар/i },
  { key: 'elevator', category: 'MEP', materiality: 'LOW', single: true, re: /ლიფტ|elevator|лифт/i },
  { key: 'facade', category: 'MATERIAL', materiality: 'LOW', single: true, re: /ფასად|facade|фасад/i },
  { key: 'landscaping', category: 'LANDSCAPE', materiality: 'LOW', single: true, re: /გამწვანებ|ლანდშაფტ|landscap|озелен/i },
  { key: 'projectRevision', category: 'REVISION', materiality: 'MEDIUM', single: false, re: /რედაქცი|revision|редакци/i },
];

/** technicalFacts keys produced by the worker that are PEOPLE, not specs. */
const PERSON_FACT_ROLES: Record<string, ParticipantRole> = {
  mainArchitectName: 'ARCHITECT',
  coAuthors: 'CO_ARCHITECT',
  architecturalComplianceSpecialist: 'EXPERT_REVIEW',
  structuralReviewSpecialist: 'STRUCTURAL_ENGINEER',
  foundationExpertAssessment: 'EXPERT_REVIEW',
  geotechnicalSpecialist: 'GEOTECHNICAL_SPECIALIST',
  constructionScheduleSpecialist: 'TECHNICAL_SUPERVISOR',
  expertAssessmentAuthor: 'EXPERT_REVIEW',
  supervisionRole: 'TECHNICAL_SUPERVISOR',
  applicant: 'APPLICANT',
  parcelOwner: 'PARCEL_OWNER',
  landscapeSpecialist: 'LANDSCAPE_ARCHITECT',
  mepSpecialist: 'MEP_ENGINEER',
  fireSafetySpecialist: 'FIRE_SAFETY',
  contractorCompany: 'CONTRACTOR',
  interiorDesigner: 'INTERIOR_DESIGNER',
};
const NON_FACT_KEYS = new Set(['organization', 'idCode', 'buildingBlock', 'buildingLiter']);

/*
 * VALUES THAT ARE NOT VALUES OF THEIR MATTER.
 *
 * Job c80f7237 rendered "building function: ფართობი → არასასოფლო სამეურნეო".
 * Neither is a building function: "ფართობი" (area) is a table header the form
 * reader took for a value, and "არასასოფლო სამეურნეო" (non-agricultural) is
 * the LAND category of the plot. A history built from them invents a change
 * of purpose that never happened, so they are refused at the door.
 */
const HEADER_WORD = /^(ფართობი|ფართი|რაოდენობა|მნიშვნელობა|დასახელება|ერთეული|სულ|area|value|name|unit|total|площадь|значение)$/i;
const LAND_CATEGORY = /^(არა)?სასოფლო[\s-]*სამეურნეო$|^(non-?)?agricultural$|^(не)?сельскохозяйственн/i;
export function acceptableValue(key: string, value: string): boolean {
  return cleanValue(key, value) !== null;
}

/*
 * A FORM VALUE, CLEANED — OR NOTHING.
 *
 * The worker reads values out of scanned and layered PDFs. Owner live run
 * 2026-10-10 (job 220ed087) showed what reaches a report unfiltered:
 * "....ქმედებები: 1662.0", ";", "ან/და გაბარიტები." as building function and
 * floors, and text printed twice by the PDF's own layers
 * ("საცხოვრებელი ობიექტებისაცხოვრებელი ობიექტები"). A value is cleaned once
 * (doubling, leaked label, stray punctuation) and must then look like a value
 * of ITS matter; anything else is dropped rather than shown as history.
 */
const NUMERIC_KEYS = new Set(['floors', 'undergroundFloors', 'height', 'landArea', 'footprintArea', 'totalArea', 'residentialArea', 'commercialArea', 'units', 'K1', 'K2', 'K3', 'slabThickness', 'concreteVolume', 'maxStructuralSpan']);
const BUILDING_USE = /საცხოვრებ|კომერცი|სავაჭრ|საოფის|ოფის|სასტუმრ|მრავალბინ|ერთბინ|შერეულ|ადმინისტრაც|საწარმო|სასაწყობ|სპორტ|საგანმანათლ|სამედიცინ|საზოგადოებრივ|residential|commercial|office|hotel|mixed|retail|warehouse|industrial|жил|коммерч|офис/i;
const SENTENCE = /(?:^|\s)(?:უნდა|იქნას|შეიძლება|გაითვალისწინ|რადგან|რომელიც|თუ|ან\/და|წარმოადგენს|მეტი|ნაკლები)(?:\s|$|[.,;])/u;
/** "XYZXYZ" or "XYZ XYZ" printed twice by a layered PDF → "XYZ". */
export function undouble(v: string): string {
  const t = v.replace(/\s+/g, ' ').trim();
  for (const sep of ['', ' ']) {
    const half = (t.length - sep.length) / 2;
    if (Number.isInteger(half) && half >= 3 && t.slice(0, half) === t.slice(half + sep.length)) return t.slice(0, half);
  }
  // Word-level: "წარმოადგენსწარმოადგენს" inside a phrase.
  return t.replace(/(\S{5,})\1/gu, "$1");
}
export function cleanValue(key: string, value: string): string | null {
  let v = undouble(s(value)).replace(/^[>\s.…;:,·-]+/, '').replace(/[\s.:;,·-]+$/, '').trim();
  // A label leaked in front ("მიზნობრივი დანიშნულება: X") — keep the value part only.
  const leaked = /^[^:]{3,60}:\s*(.+)$/u.exec(v);
  if (leaked && !/\d:\d/.test(v)) v = leaked[1].trim();
  if (!v || (v.length < 2 && !(NUMERIC_KEYS.has(key) && /\d/.test(v))) || HEADER_WORD.test(v)) return null;
  if (/[.…]{3,}|\t/.test(value) && v.length < 4) return null;
  if (v.length > 90 || SENTENCE.test(` ${v} `)) return null;
  if (NUMERIC_KEYS.has(key) && !/\d/.test(v)) return null;
  if (key === 'buildingFunction') {
    if (LAND_CATEGORY.test(v) || /მიზნობრივ|სასოფლო/i.test(v) || !BUILDING_USE.test(v) || /\d/.test(v)) return null;
  }
  if (key === 'buildingClass' && !/(?:^|\s|[^a-z])(I{1,3}|IV|V)(?:$|\s|[^a-z])|[1-5]/i.test(v)) return null;
  return v;
}

/*
 * A PARTICIPANT NAME, OR NOTHING.
 *
 * Form readers hand over whatever sat in the name cell: "დავით ლოსაბერიძე პ/ნ
 * 0100…", a CV line ('"იმკ-91" მშენებელ-ინჟინერი. 2018 წლიდან …'), a fragment
 * of a notarial clause ("ს - დავით ხ… სანოტარო წესით"). The report showed them
 * as the project team (owner live run 2026-10-10). A name is kept only when it
 * reads as a person (2–4 words, letters only) or an organisation in a legal
 * form; personal ID numbers are never carried.
 */
const ORG_FORM = /(?:^|\s|[„"«])(შპს|სს|ი\/მ|ააიპ|სსიპ|ა\(ა\)იპ|კს|სპს|llc|ltd|jsc|inc|gmbh|ооо|ао)(?:\s|$|[„"«.])/iu;
export function cleanParticipantName(raw: string): string | null {
  let v = undouble(s(raw))
    .replace(/\s*(?:პ\/ნ|პ\.ნ\.?|p\/n|ს\/კ|ს\.კ\.?|id)\s*:?\s*\d{8,11}/giu, '')
    .replace(/\s*\(\d{9,11}\)\s*/g, ' ')
    .replace(/[\t\s]+/g, ' ')
    .replace(/^[\s\-–—:;,.]+|[\s\-–—:;,.]+$/g, '')
    .trim();
  if (!v || v.length < 4 || v.length > 70) return null;
  if (SENTENCE.test(` ${v} `) || /წლიდან|დარგში|წესით|ექსპერტი|სპეციალისტი|სერტიფიკატ|\d{4}/u.test(v)) return null;
  if (ORG_FORM.test(v)) return v;
  // A person: 2–4 words of letters (Georgian, Latin or Cyrillic), each ≥ 2 letters.
  const words = v.split(' ');
  if (words.length < 2 || words.length > 4) return null;
  if (!words.every((w) => /^[\p{L}][\p{L}'’-]{1,}$/u.test(w))) return null;
  return v;
}

export function ruleFor(label: string): KeyRule | null {
  const t = s(label);
  if (!t) return null;
  for (const r of KEY_RULES) if (r.re.test(t)) return r;
  return null;
}

/** Party role text (any language) → a normalised role. Unknown → OTHER. */
export function normalizeRole(raw: string): ParticipantRole {
  const t = s(raw).toLowerCase();
  if (!t) return 'OTHER';
  if (/^co_applicant$|თანაგანმცხადებ|co-?applicant/.test(t)) return 'CO_APPLICANT';
  if (/^applicant$|განმცხადებ|applicant|заявител/.test(t)) return 'APPLICANT';
  if (/დამკვეთ|client|заказчик|commission/.test(t)) return 'CLIENT';
  if (/დეველოპ|developer|девелоп|застройщик/.test(t)) return 'DEVELOPER';
  if (/მესაკუთრ|owner|собственник/.test(t)) return 'PARCEL_OWNER';
  if (/ლანდშაფტ|landscape/.test(t)) return 'LANDSCAPE_ARCHITECT';
  if (/ინტერიერ|interior/.test(t)) return 'INTERIOR_DESIGNER';
  if (/თანაავტორ|co-?author/.test(t)) return 'CO_ARCHITECT';
  if (/არქიტექტ|architect|архитект/.test(t)) return 'ARCHITECT';
  if (/კონსტრუქტ|კონსტრუქციულ|structural|конструкт/.test(t)) return 'STRUCTURAL_ENGINEER';
  if (/გეოლოგ|geotech|geolog|геолог/.test(t)) return 'GEOTECHNICAL_SPECIALIST';
  if (/ექსპერტ|expert|экспертиз/.test(t)) return 'EXPERT_REVIEW';
  if (/ზედამხედველ|supervis|надзор/.test(t)) return 'TECHNICAL_SUPERVISOR';
  if (/მშენებელ|კონტრაქტორ|contractor|builder|подрядчик|строител/.test(t)) return 'CONTRACTOR';
  if (/ვენტილ|გათბობ|ელექტრ|წყალ|კანალიზ|hvac|mep|electric|plumb/.test(t)) return 'MEP_ENGINEER';
  if (/ხანძრ|fire/.test(t)) return 'FIRE_SAFETY';
  if (/აზომვ|ტოპოგრაფ|survey/.test(t)) return 'SURVEYOR';
  return 'OTHER';
}

/** Official event kind from a case/motion title or status (Georgian first). */
export function eventKind(text: string): EventKind {
  const t = s(text).toLowerCase();
  if (/უარ|refus|отказ/.test(t)) return 'REFUSAL';
  if (/შეჩერ|suspend|приостан/.test(t)) return 'SUSPENSION';
  if (/ექსპლუატაციაში\s+მიღებ|commission|ввод в эксплуатацию/.test(t)) return 'COMMISSIONING';
  if (/ვადის\s+გაგრძელ|გაგრძელ|extension|продлени/.test(t)) return 'EXTENSION';
  if (/ცვლილებ|შესწორებ|amend|изменени|კორექტირ/.test(t)) return 'AMENDMENT';
  if (/ნებართვ|permit|разрешени/.test(t)) return 'PERMIT';
  if (/შეთანხმებ|დამტკიცებ|approv|согласован|утвержд/.test(t)) return 'APPROVAL';
  if (/ინსპექტ|შემოწმებ|inspect|проверк/.test(t)) return 'INSPECTION';
  if (/ბრძანებ|გადაწყვეტილებ|decision|решени|приказ/.test(t)) return 'DECISION';
  if (/განცხადებ|რეგისტრაცი|application|заявлени|регистрац/.test(t)) return 'APPLICATION';
  return 'OTHER';
}

const EVENT_MATERIALITY: Record<EventKind, Materiality> = {
  REFUSAL: 'HIGH', SUSPENSION: 'HIGH', COMMISSIONING: 'HIGH', EXTENSION: 'HIGH', AMENDMENT: 'HIGH', PERMIT: 'HIGH',
  APPROVAL: 'MEDIUM', DECISION: 'MEDIUM', INSPECTION: 'MEDIUM', APPLICATION: 'LOW', OTHER: 'LOW',
};

/** A date written inside a value, for deadline facts. */
function dateInText(v: string): string | null {
  const m = /(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(v);
  if (m && +m[2] <= 12) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  const y = /(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return y ? y[0] : null;
}

function normName(n: string): string {
  return n
    .toLowerCase()
    .replace(/["'«»„“”`]/g, '')
    .replace(/(^|\s)(შპს|სს|ი\/მ|llc|jsc|ltd|ооо|оао|зао)(?=\s|$)/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ─────────────────────────────── input reading ───────────────────────────────

interface CaseInput {
  documentId: string | null;
  caseRef: string | null;
  title: string | null;
  docType: string | null;
  status: string | null;
  date: string | null;
  parties: Array<{ role: string; name: string; kind?: string; organizationId?: string | null }>;
  values: Array<{ key: string; label: string | null; value: string }>;
  technicalFacts: Array<{ category: string; key: string; value: string }>;
  motions: Array<{ motionId?: string; date: string | null; name: string | null; status: string | null; decisionNumber?: string | null; response?: string; decision?: any }>;
  block: string | null;
}

function tasResults(report: unknown): any[] {
  return arr<any>(obj(obj(report).browserOfficial).results).filter((r) => s(r?.source).toLowerCase() === 'tas');
}

function readCases(report: unknown): { cases: CaseInput[]; api: any | null } {
  const results = tasResults(report);
  const api = results.find((r) => r?.tasApi)?.tasApi ?? null;
  const cases: CaseInput[] = [];
  if (api) {
    for (const c of arr<any>(api.cases)) {
      const tf = arr<any>(c.technicalFacts);
      const block = s(tf.find((f) => f?.key === 'buildingBlock' || f?.key === 'buildingLiter')?.value) || null;
      cases.push({
        documentId: s(c.documentId) || null,
        caseRef: s(c.registrationNumber) || null,
        title: s(c.title) || null,
        docType: s(c.docType) || null,
        status: s(c.status) || null,
        date: day(c.date),
        parties: arr<any>(c.parties).map((p) => ({ role: s(p?.role), name: s(p?.name), kind: s(p?.kind), organizationId: p?.organizationId ?? null })),
        values: arr<any>(c.values).map((v) => ({ key: s(v?.key), label: s(v?.label) || null, value: s(v?.value) })),
        technicalFacts: tf.map((f) => ({ category: s(f?.category), key: s(f?.key), value: s(f?.value) })),
        motions: arr<any>(c.motions).map((m) => ({ motionId: s(m?.motionId), date: day(m?.date), name: s(m?.name) || null, status: s(m?.status) || null, decisionNumber: s(m?.decisionNumber) || null, response: s(m?.response), decision: m?.decision && typeof m.decision === 'object' ? revalidateDecision(m.decision) : null })),
        block,
      });
    }
    return { cases, api };
  }
  // LEGACY: one entry per read document, with its technical facts.
  for (const r of results)
    for (const d of arr<any>(r.documents)) {
      const tf = arr<any>(d.technicalFacts);
      const block = s(tf.find((f) => f?.key === 'buildingBlock' || f?.key === 'buildingLiter')?.value) || null;
      cases.push({
        documentId: s(d.tasDocumentId ?? d.id) || null,
        caseRef: null,
        title: s(d.title ?? d.label) || null,
        docType: null,
        status: null,
        date: day(d.date ?? d.documentDate),
        parties: [],
        values: [],
        technicalFacts: tf.map((f) => ({ category: s(f?.category), key: s(f?.key), value: s(f?.value) })),
        motions: [],
        block,
      });
    }
  return { cases, api: null };
}

// ─────────────────────────────── the builder ───────────────────────────────

export function buildTasIntelligence(report: unknown, nowIso = new Date().toISOString()): TasIntelligence {
  const { cases, api } = readCases(report);
  const r0 = obj(report);
  const empty: TasIntelligence = {
    available: false,
    coverage: {
      implementation: 'UNKNOWN', cases: 0, sourceTotal: null, reconciled: null, motions: 0, officialResponses: 0,
      attachmentsAccounted: 0, attachmentsRead: 0, scanOnly: 0, unsupportedFormats: 0, notProcessed: 0, earliestDate: null, latestDate: null,
    },
    facts: [], timeline: [], participants: [], story: [], visuals: [], conflicts: [], currentFactIds: [],
    officialStatus: { state: 'NOT_ESTABLISHED', since: null, basis: null, validUntil: null, pending: [], conclusive: false, caveats: ['NO_DECISIONS_READ'] },
    milestoneIds: [],
    legalClaims: legalClaims([]),
    funnel: { discoveredDocuments: 0, discoveredMotions: 0, discoveredAttachments: 0, processedResponses: 0, processedAttachments: 0, deferredAttachments: 0, retainedFacts: 0, retainedEvents: 0, milestones: 0, visualsSelected: 0, incomplete: false, incompleteReasons: [] },
  };
  if (!cases.length) return empty;

  // ── facts: collect occurrences, then group by matter (key + block) ──
  type Occ = { rule: KeyRule | null; key: string; label: string; value: string; block: string | null; src: FactSource; category: TasFact['category']; materiality: Materiality; single: boolean };
  const occ: Occ[] = [];
  const participantsRaw: Array<{ name: string; kind: string; organizationId: string | null; role: ParticipantRole; date: string | null; documentId: string | null }> = [];

  for (const c of cases) {
    const src: FactSource = { documentId: c.documentId, caseRef: c.caseRef, date: c.date, label: c.title };
    for (const v of c.values) {
      if (!v.value) continue;
      const rule = ruleFor(v.label ?? v.key) ?? ruleFor(v.key);
      const key = rule?.key ?? `field:${valueIdentity(v.label ?? v.key).slice(0, 60)}`;
      const cleaned = cleanValue(key, v.value);
      if (cleaned === null) continue;
      occ.push({ rule, key, label: v.label ?? v.key, value: cleaned, block: c.block, src, category: rule?.category ?? 'OTHER', materiality: rule?.materiality ?? 'LOW', single: rule?.single ?? true });
    }
    for (const f of c.technicalFacts) {
      if (!f.value || NON_FACT_KEYS.has(f.key)) continue;
      const role = PERSON_FACT_ROLES[f.key];
      if (role) {
        // Values like "ნინო კაპანაძე" or "შპს X (405...)" — one participant per value.
        participantsRaw.push({ name: f.value, kind: /შპს|სს|llc|ltd|jsc|ооо/i.test(f.value) ? 'ORGANIZATION' : 'UNKNOWN', organizationId: /\b(\d{9})\b/.exec(f.value)?.[1] ?? null, role, date: c.date, documentId: c.documentId });
        continue;
      }
      const rule = KEY_RULES.find((r) => r.key === f.key) ?? ruleFor(f.key);
      const key = rule?.key ?? `tf:${f.key}`;
      const cleanedTf = cleanValue(key, f.value);
      if (cleanedTf === null) continue;
      occ.push({ rule, key, label: rule?.key ?? f.key, value: cleanedTf, block: c.block, src, category: rule?.category ?? (['PROJECT', 'PERMIT', 'STRUCTURAL', 'FOUNDATION', 'GEOTECHNICAL', 'MEP', 'LANDSCAPE', 'MATERIAL', 'REVISION'].includes(f.category) ? (f.category as TasFact['category']) : 'OTHER'), materiality: rule?.materiality ?? 'LOW', single: rule?.single ?? true });
    }
    for (const p of c.parties) {
      if (!p.name) continue;
      participantsRaw.push({ name: p.name, kind: p.kind || 'UNKNOWN', organizationId: p.organizationId ?? null, role: normalizeRole(p.role), date: c.date, documentId: c.documentId });
    }
  }

  // Deadline facts carry their own date (the deadline), not only the doc date.
  const groups = new Map<string, Occ[]>();
  for (const o of occ) {
    const g = `${o.key}|${o.block ?? ''}`;
    const list = groups.get(g) ?? [];
    list.push(o);
    groups.set(g, list);
  }

  const facts: TasFact[] = [];
  const conflicts: TasIntelligence['conflicts'] = [];
  let fid = 0;
  for (const [, list] of groups) {
    // Same matter + same value → ONE fact with every source.
    const byValue = new Map<string, Occ[]>();
    for (const o of list) {
      const id = valueIdentity(o.value);
      const vl = byValue.get(id) ?? [];
      vl.push(o);
      byValue.set(id, vl);
    }
    const versions = [...byValue.values()].map((vl) => {
      const dates = vl.map((o) => o.src.date).filter(Boolean).sort() as string[];
      const sources: FactSource[] = [];
      const seen = new Set<string>();
      for (const o of vl) {
        const k = `${o.src.documentId}|${o.src.date}`;
        if (seen.has(k)) continue;
        seen.add(k);
        sources.push(o.src);
      }
      return { o: vl[0], firstSeen: dates[0] ?? null, lastSeen: dates[dates.length - 1] ?? null, sources };
    });
    versions.sort((a, b) => (a.lastSeen ?? '').localeCompare(b.lastSeen ?? ''));
    const single = versions[0].o.single;
    const newest = versions[versions.length - 1];
    const tiedAtNewest = versions.filter((v) => v.lastSeen === newest.lastSeen);
    const conflicting = single && tiedAtNewest.length > 1 && !!newest.lastSeen;
    if (conflicting)
      conflicts.push({ key: newest.o.key, label: newest.o.label, block: newest.o.block, values: tiedAtNewest.map((v) => ({ value: v.o.value, date: v.lastSeen })) });
    for (const v of versions) {
      let status: FactStatus;
      if (!single) status = v === newest ? 'CURRENT' : 'HISTORICAL';
      else if (conflicting && tiedAtNewest.includes(v)) status = 'CONFLICTING';
      else if (v === newest) status = 'CURRENT';
      else status = 'SUPERSEDED';
      const isDecision = v.o.category === 'DEADLINE' || v.o.category === 'PERMIT';
      facts.push({
        id: `tf${++fid}`,
        key: v.o.key,
        label: v.o.label,
        category: v.o.category,
        value: v.o.value,
        block: v.o.block,
        firstSeen: v.firstSeen,
        lastSeen: v.lastSeen,
        sources: v.sources,
        status,
        materiality: v.o.materiality,
        basis: isDecision ? 'OFFICIAL_DECISION' : 'DOCUMENTED_SPECIFICATION',
        ...(status === 'SUPERSEDED' ? { supersededBy: newest.o.value } : {}),
      });
    }
  }

  // ── timeline: cases and their motions, by real date ──
  const timeline: TimelineEvent[] = [];
  let eid = 0;
  const seenEvents = new Set<string>();
  const pushEvent = (date: string | null, title: string, c: CaseInput, status: string | null, decision: any = null) => {
    const d = decision && OUTCOMES.has(decision.outcome) ? decision : null;
    const when = (d?.issueDate as string | null) ?? date;
    if (!when || (!title && !d)) return;
    // A read decision's legal effect outranks the wording of the step's name.
    const kind = d && d.outcome !== 'UNDETERMINED' && d.outcome !== 'INFORMATIONAL' ? KIND_FOR_OUTCOME[d.outcome as DecisionOutcome] : eventKind(`${title} ${status ?? ''}`);
    const k = `${when}|${kind}|${valueIdentity(title)}|${c.documentId ?? ''}|${d?.number ?? ''}`;
    if (seenEvents.has(k)) return;
    seenEvents.add(k);
    timeline.push({
      id: `te${++eid}`, date: when, kind, title: title || (d?.number ? `№ ${d.number}` : ''), caseRef: c.caseRef, documentId: c.documentId, status,
      materiality: d && OUTCOME_MATERIAL.has(d.outcome) ? 'HIGH' : EVENT_MATERIALITY[kind],
      decision: d ? { number: d.number ?? null, outcome: d.outcome, evidence: d.evidence ? String(d.evidence).slice(0, 240) : null, validUntil: d.validUntil ?? null } : null,
      relevance: 0,
    });
  };
  for (const c of cases) {
    pushEvent(c.date, c.docType ?? c.title ?? '', c, c.status);
    for (const m of c.motions) pushEvent(m.date, m.name ?? '', c, m.status, m.decision);
  }
  timeline.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  // A deadline is itself a dated fact worth placing on the timeline.
  for (const f of facts.filter((x) => x.key === 'constructionDeadline' && x.status !== 'SUPERSEDED')) {
    const d = dateInText(f.value);
    if (d) f.lastSeen = f.lastSeen ?? d;
  }

  // ── participants: exact identity only ──
  const byIdentity = new Map<string, Participant & { _docs: Set<string> }>();
  let pid = 0;
  for (const raw of participantsRaw) {
    const name = cleanParticipantName(raw.name);
    if (!name) continue;
    const p = { ...raw, name, kind: raw.kind === 'UNKNOWN' && ORG_FORM.test(name) ? 'ORGANIZATION' : raw.kind };
    const n = normName(p.name);
    if (!n || n.length < 3) continue;
    const id = p.organizationId ? `org:${p.organizationId}` : `name:${n}`;
    let e = byIdentity.get(id);
    if (!e) {
      const kind = p.kind === 'ORGANIZATION' || p.organizationId ? 'ORGANIZATION' : p.kind === 'PERSON' ? 'PERSON' : 'UNKNOWN';
      e = { id: `tp${++pid}`, name: p.name.replace(/\s*\(\d{9}\)\s*$/, '').trim(), kind, organizationId: p.organizationId, roles: [], firstSeen: p.date, lastSeen: p.date, cases: 0, current: false, customerVisible: true, _docs: new Set() };
      byIdentity.set(id, e);
    }
    if (!e.roles.includes(p.role)) e.roles.push(p.role);
    if (p.date && (!e.firstSeen || p.date < e.firstSeen)) e.firstSeen = p.date;
    if (p.date && (!e.lastSeen || p.date > e.lastSeen)) e.lastSeen = p.date;
    if (p.documentId) e._docs.add(p.documentId);
  }
  const participants: Participant[] = [];
  const latestByRole = new Map<ParticipantRole, string>();
  for (const e of byIdentity.values())
    for (const r of e.roles) if (e.lastSeen && (!latestByRole.get(r) || e.lastSeen > latestByRole.get(r)!)) latestByRole.set(r, e.lastSeen);
  const PRIVATE_ONLY: ParticipantRole[] = ['APPLICANT', 'CO_APPLICANT', 'PARCEL_OWNER', 'CLIENT', 'OTHER'];
  for (const e of byIdentity.values()) {
    const { _docs, ...rest } = e;
    participants.push({
      ...rest,
      cases: _docs.size,
      current: e.roles.some((r) => !!e.lastSeen && latestByRole.get(r) === e.lastSeen),
      customerVisible: !(e.kind !== 'ORGANIZATION' && e.roles.every((r) => PRIVATE_ONLY.includes(r))),
    });
  }
  participants.sort((a, b) => (b.lastSeen ?? '').localeCompare(a.lastSeen ?? '') || a.name.localeCompare(b.name));

  // ── relevance, current status, milestones ──
  scoreEvents(timeline, nowIso);
  const officialStatus = deriveOfficialStatus(timeline, api, nowIso);
  const milestoneIds = selectMilestones(timeline, officialStatus);

  // ── story chapters ──
  const story = buildStory(timeline, facts, nowIso);

  // ── visuals: linked to the nearest dated event and its chapter ──
  const visuals: VisualRef[] = arr<any>(r0.officialVisuals ?? api?.visuals).slice(0, 4).map((v) => {
    const d = day(v?.date);
    let nearest: TimelineEvent | null = null;
    if (d)
      for (const e of timeline) {
        const gap = Math.abs(Date.parse(e.date) - Date.parse(d));
        if (gap <= 365 * 864e5 && (!nearest || gap < Math.abs(Date.parse(nearest.date) - Date.parse(d)))) nearest = e;
      }
    const chapter = nearest ? (story.find((c) => c.eventIds.includes(nearest!.id))?.key ?? null) : v?.role === 'LATEST_RENDER' ? 'TODAY' : null;
    return {
      id: s(v?.id), role: v?.role ?? 'SUPPORTING', kind: s(v?.kind) || 'OTHER_DRAWING', date: d, chapter, eventId: nearest?.id ?? null,
      width: v?.width ?? null, height: v?.height ?? null,
      versionStatus: visualVersionStatus(s(v?.documentId) || null, timeline),
      documentId: s(v?.documentId) || null, attachedFileId: s(v?.attachedFileId) || null,
    };
  }).filter((v) => /^[a-f0-9]{64}$/.test(v.id));

  // ── coverage (truthful, from the worker's own accounting) ──
  const acc = obj(api?.accounting);
  const outcomes = obj(acc.attachmentOutcomes);
  const dates = [...timeline.map((e) => e.date), ...cases.map((c) => c.date).filter(Boolean) as string[]].sort();
  const coverage: TasCoverage = {
    implementation: api ? 'API_FIRST' : 'LEGACY',
    cases: cases.length,
    sourceTotal: api?.reconciliation?.sourceTotal ?? null,
    reconciled: api?.reconciliation?.reconciled ?? null,
    motions: Number(acc.motions) || cases.reduce((n, c) => n + c.motions.length, 0),
    officialResponses: Number(obj(acc.responses).PDF || 0) + Number(obj(acc.responses).HTML || 0),
    attachmentsAccounted: Number(acc.attachments) || 0,
    attachmentsRead: Number(outcomes.READ_TEXT || 0) + Number(outcomes.LOW_TEXT || 0),
    pagesRead: arr<any>(api?.cases).reduce((n, c) => n + arr<any>(c?.attachments).reduce((m, a) =>
      m + ((a?.outcome === 'READ_TEXT' || a?.outcome === 'LOW_TEXT') && Number(a?.pages) > 0 ? Number(a.pages) : 0), 0), 0),
    scanOnly: Number(outcomes.SCAN_OR_IMAGE_ONLY || 0),
    unsupportedFormats: Number(outcomes.UNSUPPORTED_FORMAT || 0),
    notProcessed: Number(outcomes.NOT_PROCESSED_BUDGET || 0) + Number(outcomes.DOWNLOAD_FAILED || 0) + Number(outcomes.FAILED || 0),
    earliestDate: dates[0] ?? null,
    latestDate: dates[dates.length - 1] ?? null,
  };

  return {
    available: true,
    coverage,
    facts,
    timeline,
    participants,
    story,
    visuals,
    conflicts,
    currentFactIds: facts.filter((f) => f.status === 'CURRENT' || f.status === 'CONFLICTING').map((f) => f.id),
    officialStatus,
    milestoneIds,
    legalClaims: legalClaims(timeline.map((e) => {
      const kc = cases.find((c) => c.documentId === e.documentId);
      return {
        date: e.date, caseRef: e.caseRef, block: kc?.block ?? null,
        decision: e.decision ? { number: e.decision.number, outcome: e.decision.outcome, evidence: e.decision.evidence } : null,
        serviceText: kc ? [kc.docType, kc.title].filter(Boolean).join(' · ') : null,
      };
    })),
    funnel: {
      discoveredDocuments: Number(obj(api?.ledger).discovered?.documents ?? cases.length) || cases.length,
      discoveredMotions: Number(obj(api?.ledger).discovered?.motions ?? coverage.motions) || 0,
      discoveredAttachments: Number(obj(api?.ledger).discovered?.attachments ?? coverage.attachmentsAccounted) || 0,
      processedResponses: Number(obj(api?.ledger).processed?.responses ?? 0) || 0,
      processedAttachments: Number(obj(api?.ledger).processed?.attachmentsRead ?? coverage.attachmentsRead) || 0,
      deferredAttachments: Number(obj(api?.ledger).deferred?.attachmentsBudget ?? 0) || 0,
      retainedFacts: facts.length,
      retainedEvents: timeline.length,
      milestones: milestoneIds.length,
      visualsSelected: visuals.length,
      incomplete: obj(api?.ledger).incomplete === true,
      incompleteReasons: arr<string>(obj(api?.ledger).incompleteReasons).map(String),
    },
  };
}

// ─────────────────────────── authority, relevance, milestones ───────────────────────────

const OUTCOMES = new Set<string>(['PERMIT_ISSUED', 'APPROVED', 'AMENDMENT_APPROVED', 'DEADLINE_EXTENDED', 'COMMISSIONED', 'INTERMEDIATE', 'DEFICIENCY', 'REFUSED', 'SUSPENDED', 'CANCELLED', 'INFORMATIONAL', 'UNDETERMINED']);
const OUTCOME_MATERIAL = new Set<string>(['PERMIT_ISSUED', 'AMENDMENT_APPROVED', 'DEADLINE_EXTENDED', 'COMMISSIONED', 'REFUSED', 'SUSPENDED', 'CANCELLED', 'APPROVED']);
const NEGATIVE = new Set<string>(['REFUSED', 'SUSPENDED', 'CANCELLED']);
const KIND_FOR_OUTCOME: Record<DecisionOutcome, EventKind> = {
  PERMIT_ISSUED: 'PERMIT', APPROVED: 'APPROVAL', AMENDMENT_APPROVED: 'AMENDMENT', DEADLINE_EXTENDED: 'EXTENSION', COMMISSIONED: 'COMMISSIONING',
  INTERMEDIATE: 'DECISION', DEFICIENCY: 'DECISION', REFUSED: 'REFUSAL', SUSPENDED: 'SUSPENSION', CANCELLED: 'DECISION', INFORMATIONAL: 'OTHER', UNDETERMINED: 'OTHER',
};
const KIND_WEIGHT: Record<EventKind, number> = {
  COMMISSIONING: 50, PERMIT: 48, SUSPENSION: 48, REFUSAL: 45, AMENDMENT: 44, EXTENSION: 42, APPROVAL: 38, DECISION: 28, INSPECTION: 22, APPLICATION: 14, OTHER: 4,
};

/**
 * Deterministic relevance: legal effect first, then whether it bears on the
 * present, then recency, then uniqueness. Routine correspondence and repeated
 * administrative steps sink; a negative decision never sinks below the
 * material threshold however old it is.
 */
export function scoreEvents(timeline: TimelineEvent[], nowIso: string): void {
  const now = Date.parse(nowIso);
  const seenKindPerCase = new Map<string, number>();
  for (const e of timeline) {
    const outcome = e.decision?.outcome ?? null;
    let score = KIND_WEIGHT[e.kind];
    if (outcome === 'CANCELLED') score = 52;
    if (outcome && outcome !== 'UNDETERMINED' && outcome !== 'INFORMATIONAL') score += 10; // a read decision, not just a step name
    const ageYears = Math.max(0, (now - Date.parse(e.date)) / (365 * 864e5));
    score += Math.max(0, 20 - ageYears * 2.5); // recency, at most 20
    const k = `${e.caseRef ?? e.documentId}|${e.kind}`;
    const n = (seenKindPerCase.get(k) ?? 0) + 1;
    seenKindPerCase.set(k, n);
    if (n > 1) score -= 15 * (n - 1); // the same step repeated in one case
    if (outcome && NEGATIVE.has(outcome)) score = Math.max(score, 60);
    e.relevance = Math.max(0, Math.min(100, Math.round(score)));
  }
}

/** Walk the decisions in date order; the controlling one is the latest with legal effect. */
export function deriveOfficialStatus(timeline: TimelineEvent[], api: any, nowIso: string): CurrentOfficialStatus {
  const decided = timeline.filter((e) => e.decision && e.decision.outcome !== 'UNDETERMINED' && e.decision.outcome !== 'INFORMATIONAL');
  let state = 'NOT_ESTABLISHED' as OfficialState;
  let basisEvent: TimelineEvent | null = null;
  let validUntil: string | null = null;
  for (const e of decided) {
    const o = e.decision!.outcome;
    const set = (next: OfficialState) => { state = next; basisEvent = e; };
    if (o === 'CANCELLED') { set('CANCELLED'); validUntil = null; }
    else if (o === 'SUSPENDED') set('SUSPENDED');
    else if (o === 'COMMISSIONED') set('COMMISSIONED');
    else if (o === 'PERMIT_ISSUED' || o === 'AMENDMENT_APPROVED') { set('PERMITTED'); if (e.decision!.validUntil) validUntil = e.decision!.validUntil; }
    else if (o === 'DEADLINE_EXTENDED') { if (state === 'PERMITTED' || state === 'NOT_ESTABLISHED' || state === 'SUSPENDED') set('PERMITTED'); validUntil = e.decision!.validUntil ?? validUntil; }
    else if (o === 'APPROVED') { if (state === 'NOT_ESTABLISHED' || state === 'APPLICATION_PENDING' || state === 'APPLICATION_REFUSED') set('PROJECT_APPROVED'); }
    // A refusal answers ONE application; it does not revoke an earlier permit.
    else if (o === 'REFUSED') { if (state === 'NOT_ESTABLISHED' || state === 'APPLICATION_PENDING') set('APPLICATION_REFUSED'); }
    else if (o === 'INTERMEDIATE' || o === 'DEFICIENCY') { if (state === 'NOT_ESTABLISHED') set('APPLICATION_PENDING'); }
  }
  // Later applications whose latest answer is not final.
  const lastByCase = new Map<string, TimelineEvent>();
  for (const e of decided) lastByCase.set(e.caseRef ?? e.documentId ?? e.id, e);
  const pending = [...lastByCase.values()]
    .filter((e) => (e.decision!.outcome === 'INTERMEDIATE' || e.decision!.outcome === 'DEFICIENCY') && (!basisEvent || e.date >= (basisEvent as TimelineEvent).date))
    .map((e) => ({ caseRef: e.caseRef, date: e.date, outcome: e.decision!.outcome }));
  const caveats: CurrentOfficialStatus['caveats'] = [];
  const responses = obj(obj(api?.accounting).responses);
  if (Number(responses.FAILED || 0) + Number(responses.NOT_FETCHED || 0) > 0) caveats.push('RESPONSES_UNREAD');
  const b = basisEvent as TimelineEvent | null;
  // A later official answer that exists but could not be read (scan, parse
  // failure, unknown format, ambiguous wording) may change the position.
  const unreadLater = arr<any>(api?.cases).some((c) =>
    arr<any>(c?.motions).some((m) => {
      const kind = s(m?.response);
      if (kind !== 'PDF' && kind !== 'HTML' && kind !== 'OTHER') return false;
      const outcome = s(obj(revalidateDecision(obj(m?.decision))).outcome);
      if (outcome && outcome !== 'UNDETERMINED') return false;
      const d = day(m?.date);
      return !b || !d || d > b.date;
    }));
  if (b && (unreadLater || timeline.some((e) => e.date > b.date && e.decision && e.decision.outcome === 'UNDETERMINED'))) caveats.push('LATER_UNDETERMINED_DECISION');
  // Fail closed: API results without a ledger cannot prove completeness.
  if (api && !api.ledger) caveats.push('PROCESSING_UNVERIFIED');
  if (obj(api?.ledger).incomplete === true) caveats.push('PROCESSING_INCOMPLETE');
  // The status is parcel-wide. When cases for DIFFERENT building blocks end
  // on opposite legal footing (block A cancelled, block B permitted) it is
  // not one answer. A cancellation filed as its own case without a block is
  // the ordinary pattern and is not flagged.
  const blockOf = new Map<string, string>();
  for (const c of arr<any>(api?.cases)) {
    const tf = arr<any>(c?.technicalFacts);
    const blk = s(tf.find((f) => f?.key === 'buildingBlock' || f?.key === 'buildingLiter')?.value);
    if (blk) blockOf.set(s(c?.documentId), blk.toLowerCase());
  }
  const finalByCase = new Map<string, { outcome: string; block: string | null }>();
  for (const e of decided)
    if (OUTCOME_MATERIAL.has(e.decision!.outcome))
      finalByCase.set(e.caseRef ?? e.documentId ?? e.id, { outcome: e.decision!.outcome, block: blockOf.get(e.documentId ?? '') ?? null });
  const finals = [...finalByCase.values()];
  const sanctionedBlocks = new Set(finals.filter((f) => f.block && (f.outcome === 'CANCELLED' || f.outcome === 'SUSPENDED')).map((f) => f.block));
  const allowedBlocks = new Set(finals.filter((f) => f.block && !NEGATIVE.has(f.outcome)).map((f) => f.block));
  if (sanctionedBlocks.size && allowedBlocks.size && [...allowedBlocks].some((b) => !sanctionedBlocks.has(b))) caveats.push('CASES_DISAGREE');
  if (!decided.length) caveats.push('NO_DECISIONS_READ');
  if (validUntil && Date.parse(validUntil) < Date.parse(nowIso)) caveats.push('VALIDITY_PASSED');
  return {
    state,
    since: b?.date ?? null,
    basis: b ? { caseRef: b.caseRef, decisionNumber: b.decision?.number ?? null, date: b.date, outcome: b.decision!.outcome, evidence: b.decision?.evidence ?? null } : null,
    validUntil,
    pending,
    conclusive: state !== 'NOT_ESTABLISHED' && caveats.length === 0,
    caveats,
  };
}

/**
 * 5–10 milestones: the first record, every decision with legal effect (all
 * negative ones always), the controlling decision, then the most relevant of
 * the rest. One per case+kind. Chronological.
 */
export function selectMilestones(timeline: TimelineEvent[], status: CurrentOfficialStatus, max = 10): string[] {
  if (!timeline.length) return [];
  const chosen = new Map<string, TimelineEvent>();
  const keyOf = (e: TimelineEvent) => `${e.caseRef ?? e.documentId}|${e.kind}`;
  const take = (e: TimelineEvent | undefined) => {
    if (!e) return;
    const k = keyOf(e);
    const prior = chosen.get(k);
    if (!prior || e.relevance > prior.relevance || (e.relevance === prior.relevance && e.date > prior.date)) chosen.set(k, e);
  };
  take(timeline[0]);
  for (const e of timeline) if (e.decision && NEGATIVE.has(e.decision.outcome)) take(e);
  const basisDate = status.basis?.date;
  take(timeline.find((e) => e.date === basisDate && e.decision?.outcome === status.basis?.outcome));
  for (const e of [...timeline].sort((a, b) => b.relevance - a.relevance)) {
    if (chosen.size >= max) break;
    if (e.relevance < 30) break; // routine noise never fills the list
    take(e);
  }
  let list = [...chosen.values()];
  if (list.length > max) {
    // Over budget only with many decisions: keep negatives and the basis, drop the least relevant others.
    const keep = (e: TimelineEvent) => (e.decision && NEGATIVE.has(e.decision.outcome)) || (e.date === basisDate && e.decision?.outcome === status.basis?.outcome) || e === timeline[0];
    const others = list.filter((e) => !keep(e)).sort((a, b) => b.relevance - a.relevance);
    list = [...list.filter(keep), ...others.slice(0, Math.max(0, max - list.filter(keep).length))];
  }
  return list.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).map((e) => e.id);
}

/** Current vs historical approved design, from the decisions of the visual's own case. */
function visualVersionStatus(documentId: string | null, timeline: TimelineEvent[]): VisualRef['versionStatus'] {
  if (!documentId) return 'UNDETERMINED';
  const approving = new Set(['PERMIT_ISSUED', 'APPROVED', 'AMENDMENT_APPROVED']);
  const approvals = timeline.filter((e) => e.decision && approving.has(e.decision.outcome));
  const mine = approvals.filter((e) => e.documentId === documentId);
  if (!mine.length) return 'UNDETERMINED';
  const latest = approvals[approvals.length - 1];
  return latest.documentId === documentId ? 'CURRENT_APPROVED' : 'HISTORICAL_APPROVED';
}

function buildStory(timeline: TimelineEvent[], facts: TasFact[], nowIso: string): StoryChapter[] {
  if (!timeline.length && !facts.length) return [];
  const chapters: StoryChapter[] = [];
  const add = (key: StoryChapter['key'], events: TimelineEvent[], factIds: string[] = []) => {
    if (!events.length && !factIds.length) return;
    chapters.push({ key, from: events[0]?.date ?? null, to: events[events.length - 1]?.date ?? null, eventIds: events.map((e) => e.id), factIds });
  };
  const used = new Set<string>();
  const take = (pred: (e: TimelineEvent) => boolean) => {
    const out = timeline.filter((e) => !used.has(e.id) && pred(e));
    out.forEach((e) => used.add(e.id));
    return out;
  };
  const firstPermitIdx = timeline.findIndex((e) => e.kind === 'PERMIT' || e.kind === 'APPROVAL');
  const firstPermitDate = firstPermitIdx >= 0 ? timeline[firstPermitIdx].date : null;
  const recentCut = new Date(Date.parse(nowIso) - 548 * 864e5).toISOString().slice(0, 10);

  // EARLIEST: the first dated record, if it precedes the first approval.
  if (timeline.length) add('EARLIEST', take((e) => e === timeline[0] && (!firstPermitDate || e.date < firstPermitDate)));
  // INITIAL PROJECT: applications before the first approval.
  add('INITIAL_PROJECT', take((e) => !!firstPermitDate && e.date < firstPermitDate && e.date < recentCut));
  // APPROVALS: the first permits/approvals.
  add('APPROVALS', take((e) => (e.kind === 'PERMIT' || e.kind === 'APPROVAL') && e.date < recentCut && !chaptersHasKind(chapters, 'APPROVALS')));
  // CHANGES: amendments, extensions, refusals, suspensions before the recent window.
  add('CHANGES', take((e) => ['AMENDMENT', 'EXTENSION', 'REFUSAL', 'SUSPENSION'].includes(e.kind) && e.date < recentCut), facts.filter((f) => f.status === 'SUPERSEDED').map((f) => f.id));
  // CONSTRUCTION: inspections, commissioning and everything else older.
  add('CONSTRUCTION', take((e) => e.date < recentCut && e.materiality !== 'LOW'));
  // RECENT: the last ~18 months.
  add('RECENT', take((e) => e.date >= recentCut));
  // TODAY: the current documented position.
  chapters.push({ key: 'TODAY', from: null, to: null, eventIds: [], factIds: facts.filter((f) => (f.status === 'CURRENT' || f.status === 'CONFLICTING') && f.materiality !== 'LOW').map((f) => f.id) });
  return chapters;
}
function chaptersHasKind(chapters: StoryChapter[], key: StoryChapter['key']): boolean {
  return chapters.some((c) => c.key === key);
}

// ─────────────────────────────── the digest ───────────────────────────────

export interface DigestResult {
  text: string;
  includedFacts: number;
  archivedFacts: number;
  includedEvents: number;
  archivedEvents: number;
}

/**
 * A bounded, structured text for the model. HIGH-materiality facts and
 * events are ALWAYS included regardless of budget; MEDIUM next; LOW only
 * while room remains, and what was archived is counted in the text itself so
 * the model can never mistake a cut for an absence. Source text is DATA.
 */
export function tasDigest(intel: TasIntelligence, citeFor: (factOrEventId: string) => string | null, budgetChars = 9000): DigestResult {
  if (!intel.available) return { text: '', includedFacts: 0, archivedFacts: 0, includedEvents: 0, archivedEvents: 0 };
  const rank: Record<Materiality, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  const lines: string[] = [];
  let used = 0;
  let incF = 0, arcF = 0, incE = 0, arcE = 0;
  const push = (line: string, mandatory: boolean): boolean => {
    if (!mandatory && used + line.length > budgetChars) return false;
    lines.push(line);
    used += line.length + 1;
    return true;
  };
  const tag = (id: string) => {
    const c = citeFor(id);
    return c ? ` [${c}]` : '';
  };
  push('TAS OFFICIAL HISTORY (deterministic; dates are real document dates).', true);
  push(`Coverage: ${intel.coverage.cases} case(s), ${intel.coverage.motions} recorded steps, earliest ${intel.coverage.earliestDate ?? 'n/a'}, latest ${intel.coverage.latestDate ?? 'n/a'}.`, true);
  const st = intel.officialStatus;
  push(`CURRENT OFFICIAL STATUS (deterministic, from decisions): ${st.state}${st.since ? ` since ${st.since}` : ''}${st.basis?.caseRef ? ` — case ${st.basis.caseRef}` : ''}${st.basis?.decisionNumber ? `, decision № ${st.basis.decisionNumber}` : ''}${st.validUntil ? `, valid until ${st.validUntil}` : ''}. ${st.conclusive ? 'CONCLUSIVE.' : `NOT CONCLUSIVE (${st.caveats.join(', ') || 'no controlling decision read'}) — say so plainly, never upgrade it.`}${st.pending.length ? ` Pending later applications: ${st.pending.map((p) => `${p.caseRef ?? '?'} (${p.date}, ${p.outcome})`).join('; ')}.` : ''}`, true);
  if (intel.funnel.incomplete) push(`PROCESSING INCOMPLETE: ${intel.funnel.incompleteReasons.join(', ')} — conclusions that depend on unread material must be stated as provisional.`, true);
  push('CURRENT DOCUMENTED POSITION:', true);
  const current = intel.facts.filter((f) => f.status === 'CURRENT' || f.status === 'CONFLICTING').sort((a, b) => rank[a.materiality] - rank[b.materiality]);
  for (const f of current) {
    const ok = push(`- ${f.label}${f.block ? ` (${f.block})` : ''}: ${f.value} — as of ${f.lastSeen ?? 'undated'}${f.status === 'CONFLICTING' ? ' — CONFLICTING sources' : ''}; ${f.basis === 'DOCUMENTED_SPECIFICATION' ? 'documented specification, not proof of what was built' : 'official decision'}${tag(f.id)}`, f.materiality === 'HIGH');
    ok ? incF++ : arcF++;
  }
  const changed = intel.facts.filter((f) => f.status === 'SUPERSEDED').sort((a, b) => rank[a.materiality] - rank[b.materiality]);
  if (changed.length) push('CHANGED OVER TIME (earlier value → later value):', true);
  for (const f of changed) {
    const ok = push(`- ${f.label}${f.block ? ` (${f.block})` : ''}: ${f.value} (${f.lastSeen ?? 'undated'}) → ${f.supersededBy}${tag(f.id)}`, f.materiality === 'HIGH');
    ok ? incF++ : arcF++;
  }
  if (intel.conflicts.length) {
    push('UNRESOLVED (same date, different values):', true);
    for (const c of intel.conflicts) push(`- ${c.label}${c.block ? ` (${c.block})` : ''}: ${c.values.map((v) => v.value).join(' vs ')}`, true);
  }
  push('TIMELINE (oldest first; ★ = milestone a buyer needs):', true);
  const events = intel.timeline.slice();
  const mustEvents = new Set(events.filter((e) => e.materiality === 'HIGH' || (e.decision && ['REFUSED', 'SUSPENDED', 'CANCELLED'].includes(e.decision.outcome))).map((e) => e.id));
  const milestones = new Set(intel.milestoneIds);
  for (const e of events) {
    const dec = e.decision && e.decision.outcome !== 'UNDETERMINED' ? ` [decision${e.decision.number ? ` № ${e.decision.number}` : ''}: ${e.decision.outcome}]` : '';
    const ok = push(`- ${milestones.has(e.id) ? '★ ' : ''}${e.date} ${e.kind}: ${e.title}${e.status ? ` — ${e.status}` : ''}${dec}${tag(e.id)}`, mustEvents.has(e.id) || milestones.has(e.id));
    ok ? incE++ : arcE++;
  }
  const team = intel.participants.filter((p) => p.customerVisible);
  if (team.length) {
    push('PROJECT PARTICIPANTS (roles as the documents state them; applicant ≠ owner):', true);
    for (const p of team) push(`- ${p.name}: ${p.roles.join(', ')}${p.current ? ' (latest documents)' : ` (historical, last ${p.lastSeen ?? 'n/a'})`}`, false);
  }
  if (arcF || arcE) push(`ARCHIVED (lower-importance, available on request): ${arcF} fact(s), ${arcE} event(s). Archived ≠ absent.`, true);
  return { text: lines.join('\n'), includedFacts: incF, archivedFacts: arcF, includedEvents: incE, archivedEvents: arcE };
}

// ─────────────────────────────── customer-safe projection ───────────────────────────────

export interface OfficialHistoryView {
  status: {
    state: OfficialState;
    since: string | null;
    caseRef: string | null;
    decisionNumber: string | null;
    validUntil: string | null;
    conclusive: boolean;
    caveats: CurrentOfficialStatus['caveats'];
    pendingCount: number;
  };
  milestones: Array<{ date: string; kind: EventKind; title: string; caseRef: string | null; decisionNumber: string | null; outcome: DecisionOutcome | null }>;
  evolution: Array<{ key: string; label: string; block: string | null; from: string; fromDate: string | null; to: string; toDate: string | null }>;
  funnel: TasFunnel;
  visuals: Array<{ id: string; versionStatus: VisualRef['versionStatus'] }>;
  team?: Array<{ name: string; kind: Participant['kind']; roles: ParticipantRole[]; lastSeen: string | null }>;
  /**
   * Related milestones told as one step ("the design was amended four times,
   * 2022–2024") — the individual records stay in `milestones` for the
   * expandable timeline.
   */
  milestoneGroups?: Array<{ kind: EventKind; outcome: DecisionOutcome | null; firstDate: string; lastDate: string; count: number; decisionNumbers: string[] }>;
  /** Distinct legal states and what establishes each. */
  legal?: LegalClaim[];
}

/**
 * What the customer report may show deterministically: official case and
 * decision numbers (public references a buyer can quote), dates, outcomes and
 * value changes. No internal document/attachment ids, hashes, URLs or names
 * of private persons.
 */
export function officialHistoryView(intel: TasIntelligence): OfficialHistoryView | null {
  if (!intel.available) return null;
  const byId = new Map(intel.timeline.map((e) => [e.id, e]));
  const material = new Set(['HIGH', 'MEDIUM']);
  const evolution = intel.facts
    .filter((f) => f.status === 'SUPERSEDED' && f.supersededBy && material.has(f.materiality))
    .map((f) => {
      const next = intel.facts.find((x) => x.key === f.key && x.block === f.block && x.value === f.supersededBy && x.status !== 'SUPERSEDED');
      return { key: f.key, label: f.label, block: f.block, from: f.value, fromDate: f.lastSeen, to: f.supersededBy!, toDate: next?.firstSeen ?? null };
    })
    .slice(0, 8);
  const st = intel.officialStatus;
  // A milestone must SAY something: an unread or undetermined decision with no
  // step name is a reference number, not a step of the story (owner live run
  // 2026-10-10: ten rows of "№ 6030016AR1897963 · № 6030016").
  const milestones = intel.milestoneIds.map((id) => byId.get(id)).filter(Boolean)
    .map((e) => ({
      date: e!.date, kind: e!.kind, title: e!.title.slice(0, 160), caseRef: e!.caseRef, decisionNumber: e!.decision?.number ?? null,
      outcome: e!.decision && e!.decision.outcome !== 'UNDETERMINED' && e!.decision.outcome !== 'INFORMATIONAL' ? e!.decision.outcome : null,
    }))
    .filter((m) => m.outcome || m.kind !== 'OTHER');
  return {
    status: {
      state: st.state, since: st.since, caseRef: st.basis?.caseRef ?? null, decisionNumber: st.basis?.decisionNumber ?? null,
      validUntil: st.validUntil, conclusive: st.conclusive, caveats: st.caveats, pendingCount: st.pending.length,
    },
    milestones,
    milestoneGroups: groupMilestones(milestones),
    legal: intel.legalClaims,
    evolution,
    funnel: intel.funnel,
    visuals: intel.visuals.map((v) => ({ id: v.id, versionStatus: v.versionStatus })),
    // The professionals the municipal documents name — never applicants or
    // private parcel owners (owner, 2026-10-10: "who designed and built it").
    team: intel.participants
      // Organisations named in any other capacity count too (owner,
      // 2026-10-10: "others mentioned for other purposes") — but never a
      // private person outside a professional role.
      .filter((p) => p.roles.some((r) => TEAM_ROLES.has(r)) || (p.kind === 'ORGANIZATION' && p.roles.includes('OTHER')))
      .slice(0, 24)
      .map((p) => ({ name: p.name, kind: p.kind, roles: p.roles.some((r) => TEAM_ROLES.has(r)) ? p.roles.filter((r) => TEAM_ROLES.has(r)) : (['OTHER'] as ParticipantRole[]), lastSeen: p.lastSeen })),
  };
}

/** Consecutive milestones of the same kind and outcome, as one step of the story. */
export function groupMilestones(ms: Array<{ date: string; kind: EventKind; outcome: DecisionOutcome | null; decisionNumber: string | null }>): NonNullable<OfficialHistoryView['milestoneGroups']> {
  const out: NonNullable<OfficialHistoryView['milestoneGroups']> = [];
  for (const m of [...ms].sort((a, b) => a.date.localeCompare(b.date))) {
    const last = out[out.length - 1];
    if (last && last.kind === m.kind && last.outcome === m.outcome) {
      last.lastDate = m.date;
      last.count++;
      if (m.decisionNumber && !last.decisionNumbers.includes(m.decisionNumber)) last.decisionNumbers.push(m.decisionNumber);
    } else {
      out.push({ kind: m.kind, outcome: m.outcome, firstDate: m.date, lastDate: m.date, count: 1, decisionNumbers: m.decisionNumber ? [m.decisionNumber] : [] });
    }
  }
  return out;
}

const TEAM_ROLES = new Set<ParticipantRole>([
  'DEVELOPER', 'ARCHITECT', 'CO_ARCHITECT', 'STRUCTURAL_ENGINEER', 'GEOTECHNICAL_SPECIALIST', 'EXPERT_REVIEW',
  'TECHNICAL_SUPERVISOR', 'CONTRACTOR', 'MEP_ENGINEER', 'LANDSCAPE_ARCHITECT', 'FIRE_SAFETY', 'SURVEYOR', 'INTERIOR_DESIGNER',
]);
