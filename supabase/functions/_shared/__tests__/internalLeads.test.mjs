// HOMATCH Leads — the unlock request the edge function accepts, and the error codes it
// may return. The money rules themselves are proven in tests/sql/run-homatch-leads.sh.
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnlockRequest, unlockErrorCode, MAX_UNLOCK_SELECTION } from '../internalLeads.ts';

const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';

test('a valid selection is deduplicated and keeps its idempotency key', () => {
  const r = parseUnlockRequest({ action: 'unlock', matchIds: [A, B, A.toUpperCase()], idempotencyKey: 'ilu:abc12345' });
  assert.deepEqual(r, { ok: true, matchIds: [A, B], idempotencyKey: 'ilu:abc12345', expectedCredits: null });
});

test('the confirmed total travels with the unlock; a bad one is refused', () => {
  const ok = parseUnlockRequest({ action: 'unlock', matchIds: [A], idempotencyKey: 'ilu:abc12345', expectedCredits: 5 });
  assert.equal(ok.ok && ok.expectedCredits, 5);
  for (const bad of [-1, Number.NaN, '5']) {
    assert.deepEqual(parseUnlockRequest({ action: 'unlock', matchIds: [A], idempotencyKey: 'ilu:abc12345', expectedCredits: bad }), { ok: false, error: 'INVALID_REQUEST' });
  }
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

test('curated leads: ids or "all matching" by filter, a confirmed price, a key; never the database in the request', async () => {
  const { parseCuratedUnlockRequest, MAX_CURATED_IDS } = await import('../internalLeads.ts');
  const key = 'clu:abc12345';
  const ok = parseCuratedUnlockRequest({ ids: [A, A.toUpperCase(), B], expectedCredits: 2, idempotencyKey: key });
  assert.deepEqual(ok, { ok: true, idempotencyKey: key, selection: { ids: [A, B], expectedCredits: 2 } });
  const all = parseCuratedUnlockRequest({ allMatching: true, filters: { countries: ['DE'], interests: ['BUY'], evil: 'x' }, exclude: [A], expectedCredits: 40, idempotencyKey: key });
  assert.deepEqual(all.selection, { allMatching: true, filters: { countries: ['DE'], interests: ['BUY'] }, exclude: [A], expectedCredits: 40 }, 'unknown filter keys dropped');
  assert.equal(parseCuratedUnlockRequest({ ids: [A], idempotencyKey: key }).error, 'INVALID_REQUEST', 'a confirmed price is required');
  assert.equal(parseCuratedUnlockRequest({ ids: [A], expectedCredits: 1 }).error, 'IDEMPOTENCY_KEY_REQUIRED');
  assert.equal(parseCuratedUnlockRequest({ ids: ['x'], expectedCredits: 1, idempotencyKey: key }).error, 'INVALID_REQUEST');
  assert.equal(parseCuratedUnlockRequest({ ids: [], expectedCredits: 0, idempotencyKey: key }).error, 'NOTHING_SELECTED');
  const many = Array.from({ length: MAX_CURATED_IDS + 1 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
  assert.equal(parseCuratedUnlockRequest({ ids: many, expectedCredits: 600, idempotencyKey: key }).error, 'TOO_MANY_SELECTED', 'big selections go by filter');
});
