// Refreshing a market instead of re-discovering one.
//
// MARKET stayed the most expensive stage while every other one got cheaper:
// 56,017 to 86,252 tokens and 4 to 8 searches across seven production runs of
// one property, against an identity stage that fell to 9,152 and one search.
// It was also the only stage the graph never gave anything to.
//
// The saving is in not re-finding listings already found. The danger is the
// opposite of the saving: a comparable's price and status change daily, and a
// stale asking price restated as a current one is precisely the error a buyer
// cannot be exposed to. Most of what follows is about that.

import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMarketBrief, VOLATILE_FIELDS } from '../marketBrief.ts';

const comparable = (url, over = {}) => ({
  url,
  facts: {
    'listing.area': 78,
    'listing.rooms': 3,
    'listing.floor': '5/7',
    'listing.condition': 'WHITE_FRAME',
    'listing.address': 'Digomi, Tbilisi',
    'listing.source': 'ss.ge',
    'listing.price': 102000,
    'listing.pricePerSqm': 1307,
    'listing.status': 'ACTIVE',
    ...over,
  },
});

/* ── the half that must never be handed over ─────────────────────────── */

test('a stored price is never quoted back to the market stage', () => {
  const { text } = buildMarketBrief([comparable('https://home.ss.ge/x/1')]);
  assert.doesNotMatch(text, /102000/, 'a day-old asking price was handed over as if current');
  assert.doesNotMatch(text, /1307/, 'a stored price-per-sqm was handed over');
});

test('a stored listing status is never quoted back either', () => {
  const { text } = buildMarketBrief([comparable('https://home.ss.ge/x/1')]);
  assert.doesNotMatch(text, /ACTIVE/, 'a stored listing status was presented as current');
});

test('every volatile field is excluded by name, not by luck', () => {
  // If a new volatile field is added to the graph it must be added here too,
  // and this is the test that says so.
  const facts = Object.fromEntries(VOLATILE_FIELDS.map((k) => [k, 'SENTINEL_VALUE']));
  const { text } = buildMarketBrief([{ url: 'https://home.ss.ge/x/1', facts }]);
  assert.doesNotMatch(text, /SENTINEL_VALUE/);
});

test('the stage is told explicitly to go and read the current price', () => {
  const { text } = buildMarketBrief([comparable('https://home.ss.ge/x/1')]);
  assert.match(text, /CURRENT price and listingStatus/);
  assert.match(text, /EXPIRED \/ REMOVED \/\s*SOLD/);
});

/* ── the half that is worth handing over ─────────────────────────────── */

test('stable attributes are given so the listing need not be re-found', () => {
  const { text, urls } = buildMarketBrief([comparable('https://home.ss.ge/x/1')]);
  assert.match(text, /https:\/\/home\.ss\.ge\/x\/1/);
  assert.match(text, /area 78/);
  assert.match(text, /rooms 3/);
  assert.match(text, /floor 5\/7/);
  assert.match(text, /condition WHITE_FRAME/);
  assert.deepEqual(urls, ['https://home.ss.ge/x/1']);
});

test('the five-band requirement is restated, not relaxed', () => {
  // The saving must narrow what is searched FOR, never what is reported. A
  // thin band still has to be researched and an unsearched band still must
  // not be described.
  const { text } = buildMarketBrief([comparable('https://home.ss.ge/x/1')]);
  assert.match(text, /bands that are still THIN/);
  assert.match(text, /fewer than three/);
  assert.match(text, /a band you have not\s*\n?searched must not be described/);
});

test('the model may drop a comparable it judges not comparable', () => {
  const { text } = buildMarketBrief([comparable('https://home.ss.ge/x/1')]);
  assert.match(text, /this is what we found before, not what must be true now/);
});

/* ── shape and bounds ────────────────────────────────────────────────── */

test('nothing held means no block at all', () => {
  assert.equal(buildMarketBrief([]).text, '');
  assert.equal(buildMarketBrief(null).text, '');
  assert.deepEqual(buildMarketBrief(undefined).urls, []);
});

test('a listing with no usable URL is not offered', () => {
  assert.equal(buildMarketBrief([{ url: 'not-a-url', facts: {} }]).text, '');
  assert.equal(buildMarketBrief([{ url: '', facts: {} }]).text, '');
});

test('a property with hundreds of comparables does not flood the prompt', () => {
  const many = Array.from({ length: 200 }, (_, i) => comparable(`https://home.ss.ge/x/${i}`));
  const { urls } = buildMarketBrief(many);
  assert.equal(urls.length, 8, 'the list is unbounded');
  // Measured: at 24 the stage carried every offered listing into its answer
  // and kept finding more, so the set compounded 9 -> 16 -> 26 and market
  // went 75,509 tokens to 103,600 with it. Cost scaled with a graph that
  // only grows, which is the opposite of the point.
});

test('a comparable with no stable attributes is still worth its URL', () => {
  const { text } = buildMarketBrief([{ url: 'https://korter.ge/y', facts: {} }]);
  assert.match(text, /https:\/\/korter\.ge\/y/);
});
