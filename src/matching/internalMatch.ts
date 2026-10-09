/*
 * HOMATCH INTERNAL MATCHES — what the owner's page shows about a member whose
 * requirements fit, and how it counts them.
 *
 * Pure. The score is never computed here: it is assessMatch(), reached through the
 * same mapping the supply-matching worker uses (research-core/match/native-pair.ts),
 * so the demo buyer and a real member are scored by one engine with one set of inputs.
 *
 * Relative .ts imports so node:test can load this file without the '@/' alias.
 */

import type { DimensionResult, MatchAssessment, MatchDimension } from '../research-core/match/compatibility.ts';
import {
  assessNativePair,
  demandSideFromIntentProfile,
  nativeFitBand,
  nativeFitBandFromScore,
  strengthFromCriteria,
  supplySideFromProperty,
  type NativeFitBand,
  type PropertyFactsShape,
  type PropertyShape,
} from '../research-core/match/native-pair.ts';

/* ── the demo buyer ──────────────────────────────────────────────────────── */

/** A demo_buyer_profiles row as demo_internal_match_for_property returns it. */
export interface DemoBuyerProfile {
  id: string;
  demo_key: string;
  property_id: string;
  is_demo: boolean;
  display_label: string;
  intent_type: string | null;
  transaction_type: string | null;
  city: string | null;
  districts: string[] | null;
  property_types: string[] | null;
  budget_min: number | null;
  budget_max: number | null;
  currency: string | null;
  bedrooms_min: number | null;
  bedrooms_max: number | null;
  rooms_min: number | null;
  rooms_max: number | null;
  area_min: number | null;
  area_max: number | null;
  timeline_months: number | null;
  search_criteria: Record<string, unknown> | null;
}

export interface DemoMatchPayload {
  is_demo: true;
  profile: DemoBuyerProfile;
  property: PropertyShape & { id: string; homatch_id: number | null };
  facts: PropertyFactsShape | null;
  conversation_id: string | null;
  demo_unlocked_at: string | null;
}

const num = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

/**
 * The demo profile as an intent_profiles row. intent_profiles holds ONE district,
 * so the first listed district is the one the engine compares (as a PREFERENCE, the
 * product default); the others are shown to the owner as stated, never scored.
 */
export function demoIntentRow(profile: DemoBuyerProfile) {
  return {
    intent_type: profile.intent_type,
    transaction_type: profile.transaction_type,
    city: profile.city,
    district: profile.districts?.[0] ?? null,
    property_types: profile.property_types,
    budget_min: num(profile.budget_min),
    budget_max: num(profile.budget_max),
    currency: profile.currency,
    area_min: num(profile.area_min),
    area_max: num(profile.area_max),
    bedrooms_min: num(profile.bedrooms_min),
    bedrooms_max: num(profile.bedrooms_max),
    rooms_min: num(profile.rooms_min),
    rooms_max: num(profile.rooms_max),
  };
}

export interface ScoredMatch {
  assessment: MatchAssessment;
  /** 0–100, rounded, from assessment.score. */
  percent: number;
  band: NativeFitBand;
}

/** The demo buyer against the property's current facts, by the native engine. */
export function scoreDemoMatch(payload: Pick<DemoMatchPayload, 'profile' | 'property' | 'facts'>): ScoredMatch {
  const demand = demandSideFromIntentProfile(
    demoIntentRow(payload.profile),
    strengthFromCriteria(payload.profile.search_criteria ?? {}),
  );
  const facts = payload.facts
    ? {
      ...payload.facts,
      total_price: num(payload.facts.total_price),
      area: num(payload.facts.area),
      rooms: num(payload.facts.rooms),
      bedrooms: num(payload.facts.bedrooms),
    }
    : null;
  const supply = supplySideFromProperty(payload.property, facts);
  const assessment = assessNativePair(demand, supply);
  return { assessment, percent: Math.round(assessment.score * 100), band: nativeFitBand(assessment) };
}

/* ── what the buyer made available, field by field ──────────────────────── */

export type FieldState = 'CONFIRMED' | 'NOT_PROVIDED';

export type ProfileField =
  | { key: 'intent'; state: FieldState; transaction: string | null }
  | { key: 'budget'; state: FieldState; min: number | null; max: number | null; currency: string | null }
  | { key: 'locations'; state: FieldState; city: string | null; districts: string[] }
  | { key: 'bedrooms'; state: FieldState; min: number | null; max: number | null }
  | { key: 'rooms'; state: FieldState; min: number | null; max: number | null }
  | { key: 'propertyType'; state: FieldState; types: string[] }
  | { key: 'area'; state: FieldState; min: number | null; max: number | null }
  | { key: 'timeline'; state: FieldState; months: number | null };

const state = (...values: unknown[]): FieldState =>
  values.some((v) => (Array.isArray(v) ? v.length > 0 : v !== null && v !== undefined && v !== '')) ? 'CONFIRMED' : 'NOT_PROVIDED';

/** Every field the profile view shows, each CONFIRMED or NOT_PROVIDED — never guessed. */
export function profileFields(profile: DemoBuyerProfile): ProfileField[] {
  const districts = (profile.districts ?? []).filter(Boolean);
  const types = (profile.property_types ?? []).filter(Boolean);
  return [
    { key: 'intent', state: state(profile.transaction_type), transaction: profile.transaction_type },
    { key: 'budget', state: state(num(profile.budget_min), num(profile.budget_max)), min: num(profile.budget_min), max: num(profile.budget_max), currency: profile.currency },
    { key: 'locations', state: state(profile.city, districts), city: profile.city, districts },
    { key: 'bedrooms', state: state(num(profile.bedrooms_min), num(profile.bedrooms_max)), min: num(profile.bedrooms_min), max: num(profile.bedrooms_max) },
    { key: 'rooms', state: state(num(profile.rooms_min), num(profile.rooms_max)), min: num(profile.rooms_min), max: num(profile.rooms_max) },
    { key: 'propertyType', state: state(types), types },
    { key: 'area', state: state(num(profile.area_min), num(profile.area_max)), min: num(profile.area_min), max: num(profile.area_max) },
    { key: 'timeline', state: state(num(profile.timeline_months)), months: num(profile.timeline_months) },
  ];
}

/* ── the factor explanation ─────────────────────────────────────────────── */

export interface FactorLine {
  dimension: MatchDimension;
  verdict: DimensionResult['verdict'];
  strength: DimensionResult['strength'];
}

/** The engine's own per-dimension verdicts, in its order, for the "why" list. */
export function factorLines(assessment: Pick<MatchAssessment, 'dimensions'>): FactorLine[] {
  return assessment.dimensions.map((d) => ({ dimension: d.dimension, verdict: d.verdict, strength: d.strength }));
}

/** A real native match: the verdicts the worker stored, as factor lines. */
export function storedFactorLines(agreed: readonly string[], misses: readonly string[]): FactorLine[] {
  const order: MatchDimension[] = ['PARTICIPANTS', 'TRANSACTION', 'CITY', 'DISTRICT', 'PROPERTY_TYPE', 'PRICE', 'AREA', 'BEDROOMS'];
  const agreedSet = new Set(agreed.map((d) => d.toUpperCase()));
  const missSet = new Set(misses.map((d) => d.toUpperCase()));
  return order.map((dimension) => ({
    dimension,
    verdict: agreedSet.has(dimension) ? 'AGREE' : missSet.has(dimension) ? 'PREFERENCE_MISS' : 'UNKNOWN',
    strength: 'UNKNOWN',
  }));
}

export { nativeFitBandFromScore };
export type { NativeFitBand };

/* ── counting people, internal and external apart ───────────────────────── */

export interface GroupableNativeRow { kind: string; id: string }

/**
 * One card per PERSON. my_native_matches can return a MATCH and a RELATIONSHIP for
 * the same member; my_native_match_counterparts gives both the same opaque key.
 * A row with no key (the key read failed) stands alone — under-merging is honest,
 * over-merging would hide a person.
 */
export function groupByPerson<T extends GroupableNativeRow>(
  rows: readonly T[],
  keys: ReadonlyMap<string, string>,
): T[][] {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const key = keys.get(`${row.kind}:${row.id}`) ?? `row:${row.kind}:${row.id}`;
    const list = groups.get(key);
    if (list) list.push(row); else groups.set(key, [row]);
  }
  return [...groups.values()];
}

export interface SectionCounts {
  /** HOMATCH members (people), plus the demo buyer when the viewer may see it. */
  internal: number;
  /** External leads found by Find Buyers / Find Tenants. */
  external: number;
}

/**
 * The page's two numbers. Never summed: an internal member and an external lead are
 * different kinds of result and a headline that adds them describes neither.
 */
export function sectionCounts(input: { internalPeople: number; demoVisible: boolean; externalLeads: number }): SectionCounts {
  return {
    internal: Math.max(0, input.internalPeople) + (input.demoVisible ? 1 : 0),
    external: Math.max(0, input.externalLeads),
  };
}
