// PHASE 2 foundation: the source capability matrix, readiness statuses, the
// shared normalized entity and public contacts.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  SOURCE_CAPABILITIES, sourceCapability, sourceStatus, PROOF_WINDOW_DAYS,
} from '../discovery/source-capabilities.ts';
import { publicContactsIn, contactKeys, phoneKey } from '../discovery/public-contacts.ts';
import {
  fromPortalListing, fromObservationRow, fromCommunityListing, fromDemandSignal, reliableGeo, safePhotos,
} from '../discovery/discovery-entity.ts';
import { extractCommunityListing } from '../discovery/community-listing.ts';
import { createPortalRuntime } from '../market/runtime.ts';

const NOW = Date.parse('2026-10-02T20:00:00Z');
const daysAgo = (d) => new Date(NOW - d * 86_400_000).toISOString();

test('matrix: every source the owner named is present exactly once', () => {
  const keys = SOURCE_CAPABILITIES.map((c) => c.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const k of ['ss-ge', 'myhome-ge', 'livo-ge', 'place-ge', 'home-ge', 'home24-ge', 'zaraya-properties',
    'realting-com', 'estatemarket-ge', 'telegram', 'forum-ge', 'facebook-pages', 'facebook-groups', 'instagram', 'linkedin']) {
    assert.ok(keys.includes(k), k);
  }
});

test('matrix: every IMPLEMENTED portal is a real executable adapter, every CANDIDATE is not', () => {
  const executable = createPortalRuntime().registry.all().map((a) => a.id);
  for (const c of SOURCE_CAPABILITIES.filter((s) => s.kind === 'PORTAL')) {
    if (c.implementation === 'IMPLEMENTED') assert.ok(executable.includes(c.adapterId), `${c.key} must execute`);
    if (c.implementation === 'CANDIDATE') assert.ok(!executable.includes(c.adapterId), `${c.key} must never run for a customer`);
  }
});

test('status: code presence alone is never READY', () => {
  for (const c of SOURCE_CAPABILITIES) {
    const s = sourceStatus(c, { now: NOW });
    assert.notEqual(s.status, 'READY', c.key);
    assert.equal(s.liveTested, false, c.key);
  }
});

test('status: a full passing live check inside the window makes an implemented portal READY', () => {
  const s = sourceStatus(sourceCapability('place-ge'), {
    now: NOW,
    liveChecks: [{ source_key: 'place-ge', route: 'EDGE_HTTP', checked_at: daysAgo(1), ok: true, detail_ok: true, normalized_ok: true }],
  });
  assert.equal(s.status, 'READY');
  assert.equal(s.liveTested, true);
});

test('status: stale proof, partial proof, failing latest check and operator switch-off', () => {
  const cap = sourceCapability('home-ge');
  assert.equal(sourceStatus(cap, { now: NOW, lastCollectedAt: daysAgo(PROOF_WINDOW_DAYS + 1) }).status, 'DEGRADED');
  assert.equal(sourceStatus(cap, {
    now: NOW, liveChecks: [{ source_key: 'home-ge', route: 'EDGE_HTTP', checked_at: daysAgo(1), ok: true, detail_ok: true, normalized_ok: false }],
  }).status, 'BLOCKED', 'a partial check is not proof');
  assert.equal(sourceStatus(cap, {
    now: NOW, liveChecks: [
      { source_key: 'home-ge', route: 'EDGE_HTTP', checked_at: daysAgo(3), ok: true, detail_ok: true, normalized_ok: true },
      { source_key: 'home-ge', route: 'EDGE_HTTP', checked_at: daysAgo(1), ok: false, limitation: 'HTTP_403' },
    ],
  }).status, 'DEGRADED');
  assert.equal(sourceStatus(cap, { now: NOW, enabled: false, lastCollectedAt: daysAgo(1) }).status, 'DISABLED');
});

test('status: social sources stay BLOCKED with their exact reason; a candidate never becomes READY', () => {
  for (const key of ['facebook-pages', 'facebook-groups', 'instagram', 'linkedin']) {
    const s = sourceStatus(sourceCapability(key), { now: NOW, lastCollectedAt: daysAgo(1) });
    assert.equal(s.status, 'BLOCKED', key);
    assert.ok(s.reason.length > 20, key);
  }
  const myhome = sourceStatus(sourceCapability('myhome-ge'), {
    now: NOW, liveChecks: [{ source_key: 'myhome-ge', route: 'WORKER_BROWSER', checked_at: daysAgo(1), ok: true, detail_ok: true, normalized_ok: true }],
  });
  assert.equal(myhome.status, 'DEGRADED');
  assert.equal(myhome.liveTested, true);
});

test('status: Telegram production collection is a live proof', () => {
  const s = sourceStatus(sourceCapability('telegram'), { now: NOW, lastCollectedAt: daysAgo(0) });
  assert.equal(s.status, 'READY');
});

test('contacts: phones in every common spelling, messengers, email, handles — kept as written', () => {
  const text = 'Звоните +995 599 12 34 56 или 599-12-34-56, WhatsApp wa.me/995599123456, '
    + 'почта Owner.Name@Example.ge, @batumi_rent, t.me/vake_flats. Цена 1 250 000 $, 2026-10-02';
  const contacts = publicContactsIn(text);
  const phones = contacts.filter((c) => c.kind === 'PHONE');
  assert.equal(phones.length, 1, 'two spellings of one phone are one contact');
  assert.equal(phones[0].raw, '+995 599 12 34 56', 'raw is as written');
  assert.ok(contacts.some((c) => c.kind === 'WHATSAPP' && c.key === '+995599123456'));
  assert.ok(contacts.some((c) => c.kind === 'EMAIL' && c.raw === 'Owner.Name@Example.ge'));
  assert.ok(contacts.some((c) => c.kind === 'TELEGRAM' && c.key === 'batumi_rent'));
  assert.ok(contacts.some((c) => c.kind === 'TELEGRAM' && c.key === 'vake_flats'));
  assert.ok(!contacts.some((c) => c.raw.includes('1 250 000')), 'a price is not a phone');
  assert.deepEqual(contactKeys(contacts).filter((k) => k.startsWith('PHONE:')), ['PHONE:+995599123456']);
  assert.equal(phoneKey('0599123456'), '+995599123456');
  assert.equal(phoneKey('123456789'), null, 'not a Georgian range');
  assert.deepEqual(publicContactsIn(null), []);
});

const portalListing = (over = {}) => ({
  portalId: 'place-ge', sourceFamily: 'place.ge', externalId: '812345', url: 'https://place.ge/ge/ads/view/812345',
  retrievedAt: '2026-10-02T10:00:00Z', via: 'http', priceBasis: 'ASKING', queryId: 'q', matchRationale: '',
  listing: {
    title: '2-room flat', description: 'Vake, 65 m2. Call 599 12 34 56', listingId: '812345', propertyType: 'APARTMENT',
    status: null, registrationStatus: null, sale: { amount: 120000, currency: 'USD', basis: 'ASKING' }, rent: null,
    rentPeriod: null, area: { value: 65, unit: 'sqm' }, salePricePerSqm: null, rooms: 2, bedrooms: 1, bathrooms: null,
    isStudio: false, floor: 5, totalFloors: 9, yearBuilt: null, address: null, city: 'Tbilisi', district: 'Vake',
    country: 'GE', geo: { lat: 41.71, lng: 44.76 }, developerName: null, projectName: null, agencyName: null,
    cadastralCode: null, encumbrances: [], publishedAt: '2026-10-01T00:00:00Z', daysOnMarket: null,
    fieldOrigins: { 'sale': { kind: 'x' }, 'area': { kind: 'x' } },
  },
  ...over,
});

test('entity: a portal listing normalizes with exact provenance and nothing invented', () => {
  const e = fromPortalListing(portalListing(), { contactsText: 'Call 599 12 34 56', photos: ['https://img.place.ge/a.jpg', 'javascript:alert(1)', 'https://img.place.ge/a.jpg'] });
  assert.equal(e.kind, 'SUPPLY');
  assert.equal(e.transaction, 'SALE');
  assert.deepEqual(e.price, { min: 120000, max: 120000, currency: 'USD', period: null });
  assert.equal(e.areaSqm, 65);
  assert.deepEqual(e.geo, { lat: 41.71, lng: 44.76 });
  assert.equal(e.provenance.permalink, 'https://place.ge/ge/ads/view/812345');
  assert.equal(e.provenance.authorName, null, 'no seller invented');
  assert.deepEqual(e.photos, ['https://img.place.ge/a.jpg'], 'unsafe and duplicate photos dropped');
  assert.equal(e.contacts[0].key, '+995599123456');
  assert.equal(e.confidence, 1);
});

test('entity: missing fields stay null, unreliable coordinates are dropped', () => {
  const p = portalListing();
  p.listing = { ...p.listing, sale: null, rent: null, area: null, rooms: null, geo: { lat: 0, lng: 0 }, city: null };
  const e = fromPortalListing(p);
  assert.equal(e.price, null);
  assert.equal(e.transaction, null);
  assert.equal(e.geo, null);
  assert.equal(e.city, null);
  assert.ok(e.confidence < 0.5);
  assert.equal(reliableGeo('41.7', '44.8').lat, 41.7);
  assert.equal(reliableGeo(95, 10), null);
  assert.deepEqual(safePhotos(['data:image/png;base64,x', 'signal:1', 'https://x.ge/p.jpg']), ['https://x.ge/p.jpg']);
});

const TG_POST = 'Сдается 2-комн. квартира в Батуми, ул. Руставели 12, 65 м², 5 этаж, 700$ в месяц.\n'
  + 'Звоните +995 599 12 34 56, WhatsApp wa.me/995599123456, @batumi_rent';

test('entity: a Telegram listing keeps the exact message link, channel, author and contacts', () => {
  const signal = {
    id: '6f1f7a7e-0b7a-4a5e-9f2b-0d6e7c1a2b3c', platform: 'TELEGRAM', external_id: 'moonlightbatumi2023/4521',
    source_url: 'https://t.me/moonlightbatumi2023/4521', original_text: TG_POST, language: 'ru',
    author_public_name: '@batumi_rent', author_public_url: 'https://t.me/batumi_rent', published_at: '2026-10-02T15:00:00Z',
  };
  const listing = extractCommunityListing(TG_POST, { sourceCity: 'Batumi' });
  assert.ok(listing);
  const e = fromCommunityListing(signal, listing, { name: 'Moonlight Batumi', url: 'https://t.me', country_code: 'GE' });
  assert.equal(e.provenance.permalink, 'https://t.me/moonlightbatumi2023/4521');
  assert.equal(e.provenance.sourceUrl, 'https://t.me/moonlightbatumi2023', 'channel from the permalink, not the registry stub');
  assert.equal(e.provenance.authorUrl, 'https://t.me/batumi_rent');
  assert.equal(e.provenance.originalText, TG_POST, 'not redacted');
  assert.ok(e.contacts.some((c) => c.kind === 'PHONE'));
  assert.equal(e.transaction, 'RENT');
  assert.equal(e.source.entityId, 'moonlightbatumi2023/4521');
});

test('entity: a stored observation + raw signal rebuilds the same provenance; a forum post keeps topic and profile', () => {
  const e = fromObservationRow(
    { adapter_id: 'forum-community', external_id: '123:456', canonical_url: 'https://forum.ge/?showtopic=123&view=findpost&p=456',
      transaction: 'SALE', city: 'Tbilisi', sale_amount: '95000', sale_currency: 'USD', area_sqm: '70', rooms: 3,
      field_origins: { city: 'TEXT', rawSignalId: 'x' } },
    { platform: 'FORUM', source_url: 'https://forum.ge/?showtopic=123&view=findpost&p=456', parent_url: 'https://forum.ge/?showtopic=123',
      author_public_name: 'gela', author_public_url: 'https://forum.ge/?showuser=777', original_text: 'ვყიდი ბინას 599123456' },
    { name: 'forum.ge', url: 'https://forum.ge/?showforum=92' },
  );
  assert.equal(e.provenance.permalink, 'https://forum.ge/?showtopic=123&view=findpost&p=456');
  assert.equal(e.provenance.threadUrl, 'https://forum.ge/?showtopic=123');
  assert.equal(e.provenance.authorUrl, 'https://forum.ge/?showuser=777');
  assert.equal(e.price.min, 95000);
  assert.equal(e.evidence.city, 'TEXT');
  assert.equal(e.contacts[0].key, '+995599123456');
});

test('entity: unsafe links never become provenance', () => {
  const e = fromObservationRow({ adapter_id: 'telegram-community', canonical_url: 'javascript:alert(1)' },
    { platform: 'TELEGRAM', source_url: 'data:text/html,x', author_public_url: 'signal:abc' });
  assert.equal(e.provenance.permalink, null);
  assert.equal(e.provenance.authorUrl, null);
});

test('entity: demand keeps only what was read and marks model-read fields', () => {
  const e = fromDemandSignal(
    { platform: 'FACEBOOK', external_id: 'p1', source_url: 'https://www.facebook.com/somepage/posts/123', original_text: 'Looking for 2BR in Vake up to $900, +995 555 11 22 33' },
    { intent: 'RENT', city: 'Tbilisi', district: 'Vake', budgetMax: 900, currency: 'USD', bedrooms: 2, origin: 'MODEL' },
  );
  assert.equal(e.kind, 'DEMAND');
  assert.equal(e.transaction, 'RENT');
  assert.deepEqual(e.price, { min: null, max: 900, currency: 'USD', period: 'MONTH' });
  assert.equal(e.evidence.city, 'MODEL');
  assert.equal(e.areaSqm, null);
  assert.equal(e.evidence.areaSqm, undefined);
  assert.equal(e.provenance.permalink, 'https://www.facebook.com/somepage/posts/123');
  assert.equal(e.contacts[0].key, '+995555112233');
});

test('status: a reachable home page (host probe) is never a listing proof', () => {
  const s = sourceStatus(sourceCapability('myhome-ge'), {
    now: NOW,
    liveChecks: [{ source_key: 'www.myhome.ge', route: 'EDGE_HTTP', checked_at: daysAgo(1), ok: true }],
  });
  assert.equal(s.liveTested, false);
  assert.equal(s.status, 'BLOCKED');
});
