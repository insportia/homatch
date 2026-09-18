// Can the Research Core actually support the Investment flow?
//
// Not "does each part have a test" — the parts all have tests. This drives the
// whole chain the Investment product will need, end to end, against a fake
// network, and asserts the properties that make the answer trustworthy:
//
//   research profile
//     → fresh-cache check
//     → cost/credit estimate (grant → budget)
//     → bounded parallel live research
//     → parse / normalize
//     → dedupe / independence / conflicts
//     → provenance-preserving EvidenceItem bundle
//     → deterministic coverage verdict
//
// The last two layers of the target flow — deterministic Investment
// calculations and an AI summary — are future Investment work and are NOT
// built here. What is asserted is that the bundle handed to them is complete
// enough for the first and independent of the second: the verdict below is
// arithmetic, and no model is involved anywhere in this file.

import test from 'node:test';
import assert from 'node:assert/strict';

import { HttpClient } from '../fetch/http-client.ts';
import { MockTransport } from '../fetch/mock-transport.ts';
import { CachedFetcher, totalUsage } from '../fetch/cached-fetcher.ts';
import { RateLimiter } from '../flow/rate-limiter.ts';
import { CircuitBreakerRegistry } from '../flow/circuit-breaker.ts';
import { NetworkPolicy, StaticDnsResolver } from '../net/network-policy.ts';
import { SourceAccessPolicyRegistry, DEFAULT_SOURCE_POLICY } from '../net/source-policy.ts';
import { parseHtml } from '../parse/html.ts';
import { extractJsonLd } from '../parse/json-ld.ts';
import { listingFromJsonLd } from '../parse/schema-org.ts';
import { emptyListing, mergeListing, deriveSalePricePerSqm } from '../parse/listing.ts';
import { dedupeObservations } from '../score/document-dedupe.ts';
import { computeIndependence, supportFor } from '../score/independence.ts';
import { detectConflicts } from '../score/conflicts.ts';
import { poolByBasis } from '../score/pooling.ts';
import { evaluateCoverage } from '../profiles/coverage.ts';
import { MARKET_COMPARABLES } from '../profiles/investment.ts';
import { budgetFor } from '../bridge/budget.ts';
import { toActualUsage, toCostEventRow, avoidedProviderCalls } from '../bridge/cost.ts';
import { toEvidenceItem } from '../bridge/evidence.ts';
import { contentHash } from '../normalize/hash.ts';
import { deterministicId } from '../core/ids.ts';

/* ── A fake Tbilisi ───────────────────────────────────────────────────── */

function listingPage({ id, price, area, project }) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'Apartment',
    name: `${area} m² in ${project}`,
    identifier: id,
    floorSize: { '@type': 'QuantitativeValue', value: area, unitCode: 'MTK' },
    address: { '@type': 'PostalAddress', addressLocality: 'Tbilisi', addressRegion: 'Vake' },
    offers: { '@type': 'Offer', price, priceCurrency: 'USD', availability: 'https://schema.org/InStock' },
    isPartOf: { '@type': 'Place', name: project },
  };
  return `<html><head><title>${project}</title>
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
    </head><body><p>${area} m² apartment in ${project}, Vake, asking $${price}.</p></body></html>`;
}

const SUBJECT = { id: 'A-101', price: 180000, area: 72, project: 'Vake Residence' };
const PEERS = [
  { id: 'A-204', price: 192000, area: 75, project: 'Vake Residence', family: 'myhome.ge' },
  { id: 'A-305', price: 176000, area: 70, project: 'Vake Residence', family: 'ss.ge' },
  { id: 'B-110', price: 205000, area: 80, project: 'Vake Heights', family: 'korter.ge' },
];

const HOSTS = {
  'myhome.test': ['93.184.216.34'],
  'ss.test': ['93.184.216.35'],
  'korter.test': ['93.184.216.36'],
};

const FAMILY_OF = { 'myhome.test': 'myhome.ge', 'ss.test': 'ss.ge', 'korter.test': 'korter.ge' };

function harness() {
  const routes = [
    { match: 'https://myhome.test/l/A-101', body: listingPage(SUBJECT) },
    { match: 'https://myhome.test/l/A-204', body: listingPage(PEERS[0]) },
    { match: 'https://ss.test/l/A-305', body: listingPage(PEERS[1]) },
    { match: 'https://korter.test/l/B-110', body: listingPage(PEERS[2]) },
    // The same A-204 listing, syndicated onto another host under a new URL.
    { match: 'https://ss.test/syndicated/A-204', body: listingPage(PEERS[0]) },
  ];
  const transport = new MockTransport(routes, { defaultDelayMs: 1 });

  const policies = new SourceAccessPolicyRegistry(
    Object.entries(FAMILY_OF).map(([host, family]) => ({
      ...DEFAULT_SOURCE_POLICY,
      id: family,
      domains: [host],
      sourceFamily: family,
      kind: 'PROPERTY_PORTAL',
      robots: 'NOT_APPLICABLE',
      rate: { concurrency: 4, requestsPerSecond: 1000, burst: 1000 },
    })),
  );

  const httpClient = new HttpClient({
    transport,
    rateLimiter: new RateLimiter({ defaultPolicy: { concurrency: 4, requestsPerSecond: 1000, burst: 1000 } }),
    breakers: new CircuitBreakerRegistry(),
    networkPolicy: new NetworkPolicy({ resolver: new StaticDnsResolver(HOSTS) }),
    sourcePolicies: policies,
    requirePinningTransport: false,
  });

  const rows = new Map();
  const store = {
    async get(fp) { return rows.get(fp) ?? null; },
    async put(doc) { rows.set(doc.fingerprint, doc); },
    async touch() {},
  };

  return { transport, policies, fetcher: new CachedFetcher({ httpClient, policies, store }) };
}

/** Fetch → parse → normalize → one Observation, exactly as a worker would. */
function observationFrom(result, { evidenceLevel, saleBasis }) {
  const doc = parseHtml(result.document.body);
  const listing = deriveSalePricePerSqm(
    mergeListing(emptyListing(), listingFromJsonLd(extractJsonLd(doc).nodes, {
      saleBasis,
      rentBasis: 'ASKING_RENT',
    })),
  );
  const host = new URL(result.document.url).hostname;
  const family = FAMILY_OF[host] ?? 'unknown';

  return {
    observation: {
      id: deterministicId('obs', result.document.fingerprint),
      requestedUrl: result.document.url,
      fetchUrl: result.document.url,
      canonicalIdentityUrl: result.document.url,
      source: { sourceKey: host, sourceFamily: family, kind: 'PROPERTY_PORTAL' },
      evidenceLevel,
      observedAt: listing.publishedAt,
      retrievedAt: result.document.retrievedAt,
      contentHash: contentHash(doc.text),
      nearDuplicateFingerprint: null,
      structuredSourceId: listing.listingId,
      payload: { listing },
      fieldOrigins: listing.fieldOrigins,
      supportingText: doc.text.slice(0, 160),
    },
    listing,
  };
}

const GRANT = {
  ok: true,
  funding: 'PAYG',
  productCode: 'MARKET_COMPARABLES',
  qualityTier: 'MAXIMUM',
  resultCeiling: null,
  providerBudgetCeilingCents: 250,
  priorityLevel: 5,
  partialBudget: false,
  authorizedMaxCredits: 12,
  estimateMaxCredits: 12,
};

async function runComparables({ forceRefresh = false, grant = GRANT } = {}) {
  const { transport, fetcher } = harness();
  const budget = budgetFor(MARKET_COMPARABLES, grant);
  const context = { visibilityScope: 'PUBLIC_GLOBAL' };

  const targets = [
    { url: 'https://myhome.test/l/A-101', level: 'SAME_PROPERTY' },
    { url: 'https://myhome.test/l/A-204', level: 'SAME_PROJECT' },
    { url: 'https://ss.test/l/A-305', level: 'SAME_PROJECT' },
    { url: 'https://korter.test/l/B-110', level: 'MICRO_LOCATION' },
    { url: 'https://ss.test/syndicated/A-204', level: 'SAME_PROJECT' },
  ].slice(0, budget.maxDocuments);

  // Bounded parallel live research.
  const results = await Promise.all(
    targets.map((target) => fetcher.fetch(target.url, { context, forceRefresh })),
  );

  const parsed = results.map((result, i) =>
    observationFrom(result, {
      evidenceLevel: targets[i].level,
      saleBasis: 'ASKING_SALE_PRICE',
    }),
  );
  const observations = parsed.map((p) => p.observation);

  const deduped = dedupeObservations(observations, {
    entityIdOf: (o) => o.structuredSourceId,
  });
  const independence = computeIndependence(deduped.observations, {
    // Three listings on one portal are three different properties.
    subjectOf: (o) => o.structuredSourceId ?? o.id,
  });
  const supportOf = (subset) => supportFor(subset, independence);

  const contributions = deduped.observations
    .filter((entry) => entry.independent)
    .map((entry) => ({
      objectiveId:
        entry.observation.evidenceLevel === 'SAME_PROPERTY'
          ? 'comparables.asking_sale'
          : 'comparables.asking_sale',
      observation: entry.observation,
      priceBasis: 'ASKING_SALE_PRICE',
    }));

  const coverage = evaluateCoverage(MARKET_COMPARABLES, contributions, { supportOf });

  const pools = poolByBasis(
    parsed
      .filter(({ observation }) =>
        deduped.observations.find((e) => e.observation.id === observation.id)?.independent,
      )
      .map(({ observation, listing }) => ({
        observation,
        value: listing.sale,
        perSqm: listing.salePricePerSqm,
      })),
    supportOf,
  );

  const usage = totalUsage(results, 'RESEARCH_CORE_HTTP');

  return { transport, budget, results, parsed, deduped, independence, supportOf, coverage, pools, usage };
}

/* ── The flow ─────────────────────────────────────────────────────────── */

test('the whole chain runs and produces a deterministic verdict with no model', async () => {
  const { coverage } = await runComparables();
  assert.equal(coverage.profileId, 'MARKET_COMPARABLES');
  assert.equal(coverage.status, 'COMPLETE');
  const asking = coverage.objectives.find((o) => o.objectiveId === 'comparables.asking_sale');
  assert.equal(asking.status, 'ESTABLISHED');
  assert.equal(asking.priceBasis, 'ASKING_SALE_PRICE');
});

test('the grant decides the plan before the first fetch', async () => {
  const full = await runComparables();
  const partial = await runComparables({
    grant: { ...GRANT, partialBudget: true, authorizedMaxCredits: 3, estimateMaxCredits: 12 },
  });
  assert.equal(full.budget.workClass, 'INTERACTIVE_HIGH');
  assert.ok(partial.budget.maxDocuments < full.budget.maxDocuments);
  assert.ok(partial.results.length <= partial.budget.maxDocuments);
  assert.equal(partial.budget.providerBudgetCeilingCents, 250);
});

test('the syndicated copy is folded in, not counted as a fourth opinion', async () => {
  const { deduped, independence } = await runComparables();
  assert.equal(deduped.duplicateCount, 1, 'the syndicated listing was not detected');
  // Four distinct listings survive as independent observations.
  assert.equal(independence.observationCount, 4);
});

test('a portal listing three properties is not discounted for doing so', async () => {
  const { independence } = await runComparables();
  // myhome.test carries two DIFFERENT flats (A-101, A-204). Both keep full
  // weight: only repeated claims about one subject are redundant.
  assert.equal(independence.familyCounts['myhome.ge'], 2);
  assert.equal(independence.effectiveSourceCount, 4);
});

test('the three counts survive all the way to the bundle, separately', async () => {
  const { coverage } = await runComparables();
  const asking = coverage.objectives.find((o) => o.objectiveId === 'comparables.asking_sale');
  assert.equal(asking.support.observationCount, 4);
  assert.equal(asking.support.independentSourceCount, 3);
  assert.ok(asking.support.effectiveSourceCount > 0);
  assert.notEqual(asking.support.observationCount, asking.support.independentSourceCount);
});

test('the achieved evidence level is the furthest one used, not the one asked for', async () => {
  const { coverage } = await runComparables();
  const asking = coverage.objectives.find((o) => o.objectiveId === 'comparables.asking_sale');
  assert.equal(asking.achievedLevel, 'MICRO_LOCATION');
});

test('the pool is basis-clean and reports real statistics', async () => {
  const { pools } = await runComparables();
  assert.equal(pools.length, 1, 'more than one basis leaked into the result');
  const [pool] = pools;
  assert.equal(pool.basis, 'ASKING_SALE_PRICE');
  assert.equal(pool.currency, 'USD');
  assert.equal(pool.count, 4);
  assert.equal(pool.min, 176000);
  assert.equal(pool.max, 205000);
  assert.ok(pool.perSqmMedian > 2000 && pool.perSqmMedian < 3000, `perSqmMedian=${pool.perSqmMedian}`);
  assert.equal(pool.evidenceLevel, 'MICRO_LOCATION');
});

test('the parsed prices are asking prices, and nothing relabels them', async () => {
  const { parsed } = await runComparables();
  for (const { listing } of parsed) {
    assert.equal(listing.sale.basis, 'ASKING_SALE_PRICE');
    assert.equal(listing.rent, null);
    assert.equal(listing.daysOnMarket, null, 'days on market was invented');
  }
});

test('disagreement between two portals about one listing is preserved', async () => {
  const { parsed, supportOf } = await runComparables();
  const subject = parsed[0].observation;
  const rival = {
    ...parsed[1].observation,
    id: 'rival',
    source: { sourceKey: 'ss.test', sourceFamily: 'ss.ge', kind: 'PROPERTY_PORTAL' },
    evidenceLevel: 'SAME_PROPERTY',
  };

  const conflicts = detectConflicts(
    [
      { observation: subject, claimKey: 'listing.price', value: 180000, money: parsed[0].listing.sale },
      { observation: rival, claimKey: 'listing.price', value: 240000, money: { ...parsed[0].listing.sale, amount: 240000 } },
    ],
    { supportOf },
  );

  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0].alternatives.length, 2);
  assert.ok(conflicts[0].alternatives.some((a) => a.value === 240000));
});

test('every observation becomes an EvidenceItem with provenance intact', async () => {
  const { deduped } = await runComparables();
  const items = deduped.observations.map((entry) =>
    toEvidenceItem({
      entry,
      // The caller owns the localized text. The core never writes it.
      claim: 'comparable listing',
      source: `${entry.observation.source.sourceFamily} listing`,
      type: 'MARKET_COMPARABLE',
      confidence: 0.7,
    }),
  );

  assert.equal(items.length, 5);
  for (const item of items) {
    assert.ok(item.sourceUrl, 'an evidence item has no source URL');
    assert.ok(item.retrievedAt, 'an evidence item has no retrieval timestamp');
    assert.notEqual(item.sourceClass, 'OFFICIAL');
    assert.ok(['VERIFIED', 'UNVERIFIED', 'DISPUTED'].includes(item.verificationState));
  }
  // The folded-in duplicate is still in the ledger — nothing was deleted.
  assert.equal(items.filter((i) => i.verificationState === 'UNVERIFIED').length, 1);
});

test('repeating the same research costs nothing the second time', async () => {
  const { transport, fetcher } = harness();
  const context = { visibilityScope: 'PUBLIC_GLOBAL' };
  const url = 'https://myhome.test/l/A-101';

  await fetcher.fetch(url, { context });
  const second = await fetcher.fetch(url, { context });

  assert.equal(transport.callsFor(url), 1);
  assert.equal(second.usage.cacheHits, 1);
  assert.equal(second.usage.networkRequests, 0);
});

test('the run reports consumption in the shapes billing and COGS already take', async () => {
  const { usage } = await runComparables();

  const actual = toActualUsage(usage);
  assert.equal(actual.provider, 'RESEARCH_CORE_HTTP');
  assert.ok(actual.metadata.network_requests >= 5);
  // Free public pages: no billable units, and NO invented cost.
  assert.equal(actual.searchCount, 0);
  assert.equal('rawProviderCostCents' in actual, false);

  const row = toCostEventRow(usage, { operationType: 'RESEARCH_CORE_FETCH', jobId: 'job-1' });
  assert.equal(row.cost_usd, null, 'an unknown provider cost became a zero');
  assert.equal(row.job_id, 'job-1');
});

test('coalescing and caching are reported as avoided calls, not as money', async () => {
  const { fetcher } = harness();
  const context = { visibilityScope: 'PUBLIC_GLOBAL' };
  const url = 'https://myhome.test/l/A-101';

  const burst = await Promise.all(
    Array.from({ length: 50 }, () => fetcher.fetch(url, { context })),
  );
  const usage = totalUsage(burst, 'RESEARCH_CORE_HTTP');

  assert.equal(usage.networkRequests, 1);
  assert.equal(avoidedProviderCalls(usage), 49);
  // There is no function here that turns 49 avoided calls into dollars: the
  // rate lives in provider_price_book and the core does not read it.
  assert.equal(typeof avoidedProviderCalls(usage), 'number');
});

test('the verdict is reproducible — same inputs, same answer', async () => {
  const a = await runComparables();
  const b = await runComparables();
  assert.deepEqual(
    a.coverage.objectives.map((o) => [o.objectiveId, o.status, o.achievedLevel, o.priceBasis]),
    b.coverage.objectives.map((o) => [o.objectiveId, o.status, o.achievedLevel, o.priceBasis]),
  );
  assert.deepEqual(a.pools.map((p) => p.median), b.pools.map((p) => p.median));
});
