import test from 'node:test';
import assert from 'node:assert/strict';
import { SupabasePublishingStore } from '../src/supabase-store.mjs';
function setup(result, status = 200) {
  const calls = [];
  const store = new SupabasePublishingStore({
    url: 'https://example.supabase.co',
    serviceKey: 'test-worker-key',
    fetchImpl: async (url, init) => {
      calls.push({ url, ...init });
      return { ok: status < 300, status, json: async () => result };
    },
  });
  return { store, calls };
}
const fence = { jobId: 'j1', leaseToken: 'token1' };
test('store claims exactly one leased job and maps durable fields', async () => {
  const s = setup([
    {
      id: 'j1',
      state: 'running',
      lease_token: 'token1',
      user_id: 'u1',
      portal_id: 'myhome',
      account_id: 'a1',
      operation: 'publish',
      attempts: 2,
      max_attempts: 3,
      submission_started: true,
    },
  ]);
  const job = await s.store.claim({ workerId: 'w1', leaseMs: 120000 });
  assert.equal(job.userId, 'u1');
  assert.equal(job.submissionStarted, true);
  assert.equal(job.leaseToken, 'token1');
  assert.deepEqual(JSON.parse(s.calls[0].body), {
    p_worker: 'w1',
    p_lease_seconds: 120,
  });
});
test('empty queue returns null', async () =>
  assert.equal(
    await setup([]).store.claim({ workerId: 'w1', leaseMs: 120000 }),
    null,
  ));
test('malformed and unfenced claim is refused', async () => {
  for (const result of [{}, [{}], [{ id: 'a', state: 'queued' }], [{}, {}]])
    await assert.rejects(
      setup(result).store.claim({ workerId: 'w', leaseMs: 120000 }),
      /INVALID_CLAIM/,
    );
});
test('all worker writes include exact lease fencing', async () => {
  const s = setup(true);
  await s.store.heartbeat(fence, 120000);
  await s.store.event(fence, { phase: 'submitting', submissionStarted: true });
  await s.store.allowed(fence, 'myhome');
  await s.store.finish(fence, { state: 'retry', code: 'EXECUTION_FAILED' });
  assert.ok(
    s.calls.every((call) => {
      const data = JSON.parse(call.body);
      return data.p_job === 'j1' && data.p_token === 'token1';
    }),
  );
});
test('server errors never expose response body or worker credential', async () => {
  const s = setup({ message: 'secret OTP 123456' }, 403);
  await assert.rejects(
    s.store.allowed(fence, 'myhome'),
    (error) => error.message === 'PUBLISHER_DATABASE_403',
  );
});
test('finish only transports publication-safe allowlisted result fields', async () => {
  const s = setup(true);
  await s.store.finish(fence, {
    state: 'succeeded',
    result: {
      externalId: '123',
      externalUrl: 'https://myhome.ge/123',
      status: 'published',
      cookies: ['secret'],
      otp: '123456',
    },
  });
  assert.ok(!s.calls[0].body.includes('cookies'));
  assert.ok(!s.calls[0].body.includes('123456'));
});
test('context fails closed when mapping is missing', async () =>
  await assert.rejects(setup(null).store.context(fence), /UNAVAILABLE/));
test('insecure remote database URLs and empty credentials fail startup', () => {
  assert.throws(
    () =>
      new SupabasePublishingStore({
        url: 'http://remote.example',
        serviceKey: 'k',
      }),
    /INSECURE/,
  );
  assert.throws(
    () => new SupabasePublishingStore({ url: 'https://example.supabase.co' }),
    /MISSING/,
  );
});
