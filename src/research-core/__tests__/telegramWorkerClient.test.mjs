// THE MTPROTO_USER CLIENT: edge side of the official worker's /telegram/* API.
//
// The worker's own suite (official-worker/test/telegramGateway.test.mjs)
// proves the session rules. This one proves the CONTRACT: that what the
// worker sends back is read strictly, that its typed failures arrive as the
// same TelegramError kinds every other client produces, and that a response
// that is not the agreed shape is refused rather than guessed at.
import test from 'node:test';
import assert from 'node:assert/strict';

import { WorkerTelegramClient } from '../adapters/telegram/worker-client.ts';
import { TelegramError, planRetry } from '../adapters/telegram/client.ts';

function fakeFetch(routes) {
  const seen = [];
  const impl = async (url, init) => {
    const path = new URL(url).pathname + new URL(url).search;
    seen.push({ path, init });
    const handler = routes[path.split('?')[0]];
    if (!handler) return new Response('nope', { status: 404 });
    const [status, body] = handler(JSON.parse(init.body ?? '{}'), init);
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return { impl, seen };
}

const client = (routes, extra = {}) => {
  const f = fakeFetch(routes);
  return { c: new WorkerTelegramClient({ baseUrl: 'https://worker.test/', token: 'tok', trace: 'job-1', fetchImpl: f.impl, ...extra }), f };
};

test('history: parsed strictly, token and trace sent, publication date preserved', async () => {
  const { c, f } = client({
    '/telegram/history': (body) => [200, { ok: true, result: {
      items: [{ id: '42', chatId: '1001', date: 1790000000, editDate: 1790000500, text: 'ищу квартиру в Ваке', fromChannel: false, authorUsername: 'seeker' }],
      nextCursor: '42', hasMore: true,
    } }],
  });
  const page = await c.readHistory('tbilisikvartiri', { cursor: null, limit: 50 });
  assert.equal(page.items[0].date, 1790000000);
  assert.equal(page.items[0].editDate, 1790000500);
  assert.equal(page.hasMore, true);
  const sent = f.seen[0];
  assert.equal(sent.init.headers.Authorization, 'Bearer tok');
  assert.equal(sent.init.headers['x-homatch-trace'], 'job-1');
  assert.deepEqual(JSON.parse(sent.init.body), { username: 'tbilisikvartiri', cursor: null, limit: 50 });
});

test('typed worker failures become the same TelegramError kinds; FLOOD_WAIT keeps its seconds', async () => {
  const { c } = client({
    '/telegram/history': () => [200, { ok: false, error: { kind: 'RATE_LIMITED', message: 'FLOOD_WAIT_ACTIVE', retryAfterSeconds: 90 } }],
  });
  await assert.rejects(c.readHistory('x_chat', { cursor: null, limit: 5 }), (e) => {
    assert.ok(e instanceof TelegramError);
    assert.equal(e.kind, 'RATE_LIMITED');
    assert.equal(e.retryAfterSeconds, 90);
    assert.equal(planRetry(e, 0).delayMs, 90_000);
    return true;
  });
});

test('unknown kinds and malformed shapes are refused, not guessed', async () => {
  const { c } = client({
    '/telegram/history': () => [200, { ok: true, result: { items: [{ id: '1', text: 'no date' }] } }],
    '/telegram/search': () => [200, { ok: false, error: { kind: 'SOMETHING_NEW' } }],
  });
  await assert.rejects(c.readHistory('x_chat', { cursor: null, limit: 5 }), (e) => e.kind === 'MALFORMED_RESPONSE');
  await assert.rejects(c.searchPublicChats('rent', 5), (e) => e.kind === 'MALFORMED_RESPONSE');
});

test('transport: 401 is AUTH_FAILED, 404 means an old worker without Telegram, no URL means NOT_CONFIGURED', async () => {
  const { c } = client({ '/telegram/resolve': () => [401, { error: 'unauthorized' }] });
  await assert.rejects(c.resolveChat('abcd'), (e) => e.kind === 'AUTH_FAILED');
  await assert.rejects(c.searchPublicChats('abcd', 3), (e) => e.kind === 'CAPABILITY_NOT_SUPPORTED');
  const bare = new WorkerTelegramClient({ baseUrl: '', token: '' });
  await assert.rejects(bare.resolveChat('abcd'), (e) => e.kind === 'NOT_CONFIGURED');
});

test('capabilities are the MTPROTO_USER row', () => {
  const c = new WorkerTelegramClient({ baseUrl: 'https://w', token: 't' });
  assert.equal(c.mode, 'MTPROTO_USER');
  assert.equal(c.capabilities.searchPublicChats, true);
  assert.equal(c.capabilities.readHistory, true);
});

test('health: authorized with no error is ok; a disabled worker says DISABLED', async () => {
  const good = client({ '/health/telegram': () => [200, { ok: true, status: { configured: true, enabled: true, authorized: true, lastErrorKind: null } }] }).c;
  assert.deepEqual(await good.healthCheck(), { ok: true, account: null });
  const off = client({ '/health/telegram': () => [200, { ok: true, status: { configured: true, enabled: false, authorized: null, lastErrorKind: null } }] }).c;
  const r = await off.healthCheck();
  assert.equal(r.ok, false);
  assert.equal(r.error.kind, 'DISABLED');
});
