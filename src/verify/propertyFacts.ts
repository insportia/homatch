/*
 * THE PROPERTY'S KEY FACTS, AS THE LATEST EXTRACT STATES THEM (v7).
 *
 * Owner, 2026-10-11: always show the exact property area and the latest
 * extract, near the top. The card reads only official data the synthesis
 * already carries:
 *   synthesis.propertyRegister.latest  the newest NAPR extract HOMATCH read
 *   synthesis.unitIdentity.exactUnit   the unit's registered address, floor,
 *                                      number, block and area
 *   synthesis.propertyKind             the registry kind (propertyKind.ts)
 * Every field degrades gracefully: reports persisted before v7 lack the
 * extract's unit row fields and the extract link; the card shows what they
 * do carry and nothing invented.
 *
 * AREA DISCIPLINE. The unit's area is the owners-row area only. The parcel
 * (1400 / 2145 m²) and the buildings' total (3711.2 m²) are different
 * numbers about different things; they appear, if at all, as separately
 * labelled secondary lines and never as "area".
 *
 * The extract date is the latest AVAILABLE extract, never "current legal
 * state": an extract describes the day it was prepared.
 */

import {
  propertyKindFromRegister, sectionsFor, type KindSections, type PropertyKind, type PropertyKindResult,
} from './intelligence/propertyKind.ts';
import { officialExtractUrl, officialRecordUrl } from './intelligence/propertyRegister.ts';

export type FactKey =
  | 'kind' | 'cadastral' | 'area' | 'landArea' | 'address' | 'block' | 'floor' | 'level'
  | 'unitNumber' | 'owner' | 'registeredState' | 'landFunction' | 'extractDate' | 'parcelTotal' | 'buildingTotal';

export interface FactRow {
  key: FactKey;
  /** i18n key of the label. */
  labelKey: string;
  /** Literal value (registry text, a number already formatted, a date). */
  value: string | null;
  /** i18n key for the value when it is a translated label (the kind). */
  valueKey?: string;
  /** {{n}} for a value key with a placeholder (areas). */
  vars?: Record<string, string>;
}

export interface FactsLink {
  href: string;
  /** DOCUMENT: the extract PDF itself; RECORD: the record's public NAPR page. */
  kind: 'DOCUMENT' | 'RECORD';
  labelKey: string;
}

export interface PropertyFactsModel {
  kind: PropertyKind;
  kindResult: PropertyKindResult;
  sections: KindSections;
  rows: FactRow[];
  /** Separately labelled context lines: the parcel and the building totals (never the unit's area). */
  secondary: FactRow[];
  /** "ბოლო მოძიებული ამონაწერი: DD.MM.YYYY" */
  extractDate: string | null;
  link: FactsLink | null;
  /** Shown under the kind when the registry's wording disagrees. */
  ambiguityKey: string | null;
}

const obj = (v: unknown): Record<string, any> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, any>) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);

/** 79.5 → "79.5", 94.1 → "94.1", 1400 → "1400" (the registry's own precision, no locale grouping). */
export const formatSqm = (n: number): string => (Math.round(n * 100) / 100).toString();

/** "2026-08-24T08:35:20" → "24.08.2026" (the Georgian registry format). */
export function extractDateLabel(iso: unknown): string | null {
  const m = typeof iso === 'string' ? iso.match(/^(\d{4})-(\d{2})-(\d{2})/) : null;
  return m ? `${m[3]}.${m[2]}.${m[1]}` : null;
}

/** The safest link to the extract: the PDF on NAPR's blob service, else the record page. */
export function extractLink(latest: unknown): FactsLink | null {
  const l = obj(latest);
  const doc = officialExtractUrl(l.documentUrl);
  if (doc) return { href: doc, kind: 'DOCUMENT', labelKey: 'verify_v7_facts_view_extract' };
  const rec = typeof l.recordUrl === 'string' && /^https:\/\/naprweb\.reestri\.gov\.ge\/_dea\/#\/view\/\d{4,12}$/.test(l.recordUrl.trim())
    ? l.recordUrl.trim()
    : null;
  return rec ? { href: rec, kind: 'RECORD', labelKey: 'verify_v7_facts_view_record' } : null;
}

export const KIND_LABEL_KEY: Record<PropertyKind, string | null> = {
  APARTMENT: 'verify_v7_facts_kind_apartment',
  PRIVATE_HOUSE: 'verify_v7_facts_kind_house',
  LAND: 'verify_v7_facts_kind_land',
  PARKING: 'verify_v7_facts_kind_parking',
  COMMERCIAL: 'verify_v7_facts_kind_commercial',
  OFFICE: 'verify_v7_facts_kind_office',
  STORAGE: 'verify_v7_facts_kind_storage',
  OTHER: 'verify_v7_facts_kind_other',
  AMBIGUOUS: 'verify_v7_facts_kind_ambiguous',
  UNKNOWN: null,
};

function ownersText(owners: unknown): string | null {
  const list = Array.isArray(owners) ? owners : [];
  const names = list
    .map((o: any) => {
      const name = str(o?.name);
      if (!name) return null;
      // A private person's personal number never reaches the card (the parser never keeps it; belt and braces).
      const clean = name.replace(/\d{11}/g, '').replace(/\s*,?\s*(?:P\/N|პ\/ნ)\s*:?.*$/u, '').trim();
      if (!clean) return null;
      return o?.kind === 'COMPANY' && /^\d{9}$/.test(String(o?.companyId ?? '')) ? `${clean} (ს/კ ${o.companyId})` : clean;
    })
    .filter(Boolean) as string[];
  return names.length ? names.join(', ') : null;
}

/**
 * The facts card model from a synthesis payload. Returns null when there is
 * neither an extract nor an exact unit to describe.
 */
export function buildPropertyFacts(synthesis: unknown): PropertyFactsModel | null {
  const s = obj(synthesis);
  const reg = obj(s.propertyRegister);
  const latest = reg.latest && typeof reg.latest === 'object' ? obj(reg.latest) : null;
  const ui = obj(s.unitIdentity);
  const eu = obj(ui.exactUnit);
  const parcel = obj(ui.parentParcel);
  if (!latest && !str(eu.code)) return null;

  const address = str(eu.registeredAddress) ?? str(latest?.parcelAddress);
  const stored = obj(s.propertyKind);
  const kindResult: PropertyKindResult = typeof stored.kind === 'string' && Array.isArray(stored.basis)
    ? (stored as PropertyKindResult)
    : propertyKindFromRegister(latest, str(eu.registeredAddress));
  const kind = kindResult.kind;
  const sections = sectionsFor(kind);

  // The unit's own area: the extract's owners row, else the exact unit's (same source, stored earlier).
  const unitArea = num(latest?.unitAreaSqm) ?? num(eu.areaSqm);
  const landArea = num(latest?.landAreaSqm) ?? num(parcel.landAreaSqm);
  const buildingsTotal = num(latest?.buildingsTotalAreaSqm);
  const landFunction = str(latest?.landFunction) ?? str(parcel.landFunction);
  const floor = str(eu.floor) ?? str(latest?.unitFloor);
  const block = str(eu.block) ?? str(latest?.unitBlock);
  const unitNumber = str(eu.apartment) ?? str(latest?.unitNumber);
  const underConstruction = latest?.unitUnderConstruction === true || eu.underConstruction === true;
  const description = str(latest?.unitDescription) ?? str(eu.description);
  const owners = ownersText(latest?.owners) ?? ownersText(obj(obj(ui.ownership).current).owners);
  const extractDate = extractDateLabel(latest?.issuedAt ?? eu.evidenceDate);
  const code = str(eu.code) ?? str(reg.cadastralCode) ?? str(obj(s.snapshot).cadastralCode);

  const rows: FactRow[] = [];
  const push = (row: FactRow | null) => {
    if (row && (row.value || row.valueKey)) rows.push(row);
  };
  const areaRow = (key: FactKey, labelKey: string, n: number | null): FactRow | null =>
    n ? { key, labelKey, value: formatSqm(n), valueKey: 'verify_v7_facts_sqm', vars: { n: formatSqm(n) } } : null;

  const kindKey = KIND_LABEL_KEY[kind];
  push(kindKey ? { key: 'kind', labelKey: 'verify_v7_facts_type', value: kind === 'OTHER' && description ? description : null, valueKey: kind === 'OTHER' && description ? undefined : kindKey } : null);
  push({ key: 'cadastral', labelKey: 'verify_v7_facts_cadastral', value: code });

  const facts = sections.facts;
  if (facts === 'LAND') {
    push(areaRow('area', 'verify_v7_facts_area', landArea));
    push({ key: 'address', labelKey: 'verify_v7_facts_address', value: address });
    push({ key: 'landFunction', labelKey: 'verify_v7_facts_land_function', value: landFunction });
  } else {
    push(areaRow('area', 'verify_v7_facts_area', unitArea));
    if (facts === 'HOUSE') push(areaRow('landArea', 'verify_v7_facts_land_area', landArea));
    push({ key: 'address', labelKey: 'verify_v7_facts_address', value: address });
    if (facts !== 'HOUSE') {
      push({ key: 'block', labelKey: 'verify_v7_facts_block', value: block });
      push(facts === 'PARKING' || facts === 'STORAGE'
        ? { key: 'level', labelKey: 'verify_v7_facts_level', value: floor }
        : { key: 'floor', labelKey: 'verify_v7_facts_floor', value: floor });
      push({ key: 'unitNumber', labelKey: 'verify_v7_facts_unit_number', value: unitNumber });
    }
  }
  push({ key: 'owner', labelKey: 'verify_v7_facts_owner', value: owners });
  if (facts !== 'LAND') {
    push(description
      ? { key: 'registeredState', labelKey: 'verify_v7_facts_state', value: description }
      : underConstruction ? { key: 'registeredState', labelKey: 'verify_v7_facts_state', value: null, valueKey: 'verify_v7_facts_state_under_construction' } : null);
  }
  push({ key: 'extractDate', labelKey: 'verify_v7_facts_extract_date', value: extractDate });

  // Context, labelled for what it is. Never the unit's area.
  const secondary: FactRow[] = [];
  if (facts !== 'LAND' && facts !== 'HOUSE' && landArea) secondary.push(areaRow('parcelTotal', 'verify_v7_facts_parcel_total', landArea)!);
  if (facts !== 'LAND' && buildingsTotal) secondary.push(areaRow('buildingTotal', 'verify_v7_facts_building_total', buildingsTotal)!);

  return {
    kind,
    kindResult,
    sections,
    rows,
    secondary,
    extractDate,
    link: latest ? extractLink(latest) : null,
    ambiguityKey: kind === 'AMBIGUOUS' ? 'verify_v7_facts_ambiguous_note' : null,
  };
}

/* Re-exported so the lead can gate chapters from the same module the card uses. */
export { sectionsFor, officialRecordUrl };
export type { KindSections, PropertyKind };
