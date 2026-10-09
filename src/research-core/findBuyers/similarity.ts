// PROPERTY SIMILARITY GATE — how close is a public post's property to the
// owner's property (0-100, explainable), and is it worth paying for its
// comments?
//
// Unknown dimensions earn partial credit (never full): a post that says
// nothing about price cannot look like a perfect price match. A hard conflict
// (other transaction, other property type, other city) caps the score low.

import { NEARBY_DISTRICTS, normKey } from './places.ts';
import type { PropertyDna } from './propertyDna.ts';
import type { TextFacts } from './textFacts.ts';

export const SIMILARITY_WEIGHTS = {
  location: 30, transaction: 15, propertyType: 12, rooms: 12, area: 10, price: 13, recency: 8,
} as const;
type Dim = keyof typeof SIMILARITY_WEIGHTS;

const UNKNOWN_CREDIT = 0.4;
const CONFLICT_CAP = 30;

export interface SimilarityResult {
  score: number;
  components: Record<Dim, { points: number; max: number; reason: string }>;
  conflicts: string[];
  /** Short, factual: which dimensions agreed. */
  agreed: string[];
}

export interface FxToUsd { [currency: string]: number }

function toUsd(amount: number | null, currency: string | null, fx: FxToUsd | undefined): number | null {
  if (amount == null || !currency) return null;
  if (currency === 'USD') return amount;
  const rate = fx?.[currency];
  return rate && rate > 0 ? amount * rate : null;
}

export function scoreSimilarity(
  dna: PropertyDna,
  facts: TextFacts,
  opts: { ageDays?: number | null; fxToUsd?: FxToUsd } = {},
): SimilarityResult {
  const comp = {} as SimilarityResult['components'];
  const conflicts: string[] = [];
  const agreed: string[] = [];
  const set = (d: Dim, ratio: number, reason: string) => {
    comp[d] = { points: Math.round(SIMILARITY_WEIGHTS[d] * Math.max(0, Math.min(1, ratio))), max: SIMILARITY_WEIGHTS[d], reason };
    if (ratio >= 0.8) agreed.push(d);
  };

  /* Location: city then district (nearby districts count most of the way). */
  const dnaCity = normKey(dna.city); const dnaDistrict = normKey(dna.district);
  if (facts.city && dnaCity && facts.city !== dnaCity) {
    set('location', 0, 'different city'); conflicts.push('city');
  } else if (facts.district && dnaDistrict) {
    if (facts.district === dnaDistrict) set('location', 1, 'same district');
    else if ((NEARBY_DISTRICTS[dnaDistrict] ?? []).includes(facts.district)) set('location', 0.75, 'nearby district');
    else set('location', facts.city || dnaCity ? 0.45 : 0.3, 'same city, other district');
  } else if (facts.city && facts.city === dnaCity) {
    set('location', 0.6, 'same city');
  } else if (facts.district && !dnaDistrict) {
    set('location', 0.55, 'district named, owner district unknown');
  } else {
    set('location', UNKNOWN_CREDIT * 0.75, 'location not stated');
  }

  if (!facts.transaction) set('transaction', UNKNOWN_CREDIT, 'transaction not stated');
  else if (facts.transaction === dna.transaction) set('transaction', 1, 'same transaction');
  else { set('transaction', 0, 'other transaction'); conflicts.push('transaction'); }

  const dnaType = dna.propertyType === 'HOUSE' || dna.propertyType === 'VILLA' ? 'HOUSE'
    : dna.propertyType === 'LAND' ? 'LAND' : dna.propertyType === 'COMMERCIAL' || dna.propertyType === 'OFFICE' ? 'COMMERCIAL'
    : dna.propertyType ? 'APARTMENT' : null;
  if (!facts.propertyType || !dnaType) set('propertyType', UNKNOWN_CREDIT, 'type not stated');
  else if (facts.propertyType === dnaType) set('propertyType', 1, 'same property type');
  else { set('propertyType', 0, 'other property type'); conflicts.push('propertyType'); }

  /* Rooms: compare bedrooms to bedrooms, else total rooms (bedrooms + 1). */
  const dnaRooms = dna.rooms ?? (dna.bedrooms != null ? dna.bedrooms + 1 : null);
  const factRooms = facts.rooms ?? (facts.bedrooms != null ? facts.bedrooms + 1 : null);
  if (facts.bedrooms != null && dna.bedrooms != null) {
    const d = Math.abs(facts.bedrooms - dna.bedrooms);
    set('rooms', d === 0 ? 1 : d === 1 ? 0.5 : 0, d === 0 ? 'same bedrooms' : `${d} bedroom(s) apart`);
  } else if (factRooms != null && dnaRooms != null) {
    const d = Math.abs(factRooms - dnaRooms);
    set('rooms', d === 0 ? 1 : d === 1 ? 0.5 : 0, d === 0 ? 'same rooms' : `${d} room(s) apart`);
  } else set('rooms', UNKNOWN_CREDIT, 'rooms not stated');

  if (facts.areaSqm != null && dna.areaSqm != null) {
    const r = Math.abs(facts.areaSqm - dna.areaSqm) / dna.areaSqm;
    set('area', r <= 0.1 ? 1 : r <= 0.2 ? 0.75 : r <= 0.35 ? 0.35 : 0, `area ${Math.round(r * 100)}% apart`);
  } else set('area', UNKNOWN_CREDIT, 'area not stated');

  const a = toUsd(facts.price, facts.currency, opts.fxToUsd);
  const b = toUsd(dna.price, dna.currency, opts.fxToUsd);
  if (a != null && b != null && b > 0) {
    const r = Math.abs(a - b) / b;
    set('price', r <= 0.1 ? 1 : r <= 0.2 ? 0.75 : r <= 0.35 ? 0.35 : 0, `price ${Math.round(r * 100)}% apart`);
  } else set('price', UNKNOWN_CREDIT, 'price not comparable');

  const age = opts.ageDays;
  if (age == null) set('recency', 0.3, 'date unknown');
  else set('recency', age <= 7 ? 1 : age <= 14 ? 0.75 : age <= 30 ? 0.45 : 0, `${Math.round(age)} days old`);

  let score = Object.values(comp).reduce((s, c) => s + c.points, 0);
  if (conflicts.length) score = Math.min(score, CONFLICT_CAP);
  return { score: Math.max(0, Math.min(100, score)), components: comp, conflicts, agreed };
}

export interface CommentGateConfig { skipBelow: number; eligibleFrom: number }
/* Comments are only considered under listings comparable to the property
   (see the pipeline), so the gate can sit lower than when every post was a
   candidate: in VILLION no listing scored above 74 and none was examined. */
export const DEFAULT_COMMENT_GATE: CommentGateConfig = { skipBelow: 55, eligibleFrom: 75 };

export type CommentDecision = 'SKIP_LOW_SIMILARITY' | 'SKIP_NO_COMMENTS' | 'SKIP_WEAK_SIGNALS' | 'FETCH' | 'FETCH_JUSTIFIED';

/**
 * <skipBelow: never pay for comments. eligibleFrom+: fetch. In between: only
 * when other signals justify it (engagement, recency, a high-yield source).
 */
export function decideComments(
  similarity: number,
  ctx: { commentCount?: number | null; ageDays?: number | null; sourceYield?: number | null },
  gate: CommentGateConfig = DEFAULT_COMMENT_GATE,
): CommentDecision {
  if (ctx.commentCount === 0) return 'SKIP_NO_COMMENTS';
  if (similarity < gate.skipBelow) return 'SKIP_LOW_SIMILARITY';
  if (similarity >= gate.eligibleFrom) return 'FETCH';
  const engaged = (ctx.commentCount ?? 0) >= 5;
  const recent = ctx.ageDays != null && ctx.ageDays <= 7;
  const productive = (ctx.sourceYield ?? 0) >= 0.05;
  const reasons = [engaged, recent, productive].filter(Boolean).length;
  return reasons >= 2 ? 'FETCH_JUSTIFIED' : 'SKIP_WEAK_SIGNALS';
}
