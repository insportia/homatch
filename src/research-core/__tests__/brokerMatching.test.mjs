// BROKERS AND AGENCIES AS MATCH PARTICIPANTS, AND WHAT A CUSTOMER IS TOLD ABOUT THEM.
//
// participants.test.mjs proves the relationship table in general and
// brokerIdentity.test.mjs proves identity and directory standing. What neither did
// was follow a BROKER or an AGENCY through the whole path a match takes:
//
//   can it transact with every demand role that should reach it, in every deal kind
//   that role does -- the list only had BUYER/BROKER/SALE and three AGENCY cases;
//
//   does the matcher reach the same answer from both ends when the supply side is a
//   broker -- the symmetry test used a LANDLORD fixture only;
//
//   is the dedup contract (key_kind, natural_key) the one the database enforces and
//   the one discovery writes on -- a normaliser that dedups in memory is worthless if
//   the insert keys on something else;
//
//   are provenance and freshness carried to the customer read, and never a claim.
//
// The last group reads source rather than running it, for the same reason
// brokerSeparation does: the failure is a data flow being cut, and that is visible in
// the source and nowhere else without a database.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assessMatch, rankDemandForSupply, rankSupplyForDemand } from '../match/compatibility.ts';
import { canTransact, dealsFor, supplyRoleFrom } from '../match/participants.ts';
import {
  BROKER_ROLES, brokerIdentityFrom, directoryStandingOf, discloseBroker,
} from '../match/broker-identity.ts';
import { attributionFrom } from '../match/broker-attribution.ts';
import { stripComments } from '../../../scripts/lib/stripComments.mjs';

const ROOT = process.cwd();
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const NOW = new Date('2026-09-27T12:00:00Z');

/* ────────────────────────────────────────────────────────────────────────
 * 1. A broker transacts wherever an intermediary can
 * ──────────────────────────────────────────────────────────────────────── */

test('AGENCY and BROKER transact with every demand role, in every deal that role does', () => {
  /*
   * An intermediary sits on every side of the market: it sells, it lets, it lets for
   * nights, and it sells to investors. A missing pairing here silently drops every
   * agency listing from somebody's results.
   */
  for (const demand of ['BUYER', 'TENANT', 'GUEST', 'INVESTOR']) {
    for (const supply of BROKER_ROLES) {
      for (const deal of dealsFor(demand)) {
        const result = canTransact(demand, supply, deal);
        assert.equal(result.verdict, 'CAN_TRANSACT',
          `${demand}/${supply}/${deal} must transact: ${result.reason}`);
        assert.deepEqual(result.deals, [deal]);
      }
    }
  }
});

test('a broker does not make an impossible deal possible', () => {
  /* Being an intermediary is not a wildcard: a rental listing is still not a sale. */
  for (const supply of BROKER_ROLES) {
    assert.equal(canTransact('TENANT', supply, 'SALE').verdict, 'CANNOT_TRANSACT');
    assert.equal(canTransact('BUYER', supply, 'RENT').verdict, 'CANNOT_TRANSACT');
    assert.equal(canTransact('GUEST', supply, 'RENT').verdict, 'CANNOT_TRANSACT');
  }
});

test('the listing words for an intermediary resolve to a broker role', () => {
  assert.equal(supplyRoleFrom('AGENCY'), 'AGENCY');
  assert.equal(supplyRoleFrom('BROKER'), 'BROKER');
  assert.equal(supplyRoleFrom('Риелтор'), 'AGENCY');
  assert.equal(supplyRoleFrom('სააგენტო'), 'AGENCY');
  assert.equal(supplyRoleFrom('посредник'), 'BROKER');
});

/* ────────────────────────────────────────────────────────────────────────
 * 2. The matcher, with a broker on the supply side, from both ends
 * ──────────────────────────────────────────────────────────────────────── */

const tenant = (o = {}) => ({
  role: 'TENANT', transactionType: 'RENT', city: 'Tbilisi', district: 'Saburtalo',
  propertyTypes: ['APARTMENT'], budgetMin: 400, budgetMax: 900, currency: 'USD',
  areaMin: 40, areaMax: 80, bedroomsMin: 1, bedroomsMax: 2, ...o,
});
const agencyFlat = (o = {}) => ({
  role: 'AGENCY', transaction: 'RENT', city: 'Tbilisi', district: 'Saburtalo',
  propertyType: 'APARTMENT', saleAmount: null, saleCurrency: null,
  rentAmount: 800, rentCurrency: 'USD', areaSqm: 51, bedrooms: 1, rooms: 2, ...o,
});

test('an agency listing matches a tenant, and PARTICIPANTS says so', () => {
  const a = assessMatch(tenant(), agencyFlat());
  assert.equal(a.compatibility, 'COMPATIBLE');
  assert.deepEqual(a.roles, { demand: 'TENANT', supply: 'AGENCY' });
  const participants = a.dimensions.find((d) => d.dimension === 'PARTICIPANTS');
  assert.equal(participants?.verdict, 'AGREE');
  assert.equal(a.deal, 'RENT');
});

test('a broker listing reaches the same verdict from either end', () => {
  const broker = agencyFlat({ role: 'BROKER' });
  const fromSupply = rankDemandForSupply(broker, [{ demand: tenant(), key: 'd' }]);
  const fromDemand = rankSupplyForDemand(tenant(), [{ supply: broker, key: 's' }]);
  assert.equal(fromSupply.length, 1);
  assert.equal(fromDemand.length, 1);
  assert.equal(fromSupply[0].assessment.score, fromDemand[0].assessment.score);
  assert.equal(fromSupply[0].assessment.roles.supply, 'BROKER');
});

test('a broker selling is not shown to a renter, from either end', () => {
  const sale = agencyFlat({ role: 'BROKER', transaction: 'SALE', saleAmount: 120000, saleCurrency: 'USD', rentAmount: null, rentCurrency: null });
  assert.equal(assessMatch(tenant(), sale).compatibility, 'INCOMPATIBLE');
  assert.equal(rankDemandForSupply(sale, [{ demand: tenant(), key: 'd' }]).length, 0);
  assert.equal(rankSupplyForDemand(tenant(), [{ supply: sale, key: 's' }]).length, 0);
});

/* ────────────────────────────────────────────────────────────────────────
 * 3. Dedup: one contract, in memory and in the database
 * ──────────────────────────────────────────────────────────────────────── */

test('one firm seen on two portals is one (key_kind, natural_key)', () => {
  const a = attributionFrom({
    title: 'სააგენტო გთავაზობთ ბინას', description: 'agency listing, call +995 555 12 34 56',
    canonicalUrl: 'https://myhome.ge/en/pr/1/',
  });
  const b = attributionFrom({
    title: 'Агентство сдаёт квартиру', description: 'агентство недвижимости, звоните 0555123456',
    canonicalUrl: 'https://ss.ge/en/real-estate/2',
  });
  assert.ok(a.identity && b.identity, 'guard: both sightings must carry an identity');
  assert.deepEqual([a.identity.kind, a.identity.value], [b.identity.kind, b.identity.value]);
});

test('the database and discovery dedup on the same key', () => {
  const migration = read('supabase', 'migrations', '20260926270000_broker_intelligence_and_directory.sql');
  assert.match(migration, /constraint broker_intelligence_identity unique \(key_kind, natural_key\)/);
  assert.match(migration, /unique \(broker_id, source_id, key_kind, natural_key\)/);

  const discovery = stripComments(read('supabase', 'functions', 'supply-discovery', 'index.ts'));
  /* Looked up by the identity before inserting... */
  assert.match(discovery, /\.eq\('key_kind', strongest\.kind\)\s*\.eq\('natural_key', strongest\.value\)/);
  /* ...and the lineage upserted on the declared identity, so a re-read moves
     last_seen_at rather than adding a row. */
  assert.match(discovery, /onConflict: 'broker_id,source_id,key_kind,natural_key'/);
  /* A display name never becomes the key. */
  assert.equal(brokerIdentityFrom({ displayName: 'Tbilisi Real Estate' }), null);
});

/* ────────────────────────────────────────────────────────────────────────
 * 4. Provenance and freshness reach the customer; a claim never does
 * ──────────────────────────────────────────────────────────────────────── */

test('a first sighting is recorded as unverified, with both clocks set', () => {
  const discovery = stripComments(read('supabase', 'functions', 'supply-discovery', 'index.ts'));
  const insert = discovery.slice(discovery.indexOf(".from('broker_intelligence').insert({"));
  const body = insert.slice(0, insert.indexOf('})'));
  assert.match(body, /first_seen_at: input\.now/);
  assert.match(body, /last_seen_at: input\.now/);
  assert.match(body, /last_verified_at: null/);
  assert.match(body, /validation_state: 'UNVERIFIED'/);
});

test('the customer read carries provenance and freshness, derived from stored counts', () => {
  const read_ = stripComments(read('supabase', 'functions', 'find-property', 'index.ts'));
  for (const field of [
    /seenOnSources: broker\.source_count/,
    /listingsAttributed: broker\.observation_count/,
    /lastSeenAt: broker\.last_seen_at/,
    /validationState: broker\.validation_state \?\? 'UNVERIFIED'/,
  ]) {
    assert.match(read_, field);
  }
});

test('a discovered broker counterparty is never presented as registered, verified or paid', () => {
  const standing = directoryStandingOf(null, NOW);
  const disclosure = discloseBroker(standing);
  assert.equal(disclosure.registeredWithHomatch, false);
  assert.equal(disclosure.labelKey, 'broker_disclosure_observed');

  /*
   * The observed label must NEGATE the relationship in every language, not merely
   * omit it -- a label that says only "Seen in the market" next to a firm name reads
   * as an endorsement on a results screen.
   */
  const translations = read('src', 'i18n', 'translations.ts');
  const values = [...translations.matchAll(/^ {2}broker_disclosure_observed: '([^']+)'/gm)].map((m) => m[1]);
  assert.equal(values.length, 6);
  const NEGATION = [/not registered/i, /არ არის/, /не зарегистрирован/i, /kaydı yok|kayıtlı değil/i, /غير مسجَّل/, /לא רשום/];
  for (const [i, value] of values.entries()) {
    assert.ok(NEGATION.some((re) => re.test(value)), `observed label without a negation: ${value}`);
  }
});

test('customer screens take a broker’s standing from the disclosure, never from a literal', () => {
  /*
   * The directory badge key may appear on the directory page, which reads only the
   * paid view. Anywhere else on a customer screen it would be a claim made without
   * asking directoryStandingOf.
   */
  const results = stripComments(read('src', 'pages', 'FindPropertyPage.tsx'));
  assert.match(results, /standing: t\(broker\.labelKey as never\)/);
  assert.doesNotMatch(results, /broker_disclosure_directory/);
  const card = stripComments(read('src', 'components', 'customer', 'ListingCard.tsx'));
  assert.doesNotMatch(card, /broker_disclosure_directory|registered|verified/i);
});
