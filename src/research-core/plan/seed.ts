// HOMATCH RESEARCH CORE — the ResearchSeed.
//
// Everything Homatch has already established about a subject, in one
// structured value, so that no downstream step has to rediscover it.
//
// WHY THIS EXISTS AS A TYPE RATHER THAN A PROMPT PARAGRAPH
//
// The old pipeline knew these facts too — they were sitting in result_json —
// but the only thing that ever read them was a prompt, as prose. A model was
// then asked to search for a district it had just been told, because prose is
// not a query and nothing could turn it into one. A cadastral code, an area
// and a district are exactly the inputs a portal filter takes; they only had
// to be shaped like data first.
//
// So the seed is assembled by CODE from evidence that already exists, and it
// is what the plan is derived from. Every downstream query can name the seed
// field it came from, which is what makes "why was this searched" answerable.
//
// WHAT MAY GO IN, AND WHAT MAY NOT
//
// Only facts that were actually established, each with the evidence level
// that established them. A guess with a confident shape is worse than an
// absent field: a null area produces no area filter, while a wrong area
// produces a confident envelope around the wrong property.
//
// Nothing personal. Participants appear only where the existing pipeline has
// already legitimately identified them and only as names already carried in
// the customer-visible report; this type has no field for a contact detail
// and must never grow one.

import type { EvidenceLevel } from '../core/types.ts';
import type { ResearchLanguage } from '../discovery/lexicon.ts';

/** One established fact, with where it came from. */
export interface SeedValue<T> {
  value: T;
  /** How strongly this was established. Drives whether a filter is trusted. */
  evidence: EvidenceLevel;
  /** Short, checkable: which part of the pipeline established it. */
  origin: string;
}

export function seeded<T>(
  value: T | null | undefined,
  evidence: EvidenceLevel,
  origin: string,
): SeedValue<T> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return { value, evidence, origin };
}

export type SeedTransaction = 'SALE' | 'RENT' | 'UNKNOWN';

export interface SeedLocation {
  countryCode: SeedValue<string> | null;
  city: SeedValue<string> | null;
  district: SeedValue<string> | null;
  subDistrict: SeedValue<string> | null;
  address: SeedValue<string> | null;
  /** Only when a source legitimately carried coordinates. Never derived. */
  latitude: SeedValue<number> | null;
  longitude: SeedValue<number> | null;
}

export interface SeedProperty {
  cadastralCode: SeedValue<string> | null;
  /** The parent parcel, when the code is a unit inside one. */
  parentCadastralCode: SeedValue<string> | null;
  propertyType: SeedValue<string> | null;
  areaSqm: SeedValue<number> | null;
  rooms: SeedValue<number> | null;
  bedrooms: SeedValue<number> | null;
  floor: SeedValue<number> | null;
  totalFloors: SeedValue<number> | null;
  transaction: SeedTransaction;
}

export interface SeedProject {
  name: SeedValue<string> | null;
  /** Marketing, historical and transliterated names already proven. */
  aliases: string[];
  developerName: SeedValue<string> | null;
  developerCompanyName: SeedValue<string> | null;
  developerCompanyId: SeedValue<string> | null;
  /** Official/primary URLs already established. Never guessed domains. */
  urls: string[];
}

export interface ResearchSeed {
  /** The job this seed belongs to. Carried into every query for tracing. */
  subjectRef: string;
  location: SeedLocation;
  property: SeedProperty;
  project: SeedProject;
  /**
   * Listing URLs already known for this subject — from an import, a previous
   * run, or the customer's own input. Re-reading one is cheap and exact.
   */
  knownListingUrls: string[];
  /**
   * Languages worth researching in. NOT the UI language: a Georgian buyer
   * needs Russian and English evidence, and a Georgian-only sweep would miss
   * most of the expat market.
   */
  languages: ResearchLanguage[];
  /** Fact keys already fresh in the graph. Not re-researched. */
  establishedFactKeys: string[];
}

export function emptySeed(subjectRef: string): ResearchSeed {
  return {
    subjectRef,
    location: {
      countryCode: null,
      city: null,
      district: null,
      subDistrict: null,
      address: null,
      latitude: null,
      longitude: null,
    },
    property: {
      cadastralCode: null,
      parentCadastralCode: null,
      propertyType: null,
      areaSqm: null,
      rooms: null,
      bedrooms: null,
      floor: null,
      totalFloors: null,
      transaction: 'UNKNOWN',
    },
    project: {
      name: null,
      aliases: [],
      developerName: null,
      developerCompanyName: null,
      developerCompanyId: null,
      urls: [],
    },
    knownListingUrls: [],
    languages: [],
    establishedFactKeys: [],
  };
}

/**
 * Is there enough here to ask a portal a MEANINGFUL question?
 *
 * A city alone is not. "Every apartment in Tbilisi" is not a comparable set,
 * and running that search would burn requests to produce noise. The bar is a
 * city plus at least one narrowing dimension that a portal can act on.
 */
export function seedSupportsMarketSearch(seed: ResearchSeed): boolean {
  if (!seed.location.city) return false;
  return (
    seed.location.district !== null ||
    seed.location.subDistrict !== null ||
    seed.property.areaSqm !== null
  );
}

/** Human-readable, for the operator view and the plan's own audit trail. */
export function describeSeed(seed: ResearchSeed): string[] {
  const lines: string[] = [];
  const add = (label: string, v: SeedValue<unknown> | null) => {
    if (v) lines.push(`${label}: ${String(v.value)} (${v.evidence}, ${v.origin})`);
  };
  add('cadastral', seed.property.cadastralCode);
  add('city', seed.location.city);
  add('district', seed.location.district);
  add('subDistrict', seed.location.subDistrict);
  add('address', seed.location.address);
  add('propertyType', seed.property.propertyType);
  add('area', seed.property.areaSqm);
  add('rooms', seed.property.rooms);
  add('bedrooms', seed.property.bedrooms);
  add('floor', seed.property.floor);
  add('project', seed.project.name);
  add('developer', seed.project.developerName);
  if (seed.project.aliases.length) lines.push(`aliases: ${seed.project.aliases.join(', ')}`);
  if (seed.languages.length) lines.push(`languages: ${seed.languages.join(', ')}`);
  return lines;
}
