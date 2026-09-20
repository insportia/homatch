import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runMarketLane } from '../marketLane.ts';
import { subjectGeoFromSeed, streetStem, streetHintsFor } from '../search/subjectGeo.ts';
import { httpCrawlFetcher } from '../search/httpCrawlFetcher.ts';

/*
 * THE CODE-ONLY WIRING.
 *
 * Discovery reaches the public web through sitemaps, robots.txt and ordinary
 * page fetches. There is no search provider in this path and these tests exist
 * to keep it that way: no SERP vendor, no model doing a crawler's job, and no
 * quiet reintroduction of either.
 */

/* ------------------------------------------------------------------ *
 * The lane                                                            *
 * ------------------------------------------------------------------ */

const SEED = {
  subjectRef: 'job-1',
  location: {
    countryCode: { value: 'GE', evidence: 'OFFICIAL', origin: 't' },
    city: { value: 'თბილისი', evidence: 'OFFICIAL', origin: 't' },
    district: { value: 'კრწანისი', evidence: 'OFFICIAL', origin: 't' },
    subDistrict: null,
    address: { value: 'კრწანისის ქუჩა 6', evidence: 'OFFICIAL', origin: 't' },
    latitude: { value: 41.67653101, evidence: 'WEB_RETRIEVED', origin: 't' },
    longitude: { value: 44.82462376, evidence: 'WEB_RETRIEVED', origin: 't' },
  },
  property: {
    cadastralCode: { value: '01.19.33.004.01.501', evidence: 'OFFICIAL', origin: 't' },
    parentCadastralCode: null,
    propertyType: { value: 'APARTMENT', evidence: 'OFFICIAL', origin: 't' },
    areaSqm: { value: 97.2, evidence: 'OFFICIAL', origin: 't' },
    rooms: { value: 3, evidence: 'OFFICIAL', origin: 't' },
    bedrooms: null,
    floor: { value: 7, evidence: 'OFFICIAL', origin: 't' },
    totalFloors: { value: 8, evidence: 'OFFICIAL', origin: 't' },
    transaction: 'SALE',
  },
  project: {
    name: { value: 'Villion', evidence: 'WEB_RETRIEVED', origin: 't' },
    aliases: ['ვილიონ'],
    developerName: null,
    developerCompanyName: { value: 'შპს მილენიო გრუპი', evidence: 'OFFICIAL', origin: 't' },
    developerCompanyId: null,
    urls: [],
  },
  knownListingUrls: [],
  languages: ['ka', 'en', 'ru'],
  establishedFactKeys: [],
};

test('the subject becomes a geography the resolver can use, in three scripts', () => {
  const geo = subjectGeoFromSeed(SEED);
  assert.ok(geo);
  assert.equal(geo.address, 'კრწანისის ქუჩა 6');
  assert.equal(geo.lat, 41.67653101);
  assert.equal(streetStem('კრწანისის ქუჩა 6'), 'კრწანისის');
  assert.equal(streetStem('ул. Крцаниси 6'), 'Крцаниси');

  const hints = streetHintsFor(SEED);
  assert.ok(hints.some((h) => /krtsanisi/i.test(h)), `no latin hint: ${hints.join(', ')}`);
  assert.ok(hints.some((h) => /კრწანის/.test(h)), 'no georgian hint');
  for (const h of hints) assert.ok(h.length >= 4, `hint too short to be safe: ${h}`);
});

test('a subject with nowhere to be does not run discovery at all', () => {
  // Without a street or a project every discovered listing tiers as city-wide,
  // and a city-wide sweep sold as local evidence is the defect being removed.
  const blank = {
    ...SEED,
    location: { ...SEED.location, address: null },
    project: { ...SEED.project, name: null, aliases: [] },
  };
  assert.equal(subjectGeoFromSeed(blank), null);
});

test('no crawler means null discovery, never a zeroed report', async () => {
  /*
   * The distinction the whole layer exists for. A lane that did not run must
   * be distinguishable from a street with nothing on it — a zeroed discovery
   * block would read as the second while meaning the first.
   */
  const lane = await runMarketLane(SEED, emptyRegistry(), {}, {});
  if (lane) assert.equal(lane.summary.discovery, null);
});

/** No adapters, so the portal lane makes no network call in a unit test. */
function emptyRegistry() {
  return { for: () => [], all: () => [] };
}

/* ------------------------------------------------------------------ *
 * No paid search, anywhere in the product path                        *
 * ------------------------------------------------------------------ */

const repoFile = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('SEARCH_API_DEPENDENCY = NONE: no product code reaches a SERP vendor', () => {
  /*
   * The rule the owner set, asserted rather than asserted-to. Market discovery
   * must work with no paid search provider at all, so none of the modules on
   * the discovery path may name one — not as an adapter, not as a fallback,
   * not as a configuration flag.
   */
  const VENDORS = /dataforseo|serpapi|serp-api|bing\.com\/v7|customsearch|api\.openai\.com|web_search/i;
  for (const rel of [
    'src/research-core/market/codeDiscovery.ts',
    'src/research-core/market/codeDiscoveryTargets.ts',
    'src/research-core/market/discoveryRun.ts',
    'src/research-core/market/discoverySources.ts',
    'src/verify/marketLane.ts',
    'src/verify/search/httpCrawlFetcher.ts',
    'src/verify/search/subjectGeo.ts',
  ]) {
    const code = repoFile(rel)
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    assert.ok(!VENDORS.test(code), `${rel} reaches a paid search provider`);
  }
});

test('the OpenAI web_search provider is gone from the product', () => {
  // Wired once, rejected by the owner, and removed rather than left dormant.
  for (const gone of [
    'src/verify/search/openAiSearchProvider.ts',
    'src/verify/search/searchCache.ts',
    'src/verify/search/supabaseSearchCache.ts',
  ]) {
    assert.throws(() => repoFile(gone), `${gone} still exists`);
  }
  const agent = repoFile('supabase/functions/research-agent/index.ts');
  assert.ok(!/openAiSearchProvider|cachingSearchProvider/.test(agent));
});

test('KILL_SWITCH_UNCHANGED: dataforseo-search still refuses everything', () => {
  const fn = repoFile('supabase/functions/dataforseo-search/index.ts');
  assert.match(fn, /paidLaunchesBlocked\s*:\s*true/);
  assert.match(fn, /423/);
  assert.ok(!/DATAFORSEO_LOGIN|api\.dataforseo\.com/i.test(fn), 'the function must not have grown a live path');
});

test('CODE_DISCOVERY_REACHES_RUN_MARKET_LANE: production wires the crawler', () => {
  /*
   * The gap this closes: the engine was deployed and proven while
   * research-agent passed nothing at all, so a live Verify still reported
   * SAME_STREET = 0 with the whole layer sitting behind it.
   */
  const agent = repoFile('supabase/functions/research-agent/index.ts');
  assert.match(agent, /httpCrawlFetcher\(/, 'the lane is not given a fetcher');
  assert.match(agent, /buildCodeDiscoverySeeds\(/, 'the lane is not given entry points');
  assert.match(agent, /subjectGeoFromSeed\(/, 'the lane is not told where the subject is');
  assert.match(agent, /MARKET_DISCOVERY_MAX_PAGES/, 'there is no per-property crawl budget');
});

test('the crawler identifies itself rather than impersonating a browser', () => {
  /*
   * A research fetcher dressed as Chrome makes our own robots compliance
   * decorative: a site cannot set rules for a client it cannot recognise.
   */
  const f = repoFile('src/verify/search/httpCrawlFetcher.ts');
  assert.match(f, /HomatchResearch\/1\.0/);
  assert.match(f, /respects robots\.txt/);
  assert.ok(!/Mozilla\/5\.0/.test(f), 'the crawler must not pretend to be a browser');
  assert.ok(httpCrawlFetcher().canDriveBrowser !== true);
});

test('a fetcher refusal is recorded, never turned into an empty market', async () => {
  const f = httpCrawlFetcher({
    fetchImpl: async () => { throw new Error('connection reset'); },
    sleep: async () => {},
  });
  const r = await f.fetch('https://example.com/x');
  assert.equal(r.ok, false);
  assert.equal(r.status, 0);
  assert.equal(r.body, '');
});

test('media that cannot hold a listing is not downloaded', async () => {
  const f = httpCrawlFetcher({
    sleep: async () => {},
    fetchImpl: async () => ({
      ok: true, status: 200,
      headers: { get: (k) => (k === 'content-type' ? 'image/jpeg' : null) },
      text: async () => { throw new Error('should not read an image'); },
    }),
  });
  const r = await f.fetch('https://example.com/a.jpg');
  assert.equal(r.ok, false);
});
