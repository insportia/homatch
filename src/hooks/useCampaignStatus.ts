// The authoritative Find Buyers / Find Tenants campaign state for one
// property, read from the server (find_buyers_campaign_status) and polled
// only while the campaign is live. A remount, a refresh or a second tab reads
// the same server state; nothing here starts, restarts or invents a search.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getCampaignStatus, type CampaignStatus } from '@/services/findBuyers';

const LIVE_MS = 5_000;
const PAUSED_MS = 20_000;

export function useCampaignStatus(propertyId: string | undefined) {
  const [status, setStatus] = useState<CampaignStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    if (!propertyId) return null;
    const next = await getCampaignStatus(propertyId).catch(() => null);
    if (alive.current && next) setStatus(next);
    if (alive.current) setLoaded(true);
    return next;
  }, [propertyId]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => { alive.current = false; };
  }, [refresh]);

  const state = status?.campaign?.state ?? null;
  const live = Boolean(status?.campaign?.active);
  useEffect(() => {
    if (!live) return undefined;
    const every = state === 'PAUSED' ? PAUSED_MS : LIVE_MS;
    const timer = window.setInterval(() => {
      /* A hidden tab does not poll; the search itself continues on the server. */
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      void refresh();
    }, every);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [live, state, refresh]);

  return { status, loaded, refresh };
}
