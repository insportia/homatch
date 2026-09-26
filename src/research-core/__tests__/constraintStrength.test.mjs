// "IT MUST BE IN SABURTALO" AND "I WOULD RATHER BE IN SABURTALO" ARE DIFFERENT.
//
// Before this, they were the same sentence. A matcher that only had CONFLICT and
// AGREE had to choose between rejecting a perfectly good Vake flat and pretending
// the preference had never been expressed, and both are wrong in a way the customer
// notices.
//
// So four verdicts, and four things they must keep apart:
//
//   hard conflict          a REQUIRED constraint is violated -> disqualified
//   preference mismatch    a PREFERRED one is -> reported, ranked lower, still shown
//   explicitly flexible    they said they do not mind -> costs nothing
//   unknown                nobody said -> costs the same as a preference miss, since
//                          an unconfirmed dimension is an unconfirmed dimension
//
// The tests below are mostly about the boundaries: that PREFERRED cannot reject, that
// REQUIRED cannot be talked out of rejecting, and that the one dimension where taste
// is not a thing -- buying versus renting -- refuses to be softened at all.

import test from 'node:test';
import assert from 'node:assert/strict';

import { CONSTRAINT_STRENGTHS, assessMatch } from '../match/compatibility.ts';

const demand = (overrides = {}) => ({
  role: 'TENANT',
  transactionType: 'RENT',
  city: 'Tbilisi',
  district: 'Saburtalo',
  propertyTypes: ['APARTMENT'],
  budgetMin: 400,
  budgetMax: 900,
  currency: 'USD',
  areaMin: 40,
  areaMax: 80,
  bedroomsMin: 1,
  bedroomsMax: 2,
  ...overrides,
});

const supply = (overrides = {}) => ({
  role: 'LANDLORD',
  transaction: 'RENT',
  city: 'Tbilisi',
  district: 'Saburtalo',
  propertyType: 'APARTMENT',
  saleAmount: null,
  saleCurrency: null,
  rentAmount: 800,
  rentCurrency: 'USD',
  areaSqm: 51,
  bedrooms: 1,
  rooms: 2,
  ...overrides,
});

/* ────────────────────────────────────────────────────────────────────────
 * The four are genuinely four
 * ──────────────────────────────────────────────────────────────────────── */

test('the vocabulary is exactly the four the product needs', () => {
  assert.deepEqual([...CONSTRAINT_STRENGTHS], ['REQUIRED', 'PREFERRED', 'FLEXIBLE', 'UNKNOWN']);
});

test('a district they REQUIRED disqualifies the pair', () => {
  const result = assessMatch(
    demand({ strength: { DISTRICT: 'REQUIRED' } }),
    supply({ district: 'Vake' }),
  );
  assert.equal(result.compatibility, 'INCOMPATIBLE');
  assert.deepEqual(result.conflicted, ['DISTRICT']);
  assert.deepEqual(result.preferenceMisses, []);
});

test('a district they only PREFERRED is a reported miss, and still a match', () => {
  // The whole point. A Vake flat that fits everything else is worth showing to
  // somebody who would rather have been in Saburtalo -- with the miss named.
  const result = assessMatch(
    demand({ strength: { DISTRICT: 'PREFERRED' } }),
    supply({ district: 'Vake' }),
  );
  assert.equal(result.compatibility, 'COMPATIBLE');
  assert.deepEqual(result.conflicted, []);
  assert.deepEqual(result.preferenceMisses, ['DISTRICT']);
  assert.match(result.rationale, /Not what they preferred: a different district/);
});

test('a district they are FLEXIBLE about costs nothing at all', () => {
  const flexible = assessMatch(
    demand({ strength: { DISTRICT: 'FLEXIBLE' } }),
    supply({ district: 'Vake' }),
  );
  const exact = assessMatch(demand(), supply());

  assert.equal(flexible.compatibility, 'COMPATIBLE');
  assert.deepEqual(flexible.preferenceMisses, [], 'they said they do not mind');
  assert.equal(
    flexible.score, exact.score,
    'penalising somebody for having answered "I am flexible" is worse than not asking',
  );
  assert.match(
    flexible.dimensions.find((d) => d.dimension === 'DISTRICT').reason,
    /flexible about it/,
    'it must still be recorded, so nobody asks again',
  );
});

test('an unspecified strength behaves exactly as REQUIRED did before', () => {
  // The compatibility guarantee: every existing caller passes no strength map, and
  // must keep getting the old answer rather than a quietly loosened one.
  const noMap = assessMatch(demand(), supply({ district: 'Vake' }));
  const explicit = assessMatch(
    demand({ strength: { DISTRICT: 'REQUIRED' } }),
    supply({ district: 'Vake' }),
  );
  assert.equal(noMap.compatibility, explicit.compatibility);
  assert.deepEqual(noMap.conflicted, explicit.conflicted);
});

/* ────────────────────────────────────────────────────────────────────────
 * A preference miss ranks below a clean match, and above nothing
 * ──────────────────────────────────────────────────────────────────────── */

test('a preference miss ranks a pair below one that missed nothing', () => {
  const clean = assessMatch(demand({ strength: { DISTRICT: 'PREFERRED' } }), supply());
  const missed = assessMatch(
    demand({ strength: { DISTRICT: 'PREFERRED' } }),
    supply({ district: 'Vake' }),
  );
  assert.equal(clean.compatibility, 'COMPATIBLE');
  assert.equal(missed.compatibility, 'COMPATIBLE');
  assert.ok(
    missed.score < clean.score,
    'a recorded preference that was missed must cost something, or recording it was pointless',
  );
});

test('a preference miss on a heavy dimension costs more than on a light one', () => {
  // PRICE matters more to somebody than DISTRICT does. If the weights did not carry
  // through, every miss would cost the same and the ranking would be arbitrary.
  const districtMiss = assessMatch(
    demand({ strength: { DISTRICT: 'PREFERRED' } }),
    supply({ district: 'Vake' }),
  );
  const priceMiss = assessMatch(
    demand({ strength: { PRICE: 'PREFERRED' }, budgetMax: 600 }),
    supply({ rentAmount: 800 }),
  );
  assert.equal(priceMiss.compatibility, 'COMPATIBLE');
  assert.ok(priceMiss.score < districtMiss.score);
});

/* ────────────────────────────────────────────────────────────────────────
 * What strength may never soften
 * ──────────────────────────────────────────────────────────────────────── */

test('marking TRANSACTION as PREFERRED does not show a renter a purchase', () => {
  /*
   * The one dimension where taste is not a thing. A caller that marks it PREFERRED --
   * by mistake, or by generating the strength map from a model -- must not thereby
   * acquire the ability to sell a flat to somebody who wants to rent one.
   */
  const result = assessMatch(
    demand({ strength: { TRANSACTION: 'PREFERRED' }, role: 'TENANT' }),
    supply({
      role: 'SELLER', transaction: 'SALE',
      rentAmount: null, rentCurrency: null,
      saleAmount: 90000, saleCurrency: 'USD',
    }),
  );
  assert.equal(result.compatibility, 'INCOMPATIBLE');
  assert.ok(result.conflicted.includes('TRANSACTION'));
  assert.equal(result.preferenceMisses.includes('TRANSACTION'), false);
});

test('marking TRANSACTION as FLEXIBLE does not either', () => {
  const result = assessMatch(
    demand({ strength: { TRANSACTION: 'FLEXIBLE' }, role: 'TENANT' }),
    supply({
      role: 'SELLER', transaction: 'SALE',
      rentAmount: null, rentCurrency: null,
      saleAmount: 90000, saleCurrency: 'USD',
    }),
  );
  assert.equal(result.compatibility, 'INCOMPATIBLE');
});

test('no strength can make incompatible participants transact', () => {
  // Who the parties are is not a preference. A landlord has nothing to sell a buyer
  // and no strength map changes that.
  for (const strength of CONSTRAINT_STRENGTHS) {
    const result = assessMatch(
      demand({
        role: 'BUYER', transactionType: 'SALE',
        strength: { PARTICIPANTS: strength, TRANSACTION: strength },
      }),
      supply({ role: 'LANDLORD', transaction: 'RENT' }),
    );
    assert.equal(
      result.compatibility, 'INCOMPATIBLE',
      `PARTICIPANTS softened to ${strength} let a landlord serve a buyer`,
    );
    assert.ok(result.conflicted.includes('PARTICIPANTS'));
  }
});

/* ────────────────────────────────────────────────────────────────────────
 * Every dimension carries its strength, so a caller can always tell
 * ──────────────────────────────────────────────────────────────────────── */

test('a mixed strength map is reported dimension by dimension', () => {
  const result = assessMatch(
    demand({
      strength: { DISTRICT: 'PREFERRED', AREA: 'FLEXIBLE', BEDROOMS: 'REQUIRED' },
    }),
    supply({ district: 'Vake' }),
  );
  const byDimension = new Map(result.dimensions.map((d) => [d.dimension, d.strength]));
  assert.equal(byDimension.get('DISTRICT'), 'PREFERRED');
  assert.equal(byDimension.get('AREA'), 'FLEXIBLE');
  assert.equal(byDimension.get('BEDROOMS'), 'REQUIRED');
  assert.equal(byDimension.get('CITY'), 'REQUIRED', 'unlisted defaults to REQUIRED');
});

test('a weak-evidence dimension is UNKNOWN, not a preference miss', () => {
  // Four situations, four answers. Missing information is not a mismatch, and a
  // product that reported it as one would tell a customer their preference was not
  // met when nobody had established anything.
  const result = assessMatch(
    demand({ strength: { PRICE: 'PREFERRED' }, budgetMin: null, budgetMax: null }),
    supply(),
  );
  assert.ok(result.unknown.includes('PRICE'));
  assert.equal(result.preferenceMisses.includes('PRICE'), false);
  assert.equal(result.conflicted.includes('PRICE'), false);
});

/* ────────────────────────────────────────────────────────────────────────
 * The deal and the roles come back on the result
 * ──────────────────────────────────────────────────────────────────────── */

test('the assessment reports which deal and which roles it decided about', () => {
  // So a screen can say "a landlord letting to a tenant" instead of a score.
  const result = assessMatch(demand(), supply());
  assert.equal(result.deal, 'RENT');
  assert.deepEqual(result.roles, { demand: 'TENANT', supply: 'LANDLORD' });
});

test('an investor and a seller disposing of a let flat is a match', () => {
  // The special case run-matching-v2 carried in code, now decided by the table.
  const result = assessMatch(
    demand({
      role: 'INVESTOR', intentType: 'INVESTMENT_INTENT', transactionType: 'SALE',
      budgetMin: null, budgetMax: null,
    }),
    supply({ role: 'SELLER', transaction: 'RENT' }),
  );
  assert.equal(result.compatibility, 'COMPATIBLE');
  assert.equal(result.roles.demand, 'INVESTOR');
  assert.ok(
    result.dimensions.find((d) => d.dimension === 'TRANSACTION').reason
      .includes('investor transacts in both'),
  );
});
