// One external search run, read from the server by its id
// (find_buyers_my_campaign) and polled only while it is live. The page that
// uses this is addressable: a refresh, Back/Forward or a second tab reads the
// same server state, and nothing here starts, restarts or invents a search.
import { useCallback, useEffect, useRef, useState } from 'react';
import { getCampaignRun, type CampaignRun } from '@/services/findBuyers';

const LIVE_MS = 4_000;
const PAUSED_MS = 20_000;

export function useCampaignRun(jobId: string | undefined) {
  const [run, setRun] = useState<CampaignRun | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const alive = useRef(true);
  const current = useRef<CampaignRun | null>(null);

  const refresh = useCallback(async () => {
    if (!jobId) return null;
    const next = await getCampaignRun(jobId).catch(() => null);
    if (!alive.current) return next;
    /* A failed poll keeps the last good read; only a first read that finds nothing is "missing". */
    if (next) { current.current = next; setRun(next); setMissing(false); } else if (!current.current) setMissing(true);
    setLoaded(true);
    return next;
  }, [jobId]);

  useEffect(() => {
    alive.current = true;
    current.current = null;
    setRun(null);
    setLoaded(false);
    setMissing(false);
    void refresh();
    return () => { alive.current = false; };
  }, [refresh]);

  const state = run?.status.campaign?.state ?? null;
  const live = Boolean(run?.status.campaign?.active);
  useEffect(() => {
    if (!live) return undefined;
    const every = state === 'PAUSED' ? PAUSED_MS : LIVE_MS;
    const timer = window.setInterval(() => {
      /* A hidden tab does not poll; the search itself continues on the server. */
      if (document.visibilityState === 'hidden') return;
      void refresh();
    }, every);
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
  }, [live, state, refresh]);

  return { run, loaded, missing, refresh };
}
