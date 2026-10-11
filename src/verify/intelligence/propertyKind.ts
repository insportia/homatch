/*
 * WHAT KIND OF PROPERTY THIS IS, FROM THE OFFICIAL REGISTER (v7).
 *
 * Job eeefada9: the NAPR extract HOMATCH read says "ფართი (მშენებარე)
 * სართული 2, ბინა N4" and the registered address ends "სართული2,ბინა N4",
 * yet the report resolved MIXED_OR_UNKNOWN and synthesis said UNKNOWN. The
 * register already answered the question.
 *
 * The kind is decided ONLY from what the registry prints:
 *   - the unit's row in the extract's owners table (description, number),
 *   - the registered address of the exact unit (Service 176 ADDRESS),
 *   - the extract's structure (a parcel-only extract has no unit row) and the
 *     buildings it lists on the parcel,
 *   - documented attributes a caller passes explicitly.
 * Never from the cadastral code's length or shape: a code says where a
 * record sits in the cadastre, not what the thing is.
 *
 * When the signals disagree (an address saying "ბინა N4" and a row saying
 * "ავტოსადგომი") the answer is AMBIGUOUS with the conflicting signals and an
 * explanation, never a forced "apartment".
 */

import { buildPropertyRegister, type RegisterExtract } from './propertyRegister.ts';

export type PropertyKind =
  | 'APARTMENT'
  | 'PRIVATE_HOUSE'
  | 'LAND'
  | 'PARKING'
  | 'COMMERCIAL'
  | 'OFFICE'
  | 'STORAGE'
  /** Registered, but none of the kinds above (e.g. only "ფართი (მშენებარე)"). */
  | 'OTHER'
  /** The registry's own signals disagree. */
  | 'AMBIGUOUS'
  /** No registry evidence was read. */
  | 'UNKNOWN';

export type ConcreteKind = Exclude<PropertyKind, 'OTHER' | 'AMBIGUOUS' | 'UNKNOWN'>;

export type KindSource = 'UNIT_ROW' | 'REGISTERED_ADDRESS' | 'BUILDINGS' | 'EXTRACT_STRUCTURE' | 'DOCUMENTED_ATTRIBUTE';

export interface KindSignal {
  kind: ConcreteKind;
  source: KindSource;
  /** The registry's own words that carry the signal. */
  text: string;
}

export interface PropertyKindResult {
  kind: PropertyKind;
  /** The signals the kind rests on (for AMBIGUOUS: every signal read). */
  basis: KindSignal[];
  /** Signals pointing at a different kind than the answer (AMBIGUOUS: all of them). */
  conflicts: KindSignal[];
  /** Why the answer is AMBIGUOUS / OTHER / UNKNOWN, in plain English for logs and the model. */
  explanation: string | null;
  /** The extract preparation moment the kind was read from, when one was. */
  evidenceDate: string | null;
}

export interface PropertyKindInput {
  /** The unit row's registered item, e.g. "ფართი (მშენებარე) სართული 2, ბინა N4". */
  unitItemText?: string | null;
  unitDescription?: string | null;
  /** The exact unit's registered address (Service 176 ADDRESS). */
  registeredAddress?: string | null;
  /** true: the extract has a unit row; false: a parcel-only extract; null/undefined: no extract read. */
  unitRowFound?: boolean | null;
  /** The extract's buildings line, e.g. "N1 საცხოვრებელი სახლი". */
  buildingsText?: string | null;
  /** Documented attributes (registry wording only), e.g. "ფუნქციური დანიშნულება: ოფისი". */
  attributes?: Array<string | null | undefined>;
  evidenceDate?: string | null;
}

const PATTERNS: Array<[ConcreteKind, RegExp]> = [
  ['PARKING', /(ავტოსადგომ|პარკინგ|ავტოფარეხ|გარაჟ|\bparking\b|\bgarage\b)/iu],
  ['STORAGE', /(სათავს|სარდაფ|საკუჭნაო|დამხმარე\s+(?:ფართ|სათავს|ოთახ)|\bstorage\b)/iu],
  ['OFFICE', /(ოფის|\boffice\b)/iu],
  ['COMMERCIAL', /(კომერციულ|მაღაზი|სავაჭრო|არასაცხოვრებელ|\bcommercial\b|\bretail\b|\bshop\b)/iu],
  ['APARTMENT', /(ბინა\s*(?:N|№|ნომერი)?\s*\d|საცხოვრებელი\s+ბინა|\bapartment\b|\bflat\s+(?:no|n)\b)/iu],
  ['PRIVATE_HOUSE', /((?<!ბინიანი\s)(?<!ბინიან\s)საცხოვრებელი\s+სახლ|ინდივიდუალური\s+(?:საცხოვრებელი\s+)?სახლ|კერძო\s+სახლ|\bprivate\s+house\b|\bdetached\s+house\b)/iu],
];

/** The concrete kinds one registry text names. */
export function kindsIn(text: string | null | undefined, source: KindSource): KindSignal[] {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return [];
  const out: KindSignal[] = [];
  for (const [kind, re] of PATTERNS) {
    const m = re.exec(t);
    if (!m) continue;
    // "სარდაფი" next to a parking word is the parking space's LEVEL, not a storeroom.
    if (kind === 'STORAGE' && /სარდაფ/u.test(m[0]) && PATTERNS[0][1].test(t)) continue;
    // A multi-apartment residential building is not a private house.
    if (kind === 'PRIVATE_HOUSE' && /მრავალბინ/u.test(t)) continue;
    out.push({ kind, source, text: t.length > 140 ? `${t.slice(0, 137)}…` : t });
  }
  return out;
}

const distinct = (signals: KindSignal[]): ConcreteKind[] => [...new Set(signals.map((s) => s.kind))];

export function classifyPropertyKind(input: PropertyKindInput): PropertyKindResult {
  const evidenceDate = input.evidenceDate ?? null;
  const unitText = [input.unitDescription, input.unitItemText].filter(Boolean).join(' ');
  const unitSignals = [
    ...kindsIn(unitText, 'UNIT_ROW'),
    ...kindsIn(input.registeredAddress, 'REGISTERED_ADDRESS'),
    ...(input.attributes ?? []).flatMap((a) => kindsIn(a, 'DOCUMENTED_ATTRIBUTE')),
  ];

  // A parcel-only extract (no unit row): land, a house with its land, or a parcel with other buildings.
  if (input.unitRowFound === false) {
    const buildings = String(input.buildingsText ?? '').replace(/\s+/g, ' ').trim();
    const buildingSignals = kindsIn(buildings, 'BUILDINGS').filter((s) => s.kind === 'PRIVATE_HOUSE' || s.kind === 'COMMERCIAL' || s.kind === 'OFFICE');
    let structural: KindSignal[] = buildingSignals;
    if (!buildings || !/\S/.test(buildings.replace(/[:;,.\-–—]/g, ''))) {
      structural = [{ kind: 'LAND', source: 'EXTRACT_STRUCTURE', text: 'parcel-only extract: no unit row, no buildings listed' }];
    }
    const all = [...structural, ...unitSignals];
    const kinds = distinct(all);
    if (kinds.length === 1) return { kind: kinds[0], basis: all, conflicts: [], explanation: null, evidenceDate };
    if (kinds.length > 1) return ambiguous(all, evidenceDate);
    return {
      kind: 'OTHER', basis: [], conflicts: [], evidenceDate,
      explanation: 'The extract registers a parcel with buildings the registry does not describe as a house, commercial or office building.',
    };
  }

  const kinds = distinct(unitSignals);
  if (kinds.length === 1) return { kind: kinds[0], basis: unitSignals, conflicts: [], explanation: null, evidenceDate };
  if (kinds.length > 1) return ambiguous(unitSignals, evidenceDate);
  if (input.unitRowFound === true) {
    return {
      kind: 'OTHER', basis: [], conflicts: [], evidenceDate,
      explanation: `The extract registers the unit${input.unitDescription ? ` as "${input.unitDescription}"` : ''} without naming it an apartment, house, parking space, commercial space, office or storage.`,
    };
  }
  return { kind: 'UNKNOWN', basis: [], conflicts: [], evidenceDate, explanation: 'No registry extract or registered address describing the property was read.' };
}

function ambiguous(signals: KindSignal[], evidenceDate: string | null): PropertyKindResult {
  const kinds = distinct(signals);
  const where = (k: ConcreteKind) => [...new Set(signals.filter((s) => s.kind === k).map((s) => s.source))].join(', ');
  return {
    kind: 'AMBIGUOUS',
    basis: signals,
    conflicts: signals,
    evidenceDate,
    explanation: `The registry's own wording points at different kinds: ${kinds.map((k) => `${k} (${where(k)})`).join(' vs ')}. The kind is left open rather than forced.`,
  };
}

/* ───────────────────────── from the stored data ───────────────────────── */

const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim() : null);

/** The exact unit's registered address from identity-bound Service 176 facts (the latest record's first). */
export function registeredAddressOf(resultJson: unknown, recordId?: string | null, code?: string | null): string | null {
  const facts = Array.isArray(obj(resultJson).service176Evidence) ? obj(resultJson).service176Evidence : [];
  const addresses = facts.filter((f: any) => f?.field === 'ADDRESS' && str(f?.value) &&
    (!code || !f?.provenance?.cadastralCode || String(f.provenance.cadastralCode).trim() === code));
  const own = recordId ? addresses.find((f: any) => String(f?.provenance?.appID ?? '') === String(recordId)) : null;
  return str((own ?? addresses[0])?.value);
}

/**
 * The kind for a research result (result_json), from its own register and
 * registered address. Works on the sanitized customer copy too: without
 * browserOfficial it reads the registered address alone.
 */
export function propertyKindFromResult(resultJson: unknown): PropertyKindResult {
  const r = obj(resultJson);
  let latest: RegisterExtract | null = null;
  let code: string | null = null;
  try {
    const reg = r.browserOfficial ? buildPropertyRegister(r.browserOfficial) : null;
    latest = reg?.latest ?? null;
    code = reg?.cadastralCode ?? null;
  } catch {
    latest = null;
  }
  return propertyKindFromRegister(latest, registeredAddressOf(r, latest?.recordId ?? null, code));
}

/** The kind from a parsed latest extract (stored synthesis.propertyRegister.latest) and the registered address. */
export function propertyKindFromRegister(latest: Partial<RegisterExtract> | null | undefined, registeredAddress: string | null | undefined): PropertyKindResult {
  const l = obj(latest);
  const hasExtract = typeof l.issuedAt === 'string' || typeof l.recordId === 'string';
  // Older persisted registers have no unitRowFound: an extract with a unit area or a "ფართი" mark has a unit row.
  const unitRowFound = !hasExtract
    ? null
    : typeof l.unitRowFound === 'boolean'
      ? l.unitRowFound
      : (typeof l.unitAreaSqm === 'number' || l.unitUnderConstruction === true) ? true : null;
  return classifyPropertyKind({
    unitItemText: str(l.unitItemText),
    unitDescription: str(l.unitDescription),
    registeredAddress: str(registeredAddress),
    unitRowFound,
    buildingsText: str(l.buildingsText),
    evidenceDate: str(l.issuedAt),
  });
}

/* ───────────────────────── asset class and synthesis type ───────────────────────── */

/**
 * The research asset class the registry kind supports, or null when the
 * kind alone does not decide it (parking, storage, other, ambiguous, unknown,
 * or an apartment with nothing tying it to a development).
 */
export function assetClassForKind(kind: PropertyKind, ctx: { projectName?: unknown; developer?: unknown; underConstruction?: boolean | null } = {}): string | null {
  switch (kind) {
    case 'APARTMENT':
      return str(ctx.projectName) || str(ctx.developer) || ctx.underConstruction === true ? 'APARTMENT_IN_PROJECT' : null;
    case 'PRIVATE_HOUSE':
      return 'PRIVATE_HOUSE';
    case 'LAND':
      return 'LAND';
    case 'COMMERCIAL':
    case 'OFFICE':
      return 'COMMERCIAL';
    default:
      return null;
  }
}

/** Declared asset classes a registry kind does not contradict. */
const COMPATIBLE: Record<string, string[]> = {
  APARTMENT_IN_PROJECT: ['APARTMENT_IN_PROJECT', 'PRIVATE_RESALE', 'RENTAL', 'UNDER_CONSTRUCTION', 'COMPANY_OWNED'],
  PRIVATE_HOUSE: ['PRIVATE_HOUSE', 'PRIVATE_RESALE', 'RENTAL', 'COMPANY_OWNED'],
  LAND: ['LAND', 'COMPANY_OWNED'],
  COMMERCIAL: ['COMMERCIAL', 'RENTAL', 'COMPANY_OWNED', 'UNDER_CONSTRUCTION'],
};

/**
 * The asset class from the registry, for resolveAssetClass: returned only when
 * the declared class is missing/unknown or contradicts the register. A
 * declared class the register agrees with (e.g. RENTAL for an apartment) stays.
 */
export function registryAssetClass(r: any, declared: string | null): string | null {
  let kind: PropertyKindResult;
  try {
    kind = propertyKindFromResult(r);
  } catch {
    return null;
  }
  const latestUnderConstruction = /მშენებარე/u.test(kind.basis.map((b) => b.text).join(' '));
  const cls = assetClassForKind(kind.kind, {
    projectName: r?.projectProfile?.name || r?.reconciledIdentity?.project,
    developer: r?.projectProfile?.developer || r?.projectProfile?.developerCompany || r?.reconciledIdentity?.developer,
    underConstruction: latestUnderConstruction,
  });
  if (!cls) return null;
  if (declared && declared !== 'MIXED_OR_UNKNOWN' && (COMPATIBLE[cls] ?? [cls]).includes(declared)) return null;
  return cls;
}

/** The deal-room PropertyType (synthesis.propertyType) the registry kind supports, or null. */
export function synthesisPropertyTypeForKind(kind: PropertyKind, ownerKind?: 'PERSON' | 'COMPANY' | null, underConstruction?: boolean | null): string | null {
  switch (kind) {
    case 'APARTMENT':
      return ownerKind === 'COMPANY' || (underConstruction === true && ownerKind !== 'PERSON') ? 'DEVELOPER_APARTMENT' : ownerKind === 'PERSON' ? 'PRIVATE_APARTMENT' : null;
    case 'PRIVATE_HOUSE':
      return 'PRIVATE_HOUSE';
    case 'LAND':
      return 'LAND';
    case 'COMMERCIAL':
    case 'OFFICE':
      return 'COMMERCIAL';
    default:
      return null;
  }
}

/* ───────────────────────── which chapters apply ───────────────────────── */

/**
 * WHICH REPORT CHAPTERS A KIND OF PROPERTY CAN HAVE.
 *
 * A heading with nothing real under it gets filled with something: a plot of
 * land has no building specification, no unit utilities and no apartment
 * market; a parking space has no bedrooms or apartment floors. Unknown,
 * other and ambiguous keep everything (nothing is hidden on a guess).
 */
export interface KindSections {
  /** The facts card variant to render. */
  facts: 'APARTMENT' | 'PARKING' | 'LAND' | 'HOUSE' | 'COMMERCIAL' | 'STORAGE' | 'GENERIC';
  /** vbi-building: technical specs / building quality. */
  buildingSpecs: boolean;
  /** UtilitiesCard inside vbi-building (the unit's own connections). */
  unitUtilities: boolean;
  /** vbi-story: the development's permit story (TAS chronology). */
  projectStory: boolean;
  /** vbi-explore: official visuals of the building / project. */
  visuals: boolean;
  /** vbi-market as built today (apartment comparables): only for an apartment, or when the kind is not known. */
  apartmentMarket: boolean;
  /** The market segment this kind would be compared within (for a future non-apartment market). */
  marketSegment: 'APARTMENT' | 'HOUSE' | 'LAND' | 'PARKING' | 'COMMERCIAL' | 'OFFICE' | 'STORAGE' | null;
  /** vbi-location: neighbourhood living (schools, transport). */
  livingLocation: boolean;
  /** vbi-people: developer / project team. */
  projectTeam: boolean;
  /** vbi-legal: the register, ownership, mortgages — every kind has it. */
  legal: true;
  /** vbi-documents. */
  documents: true;
}

export function sectionsFor(kind: PropertyKind): KindSections {
  const all: KindSections = {
    facts: 'GENERIC', buildingSpecs: true, unitUtilities: true, projectStory: true, visuals: true,
    apartmentMarket: true, marketSegment: null, livingLocation: true, projectTeam: true, legal: true, documents: true,
  };
  switch (kind) {
    case 'APARTMENT':
      return { ...all, facts: 'APARTMENT', marketSegment: 'APARTMENT' };
    case 'PRIVATE_HOUSE':
      return { ...all, facts: 'HOUSE', apartmentMarket: false, marketSegment: 'HOUSE' };
    case 'LAND':
      return { ...all, facts: 'LAND', buildingSpecs: false, unitUtilities: false, apartmentMarket: false, marketSegment: 'LAND', projectTeam: false };
    case 'PARKING':
      return { ...all, facts: 'PARKING', unitUtilities: false, apartmentMarket: false, marketSegment: 'PARKING', livingLocation: false };
    case 'COMMERCIAL':
      return { ...all, facts: 'COMMERCIAL', apartmentMarket: false, marketSegment: 'COMMERCIAL', livingLocation: false };
    case 'OFFICE':
      return { ...all, facts: 'COMMERCIAL', apartmentMarket: false, marketSegment: 'OFFICE', livingLocation: false };
    case 'STORAGE':
      return { ...all, facts: 'STORAGE', unitUtilities: false, apartmentMarket: false, marketSegment: 'STORAGE', livingLocation: false };
    default:
      return all;
  }
}

/**
 * For the synthesis read path (registerEnrichment.withPropertyRegister): the
 * registry kind, and synthesis.propertyType corrected from UNKNOWN when the
 * register decides it. Re-derived on every read, so stored reports gain it
 * without a rebuild. Returns only the fields it sets.
 */
export function propertyKindOverlay(
  resultJson: unknown,
  latest: Partial<RegisterExtract> | null | undefined,
  currentType: unknown,
): { propertyKind?: PropertyKindResult; propertyType?: string } {
  const address = registeredAddressOf(resultJson, str(obj(latest).recordId), null);
  const kind = latest ? propertyKindFromRegister(latest, address) : propertyKindFromResult(resultJson);
  if (kind.kind === 'UNKNOWN') return {};
  const out: { propertyKind?: PropertyKindResult; propertyType?: string } = { propertyKind: kind };
  if (!currentType || currentType === 'UNKNOWN') {
    const owners = Array.isArray(obj(latest).owners) ? obj(latest).owners : [];
    const ownerKind = owners.length && owners.every((o: any) => o?.kind === 'COMPANY') ? 'COMPANY' : owners.length ? 'PERSON' : null;
    const t = synthesisPropertyTypeForKind(kind.kind, ownerKind, obj(latest).unitUnderConstruction === true);
    if (t) out.propertyType = t;
  }
  return out;
}
