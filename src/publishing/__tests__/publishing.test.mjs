import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOwnedProperty } from '../normalize.ts';
import {
  resolveSections,
  DEFAULT_HOME_ORDER,
} from '../../site/render/order.ts';
import { emptyPage, makeSection } from '../../site/model.ts';
import { originalListingUrl } from '../presentation.ts';
test('original listing links reject credentials, scripts, lookalike domains and ports', () => {
  for (const url of [
    'javascript:alert(1)',
    'https://myhome.ge.evil.example/123',
    'https://u:secret@myhome.ge/123',
    'https://myhome.ge:8443/123',
    'http://myhome.ge/123',
  ])
    assert.equal(originalListingUrl(url, 'myhome.ge'), null);
  assert.equal(
    originalListingUrl('https://www.myhome.ge/123', 'myhome.ge'),
    'https://www.myhome.ge/123',
  );
});
test('default homepage places Publishing exactly between Brokers and Property Search', () => {
  const at = DEFAULT_HOME_ORDER.indexOf('brokers');
  assert.deepEqual(DEFAULT_HOME_ORDER.slice(at, at + 3), [
    'brokers',
    'publishing',
    'find_property',
  ]);
});
test('published homepage is reconciled to exact product placement without losing content', () => {
  const types = [
    'find_property',
    'hero',
    'brokers',
    'publishing',
    'developers',
  ];
  const stored = {
    ...emptyPage(),
    sections: types.map((type, i) => makeSection(type, `s${i}`)),
  };
  const output = resolveSections('home', stored).map((s) => s.type);
  const at = output.indexOf('brokers');
  assert.deepEqual(output.slice(at, at + 3), [
    'brokers',
    'publishing',
    'find_property',
  ]);
  for (const type of types)
    assert.equal(output.filter((t) => t === type).length, 1);
  assert.deepEqual(
    stored.sections.map((s) => s.type),
    types,
  );
});
test('normalization preserves real price, amenities, image order and existing property identity', () => {
  const row = {
    id: 'p1',
    user_id: 'u1',
    transaction_type: 'SALE',
    property_type: 'APARTMENT',
    title: 'Home',
    contact_phone_e164: '+995555123456',
    facts: {
      area: '80',
      total_price: '160000',
      currency: 'USD',
      city: 'Tbilisi',
      country: 'GE',
      furnished: false,
    },
    photos: [
      { id: 'b', storage_path: 'u1/b.jpg', display_order: 2 },
      { id: 'a', storage_path: 'u1/a.jpg', display_order: 1, is_cover: true },
    ],
  };
  const normalized = normalizeOwnedProperty(row, 'u1');
  assert.equal(normalized.id, 'p1');
  assert.equal(normalized.price.amount, 160000);
  assert.equal(normalized.amenities.furniture, false);
  assert.deepEqual(
    normalized.photos.map((p) => p.id),
    ['a', 'b'],
  );
  assert.equal(normalized.photos[0].sha256, null);
});
test('unknown transaction and missing price are never silently invented', () => {
  const normalized = normalizeOwnedProperty(
    { id: 'p', user_id: 'u', transaction_type: 'INVESTMENT' },
    'u',
  );
  assert.equal(normalized.transaction, 'unknown');
  assert.equal(normalized.price.amount, undefined);
  assert.equal(normalized.location.country, '');
});
test('normalization rejects another users property and deleted property', () => {
  assert.throws(
    () => normalizeOwnedProperty({ user_id: 'u1' }, 'u2'),
    /NOT_OWNED/,
  );
  assert.throws(
    () => normalizeOwnedProperty({ user_id: 'u1', is_deleted: true }, 'u1'),
    /NOT_OWNED/,
  );
});
