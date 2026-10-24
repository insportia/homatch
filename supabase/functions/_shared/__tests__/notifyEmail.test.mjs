// Notification email: claim before send, one idempotency key per delivery,
// 4xx (except 429) is permanent, 429 and 5xx are retried, and the email leg can
// run after the response.

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyResendStatus, deliverWithRetry, resendIdempotencyKey, retryDelayMs, runAfterResponse,
  sendNotificationEmail, MAX_SEND_ATTEMPTS,
} from '../notifyEmail.ts';

const CONTENT = { subject: 'Subject', html: '<p>x</p>', text: 'x' };
const noSleep = async () => {};

test('retry classification: 2xx sent, 429 and 5xx and no answer retried, other 4xx permanent', () => {
  assert.equal(classifyResendStatus(200), 'SENT');
  assert.equal(classifyResendStatus(202), 'SENT');
  assert.equal(classifyResendStatus(429), 'RETRY');
  assert.equal(classifyResendStatus(500), 'RETRY');
  assert.equal(classifyResendStatus(503), 'RETRY');
  assert.equal(classifyResendStatus(null), 'RETRY');
  assert.equal(classifyResendStatus(undefined), 'RETRY');
  for (const s of [400, 401, 403, 404, 409, 422]) assert.equal(classifyResendStatus(s), 'PERMANENT', String(s));
});

test('idempotency key: stable per delivery id, distinct across deliveries, within Resend\'s limit', () => {
  const a = resendIdempotencyKey('11111111-1111-4111-8111-111111111111');
  assert.equal(a, resendIdempotencyKey('11111111-1111-4111-8111-111111111111'));
  assert.notEqual(a, resendIdempotencyKey('22222222-2222-4222-8222-222222222222'));
  assert.ok(resendIdempotencyKey('x'.repeat(1000)).length <= 256);
});

test('backoff grows and a Retry-After is honoured up to 5 s', () => {
  assert.equal(retryDelayMs(0), 400);
  assert.equal(retryDelayMs(1), 1200);
  assert.equal(retryDelayMs(0, '2'), 2000);
  assert.equal(retryDelayMs(0, '60'), 5000);
  assert.equal(retryDelayMs(1, 'nonsense'), 1200);
});

function fakeFetch(statuses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url, init });
    const s = statuses[Math.min(calls.length - 1, statuses.length - 1)];
    if (s === 'NETWORK') throw new Error('network down');
    return { ok: s >= 200 && s < 300, status: s, headers: { get: () => null }, json: async () => (s < 300 ? { id: 'msg_1' } : { message: `status ${s}` }) };
  };
  return { impl, calls };
}

test('a 4xx is not retried; a 5xx or 429 is, always under the same idempotency key', async () => {
  const bad = fakeFetch([422]);
  const r1 = await deliverWithRetry('k', 'idem-1', {}, { fetchImpl: bad.impl, sleep: noSleep });
  assert.equal(r1.outcome, 'PERMANENT');
  assert.equal(bad.calls.length, 1);

  const flaky = fakeFetch([503, 429, 200]);
  const r2 = await deliverWithRetry('k', 'idem-2', {}, { fetchImpl: flaky.impl, sleep: noSleep });
  assert.equal(r2.outcome, 'SENT');
  assert.equal(r2.providerMessageId, 'msg_1');
  assert.equal(flaky.calls.length, 3);
  assert.deepEqual(flaky.calls.map((c) => c.init.headers['Idempotency-Key']), ['idem-2', 'idem-2', 'idem-2']);

  const down = fakeFetch(['NETWORK']);
  const r3 = await deliverWithRetry('k', 'idem-3', {}, { fetchImpl: down.impl, sleep: noSleep });
  assert.equal(r3.outcome, 'RETRY');
  assert.equal(down.calls.length, MAX_SEND_ATTEMPTS);
});

/* In-memory notification_deliveries with the migration's unique (notification_id, channel). */
function fakeDb() {
  const deliveries = [];
  const from = (name) => {
    const filters = [];
    let patch = null;
    const rows = () => (name === 'notification_deliveries' ? deliveries : name === 'users' ? [{ id: 'u', email: 'person@example.com' }] : []);
    const hit = () => rows().filter((r) => filters.every(([k, v]) => r[k] === v));
    const q = {
      select() { return q; },
      eq(k, v) { filters.push([k, v]); return q; },
      async maybeSingle() { return { data: hit()[0] ?? null, error: null }; },
      update(p) { patch = p; return q; },
      then(res, rej) {
        if (patch) for (const r of hit()) Object.assign(r, patch);
        return Promise.resolve({ data: null, error: null }).then(res, rej);
      },
      async insert(row) {
        if (row.notification_id && deliveries.some((d) => d.notification_id === row.notification_id && d.channel === row.channel)) {
          return { error: { message: 'duplicate key value violates unique constraint' } };
        }
        deliveries.push({ ...row }); return { error: null };
      },
    };
    return q;
  };
  return { from, deliveries };
}

test('claim before send: QUEUED first, then SENT, with the delivery id as the idempotency key', async () => {
  globalThis.Deno = { env: { get: (k) => (k === 'RESEND_API_KEY' ? 're_test' : undefined) } };
  const db = fakeDb();
  const f = fakeFetch([200]);
  const seen = [];
  const impl = async (url, init) => { seen.push(db.deliveries.map((d) => d.status).join(',')); return f.impl(url, init); };
  const r = await sendNotificationEmail(db, { userId: 'u', notificationId: 'n1', source: 'transactional', content: CONTENT }, { fetchImpl: impl, sleep: noSleep });
  assert.equal(r.status, 'SENT');
  assert.deepEqual(seen, ['QUEUED'], 'the row was QUEUED while the provider was called');
  assert.equal(db.deliveries.length, 1);
  assert.equal(db.deliveries[0].status, 'SENT');
  assert.equal(db.deliveries[0].provider_message_id, 'msg_1');
  assert.equal(f.calls[0].init.headers['Idempotency-Key'], resendIdempotencyKey(db.deliveries[0].id));
});

test('two concurrent runs for one notification send exactly once', async () => {
  globalThis.Deno = { env: { get: (k) => (k === 'RESEND_API_KEY' ? 're_test' : undefined) } };
  const db = fakeDb();
  const f = fakeFetch([200]);
  const [a, b] = await Promise.all([
    sendNotificationEmail(db, { userId: 'u', notificationId: 'n2', content: CONTENT }, { fetchImpl: f.impl, sleep: noSleep }),
    sendNotificationEmail(db, { userId: 'u', notificationId: 'n2', content: CONTENT }, { fetchImpl: f.impl, sleep: noSleep }),
  ]);
  assert.equal(f.calls.length, 1, 'one provider call');
  assert.deepEqual([a.status, b.status].sort(), ['SENT', 'SKIPPED']);
  assert.equal(db.deliveries.length, 1);
  const again = await sendNotificationEmail(db, { userId: 'u', notificationId: 'n2', content: CONTENT }, { fetchImpl: f.impl, sleep: noSleep });
  assert.equal(again.reason, 'ALREADY_ATTEMPTED');
  assert.equal(f.calls.length, 1, 'a retried run sends nothing');
});

test('a permanent 4xx is recorded FAILED after one attempt, and never re-sent', async () => {
  globalThis.Deno = { env: { get: (k) => (k === 'RESEND_API_KEY' ? 're_test' : undefined) } };
  const db = fakeDb();
  const f = fakeFetch([403]);
  const r = await sendNotificationEmail(db, { userId: 'u', notificationId: 'n3', content: CONTENT }, { fetchImpl: f.impl, sleep: noSleep });
  assert.equal(r.status, 'FAILED');
  assert.match(r.reason, /^PERMANENT HTTP 403/);
  assert.equal(f.calls.length, 1);
  assert.equal(db.deliveries[0].status, 'FAILED');
  await sendNotificationEmail(db, { userId: 'u', notificationId: 'n3', content: CONTENT }, { fetchImpl: f.impl, sleep: noSleep });
  assert.equal(f.calls.length, 1);
});

test('the email leg runs after the response when the edge runtime offers waitUntil', async () => {
  const taken = [];
  globalThis.EdgeRuntime = { waitUntil: (p) => taken.push(p) };
  try {
    assert.equal(runAfterResponse(Promise.resolve(1)), true);
    assert.equal(taken.length, 1);
  } finally {
    delete globalThis.EdgeRuntime;
  }
  assert.equal(runAfterResponse(Promise.resolve(1)), false, 'no runtime: the caller awaits');
});
