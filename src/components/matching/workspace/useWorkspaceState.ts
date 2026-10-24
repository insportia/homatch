// The workspace switches (matching_workspace_state), kept current without a deploy:
// read on mount, when the tab regains focus or becomes visible, and every 60 s — so an
// administrator's change applies to open tabs and a stale tab corrects itself. A server call
// answered SERVICE_DISABLED calls refresh() too.

import { useCallback, useEffect, useRef, useState } from 'react';
import { getWorkspaceState, UNKNOWN_STATE, type WorkspaceState } from '@/services/matchingWorkspace';

export const STATE_REFRESH_MS = 60_000;

export function useWorkspaceState() {
  const [state, setState] = useState<WorkspaceState>(UNKNOWN_STATE);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const next = await getWorkspaceState();
      if (!alive.current) return;
      /* Same answer → same object: no re-render, no refetch of the lists. */
      setState((cur) => (JSON.stringify(cur) === JSON.stringify(next) ? cur : next));
      setFailed(false);
    } catch {
      if (alive.current) setFailed(true);
    } finally {
      if (alive.current) setLoaded(true);
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const onFocus = () => { void refresh(); };
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => { void refresh(); }, STATE_REFRESH_MS);
    return () => {
      alive.current = false;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [refresh]);

  return { state, loaded, failed, refresh };
}
