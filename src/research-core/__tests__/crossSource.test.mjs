// THE DISAGREEMENT IS THE PRODUCT.
//
// The resolver decides three observations describe one flat. The wrong thing
// to do next is average them: "$155,667" is a number no source published and
// a customer shown it could not be told where it came from.
//
// "The same flat is on three sources at $150,000, $162,000 and $155,000" is a
// thing a seller can act on. It says the market has not settled and it says
// which agent is most optimistic, and every figure in it can be checked
// against a page.
//
// So these tests are mostly about what the module REFUSES to say.

import test from 'node:test';
import assert from 'node:assert/strict';
import { describeAcrossSources } from '../discovery/cross-source.ts';

/** One source's view of a Saburtalo flat. */
function obs(overrides = {}) {
  return {
    id: 'o1',
    sourceId: 'src-a',
    adapterId: 'ss-ge',
    externalId: '1',
    canonicalUrl: 'https://home.ss.ge/ka/udzravi-qoneba/1',
    countryCode: 'GE',
    city: 'Tbilisi',
    district: 'Saburtalo',
    transaction: 'SALE',
    propertyType: 'APARTMENT',
    areaSqm: 89,
    rooms: 3,
    bedrooms: 2,
    floor: 5,
    saleAmount: 150000,
    saleCurrency: 'USD',
    contentFingerprint: 'fp-a',
    quality: 1,
    lastSeenAt: '2026-09-25T10:00:00Z',
    ...overrides,
  };
}

test('one source is a listing, not a corroboration', () => {
  /*
   * Returns null below two SOURCES, not below two observations. One source
   * listing the same flat twice is a data-quality problem on that source,
   * and calling it corroboration would turn that problem into evidence.
   */
  assert.equal(describeAcrossSources([obs()]), null);
  assert.equal(
    describeAcrossSources([obs({ id: 'a' }), obs({ id: 'b', externalId: '2' })]),
    null,
    'one source listing a flat twice was treated as two sources agreeing',
  );
});

test('three sources, three prices, and no average anywhere', () => {
  const result = describeAcrossSources([
    obs({ id: 'a', adapterId: 'ss-ge', saleAmount: 150000 }),
    obs({ id: 'b', adapterId: 'place-ge', saleAmount: 162000 }),
    obs({ id: 'c', adapterId: 'home24-ge', saleAmount: 155000 }),
  ]);

  assert.equal(result.sourceCount, 3);
  assert.deepEqual(result.sources, ['home24-ge', 'place-ge', 'ss-ge']);

  const spread = result.priceSpread;
  assert.equal(spread.currency, 'USD');
  assert.equal(spread.low, 150000);
  assert.equal(spread.high, 162000);
  assert.equal(spread.absolute, 12000);
  assert.equal(spread.lowSource, 'ss-ge');
  assert.equal(spread.highSource, 'place-ge');

  /*
   * The fraction is of the LOW price, not of an average. "8% above the
   * cheapest listing" is checkable against two pages; "3.9% either side of
   * the mean" is a statement about a number nobody published.
   */
  assert.equal(spread.fraction, 0.08);

  const json = JSON.stringify(result);
  assert.doesNotMatch(json, /155667|155666/, 'an average leaked into the output');
});

test('a spread needs one currency, because subtracting two is nonsense', () => {
  /*
   * 150,000 USD and 400,000 GEL are nearly the same price. Subtracting them
   * gives a "spread" of 250,000 of nothing, and converting them needs a rate
   * this module does not have and must not invent — the same rule that stops
   * the envelope filter comparing across currencies.
   */
  const mixed = describeAcrossSources([
    obs({ id: 'a', adapterId: 'ss-ge', saleAmount: 150000, saleCurrency: 'USD' }),
    obs({ id: 'b', adapterId: 'place-ge', saleAmount: 400000, saleCurrency: 'GEL' }),
  ]);
  assert.equal(mixed.priceSpread, null, 'two currencies were subtracted from each other');

  /* With a third source agreeing on a currency, that pair is comparable. */
  const partly = describeAcrossSources([
    obs({ id: 'a', adapterId: 'ss-ge', saleAmount: 150000, saleCurrency: 'USD' }),
    obs({ id: 'b', adapterId: 'place-ge', saleAmount: 400000, saleCurrency: 'GEL' }),
    obs({ id: 'c', adapterId: 'home24-ge', saleAmount: 162000, saleCurrency: 'USD' }),
  ]);
  assert.equal(partly.priceSpread.currency, 'USD');
  assert.equal(partly.priceSpread.absolute, 12000);
});

test('identical prices are not a spread', () => {
  const result = describeAcrossSources([
    obs({ id: 'a', adapterId: 'ss-ge', saleAmount: 150000 }),
    obs({ id: 'b', adapterId: 'place-ge', saleAmount: 150000 }),
  ]);
  assert.equal(result.priceSpread, null, 'a spread of zero was reported as a spread');
  assert.equal(result.sourceCount, 2);
});

test('"source A updated today, source B is 18 days old" needs two dates', () => {
  const result = describeAcrossSources([
    obs({ id: 'a', adapterId: 'ss-ge', lastSeenAt: '2026-09-25T10:00:00Z' }),
    obs({ id: 'b', adapterId: 'place-ge', lastSeenAt: '2026-09-07T10:00:00Z' }),
  ]);
  assert.equal(result.freshnessGapDays, 18);
  assert.equal(result.freshestSource, 'ss-ge');
  assert.equal(result.stalestSource, 'place-ge');

  /* A source never seen contributes nothing rather than a zero. */
  const oneDate = describeAcrossSources([
    obs({ id: 'a', adapterId: 'ss-ge', lastSeenAt: '2026-09-25T10:00:00Z' }),
    obs({ id: 'b', adapterId: 'place-ge', lastSeenAt: null }),
  ]);
  assert.equal(oneDate.freshnessGapDays, null);
  assert.equal(oneDate.freshestSource, null);
});

test('hours between two scans is scheduling noise, not staleness', () => {
  const result = describeAcrossSources([
    obs({ id: 'a', adapterId: 'ss-ge', lastSeenAt: '2026-09-25T23:00:00Z' }),
    obs({ id: 'b', adapterId: 'place-ge', lastSeenAt: '2026-09-25T02:00:00Z' }),
  ]);
  assert.equal(result.freshnessGapDays, 0);
});

test('a field two sources describe differently is shown, not reconciled', () => {
  /*
   * 89 m² on one portal and 87 on another is a fact about the portals. The
   * resolver has already decided they are close enough to be one property,
   * so this is not a contradiction to resolve — it is a difference to show,
   * with the source that said each number.
   */
  const result = describeAcrossSources([
    obs({ id: 'a', adapterId: 'ss-ge', areaSqm: 89, district: 'Saburtalo' }),
    obs({ id: 'b', adapterId: 'place-ge', areaSqm: 87, district: 'Saburtalo' }),
  ]);

  const area = result.disagreements.find((d) => d.field === 'areaSqm');
  assert.ok(area, 'a disagreement about area went unreported');
  assert.deepEqual(area.values, [
    { value: '87', sources: ['place-ge'] },
    { value: '89', sources: ['ss-ge'] },
  ]);

  /* They agree on district, so it is not listed at all. */
  assert.equal(result.disagreements.some((d) => d.field === 'district'), false);
});

test('a silent source does not disagree', () => {
  /*
   * Two sources, one of which states no bedroom count, agree as far as
   * anybody can tell. Reporting that as a disagreement would manufacture a
   * conflict out of absence — the same error the envelope filter refuses
   * when it keeps a listing that states no city.
   */
  const result = describeAcrossSources([
    obs({ id: 'a', adapterId: 'ss-ge', bedrooms: 2 }),
    obs({ id: 'b', adapterId: 'place-ge', bedrooms: null }),
  ]);
  assert.equal(result.disagreements.some((d) => d.field === 'bedrooms'), false);
});

test('a source that has dropped the listing is named', () => {
  /*
   * "Still on ss.ge, gone from place.ge" is one of the more useful things
   * this can say: it is the first sign a property has sold. Only sources
   * that actually said so are listed — an unknown is not a removal.
   */
  const result = describeAcrossSources([
    obs({ id: 'a', adapterId: 'ss-ge', stillListed: true }),
    obs({ id: 'b', adapterId: 'place-ge', stillListed: false }),
    obs({ id: 'c', adapterId: 'home24-ge', stillListed: null }),
  ]);
  assert.deepEqual(result.removedFrom, ['place-ge']);
});
