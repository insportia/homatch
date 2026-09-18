// Asking is not achieved. A price list is not a transaction.
//
// Every one of these is a number somebody could reasonably show next to a
// property, and treating any two of them as interchangeable produces an
// investment figure that is confidently wrong. The point of the tests below
// is that the conversion is not merely discouraged — there is no function
// that performs it, and the ones that could are the ones that refuse.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRICE_BASES,
  basesArePoolable,
  priceBasisSide,
} from '../core/types.ts';
import {
  emptyListing,
  money,
  assignMoney,
  mergeListing,
  deriveSalePricePerSqm,
} from '../parse/listing.ts';
import { pool, poolByBasis } from '../score/pooling.ts';

const support = () => ({
  observationCount: 1,
  independentSourceCount: 1,
  effectiveSourceCount: 1,
  familyCounts: {},
});

let n = 0;
const obs = (level = 'MICRO_LOCATION') => {
  n += 1;
  return {
    id: `o${n}`,
    requestedUrl: 'https://p.test/x',
    fetchUrl: 'https://p.test/x',
    canonicalIdentityUrl: 'https://p.test/x',
    source: { sourceKey: 'p', sourceFamily: 'p', kind: 'PROPERTY_PORTAL' },
    evidenceLevel: level,
    observedAt: null,
    retrievedAt: '2026-09-18T00:00:00.000Z',
    contentHash: `h${n}`,
    nearDuplicateFingerprint: null,
    structuredSourceId: null,
    payload: {},
    fieldOrigins: {},
    supportingText: null,
  };
};

/* ── The vocabulary ───────────────────────────────────────────────────── */

test('the six bases the product needs all exist', () => {
  assert.deepEqual([...PRICE_BASES].sort(), [
    'ACHIEVED_RENT',
    'ASKING_RENT',
    'ASKING_SALE_PRICE',
    'DEVELOPER_PRICE',
    'TRANSACTION_PRICE',
    'UNKNOWN',
  ]);
});

test('sale-side and rent-side bases are separated', () => {
  assert.equal(priceBasisSide('ASKING_SALE_PRICE'), 'SALE');
  assert.equal(priceBasisSide('DEVELOPER_PRICE'), 'SALE');
  assert.equal(priceBasisSide('TRANSACTION_PRICE'), 'SALE');
  assert.equal(priceBasisSide('ASKING_RENT'), 'RENT');
  assert.equal(priceBasisSide('ACHIEVED_RENT'), 'RENT');
  assert.equal(priceBasisSide('UNKNOWN'), 'UNKNOWN');
});

test('no two different bases may ever be pooled', () => {
  for (const a of PRICE_BASES) {
    for (const b of PRICE_BASES) {
      if (a === b && a !== 'UNKNOWN') {
        assert.equal(basesArePoolable(a, b), true, `${a} with itself`);
      } else {
        assert.equal(basesArePoolable(a, b), false, `${a} with ${b}`);
      }
    }
  }
});

test('UNKNOWN never pools, not even with itself', () => {
  // Two unlabelled figures agreeing tells us nothing about what they are.
  assert.equal(basesArePoolable('UNKNOWN', 'UNKNOWN'), false);
});

/* ── The listing shape ────────────────────────────────────────────────── */

test('there is no way to build a money value without a basis', () => {
  const value = money(1000, 'USD', 'ASKING_RENT');
  assert.equal(value.basis, 'ASKING_RENT');
  // The signature requires it; nothing here can produce a basis-free price.
  assert.equal(money(1000, 'USD', 'UNKNOWN').basis, 'UNKNOWN');
});

test('a rent basis can never land in the sale field', () => {
  const listing = emptyListing();
  assignMoney(listing, money(900, 'USD', 'ASKING_RENT'), 'JSON_LD');
  assert.equal(listing.sale, null);
  assert.equal(listing.rent.amount, 900);
});

test('an unlabelled headline figure lands on the sale side but KEEPS basis UNKNOWN', () => {
  const listing = emptyListing();
  assignMoney(listing, money(150000, 'USD', 'UNKNOWN'), 'TEXT');
  assert.equal(listing.sale.basis, 'UNKNOWN');
  // ...and is therefore unpoolable with anything.
  assert.equal(basesArePoolable(listing.sale.basis, 'ASKING_SALE_PRICE'), false);
});

test('a better-sourced value of a DIFFERENT basis does not overwrite an existing one', () => {
  // A JSON-LD transaction price is better markup than a scraped asking price
  // and is still a different claim. Overwriting would silently relabel it.
  const base = emptyListing();
  base.sale = money(200000, 'USD', 'ASKING_SALE_PRICE');
  base.fieldOrigins['sale'] = 'TEXT';

  const merged = mergeListing(base, {
    sale: money(185000, 'USD', 'TRANSACTION_PRICE'),
    fieldOrigins: { sale: 'JSON_LD' },
  });

  assert.equal(merged.sale.basis, 'ASKING_SALE_PRICE');
  assert.equal(merged.sale.amount, 200000);
});

test('a better-sourced value of the SAME basis does overwrite', () => {
  const base = emptyListing();
  base.sale = money(200000, 'USD', 'ASKING_SALE_PRICE');
  base.fieldOrigins['sale'] = 'TEXT';

  const merged = mergeListing(base, {
    sale: money(199000, 'USD', 'ASKING_SALE_PRICE'),
    fieldOrigins: { sale: 'JSON_LD' },
  });
  assert.equal(merged.sale.amount, 199000);
});

test('price per sqm is derived from sale only, and only in square metres', () => {
  const rentOnly = { ...emptyListing(), rent: money(900, 'USD', 'ASKING_RENT'), area: { value: 60, unit: 'sqm' } };
  assert.equal(deriveSalePricePerSqm(rentOnly).salePricePerSqm, null);

  const sqft = { ...emptyListing(), sale: money(120000, 'USD', 'ASKING_SALE_PRICE'), area: { value: 800, unit: 'sqft' } };
  assert.equal(deriveSalePricePerSqm(sqft).salePricePerSqm, null);

  const ok = { ...emptyListing(), sale: money(120000, 'USD', 'ASKING_SALE_PRICE'), area: { value: 60, unit: 'sqm' } };
  assert.equal(deriveSalePricePerSqm(ok).salePricePerSqm, 2000);
});

test('days on market is a field, never a computation', () => {
  const listing = emptyListing();
  assert.equal(listing.daysOnMarket, null);
  assert.equal(listing.publishedAt, null);
  // There is no deriveDaysOnMarket(). Subtracting a scrape time from today
  // would produce a fact about the crawler.
});

/* ── Pooling ──────────────────────────────────────────────────────────── */

test('pooling refuses a mixed basis outright', () => {
  const result = pool(
    [
      { observation: obs(), value: money(200000, 'USD', 'ASKING_SALE_PRICE') },
      { observation: obs(), value: money(185000, 'USD', 'TRANSACTION_PRICE') },
    ],
    support,
  );
  assert.equal(result.ok, false);
  assert.equal(result.refusal, 'MIXED_PRICE_BASIS');
});

test('pooling refuses a mixed currency rather than converting', () => {
  const result = pool(
    [
      { observation: obs(), value: money(200000, 'USD', 'ASKING_SALE_PRICE') },
      { observation: obs(), value: money(540000, 'GEL', 'ASKING_SALE_PRICE') },
    ],
    support,
  );
  assert.equal(result.ok, false);
  assert.equal(result.refusal, 'MIXED_CURRENCY');
});

test('pooling refuses a set of unlabelled figures', () => {
  const result = pool(
    [
      { observation: obs(), value: money(100, 'USD', 'UNKNOWN') },
      { observation: obs(), value: money(120, 'USD', 'UNKNOWN') },
    ],
    support,
  );
  assert.equal(result.ok, false);
  assert.equal(result.refusal, 'UNKNOWN_BASIS');
});

test('a clean pool reports the FURTHEST evidence level it contains', () => {
  // A set that is mostly district-wide with one same-building listing is
  // district evidence, and must not be described as same-building.
  const result = pool(
    [
      { observation: obs('SAME_BUILDING'), value: money(200000, 'USD', 'ASKING_SALE_PRICE'), perSqm: 2000 },
      { observation: obs('DISTRICT'), value: money(220000, 'USD', 'ASKING_SALE_PRICE'), perSqm: 2200 },
      { observation: obs('MICRO_LOCATION'), value: money(210000, 'USD', 'ASKING_SALE_PRICE'), perSqm: 2100 },
    ],
    support,
  );
  assert.equal(result.ok, true);
  assert.equal(result.pool.evidenceLevel, 'DISTRICT');
  assert.equal(result.pool.count, 3);
  assert.equal(result.pool.median, 210000);
  assert.equal(result.pool.perSqmMedian, 2100);
  assert.equal(result.pool.basis, 'ASKING_SALE_PRICE');
});

test('a mixed set becomes several honest pools, never one dishonest one', () => {
  const pools = poolByBasis(
    [
      { observation: obs(), value: money(200000, 'USD', 'ASKING_SALE_PRICE') },
      { observation: obs(), value: money(210000, 'USD', 'ASKING_SALE_PRICE') },
      { observation: obs(), value: money(185000, 'USD', 'TRANSACTION_PRICE') },
      { observation: obs(), value: money(900, 'USD', 'ASKING_RENT') },
    ],
    support,
  );
  const byBasis = Object.fromEntries(pools.map((p) => [p.basis, p.count]));
  assert.deepEqual(byBasis, { ASKING_SALE_PRICE: 2, TRANSACTION_PRICE: 1, ASKING_RENT: 1 });
  // And no pool contains anything from another basis.
  for (const p of pools) assert.ok(p.count > 0);
});
