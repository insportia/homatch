// ONE FETCH, SEVERAL CAMPAIGNS, AND NOBODY SEEING SOMEBODY ELSE'S LISTINGS.
//
// Coalescing is the optimisation that pays for a hundred-source registry, and
// it is also the one that can quietly leak a listing into a campaign that did
// not ask for it. Both halves are asserted here: that equivalent searches
// share an identity, that only safely-bounded ones merge, and that sharing a
// REQUEST never means sharing a RESULT.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalSearchKey,
  coalesce,
  isSameSearch,
} from '../discovery/search-identity.ts';
import { withinEnvelope } from '../adapters/portal/configured.ts';

const BASE = {
  id: 'q1',
  transaction: 'SALE',
  propertyType: 'APARTMENT',
  countryCode: 'GE',
  city: 'Tbilisi',
  district: 'Isani',
  subDistrict: null,
  projectName: null,
  area: { min: 50, max: 100 },
  rooms: { min: 3, max: 3 },
  bedrooms: { min: 2, max: 2 },
  floor: { min: null, max: null },
  price: { min: 100000, max: 150000 },
  priceCurrency: 'USD',
  languages: ['ka', 'en'],
  limit: 20,
  rationale: 'test',
};

const q = (over = {}) => ({ ...BASE, ...over });

/* ── identity ───────────────────────────────────────────────────────────── */

test('field order never changes the key', () => {
  /* Same values, different literal order. §24: ordering must not matter. */
  const a = q();
  const b = {
    rationale: 'test', limit: 20, languages: ['ka', 'en'], priceCurrency: 'USD',
    price: { max: 150000, min: 100000 }, floor: { max: null, min: null },
    bedrooms: { max: 2, min: 2 }, rooms: { max: 3, min: 3 },
    area: { max: 100, min: 50 }, projectName: null, subDistrict: null,
    district: 'Isani', city: 'Tbilisi', countryCode: 'GE',
    propertyType: 'APARTMENT', transaction: 'SALE', id: 'q1',
  };
  assert.equal(canonicalSearchKey('ss-ge', a), canonicalSearchKey('ss-ge', b));
  assert.ok(isSameSearch(a, b));
});

test('the run label and the prose do not enter the identity', () => {
  /*
   * The silent-failure version of this feature: every campaign carries its
   * own query id, so including it would give every search a unique key and
   * disable every cache and every merge while still looking correct.
   */
  assert.equal(
    canonicalSearchKey('ss-ge', q({ id: 'campaign-A', rationale: 'A' })),
    canonicalSearchKey('ss-ge', q({ id: 'campaign-B', rationale: 'B' })),
  );
});

test('the same envelope asked of two sources is two jobs', () => {
  assert.notEqual(canonicalSearchKey('ss-ge', q()), canonicalSearchKey('place-ge', q()));
});

test('a different market is a different search', () => {
  assert.notEqual(canonicalSearchKey('ss-ge', q()), canonicalSearchKey('ss-ge', q({ city: 'Batumi' })));
  assert.notEqual(canonicalSearchKey('ss-ge', q()), canonicalSearchKey('ss-ge', q({ transaction: 'RENT' })));
});

test('casing and padding in a city name do not fork the key', () => {
  assert.ok(isSameSearch(q({ city: 'Tbilisi' }), q({ city: '  tbilisi ' })));
});

/* ── coalescing ─────────────────────────────────────────────────────────── */

test('overlapping price bands in one market merge into a single fetch', () => {
  const groups = coalesce([
    q({ id: 'A', price: { min: 100000, max: 150000 } }),
    q({ id: 'B', price: { min: 120000, max: 180000 } }),
  ]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].members.length, 2);
  assert.deepEqual(groups[0].covering.price, { min: 100000, max: 180000 });
});

test('a covering envelope that would be far too wide is refused', () => {
  /*
   * The failure this prevents: three narrow searches justifying a download of
   * most of a city because their union happens to span it.
   */
  const groups = coalesce([
    q({ id: 'A', price: { min: 100000, max: 110000 } }),
    q({ id: 'B', price: { min: 900000, max: 910000 } }),
  ]);
  assert.equal(groups.length, 2, 'two distant bands were merged into one fetch');
  assert.ok(groups.every((g) => g.members.length === 1));
  // The safety property is the bound, not the wording: no covering envelope
  // may span more than 1.5x its widest member, so these two never share one.
  for (const group of groups) {
    assert.equal(group.covering.price.max - group.covering.price.min, 10000);
  }
});

test('an open-ended range never becomes a covering envelope', () => {
  const groups = coalesce([
    q({ id: 'A', price: { min: 100000, max: 150000 } }),
    q({ id: 'B', price: { min: 100000, max: null } }),
  ]);
  assert.equal(groups.length, 2);
  // Whichever order they come out in, the open-ended one stands alone and
  // never contributes a null bound to somebody else's covering envelope.
  assert.ok(groups.every((g) => g.members.length === 1));
  assert.ok(groups.some((g) => /open-ended/.test(g.reason)),
    `no group explained the open-ended refusal: ${groups.map((g) => g.reason).join(' | ')}`);
  assert.ok(groups.every((g) => g.covering.price.max !== null || g.members.length === 1));
});

test('different categories never merge, however close their prices', () => {
  const groups = coalesce([
    q({ id: 'A', propertyType: 'APARTMENT' }),
    q({ id: 'B', propertyType: 'HOUSE' }),
    q({ id: 'C', transaction: 'RENT' }),
    q({ id: 'D', city: 'Batumi' }),
  ]);
  assert.equal(groups.length, 4);
});

test('a lone search is its own group and is not widened', () => {
  const groups = coalesce([q({ id: 'solo' })]);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].covering.price, BASE.price);
  assert.match(groups[0].reason, /no other search shares/);
});

/* ── campaign isolation: the half that matters ─────────────────────────── */

test('a shared fetch does not become a shared result set', () => {
  /*
   * THE LEAK THIS FORBIDS. Campaign A caps at $150k, campaign B at $180k.
   * One fetch covers both. A listing at $175k belongs to B and must never
   * reach A -- and the check uses withinEnvelope, the SAME predicate the
   * adapter applies, so the two cannot disagree about one listing.
   */
  const campaignA = q({ id: 'A', price: { min: 100000, max: 150000 } });
  const campaignB = q({ id: 'B', price: { min: 120000, max: 180000 } });

  const groups = coalesce([campaignA, campaignB]);
  assert.equal(groups.length, 1, 'precondition: these should share one fetch');

  /*
   * The REAL NormalizedListing shape, read out of parse/listing.ts rather
   * than guessed: `sale` is a Money object carrying a basis, and `area` is an
   * Area carrying a unit. A first attempt at this fixture used flat
   * saleAmount/areaSqm fields, and withinEnvelope dutifully filed price as
   * "unevaluated" and kept the listing -- which read exactly like a missing
   * price filter in production, and was a wrong fixture instead.
   */
  const listing = {
    title: null,
    description: null,
    listingId: 'x1',
    propertyType: 'APARTMENT',
    status: null,
    registrationStatus: null,
    sale: { amount: 175000, currency: 'USD', basis: 'ASKING_SALE_PRICE' },
    rent: null,
    rentPeriod: null,
    area: { value: 80, unit: 'sqm' },
    salePricePerSqm: null,
    rooms: 3,
    bedrooms: 2,
    city: 'Tbilisi',
    district: 'Isani',
  };

  const forA = withinEnvelope(campaignA, listing);
  const forB = withinEnvelope(campaignB, listing);

  assert.equal(forA.keep, false, 'a $175k listing reached a campaign capped at $150k');
  assert.match(forA.reason, /175000|price/i);
  assert.equal(forB.keep, true, 'a $175k listing was withheld from a campaign capped at $180k');
});

test('the covering envelope is what gets fetched, the member envelope is what gets shown', () => {
  const a = q({ id: 'A', price: { min: 100000, max: 150000 } });
  const b = q({ id: 'B', price: { min: 120000, max: 180000 } });
  const [group] = coalesce([a, b]);

  // The fetch is wider than either member...
  assert.equal(group.covering.price.max, 180000);
  // ...and every member keeps its own, narrower, envelope for filtering.
  assert.equal(group.members.find((m) => m.id === 'A').price.max, 150000);
  assert.equal(group.members.find((m) => m.id === 'B').price.max, 180000);
});

/* ── a thousand searches ────────────────────────────────────────────────── */

test('1,000 overlapping searches collapse to a bounded number of fetches', () => {
  /*
   * Synthetic and offline. The question is whether identity plus coalescing
   * actually reduce the outbound job count, or whether a thousand campaigns
   * still mean a thousand fetches.
   */
  const CITIES = ['Tbilisi', 'Batumi', 'Kutaisi', 'Rustavi'];
  const DISTRICTS = ['Isani', 'Vake', 'Saburtalo', null];
  const TRANSACTIONS = ['SALE', 'RENT'];

  const searches = [];
  for (let i = 0; i < 1000; i += 1) {
    const base = 100000 + (i % 5) * 10000;
    searches.push(q({
      id: `c${i}`,
      city: CITIES[i % CITIES.length],
      district: DISTRICTS[i % DISTRICTS.length],
      transaction: TRANSACTIONS[i % TRANSACTIONS.length],
      price: { min: base, max: base + 50000 },
    }));
  }

  const keys = new Set(searches.map((s) => canonicalSearchKey('ss-ge', s)));
  const groups = coalesce(searches);

  // Identity alone collapses the duplicates.
  assert.ok(keys.size < 200, `1,000 searches produced ${keys.size} distinct keys`);
  // Coalescing collapses the overlaps further.
  assert.ok(groups.length <= keys.size,
    `coalescing produced ${groups.length} fetches for ${keys.size} distinct searches`);
  assert.ok(groups.length < 100, `${groups.length} fetches is not a bounded fan-out`);

  // Nothing is lost: every input search belongs to exactly one group.
  const members = groups.flatMap((g) => g.members.map((m) => m.id));
  assert.equal(members.length, 1000);
  assert.equal(new Set(members).size, 1000);
});
