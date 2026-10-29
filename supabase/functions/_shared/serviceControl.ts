// SERVICE CONTROL CENTER — the server-side switch for every manageable HOMATCH service.
//
// Every execution boundary of a controlled service asks `serviceBackendEnabled(db, key)`
// before it starts NEW work: a job, a session, a send, a paid provider call, a credit
// reservation, a retry. Off → refuse with SERVICE_DISABLED; nothing else runs.
// Inventory of services and boundaries: docs/claude/SERVICE_CONTROLS_INVENTORY.md.
//
// Source of truth: public.service_controls (migrations 20261109090000, 20261110090000),
// read with the service role. This is an extra gate IN FRONT of each service's own
// settings (ai_talk_enabled, find_property_social_enabled, meta_ads_*, …) — those are
// never changed here.
//
// TWO FAIL MODES, because the services are in two different situations:
//   * PAUSED_BY_DEFAULT (the original six, paused by the owner): FAIL CLOSED. If the
//     row cannot be read the service counts as disabled.
//   * PAID_CLOSED_BY_DEFAULT (paid Deep Search, paused by the owner 2026-10-18): FAIL
//     CLOSED as well. Money is spent only on an explicit ON row; an unreadable or missing
//     row never starts a paid campaign or a provider run.
//   * every other service is a live product: FAIL OPEN. If the control table cannot be
//     read, or the row is missing (code deployed before its migration), it keeps
//     running, so an outage of this table never takes Verify or Find Property down.
// An explicit OFF row is honoured in both modes.
//
// PROPAGATION: one query per warm isolate at most every CACHE_MS (10 s); an Admin
// change is honoured everywhere within that window. A failed read is retried
// after ERROR_CACHE_MS so an outage is not a query storm.

/** Paused by the owner when the Service Control Center shipped: fail closed. */
export const PAUSED_BY_DEFAULT = ['publishing', 'ai_call_center', 'ai_talk', 'whatsapp', 'live_chat', 'design_studio'] as const;
/** Live products added with the expansion: fail open. */
export const LIVE_BY_DEFAULT = [
  'find_property', 'find_buyers', 'internal_matching', 'curated_leads',
  'verify', 'contracts', 'mortgage', 'investment', 'for_expats',
  'meta_ads', 'email_campaigns', 'ai_assistant',
  'brokers_directory', 'broker_desk', 'developers',
] as const;
/** Paid, paused by the owner (find_property_deep 2026-10-18; find_buyers_external — the legacy Apify /
    Actor discovery campaigns — 2026-10-24; email_marketing — email campaigns, Email Studio, email
    plans, sending domains and CRM inbox replies, hidden 2026-10-29): fail closed, like the six.
    The historic `email_campaigns` key governs SMS campaigns only since 2026-10-29. */
export const PAID_CLOSED_BY_DEFAULT = ['find_property_deep', 'find_buyers_external', 'email_marketing'] as const;
export const SERVICE_KEYS = [...PAUSED_BY_DEFAULT, ...LIVE_BY_DEFAULT, ...PAID_CLOSED_BY_DEFAULT] as const;
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

const LIVE = new Set<string>(LIVE_BY_DEFAULT);
/** What a service counts as when its row cannot be read: OFF for the six and paid Deep Search, ON for a live product. */
export function defaultState(key: ServiceKey): ServiceState {
  return LIVE.has(key) ? { frontend: true, backend: true } : { frontend: false, backend: false };
}

/** The effective state of one service. Unreadable or missing → its default (see above). */
export async function serviceState(db: any, key: ServiceKey, now = Date.now()): Promise<ServiceState> {
  const s = await load(db, now);
  return s.rows.get(key) ?? defaultState(key);
}

/** May this service start new work right now? */
export async function serviceBackendEnabled(db: any, key: ServiceKey, now = Date.now()): Promise<boolean> {
  return (await serviceState(db, key, now)).backend;
}

/**
 * The same question for a function that holds only the CALLER's client (no service
 * role, by design): read through the public RPC service_controls_public(), which every
 * signed-in user may call. Same defaults as above; no shared cache (one small read).
 */
export async function serviceBackendEnabledForCaller(db: any, key: ServiceKey): Promise<boolean> {
  try {
    const { data, error } = await db.rpc('service_controls_public');
    if (!error && Array.isArray(data)) {
      const row = data.find((r: any) => r?.service_key === key);
      if (row) return row.backend_enabled === true;
    } else {
      console.error('service-control', 'state unreadable', error?.code ?? 'unknown');
    }
  } catch {
    console.error('service-control', 'state unreadable', 'exception');
  }
  return defaultState(key).backend;
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
