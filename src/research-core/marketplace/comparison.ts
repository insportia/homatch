// HOMATCH MARKETPLACE SEARCH — side-by-side comparison of two properties.
//
// Factual rows only. Each row says which side is ahead on THAT field where a
// direction is objective (lower price, more area, fresher), and nothing where
// it is a matter of taste. There is no overall winner: the customer decides.

import type { PropertyFacts } from './ranking.ts';
import type { FreshnessState } from './normalize.ts';
import type { SellerClass } from './seller.ts';

export interface ComparableProperty {
  key: string;
  facts: PropertyFacts;
  freshness: FreshnessState;
  lastVerifiedAt: string | null;
  seller: SellerClass;
  sourceCount: number;
}

export type ComparisonField =
  | 'price' | 'pricePerSqm' | 'area' | 'rooms' | 'bedrooms' | 'location' | 'buildingStatus' | 'renovation'
  | 'floor' | 'parking' | 'furnished' | 'freshness' | 'seller' | 'sourceCount';

export interface ComparisonRow {
  field: ComparisonField;
  a: string | number | boolean | null;
  b: string | number | boolean | null;
  /** Which side is objectively ahead on this field, or null (equal, unknown or a matter of taste). */
  ahead: 'A' | 'B' | null;
  difference: number | null;
}

const lowerWins = (a: number | null, b: number | null): 'A' | 'B' | null => (a === null || b === null || a === b ? null : a < b ? 'A' : 'B');
const higherWins = (a: number | null, b: number | null): 'A' | 'B' | null => (a === null || b === null || a === b ? null : a > b ? 'A' : 'B');
const FRESH: Record<FreshnessState, number> = { VERIFIED: 2, RECENT: 1, STALE: 0 };
const RENOV: Record<string, number> = { RENOVATED: 4, GREEN_FRAME: 3, WHITE_FRAME: 2, BLACK_FRAME: 1, NEEDS_RENOVATION: 0 };

export function compareProperties(A: ComparableProperty, B: ComparableProperty): ComparisonRow[] {
  const a = A.facts;
  const b = B.facts;
  const d = (x: number | null, y: number | null) => (x !== null && y !== null ? x - y : null);
  const yesNo = (x: boolean | null, y: boolean | null): 'A' | 'B' | null => (x === true && y === false ? 'A' : y === true && x === false ? 'B' : null);
  return [
    { field: 'price', a: a.priceUsd, b: b.priceUsd, ahead: lowerWins(a.priceUsd, b.priceUsd), difference: d(b.priceUsd, a.priceUsd) },
    { field: 'pricePerSqm', a: a.pricePerSqmUsd, b: b.pricePerSqmUsd, ahead: lowerWins(a.pricePerSqmUsd, b.pricePerSqmUsd), difference: d(b.pricePerSqmUsd, a.pricePerSqmUsd) },
    { field: 'area', a: a.areaSqm, b: b.areaSqm, ahead: higherWins(a.areaSqm, b.areaSqm), difference: d(b.areaSqm, a.areaSqm) },
    { field: 'rooms', a: a.rooms, b: b.rooms, ahead: null, difference: d(b.rooms, a.rooms) },
    { field: 'bedrooms', a: a.bedrooms, b: b.bedrooms, ahead: null, difference: d(b.bedrooms, a.bedrooms) },
    { field: 'location', a: a.district ?? a.city, b: b.district ?? b.city, ahead: null, difference: null },
    { field: 'buildingStatus', a: a.buildingStatus, b: b.buildingStatus, ahead: null, difference: null },
    {
      field: 'renovation', a: a.renovationStatus, b: b.renovationStatus,
      ahead: a.renovationStatus && b.renovationStatus ? higherWins(RENOV[a.renovationStatus] ?? null, RENOV[b.renovationStatus] ?? null) : null,
      difference: null,
    },
    { field: 'floor', a: a.floor, b: b.floor, ahead: null, difference: null },
    { field: 'parking', a: a.parking, b: b.parking, ahead: yesNo(a.parking, b.parking), difference: null },
    { field: 'furnished', a: a.furnished, b: b.furnished, ahead: null, difference: null },
    { field: 'freshness', a: A.lastVerifiedAt ?? A.freshness, b: B.lastVerifiedAt ?? B.freshness, ahead: higherWins(FRESH[A.freshness], FRESH[B.freshness]), difference: null },
    { field: 'seller', a: A.seller, b: B.seller, ahead: null, difference: null },
    { field: 'sourceCount', a: A.sourceCount, b: B.sourceCount, ahead: null, difference: d(B.sourceCount, A.sourceCount) },
  ];
}
