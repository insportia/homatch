// HOMATCH Leads — request validation and error mapping for the internal-leads edge
// function. Pure: no Deno APIs, so node:test covers it.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_UNLOCK_SELECTION = 200;

export type UnlockRequest =
  | { ok: true; matchIds: string[]; idempotencyKey: string }
  | { ok: false; error: 'INVALID_REQUEST' | 'NOTHING_SELECTED' | 'TOO_MANY_SELECTED' | 'IDEMPOTENCY_KEY_REQUIRED' };

/** Validate { action:'unlock', matchIds, idempotencyKey }; dedupe the selection. */
export function parseUnlockRequest(body: unknown): UnlockRequest {
  if (!body || typeof body !== 'object') return { ok: false, error: 'INVALID_REQUEST' };
  const b = body as Record<string, unknown>;
  if (b.action !== undefined && b.action !== 'unlock') return { ok: false, error: 'INVALID_REQUEST' };
  if (!Array.isArray(b.matchIds)) return { ok: false, error: 'INVALID_REQUEST' };
  const ids = [...new Set(b.matchIds.filter((x): x is string => typeof x === 'string' && UUID.test(x)).map((x) => x.toLowerCase()))];
  if (ids.length !== new Set(b.matchIds.map((x) => String(x).toLowerCase())).size) return { ok: false, error: 'INVALID_REQUEST' };
  if (ids.length === 0) return { ok: false, error: 'NOTHING_SELECTED' };
  if (ids.length > MAX_UNLOCK_SELECTION) return { ok: false, error: 'TOO_MANY_SELECTED' };
  const key = typeof b.idempotencyKey === 'string' ? b.idempotencyKey.trim() : '';
  if (key.length < 8 || key.length > 120 || !/^[A-Za-z0-9:_\-.]+$/.test(key)) return { ok: false, error: 'IDEMPOTENCY_KEY_REQUIRED' };
  return { ok: true, matchIds: ids, idempotencyKey: key };
}

const KNOWN = ['INSUFFICIENT_CREDITS', 'PRODUCT_DISABLED', 'PRODUCT_KILL_SWITCH', 'PAYG_DISABLED', 'NOTHING_SELECTED',
  'TOO_MANY_SELECTED', 'IDEMPOTENCY_KEY_REQUIRED', 'CREDIT_ACCOUNT_NOT_FOUND', 'SERVICE_DISABLED', 'PRICE_CHANGED', 'NOT_FOUND'] as const;
export type UnlockErrorCode = (typeof KNOWN)[number] | 'INTERNAL';

/** Map a Postgres error message to a stable code; never echo internals to the client. */
export function unlockErrorCode(message: string | null | undefined): UnlockErrorCode {
  const m = String(message ?? '');
  for (const k of KNOWN) if (m.includes(k)) return k;
  return 'INTERNAL';
}

/* ── External Leads Database (curated_leads_unlock) ───────────────────────── */

export const MAX_CURATED_IDS = 500;
const FILTER_KEYS = ['countries', 'languages', 'interests', 'channels', 'categories', 'sources', 'q', 'addedSince', 'verifiedSince', 'location'];

export type CuratedUnlockRequest =
  | { ok: true; selection: Record<string, unknown>; idempotencyKey: string }
  | { ok: false; error: 'INVALID_REQUEST' | 'NOTHING_SELECTED' | 'TOO_MANY_SELECTED' | 'IDEMPOTENCY_KEY_REQUIRED' };

/**
 * Validate { kind:'curated_leads', ids | allMatching+filters (+exclude), expectedCredits, idempotencyKey }.
 * "All matching" travels as the filter, never as a list of the database: the server resolves it.
 * expectedCredits is the price the customer confirmed; the server refuses a bigger charge.
 */
export function parseCuratedUnlockRequest(body: unknown): CuratedUnlockRequest {
  if (!body || typeof body !== 'object') return { ok: false, error: 'INVALID_REQUEST' };
  const b = body as Record<string, unknown>;
  const key = typeof b.idempotencyKey === 'string' ? b.idempotencyKey.trim() : '';
  if (key.length < 8 || key.length > 120 || !/^[A-Za-z0-9:_\-.]+$/.test(key)) return { ok: false, error: 'IDEMPOTENCY_KEY_REQUIRED' };
  const expected = typeof b.expectedCredits === 'number' && Number.isFinite(b.expectedCredits) && b.expectedCredits >= 0 ? b.expectedCredits : null;
  if (expected === null) return { ok: false, error: 'INVALID_REQUEST' };
  const list = (v: unknown) => (Array.isArray(v) ? v : []);
  const valid = (v: unknown) => list(v).every((x) => typeof x === 'string' && UUID.test(x));
  const uuids = (v: unknown) => [...new Set(list(v).map((x) => String(x).toLowerCase()))];
  if (b.allMatching === true) {
    const raw = (b.filters && typeof b.filters === 'object' && !Array.isArray(b.filters) ? b.filters : {}) as Record<string, unknown>;
    const filters = Object.fromEntries(Object.entries(raw).filter(([k]) => FILTER_KEYS.includes(k)));
    if (!valid(b.exclude)) return { ok: false, error: 'INVALID_REQUEST' };
    const exclude = uuids(b.exclude);
    if (exclude.length > 5000) return { ok: false, error: 'TOO_MANY_SELECTED' };
    return { ok: true, idempotencyKey: key, selection: { allMatching: true, filters, exclude, expectedCredits: expected } };
  }
  if (!Array.isArray(b.ids) || !valid(b.ids)) return { ok: false, error: 'INVALID_REQUEST' };
  const ids = uuids(b.ids);
  if (ids.length === 0) return { ok: false, error: 'NOTHING_SELECTED' };
  if (ids.length > MAX_CURATED_IDS) return { ok: false, error: 'TOO_MANY_SELECTED' };
  return { ok: true, idempotencyKey: key, selection: { ids, expectedCredits: expected } };
}

/* ── Mortgage-interested buyers (mortgage_leads_unlock) ──────────────────────── */

export const MAX_MORTGAGE_REFS = 100;

export type MortgageUnlockRequest =
  | { ok: true; propertyId: string; refs: string[]; idempotencyKey: string; expectedCredits: number }
  | { ok: false; error: 'INVALID_REQUEST' | 'NOTHING_SELECTED' | 'TOO_MANY_SELECTED' | 'IDEMPOTENCY_KEY_REQUIRED' };

/**
 * Validate { kind:'mortgage_leads', propertyId, refs, expectedCredits, idempotencyKey }.
 * refs are the opaque preview handles, never user ids. expectedCredits is the total the
 * customer confirmed; the server refuses to charge more.
 */
export function parseMortgageUnlockRequest(body: unknown): MortgageUnlockRequest {
  if (!body || typeof body !== 'object') return { ok: false, error: 'INVALID_REQUEST' };
  const b = body as Record<string, unknown>;
  const key = typeof b.idempotencyKey === 'string' ? b.idempotencyKey.trim() : '';
  if (key.length < 8 || key.length > 120 || !/^[A-Za-z0-9:_\-.]+$/.test(key)) return { ok: false, error: 'IDEMPOTENCY_KEY_REQUIRED' };
  if (typeof b.propertyId !== 'string' || !UUID.test(b.propertyId)) return { ok: false, error: 'INVALID_REQUEST' };
  const expected = typeof b.expectedCredits === 'number' && Number.isFinite(b.expectedCredits) && b.expectedCredits >= 0 ? b.expectedCredits : null;
  if (expected === null) return { ok: false, error: 'INVALID_REQUEST' };
  if (!Array.isArray(b.refs) || !b.refs.every((x) => typeof x === 'string' && UUID.test(x))) return { ok: false, error: 'INVALID_REQUEST' };
  const refs = [...new Set((b.refs as string[]).map((x) => x.toLowerCase()))];
  if (refs.length === 0) return { ok: false, error: 'NOTHING_SELECTED' };
  if (refs.length > MAX_MORTGAGE_REFS) return { ok: false, error: 'TOO_MANY_SELECTED' };
  return { ok: true, propertyId: b.propertyId.toLowerCase(), refs, idempotencyKey: key, expectedCredits: expected };
}
