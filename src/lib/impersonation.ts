/*
 * "LOG IN AS USER" — the browser half.
 *
 * WHERE THE ADMIN'S OWN LOGIN GOES WHILE THIS TAB IS SOMEBODY ELSE
 *
 * Nowhere. It stays exactly where supabase-js persisted it (localStorage,
 * under the default key) and is never read, copied or overwritten by this
 * file. An impersonating tab builds its Supabase client with a DIFFERENT
 * storage key backed by memory, seeded with the target's short-lived access
 * token. Exit clears this tab's marker and reloads; the ordinary client then
 * finds the admin's session where it always was. Other tabs are never
 * affected, because the marker lives in sessionStorage, which is per tab.
 *
 * WHAT THE TAB CAN DO
 *
 * Look. The server is the authority — Postgres refuses writes from an
 * impersonation session and the money paths refuse it too — but a screen
 * that let the operator press Pay and then showed a database error would be
 * a bad tool. So the client is also narrowed here: table writes, every edge
 * function except the two a viewer needs, and the RPCs that change something
 * resolve to a READ_ONLY_IMPERSONATION error before any request is made.
 *
 * THE REFRESH TOKEN
 *
 * There is none. impersonate-user never returns it, so this session ends when
 * its access token does (about an hour); the banner counts down and offers
 * Exit, and nothing can silently extend it.
 */

export const IMPERSONATION_STORAGE_KEY = 'homatch.impersonation';
/** The auth storage key the impersonating client uses — never the default. */
export const IMPERSONATION_AUTH_KEY = 'homatch-impersonation-auth';

export interface ImpersonationState {
  session_id: string;
  access_token: string;
  /** Unix seconds. */
  expires_at: number;
  started_at: string;
  reason: string;
  user: Record<string, unknown> & { id: string; email?: string | null };
  target_user: { id: string; email: string | null; full_name: string | null };
}

export function readImpersonation(): ImpersonationState | null {
  try {
    const raw = window.sessionStorage.getItem(IMPERSONATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ImpersonationState;
    if (!parsed?.access_token || !parsed?.session_id || !parsed?.user?.id) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isImpersonating(): boolean {
  return readImpersonation() !== null;
}

export function writeImpersonation(state: ImpersonationState): void {
  window.sessionStorage.setItem(IMPERSONATION_STORAGE_KEY, JSON.stringify(state));
}

export function clearImpersonation(): void {
  try { window.sessionStorage.removeItem(IMPERSONATION_STORAGE_KEY); } catch { /* nothing to clear */ }
}

/**
 * The seeded auth storage for the impersonating client.
 *
 * `refresh_token` is present as an empty string because supabase-js treats a
 * stored session without the property as corrupt; empty means "cannot be
 * refreshed", which is the truth. When the access token expires, the refresh
 * attempt fails, supabase-js drops the session, and the tab is signed out —
 * with the banner still offering Exit.
 */
export function impersonationAuthStorage(state: ImpersonationState) {
  const memory = new Map<string, string>();
  memory.set(IMPERSONATION_AUTH_KEY, JSON.stringify({
    access_token: state.access_token,
    refresh_token: '',
    token_type: 'bearer',
    expires_at: state.expires_at,
    expires_in: Math.max(0, state.expires_at - Math.floor(Date.now() / 1000)),
    user: state.user,
  }));
  return {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => { memory.set(key, value); },
    removeItem: (key: string) => { memory.delete(key); },
  };
}

/* ── what an impersonating tab may call ─────────────────────────────── */

/** Edge functions a viewer needs. Everything else is refused client-side. */
export const IMPERSONATION_ALLOWED_FUNCTIONS: ReadonlySet<string> = new Set([
  'impersonate-user', // Exit (end_self) — the server accepts nothing else from this token
  'storage-sign',     // signed URLs to SEE the account's photos and documents
]);

/**
 * RPCs that only read. Anything not listed is treated as a write and refused
 * in this tab: a new RPC defaults to blocked, which is the safe direction.
 */
export const IMPERSONATION_READ_RPCS: ReadonlySet<string> = new Set([
  'app_content_all',
  'background_job_for_subject',
  'background_job_get',
  'background_jobs_mine',
  'billing_my_budget_choices',
  'billing_my_entitlements',
  'billing_quote_for_me',
  'campaign_language_evidence',
  'dev_is_studio',
  'dev_public_project',
  'dt_building_floors',
  'dt_experience_manifest',
  'dt_floor_units',
  'dt_scene',
  'dt_unit_scene',
  'expat_market_readings',
  'site_get_page',
  'storage_account_summary',
]);

export const READ_ONLY_MESSAGE = 'READ_ONLY_IMPERSONATION: this tab is viewing as another account and cannot change anything.';

export class ReadOnlyImpersonationError extends Error {
  code = 'READ_ONLY_IMPERSONATION';
  constructor() { super(READ_ONLY_MESSAGE); }
}

export function isImpersonationBlockedFunction(name: string, body?: unknown): boolean {
  const base = name.split('?')[0];
  if (!IMPERSONATION_ALLOWED_FUNCTIONS.has(base)) return true;
  /* The impersonated token may only EXIT; starting another session, or
     ending somebody else's, is an admin action. */
  if (base === 'impersonate-user') {
    const action = (body as { action?: unknown } | null | undefined)?.action;
    return action !== 'end_self';
  }
  return false;
}

export function isImpersonationBlockedRpc(name: string): boolean {
  return !IMPERSONATION_READ_RPCS.has(name);
}

/*
 * A stand-in for a PostgREST write builder: every chained call returns itself,
 * and awaiting it yields the read-only error. So `.insert(x).select().single()`
 * fails exactly the way a refused request would, without making one.
 */
function refusedBuilder(): unknown {
  const result = { data: null, error: { message: READ_ONLY_MESSAGE, code: 'READ_ONLY_IMPERSONATION', details: '', hint: '' }, count: null, status: 403, statusText: 'Forbidden' };
  const target = function refused() { /* callable so any chain works */ };
  const proxy: unknown = new Proxy(target, {
    get(_t, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
      if (prop === 'catch' || prop === 'finally') return (fn: () => unknown) => Promise.resolve(result).finally(fn);
      return () => proxy;
    },
    apply() { return proxy; },
  });
  return proxy;
}

type AnyClient = {
  from: (table: string) => unknown;
  rpc: (fn: string, ...rest: unknown[]) => unknown;
  functions: { invoke: (name: string, options?: { body?: unknown }) => Promise<unknown> };
  auth: {
    signOut: (...args: unknown[]) => Promise<unknown>;
    updateUser: (...args: unknown[]) => Promise<unknown>;
  };
};

/** Narrow a client to reading. Called once, on the impersonating client only. */
export function installReadOnlyGuards<T>(client: T): T {
  const c = client as unknown as AnyClient;

  const from = c.from.bind(c);
  c.from = (table: string) => {
    const builder = from(table) as Record<string, unknown>;
    for (const write of ['insert', 'update', 'upsert', 'delete']) {
      builder[write] = () => refusedBuilder();
    }
    return builder;
  };

  const rpc = c.rpc.bind(c);
  c.rpc = (fn: string, ...rest: unknown[]) => (isImpersonationBlockedRpc(fn) ? refusedBuilder() : rpc(fn, ...rest));

  const invoke = c.functions.invoke.bind(c.functions);
  c.functions.invoke = async (name: string, options?: { body?: unknown }) => {
    if (isImpersonationBlockedFunction(name, options?.body)) {
      return { data: null, error: new ReadOnlyImpersonationError() };
    }
    return invoke(name, options);
  };

  /* Storage writes (uploads as the customer) are refused the same way. */
  const storage = (client as unknown as { storage?: { from: (bucket: string) => Record<string, unknown> } }).storage;
  if (storage) {
    const bucket = storage.from.bind(storage);
    storage.from = (name: string) => {
      const api = bucket(name);
      for (const write of ['upload', 'update', 'remove', 'move', 'copy', 'uploadToSignedUrl', 'createSignedUploadUrl']) {
        if (typeof api[write] === 'function') {
          api[write] = async () => ({ data: null, error: new ReadOnlyImpersonationError() });
        }
      }
      return api;
    };
  }

  /* signOut() defaults to scope 'global', which would sign the CUSTOMER out
     of every device they own. In this tab it only forgets the local copy. */
  const signOut = c.auth.signOut.bind(c.auth);
  c.auth.signOut = () => signOut({ scope: 'local' });
  c.auth.updateUser = async () => ({ data: { user: null }, error: new ReadOnlyImpersonationError() });

  return client;
}
