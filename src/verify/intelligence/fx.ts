// HOMATCH — GEL/USD context.
//
// Georgian property is advertised in USD and paid in GEL, so a price that
// "went up" may have moved because the property did, because the currency
// did, or both. Separating those is genuinely useful to a buyer and is
// arithmetic, not opinion — so it happens here, deterministically.
//
// THE RULE THIS MODULE EXISTS TO ENFORCE
//
//   A currency movement is NOT a property forecast. FX explains part of a
//   historical change. It never predicts appreciation, and the language this
//   module produces must never imply that it does.
//
// Rates are INJECTED, never fetched here, so the calculation stays pure and
// testable. The caller decides whether it could obtain a rate at all; when it
// could not, every function returns null and the report simply omits the
// section rather than guessing.

export interface FxPoint {
  /** ISO date the rate belongs to. */
  date: string;
  /** GEL per 1 USD. */
  gelPerUsd: number;
  /** Where the rate came from, for the evidence explorer. */
  source?: string;
}

export interface FxContext {
  then: FxPoint;
  now: FxPoint;
  /** Positive = GEL weaker against USD over the span. */
  gelDepreciationPct: number;
  /** Positive = GEL stronger against USD over the span. */
  gelAppreciationPct: number;
  /** What a USD price from `then` is worth in GEL at `now`'s rate. */
  usdPriceInGelThen?: number;
  usdPriceInGelNow?: number;
  spanYears: number;
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

const yearsBetween = (a: string, b: string): number | null => {
  const t1 = Date.parse(a);
  const t2 = Date.parse(b);
  if (!Number.isFinite(t1) || !Number.isFinite(t2)) return null;
  return Math.abs(t2 - t1) / (365.25 * 24 * 3600 * 1000);
};

/**
 * Builds FX context between two dated rates.
 *
 * Returns null when either rate is missing or non-positive, or when the two
 * dates are less than six months apart — over a shorter span the movement is
 * noise, and presenting it as context would invite a conclusion it cannot
 * support.
 */
export function buildFxContext(
  then: FxPoint | null | undefined,
  now: FxPoint | null | undefined,
  usdAmount?: number
): FxContext | null {
  if (!then || !now) return null;
  if (!(then.gelPerUsd > 0) || !(now.gelPerUsd > 0)) return null;

  const span = yearsBetween(then.date, now.date);
  if (span === null || span < 0.5) return null;

  // GEL per USD rising means each dollar buys more lari: the lari weakened.
  const changePct = ((now.gelPerUsd - then.gelPerUsd) / then.gelPerUsd) * 100;

  return {
    then,
    now,
    gelDepreciationPct: round1(changePct),
    gelAppreciationPct: round1(-changePct),
    usdPriceInGelThen: usdAmount ? Math.round(usdAmount * then.gelPerUsd) : undefined,
    usdPriceInGelNow: usdAmount ? Math.round(usdAmount * now.gelPerUsd) : undefined,
    spanYears: round1(span),
  };
}

/**
 * Splits a GEL-denominated change into the part the currency explains and the
 * part it does not.
 *
 * This is the whole point of the module: a 30% rise in a lari price during a
 * 20% lari weakening is not a 30% real gain, and a buyer being sold on "the
 * price went up 30%" deserves to know that.
 *
 * Returns null unless both inputs are usable.
 */
export function decomposeGelChange(
  gelChangePct: number | null | undefined,
  fx: FxContext | null | undefined
): { totalGelPct: number; fxAttributedPct: number; realPct: number } | null {
  if (gelChangePct == null || !Number.isFinite(gelChangePct) || !fx) return null;
  // A USD-denominated asset re-quoted in GEL moves with the rate by
  // definition; whatever is left is the part the currency does not explain.
  const fxPart = fx.gelDepreciationPct;
  return {
    totalGelPct: round1(gelChangePct),
    fxAttributedPct: round1(fxPart),
    realPct: round1(gelChangePct - fxPart),
  };
}

/**
 * The National Bank of Georgia's public rates endpoint.
 *
 * Exported as a constant rather than called here so this module stays pure;
 * the Edge Function does the fetching, with a short timeout, and treats
 * failure as "no FX section" rather than as an error.
 */
export const NBG_RATES_URL = 'https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/ka/json/';

/** Parses one NBG payload into a rate point. Returns null on anything odd. */
export function parseNbgUsd(payload: unknown, date: string): FxPoint | null {
  const root = Array.isArray(payload) ? payload[0] : payload;
  if (!root || typeof root !== 'object') return null;
  const currencies = (root as { currencies?: unknown }).currencies;
  if (!Array.isArray(currencies)) return null;
  const usd = currencies.find(
    (c) => c && typeof c === 'object' && (c as { code?: unknown }).code === 'USD'
  ) as { rate?: unknown; quantity?: unknown } | undefined;
  if (!usd) return null;
  const rate = Number(usd.rate);
  const qty = Number(usd.quantity) || 1;
  if (!Number.isFinite(rate) || rate <= 0) return null;
  return { date, gelPerUsd: rate / qty, source: 'National Bank of Georgia' };
}
