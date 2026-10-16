import { useEffect, useSyncExternalStore } from 'react';
import { supabase } from '@/db/supabase';
import { createServiceControlStore, type ServiceKey, type ServiceSnapshot } from './core';
import { serviceForPath } from './routes';

export * from './core';

/** How often an open tab re-reads the switches (plus on focus). */
export const REFRESH_MS = 60_000;

export const serviceControlStore = createServiceControlStore(async () => {
  const { data, error } = await supabase.rpc('service_controls_public');
  return { data, error };
});

let started = false;
function ensureStarted() {
  if (started || typeof window === 'undefined') return;
  started = true;
  void serviceControlStore.refresh();
  window.setInterval(() => { void serviceControlStore.refresh(); }, REFRESH_MS);
  window.addEventListener('focus', () => { void serviceControlStore.refresh(); });
}

/** The whole snapshot (re-renders when the owner's switches change). */
export function useServiceControls(): ServiceSnapshot {
  useEffect(ensureStarted, []);
  return useSyncExternalStore(serviceControlStore.subscribe, serviceControlStore.get, serviceControlStore.get);
}

/** Is this service shown to customers right now? Hidden until proven visible. */
export function useServiceVisible(key: ServiceKey): boolean {
  return useServiceControls().services[key].frontend;
}

/**
 * `(path) => boolean`: may a link to this address be offered right now? False only
 * for an address of a paused service (src/lib/serviceControls/routes.ts).
 */
export function usePathAvailable(): (path: string) => boolean {
  const { services } = useServiceControls();
  return (path: string) => {
    const service = serviceForPath(path.split(/[?#]/)[0]);
    return !service || services[service].frontend;
  };
}
