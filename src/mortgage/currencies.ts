// HOMATCH MORTGAGE AI CONSULTANT — the currencies a loan can be written in.
//
// WHAT THIS IS NOT
//
// It is not an exchange-rate table, and nothing here converts anything.
// A loan of 150,000 USD is calculated in USD from end to end: price,
// down payment, payment, interest, total. Converting it to lari to
// "calculate" it and back again would introduce a rate nobody quoted, on
// a date nobody chose, into a number a person is about to plan their
// life around. The arithmetic never needs it — an annuity does not care
// what the unit is called.
//
// It is also not a claim about availability. Choosing AED here means
// "denominate this calculation in dirhams", not "a Georgian bank will
// lend you dirhams". The page says so where the choice is made.
//
// WHAT IT IS
//
// Two things a currency genuinely changes on screen:
//
//   1. WHAT A ROUND NUMBER LOOKS LIKE. The click-first suggestions are
//      illustrations, and an illustration in the wrong order of
//      magnitude is worse than none: offering "250,000" as a property
//      price to someone shopping in Turkish lira is not a suggestion,
//      it is a distraction. Each currency therefore carries its OWN
//      round numbers. They are NOT conversions of one another — that
//      would smuggle a rate back in — they are simply the round figures
//      that read as ordinary in each market.
//
//   2. HOW SMALL MONEY STEPS. A ten-unit monthly service fee is normal
//      in lari and meaningless in lira. One step per currency generates
//      every flat-fee suggestion, so the existing GEL/USD/EUR values are
//      reproduced exactly and the new ones are proportionate.
//
// Regulatory treatment is NOT here. Whether a currency is LOCAL or
// FOREIGN for the National Bank of Georgia's PTI/LTV tiers is decided by
// classifyCurrency() in ./rules/ptiLtv.ts, which is the one place that
// mapping lives.

export const MORTGAGE_CURRENCY_CODES = ['GEL', 'USD', 'EUR', 'GBP', 'TRY', 'AED'] as const;

export type MortgageCurrencyCode = (typeof MORTGAGE_CURRENCY_CODES)[number];

export interface MortgageCurrency {
  /** ISO 4217. The symbol is Intl's job, not ours — see formatMoney. */
  code: MortgageCurrencyCode;
  /**
   * Round property prices offered as illustrations, in THIS currency.
   * Never derived from another currency's list.
   */
  pricePoints: readonly number[];
  /**
   * The unit small flat amounts round to. Every flat-money suggestion —
   * a monthly service fee, a valuation, a year of insurance — is a
   * multiple of this, so one number per currency keeps them all in
   * proportion.
   */
  smallStep: number;
}

const REGISTRY: Record<MortgageCurrencyCode, MortgageCurrency> = {
  GEL: { code: 'GEL', pricePoints: [60_000, 100_000, 150_000, 250_000, 400_000], smallStep: 5 },
  USD: { code: 'USD', pricePoints: [60_000, 100_000, 150_000, 250_000, 400_000], smallStep: 5 },
  EUR: { code: 'EUR', pricePoints: [60_000, 100_000, 150_000, 250_000, 400_000], smallStep: 5 },
  GBP: { code: 'GBP', pricePoints: [100_000, 180_000, 300_000, 450_000, 700_000], smallStep: 5 },
  TRY: { code: 'TRY', pricePoints: [2_000_000, 4_000_000, 7_000_000, 12_000_000, 20_000_000], smallStep: 100 },
  AED: { code: 'AED', pricePoints: [500_000, 900_000, 1_500_000, 2_500_000, 4_000_000], smallStep: 20 },
};

export const MORTGAGE_CURRENCIES: readonly MortgageCurrency[] =
  MORTGAGE_CURRENCY_CODES.map((code) => REGISTRY[code]);

export function isMortgageCurrency(code: string | null | undefined): code is MortgageCurrencyCode {
  return typeof code === 'string' && code in REGISTRY;
}

/**
 * The definition for a code.
 *
 * An unknown code falls back to the first entry rather than throwing: a
 * stale value in localStorage, or a property priced in something this
 * list does not carry yet, must not take the page down. The FALLBACK
 * affects suggestions only — the calculation and the formatting still
 * use whatever code was actually given.
 */
export function mortgageCurrency(code: string | null | undefined): MortgageCurrency {
  return isMortgageCurrency(code) ? REGISTRY[code] : REGISTRY.GEL;
}
