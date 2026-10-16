// FIND BUYERS — one-campaign provider cap for an owner-authorised live test (2026-10-16).
//
// An admin writes admin_settings.find_buyers_test_cap = { propertyId, providerUsd,
// expiresAt, userId? } (Admin → Find Buyers → Actors). The NEXT campaign started for
// that property (and that owner, when set) before it expires has its provider
// budget lowered to providerUsd; the cap is then marked consumed with that
// campaign's job id, so it applies exactly once and to nobody else. Global
// pricing (find_buyers_provider_share_bps, the $10 minimum) is untouched.
// It can only LOWER a budget; every Actor run is still reserved against it
// atomically (find_buyers_reserve_actor_run → CAMPAIGN_BUDGET) and started with
// Apify's maxTotalChargeUsd at that reservation.

export interface TestCap {
  propertyId: string;
  providerUsd: number;
  expiresAt: string;
  userId?: string | null;
  consumedBy?: string | null;
  consumedAt?: string | null;
}

/** Highest cap an admin may set here: a test, not a pricing tool. */
export const TEST_CAP_MAX_USD = 10;

export function parseTestCap(raw: unknown): TestCap | null {
  const v = typeof raw === 'string' ? (() => { try { return JSON.parse(raw); } catch { return null; } })() : raw;
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const providerUsd = Number(o.providerUsd);
  if (typeof o.propertyId !== 'string' || !o.propertyId) return null;
  if (!Number.isFinite(providerUsd) || providerUsd <= 0 || providerUsd > TEST_CAP_MAX_USD) return null;
  if (typeof o.expiresAt !== 'string' || !Number.isFinite(Date.parse(o.expiresAt))) return null;
  return {
    propertyId: o.propertyId, providerUsd, expiresAt: o.expiresAt,
    userId: typeof o.userId === 'string' && o.userId ? o.userId : null,
    consumedBy: typeof o.consumedBy === 'string' && o.consumedBy ? o.consumedBy : null,
    consumedAt: typeof o.consumedAt === 'string' ? o.consumedAt : null,
  };
}

export type TestCapDecision =
  | { applies: true; capMicros: number; alreadyConsumedByThis: boolean }
  | { applies: false; reason: 'NONE' | 'OTHER_PROPERTY' | 'OTHER_OWNER' | 'EXPIRED' | 'CONSUMED' };

/** Does the stored cap govern this campaign? Pure; the caller consumes it atomically. */
export function decideTestCap(cap: TestCap | null, c: { propertyId: string; userId: string; matchingJobId: string; now?: number }): TestCapDecision {
  if (!cap) return { applies: false, reason: 'NONE' };
  if (cap.propertyId !== c.propertyId) return { applies: false, reason: 'OTHER_PROPERTY' };
  if (cap.userId && cap.userId !== c.userId) return { applies: false, reason: 'OTHER_OWNER' };
  /* A retry of the campaign that consumed it keeps its cap. */
  if (cap.consumedBy) return cap.consumedBy === c.matchingJobId
    ? { applies: true, capMicros: Math.round(cap.providerUsd * 1_000_000), alreadyConsumedByThis: true }
    : { applies: false, reason: 'CONSUMED' };
  if (Date.parse(cap.expiresAt) <= (c.now ?? Date.now())) return { applies: false, reason: 'EXPIRED' };
  return { applies: true, capMicros: Math.round(cap.providerUsd * 1_000_000), alreadyConsumedByThis: false };
}

/** The capped provider budget: never above what the campaign's credits pay for. */
export function cappedBudget(providerBudgetMicros: number, capMicros: number): number {
  return Math.max(0, Math.min(providerBudgetMicros, capMicros));
}
