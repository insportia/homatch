// HOMATCH Communications — what a phone number costs a customer.
//
// THE ONE PRICING RULE THAT IS AUTHORISED HERE
//
// Owner-approved, for NUMBER PROCUREMENT AND RENTAL ONLY:
//
//   customer retail = real provider cost x 2
//
// It does NOT extend to AI call minutes, WhatsApp messages, WhatsApp calls,
// AI Talk, SMS, or any other Communications usage. Those remain unpriced until
// the owner sets them, and nothing in this file may be read as authorising a
// number for them.
//
// WHY THIS IS A FUNCTION AND NOT A MULTIPLICATION AT THE CALL SITE
//
// Because a margin rule written inline is a margin rule that gets applied
// twice, or applied to a retail figure, or skipped on the renewal path. There
// is one place that knows the rule, it refuses to guess when the cost is not a
// real number, and it rounds in a single documented direction.

/** The authorised markup. Not configurable here: changing it is an owner decision. */
export const NUMBER_RETAIL_MULTIPLIER = 2;

export interface NumberPrice {
  /** What the provider charges us, in whole cents. */
  providerCostCents: number;
  /** What the customer pays, in whole cents. */
  retailCents: number;
  /** retail - cost, in whole cents. Admin-only. */
  grossMarginCents: number;
  currency: string;
}

/**
 * Retail for a number whose provider cost is known.
 *
 * Returns null rather than a number when the cost is not usable — absent,
 * negative, infinite, NaN. A null price must be rendered as "price
 * unavailable"; it must never be rendered as free, and it must never be
 * allowed to reach a purchase.
 */
export function numberRetailPrice(
  providerCostCents: number | null | undefined,
  currency = 'USD',
): NumberPrice | null {
  if (providerCostCents === null || providerCostCents === undefined) return null;
  if (typeof providerCostCents !== 'number' || !Number.isFinite(providerCostCents)) return null;
  if (providerCostCents < 0) return null;

  // A zero-cost number is not a free number — it is a cost we failed to read.
  // Selling it for zero would be inventing a price.
  if (providerCostCents === 0) return null;

  // Rounded UP, so the margin is never silently eroded by a half-cent.
  const cost = Math.ceil(providerCostCents);
  const retail = Math.ceil(cost * NUMBER_RETAIL_MULTIPLIER);

  return {
    providerCostCents: cost,
    retailCents: retail,
    grossMarginCents: retail - cost,
    currency,
  };
}

/** Display helper. Cents in, a string a customer can read out. */
export function formatMoneyCents(cents: number, currency = 'USD'): string {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency,
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}
