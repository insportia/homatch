// PROPERTY CONVERSATIONS — client helpers: delivery labels, optimistic merge, paths, typing.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deliveryLabelKey, detectChatLanguage, dmMediaPath, formatClock, isOwnMediaPath, isValidClientMessageId,
  mergeMessage, newClientMessageId, shouldBroadcastTyping, typingActive, unreadCount,
} from '../conversation.ts';

const S = '11111111-1111-4111-8111-111111111111';
const C = '22222222-2222-4222-8222-222222222222';
const F = '33333333-3333-4333-8333-333333333333';

test('delivery states read as people say them', () => {
  assert.equal(deliveryLabelKey('SENDING'), 'pc_status_sending');
  assert.equal(deliveryLabelKey('SEEN'), 'pc_status_read');
  assert.equal(deliveryLabelKey('FAILED'), 'pc_status_failed');
});

test('media paths: sender and conversation folders, canonical shape only', () => {
  const p = dmMediaPath(S, C, F, 'audio/webm;codecs=opus');
  assert.equal(p, `${S}/${C}/${F}.webm`);
  assert.ok(isOwnMediaPath(p, S, C));
  assert.ok(!isOwnMediaPath(p, C, S), 'someone else\'s prefix');
  assert.ok(!isOwnMediaPath(`${S}/${C}/../${F}.webm`, S, C));
  assert.ok(!isOwnMediaPath(`${S}/${C}/${F}.exe`, S, C));
  assert.ok(!isOwnMediaPath(null, S, C));
});

test('optimistic message is replaced by the server row, never duplicated', () => {
  const optimistic = { id: 'tmp-1', sender_id: S, status: 'SENDING', created_at: '2026-10-10T10:00:00.000Z', client_message_id: 'c_abcdefgh' };
  let list = mergeMessage([], optimistic);
  const server = { id: 'm1', sender_id: S, status: 'DELIVERED', created_at: '2026-10-10T10:00:01.000Z', client_message_id: 'c_abcdefgh' };
  list = mergeMessage(list, server);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'm1');
  /* The realtime INSERT arrives after the response, carrying the older SENT status. */
  list = mergeMessage(list, { ...server, status: 'SENT' });
  assert.equal(list.length, 1);
  assert.equal(list[0].status, 'DELIVERED', 'a late insert does not roll the status back');
  list = mergeMessage(list, { ...server, status: 'SEEN' });
  assert.equal(list[0].status, 'SEEN');
});

test('realtime row first, then the response: still one message', () => {
  const optimistic = { id: 'tmp-2', sender_id: S, status: 'SENDING', created_at: '2026-10-10T10:00:00.000Z', client_message_id: 'c_zzzzzzzz' };
  const server = { id: 'm2', sender_id: S, status: 'SENT', created_at: '2026-10-10T10:00:01.000Z', client_message_id: 'c_zzzzzzzz' };
  let list = mergeMessage([optimistic], server);
  list = mergeMessage(list, { ...server, status: 'DELIVERED' });
  assert.equal(list.length, 1);
});

test('unread counts only the other person\'s unseen messages', () => {
  const list = [
    { id: 'a', sender_id: S, status: 'DELIVERED', created_at: '1' },
    { id: 'b', sender_id: C, status: 'DELIVERED', created_at: '2' },
    { id: 'c', sender_id: C, status: 'SEEN', created_at: '3' },
  ];
  assert.equal(unreadCount(list, S), 1);
});

test('typing indicators expire and are throttled', () => {
  assert.ok(typingActive(1000, 3000));
  assert.ok(!typingActive(1000, 8000));
  assert.ok(!typingActive(null, 8000));
  assert.ok(shouldBroadcastTyping(null, 0));
  assert.ok(!shouldBroadcastTyping(1000, 2000));
  assert.ok(shouldBroadcastTyping(1000, 4000));
});

test('client message ids are valid idempotency keys', () => {
  const id = newClientMessageId(() => '0b7c3c1e-7c1d-4f7e-9a51-1a2b3c4d5e6f');
  assert.ok(isValidClientMessageId(id));
  assert.ok(!isValidClientMessageId('short'));
  assert.ok(!isValidClientMessageId('has spaces in it'));
});

test('language guess by script', () => {
  assert.equal(detectChatLanguage('გამარჯობა'), 'ka');
  assert.equal(detectChatLanguage('Здравствуйте'), 'ru');
  assert.equal(detectChatLanguage('مرحبا'), 'ar');
  assert.equal(detectChatLanguage('שלום'), 'he');
  assert.equal(detectChatLanguage('Merhaba, daire satılık mı?'), 'tr');
  assert.equal(detectChatLanguage('Hello there'), 'en');
  assert.equal(detectChatLanguage('123 👍'), null);
  assert.equal(formatClock(62.4), '1:02');
});
