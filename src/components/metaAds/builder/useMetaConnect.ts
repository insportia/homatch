// The Connect / Reconnect Meta button and the return trip — one instance of
// the flow for the whole tab (connectFlow.ts is the state machine).
//
//   · A tap shows its spinner at once; further taps are ignored until the
//     attempt ends (a module-level lock, so two panels cannot both start one).
//   · Meta's dialog opens in the same tab. The way back (draft + step) is
//     sealed in the signed state by the server; localStorage is only a spare.
//   · Back from Meta with the browser's back button (bfcache) unlocks it.
//   · On return, ONE canonical refresh — permissions, assets, the lead check
//     (assets_refresh) — shared by every component that asks, then the URL
//     loses its ?connect= so a reload does not repeat anything.
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { mockConnect, refreshMetaAssets, startMetaOAuth } from '@/services/metaAds';
import { browserKind, connectResultOf, CONNECT_BUSY, nextConnect, type ConnectState } from '@/lib/metaAds/connectFlow';

export const RETURN_KEY = 'homatch_meta_return_to';

let shared: ConnectState = 'IDLE';
const listeners = new Set<(s: ConnectState) => void>();
const set = (s: ConnectState) => { shared = s; listeners.forEach((l) => l(s)); };

if (typeof window !== 'undefined') {
  window.addEventListener('pageshow', (e) => { if ((e as PageTransitionEvent).persisted) set(nextConnect(shared, { type: 'PAGE_RESTORED' })); });
}

export function useMetaConnect(opts: { returnTo?: string | null; onMockConnected?: () => void | Promise<void> } = {}) {
  const [state, setState] = useState<ConnectState>(shared);
  useEffect(() => { listeners.add(setState); return () => { listeners.delete(setState); }; }, []);

  const connect = useCallback(async (): Promise<string | null> => {
    if (CONNECT_BUSY.has(shared)) return null; // one attempt at a time
    set(nextConnect(shared, { type: 'TAP' }));
    try {
      const r = await startMetaOAuth(opts.returnTo ?? null);
      if (r.url) {
        try { if (opts.returnTo) localStorage.setItem(RETURN_KEY, opts.returnTo); } catch { /* the signed state carries it */ }
        set(nextConnect(shared, { type: 'URL' }));
        window.location.assign(r.url);
        return null;
      }
      if (r.mockConnect) {
        await mockConnect();
        set(nextConnect(shared, { type: 'MOCK_DONE' }));
        await opts.onMockConnected?.();
        return 'ok';
      }
      set(nextConnect(shared, { type: 'ERROR' }));
      return 'error';
    } catch (e) {
      set(nextConnect(shared, { type: 'ERROR' }));
      return String((e as { code?: string })?.code ?? 'error');
    }
  }, [opts.returnTo, opts.onMockConnected]);

  return { state, busy: CONNECT_BUSY.has(state), connect, browser: typeof navigator !== 'undefined' ? browserKind(navigator.userAgent) : 'BROWSER' as const };
}

/* One refresh per return, however many components mount. */
let refreshFor: string | null = null;
let refreshing: Promise<void> | null = null;

/**
 * Reads ?connect= once after Meta's callback: refreshes the connection ONCE,
 * reports the result, and removes the parameter. Returns the result to show.
 */
export function useConnectReturn(reload: () => Promise<void> | void, enabled = true): { result: ReturnType<typeof connectResultOf>; refreshing: boolean } {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const raw = params.get('connect');
  const [result, setResult] = useState<ReturnType<typeof connectResultOf>>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const r = connectResultOf(raw);
    if (!r || !enabled) return;
    set(nextConnect(shared, { type: 'RETURNED', result: r }));
    setResult(r);
    try { localStorage.removeItem(RETURN_KEY); } catch { /* fine */ }
    const key = `${location.pathname}${location.search}`;
    if (r === 'ok' && refreshFor !== key) {
      refreshFor = key;
      setBusy(true);
      refreshing = (async () => {
        await refreshMetaAssets().catch(() => undefined);
        await reload();
      })().finally(() => { refreshing = null; setBusy(false); });
    } else if (r === 'ok' && refreshing) {
      setBusy(true);
      void refreshing.finally(() => setBusy(false));
    }
    params.delete('connect');
    const q = params.toString();
    navigate({ pathname: location.pathname, search: q ? `?${q}` : '' }, { replace: true });
  }, [raw]); // eslint-disable-line react-hooks/exhaustive-deps

  return { result, refreshing: busy };
}
