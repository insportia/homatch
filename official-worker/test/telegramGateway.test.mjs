// telegramGateway.test.mjs — the MTProto session gateway, driven by a fake
// driver. What is proven here: serial use of one session, FLOOD_WAIT obeyed
// and shared, sticky auth failure, the public-chat access boundary, published
// dates passed through untouched, and that nothing secret can leave.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TelegramGateway, telegramEnvFromProcess, configProblems } from '../.tstest-build/telegram/TelegramGateway.js';
import {
  normalizeUsername, toPublicChat, toMessage, classifyTelegramFailure, redactTelegramSecrets,
} from '../.tstest-build/telegram/TelegramModel.js';

const SESSION = '1BVtsOK8Bu' + 'A'.repeat(300) + 'xyz';
const ENV = { apiId: 12345, apiHash: 'abcdef0123456789abcdef0123456789', session: SESSION, enabled: true };

const channel = (over = {}) => ({
  id: '1001', username: 'tbilisikvartiri', title: 'Тбилиси Квартиры', type: 'channel',
  broadcast: true, megagroup: false, participantsCount: 5000, restricted: false, ...over,
});
const msg = (id, over = {}) => ({
  id, date: 1_790_000_000 + id, editDate: null, text: `message ${id}`, replyToMsgId: null,
  post: true, fromUsername: null, views: 10, service: false, ...over,
});

function fakeDriver(script = {}) {
  const calls = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const wrap = (name, fn) => async (...args) => {
    calls.push(name);
    inFlight += 1; maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((r) => setTimeout(r, 2));
      return await fn(...args);
    } finally { inFlight -= 1; }
  };
  const driver = {
    connect: wrap('connect', async () => { if (script.connectError) throw script.connectError; }),
    disconnect: async () => { calls.push('disconnect'); },
    checkAuthorized: wrap('checkAuthorized', async () => script.authorized ?? true),
    resolveUsername: wrap('resolve', async (u) => {
      if (script.resolveError) throw script.resolveError;
      return { chat: script.chat ?? channel({ username: u }), handle: { peer: u } };
    }),
    getHistory: wrap('history', async (_h, o) => {
      if (script.historyError) { const e = script.historyError; script.historyError = null; throw e; }
      return (script.history ?? [msg(3), msg(2), msg(1)]).slice(0, o.limit);
    }),
    getReplies: wrap('replies', async () => []),
    searchChats: wrap('search', async () => script.search ?? []),
  };
  return { driver, calls, get maxInFlight() { return maxInFlight; } };
}

const gatewayWith = (fake, over = {}) => new TelegramGateway({
  env: ENV, driverFactory: () => fake.driver, minGapMs: 0, idleDisconnectMs: 60_000, ...over,
});

test('env: presence only; enabled needs an explicit truthy flag', () => {
  const env = telegramEnvFromProcess({ TELEGRAM_API_ID: '42', TELEGRAM_API_HASH: 'h', TELEGRAM_SESSION: 's' });
  assert.equal(env.enabled, false);
  assert.deepEqual(configProblems(env), []);
  assert.deepEqual(configProblems(telegramEnvFromProcess({})), ['API_ID_MISSING', 'API_HASH_MISSING', 'SESSION_MISSING']);
});

test('not configured / disabled refuse without touching Telegram', async () => {
  const fake = fakeDriver();
  const off = gatewayWith(fake, { env: { ...ENV, enabled: false } });
  await assert.rejects(off.history('tbilisikvartiri', {}), (e) => e.kind === 'DISABLED');
  const missing = gatewayWith(fake, { env: { ...ENV, session: null } });
  await assert.rejects(missing.history('tbilisikvartiri', {}), (e) => e.kind === 'NOT_CONFIGURED');
  assert.deepEqual(fake.calls, []);
});

test('history: newest first, published date untouched, cursor is the lowest id', async () => {
  const fake = fakeDriver({ history: [msg(30), msg(29), msg(28)] });
  const gw = gatewayWith(fake);
  const page = await gw.history('@TbilisiKvartiri', { limit: 3 });
  assert.equal(page.chat.username, 'tbilisikvartiri');
  assert.deepEqual(page.items.map((m) => m.id), ['30', '29', '28']);
  assert.equal(page.items[0].date, 1_790_000_030);
  assert.equal(page.hasMore, true);
  assert.equal(page.nextCursor, '28');
});

test('one session, one call at a time: concurrent callers are serialized', async () => {
  const fake = fakeDriver();
  const gw = gatewayWith(fake);
  await Promise.all([1, 2, 3, 4, 5].map(() => gw.history('tbilisikvartiri', { limit: 2 })));
  assert.equal(fake.maxInFlight, 1);
  assert.equal(fake.calls.filter((c) => c === 'resolve').length, 1, 'username resolved once and cached');
});

test('FLOOD_WAIT is obeyed exactly and shared across callers', async () => {
  let now = 1_000_000;
  const flood = Object.assign(new Error('A wait of 120 seconds is required (caused by messages.GetHistory)'),
    { name: 'FloodWaitError', errorMessage: 'FLOOD', seconds: 120 });
  const fake = fakeDriver({ historyError: flood });
  const gw = gatewayWith(fake, { now: () => now });
  await assert.rejects(gw.history('tbilisikvartiri', {}), (e) => e.kind === 'RATE_LIMITED' && e.retryAfterSeconds === 120);
  const before = fake.calls.length;
  now += 60_000;
  await assert.rejects(gw.history('tbilisikvartiri', {}), (e) => e.kind === 'RATE_LIMITED' && e.retryAfterSeconds === 60);
  assert.equal(fake.calls.length, before, 'no Telegram call while the wait is active');
  assert.ok(gw.status().rateLimitedUntil);
  now += 61_000;
  const page = await gw.history('tbilisikvartiri', {});
  assert.equal(page.items.length, 3);
});

test('auth failure is sticky: a revoked session is never retried', async () => {
  const revoked = Object.assign(new Error('RPCError 401'), { errorMessage: 'AUTH_KEY_UNREGISTERED' });
  const fake = fakeDriver({ resolveError: revoked });
  const gw = gatewayWith(fake);
  await assert.rejects(gw.history('tbilisikvartiri', {}), (e) => e.kind === 'AUTH_FAILED');
  const before = fake.calls.length;
  await assert.rejects(gw.history('othergroup', {}), (e) => e.kind === 'AUTH_FAILED');
  assert.equal(fake.calls.length, before);
  assert.equal(gw.status().authorized, false);
});

test('access boundary: people, bots, username-less and restricted chats are refused', () => {
  assert.throws(() => toPublicChat(channel({ type: 'user' })), (e) => e.kind === 'CHAT_NOT_FOUND');
  assert.throws(() => toPublicChat(channel({ username: null })), (e) => e.kind === 'CHAT_PRIVATE');
  assert.throws(() => toPublicChat(channel({ restricted: true })), (e) => e.kind === 'CHAT_PRIVATE');
  assert.equal(toPublicChat(channel({ broadcast: false, megagroup: true })).kind, 'SUPERGROUP');
  assert.equal(normalizeUsername('https://t.me/+AbCdEfInvite'), null, 'invite links are not addressable');
  assert.equal(normalizeUsername('+995555123456'), null);
  assert.equal(normalizeUsername('https://t.me/s/Tbilisi_Rent'), 'tbilisi_rent');
});

test('search offers only public chats', async () => {
  const fake = fakeDriver({ search: [channel({ id: '1', username: 'rent_tbilisi' }), channel({ id: '2', username: null }), channel({ id: '3', type: 'user' })] });
  const gw = gatewayWith(fake);
  const found = await gw.search('аренда тбилиси', 10);
  assert.deepEqual(found.map((c) => c.username), ['rent_tbilisi']);
});

test('messages: service/empty dropped; channel posts attributed to the channel; no private names', () => {
  const chat = toPublicChat(channel());
  assert.equal(toMessage(msg(1, { service: true }), chat), null);
  assert.equal(toMessage(msg(2, { text: '   ' }), chat), null);
  const post = toMessage(msg(3), chat);
  assert.equal(post.fromChannel, true);
  assert.equal(post.authorUsername, 'tbilisikvartiri');
  const group = toMessage(msg(4, { post: false, fromUsername: 'Seeker_99', editDate: 1_790_000_100 }), chat);
  assert.equal(group.authorUsername, 'seeker_99');
  assert.equal(group.authorDisplayName, null);
  assert.equal(group.editDate, 1_790_000_100);
});

test('errors carry Telegram codes only, never the request dump or a secret', () => {
  const e = classifyTelegramFailure(Object.assign(new Error(`bad ${SESSION} (caused by x)`), { errorMessage: 'CHANNEL_PRIVATE' }));
  assert.equal(e.kind, 'CHAT_PRIVATE');
  assert.equal(e.message, 'CHANNEL_PRIVATE');
  const unknown = classifyTelegramFailure(new Error(`boom ${SESSION}`));
  assert.ok(!unknown.message.includes(SESSION));
  const redacted = redactTelegramSecrets(`x ${SESSION} y ${ENV.apiHash} z`, [SESSION, ENV.apiHash]);
  assert.ok(!redacted.includes(SESSION) && !redacted.includes(ENV.apiHash));
  assert.ok(!redactTelegramSecrets('p'.repeat(200) + 'Q'.repeat(200), []).includes('Q'.repeat(150)));
});

test('status exposes facts, never credentials', async () => {
  const fake = fakeDriver();
  const gw = gatewayWith(fake);
  await gw.health();
  const text = JSON.stringify(gw.status());
  assert.ok(!text.includes(SESSION) && !text.includes(ENV.apiHash) && !text.includes('12345'));
  assert.equal(gw.status().authorized, true);
  assert.equal(gw.status().connected, true);
  await gw.shutdown();
  assert.equal(gw.status().connected, false);
});
