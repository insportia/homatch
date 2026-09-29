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

import { comparePlaces, placeNamesFor, resolvePlace } from '../normalize/place.ts';
import { StaticRateConverter, type CurrencyConverter } from '../normalize/currency.ts';

export type GateVerdict = 'AGREE' | 'NEAR' | 'CONFLICT' | 'UNKNOWN';

/**
 * A HARD gate, so it rejects only on knowledge, never on spelling:
 *
 *   AGREE     the same place in any script, or a Tbilisi district vs Tbilisi
 *             (a classifier often writes the district into the city field)
 *   CONFLICT  two different KNOWN cities, or a known district of one city vs
 *             another known city
 *   UNKNOWN   anything the place table cannot resolve -- "Tbilisi Sea", a
 *             village, a typo. Never rejected, never merged by substring.
 */
export function cityGate(propertyCity: string | null | undefined, demandCity: string | null | undefined): GateVerdict {
  if (!String(propertyCity ?? '').trim() || !String(demandCity ?? '').trim()) return 'UNKNOWN';
  if (comparePlaces(propertyCity, demandCity) === 'AGREE') return 'AGREE';
  const a = resolvePlace(propertyCity);
  const b = resolvePlace(demandCity);
  if (!a || !b) return 'UNKNOWN';
  if (a.key === b.key) return 'AGREE';
  if (a.kind === 'CITY' && b.kind === 'CITY') return 'CONFLICT';
  /* A district against its own city agrees; against another city conflicts.
     Two different districts of the same city are a DISTRICT question, which
     run-matching-v2's district gate answers, not this one. */
  return a.cityKey === b.cityKey ? 'AGREE' : 'CONFLICT';
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

/*
 * FX FRESHNESS. A rate is evidence about one day. An old rate treated as
 * current would decide a budget fit on yesterday's market, so every rate that
 * enters a budget comparison carries a date and is refused past a limit:
 *
 *   fx_rates rows (operator-entered)   effective_from within 7 days
 *   NBG official rates (fetched)       the NBG's own date within 3 days
 *
 * Refused or absent rates leave cross-currency budgets UNKNOWN -- never a
 * guess, never a rejection.
 */
export const FX_TABLE_MAX_AGE_DAYS = 7;
export const FX_NBG_MAX_AGE_DAYS = 3;
const DAY = 86_400_000;

type RateTable = Record<string, { rate: number; asOf?: string }>;

/** fx_rates rows -> rate entries, keeping only current, dated, non-identity rows. */
export function ratesFromTable(
  rows: Array<{ base_currency: string; quote_currency: string; rate: number | string; effective_from?: string | null }>,
  now: number = Date.now(),
): RateTable {
  const table: RateTable = {};
  for (const row of rows) {
    const rate = Number(row.rate);
    if (!(rate > 0) || row.base_currency === row.quote_currency) continue;
    const at = row.effective_from ? Date.parse(row.effective_from) : Number.NaN;
    if (!Number.isFinite(at) || now - at > FX_TABLE_MAX_AGE_DAYS * DAY) continue;
    table[`${row.base_currency}_${row.quote_currency}`.toUpperCase()] = { rate, asOf: row.effective_from ?? undefined };
  }
  return table;
}

/**
 * The National Bank of Georgia's official rates (the source Verify already
 * uses, src/verify/intelligence/fx.ts) -> CODE_GEL entries. Null when the
 * payload is malformed, undated, or older than FX_NBG_MAX_AGE_DAYS.
 */
export function ratesFromNbg(payload: unknown, now: number = Date.now()): RateTable | null {
  const root = Array.isArray(payload) ? payload[0] : payload;
  if (!root || typeof root !== 'object') return null;
  const dated = Date.parse(String((root as { date?: unknown }).date ?? ''));
  if (!Number.isFinite(dated) || now - dated > FX_NBG_MAX_AGE_DAYS * DAY || dated - now > DAY) return null;
  const currencies = (root as { currencies?: unknown }).currencies;
  if (!Array.isArray(currencies)) return null;
  const table: RateTable = {};
  const asOf = new Date(dated).toISOString();
  for (const c of currencies as Array<{ code?: unknown; rate?: unknown; quantity?: unknown }>) {
    const code = String(c?.code ?? '').toUpperCase();
    const rate = Number(c?.rate) / (Number(c?.quantity) || 1);
    if (!/^[A-Z]{3}$/.test(code) || !(rate > 0)) continue;
    table[`${code}_GEL`] = { rate, asOf };
  }
  return Object.keys(table).length ? table : null;
}

/**
 * A rate table handed over by a caller (match-campaign / the discovery driver
 * fetch NBG and pass it on, so the match writer itself never fetches). Every
 * entry is re-checked here: a positive rate, a CODE_GEL pair, and an asOf
 * within FX_NBG_MAX_AGE_DAYS. Anything else is dropped, never trusted.
 */
export function ratesFromPayload(value: unknown, now: number = Date.now()): RateTable | null {
  if (!value || typeof value !== 'object') return null;
  const table: RateTable = {};
  for (const [pair, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[A-Z]{3}_GEL$/.test(pair) || !entry || typeof entry !== 'object') continue;
    const rate = Number((entry as { rate?: unknown }).rate);
    const at = Date.parse(String((entry as { asOf?: unknown }).asOf ?? ''));
    if (!(rate > 0) || !Number.isFinite(at) || now - at > FX_NBG_MAX_AGE_DAYS * DAY || at - now > DAY) continue;
    table[pair] = { rate, asOf: new Date(at).toISOString() };
  }
  return Object.keys(table).length ? table : null;
}

/** One converter over every current rate we hold. GEL is the hub for NBG pairs. */
export function converterFrom(...tables: Array<RateTable | null | undefined>): CurrencyConverter {
  const merged: RateTable = {};
  for (const t of tables) if (t) Object.assign(merged, t);
  return new StaticRateConverter(merged, { baseCurrency: 'GEL', name: 'current-fx' });
}

/** fx_rates rows -> a converter. Stale and undated rows are ignored. */
export function converterFromRates(
  rows: Array<{ base_currency: string; quote_currency: string; rate: number | string; effective_from?: string | null }>,
  now: number = Date.now(),
): CurrencyConverter {
  return converterFrom(ratesFromTable(rows, now));
}
