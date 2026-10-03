// HOMATCH MARKETPLACE SEARCH — handing a canonical property to Investment and Mortgage.
//
// Both products already exist and do their own arithmetic. This only passes the
// facts they already accept, from the canonical property, so the customer does
// not type the same flat in again. Nothing is computed here: no yield, no
// payment, no rate. A field the property did not state is not passed.

import type { ResultProperty } from './pipeline.ts';

/** Fields the Investment context accepts (src/investment/consultant/context.ts). */
export interface InvestmentHandoff {
  source: 'FIND_PROPERTY';
  propertyKey: string;
  askingPrice: number | null;
  currency: 'USD' | null;
  areaSqm: number | null;
  rooms: number | null;
  bedrooms: number | null;
  floor: number | null;
  city: string | null;
  district: string | null;
  propertyType: string | null;
  condition: string | null;
  sourceUrls: string[];
}

/** Mortgage prefill (MortgagePage location.state.context): price and currency only. */
export interface MortgageHandoff {
  price: number;
  currency: 'USD';
}

export function investmentHandoff(p: ResultProperty, propertyType: string | null): InvestmentHandoff {
  return {
    source: 'FIND_PROPERTY',
    propertyKey: p.key,
    askingPrice: p.facts.priceUsd,
    currency: p.facts.priceUsd !== null ? 'USD' : null,
    areaSqm: p.facts.areaSqm,
    rooms: p.facts.rooms,
    bedrooms: p.facts.bedrooms,
    floor: p.facts.floor,
    city: p.facts.city,
    district: p.facts.district,
    propertyType,
    /* The Investment context reads `condition` as text; the building/renovation code is passed as stated. */
    condition: p.facts.renovationStatus ?? p.facts.buildingStatus ?? null,
    sourceUrls: p.listings.map((l) => l.exactUrl),
  };
}

export function mortgageHandoff(p: Pick<ResultProperty, 'facts'>): MortgageHandoff | null {
  return p.facts.priceUsd !== null && p.facts.priceUsd > 0 ? { price: p.facts.priceUsd, currency: 'USD' } : null;
}
