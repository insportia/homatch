// "Why this person may be relevant" — structured, so the customer UI renders
// it in the reader's language from translated fragments (never English-only
// generated prose, never a model's free text).

import type { SimilarityResult } from './similarity.ts';
import type { TextFacts } from './textFacts.ts';

export interface WhyMatched {
  kind: 'COMMENT_ON_SIMILAR' | 'REQUEST_POST' | 'COMMENT_REQUEST';
  /** Facts of the property they reacted to / asked for, only when stated. */
  bedrooms: number | null;
  propertyType: string | null;
  district: string | null;
  city: string | null;
  /** Dimensions that agreed with the owner's property. */
  agreed: Array<'location' | 'rooms' | 'area' | 'price' | 'propertyType' | 'transaction'>;
  parentAgeDays: number | null;
}

export function buildWhy(
  kind: WhyMatched['kind'],
  facts: TextFacts,
  similarity: SimilarityResult,
  parentAgeDays: number | null,
): WhyMatched {
  const agreed = similarity.agreed.filter((d) => d !== 'recency') as WhyMatched['agreed'];
  return {
    kind,
    bedrooms: facts.bedrooms ?? (facts.rooms != null ? Math.max(0, facts.rooms - 1) : null),
    propertyType: facts.propertyType,
    district: facts.district,
    city: facts.city,
    agreed,
    parentAgeDays: parentAgeDays != null ? Math.round(parentAgeDays) : null,
  };
}
