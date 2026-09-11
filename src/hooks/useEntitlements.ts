import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { getMyEntitlements } from '@/services/billing';
import type {
  BillingEntitlements, ProductEntitlement, PlanCode, QualityTier,
} from '@/types/billing';

/**
 * THE ENTITLEMENT HOOK.
 *
 * The mandate is blunt about this: "Do not scatter logic like
 * `if plan === premium` across dozens of components." So no component asks
 * what plan a customer is on in order to decide what to show. It asks THIS
 * what they may do, and renders that.
 *
 * Every value here originates in billing_entitlements() in Postgres. Nothing
 * is derived in the browser, because a second implementation of the allowance
 * rules is a second set of answers, and the one the customer sees would be the
 * one that is easiest to get wrong.
 */
export interface Entitlements {
  loading: boolean;
  error: string | null;
  /** Null while loading, or when signed out. */
  data: BillingEntitlements | null;

  plan: PlanCode;
  planName: string;
  /** The tier this customer's executions run at. */
  tier: QualityTier;
  badgeKey: string | null;
  memberRateKey: string;

  balance: number;
  reserved: number;
  creditsPerUsd: number;
  /** Dollar value of the balance, at the server's current rate. */
  balanceUsd: number;

  /** True when the once-per-account activation offer is still open. */
  firstTopupAvailable: boolean;

  /** What this customer gets for a given product, or null if unavailable. */
  forProduct: (productCode: string) => ProductEntitlement | null;
  /** Included runs left this period. 0 means the next run is PAYG. */
  includedRemaining: (productCode: string) => number;
  /** Quality tier for a product, falling back to the plan's own tier. */
  tierFor: (productCode: string) => QualityTier;
  /** Result ceiling, or null when the product has no ceiling. */
  resultCeiling: (productCode: string) => number | null;
  /**
   * Can this customer run it at all? PAYG is unlimited on every plan, so this
   * is only false behind a kill switch — never because someone is on FREE.
   */
  canUse: (productCode: string) => boolean;
  /** True when the next run would draw on the wallet rather than the allowance. */
  wouldChargeCredits: (productCode: string) => boolean;

  refresh: () => Promise<void>;
}

export function useEntitlements(): Entitlements {
  const { homatchUser } = useAuth();
  const [data, setData] = useState<BillingEntitlements | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!homatchUser?.id) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const ent = await getMyEntitlements();
      setData(ent);
      setError(ent ? null : 'ENTITLEMENTS_UNAVAILABLE');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'ENTITLEMENTS_UNAVAILABLE');
    } finally {
      setLoading(false);
    }
  }, [homatchUser?.id]);

  useEffect(() => { void load(); }, [load]);

  const byCode = useMemo(() => {
    const m = new Map<string, ProductEntitlement>();
    for (const p of data?.products ?? []) m.set(p.product_code, p);
    return m;
  }, [data]);

  const plan = (data?.plan_code ?? 'FREE') as PlanCode;
  const creditsPerUsd = data?.wallet?.credits_per_usd ?? 10;
  const balance = data?.wallet?.balance ?? 0;

  const forProduct = useCallback((code: string) => byCode.get(code) ?? null, [byCode]);

  return {
    loading,
    error,
    data,

    plan,
    planName: data?.plan_name ?? 'Free',
    tier: (data?.quality_tier ?? 'STANDARD') as QualityTier,
    badgeKey: data?.badge_key ?? null,
    memberRateKey: data?.member_rate_key ?? 'rate_standard',

    balance,
    reserved: data?.wallet?.reserved ?? 0,
    creditsPerUsd,
    balanceUsd: creditsPerUsd ? balance / creditsPerUsd : 0,

    firstTopupAvailable: !!data?.first_topup_promo_available,

    forProduct,
    includedRemaining: useCallback((code: string) => forProduct(code)?.included_remaining ?? 0, [forProduct]),
    tierFor: useCallback(
      (code: string) => (forProduct(code)?.quality_tier ?? data?.quality_tier ?? 'STANDARD') as QualityTier,
      [forProduct, data],
    ),
    resultCeiling: useCallback((code: string) => forProduct(code)?.result_ceiling ?? null, [forProduct]),
    canUse: useCallback((code: string) => {
      const p = forProduct(code);
      if (!p) return false;
      // An included run is always available even with PAYG switched off.
      return p.included_remaining > 0 || p.payg_available;
    }, [forProduct]),
    wouldChargeCredits: useCallback((code: string) => {
      const p = forProduct(code);
      return !!p && p.included_remaining <= 0;
    }, [forProduct]),

    refresh: load,
  };
}
