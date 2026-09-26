// ONE COMPARISON, READ FROM BOTH ENDS.
//
// Homatch had FIND BUYERS (a property, scored against enquiries) and nothing for
// FIND PROPERTY (an enquiry, scored against listings). These are the same
// comparison from opposite ends, so the test that matters most is the symmetry one:
// if the two directions can ever disagree about the same pair, the product will
// show a flat to a buyer who is not shown the flat.
//
// The other thing under test throughout is THREE-VALUED honesty. Production rows
// are full of holes -- most intent_profiles have no budget, many
// supply_observations no district, detected_language is null more often than not.
//
//   UNKNOWN treated as AGREE    -> every buyer matches every flat
//   UNKNOWN treated as CONFLICT -> one missing field destroys a real match
//
// Both are wrong, so UNKNOWN stays UNKNOWN and is counted.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assessMatch,
  rankDemandForSupply,
  rankSupplyForDemand,
} from '../match/compatibility.ts';

/** A fully-stated enquiry: a Russian-speaking renter in Saburtalo. */
const demand = (overrides = {}) => ({
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

/** A fully-stated listing: the two-room Saburtalo flat from production. */
const supply = (overrides = {}) => ({
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
 * The symmetry that makes it one model
 * ──────────────────────────────────────────────────────────────────────── */

test('both directions reach the identical assessment for the same pair', () => {
  // The whole reason there is one function. Two implementations would drift, and
  // the drift would show as a flat matching a buyer who does not match the flat.
  const d = demand();
  const s = supply();

  const findBuyers = rankDemandForSupply(s, [{ key: 'enquiry', demand: d }]);
  const findProperty = rankSupplyForDemand(d, [{ key: 'listing', supply: s }]);

  assert.equal(findBuyers.length, 1);
  assert.equal(findProperty.length, 1);
  assert.equal(findBuyers[0].assessment.score, findProperty[0].assessment.score);
  assert.deepEqual(
    findBuyers[0].assessment.dimensions,
    findProperty[0].assessment.dimensions,
    'the same pair must be described identically whichever end it is read from',
  );
});

test('a pair that conflicts is rejected from both directions', () => {
  const d = demand({ bedroomsMin: 4, bedroomsMax: 5 });
  const s = supply();
  assert.equal(rankDemandForSupply(s, [{ key: 'a', demand: d }]).length, 0);
  assert.equal(rankSupplyForDemand(d, [{ key: 'b', supply: s }]).length, 0);
});

/* ────────────────────────────────────────────────────────────────────────
 * A contradiction is final
 * ──────────────────────────────────────────────────────────────────────── */

test('a renter is never shown a purchase', () => {
  const result = assessMatch(demand({ transactionType: 'RENT' }), supply({
    transaction: 'SALE', rentAmount: null, rentCurrency: null,
    saleAmount: 90000, saleCurrency: 'USD',
  }));
  assert.equal(result.compatibility, 'INCOMPATIBLE');
  assert.deepEqual(result.conflicted, ['TRANSACTION']);
  assert.match(result.rationale, /they want to rent and this is sale/);
});

test('one conflict outranks every agreement, and the score is zero', () => {
  // A two-bedroom flat is not a 0.7 match for somebody who needs four, however
  // well the price and district line up. A weighted average would say it was.
  const result = assessMatch(demand({ bedroomsMin: 4, bedroomsMax: 6 }), supply());
  assert.equal(result.compatibility, 'INCOMPATIBLE');
  assert.equal(result.score, 0);
  assert.ok(result.agreed.length >= 3, 'guard: plenty did agree');
  assert.deepEqual(result.conflicted, ['BEDROOMS']);
});

test('over budget is a conflict', () => {
  const result = assessMatch(demand({ budgetMax: 600 }), supply({ rentAmount: 800 }));
  assert.equal(result.compatibility, 'INCOMPATIBLE');
  assert.match(result.rationale, /costs 800 USD and their ceiling is 600/);
});

test('BELOW the stated floor is a conflict too, not a bargain', () => {
  // A stated minimum usually encodes an expectation about quality or size.
  // "Cheaper than you asked for" is how a list fills with places already ruled out.
  const result = assessMatch(demand({ budgetMin: 700 }), supply({ rentAmount: 300 }));
  assert.equal(result.compatibility, 'INCOMPATIBLE');
  assert.match(result.rationale, /below the 700 they said/);
});

test('a different city is a conflict', () => {
  const result = assessMatch(demand({ city: 'Tbilisi' }), supply({ city: 'Batumi' }));
  assert.equal(result.compatibility, 'INCOMPATIBLE');
  assert.ok(result.conflicted.includes('CITY'));
});

/* ────────────────────────────────────────────────────────────────────────
 * Places are compared, not string-matched
 * ──────────────────────────────────────────────────────────────────────── */

test('a Georgian city spelling matches a Latin one', () => {
  // Production holds one city as 'Tbilisi', 'tbilisi' and 'თბილისი'.
  const result = assessMatch(demand({ city: 'Tbilisi' }), supply({ city: 'თბილისი' }));
  assert.equal(result.compatibility, 'COMPATIBLE');
  assert.ok(result.agreed.includes('CITY'));
});

test('a district pair that cannot be compared across scripts is UNKNOWN, not a conflict', () => {
  // An unmade comparison is not a disagreement. Treating it as one would destroy
  // the exact cross-language match this product exists to find.
  const result = assessMatch(demand({ district: 'Zestafoni' }), supply({ district: 'ზესტაფონი' }));
  assert.ok(result.unknown.includes('DISTRICT'));
  assert.equal(result.conflicted.includes('DISTRICT'), false);
});

/* ────────────────────────────────────────────────────────────────────────
 * Currency is never assumed
 * ──────────────────────────────────────────────────────────────────────── */

test('800 GEL is not compared against an 900 USD budget', () => {
  // Comparing the numbers would be a fabrication, and converting them needs a rate
  // this module does not hold and must not invent.
  const result = assessMatch(demand({ currency: 'USD', budgetMax: 900 }), supply({
    rentAmount: 800, rentCurrency: 'GEL',
  }));
  assert.ok(result.unknown.includes('PRICE'));
  assert.equal(result.conflicted.includes('PRICE'), false);
  const price = result.dimensions.find((d) => d.dimension === 'PRICE');
  assert.match(price.reason, /no rate was supplied/);
});

test('a missing currency on either side declines the comparison', () => {
  for (const pair of [{ currency: null }, { currency: 'USD' }]) {
    const s = pair.currency === null ? supply() : supply({ rentCurrency: null });
    const result = assessMatch(demand(pair.currency === null ? { currency: null } : {}), s);
    assert.ok(result.unknown.includes('PRICE'));
  }
});

/* ────────────────────────────────────────────────────────────────────────
 * Sparse rows, which is what production actually holds
 * ──────────────────────────────────────────────────────────────────────── */

test('an enquiry stating only a city and a transaction is INSUFFICIENT_INFORMATION', () => {
  // Not a match and not a contradiction. Two agreements out of seven dimensions is
  // a coincidence, and calling it a match would pair every Tbilisi enquiry with
  // every Tbilisi listing.
  const result = assessMatch({
    transactionType: 'RENT',
    city: 'Tbilisi',
    district: null,
    propertyTypes: null,
    budgetMin: null, budgetMax: null, currency: null,
    areaMin: null, areaMax: null,
    bedroomsMin: null, bedroomsMax: null,
  }, supply(), { minAgreements: 3 });

  assert.equal(result.compatibility, 'INSUFFICIENT_INFORMATION');
  assert.equal(result.score, 0, 'a score would imply a ranking it has not earned');
  assert.deepEqual(result.conflicted, []);
  assert.match(result.rationale, /not presented as a match/);
});

test('the default floor is two agreements, and one is not enough', () => {
  const bare = {
    transactionType: 'RENT',
    city: null, district: null, propertyTypes: null,
    budgetMin: null, budgetMax: null, currency: null,
    areaMin: null, areaMax: null, bedroomsMin: null, bedroomsMax: null,
  };
  const result = assessMatch(bare, supply());
  assert.equal(result.agreed.length, 1, 'guard: only the transaction is known to agree');
  assert.equal(result.compatibility, 'INSUFFICIENT_INFORMATION');
});

test('an empty pair is never COMPATIBLE', () => {
  const nothing = assessMatch({
    transactionType: null, city: null, district: null, propertyTypes: null,
    budgetMin: null, budgetMax: null, currency: null,
    areaMin: null, areaMax: null, bedroomsMin: null, bedroomsMax: null,
  }, {
    transaction: null, city: null, district: null, propertyType: null,
    saleAmount: null, saleCurrency: null, rentAmount: null, rentCurrency: null,
    areaSqm: null, bedrooms: null, rooms: null,
  });
  assert.equal(nothing.compatibility, 'INSUFFICIENT_INFORMATION');
  assert.equal(nothing.agreed.length, 0);
  assert.equal(nothing.score, 0);
});

/* ────────────────────────────────────────────────────────────────────────
 * The vocabularies the two sides actually use
 * ──────────────────────────────────────────────────────────────────────── */

test('the Georgian and Russian portal words resolve to the same transaction', () => {
  for (const [wanted, offered] of [
    ['rent', 'qiravdeba'], ['RENT', 'Сдается'], ['for sale', 'ikideba'], ['SALE', 'Продается'],
  ]) {
    const result = assessMatch(
      demand({ transactionType: wanted, budgetMin: null, budgetMax: null }),
      supply({
        transaction: offered,
        rentAmount: /rent|Сда|qirav/i.test(offered) ? 800 : null,
        saleAmount: /sale|ikid|Прода/i.test(offered) ? 90000 : null,
        saleCurrency: 'USD',
      }),
    );
    assert.equal(
      result.conflicted.includes('TRANSACTION'),
      false,
      `${wanted} vs ${offered} must not read as a transaction conflict`,
    );
  }
});

test('APARTMENT and FLAT are the same thing to a buyer', () => {
  const result = assessMatch(demand({ propertyTypes: ['FLAT'] }), supply({ propertyType: 'APARTMENT' }));
  assert.ok(result.agreed.includes('PROPERTY_TYPE'));
});

test('a property type of ANY states no requirement rather than matching everything', () => {
  const result = assessMatch(demand({ propertyTypes: ['ANY'] }), supply({ propertyType: 'HOUSE' }));
  assert.ok(result.unknown.includes('PROPERTY_TYPE'));
  assert.equal(result.conflicted.includes('PROPERTY_TYPE'), false);
});

test('rooms stand in for bedrooms when bedrooms are not stated', () => {
  // Refusing to use them would discard most of what Georgian portals publish.
  const result = assessMatch(
    demand({ bedroomsMin: 2, bedroomsMax: 3 }),
    supply({ bedrooms: null, rooms: 2 }),
  );
  assert.ok(result.agreed.includes('BEDROOMS'));
});

/* ────────────────────────────────────────────────────────────────────────
 * Scoring ranks; it never decides
 * ──────────────────────────────────────────────────────────────────────── */

test('the score measures CORROBORATION, so an unstated detail ranks lower', () => {
  /*
   * I wrote this test expecting the two to score equally, on the reasoning that a
   * pair should not be punished for facts nobody recorded. The test failed at
   * 0.95 vs 1 and it was the expectation that was wrong, not the code.
   *
   * With conflicts already short-circuited, "agreed + unknown" IS the total, so
   * there is no formula that both ranks and ignores unknowns. And the penalty is
   * correct: a pair confirmed on all seven dimensions is stronger evidence than one
   * confirmed on six with one unstated, and the better-evidenced pair should come
   * first. What the penalty must not do is decide compatibility -- and it cannot,
   * because the conflict check and the agreement floor both ran before any weight
   * was summed.
   */
  const complete = assessMatch(demand(), supply());
  const noDistrict = assessMatch(demand({ district: null }), supply({ district: null }));

  assert.equal(complete.compatibility, 'COMPATIBLE');
  assert.equal(noDistrict.compatibility, 'COMPATIBLE', 'still a match: nothing contradicts');
  assert.ok(
    noDistrict.score < complete.score,
    'a less corroborated pair ranks lower than a fully corroborated one',
  );
  assert.ok(noDistrict.score > 0.9, 'but only slightly: one unstated detail is not a demotion');
});

test('a full agreement scores 1 and every score stays in range', () => {
  const full = assessMatch(demand(), supply());
  assert.equal(full.score, 1);
  for (const result of [full, assessMatch(demand({ district: null }), supply())]) {
    assert.ok(result.score >= 0 && result.score <= 1, `score out of range: ${result.score}`);
  }
});

test('ranking puts the better fit first and drops the incompatible', () => {
  const d = demand();
  const results = rankSupplyForDemand(d, [
    { key: 'wrong-city', supply: supply({ city: 'Batumi' }) },
    { key: 'vague', supply: supply({ district: null, propertyType: null, areaSqm: null }) },
    { key: 'perfect', supply: supply() },
  ]);
  assert.deepEqual(results.map((r) => r.key), ['perfect', 'vague']);
  assert.ok(results[0].assessment.score >= results[1].assessment.score);
});

/* ────────────────────────────────────────────────────────────────────────
 * What a customer reads
 * ──────────────────────────────────────────────────────────────────────── */

test('the rationale is in a customer vocabulary, with no scores or jargon', () => {
  const result = assessMatch(demand(), supply());
  assert.doesNotMatch(result.rationale, /\bscore\b|0\.\d|weight|dimension|AGREE|UNKNOWN/);
  assert.match(result.rationale, /the same city/);
});

test('a rejection explains itself with the reason that caused it', () => {
  const result = assessMatch(demand({ budgetMax: 500 }), supply({ rentAmount: 800 }));
  assert.match(result.rationale, /800/);
  assert.match(result.rationale, /500/);
});

test('every dimension is always reported, agreeing or not', () => {
  // A dimension omitted from the list is a dimension nobody can audit.
  const result = assessMatch(demand(), supply());
  assert.deepEqual(
    result.dimensions.map((d) => d.dimension).sort(),
    ['AREA', 'BEDROOMS', 'CITY', 'DISTRICT', 'PRICE', 'PROPERTY_TYPE', 'TRANSACTION'],
  );
  for (const dimension of result.dimensions) {
    assert.ok(dimension.reason.length > 0, `${dimension.dimension} has no reason`);
  }
});
