// The market lane as the report sees it, and the reuse that makes it cheap.
//
// Two things are under test here that nothing else covers:
//
//   1. the mapping into the report's EXISTING comparable shape, because the
//      synthesis contract and every renderer downstream depend on it being
//      byte-compatible with what the AI market stage used to produce;
//
//   2. reuse — a cache hit and a coalesced request are the difference between
//      fifty concurrent verifications of one district costing fifty external
//      requests and costing one, and both must be MEASURED rather than
//      assumed, because "we avoided a request" is a claim the report makes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runMarketLane, marketLaneBrief } from '../marketLane.ts';
import { createPortalRuntime } from '../../research-core/market/runtime.ts';
import { buildResearchSeed } from '../researchSeed.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = readFileSync(
  join(HERE, '..', '..', 'research-core', '__tests__', 'fixtures', 'ss-ge-vake-sale.html'),
  'utf8',
);

/** A transport that serves the fixture and counts real hops. */
function countingTransport() {
  const state = { sends: 0, urls: [] };
  return {
    state,
    transport: {
      name: 'fixture',
      pinsAddresses: true,
      async send(request) {
        state.sends += 1;
        state.urls.push(request.url);
        const robots = request.url.endsWith('/robots.txt');
        return {
          status: 200,
          headers: { 'content-type': robots ? 'text/plain' : 'text/html; charset=utf-8' },
          body: robots ? 'User-agent: *\nDisallow: /en/user\n' : FIXTURE,
          finalUrl: request.url,
          bytes: robots ? 40 : FIXTURE.length,
          truncated: false,
          durationMs: 1,
        };
      },
    },
  };
}

function seedFor(jobId = 'job-1') {
  return buildResearchSeed({
    jobId,
    query: '97.2 m2 2 bedroom apartment for sale',
    mode: 'property',
    result: { reconciledIdentity: { address: 'Chavchavadze Avenue 12, Vake, Tbilisi' } },
  });
}

test('comparables arrive in the report\'s existing shape, with provenance', async () => {
  const { transport } = countingTransport();
  const runtime = createPortalRuntime({ transport, documentCache: new Map() });
  const lane = await runMarketLane(seedFor(), runtime.registry, runtime.context, { budgetMs: 8000 });

  assert.ok(lane, 'the lane ran');
  assert.ok(lane.comparables.length > 0);
  for (const c of lane.comparables) {
    // The keys the synthesis contract and every renderer already expect.
    for (const key of ['source', 'url', 'area', 'price', 'currency', 'pricePerSqm', 'comparableType']) {
      assert.ok(key in c, `comparable carries ${key}`);
    }
    assert.ok(['SAME_PROJECT', 'MICRO_LOCATION', 'PEER_PROJECT'].includes(c.comparableType));
    // Provenance a reader can check, and a reason it was considered relevant.
    assert.equal(c.discoveryMethod, 'DETERMINISTIC_PORTAL_SEARCH');
    assert.ok(c.similarity.length > 0);
    assert.match(c.url, /^https:\/\//);
  }
});

test('a rent figure never reaches a sale comparable\'s price-per-sqm', async () => {
  const { transport } = countingTransport();
  const runtime = createPortalRuntime({ transport, documentCache: new Map() });
  const lane = await runMarketLane(seedFor(), runtime.registry, runtime.context, { budgetMs: 8000 });
  for (const c of lane.comparables) {
    if (c.pricePerSqm !== null) {
      assert.ok(Number(c.pricePerSqm) > 100, 'a sale price per sqm, not a monthly rent');
    }
  }
});

test('a second identical run is served from cache and costs no new requests', async () => {
  const { transport, state } = countingTransport();
  const cache = new Map();
  const runtime = createPortalRuntime({ transport, documentCache: cache });

  await runMarketLane(seedFor('a'), runtime.registry, runtime.context, { budgetMs: 8000 });
  const afterFirst = state.sends;
  assert.ok(afterFirst > 0, 'the first run really fetched');

  await runMarketLane(seedFor('b'), runtime.registry, runtime.context, { budgetMs: 8000 });
  assert.equal(state.sends, afterFirst, 'the second run made no new network hops');

  const stats = runtime.stats();
  assert.ok(stats.cacheHits > 0, 'and the reuse was counted, not assumed');
});

test('two concurrent runs for the same district share one fetch', async () => {
  const { transport, state } = countingTransport();
  const runtime = createPortalRuntime({ transport, documentCache: new Map() });

  // Started together, before either result exists — which is precisely the
  // window a cache cannot help with and single-flight can.
  await Promise.all([
    runMarketLane(seedFor('x'), runtime.registry, runtime.context, { budgetMs: 8000 }),
    runMarketLane(seedFor('y'), runtime.registry, runtime.context, { budgetMs: 8000 }),
  ]);

  const stats = runtime.stats();
  assert.ok(stats.coalescedJoins > 0, 'one run joined the other instead of refetching');
  assert.ok(state.sends < 8, `expected sharing, saw ${state.sends} hops`);
});

test('the brief tells the model the research is done, not to go and search', async () => {
  const { transport } = countingTransport();
  const runtime = createPortalRuntime({ transport, documentCache: new Map() });
  const lane = await runMarketLane(seedFor(), runtime.registry, runtime.context, { budgetMs: 8000 });
  const brief = marketLaneBrief(lane);

  assert.match(brief, /ALREADY BEEN PERFORMED IN CODE/);
  assert.match(brief, /Do NOT spend/);
  // The three counts must reach the model as three different numbers.
  assert.match(brief, /likely-unique properties/);
  assert.match(brief, /Independent publisher families/);
  // And the basis must be stated, so nothing describes an asking price as a
  // transaction price.
  assert.match(brief, /ASKING prices/);
  assert.match(brief, /never transaction prices/);
});

test('an empty market brief refuses to imply a price conclusion', () => {
  const brief = marketLaneBrief({
    comparables: [],
    summary: { advertisements: 0, uniqueProperties: 0, portals: [] },
    conflicts: [],
  });
  assert.match(brief, /found no comparable listings/);
  assert.match(brief, /Do not present an absence of comparables/);
});

test('the lane declines rather than sweeping a city it knows nothing about', async () => {
  const { transport, state } = countingTransport();
  const runtime = createPortalRuntime({ transport, documentCache: new Map() });
  const bare = buildResearchSeed({ jobId: 'z', query: 'a flat', mode: 'property', result: {} });
  const lane = await runMarketLane(bare, runtime.registry, runtime.context, { budgetMs: 8000 });
  assert.equal(lane, null);
  assert.equal(state.sends, 0, 'and made no request at all');
});

test('the deterministic set is written to the path the final report reads', () => {
  /*
   * The bug this pins, caught on the first production run.
   *
   * MARKET's schema nests its answer under `market`, and SYNTHESIS assembles
   * the customer-facing report from `marketResearch.market.comparables`. The
   * merge originally wrote a top-level `z.comparables`, so 36 code-gathered
   * comparables landed in a field nothing reads and the report carried the 25
   * the model had paraphrased back out of the brief instead. Both halves
   * looked fine in isolation; only the path disagreed.
   */
  const agent = readFileSync(
    join(HERE, '..', '..', '..', 'supabase', 'functions', 'research-agent', 'index.ts'),
    'utf8',
  );

  // What the merge writes.
  assert.match(
    agent,
    /z\.market\.comparables = \[\.\.\.prior\._marketComparables/,
    'the deterministic comparables must be merged into z.market.comparables',
  );
  // What the report reads.
  assert.match(
    agent,
    /sanitizeComparables\(mr\.market\?\.comparables \|\| \[\]\)/,
    'the report assembles from marketResearch.market.comparables',
  );
  // And the dead path must not come back.
  assert.ok(
    !/z\.comparables = \[\.\.\.prior\._marketComparables/.test(agent),
    'z.comparables is not read by the report and must not be the merge target',
  );
});

test('deterministic price conflicts reach the list the report is built from', () => {
  /*
   * Same class of bug as the comparables path, found the same way.
   *
   * The report's conflicts are assembled from OFFICIAL's list and SYNTHESIS's
   * own. The market lane's price disagreements were merged into MARKET's
   * output, which that assembly never reads — so a finding computed in code
   * from structured evidence never reached the buyer.
   */
  const agent = readFileSync(
    join(HERE, '..', '..', '..', 'supabase', 'functions', 'research-agent', 'index.ts'),
    'utf8',
  );
  const assembly = agent.slice(
    agent.indexOf('const conflictsAll = semanticDedupe('),
    agent.indexOf('const materialConflicts'),
  );
  assert.ok(assembly.length > 0, 'found the conflicts assembly');
  assert.match(
    assembly,
    /prior\._marketConflicts/,
    'the market lane conflicts must be part of the list the report is built from',
  );
});

test('deterministic comparables survive the price-range filter the report applies', async () => {
  /*
   * The regression this pins, measured on production job a7d09fef.
   *
   * computeMarketRanges counts only rows where
   *   listingStatus === 'ACTIVE' && (!propertyType || propertyType === 'RESIDENTIAL')
   * and the deterministic comparables set neither field. All 36 reached the
   * report and every one was excluded from the median: activeComparablesUsed
   * went 25 -> 0 and positioning PREMIUM -> UNKNOWN. More evidence, and no
   * price range at all.
   */
  const { transport } = countingTransport();
  const runtime = createPortalRuntime({ transport, documentCache: new Map() });
  const lane = await runMarketLane(seedFor(), runtime.registry, runtime.context, { budgetMs: 8000 });

  const isResidential = (c) => !c.propertyType || c.propertyType === 'RESIDENTIAL';
  const active = lane.comparables.filter((c) => c.listingStatus === 'ACTIVE' && isResidential(c));
  assert.equal(active.length, lane.comparables.length, 'every comparable counts toward the range');
  assert.ok(active.length > 0);

  // And the figure the range is actually computed from is present.
  const priced = active.filter((c) => c.pricePerSqm !== null);
  assert.ok(priced.length > 0, 'at least one carries a price per square metre');

  // Nothing claims a status a live search cannot establish.
  for (const c of lane.comparables) {
    assert.ok(!['EXPIRED', 'REMOVED', 'SOLD'].includes(c.listingStatus));
  }
});

test('the filter the report applies is the one this test asserts', () => {
  // Read from the deployed source, so the two cannot drift apart.
  const agent = readFileSync(
    join(HERE, '..', '..', '..', 'supabase', 'functions', 'research-agent', 'index.ts'),
    'utf8',
  );
  assert.match(agent, /c\?\.listingStatus === 'ACTIVE' && isResidential\(c\)/);
  assert.match(agent, /!c\?\.propertyType \|\| c\.propertyType === 'RESIDENTIAL'/);
});
