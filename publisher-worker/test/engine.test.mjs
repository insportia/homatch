import test from 'node:test';
import assert from 'node:assert/strict';
import { PublishingEngine } from '../src/engine.mjs';
function setup(overrides = {}) {
  const writes = [];
  const calls = [];
  const job = { id: 'j1', portalId: 'myhome', userId: 'u1', accountId: 'a1', operation: 'publish', leaseToken: 'lease1', attempts: 1, maxAttempts: 3, ...overrides };
  const result = { externalId: '123', externalUrl: 'https://www.myhome.ge/listing/123', status: 'awaiting_moderation' };
  const store = {
    claim: async () => job,
    allowed: async () => true,
    heartbeat: async () => true,
    event: async (fence, data) => { writes.push({ fence, ...data }); return true; },
    context: async () => ({ userId: 'u1', accountId: 'a1', listing: { ownerId: 'u1' }, externalId: '123', expectedExternalVersion: 'v1' }),
    finish: async (fence, data) => { writes.push({ fence, ...data }); return true; },
  };
  const adapter = {
    getCapabilities: () => ({ permission: 'verified', operations: { publish: true, update: true, remove: true, status: true } }),
    validateListing: async () => [],
    reconcile: async () => ({ state: 'unknown' }),
    publish: async () => { calls.push('publish'); return result; },
    update: async () => { calls.push('update'); return result; },
    remove: async () => { calls.push('remove'); return { ...result, status: 'removed' }; },
    getStatus: async () => { calls.push('status'); return result; },
  };
  const engine = new PublishingEngine({ store, adapters: new Map([['myhome', adapter]]), workerId: 'w1' });
  return { engine, store, adapter, writes, calls, result };
}
test('successful operation persists actual portal result under lease fencing', async () => {
  const s = setup(); await s.engine.tick();
  assert.deepEqual(s.calls, ['publish']);
  assert.deepEqual(s.writes.at(-1).result, s.result);
  assert.ok(s.writes.every(w => w.fence.leaseToken === 'lease1'));
  assert.ok(s.writes.some(w => w.phase === 'submitting' && w.submissionStarted));
});
test('no claim means no browser operation', async () => {
  const s = setup(); s.store.claim = async () => null;
  assert.equal(await s.engine.tick(), false); assert.deepEqual(s.calls, []);
});
test('kill switch prevents portal execution', async () => {
  const s = setup(); s.store.allowed = async () => false; await s.engine.tick();
  assert.deepEqual(s.calls, []); assert.equal(s.writes.at(-1).code, 'PORTAL_DISABLED');
});
test('unverified automation permission fails closed', async () => {
  const s = setup(); s.adapter.getCapabilities = () => ({ permission: 'pending', operations: { publish: true } });
  await s.engine.tick(); assert.deepEqual(s.calls, []); assert.equal(s.writes.at(-1).state, 'action_required');
});
test('invalid mapping blocks submit', async () => {
  const s = setup(); s.adapter.validateListing = async () => [{ field: 'rooms', code: 'required' }];
  await s.engine.tick(); assert.deepEqual(s.calls, []); assert.equal(s.writes.at(-1).code, 'VALIDATION_FAILED');
});
test('worker cannot execute with another owners context', async () => {
  const s = setup(); s.store.context = async () => ({ userId: 'u2', accountId: 'a1', listing: { ownerId: 'u2' } });
  await s.engine.tick(); assert.deepEqual(s.calls, []);
});
test('ambiguous timeout never causes automatic duplicate publication', async () => {
  const s = setup(); s.adapter.publish = async () => { s.calls.push('publish'); throw new Error('secret OTP 123456'); };
  await s.engine.tick(); assert.deepEqual(s.calls, ['publish']);
  assert.equal(s.writes.at(-1).state, 'action_required');
  assert.ok(!JSON.stringify(s.writes).includes('123456'));
});
test('crashed accepted submission reconciles without creating again', async () => {
  const s = setup({ submissionStarted: true });
  s.adapter.reconcile = async () => ({ state: 'found', result: s.result });
  await s.engine.tick(); assert.deepEqual(s.calls, []); assert.equal(s.writes.at(-1).state, 'succeeded');
});
test('unknown external state after crash requires owner action', async () => {
  const s = setup({ submissionStarted: true }); await s.engine.tick();
  assert.deepEqual(s.calls, []); assert.equal(s.writes.at(-1).state, 'action_required');
});
test('verified absence permits recovery within retry budget', async () => {
  const s = setup({ submissionStarted: true }); s.adapter.reconcile = async () => ({ state: 'absent_verified' });
  await s.engine.tick(); assert.deepEqual(s.calls, ['publish']);
});
test('updates never fall back to publish when missing external mapping', async () => {
  const s = setup({ operation: 'update' });
  s.store.context = async () => ({ userId: 'u1', accountId: 'a1', listing: { ownerId: 'u1' } });
  await s.engine.tick(); assert.deepEqual(s.calls, []); assert.equal(s.writes.at(-1).code, 'CONFLICT');
});
test('lease loss prevents executing and committing results', async () => {
  const s = setup(); s.store.event = async () => false; await s.engine.tick();
  assert.deepEqual(s.calls, []); assert.deepEqual(s.writes, []);
});
test('pre-submit transient error gets bounded retry', async () => {
  const s = setup(); s.store.context = async () => { throw new Error('unavailable'); };
  await s.engine.tick(); assert.equal(s.writes.at(-1).state, 'retry'); assert.ok(s.writes.at(-1).availableAt);
});
test('exhausted retry budget produces dead letter', async () => {
  const s = setup({ attempts: 3 }); s.store.context = async () => { throw new Error('unavailable'); };
  await s.engine.tick(); assert.equal(s.writes.at(-1).state, 'dead_letter');
});
test('invalid success payload is never reported published', async () => {
  const s = setup(); s.adapter.publish = async () => ({ status: 'published' });
  await s.engine.tick(); assert.equal(s.writes.at(-1).state, 'action_required');
});
