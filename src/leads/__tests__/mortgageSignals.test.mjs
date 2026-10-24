import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMortgageOrigin, mortgageSignalLines, priceReasonLines } from '../mortgageSignals.ts';
import { leadPriceKey } from '../leadSummary.ts';

const t = (k, v) => (v ? `${k}(${Object.values(v).join(',')})` : k);

test('a Home Financing opt-in is the MORTGAGE price key, whatever its match category', () => {
  assert.equal(leadPriceKey({ segment: 'MORTGAGE', category: 'EXACT' }), 'MORTGAGE');
  assert.equal(leadPriceKey({ segment: 'MORTGAGE' }), 'MORTGAGE');
  assert.equal(leadPriceKey({ segment: 'MORTGAGE_MATCH' }), 'MORTGAGE_MATCH');
  assert.equal(leadPriceKey({ priceKey: 'MORTGAGE_MATCH', segment: 'MORTGAGE_MATCH' }), 'MORTGAGE_MATCH');
  assert.equal(leadPriceKey({ priceKey: 'MORTGAGE', segment: 'MORTGAGE' }), 'MORTGAGE');
  // The other members keep their keys exactly.
  assert.equal(leadPriceKey({ segment: 'STANDARD', category: 'EXACT' }), 'EXACT');
  assert.equal(leadPriceKey({ segment: 'PREMIUM', category: 'NEARBY_SIMILAR' }), 'PREMIUM');
  assert.equal(leadPriceKey({ segment: 'STANDARD', category: 'NEARBY_SIMILAR' }), 'STANDARD');
});

test('origin is read from the feed, and from the segment for the older feed', () => {
  assert.equal(isMortgageOrigin({ origin: 'MORTGAGE', segment: 'MORTGAGE' }), true);
  assert.equal(isMortgageOrigin({ segment: 'MORTGAGE' }), true);
  assert.equal(isMortgageOrigin({ origin: 'SEARCH', segment: 'STANDARD' }), false);
  assert.equal(isMortgageOrigin({ origin: 'MORTGAGE_AND_SEARCH', segment: 'PREMIUM' }), true, 'a high-budget person with mortgage interest still shows it');
});

test('the reasons for a price are the server\'s, in its order, one sentence each', () => {
  assert.deepEqual(priceReasonLines({ priceReasons: ['MORTGAGE_INTEREST', 'EXACT_SEARCH_MATCH'] }, (k) => k),
    ['hl_reason_MORTGAGE_INTEREST', 'hl_reason_EXACT_SEARCH_MATCH']);
  assert.deepEqual(priceReasonLines({}, (k) => k), []);
});

test('signals say only what the platform observed: this listing, calculator use', () => {
  const lines = mortgageSignalLines({ mortgage: { calculatorUse: 'REPEATED', lastUseMonth: '2026-10', thisListing: true } }, t, 'en');
  assert.equal(lines[0], 'hl_mortgage_this_listing');
  assert.match(lines[1], /^hl_mortgage_used_repeated\(October 2026\)$/);
  assert.equal(lines.length, 2);
  assert.deepEqual(mortgageSignalLines({ mortgage: { calculatorUse: 'ONCE', lastUseMonth: null, thisListing: false } }, t, 'en'), []);
  assert.deepEqual(mortgageSignalLines({ mortgage: null }, t, 'en'), []);
  // Georgian month names never depend on the browser having Georgian calendar data.
  assert.equal(mortgageSignalLines({ mortgage: { calculatorUse: 'ONCE', lastUseMonth: '2026-10', thisListing: false } }, t, 'ka-GE')[0], 'hl_mortgage_used_once(ოქტომბერი 2026)');
  assert.deepEqual(mortgageSignalLines({}, t, 'en'), []);
});
