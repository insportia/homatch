// PROPERTY CONVERSATIONS — the send path's rules, without a database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPropertyCard, cardRefusal, emailEnabledFrom, isDuplicateBody, notificationPlan, offerCapDecision,
  parseSendRequest, rewriteIntroducesFacts, validateMedia, numbersIn, SEND_RATE_LIMIT,
} from '../propertyChat.ts';

const S = '11111111-1111-4111-8111-111111111111';
const R = '44444444-4444-4444-8444-444444444444';
const C = '22222222-2222-4222-8222-222222222222';
const F = '33333333-3333-4333-8333-333333333333';
const P = '55555555-5555-4555-8555-555555555555';

test('a plain text send still parses exactly as before', () => {
  const r = parseSendRequest({ recipient_id: R, body: '  hello  ', conversation_id: C });
  assert.ok(r.ok);
  assert.equal(r.value.body, 'hello');
  assert.equal(r.value.kind, 'TEXT');
  assert.equal(parseSendRequest({ recipient_id: R, body: '   ' }).error, 'Message body required');
  assert.equal(parseSendRequest({ body: 'x' }).error, 'Valid recipient_id required');
});

test('kinds must carry exactly what they need', () => {
  assert.equal(parseSendRequest({ recipient_id: R, kind: 'PHOTO' }).error, 'MEDIA_MISMATCH');
  assert.equal(parseSendRequest({ recipient_id: R, kind: 'TEXT', body: 'x', media_path: 'a/b/c.jpg' }).error, 'MEDIA_MISMATCH');
  assert.equal(parseSendRequest({ recipient_id: R, kind: 'PROPERTY' }).error, 'PROPERTY_CARD_MISMATCH');
  assert.equal(parseSendRequest({ recipient_id: R, kind: 'STICKER', body: 'x' }).error, 'INVALID_KIND');
  assert.ok(parseSendRequest({ recipient_id: R, kind: 'PROPERTY', card_property_id: P }).ok, 'a card may have no caption');
  assert.equal(parseSendRequest({ recipient_id: R, body: 'x'.repeat(4001) }).error, 'MESSAGE_TOO_LONG');
});

test('client listing fields on a property card are never read', () => {
  const r = parseSendRequest({ recipient_id: R, kind: 'PROPERTY', card_property_id: P, property_card: { price: 1 }, title: 'Palace' });
  assert.ok(r.ok);
  assert.ok(!('property_card' in r.value) && !('title' in r.value));
});

test('an approved translation keeps both texts and two different known languages', () => {
  const ok = parseSendRequest({ recipient_id: R, body: 'Hello', original_body: 'გამარჯობა', original_lang: 'ka', translated_to: 'en' });
  assert.ok(ok.ok);
  assert.equal(ok.value.originalLang, 'ka');
  assert.equal(parseSendRequest({ recipient_id: R, body: 'Hello', original_body: 'გამარჯობა', original_lang: 'ka', translated_to: 'ka' }).error, 'TRANSLATION_LANGUAGE_INVALID');
  assert.equal(parseSendRequest({ recipient_id: R, body: 'Hello', original_body: 'x', original_lang: 'xx', translated_to: 'en' }).error, 'TRANSLATION_LANGUAGE_INVALID');
  assert.equal(parseSendRequest({ recipient_id: R, body: 'x', client_message_id: 'bad id' }).error, 'INVALID_CLIENT_MESSAGE_ID');
});

test('media: own prefix, stored size wins over the claim, voice ≤ 60 s', () => {
  const photo = `${S}/${C}/${F}.jpg`;
  const voice = `${S}/${C}/${F}.webm`;
  assert.equal(validateMedia('PHOTO', `${R}/${C}/${F}.jpg`, {}, { size: 10, mimetype: 'image/jpeg' }, S, C).error, 'MEDIA_PATH_INVALID');
  assert.equal(validateMedia('PHOTO', photo, {}, null, S, C).error, 'MEDIA_NOT_FOUND');
  assert.equal(validateMedia('PHOTO', photo, { size: 10 }, { size: 9 * 1024 * 1024, mimetype: 'image/jpeg' }, S, C).error, 'MEDIA_TOO_LARGE',
    'a client claiming 10 bytes does not get past what storage holds');
  assert.equal(validateMedia('PHOTO', photo, {}, { size: 100, mimetype: 'application/pdf' }, S, C).error, 'MEDIA_TYPE_INVALID');
  const okPhoto = validateMedia('PHOTO', photo, { width: 800, height: 600, evil: 'x' }, { size: 100, mimetype: 'image/jpeg' }, S, C);
  assert.deepEqual(okPhoto.value, { mime: 'image/jpeg', size: 100, width: 800, height: 600 });
  assert.equal(validateMedia('VOICE', voice, { duration_seconds: 61 }, { size: 100, mimetype: 'audio/webm' }, S, C).error, 'VOICE_TOO_LONG');
  assert.equal(validateMedia('VOICE', voice, {}, { size: 100, mimetype: 'audio/webm' }, S, C).error, 'VOICE_TOO_LONG');
  assert.equal(validateMedia('VOICE', voice, { duration_seconds: 59.96 }, { size: 100, mimetype: 'audio/webm;codecs=opus' }, S, C).value.duration_seconds, 60);
  assert.equal(validateMedia('TEXT', null, null, null, S, C).value, null);
});

test('property card: only the sender\'s own live listing, built from its rows', () => {
  const row = { id: P, user_id: S, homatch_id: 100001, title: ' Krtsanisi 2BR ', is_deleted: false, archived_at: null,
    cover_photo_url: 'users/s/cover.jpg', transaction_type: 'SALE', property_type: 'APARTMENT' };
  assert.equal(cardRefusal(null, S), 'PROPERTY_NOT_FOUND');
  assert.equal(cardRefusal({ ...row, user_id: R }, S), 'PROPERTY_NOT_YOURS');
  assert.equal(cardRefusal({ ...row, is_deleted: true }, S), 'PROPERTY_NOT_FOUND');
  assert.equal(cardRefusal({ ...row, archived_at: '2026-01-01' }, S), 'PROPERTY_ARCHIVED');
  assert.equal(cardRefusal(row, S), null);

  const now = new Date('2026-10-10T00:00:00Z');
  const card = buildPropertyCard(row, { city: 'Tbilisi', district: 'Krtsanisi', total_price: '185000.00', currency: 'usd', bedrooms: 2, area: '85.5' }, now);
  assert.deepEqual(card, {
    id: P, homatch_id: 100001, title: 'Krtsanisi 2BR', price: 185000, currency: 'USD', city: 'Tbilisi', district: 'Krtsanisi',
    bedrooms: 2, area: 85.5, cover: 'users/s/cover.jpg', transaction_type: 'SALE', property_type: 'APARTMENT',
    snapshot_at: '2026-10-10T00:00:00.000Z',
  });
  const sparse = buildPropertyCard(row, null, now);
  assert.equal(sparse.price, null);
  assert.equal(sparse.city, null);
  assert.equal(sparse.bedrooms, null, 'a missing fact stays missing');
  assert.equal(buildPropertyCard(row, { total_price: 100, currency: null }, now).price, null, 'no currency → no price');
  assert.equal(buildPropertyCard(row, { photo_visibility: 'PRIVATE' }, now).cover, null, 'private photos are not shared');
});

test('duplicates: same words, same conversation, within 30 s', () => {
  const now = new Date('2026-10-10T10:00:30Z');
  const recent = [{ body: 'Is it  available?', created_at: '2026-10-10T10:00:10Z', client_message_id: 'c_previous1' }];
  assert.ok(isDuplicateBody(recent, 'is it available?', now));
  assert.ok(!isDuplicateBody(recent, 'is it available?', new Date('2026-10-10T10:00:45Z')), '35 s later is a new message');
  assert.ok(!isDuplicateBody(recent, 'Something else', now));
  assert.ok(!isDuplicateBody(recent, 'is it available?', now, 'c_previous1'), 'a retry of the same send is idempotency, not a duplicate');
  assert.ok(!isDuplicateBody(recent, '', now));
});

test('offer cap: three owner messages until the member replies', () => {
  assert.deepEqual(offerCapDecision({ senderOwnsProperty: true, counterpartMessages: 0, senderMessages: 2 }), { allowed: true, remaining: 1 });
  assert.deepEqual(offerCapDecision({ senderOwnsProperty: true, counterpartMessages: 0, senderMessages: 3 }), { allowed: false, remaining: 0 });
  assert.equal(offerCapDecision({ senderOwnsProperty: true, counterpartMessages: 1, senderMessages: 30 }).allowed, true);
  assert.equal(offerCapDecision({ senderOwnsProperty: false, counterpartMessages: 0, senderMessages: 30 }).allowed, true);
  assert.deepEqual(SEND_RATE_LIMIT, { operation: 'dm_send', burstLimit: 8, burstSeconds: 10, dailyLimit: 400, dailySeconds: 86400 });
});

test('notification plan: offer only on the first lead message; muted never pushes', () => {
  assert.deepEqual(notificationPlan({ isLeadOffer: true, isFirstContact: true, recipientMuted: false, emailEnabled: true }),
    { kind: 'PROPERTY_OFFER', priority: 'HIGH', sendEmail: true });
  assert.deepEqual(notificationPlan({ isLeadOffer: true, isFirstContact: false, recipientMuted: false, emailEnabled: true }),
    { kind: 'NEW_MESSAGE', priority: 'HIGH', sendEmail: false });
  assert.equal(notificationPlan({ isLeadOffer: true, isFirstContact: true, recipientMuted: false, emailEnabled: false }).sendEmail, false);
  assert.equal(notificationPlan({ isLeadOffer: false, isFirstContact: true, recipientMuted: true, emailEnabled: true }).priority, 'LOW');
  assert.equal(emailEnabledFrom(null), true);
  assert.equal(emailEnabledFrom({ email_enabled: false }), false);
  assert.equal(emailEnabledFrom({ email_enabled: true, categories: { messages: false } }), false);
});

test('improve never adds a figure, a currency or a percentage', () => {
  assert.deepEqual(numbersIn('Price 185,000 USD, 85 m², floor 3'), ['185000', '85', '3']);
  assert.ok(!rewriteIntroducesFacts('the flat is 85 m2 and costs 185 000 usd', 'The apartment is 85 m2 and costs 185,000 USD.'));
  assert.ok(rewriteIntroducesFacts('the flat is nice', 'The flat is nice and only 150,000 USD!'));
  assert.ok(rewriteIntroducesFacts('price is negotiable', 'Price is negotiable — 10% off this week'));
  assert.ok(rewriteIntroducesFacts('costs 100', 'costs $100'));
  assert.ok(rewriteIntroducesFacts('hi', 'x'.repeat(300)), 'a rewrite that balloons is not an edit');
});
