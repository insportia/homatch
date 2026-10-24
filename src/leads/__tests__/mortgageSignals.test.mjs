import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isMortgageOrigin, mortgageSignalLines } from '../mortgageSignals.ts';
import { leadPriceKey } from '../leadSummary.ts';

const t = (k, v) => (v ? `${k}(${Object.values(v).join(',')})` : k);

test('a Home Financing opt-in is the MORTGAGE price key, whatever its match category', () => {
  assert.equal(leadPriceKey({ segment: 'MORTGAGE', category: 'EXACT' }), 'MORTGAGE');
  assert.equal(leadPriceKey({ segment: 'MORTGAGE' }), 'MORTGAGE');
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
});

test('signals say only what the member did: this listing, calculator use, timeframe', () => {
  const lines = mortgageSignalLines({ mortgage: { calculatorUse: 'REPEATED', lastUseMonth: '2026-10', thisListing: true, timeframe: 'MONTHS_3' } }, t, 'en');
  assert.equal(lines[0], 'hl_mortgage_this_listing');
  assert.match(lines[1], /^hl_mortgage_used_repeated\(October 2026\)$/);
  assert.equal(lines[2], 'hl_mortgage_tf_months_3');
  assert.deepEqual(mortgageSignalLines({ mortgage: { calculatorUse: 'ONCE', lastUseMonth: null, thisListing: false, timeframe: null } }, t, 'en'), []);
  assert.deepEqual(mortgageSignalLines({ mortgage: null }, t, 'en'), []);
  // Georgian month names never depend on the browser having Georgian calendar data.
  assert.equal(mortgageSignalLines({ mortgage: { calculatorUse: 'ONCE', lastUseMonth: '2026-10', thisListing: false, timeframe: null } }, t, 'ka-GE')[0], 'hl_mortgage_used_once(ოქტომბერი 2026)');
  assert.deepEqual(mortgageSignalLines({}, t, 'en'), []);
});
