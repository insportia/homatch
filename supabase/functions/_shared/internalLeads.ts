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
  'TOO_MANY_SELECTED', 'IDEMPOTENCY_KEY_REQUIRED', 'CREDIT_ACCOUNT_NOT_FOUND'] as const;
export type UnlockErrorCode = (typeof KNOWN)[number] | 'INTERNAL';

/** Map a Postgres error message to a stable code; never echo internals to the client. */
export function unlockErrorCode(message: string | null | undefined): UnlockErrorCode {
  const m = String(message ?? '');
  for (const k of KNOWN) if (m.includes(k)) return k;
  return 'INTERNAL';
}
