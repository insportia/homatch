// BACKEND BROWSER AUTOMATION — what the HOMATCH browser worker can do on each
// portal, how sure we are, and how a worker outcome changes a publication. Pure.
//
// The worker (official-worker/src/publishing) runs real Chromium against the
// portal UI through the HOMATCH account's session. Its adapters carry the same
// capability table (official-worker/src/publishing/capabilities.json); a parity
// test keeps the two identical.
//
// VERIFICATION LEVELS — never upgraded by assertion:
//   NOT_EXPLORED               no recorded workflow / selectors; the operation is not attempted
//   FIXTURE_TESTED             selectors from the owner's MCP exploration, exercised against
//                              local fixture pages only — not yet against the live portal
//   LIVE_NAVIGATION_VERIFIED   reached the live form with a real session, nothing submitted
//   LIVE_OPERATION_VERIFIED    performed for real on the live portal with the owner's approval
//
// An operation runs when its level is not NOT_EXPLORED AND the owner switched
// automation on for that portal's account. The final "publish" click additionally
// needs the owner's separate live-submit approval; without it CREATE stops at
// PREPARED and the publication falls back to the admin queue.

import type { ProviderId } from './providers.ts';

export const OP_KINDS = ['CREATE', 'STATUS', 'UPDATE', 'PRICE', 'DESCRIPTION', 'PHOTOS', 'PAUSE', 'REACTIVATE', 'DELETE', 'CHECK_SESSION'] as const;
export type OpKind = typeof OP_KINDS[number];
export type Level = 'NOT_EXPLORED' | 'FIXTURE_TESTED' | 'LIVE_NAVIGATION_VERIFIED' | 'LIVE_OPERATION_VERIFIED';

const NONE: Record<OpKind, Level> = Object.fromEntries(OP_KINDS.map((k) => [k, 'NOT_EXPLORED'])) as Record<OpKind, Level>;
const RECORDED = { ...NONE, CHECK_SESSION: 'FIXTURE_TESTED', CREATE: 'FIXTURE_TESTED', STATUS: 'FIXTURE_TESTED' } as Record<OpKind, Level>;

/** Mirrors official-worker/src/publishing/capabilities.json (parity-tested). */
export const BROWSER_CAPABILITIES: Record<ProviderId, Record<OpKind, Level>> = {
  myhome: RECORDED,
  ssge: RECORDED,
  placege: NONE, homege: NONE, brokeri: NONE, korter: NONE, binebi: NONE, allhome: NONE,
};

export const levelOf = (portal: string, kind: OpKind): Level => BROWSER_CAPABILITIES[portal as ProviderId]?.[kind] ?? 'NOT_EXPLORED';
export const runnable = (portal: string, kind: OpKind) => levelOf(portal, kind) !== 'NOT_EXPLORED';
/** Whether the portal has a browser adapter that can create listings at all. */
export const hasBrowserCreate = (portal: string) => runnable(portal, 'CREATE');

/** The domains a portal session may hold cookies for — anything else is dropped before sealing. */
export function cleanStorageState(raw: unknown, domains: string[]): { state: { cookies: unknown[]; origins: unknown[] } } | { error: string } {
  if (!raw || typeof raw !== 'object') return { error: 'SESSION_INVALID' };
  const r = raw as { cookies?: unknown; origins?: unknown };
  if (!Array.isArray(r.cookies) || !Array.isArray(r.origins ?? [])) return { error: 'SESSION_INVALID' };
  const onPortal = (host: string) => {
    const h = String(host || '').replace(/^\./, '').toLowerCase();
    return domains.some((d) => h === d || h.endsWith(`.${d}`));
  };
  const cookies = r.cookies.filter((c: any) => c && typeof c.name === 'string' && typeof c.value === 'string' && onPortal(c.domain));
  const origins = ((r.origins ?? []) as any[]).filter((o) => {
    try { return onPortal(new URL(String(o?.origin)).hostname) && Array.isArray(o.localStorage); } catch { return false; }
  });
  if (!cookies.length) return { error: 'SESSION_HAS_NO_PORTAL_COOKIES' };
  const state = { cookies, origins };
  if (JSON.stringify(state).length > 512_000) return { error: 'SESSION_TOO_LARGE' };
  return { state };
}

/** The earliest cookie expiry of the session (seconds since epoch → ISO), or null for session cookies only. */
export function sessionExpiry(state: { cookies: any[] }): string | null {
  const times = state.cookies.map((c) => Number(c.expires)).filter((t) => Number.isFinite(t) && t > 0);
  return times.length ? new Date(Math.min(...times) * 1000).toISOString() : null;
}

export type Outcome = 'SUCCEEDED' | 'PREPARED' | 'FAILED' | 'BLOCKED' | 'RECONCILIATION_REQUIRED' | 'QUEUED';

/**
 * What a finished operation means for its publication. `null`: nothing changes
 * (a retry is queued, or a management operation whose failure leaves the
 * publication as it is — the admin queue still shows it as outdated).
 */
export function publicationEffect(kind: OpKind, status: Outcome, error: string | null):
  | { type: 'LINK' }
  | { type: 'FALLBACK'; to: 'ADMIN_ACTION_REQUIRED' | 'AUTH_REQUIRED'; code: string }
  | { type: 'CHECK' }
  | { type: 'UPDATED' }
  | null {
  if (status === 'QUEUED') return null;
  if (error === 'AUTH_REQUIRED' && (kind === 'CREATE')) return { type: 'FALLBACK', to: 'AUTH_REQUIRED', code: 'SESSION_EXPIRED' };
  if (kind === 'CREATE') {
    if (status === 'SUCCEEDED') return { type: 'LINK' };
    if (status === 'PREPARED') return { type: 'FALLBACK', to: 'ADMIN_ACTION_REQUIRED', code: 'AUTOMATION_PREPARED_NOT_SUBMITTED' };
    if (status === 'RECONCILIATION_REQUIRED') return { type: 'FALLBACK', to: 'ADMIN_ACTION_REQUIRED', code: 'RECONCILIATION_REQUIRED' };
    return { type: 'FALLBACK', to: 'ADMIN_ACTION_REQUIRED', code: error || 'AUTOMATION_FAILED' };
  }
  if (kind === 'STATUS' && status === 'SUCCEEDED') return { type: 'CHECK' };
  if (kind === 'DELETE' && status === 'SUCCEEDED') return { type: 'CHECK' };
  if (['UPDATE', 'PRICE', 'DESCRIPTION', 'PHOTOS'].includes(kind) && status === 'SUCCEEDED') return { type: 'UPDATED' };
  return null;
}

/** Which management operation a listing edit needs on an already-published portal copy. */
export function syncKind(before: Record<string, any> | null, after: Record<string, any>): OpKind | null {
  if (!before) return 'UPDATE';
  const changed = (k: string) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null);
  const keys = Object.keys({ ...before, ...after }).filter(changed).filter((k) => k !== 'portalTargets');
  if (!keys.length) return null;
  if (keys.every((k) => k === 'price' || k === 'currency')) return 'PRICE';
  if (keys.every((k) => k === 'description')) return 'DESCRIPTION';
  if (keys.every((k) => k === 'photos')) return 'PHOTOS';
  return 'UPDATE';
}
