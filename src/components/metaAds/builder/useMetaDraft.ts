// The campaign draft as the builder edits it.
//
// Edits land in local state immediately (the page never waits on the network
// to reflect a keystroke) and are saved to the ONE draft row after a short
// pause. Saving is serialised, so two quick edits can never race each other
// into the database out of order, and a pending save is flushed before the
// customer moves step. There is exactly one row per draft: this hook only
// ever updates the row it was given, it never inserts.
import { useCallback, useEffect, useRef, useState } from 'react';
import { updateMetaDraft, type MetaCampaignRow } from '@/services/metaAds';

export type SaveState = 'saved' | 'saving' | 'error';

export function useMetaDraft(initial: MetaCampaignRow | null) {
  const [campaign, setCampaign] = useState<MetaCampaignRow | null>(initial);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [saveError, setSaveError] = useState<string | null>(null);
  const pending = useRef<Partial<MetaCampaignRow>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const idRef = useRef<string | null>(initial?.id ?? null);

  useEffect(() => { setCampaign(initial); idRef.current = initial?.id ?? null; }, [initial]);

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const patch = pending.current;
    const id = idRef.current;
    if (!id || Object.keys(patch).length === 0) return chain.current;
    pending.current = {};
    setSaveState('saving');
    chain.current = chain.current.then(async () => {
      try {
        await updateMetaDraft(id, patch);
        setSaveState(Object.keys(pending.current).length ? 'saving' : 'saved');
        setSaveError(null);
      } catch (e) {
        // Keep the unsaved fields so the next flush retries them.
        pending.current = { ...patch, ...pending.current };
        setSaveState('error');
        setSaveError(String((e as { message?: string })?.message ?? 'save_failed'));
      }
    });
    return chain.current;
  }, []);

  /* keepPreflight: a field outside what the HOMATCH check approves (the
     owner's brief) — the server's launch fingerprint ignores it too. */
  const patch = useCallback((p: Partial<MetaCampaignRow>, opts: { immediate?: boolean; keepPreflight?: boolean } = {}) => {
    setCampaign((c) => (c ? ({ ...c, ...p, ...(opts.keepPreflight ? {} : { preflight: null }) } as MetaCampaignRow) : c));
    pending.current = { ...pending.current, ...p };
    setSaveState('saving');
    if (timer.current) clearTimeout(timer.current);
    if (opts.immediate) void flush();
    else timer.current = setTimeout(() => { void flush(); }, 600);
  }, [flush]);

  // Never lose the last edit on unmount or tab close.
  useEffect(() => {
    const onHide = () => { void flush(); };
    window.addEventListener('pagehide', onHide);
    return () => { window.removeEventListener('pagehide', onHide); void flush(); };
  }, [flush]);

  return { campaign, setCampaign, patch, flush, saveState, saveError };
}
