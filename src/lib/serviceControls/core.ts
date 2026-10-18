// SERVICE CONTROL CENTER — what the customer interface shows for every manageable
// HOMATCH service. Inventory: docs/claude/SERVICE_CONTROLS_INVENTORY.md.
//
// The source is the public RPC service_controls_public() (migrations 20261109090000,
// 20261110090000); the owner flips it in Admin → Service Control Center. Hiding is
// presentation: every backend boundary refuses on its own
// (supabase/functions/_shared/serviceControl.ts).
//
// TWO DEFAULTS, matching the server's two fail modes:
//   * PAUSED_BY_DEFAULT (the original six): HIDDEN UNTIL PROVEN VISIBLE. Before the first
//     answer, and whenever it cannot be read, they count as hidden.
//   * LIVE_BY_DEFAULT (every other product): visible unless an answer says OFF, so an
//     unreadable control never makes Verify or Find Property disappear. The store seeds
//     them from the last answer this browser saw (see index.ts), so a paused one does not
//     flash in before the first answer arrives.
//
// HIDDEN_UNTIL_ANSWERED is a presentation rule only (the backend fail mode above is
// unchanged): the Brokers directory and the Broker desk are not shown — in a menu, a
// card or at their address — until THIS page load has read the switches. Neither a
// remembered answer nor an unreadable one brings them back (owner, 2026-10-18).

export const PAUSED_BY_DEFAULT = ['publishing', 'ai_call_center', 'ai_talk', 'whatsapp', 'live_chat', 'design_studio'] as const;
export const LIVE_BY_DEFAULT = [
  'find_property', 'find_property_deep', 'find_buyers',
  'verify', 'contracts', 'mortgage', 'investment', 'for_expats',
  'meta_ads', 'email_campaigns', 'ai_assistant',
  'brokers_directory', 'broker_desk', 'developers',
] as const;
export const SERVICE_KEYS = [...PAUSED_BY_DEFAULT, ...LIVE_BY_DEFAULT] as const;
export const HIDDEN_UNTIL_ANSWERED = ['brokers_directory', 'broker_desk'] as const;
export type ServiceKey = typeof SERVICE_KEYS[number];
export interface ServiceVisibility { frontend: boolean; backend: boolean }
export type ServiceSnapshot = { loaded: boolean; services: Record<ServiceKey, ServiceVisibility> };

const OFF: ServiceVisibility = { frontend: false, backend: false };
const ON: ServiceVisibility = { frontend: true, backend: true };
const LIVE = new Set<string>(LIVE_BY_DEFAULT);
const UNTIL_ANSWERED = new Set<string>(HIDDEN_UNTIL_ANSWERED);
export const isLiveByDefault = (k: ServiceKey) => LIVE.has(k);
/** May this service's page render before the switches are read? */
export const shownBeforeAnswer = (k: ServiceKey) => LIVE.has(k) && !UNTIL_ANSWERED.has(k);

/** Before any answer: the six and the two broker services hidden, every other live product shown. */
export const HIDDEN_SNAPSHOT: ServiceSnapshot = {
  loaded: false,
  services: Object.fromEntries(SERVICE_KEYS.map((k) => [k, shownBeforeAnswer(k) ? ON : OFF])) as Record<ServiceKey, ServiceVisibility>,
};

export const isServiceKey = (v: unknown): v is ServiceKey => typeof v === 'string' && (SERVICE_KEYS as readonly string[]).includes(v);

/** Rows from service_controls_public() → a snapshot. A missing or malformed row keeps its default. */
export function toSnapshot(rows: unknown): ServiceSnapshot {
  const services = { ...HIDDEN_SNAPSHOT.services };
  if (Array.isArray(rows)) {
    // A real answer: a broker service without a row is live, like every live product.
    for (const k of HIDDEN_UNTIL_ANSWERED) services[k] = ON;
    for (const r of rows as Array<Record<string, unknown>>) {
      if (!isServiceKey(r?.service_key)) continue;
      const backend = r.backend_enabled === true;
      // Visible only while it can also run: the database forbids the other pair,
      // and the interface never trusts a value it could not store.
      services[r.service_key] = { backend, frontend: backend && r.frontend_enabled === true };
    }
  }
  // Any answer is an answer: a malformed one leaves every service at its default, but
  // loaded, so a gated page shows "unavailable" rather than waiting forever.
  return { loaded: true, services };
}

/** The live products' part of a snapshot, as remembered between visits. */
export function liveVisibility(snapshot: ServiceSnapshot): Record<string, boolean> {
  return Object.fromEntries(LIVE_BY_DEFAULT.filter(shownBeforeAnswer).map((k) => [k, snapshot.services[k].frontend]));
}

/**
 * The starting snapshot: the defaults, with the live products as this browser last saw
 * them. The six and the two broker services are never taken from memory: they stay
 * hidden until a fresh answer.
 */
export function initialSnapshot(remembered: unknown): ServiceSnapshot {
  const services = { ...HIDDEN_SNAPSHOT.services };
  if (remembered && typeof remembered === 'object') {
    for (const k of LIVE_BY_DEFAULT.filter(shownBeforeAnswer)) {
      const v = (remembered as Record<string, unknown>)[k];
      if (v === false) services[k] = OFF;
    }
  }
  return { loaded: false, services };
}

type Fetcher = () => Promise<{ data: unknown; error: unknown }>;

/** A tiny store: one fetch shared by every subscriber, refreshed on demand and on a timer. */
/* After an unreadable answer the store asks again soon, then leaves it to the regular
   refresh: a transient error on page load must not keep a paused live product mounted
   until the 60-second refresh (seen in CI, 2026-10-17). */
export const RETRY_AFTER_UNREADABLE_MS: readonly number[] = [1_500, 4_000, 10_000];

export function createServiceControlStore(fetcher: Fetcher, opts: {
  initial?: ServiceSnapshot;
  remember?: (s: ServiceSnapshot) => void;
  /** Injected for tests; defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => void;
} = {}) {
  let snapshot: ServiceSnapshot = opts.initial ?? HIDDEN_SNAPSHOT;
  let inflight: Promise<void> | null = null;
  let failures = 0;
  const schedule = opts.schedule ?? ((fn: () => void, ms: number) => { setTimeout(fn, ms); });
  const failed = () => {
    snapshot = unreadable();
    const delay = RETRY_AFTER_UNREADABLE_MS[failures];
    failures += 1;
    if (delay !== undefined) schedule(() => { void refresh(); }, delay);
  };
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  // An unreadable answer: the six go (or stay) hidden; a live product keeps what was last
  // known about it, so an outage neither hides it nor brings back one the owner paused.
  // The two broker services start hidden, so before a fresh answer they stay hidden.
  const unreadable = (): ServiceSnapshot => ({
    loaded: true,
    services: { ...snapshot.services, ...Object.fromEntries(PAUSED_BY_DEFAULT.map((k) => [k, OFF])) } as Record<ServiceKey, ServiceVisibility>,
  });
  const refresh = () => {
    if (inflight) return inflight;
    inflight = fetcher()
      .then(({ data, error }) => {
        if (error) { failed(); return; }
        failures = 0;
        snapshot = toSnapshot(data);
        opts.remember?.(snapshot);
      })
      .catch(() => { failed(); })
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
