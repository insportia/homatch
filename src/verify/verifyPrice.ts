/*
 * Verify retail price arithmetic, pure (no client): the Admin card shows the
 * credits an amount is as it is typed. The server (admin_set_verify_price)
 * validates the same rule and stays the authority.
 */

/** USD text → whole cents, or null when it is not a positive amount with at most two decimals. */
export function parseUsdToCents(text: string): number | null {
  const s = String(text ?? '').trim().replace(',', '.');
  if (!/^\d{1,4}(\.\d{1,2})?$/.test(s)) return null;
  const [whole, frac = ''] = s.split('.');
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return cents > 0 && cents <= 100000 ? cents : null;
}

/** The credits a price is, or null when it is not a whole number of credits (never rounded). */
export function creditsForCents(cents: number | null, creditsPerUsd = 10): number | null {
  if (cents == null || !Number.isInteger(cents) || cents <= 0) return null;
  const credits = (cents * creditsPerUsd) / 100;
  return Number.isInteger(credits) ? credits : null;
}
