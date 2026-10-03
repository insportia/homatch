// PHASE 2 — ONE SCORING CONTRACT FOR BOTH DIRECTIONS.
//
//   PROPERTY → BUYER/TENANT   (Find Buyers: a fixed supply, candidate demand)
//   REQUIREMENT → PROPERTY    (Find Property: a fixed demand, candidate supply)
//
// score = relevance × (QUALITY_FLOOR + (1 − QUALITY_FLOOR) × quality)
//
// RELEVANCE is assessMatch() (compatibility.ts), the single deterministic,
// direction-agnostic comparison that already serves both products: location,
// transaction, property type, budget/price, rooms/bedrooms, area, participants.
// It alone decides COMPATIBLE / INCOMPATIBLE; a conflict is 0 and nothing
// below can lift it.
//
// QUALITY describes the CANDIDATE being recommended (the listing in Find
// Property, the person in Find Buyers), never the pair. It can reorder fitting
// candidates and at most halve a score (QUALITY_FLOOR), so weak evidence ranks
// lower but a genuine fit is never hidden by it.
//
// Every weight is in QUALITY_FACTORS with the reason it has that value, and
// every scored pair returns `explanation`: one line per factor, so HOMATCH can
// say WHY a match is strong.

import { assessMatch, type DemandSide, type MatchAssessment, type SupplySide } from './compatibility.ts';
import type { DiscoveryEntity, EvidenceOrigin } from '../discovery/discovery-entity.ts';

export const UNIFIED_SCORE_VERSION = 'unified-score-1';

/** A quality-poor candidate keeps at least half its relevance. */
export const QUALITY_FLOOR = 0.5;

export const QUALITY_FACTORS = {
  /** How recent the source says it is. Old supply sells, old demand moves on: the strongest quality signal. */
  recency: { weight: 0.35, why: 'listings and requests go stale within weeks (freshness-policy.ts, listing-age-policy.ts)' },
  /** Share of the core shape the source gave (transaction, type, city, price, area, rooms). */
  completeness: { weight: 0.25, why: 'a match on fields that exist beats a match on fields that were not stated' },
  /** Whether fields were stated by the source or inferred (context, model). */
  explicitness: { weight: 0.2, why: 'a stated price is evidence; a model reading of free text is an interpretation' },
  /** Whether the customer can reach the author from the source (contact or public profile). */
  contactability: { weight: 0.1, why: 'a result the customer cannot act on is worth less, but contact is not the product' },
  /** Prior on how structured the source is. */
  source: { weight: 0.1, why: 'portals publish structured fields; community posts are prose' },
} as const;

/** Origin → how explicit. SOURCE_FIELD is a published field; MODEL is an interpretation. */
export const ORIGIN_EXPLICITNESS: Readonly<Record<EvidenceOrigin, number>> = {
  SOURCE_FIELD: 1, TEXT: 0.8, SOURCE_CONTEXT: 0.6, MODEL: 0.5,
};

/** Prior per platform (structured portal > forum > channel post > social caption). */
export const SOURCE_PRIOR: Readonly<Record<string, number>> = {
  PORTAL: 0.9, FORUM: 0.8, TELEGRAM: 0.75, FACEBOOK: 0.7, INSTAGRAM: 0.65, LINKEDIN: 0.7,
};

/** Recency: 1 inside FRESH_DAYS, falling linearly to 0 at the stale ceiling; undated 0.5 (unknown ≠ fresh). */
export const RECENCY = {
  FRESH_DAYS: 7,
  /** Demand: the 30-day active window, hard max 60 (admin_settings.discovery_freshness_policy). */
  DEMAND_STALE_DAYS: 60,
  /** Supply: listing-age-policy.ts ceilings (RENT 60, SALE 120). */
  SUPPLY_STALE_DAYS: { RENT: 60, SALE: 120 } as Record<string, number>,
  UNDATED: 0.5,
} as const;

export interface QualityBreakdown {
  recency: number;
  completeness: number;
  explicitness: number;
  contactability: number;
  source: number;
  quality: number;
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function candidateQuality(entity: DiscoveryEntity, now = Date.now()): QualityBreakdown {
  const at = entity.publishedAt ? Date.parse(entity.publishedAt) : NaN;
  const stale = entity.kind === 'DEMAND'
    ? RECENCY.DEMAND_STALE_DAYS
    : RECENCY.SUPPLY_STALE_DAYS[entity.transaction ?? ''] ?? 90;
  let recency: number = RECENCY.UNDATED;
  if (Number.isFinite(at)) {
    const days = Math.max(0, (now - at) / 86_400_000);
    recency = days <= RECENCY.FRESH_DAYS ? 1 : Math.max(0, 1 - (days - RECENCY.FRESH_DAYS) / (stale - RECENCY.FRESH_DAYS));
  }
  const origins = Object.values(entity.evidence);
  const explicitness = origins.length ? origins.reduce((s, o) => s + (ORIGIN_EXPLICITNESS[o] ?? 0.5), 0) / origins.length : 0.5;
  const contactability = entity.contacts.length || entity.provenance.authorUrl ? 1 : entity.provenance.permalink ? 0.5 : 0;
  const source = SOURCE_PRIOR[entity.source.platform] ?? 0.6;
  const f = QUALITY_FACTORS;
  const quality = recency * f.recency.weight + entity.confidence * f.completeness.weight
    + explicitness * f.explicitness.weight + contactability * f.contactability.weight + source * f.source.weight;
  return {
    recency: round(recency), completeness: round(entity.confidence), explicitness: round(explicitness),
    contactability: round(contactability), source: round(source), quality: round(quality),
  };
}

export function unifiedScore(relevance: number, quality: number): number {
  if (!(relevance > 0)) return 0;
  return round(relevance * (QUALITY_FLOOR + (1 - QUALITY_FLOOR) * Math.max(0, Math.min(1, quality))));
}

/* ── Entities to the comparison's two sides ───────────────────────────── */

export function demandSideOf(e: DiscoveryEntity): DemandSide {
  return {
    intentType: e.intent === 'RENT' ? 'RENT' : e.intent === 'BUY' ? 'BUY' : e.intent === 'INVEST' ? 'INVEST' : null,
    transactionType: e.transaction,
    city: e.city,
    district: e.district,
    propertyTypes: e.propertyType ? [e.propertyType] : null,
    budgetMin: e.price?.min ?? null,
    budgetMax: e.price?.max ?? null,
    currency: e.price?.currency ?? null,
    areaMin: e.areaSqm, areaMax: null,
    bedroomsMin: e.bedrooms, bedroomsMax: e.bedrooms,
    roomsMin: e.rooms, roomsMax: e.rooms,
    strength: { DISTRICT: 'PREFERRED' },
  };
}

export function supplySideOf(e: DiscoveryEntity): SupplySide {
  const sale = e.transaction === 'SALE' ? e.price : null;
  const rent = e.transaction === 'RENT' ? e.price : null;
  return {
    transaction: e.transaction,
    city: e.city,
    district: e.district,
    propertyType: e.propertyType,
    saleAmount: sale?.min ?? null, saleCurrency: sale?.currency ?? null,
    rentAmount: rent?.min ?? null, rentCurrency: rent?.currency ?? null,
    areaSqm: e.areaSqm, bedrooms: e.bedrooms, rooms: e.rooms,
  };
}

export interface ScoredMatch {
  direction: 'FIND_PROPERTY' | 'FIND_BUYERS';
  assessment: MatchAssessment;
  relevance: number;
  quality: QualityBreakdown;
  score: number;
  explanation: string[];
}

function explain(assessment: MatchAssessment, q: QualityBreakdown, candidate: 'listing' | 'person'): string[] {
  const lines: string[] = [];
  if (assessment.compatibility !== 'COMPATIBLE') return [`${assessment.compatibility}: ${assessment.rationale}`];
  lines.push(`fit: ${assessment.rationale}`);
  lines.push(`recency ${q.recency}: ${q.recency >= 1 ? `posted within ${RECENCY.FRESH_DAYS} days` : q.recency === RECENCY.UNDATED ? 'the source gave no date' : 'older, ranked lower'}`);
  lines.push(`completeness ${q.completeness}: share of transaction, type, city, price, area and rooms the ${candidate} states`);
  lines.push(`explicitness ${q.explicitness}: ${q.explicitness >= 0.9 ? 'stated as source fields' : 'partly read from text or inferred'}`);
  lines.push(`contactability ${q.contactability}: ${q.contactability === 1 ? 'a public contact or profile is available' : 'only the post itself'}`);
  lines.push(`source ${q.source}: platform prior`);
  return lines;
}

/** One comparison, both directions: the same assessMatch, quality of whichever side is the candidate. */
export function scorePair(
  demand: DiscoveryEntity,
  supply: DiscoveryEntity,
  direction: 'FIND_PROPERTY' | 'FIND_BUYERS',
  options: { minAgreements?: number; now?: number } = {},
): ScoredMatch {
  const assessment = assessMatch(demandSideOf(demand), supplySideOf(supply), { minAgreements: options.minAgreements ?? 3 });
  const candidate = direction === 'FIND_PROPERTY' ? supply : demand;
  const quality = candidateQuality(candidate, options.now);
  const relevance = assessment.compatibility === 'COMPATIBLE' ? assessment.score : 0;
  return {
    direction, assessment, relevance, quality,
    score: unifiedScore(relevance, quality.quality),
    explanation: explain(assessment, quality, direction === 'FIND_PROPERTY' ? 'listing' : 'person'),
  };
}
