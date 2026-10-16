/*
 * PROPERTY IDENTITY — which unit, which building, which parcel.
 *
 * A Georgian unit code is parcel (5 groups) + building + section/entrance +
 * unit: 01.18.06.019.055 · 03 · 01 · 503. Two codes that differ only in the
 * building group are DIFFERENT apartments in different buildings, however
 * alike they look. Owner live run 2026-10-10 (job 220ed087): the request was
 * …055.03.01.503 (building 03) while most registry papers concerned building
 * 01 and a separately documented …055.01.01.503 — facts about one were read
 * as facts about the other. This layer never merges them: a near match stays
 * an unresolved, material identity question until a record reconciles it.
 */

export interface CadastralParts {
  code: string;
  parcel: string;
  building: string | null;
  section: string | null;
  unit: string | null;
}

const CODE = /\b(\d{2}\.\d{2}\.\d{2}\.\d{3}\.\d{3})(?:\.(\d{2}))?(?:\.(\d{2}))?(?:\.(\d{3}))?\b/g;

export function parseCadastral(code: string | null | undefined): CadastralParts | null {
  CODE.lastIndex = 0;
  const m = CODE.exec(String(code ?? ''));
  if (!m) return null;
  return { code: m[0], parcel: m[1], building: m[2] ?? null, section: m[3] ?? null, unit: m[4] ?? null };
}

/** Every cadastral code mentioned anywhere in a value (deduplicated, in order). */
export function codesIn(value: unknown): string[] {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  const out = new Set<string>();
  CODE.lastIndex = 0;
  for (let m = CODE.exec(text); m; m = CODE.exec(text)) out.add(m[0]);
  return [...out];
}

export type IdentityStatus = 'CONFIRMED' | 'PARCEL_ONLY' | 'UNRESOLVED_MISMATCH' | 'NOT_VERIFIED';

export interface PropertyIdentity {
  requested: string | null;
  parcel: string | null;
  building: string | null;
  unit: string | null;
  /** Buildings of the same parcel that the records actually concern. */
  documentedBuildings: string[];
  /** Same parcel + same unit number in ANOTHER building: never the same apartment. */
  nearMatches: string[];
  /** The requested unit's own code appears in an official record. */
  unitDocumented: boolean;
  status: IdentityStatus;
}

/**
 * The identity verdict from the request and the records read. `records` is
 * anything official (TAS cases, registry extracts…): only codes in it count.
 */
export function resolveIdentity(requestedCode: string | null | undefined, records: unknown): PropertyIdentity {
  const req = parseCadastral(requestedCode);
  const base: PropertyIdentity = {
    requested: req?.code ?? null, parcel: req?.parcel ?? null, building: req?.building ?? null, unit: req?.unit ?? null,
    documentedBuildings: [], nearMatches: [], unitDocumented: false, status: 'NOT_VERIFIED',
  };
  if (!req) return base;
  const seen = codesIn(records).map(parseCadastral).filter((c): c is CadastralParts => !!c && c.parcel === req.parcel);
  base.documentedBuildings = [...new Set(seen.map((c) => c.building).filter((b): b is string => !!b))].sort();
  base.unitDocumented = seen.some((c) => c.code === req.code);
  base.nearMatches = [...new Set(seen
    .filter((c) => c.unit && req.unit && c.unit === req.unit && c.code !== req.code && (c.building !== req.building || c.section !== req.section))
    .map((c) => c.code))];
  if (!req.building) {
    base.status = seen.length ? 'PARCEL_ONLY' : 'NOT_VERIFIED';
  } else if (base.unitDocumented && !base.nearMatches.length) {
    base.status = 'CONFIRMED';
  } else if (base.nearMatches.length || (base.documentedBuildings.length && !base.documentedBuildings.includes(req.building))) {
    base.status = 'UNRESOLVED_MISMATCH';
  } else {
    base.status = seen.length ? 'PARCEL_ONLY' : 'NOT_VERIFIED';
  }
  return base;
}
