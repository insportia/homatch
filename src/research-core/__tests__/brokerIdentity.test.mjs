// A BROKER WE FOUND IS NOT A BROKER WHO PAID US.
//
// The two properties under test, in order of how much damage they do when broken:
//
//   1. No discovered broker can reach LISTED_ACTIVE. Not by having a name, not by
//      being matched, not by being observed on four portals. The only route to a
//      directory standing is a registration with an owning account and a current
//      paid-until, and `directoryStandingOf` is the only function that returns one.
//
//   2. Identity is stable and dedups, and is never derived from a display name.
//      "Tbilisi Real Estate" is several companies; merging them would attribute one
//      firm's listings to another, which is worse than holding two records.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BROKER_ROLES,
  IDENTITY_PRECEDENCE,
  brokerIdentityFrom,
  brokerKeysFrom,
  directoryStandingOf,
  discloseBroker,
  isBrokerRole,
  mayAppearInDirectory,
} from '../match/broker-identity.ts';
import { attributionFrom } from '../match/broker-attribution.ts';
import { supplyRoleFrom } from '../match/participants.ts';
import { sellerTypeFrom } from '../market/listingExtract.ts';

const NOW = new Date('2026-09-26T12:00:00Z');

/* ────────────────────────────────────────────────────────────────────────
 * 1. Discovery is not registration
 * ──────────────────────────────────────────────────────────────────────── */

test('a broker we merely discovered is NOT_LISTED', () => {
  assert.equal(directoryStandingOf(null, NOW), 'NOT_LISTED');
  assert.equal(directoryStandingOf(undefined, NOW), 'NOT_LISTED');
  assert.equal(mayAppearInDirectory('NOT_LISTED'), false);
});

test('a discovered broker is disclosed as market intelligence, never as registered', () => {
  const disclosure = discloseBroker('NOT_LISTED');
  assert.equal(disclosure.presentation, 'MARKET_INTELLIGENCE');
  assert.equal(disclosure.registeredWithHomatch, false);
  /* An i18n key, not a sentence: the distinction has to survive six languages. */
  assert.match(disclosure.labelKey, /^broker_disclosure_/);
});

test('only an ACTIVE registration with a current paid_until may appear', () => {
  const base = { brokerId: 'b1', ownerUserId: 'u1' };

  assert.equal(
    directoryStandingOf({ ...base, status: 'ACTIVE', paidUntil: '2026-12-01T00:00:00Z' }, NOW),
    'LISTED_ACTIVE',
  );
  assert.equal(mayAppearInDirectory('LISTED_ACTIVE'), true);

  /* Every other combination is not a listing. */
  for (const listing of [
    { ...base, status: 'PENDING_REVIEW', paidUntil: '2026-12-01T00:00:00Z' },
    { ...base, status: 'SUSPENDED', paidUntil: '2026-12-01T00:00:00Z' },
    { ...base, status: 'EXPIRED', paidUntil: '2026-12-01T00:00:00Z' },
    { ...base, status: 'ACTIVE', paidUntil: null },
    { ...base, status: 'ACTIVE', paidUntil: 'not a date' },
    { ...base, status: 'ACTIVE', paidUntil: '2026-09-01T00:00:00Z' },
  ]) {
    const standing = directoryStandingOf(listing, NOW);
    assert.equal(standing, 'LISTED_INACTIVE',
      `${listing.status}/${listing.paidUntil} must not be a current listing`);
    assert.equal(mayAppearInDirectory(standing), false);
  }
});

test('the paid-until boundary is exclusive, so a lapsed listing lapses', () => {
  const at = new Date('2026-09-26T12:00:00Z');
  const exactly = { brokerId: null, ownerUserId: 'u1', status: 'ACTIVE', paidUntil: at.toISOString() };
  assert.equal(directoryStandingOf(exactly, at), 'LISTED_INACTIVE',
    'paid until exactly now is no longer paid');
  assert.equal(
    directoryStandingOf({ ...exactly, paidUntil: '2026-09-26T12:00:01Z' }, at),
    'LISTED_ACTIVE',
  );
});

test('an expired registration is presented exactly like an observed firm', () => {
  /*
   * NOT a third visual state, and not a faded badge. A lapsed payment keeping a
   * "registered" mark is the same lie as inventing one.
   */
  const lapsed = discloseBroker('LISTED_INACTIVE');
  const observed = discloseBroker('NOT_LISTED');
  assert.deepEqual(lapsed, observed);
  assert.equal(lapsed.registeredWithHomatch, false);
});

/* ────────────────────────────────────────────────────────────────────────
 * 2. Identity
 * ──────────────────────────────────────────────────────────────────────── */

test('a display name is never an identity', () => {
  assert.equal(brokerIdentityFrom({ displayName: 'Tbilisi Real Estate' }), null);
  assert.deepEqual(brokerKeysFrom({ displayName: 'Tbilisi Real Estate' }), []);
});

test('the same Georgian phone written three ways is one broker', () => {
  const forms = ['555 12 34 56', '0555123456', '+995 555 123 456', '995555123456'];
  const keys = forms.map((phone) => brokerIdentityFrom({ phone }));
  for (const [index, key] of keys.entries()) {
    assert.ok(key, `form ${forms[index]} produced no key`);
    assert.equal(key.kind, 'PHONE');
  }
  const distinct = new Set(keys.map((k) => k.value));
  assert.equal(distinct.size, 1, `four spellings became ${distinct.size} brokers: ${[...distinct]}`);
  assert.equal([...distinct][0], '+995555123456');
});

test('a portal host is not a broker identity', () => {
  /*
   * myhome.ge appears in the contact block of tens of thousands of listings. One
   * broker record holding the entire market is worse than none.
   */
  for (const website of ['myhome.ge', 'www.myhome.ge', 'https://ss.ge/en/real-estate', 't.me']) {
    assert.equal(brokerIdentityFrom({ website }), null, `${website} must not be an identity`);
  }
  const real = brokerIdentityFrom({ website: 'https://www.Example-Agency.GE/contact' });
  assert.deepEqual(
    { kind: real?.kind, value: real?.value },
    { kind: 'DOMAIN', value: 'example-agency.ge' },
  );
});

test('a listing URL is never a broker key', () => {
  /*
   * Every listing has a different canonical URL. Keying a broker on it would give
   * every listing its own broker and dedup would do nothing whatsoever.
   */
  const attribution = attributionFrom({
    title: 'Agency sale',
    description: 'agency listing, call 555123456',
    canonicalUrl: 'https://myhome.ge/en/pr/12345678/',
  });
  assert.ok(attribution.identity);
  assert.equal(attribution.identity.kind, 'PHONE');
  for (const key of attribution.keys) {
    assert.notEqual(key.kind, 'PROFILE_URL');
    assert.ok(!key.value.includes('12345678'), 'the listing id leaked into an identity');
  }
});

test('a stronger key wins, and the weaker ones are still kept', () => {
  const keys = brokerKeysFrom({
    phone: '+995555123456',
    website: 'example-agency.ge',
    telegram: '@example_agency',
    companyId: '405123456',
  });
  assert.deepEqual(keys.map((k) => k.kind), ['COMPANY_ID', 'DOMAIN', 'TELEGRAM', 'PHONE']);
  assert.equal(brokerIdentityFrom({
    phone: '+995555123456', website: 'example-agency.ge',
  }).kind, 'DOMAIN');

  /* Precedence is declared once and the order above must follow it. */
  const declared = IDENTITY_PRECEDENCE.filter((kind) => keys.some((k) => k.kind === kind));
  assert.deepEqual(keys.map((k) => k.kind), declared);
});

test('a telegram handle normalises out of every form it is written in', () => {
  for (const telegram of ['@Example_Agency', 'example_agency', 'https://t.me/Example_Agency',
    't.me/example_agency/', 'telegram.me/Example_Agency']) {
    const key = brokerIdentityFrom({ telegram });
    assert.ok(key, `${telegram} produced no key`);
    assert.equal(key.value, 'example_agency');
  }
  /* Too short to be a handle at all. */
  assert.equal(brokerIdentityFrom({ telegram: '@abc' }), null);
});

test('only AGENCY and BROKER are broker roles', () => {
  assert.deepEqual([...BROKER_ROLES], ['AGENCY', 'BROKER']);
  assert.equal(isBrokerRole('AGENCY'), true);
  assert.equal(isBrokerRole('BROKER'), true);
  for (const role of ['SELLER', 'LANDLORD', 'DEVELOPER', null, undefined]) {
    assert.equal(isBrokerRole(role), false, `${role} is not a broker`);
  }
});

/* ────────────────────────────────────────────────────────────────────────
 * 3. Attribution — the negative rule first
 * ──────────────────────────────────────────────────────────────────────── */

test('"no agents please" is not an agency listing', () => {
  /*
   * The single most important case in this file. This phrasing is one of the most
   * common sentences in Georgian portal descriptions, in all three languages, and a
   * keyword scan reads every one of them as a firm that is not involved.
   */
  const cases = [
    'Owner selling, no agents please. 555123456',
    'Продаю сам, без посредников, риелторам не звонить',
    'მესაკუთრე ყიდის, შუამავლების გარეშე',
    'Direct from owner, without an agency',
  ];
  for (const description of cases) {
    const attribution = attributionFrom({ description });
    assert.equal(attribution.excludesIntermediaries, true, `not detected: ${description}`);
    assert.notEqual(attribution.role, 'AGENCY', `read as an agency: ${description}`);
    assert.notEqual(attribution.role, 'BROKER', `read as a broker: ${description}`);
    /* And no contact detail was harvested from a private individual. */
    assert.deepEqual(attribution.evidence, {}, `contact details taken from: ${description}`);
    assert.equal(attribution.identity, null);
  }
});

test('an owner who excludes agents still reads as an owner', () => {
  const attribution = attributionFrom({ description: 'Owner selling, no agents please.' });
  assert.equal(attribution.role, 'SELLER');
  assert.match(attribution.reason, /excludes intermediaries/);
});

test('an agency listing yields AGENCY and a usable identity', () => {
  const attribution = attributionFrom({
    title: 'Apartment for sale in Vake',
    description: 'Listed by our agency. Call +995 322 12 34 56 or visit example-agency.ge',
  });
  assert.equal(attribution.role, 'AGENCY');
  assert.equal(attribution.excludesIntermediaries, false);
  assert.equal(attribution.identity.kind, 'DOMAIN');
  assert.equal(attribution.identity.value, 'example-agency.ge');
  assert.equal(attribution.evidence.phone, '+995 322 12 34 56');
});

test('a realtor is an agency in both vocabularies', () => {
  /*
   * listingExtract has classified these as a BROKER seller type since it was
   * written; supplyRoleFrom did not know either word, so the role — the half the
   * matcher actually reads — came back null.
   */
  for (const word of ['риелтор', 'риэлтор', 'რიელტორი', 'realtor']) {
    assert.equal(sellerTypeFrom(word), 'BROKER', `${word} is not a broker seller type`);
    assert.equal(supplyRoleFrom(word), 'AGENCY', `${word} has no supply role`);
    assert.equal(attributionFrom({ description: `${word} sells` }).role, 'AGENCY');
  }
});

test('a developer is not read as an agency', () => {
  for (const description of ['Direct from the developer', 'От застройщика', 'დეველოპერი ყიდის']) {
    assert.equal(attributionFrom({ description }).role, 'DEVELOPER', description);
  }
});

test('a listing that says nothing about who is offering gets no role', () => {
  const attribution = attributionFrom({
    title: '2 bedroom apartment, Saburtalo',
    description: '75 sqm, 4th floor, renovated, $120 000',
  });
  assert.equal(attribution.role, null);
  assert.equal(attribution.reason, '');
  assert.equal(attribution.identity, null);
});

test('a price is not a phone number', () => {
  /*
   * Nine-digit-ish runs are everywhere in a listing. Turning $120 000 000 into a
   * broker identity would merge every expensive flat into one firm.
   */
  const attribution = attributionFrom({
    description: 'Agency listing. Price $120 000 000 GEL, area 155 000 000 m2, cadastral 01.14.15.023',
  });
  assert.equal(attribution.role, 'AGENCY');
  assert.equal(attribution.evidence.phone, undefined,
    `a number in the price or area was read as a phone: ${attribution.evidence.phone}`);
});

test('contact details are only collected for brokers, never for private owners', () => {
  const owner = attributionFrom({
    description: 'Owner selling. Call me on 555123456, telegram @private_person_ge',
  });
  assert.equal(owner.role, 'SELLER');
  assert.deepEqual(owner.evidence, {},
    'a private individual’s phone and handle were harvested into an identity store');
});

test('attribution is deterministic', () => {
  const listing = {
    title: 'Agency: flat in Vake',
    description: 'our agency, 555 12 34 56, example-agency.ge, @example_agency',
  };
  const first = attributionFrom(listing);
  const second = attributionFrom(listing);
  assert.deepEqual(first, second);
});
