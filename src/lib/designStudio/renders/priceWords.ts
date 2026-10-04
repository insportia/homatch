// What a Design Studio quote says to the customer: the estimate and the maximum (the reserved ceiling the settlement
// can never pass). Never the cost or the margin behind it. Credits are shown at the quote's own 0.1 precision.

type T = (key: string, vars?: Record<string, string>) => string;

/** A quote as the screens hold it: `credits` is the confirmed maximum; `est` the expected charge. */
export interface PriceShown { credits: number; charged: boolean; est?: number | null; min?: number | null }

/** Credits at 0.1 precision, without a trailing ".0". */
export const creditText = (n: number) => String(Math.round(n * 10) / 10);

export function priceWords(t: T, p: PriceShown): string {
  const est = typeof p.est === 'number' && p.est > 0 ? p.est : null;
  // A range only when the estimate is below the maximum; an exact price reads as one number.
  if (est != null && est < p.credits) {
    return t(p.charged ? 'dsx_price_range' : 'dsx_price_range_preview', { est: creditText(est), max: creditText(p.credits) });
  }
  return t(p.charged ? 'p2h_price_charged' : 'p2h_price_not_charged', { credits: creditText(p.credits) });
}

/** The number a button shows beside "Generate": the estimate when there is one. */
export const priceShort = (p: PriceShown) => creditText(typeof p.est === 'number' && p.est > 0 ? p.est : p.credits);
