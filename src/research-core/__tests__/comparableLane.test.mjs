// The deterministic market lane: envelopes, identity, conflicts, counting.
//
// The properties under test are the ones that decide whether a market section
// is trustworthy:
//
//   - the envelope is derived from the subject and says why;
//   - five adverts for one flat are one property, not five comparables;
//   - a duplicate we are not SURE about is never merged and never dropped;
//   - two prices for one flat is a finding, not an average;
//   - observations and independent sources are different numbers;
//   - a slow or refused portal degrades the answer instead of failing it.

import test from 'node:test';
import assert from 'node:assert/strict';

import { emptySeed, seeded, seedSupportsMarketSearch } from '../plan/seed.ts';
import { buildComparableEnvelope, areaRangeFor, bedroomRangeFor, widenEnvelope } from '../plan/envelope.ts';
import { compareListings, identityBlockKey } from '../market/property-identity.ts';
import {
  groupIntoProperties,
  priceConflictFor,
  discoverComparables,
} from '../market/comparables.ts';
import { PortalRegistry } from '../adapters/portal/types.ts';
import { emptyListing } from '../parse/listing.ts';

/* ── helpers ────────────────────────────────────────────────────────────── */

function subjectSeed(overrides = {}) {
  const seed = emptySeed('job-1');
  seed.location.countryCode = seeded('GE', 'DISTRICT', 'test');
  seed.location.city = seeded('Tbilisi', 'DISTRICT', 'test');
  seed.location.district = seeded('Vake', 'DISTRICT', 'reconciledIdentity');
  seed.location.subDistrict = seed.location.district;
  seed.property.propertyType = seeded('APARTMENT', 'SAME_PROPERTY', 'identity');
  seed.property.areaSqm = seeded(97.2, 'SAME_PROPERTY', 'property');
  seed.property.bedrooms = seeded(2, 'SAME_PROPERTY', 'property');
  seed.property.transaction = 'SALE';
  seed.languages = ['en'];
  return Object.assign(seed, overrides);
}

function listing(over = {}) {
  const l = emptyListing();
  l.area = { value: over.area ?? 97, unit: 'sqm' };
  l.bedrooms = over.bedrooms ?? 2;
  l.floor = over.floor ?? 5;
  l.district = over.district ?? 'Vake';
  l.city = 'Tbilisi';
  l.projectName = over.project ?? null;
  l.cadastralCode = over.cadastral ?? null;
  if (over.street) {
    l.address = { key: over.street, display: over.street, street: over.street, houseNumber: null, unit: null, city: 'Tbilisi', raw: over.street };
  }
  if (over.sale !== null) {
    l.sale = { amount: over.sale ?? 200000, currency: over.currency ?? 'USD', basis: 'ASKING_SALE_PRICE' };
  }
  if (over.rent) l.rent = { amount: over.rent, currency: 'USD', basis: 'ASKING_RENT' };
  return l;
}

function advert(over = {}) {
  return {
    portalId: over.portalId ?? 'p1',
    sourceFamily: over.family ?? 'ss.ge',
    externalId: over.id ?? String(Math.random()).slice(2, 10),
    url: over.url ?? `https://example.test/${over.id ?? Math.random()}`,
    listing: listing(over),
    priceBasis: over.rent ? 'ASKING_RENT' : 'ASKING_SALE_PRICE',
    retrievedAt: '2026-09-18T20:00:00.000Z',
    via: 'http',
    queryId: 'q1',
    matchRationale: over.rationale ?? 'same district (Vake)',
  };
}

/* ── the envelope ───────────────────────────────────────────────────────── */

test('the area tolerance is proportional but clamped at both ends', () => {
  // A studio does not get a ±5m² window that excludes every similar flat.
  const small = areaRangeFor(35);
  assert.equal(small.min, 25);
  assert.equal(small.max, 45);
  // A large house does not get a ±90m² window that stops being comparable.
  const large = areaRangeFor(600);
  assert.equal(large.max - large.min, 120);
  // An unknown area produces NO filter, rather than a window around a guess.
  assert.deepEqual(areaRangeFor(null), { min: null, max: null });
  assert.deepEqual(bedroomRangeFor(null), { min: null, max: null });
});

test('the envelope is derived from the subject and states its reasons', () => {
  const query = buildComparableEnvelope(subjectSeed());
  assert.equal(query.city, 'Tbilisi');
  assert.equal(query.district, 'Vake');
  assert.equal(query.transaction, 'SALE');
  assert.equal(query.propertyType, 'APARTMENT');
  assert.equal(query.area.min, 83);
  assert.equal(query.area.max, 112);
  // The rationale must name the evidence, because "why is this a comparable"
  // is a question the report has to answer.
  assert.match(query.rationale, /Vake/);
  assert.match(query.rationale, /reconciledIdentity/);
  assert.match(query.rationale, /97\.2/);
});

test('a subject we know too little about produces no query at all', () => {
  const bare = emptySeed('job-2');
  bare.location.city = seeded('Tbilisi', 'DISTRICT', 'test');
  // A city with nothing to narrow it is not a comparable set; "every flat in
  // Tbilisi" would be a worse answer dressed as a better one.
  assert.equal(seedSupportsMarketSearch(bare), false);
  assert.equal(buildComparableEnvelope(bare), null);
});

test('widening is explicit and says so', () => {
  const primary = buildComparableEnvelope(subjectSeed());
  const wider = widenEnvelope(primary);
  assert.ok(wider.area.min < primary.area.min);
  assert.equal(wider.bedrooms.min, null);
  assert.match(wider.rationale, /Widened/);
  assert.notEqual(wider.id, primary.id);
});

/* ── identity ───────────────────────────────────────────────────────────── */

test('a shared cadastral code settles identity in both directions', () => {
  const same = compareListings(listing({ cadastral: '01.18.06.001' }), listing({ cadastral: '01.18.06.001' }));
  assert.equal(same.verdict, 'SAME');
  const diff = compareListings(listing({ cadastral: '01.18.06.001' }), listing({ cadastral: '01.18.06.002' }));
  assert.equal(diff.verdict, 'DIFFERENT');
});

test('a physical contradiction settles it as DIFFERENT', () => {
  const decision = compareListings(listing({ area: 97, floor: 5 }), listing({ area: 97, floor: 9 }));
  assert.equal(decision.verdict, 'DIFFERENT');
  assert.ok(decision.conflicting.includes('floor'));
});

test('same address and same area is one property', () => {
  const decision = compareListings(
    listing({ street: 'chavchavadze 12', area: 97 }),
    listing({ street: 'chavchavadze 12', area: 97.2 }),
  );
  assert.equal(decision.verdict, 'SAME');
});

test('matching size with no address is UNCERTAIN, never merged', () => {
  const decision = compareListings(
    listing({ area: 97, bedrooms: 2, floor: 5 }),
    listing({ area: 97, bedrooms: 2, floor: 5 }),
  );
  // Two 97m² two-bedroom flats on the fifth floor of one district are
  // PROBABLY one property advertised twice — and might be two flats in one
  // building. Forcing either answer destroys information.
  assert.equal(decision.verdict, 'UNCERTAIN');
});

test('a differing price never makes two adverts different properties', () => {
  const a = listing({ street: 'chavchavadze 12', area: 97, sale: 200000 });
  const b = listing({ street: 'chavchavadze 12', area: 97, sale: 260000 });
  // If price disagreement split them, the conflict would erase itself — and
  // that conflict is the most valuable thing this lane can find.
  assert.equal(compareListings(a, b).verdict, 'SAME');
});

test('blocking never separates two adverts for the same flat', () => {
  // The bug this guards: an area-bucketed key puts 97m² and 98m² in different
  // buckets, so one flat advertised twice with slightly different areas is
  // never compared and survives as two comparables.
  const near = identityBlockKey(listing({ area: 97 }));
  assert.equal(near, identityBlockKey(listing({ area: 98 })));
  assert.equal(near, identityBlockKey(listing({ area: 300 })), 'area must not block');
  // Categorical differences are safe to separate on.
  assert.notEqual(near, identityBlockKey(listing({ district: 'Gldani' })));
  assert.notEqual(near, identityBlockKey(listing({ sale: null, rent: 1200 })));
});

/* ── grouping, conflicts, counting ──────────────────────────────────────── */

test('five adverts for one flat are one property and two source families', () => {
  const adverts = [
    advert({ id: 'a', street: 'chavchavadze 12', area: 97, family: 'ss.ge' }),
    advert({ id: 'b', street: 'chavchavadze 12', area: 97, family: 'ss.ge' }),
    advert({ id: 'c', street: 'chavchavadze 12', area: 97.2, family: 'myhome.ge' }),
  ];
  const groups = groupIntoProperties(adverts);
  assert.equal(groups.length, 1, 'three adverts, one property');
  assert.equal(groups[0].crossPosted.length, 2);
  assert.deepEqual(groups[0].sourceFamilies, ['myhome.ge', 'ss.ge']);
});

test('an uncertain duplicate is kept separate rather than forced either way', () => {
  const adverts = [
    advert({ id: 'a', area: 97, bedrooms: 2, floor: 5 }),
    advert({ id: 'b', area: 97, bedrooms: 2, floor: 5 }),
  ];
  const groups = groupIntoProperties(adverts);
  // Both remain countable as properties, and the uncertainty is recorded.
  assert.equal(groups.length, 2);
  assert.equal(groups[0].uncertain.length, 1);
  assert.match(groups[0].groupingReason, /possible duplicate/);
});

test('two prices for one property are preserved as a conflict', () => {
  const conflict = priceConflictFor([
    advert({ id: 'a', street: 'st 1', sale: 200000 }),
    advert({ id: 'b', street: 'st 1', sale: 260000 }),
  ]);
  assert.ok(conflict);
  assert.equal(conflict.values.length, 2);
  assert.equal(conflict.basis, 'ASKING_SALE_PRICE');
  assert.equal(conflict.spreadPct, 30);
});

test('a rent and a sale are never compared as two opinions about one number', () => {
  const conflict = priceConflictFor([
    advert({ id: 'a', sale: 200000 }),
    advert({ id: 'b', sale: null, rent: 1200 }),
  ]);
  assert.equal(conflict, null, 'different bases are a category error, not a conflict');
});

test('identical prices are not a conflict', () => {
  assert.equal(
    priceConflictFor([advert({ id: 'a', sale: 200000 }), advert({ id: 'b', sale: 200000 })]),
    null,
  );
});

/* ── the lane end to end, over a stub portal ────────────────────────────── */

function stubPortal(behaviour) {
  return {
    id: behaviour.id ?? 'stub',
    sourceFamily: behaviour.family ?? 'stub.test',
    countries: ['GE'],
    supports: () => true,
    handles: () => false,
    canonicalize: () => null,
    searchListings: behaviour.search,
  };
}

test('observations and independent sources are different numbers', async () => {
  const registry = new PortalRegistry()
    .register(
      stubPortal({
        id: 'one',
        family: 'ss.ge',
        async search(query) {
          return {
            ok: true,
            value: {
              listings: [
                advert({ id: '1', url: 'https://a.test/1', family: 'ss.ge', area: 90, floor: 1 }),
                advert({ id: '2', url: 'https://a.test/2', family: 'ss.ge', area: 95, floor: 2 }),
                advert({ id: '3', url: 'https://a.test/3', family: 'ss.ge', area: 100, floor: 3 }),
              ].map((a) => ({ ...a, queryId: query.id })),
              totalAvailable: 3,
              truncated: false,
              appliedFilters: { server: ['city'], client: [], unsupported: [] },
              pagesFetched: 1,
              networkRequests: 1,
            },
          };
        },
      }),
    );

  const evidence = await discoverComparables(subjectSeed(), registry, {
    fetchDocument: async () => {
      throw new Error('adapters here do not fetch');
    },
    authenticatedSession: false,
    now: () => 0,
  }, { budgetMs: 5000, sufficientUniqueProperties: 1 });

  assert.equal(evidence.observationCount, 3, 'three distinct flats were observed');
  assert.equal(evidence.independentSourceCount, 1, 'but they came from ONE publisher');
  assert.equal(evidence.uniqueProperties.length, 3);
});

test('a refused portal degrades the answer instead of failing the lane', async () => {
  const registry = new PortalRegistry().register(
    stubPortal({
      id: 'blocked',
      async search() {
        return { ok: false, reason: 'BLOCKED', detail: 'HTTP 403' };
      },
    }),
  );
  const evidence = await discoverComparables(subjectSeed(), registry, {
    fetchDocument: async () => ({}),
    authenticatedSession: false,
    now: () => 0,
  }, { budgetMs: 5000 });

  assert.ok(evidence, 'the lane still returns');
  assert.equal(evidence.advertisements.length, 0);
  const outcome = evidence.portals.find((p) => p.portalId === 'blocked');
  assert.equal(outcome.state, 'BLOCKED');
  assert.equal(outcome.detail, 'HTTP 403');
});

test('a completed run is not reported as truncated by its own deadline', async () => {
  const registry = new PortalRegistry().register(
    stubPortal({
      async search() {
        return {
          ok: true,
          value: {
            listings: [advert({ id: 'x', url: 'https://x.test/1' })],
            totalAvailable: 1,
            truncated: false,
            appliedFilters: { server: [], client: [], unsupported: [] },
            pagesFetched: 1,
            networkRequests: 1,
          },
        };
      },
    }),
  );
  const evidence = await discoverComparables(subjectSeed(), registry, {
    fetchDocument: async () => ({}),
    authenticatedSession: false,
    now: () => Date.now(),
  }, { budgetMs: 5000, sufficientUniqueProperties: 1 });
  assert.equal(evidence.truncatedByDeadline, false);
});

test('a thin result widens the envelope and records that it did', async () => {
  const seen = [];
  const registry = new PortalRegistry().register(
    stubPortal({
      async search(query) {
        seen.push(query.id);
        return {
          ok: true,
          value: {
            listings: [advert({ id: `q${seen.length}`, url: `https://w.test/${seen.length}` })],
            totalAvailable: 1,
            truncated: false,
            appliedFilters: { server: [], client: [], unsupported: [] },
            pagesFetched: 1,
            networkRequests: 1,
          },
        };
      },
    }),
  );
  const evidence = await discoverComparables(subjectSeed(), registry, {
    fetchDocument: async () => ({}),
    authenticatedSession: false,
    now: () => Date.now(),
  }, { budgetMs: 5000, sufficientUniqueProperties: 5 });

  assert.equal(evidence.widened, true);
  assert.equal(seen.length, 2);
  assert.match(seen[1], /widened/);
});
