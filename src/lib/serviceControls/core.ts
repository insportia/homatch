// SERVICE CONTROL CENTER — what the customer interface shows for the six pausable
// services (publishing, ai_call_center, ai_talk, whatsapp, live_chat, design_studio).
//
// The source is the public RPC service_controls_public() (migration 20261109090000);
// the owner flips it in Admin → Service Control Center. Hiding is presentation: every
// backend boundary refuses on its own (supabase/functions/_shared/serviceControl.ts).
//
// HIDDEN UNTIL PROVEN VISIBLE: before the first answer, and whenever it cannot be read,
// all six count as hidden. Nothing else in the product is affected by this module.

export const SERVICE_KEYS = ['publishing', 'ai_call_center', 'ai_talk', 'whatsapp', 'live_chat', 'design_studio'] as const;
export type ServiceKey = typeof SERVICE_KEYS[number];
export interface ServiceVisibility { frontend: boolean; backend: boolean }
export type ServiceSnapshot = { loaded: boolean; services: Record<ServiceKey, ServiceVisibility> };

const OFF: ServiceVisibility = { frontend: false, backend: false };
export const HIDDEN_SNAPSHOT: ServiceSnapshot = {
  loaded: false,
  services: Object.fromEntries(SERVICE_KEYS.map((k) => [k, OFF])) as Record<ServiceKey, ServiceVisibility>,
};

export const isServiceKey = (v: unknown): v is ServiceKey => typeof v === 'string' && (SERVICE_KEYS as readonly string[]).includes(v);

/** Rows from service_controls_public() → a snapshot. Anything malformed stays hidden. */
export function toSnapshot(rows: unknown): ServiceSnapshot {
  const services = { ...HIDDEN_SNAPSHOT.services };
  if (Array.isArray(rows)) {
    for (const r of rows as Array<Record<string, unknown>>) {
      if (!isServiceKey(r?.service_key)) continue;
      const backend = r.backend_enabled === true;
      // Visible only while it can also run: the database forbids the other pair,
      // and the interface never trusts a value it could not store.
      services[r.service_key] = { backend, frontend: backend && r.frontend_enabled === true };
    }
  }
  // Any answer is an answer: a malformed one leaves everything hidden, but loaded, so a
  // gated page shows "unavailable" rather than waiting forever.
  return { loaded: true, services };
}

type Fetcher = () => Promise<{ data: unknown; error: unknown }>;

/** A tiny store: one fetch shared by every subscriber, refreshed on demand and on a timer. */
export function createServiceControlStore(fetcher: Fetcher) {
  let snapshot: ServiceSnapshot = HIDDEN_SNAPSHOT;
  let inflight: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  const refresh = () => {
    if (inflight) return inflight;
    inflight = fetcher()
      .then(({ data, error }) => { snapshot = error ? { ...HIDDEN_SNAPSHOT, loaded: true } : toSnapshot(data); })
      .catch(() => { snapshot = { ...HIDDEN_SNAPSHOT, loaded: true }; })
      .finally(() => { inflight = null; emit(); });
    return inflight;
  };
  return {
    get: () => snapshot,
    refresh,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
