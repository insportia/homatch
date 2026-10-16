// HOMATCH Leads — the unlock request the edge function accepts, and the error codes it
// may return. The money rules themselves are proven in tests/sql/run-homatch-leads.sh.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnlockRequest, unlockErrorCode, MAX_UNLOCK_SELECTION } from '../internalLeads.ts';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';

test('a valid selection is deduplicated and keeps its idempotency key', () => {
  const r = parseUnlockRequest({ action: 'unlock', matchIds: [A, B, A.toUpperCase()], idempotencyKey: 'ilu:abc12345' });
  assert.deepEqual(r, { ok: true, matchIds: [A, B], idempotencyKey: 'ilu:abc12345' });
});

test('anything malformed is refused before it reaches the wallet', () => {
  assert.equal(parseUnlockRequest(null).ok, false);
  assert.deepEqual(parseUnlockRequest({ matchIds: [], idempotencyKey: 'ilu:abc12345' }), { ok: false, error: 'NOTHING_SELECTED' });
  assert.deepEqual(parseUnlockRequest({ matchIds: ['not-a-uuid'], idempotencyKey: 'ilu:abc12345' }), { ok: false, error: 'INVALID_REQUEST' });
  assert.deepEqual(parseUnlockRequest({ matchIds: [A, 'x'], idempotencyKey: 'ilu:abc12345' }), { ok: false, error: 'INVALID_REQUEST' });
  assert.deepEqual(parseUnlockRequest({ matchIds: [A] }), { ok: false, error: 'IDEMPOTENCY_KEY_REQUIRED' });
  assert.deepEqual(parseUnlockRequest({ matchIds: [A], idempotencyKey: 'short' }), { ok: false, error: 'IDEMPOTENCY_KEY_REQUIRED' });
  assert.deepEqual(parseUnlockRequest({ matchIds: [A], idempotencyKey: 'ilu:<script>' }), { ok: false, error: 'IDEMPOTENCY_KEY_REQUIRED' });
  assert.deepEqual(parseUnlockRequest({ action: 'refund', matchIds: [A], idempotencyKey: 'ilu:abc12345' }), { ok: false, error: 'INVALID_REQUEST' });
  const many = Array.from({ length: MAX_UNLOCK_SELECTION + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  assert.deepEqual(parseUnlockRequest({ matchIds: many, idempotencyKey: 'ilu:abc12345' }), { ok: false, error: 'TOO_MANY_SELECTED' });
});

test('database errors map to stable codes and never leak internals', () => {
  assert.equal(unlockErrorCode('INSUFFICIENT_CREDITS'), 'INSUFFICIENT_CREDITS');
  assert.equal(unlockErrorCode('P0001: PRODUCT_DISABLED'), 'PRODUCT_DISABLED');
  assert.equal(unlockErrorCode('relation "x" does not exist'), 'INTERNAL');
  assert.equal(unlockErrorCode(undefined), 'INTERNAL');
});
