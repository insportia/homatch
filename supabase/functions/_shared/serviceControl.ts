// SERVICE CONTROL CENTER — the server-side kill switch for the six pausable services.
//
// Every execution boundary of publishing, ai_call_center, ai_talk, whatsapp,
// live_chat and design_studio asks `serviceBackendEnabled(db, key)` before it
// starts NEW work: a job, a session, a send, a paid provider call, a credit
// reservation, a retry. Off → refuse with SERVICE_DISABLED; nothing else runs.
//
// Source of truth: public.service_controls (migration 20261109090000), read with
// the service role. This is an extra gate IN FRONT of each service's own settings
// (ai_talk_enabled, outreach_calling_enabled, …) — those are never changed here.
//
// FAIL CLOSED: if the row cannot be read (missing table, network, bad value) the
// service counts as disabled. Only the six services above are ever gated, so a
// failed read never affects another product.
//
// PROPAGATION: one query per warm isolate at most every CACHE_MS (10 s); an Admin
// change is honoured everywhere within that window. A failed read is retried
// after ERROR_CACHE_MS so an outage is not a query storm.

export const SERVICE_KEYS = ['publishing', 'ai_call_center', 'ai_talk', 'whatsapp', 'live_chat', 'design_studio'] as const;
export type ServiceKey = typeof SERVICE_KEYS[number];
export const SERVICE_DISABLED = 'SERVICE_DISABLED';
export const CACHE_MS = 10_000;
export const ERROR_CACHE_MS = 2_000;

export interface ServiceState { frontend: boolean; backend: boolean }
interface Snapshot { at: number; ok: boolean; rows: Map<string, ServiceState> }

let snapshot: Snapshot | null = null;

/** For tests: forget the cached snapshot. */
export function resetServiceControlCache() { snapshot = null; }

async function load(db: any, now: number): Promise<Snapshot> {
  if (snapshot && now - snapshot.at < (snapshot.ok ? CACHE_MS : ERROR_CACHE_MS)) return snapshot;
  const rows = new Map<string, ServiceState>();
  let ok = false;
  try {
    const { data, error } = await db.from('service_controls').select('service_key,frontend_enabled,backend_enabled');
    if (!error && Array.isArray(data)) {
      for (const r of data) {
        if (typeof r?.service_key === 'string') rows.set(r.service_key, { frontend: r.frontend_enabled === true, backend: r.backend_enabled === true });
      }
      ok = true;
    } else {
      console.error('service-control', 'state unreadable', error?.code ?? 'unknown');
    }
  } catch {
    console.error('service-control', 'state unreadable', 'exception');
  }
  snapshot = { at: now, ok, rows };
  return snapshot;
}

/** The effective state of one service. Unreadable or unknown → both OFF. */
export async function serviceState(db: any, key: ServiceKey, now = Date.now()): Promise<ServiceState> {
  const s = await load(db, now);
  return s.rows.get(key) ?? { frontend: false, backend: false };
}

/** May this service start new work right now? Fails closed. */
export async function serviceBackendEnabled(db: any, key: ServiceKey, now = Date.now()): Promise<boolean> {
  return (await serviceState(db, key, now)).backend;
}

/** The machine-readable refusal; the frontend maps the code to localized copy. */
export function serviceDisabledBody(key: ServiceKey) {
  return { code: SERVICE_DISABLED, error: SERVICE_DISABLED, service: key };
}

/** A ready-made 503 for handlers that build their own Response. */
export function serviceDisabledResponse(key: ServiceKey, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(serviceDisabledBody(key)), {
    status: 503,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });
}
