// The publishing domain: listing validation, portal URL linking, the page-check
// classification and the publication state machine. Pure — no network, no database.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_VERIFY_ATTEMPTS, backoffMs, classifyCheck, normalizeListing, parseExternalUrl, publicRegistry,
  transition, validateListing,
} from '../domain.ts';
import { configs } from '../providers.ts';

const P = Object.fromEntries(configs().map((c) => [c.id, c]));

const PHOTO = '0b5c1e44-4f3a-4b8e-9a51-0e7d6c2b9f10';
const complete = () => normalizeListing({
  title: '3-room apartment in Vake', description: { ka: 'სამოთახიანი ბინა ვაკეში' }, propertyType: 'apartment', dealType: 'sale',
  price: '155,000', currency: 'usd', area: 97.5, rooms: 3, bedrooms: 2, floor: 4, totalFloors: 9,
  city: 'თბილისი', street: 'Chavchavadze Ave', contactName: 'Nino', contactPhone: '+995599123456',
  photos: [PHOTO, PHOTO, 'not-a-uuid'], amenities: ['balcony', 'jacuzzi'], portalTargets: ['myhome', 'ssge', 'evil'], injected: 'x',
});
const NOW = new Date('2026-10-15T12:00:00Z');
const pub = (over = {}) => ({ status: 'HANDOFF_READY', revision: 0, external_id: null, external_url: null, listing_version: 1, check_attempts: 0, last_checked_at: null, next_check_at: null, published_at: null, last_error: null, ...over });

test('normalize drops unknown keys, unknown amenities/portals, duplicate and malformed photo ids', () => {
  const x = complete();
  assert.equal(x.price, 155000);
  assert.equal(x.currency, 'USD');
  assert.equal(x.propertyType, 'APARTMENT');
  assert.deepEqual(x.photos, [PHOTO]);
  assert.deepEqual(x.amenities, ['balcony']);
  assert.deepEqual(x.portalTargets, ['myhome', 'ssge']);
  assert.equal('injected' in x, false);
});

test('a complete listing is ready; every missing requirement is named, not just the first', () => {
  assert.equal(validateListing(complete()).ready, true);
  const empty = validateListing(normalizeListing({}));
  assert.equal(empty.ready, false);
  const fields = empty.listing.map((p) => p.field);
  for (const f of ['title', 'description', 'propertyType', 'dealType', 'price', 'city', 'contacts']) assert.ok(fields.includes(f), f);
  // Not HOMATCH requirements: a portal asks for them only through its configured rules.
  for (const f of ['area', 'bathrooms', 'street', 'contactName', 'photos']) assert.ok(!fields.includes(f), `${f} must not be a baseline requirement`);
});

test('legacy single contactPhone becomes the first contact; invalid numbers are named per row', () => {
  assert.deepEqual(complete().contacts, [{ phone: '+995599123456', whatsapp: false, viber: false }]);
  const x = normalizeListing({ contacts: [{ phone: '+995 599 123 456', whatsapp: true }, { phone: '12' }, { phone: '+995599123456' }, { phone: '+995577000000' }, { phone: '+995577000001' }] });
  assert.equal(x.contacts.length, 3, 'at most three numbers, duplicates dropped');
  assert.deepEqual(x.contacts[0], { phone: '+995599123456', whatsapp: true, viber: false });
  assert.deepEqual(validateListing(x).listing.filter((p) => p.field.startsWith('contacts')).map((p) => `${p.field}:${p.code}`), ['contacts.1:INVALID_PHONE']);
});

test('provider field rules come from configuration and default to none', () => {
  const x = { ...complete(), area: null, photos: [] };
  const v = validateListing(x);
  for (const id of ['ssge', 'placege', 'homege', 'brokeri', 'korter', 'binebi', 'allhome']) assert.deepEqual(v.portals[id], [], id);
  const strict = configs([{ id: 'placege', enabled: true, sort: 2, create_url: null, logo_url: null, verification: null, max_photos: null, description_max: 160, required_fields: ['area', 'photos', 'bathrooms', 'not-a-field'] }]);
  const ruled = validateListing(x, strict).portals.placege.map((p) => `${p.field}:${p.code}`);
  assert.deepEqual(ruled, ['area:REQUIRED_BY_PORTAL', 'photos:REQUIRED_BY_PORTAL', 'bathrooms:REQUIRED_BY_PORTAL']);
  // The description limit counts the longer footer that will be appended (the HOMATCH-account owner footer).
  const long = { ...complete(), description: { ka: 'ა'.repeat(80), en: '', ru: '' } };
  assert.ok(validateListing(long, strict).portals.placege.some((p) => p.field === 'description.ka' && p.code === 'DESCRIPTION_TOO_LONG'));
});

test('inconsistent facts are refused', () => {
  const x = { ...complete(), floor: 12, totalFloors: 9, bedrooms: 4, rooms: 3 };
  const codes = validateListing(x).listing.map((p) => p.code);
  assert.ok(codes.includes('EXCEEDS_TOTAL_FLOORS'));
  assert.ok(codes.includes('EXCEEDS_ROOMS'));
});

test('portal-specific limits: MyHome photo ceiling and Georgian description', () => {
  const many = { ...complete(), photos: Array.from({ length: 17 }, (_, i) => `0b5c1e44-4f3a-4b8e-9a51-0e7d6c2b9f${String(i).padStart(2, '0')}`) };
  const v = validateListing(many);
  assert.equal(v.ready, true);
  assert.deepEqual(v.portals.myhome.map((p) => p.code), ['TOO_MANY_PHOTOS']);
  assert.deepEqual(v.portals.ssge, []);
  const english = validateListing({ ...complete(), description: { ka: '', en: 'Apartment', ru: '' } });
  assert.deepEqual(english.portals.myhome.map((p) => `${p.field}:${p.code}`), ['description.ka:REQUIRED_BY_PORTAL']);
});

test('the registry lists eight portals and never claims an API, account connection or automated submission', () => {
  const reg = publicRegistry();
  assert.deepEqual(reg.map((p) => p.id), ['myhome', 'ssge', 'placege', 'homege', 'brokeri', 'korter', 'binebi', 'allhome']);
  for (const p of reg) {
    assert.equal(p.publishing, 'MANUAL_HANDOFF');
    assert.equal(p.capabilities.accountConnection, false);
    assert.equal(p.capabilities.apiPublishing, false);
    assert.equal(p.capabilities.manualHandoff, true);
    assert.equal('externalId' in p, false);
    assert.equal('evidence' in p, false, 'research notes stay admin-side');
  }
  assert.equal(reg.find((p) => p.id === 'korter').verification, 'OWNER_CONFIRMED');
  assert.equal(reg.find((p) => p.id === 'binebi').verification, 'OWNER_CONFIRMED');
});

test('external URLs: portal domain, https, and a listing id are all required', () => {
  assert.equal(parseExternalUrl(null, 'https://www.myhome.ge/pr/1').error, 'PORTAL_UNKNOWN');
  assert.deepEqual(parseExternalUrl(P.myhome, 'https://www.myhome.ge/ka/pr/18234567/iyideba-bina?utm=1#x'), { url: 'https://www.myhome.ge/ka/pr/18234567/iyideba-bina', externalId: '18234567' });
  assert.equal(parseExternalUrl(P.ssge, 'https://home.ss.ge/ka/udzravi-qoneba/iyideba-3-otaxiani-bina-vakeshi-31234567').externalId, '31234567');
  assert.equal(parseExternalUrl(P.myhome, 'http://www.myhome.ge/pr/18234567').error, 'HTTPS_PORTAL_URL_REQUIRED');
  assert.equal(parseExternalUrl(P.myhome, 'https://myhome.ge.evil.test/pr/18234567').error, 'URL_NOT_ON_PORTAL');
  assert.equal(parseExternalUrl(P.myhome, 'https://evilmyhome.ge/pr/18234567').error, 'URL_NOT_ON_PORTAL');
  assert.equal(parseExternalUrl(P.myhome, 'https://user:pw@www.myhome.ge/pr/18234567').error, 'HTTPS_PORTAL_URL_REQUIRED');
  assert.equal(parseExternalUrl(P.myhome, 'https://www.myhome.ge/ka/s/').error, 'LISTING_ID_NOT_FOUND_IN_URL');
  assert.equal(parseExternalUrl(P.ssge, 'https://www.myhome.ge/pr/18234567').error, 'URL_NOT_ON_PORTAL');
  assert.equal(parseExternalUrl(P.myhome, 'not a url').error, 'INVALID_URL');
});

test('only a 200 that contains the listing id is LIVE; only 404/410 is GONE', () => {
  assert.deepEqual(classifyCheck({ status: 200, body: '<div>18234567</div>', externalId: '18234567' }), { result: 'LIVE' });
  assert.equal(classifyCheck({ status: 200, body: '<h1>Search results</h1>', externalId: '18234567' }).result, 'UNKNOWN');
  assert.equal(classifyCheck({ status: 404, externalId: '1' }).result, 'GONE');
  assert.equal(classifyCheck({ status: 410, externalId: '1' }).result, 'GONE');
  assert.deepEqual(classifyCheck({ status: 'ROBOTS_DISALLOWED', externalId: '1' }), { result: 'UNKNOWN', code: 'ROBOTS_DISALLOWED' });
  for (const status of [403, 429, 500, 'TIMEOUT', 'NETWORK', 'REDIRECT_OFF_PORTAL', 302]) assert.equal(classifyCheck({ status, externalId: '1' }).result, 'UNKNOWN', String(status));
});

test('PUBLISHED is reachable only through LINK followed by a LIVE check', () => {
  const prepared = transition(null, { type: 'PREPARE', listingVersion: 1 }, NOW);
  assert.equal(prepared.set.status, 'HANDOFF_READY');
  // No command other than CHECK(LIVE) from VERIFYING produces PUBLISHED.
  for (const status of ['HANDOFF_READY', 'VERIFICATION_FAILED', 'UNPUBLISHED', 'REMOVED_EXTERNALLY', 'UNPUBLISH_REQUESTED']) {
    for (const cmd of [{ type: 'PREPARE', listingVersion: 2 }, { type: 'RETRY' }, { type: 'REQUEST_UNPUBLISH' }, { type: 'CONFIRM_REMOVED' }, { type: 'MARK_UPDATED', listingVersion: 2 }]) {
      const r = transition(pub({ status, external_id: '1', external_url: 'https://www.myhome.ge/pr/1' }), cmd, NOW);
      assert.notEqual(r.set?.status, 'PUBLISHED', `${status} + ${cmd.type}`);
    }
  }
  const linked = transition(pub(), { type: 'LINK', url: 'https://www.myhome.ge/pr/18234567', externalId: '18234567', listingVersion: 1 }, NOW);
  assert.equal(linked.set.status, 'VERIFYING');
  const verifying = pub({ ...linked.set });
  assert.equal(transition(verifying, { type: 'CHECK', outcome: { result: 'UNKNOWN', code: 'PORTAL_BLOCKED_CHECK' } }, NOW).set.status, undefined, 'inconclusive stays VERIFYING');
  const live = transition(verifying, { type: 'CHECK', outcome: { result: 'LIVE' } }, NOW);
  assert.equal(live.set.status, 'PUBLISHED');
  assert.equal(live.set.published_at, NOW.toISOString());
});

test('the six new portals parse their own listing URLs and nothing else', () => {
  const cases = [
    ['placege', 'https://place.ge/ge/ads/view/912345', '912345'],
    ['homege', 'https://www.home.ge/iyideba/bina/3-otakhiani-bina-tbilisi-vake-1234567.html', '1234567'],
    ['brokeri', 'https://brokeri.ge/property/3-otaxiani-bina-vakeshi/45678', '45678'],
    ['allhome', 'https://www.allhome.ge/binebis-kidva-gakidva-2345678-10.html', '2345678'],
    ['korter', 'https://korter.ge/ka/some-complex-tbilisi/4521', '4521'],
    ['binebi', 'https://binebi.ge/ka/listing/88123', '88123'],
  ];
  for (const [id, url, externalId] of cases) {
    assert.equal(parseExternalUrl(P[id], url).externalId, externalId, id);
    assert.equal(parseExternalUrl(P[id], 'https://www.myhome.ge/pr/18234567').error, 'URL_NOT_ON_PORTAL', `${id} refuses another portal`);
    assert.equal(parseExternalUrl(P[id], url.replace('https:', 'http:')).error, 'HTTPS_PORTAL_URL_REQUIRED', `${id} https`);
    assert.equal(parseExternalUrl(P[id], url.replace(/^https:\/\/([^/]+)/, 'https://$1:8443')).error, 'HTTPS_PORTAL_URL_REQUIRED', `${id} port`);
  }
  assert.equal(parseExternalUrl(P.placege, 'https://place.ge/ge/ads').error, 'LISTING_ID_NOT_FOUND_IN_URL');
  assert.equal(parseExternalUrl(P.homege, 'https://www.home.ge/iyideba/bina/').error, 'LISTING_ID_NOT_FOUND_IN_URL');
});

test('owner-confirmed portals: the owner\'s statement sets OWNER_CONFIRMED, never PUBLISHED, and is never checked', () => {
  const linked = transition(pub(), { type: 'LINK', url: 'https://korter.ge/x/4521', externalId: '4521', listingVersion: 1, verification: 'OWNER_CONFIRMED' }, NOW);
  assert.equal(linked.set.status, 'OWNER_CONFIRMED');
  assert.equal(linked.kind, 'PUBLICATION_ATTESTED_BY_OWNER');
  assert.equal(linked.set.next_check_at, null);
  const confirmed = pub({ ...linked.set });
  assert.equal(transition(confirmed, { type: 'CHECK', outcome: { result: 'LIVE' } }, NOW).error, 'NOTHING_TO_CHECK');
  assert.equal(transition(confirmed, { type: 'PREPARE', listingVersion: 2 }, NOW).error, 'PUBLICATION_ALREADY_ACTIVE');
  const unpublishing = transition(confirmed, { type: 'REQUEST_UNPUBLISH' }, NOW);
  assert.equal(unpublishing.set.status, 'UNPUBLISH_REQUESTED');
  assert.equal(unpublishing.set.next_check_at, null, 'no check is scheduled for a portal that cannot be checked');
  assert.equal(transition(pub({ ...confirmed, ...unpublishing.set }), { type: 'CONFIRM_REMOVED' }, NOW).set.status, 'UNPUBLISHED');
  assert.equal(transition(confirmed, { type: 'MARK_UPDATED', listingVersion: 2 }, NOW).set.next_check_at, undefined);
});

test('LINK requires a prepared handoff', () => {
  assert.equal(transition(null, { type: 'LINK', url: 'u', externalId: '1', listingVersion: 1 }, NOW).error, 'PREPARE_FIRST');
  assert.equal(transition(pub({ status: 'PUBLISHED' }), { type: 'LINK', url: 'u', externalId: '1', listingVersion: 1 }, NOW).error, 'PREPARE_FIRST');
});

test('repeat clicks are idempotent and a live publication cannot be re-prepared', () => {
  assert.equal(transition(pub(), { type: 'PREPARE', listingVersion: 1 }, NOW).error, 'NO_CHANGE');
  for (const status of ['VERIFYING', 'PUBLISHED', 'UNPUBLISH_REQUESTED']) {
    assert.equal(transition(pub({ status }), { type: 'PREPARE', listingVersion: 2 }, NOW).error, 'PUBLICATION_ALREADY_ACTIVE');
  }
});

test('checks are rate-limited with exponential backoff and give up after the attempt limit', () => {
  assert.equal(backoffMs(0), 60_000);
  assert.equal(backoffMs(3), 480_000);
  assert.equal(backoffMs(30), 6 * 3_600_000);
  const soon = pub({ status: 'VERIFYING', external_id: '1', next_check_at: new Date(NOW.getTime() + 1000).toISOString() });
  assert.equal(transition(soon, { type: 'CHECK', outcome: { result: 'LIVE' } }, NOW).error, 'CHECK_TOO_SOON');
  const last = pub({ status: 'VERIFYING', external_id: '1', check_attempts: MAX_VERIFY_ATTEMPTS - 1 });
  const failed = transition(last, { type: 'CHECK', outcome: { result: 'UNKNOWN', code: 'PORTAL_TIMEOUT' } }, NOW);
  assert.equal(failed.set.status, 'VERIFICATION_FAILED');
  assert.equal(failed.set.last_error, 'PORTAL_TIMEOUT');
  const retried = transition(pub({ ...last, ...failed.set, external_url: 'https://www.myhome.ge/pr/1' }), { type: 'RETRY' }, NOW);
  assert.equal(retried.set.status, 'VERIFYING');
  assert.equal(retried.set.check_attempts, 0);
});

test('sync: an inconclusive check never demotes a confirmed publication; a 404 marks it removed', () => {
  const live = pub({ status: 'PUBLISHED', external_id: '1' });
  assert.equal(transition(live, { type: 'CHECK', outcome: { result: 'UNKNOWN', code: 'PORTAL_ERROR' } }, NOW).set.status, undefined);
  assert.equal(transition(live, { type: 'CHECK', outcome: { result: 'GONE', code: 'HTTP_404' } }, NOW).set.status, 'REMOVED_EXTERNALLY');
});

test('unpublish is confirmed by the portal page disappearing, or attested by the owner — labelled as such', () => {
  const req = transition(pub({ status: 'PUBLISHED', external_id: '1' }), { type: 'REQUEST_UNPUBLISH' }, NOW);
  assert.equal(req.set.status, 'UNPUBLISH_REQUESTED');
  const pending = pub({ status: 'UNPUBLISH_REQUESTED', external_id: '1' });
  assert.equal(transition(pending, { type: 'CHECK', outcome: { result: 'LIVE' } }, NOW).set.status, undefined);
  assert.equal(transition(pending, { type: 'CHECK', outcome: { result: 'GONE', code: 'HTTP_404' } }, NOW).set.status, 'UNPUBLISHED');
  const attested = transition(pending, { type: 'CONFIRM_REMOVED' }, NOW);
  assert.equal(attested.set.status, 'UNPUBLISHED');
  assert.equal(attested.kind, 'REMOVAL_ATTESTED_BY_OWNER');
  assert.equal(transition(pub({ status: 'PUBLISHED' }), { type: 'CONFIRM_REMOVED' }, NOW).error, 'NOT_UNPUBLISHING');
});

test('editing after publication: the portal copy is flagged until marked updated', () => {
  const live = pub({ status: 'PUBLISHED', external_id: '1', listing_version: 1 });
  assert.equal(transition(live, { type: 'MARK_UPDATED', listingVersion: 1 }, NOW).error, 'NO_CHANGE');
  const updated = transition(live, { type: 'MARK_UPDATED', listingVersion: 3 }, NOW);
  assert.equal(updated.set.listing_version, 3);
  assert.equal(updated.set.status, undefined, 'stays PUBLISHED, re-checked next');
});
