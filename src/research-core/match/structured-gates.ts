// HOMATCH RESEARCH CORE — the three structured gates Find Buyers was missing.
//
// run-matching-v2 already hard-rejected a KNOWN transaction, property-type or
// district incompatibility. Three facts were still compared as loose text or
// not at all:
//
//   CITY      compared by substring, so "Tbilisi" and "თბილისი" were a
//             mismatch, and a Batumi buyer only lost ten points against a
//             Tbilisi flat instead of being refused.
//   BUDGET    compared as raw numbers with no currency, so a 300,000 GEL
//             budget "fit" a 300,000 USD flat; and a flat at three times the
//             budget was still a match.
//   BEDROOMS  never compared.
//
// Each gate answers AGREE / NEAR / CONFLICT / UNKNOWN. Only CONFLICT rejects.
// UNKNOWN -- a side that never said, a city the place table cannot resolve
// across scripts, a currency pair with no configured rate -- is carried, never
// resolved into agreement or disagreement. Nothing here invents a rate.

import { comparePlaces, placeNamesFor } from '../normalize/place.ts';
import { StaticRateConverter, type CurrencyConverter } from '../normalize/currency.ts';

export type GateVerdict = 'AGREE' | 'NEAR' | 'CONFLICT' | 'UNKNOWN';

export function cityGate(propertyCity: string | null | undefined, demandCity: string | null | undefined): GateVerdict {
  const verdict = comparePlaces(propertyCity, demandCity);
  return verdict === 'AGREE' ? 'AGREE' : verdict === 'CONFLICT' ? 'CONFLICT' : 'UNKNOWN';
}

/** Every spelling of the market city, for the candidate query. */
export function marketCitySpellings(city: string | null | undefined): string[] {
  const names = placeNamesFor(city).map((n) => n.trim()).filter(Boolean);
  return [...new Set(names)];
}

export interface BudgetInput {
  price: number | null | undefined;
  priceCurrency: string | null | undefined;
  budgetMin: number | null | undefined;
  budgetMax: number | null | undefined;
  budgetCurrency: string | null | undefined;
  converter?: CurrencyConverter;
}

/** Above this multiple of the stated maximum a property is out of reach. */
export const BUDGET_CONFLICT_MULTIPLE = 1.5;

export function budgetGate(input: BudgetInput): GateVerdict {
  const price = Number(input.price || 0);
  const min = Number(input.budgetMin || 0);
  const max = Number(input.budgetMax || 0);
  if (!(price > 0) || (!(min > 0) && !(max > 0))) return 'UNKNOWN';

  const from = String(input.budgetCurrency || '').toUpperCase();
  const to = String(input.priceCurrency || '').toUpperCase();
  let lo = min;
  let hi = max;
  if (from && to && from !== to) {
    const converter = input.converter;
    const convert = (n: number) => (n > 0 && converter ? converter.convert(n, from, to)?.amount ?? null : n > 0 ? null : 0);
    const cLo = convert(min);
    const cHi = convert(max);
    /* No configured rate for this pair: the comparison is unknown, not a fit. */
    if (cLo === null || cHi === null) return 'UNKNOWN';
    lo = cLo;
    hi = cHi;
  } else if (!from || !to) {
    /* One side never named a currency. Comparing bare numbers across GEL and
       USD is exactly the mistake this gate exists to stop. */
    return 'UNKNOWN';
  }

  if (hi > 0 && price > hi * BUDGET_CONFLICT_MULTIPLE) return 'CONFLICT';
  if ((!(lo > 0) || price >= lo * 0.8) && (!(hi > 0) || price <= hi * 1.2)) return 'AGREE';
  return 'NEAR';
}

export function bedroomsGate(
  propertyBedrooms: number | null | undefined,
  demandMin: number | null | undefined,
  demandMax: number | null | undefined,
): GateVerdict {
  const have = Number(propertyBedrooms);
  const min = Number(demandMin || 0);
  const max = Number(demandMax || 0);
  if (!Number.isFinite(have) || have <= 0 || (!(min > 0) && !(max > 0))) return 'UNKNOWN';
  /* Two or more bedrooms short of what the person needs cannot house them. */
  if (min > 0 && have <= min - 2) return 'CONFLICT';
  if ((!(min > 0) || have >= min) && (!(max > 0) || have <= max)) return 'AGREE';
  return 'NEAR';
}

/** fx_rates rows -> a converter. An empty table converts nothing but identity. */
export function converterFromRates(
  rows: Array<{ base_currency: string; quote_currency: string; rate: number | string; effective_from?: string | null }>,
): CurrencyConverter {
  const table: Record<string, { rate: number; asOf?: string }> = {};
  for (const row of rows) {
    const rate = Number(row.rate);
    if (!(rate > 0) || row.base_currency === row.quote_currency) continue;
    table[`${row.base_currency}_${row.quote_currency}`.toUpperCase()] = { rate, asOf: row.effective_from ?? undefined };
  }
  return new StaticRateConverter(table, { baseCurrency: 'USD', name: 'fx_rates' });
}
