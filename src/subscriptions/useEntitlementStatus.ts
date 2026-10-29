import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { type EntitlementStatus, type FeatureCode, type FeatureStatus, getEntitlementStatus } from './service';

/*
 * What this account may do now, from entitlement_status_for_me(). One short-lived shared copy so a
 * page and the shell do not each ask; `refresh()` after any change (a run finished, a payment).
 * A failed read is `null`, never a guessed "free" or "unlimited".
 */
let cache: { userId: string; at: number; value: EntitlementStatus } | null = null;
let inflight: Promise<EntitlementStatus> | null = null;
const TTL_MS = 30_000;

export function invalidateEntitlementStatus() { cache = null; }

export function useEntitlementStatus() {
  const { homatchUser } = useAuth();
  const userId = homatchUser?.id ?? null;
  const [status, setStatus] = useState<EntitlementStatus | null>(cache && cache.userId === userId ? cache.value : null);
  const [loading, setLoading] = useState(!status && !!userId);

  const load = useCallback(async (force = false) => {
    if (!userId) { setStatus(null); setLoading(false); return; }
    if (!force && cache && cache.userId === userId && Date.now() - cache.at < TTL_MS) { setStatus(cache.value); setLoading(false); return; }
    setLoading(true);
    try {
      inflight = inflight ?? getEntitlementStatus();
      const v = await inflight;
      cache = { userId, at: Date.now(), value: v };
      setStatus(v);
    } catch {
      setStatus(null);
    } finally {
      inflight = null;
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { void load(); }, [load]);
  return { status, loading, refresh: () => load(true) };
}

export function featureOf(status: EntitlementStatus | null, feature: FeatureCode): FeatureStatus | null {
  return status?.features.find((f) => f.feature === feature) ?? null;
}
