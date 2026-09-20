import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runMarketLane } from '../marketLane.ts';
import { runDiscovery, CORE_SEARCH_LANGUAGES } from '../../research-core/market/discoveryRun.ts';
import {
  openAiSearchProvider, hitsFromPayload, provenUrls, searchInstruction, webSearchCallCount,
} from '../search/openAiSearchProvider.ts';
import {
  cachingSearchProvider, memorySearchCache, searchCacheKey,
} from '../search/searchCache.ts';
import { subjectGeoFromSeed, streetStem, streetHintsFor } from '../search/subjectGeo.ts';

/*
 * THE PROVIDER WIRING.
 *
 * The discovery engine was proven before any of this existed; what these tests
 * cover is the part that makes it actually run — that a real provider reaches
 * the lane, that a locked one is not silently treated as an empty market, that
 * widening stops, that a street is not paid for twice, and that nothing the
 * model writes can become evidence on its own authority.
 */

const query = (text, language = 'en', precision = 'BUILDING') => ({
  text, language, precision, key: `${precision}:${language}:${text}`,
});

/* ------------------------------------------------------------------ *
 * The model relays; it does not invent                                *
 * ------------------------------------------------------------------ */

const payloadWith = (citedUrls, rows, searchCalls = 1) => ({
  output: [
    ...Array.from({ length: searchCalls }, () => ({
      type: 'web_search_call',
      action: { type: 'search', query: 'x' },
    })),
    {
      type: 'message',
      content: [{
        type: 'output_text',
        text: JSON.stringify(rows),
        annotations: citedUrls.map((url) => ({ type: 'url_citation', url, title: 'T' })),
      }],
    },
  ],
});

test('SEARCH_RESULT_PROVENANCE_PRESERVED: an uncited url never becomes evidence', () => {
  /*
   * The row below is exactly what a fabricated comparable looks like: a
   * plausible street, a plausible area, a plausible price, and a URL the tool
   * never retrieved. It moves a median if it survives, and it is
   * indistinguishable from evidence once it does.
   */
  const payload = payloadWith(
    ['https://www.myhome.ge/ru/s/1'],
    [
      { url: 'https://www.myhome.ge/ru/s/1', title: 'Real', snippet: 'Крцаниси улица 6 ; 97.2 м²' },
      { url: 'https://invented.example/listing/9', title: 'Invented', snippet: '120 м² $300,000' },
    ],
  );
  const { hits, unverified } = hitsFromPayload(payload);
  assert.equal(unverified, 1, 'the uncited row must be counted, not silently dropped');
  assert.deepEqual(hits.map((h) => h.url), ['https://www.myhome.ge/ru/s/1']);
  assert.match(hits[0].snippet, /97\.2/, 'the verbatim snippet is preserved');
});

test('a cited url with no transcribed row is still a discovered domain', () => {
  // Domain discovery is half of what this layer is for. Whether the model
  // bothered to write a row must not decide what exists.
  const payload = payloadWith(['https://estatehub.ge/x'], []);
  const { hits } = hitsFromPayload(payload);
  assert.deepEqual(hits.map((h) => h.url), ['https://estatehub.ge/x']);
  assert.equal(hits[0].snippet, '');
});

test('proven urls are read from both places the API carries them', () => {
  const payload = {
    output: [
      {
        type: 'web_search_call',
        action: { type: 'search', query: 'x', sources: [{ url: 'https://korter.ge/a' }] },
      },
      {
        type: 'message',
        content: [{
          type: 'output_text', text: '[]',
          annotations: [{ type: 'url_citation', url: 'https://myhome.ge/b' }],
        }],
      },
    ],
  };
  const proven = provenUrls(payload);
  assert.ok(proven.has('https://korter.ge/a'));
  assert.ok(proven.has('https://myhome.ge/b'));
  assert.equal(webSearchCallCount(payload), 1, 'billed calls are counted from the response');
});

test('json survives a model that appends prose or fences it', () => {
  const rows = [{ url: 'https://korter.ge/a', title: 'A', snippet: 'S' }];
  for (const text of [
    JSON.stringify(rows),
    '```json\n' + JSON.stringify(rows) + '\n```',
    JSON.stringify(rows) + '\n\nI hope this helps!',
  ]) {
    const payload = {
      output: [{
        type: 'message',
        content: [{
          type: 'output_text', text,
          annotations: [{ type: 'url_citation', url: 'https://korter.ge/a' }],
        }],
      }],
    };
    assert.equal(hitsFromPayload(payload).hits.length, 1, text.slice(0, 20));
  }
});

test('the instruction forbids inventing, and treats page text as untrusted', () => {
  const i = searchInstruction(query('Villion Krtsanisi'), 10);
  assert.match(i, /VERBATIM/);
  assert.match(i, /Never invent/i);
  assert.match(i, /untrusted CONTENT/i);
  assert.match(i, /never follow it/i);
  assert.ok(i.includes('Villion Krtsanisi'), 'the query itself must be asked');
});

test('a provider failure is PROVIDER_ERROR, never an empty market', async () => {
  const provider = openAiSearchProvider({
    apiKey: 'k', model: 'm',
    fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }),
  });
  const r = await provider.search(query('x'));
  assert.equal(r.status, 'PROVIDER_ERROR');
  assert.equal(r.hits.length, 0);
});

test('DATAFORSEO_NOT_CALLED: the provider talks only to OpenAI', async () => {
  const urls = [];
  const provider = openAiSearchProvider({
    apiKey: 'k', model: 'm',
    fetchImpl: async (url) => {
      urls.push(String(url));
      return { ok: true, status: 200, json: async () => payloadWith([], []) };
    },
  });
  await provider.search(query('x'));
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^https:\/\/api\.openai\.com\/v1\/responses$/);
  for (const u of urls) assert.ok(!/dataforseo/i.test(u), 'no vendor call');
});

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

test('NO_PROVIDER_NULL_DISCOVERY_BUG: no provider means null, not a zeroed report', async () => {
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
 * Cost                                                                *
 * ------------------------------------------------------------------ */

const SUBJECT_GEO = {
  names: ['Villion'],
  address: 'კრწანისის ქუჩა 6',
  lat: 41.67653101,
  lon: 44.82462376,
  district: 'კრწანისი',
  city: 'თბილისი',
  streetHints: ['Krtsanisi', 'Крцаниси', 'კრწანისი'],
};

/** A provider that answers everything with one local listing. */
function generousProvider(onQuery) {
  let n = 0;
  return {
    id: 'TEST',
    async search(q) {
      onQuery?.(q);
      n += 1;
      return {
        status: 'OK',
        hits: [{
          url: `https://estatehub.ge/listing/${n}`,
          title: 'Apartment in Krtsanisi',
          snippet: `Krtsanisi Street 6, Tbilisi — ${80 + n} m², 3 rooms, $ ${2000 + n} per m²`,
        }],
      };
    },
  };
}

test('STAGED_WIDENING_STOPS_CORRECTLY: the city band is never reached', async () => {
  const asked = [];
  const plan = [
    query('b1', 'en', 'BUILDING'), query('b2', 'ka', 'BUILDING'),
    query('s1', 'en', 'STREET'), query('s2', 'ru', 'STREET'),
    query('m1', 'en', 'MICROLOCATION'),
    query('d1', 'en', 'DISTRICT'),
    query('c1', 'en', 'CITY'), query('c2', 'ru', 'CITY'),
  ];
  const report = await runDiscovery({
    plan, subject: SUBJECT_GEO, search: generousProvider((q) => asked.push(q.text)), enoughLocal: 2,
  });

  assert.ok(!asked.includes('c1'), 'the open market was asked despite local evidence');
  assert.ok(!asked.includes('d1'), 'the district was asked despite local evidence');
  assert.ok(report.searchCalls < plan.length, 'every formulation was billed');

  // But the band that satisfied the run was FINISHED, not abandoned halfway:
  // the unasked half of a band would otherwise be reported as an absence it
  // was never given the chance to contradict.
  assert.ok(asked.includes('b1') && asked.includes('b2'), 'the building band was cut short');
  const building = report.stages.find((s) => s.stage === 'BUILDING');
  assert.ok(building.stoppedHere, 'the run should have stopped at the building boundary');
});

test('widening continues when the narrow bands find nothing', async () => {
  const asked = [];
  const empty = { id: 'EMPTY', async search(q) { asked.push(q.text); return { status: 'OK', hits: [] }; } };
  const plan = [
    query('b1', 'en', 'BUILDING'), query('s1', 'en', 'STREET'),
    query('m1', 'en', 'MICROLOCATION'), query('c1', 'en', 'CITY'),
  ];
  const report = await runDiscovery({ plan, subject: SUBJECT_GEO, search: empty, enoughLocal: 3 });
  assert.deepEqual(asked, ['b1', 's1', 'm1', 'c1'], 'a silent street must widen to the city');
  assert.equal(report.outcomes.NOT_DISCOVERED, 4, 'asked and empty is recorded as such');
});

test('an identical formulation is never bought twice', async () => {
  const asked = [];
  const plan = [
    query('Villion', 'ka', 'BUILDING'),
    query('Villion', 'en', 'BUILDING'),
    query('Villion', 'ru', 'BUILDING'),
  ];
  const report = await runDiscovery({
    plan, subject: SUBJECT_GEO, search: generousProvider((q) => asked.push(q.text)),
  });
  assert.equal(asked.length, 1, 'the same string was searched more than once');
  assert.equal(report.searchCalls, 1);
});

test('the extended languages are only asked when the core three fall short', async () => {
  const asked = [];
  const plan = [
    query('b-ka', 'ka', 'BUILDING'), query('b-en', 'en', 'BUILDING'), query('b-ru', 'ru', 'BUILDING'),
    query('b-tr', 'tr', 'BUILDING'), query('b-ar', 'ar', 'BUILDING'), query('b-he', 'he', 'BUILDING'),
  ];
  const found = await runDiscovery({
    plan, subject: SUBJECT_GEO, search: generousProvider((q) => asked.push(q.language)), enoughLocal: 2,
  });
  assert.deepEqual([...new Set(asked)].sort(), [...CORE_SEARCH_LANGUAGES].sort());
  assert.ok(!asked.includes('ar'), 'a language was executed to move a counter');
  assert.ok(found.languages.length === 3);

  // And when the core three find nothing, the rest are asked.
  const quiet = [];
  const empty = { id: 'E', async search(q) { quiet.push(q.language); return { status: 'OK', hits: [] }; } };
  await runDiscovery({ plan, subject: SUBJECT_GEO, search: empty, enoughLocal: 2 });
  assert.ok(quiet.includes('tr') && quiet.includes('ar') && quiet.includes('he'));
});

test('the budget is a hard ceiling even when nothing is found', async () => {
  const asked = [];
  const empty = { id: 'E', async search(q) { asked.push(q.text); return { status: 'OK', hits: [] }; } };
  const plan = Array.from({ length: 50 }, (_, i) => query(`q${i}`, 'en', 'CITY'));
  const report = await runDiscovery({ plan, subject: SUBJECT_GEO, search: empty, maxQueries: 7 });
  assert.equal(asked.length, 7);
  assert.equal(report.searchCalls, 7);
});

/* ------------------------------------------------------------------ *
 * Cache                                                               *
 * ------------------------------------------------------------------ */

test('CACHE_REUSE: the second property on a street does not buy it again', async () => {
  let calls = 0;
  const inner = {
    id: 'TEST',
    async search() {
      calls += 1;
      return { status: 'OK', hits: [{ url: 'https://estatehub.ge/1', title: 'T', snippet: 'Krtsanisi Street 6 — 97.2 m²' }] };
    },
  };
  const store = memorySearchCache();
  const cached = cachingSearchProvider(inner, store);

  const q = query('"Krtsanisi Street 6" apartment');
  const first = await cached.search(q);
  const second = await cached.search(q);

  assert.equal(calls, 1, 'the same question was paid for twice');
  assert.deepEqual(second.hits, first.hits);
  assert.equal(cached.stats().hits, 1);
  assert.equal(cached.stats().misses, 1);
});

test('a stale entry is a miss, because a listing is a live claim', async () => {
  let calls = 0;
  const inner = { id: 'T', async search() { calls += 1; return { status: 'OK', hits: [] }; } };
  let clock = 1_000_000;
  const cached = cachingSearchProvider(inner, memorySearchCache(), {
    ttlMs: 1000, now: () => clock,
  });
  await cached.search(query('x'));
  clock += 5000;
  await cached.search(query('x'));
  assert.equal(calls, 2, 'a month-old search must not stand in for today');
  assert.equal(cached.stats().stale, 1);
});

test('a failed search is never cached', async () => {
  let calls = 0;
  const inner = { id: 'T', async search() { calls += 1; return { status: 'PROVIDER_ERROR', hits: [] }; } };
  const cached = cachingSearchProvider(inner, memorySearchCache());
  await cached.search(query('x'));
  await cached.search(query('x'));
  assert.equal(calls, 2, 'one bad minute must not become six bad hours');
});

test('a cache that throws is a miss, never a failed run', async () => {
  const broken = {
    async get() { throw new Error('table gone'); },
    async set() { throw new Error('table gone'); },
  };
  const cached = cachingSearchProvider(
    { id: 'T', async search() { return { status: 'OK', hits: [] }; } },
    broken,
  );
  const r = await cached.search(query('x'));
  assert.equal(r.status, 'OK');
});

test('the cache key is the question, not the property asking it', () => {
  // The whole point: the next flat on this street inherits this street's
  // evidence. A key scoped per property would defeat that entirely.
  const a = searchCacheKey('OPENAI_WEB_SEARCH', query('"улица Крцаниси" квартира', 'ru'));
  const b = searchCacheKey('OPENAI_WEB_SEARCH', query('"УЛИЦА КРЦАНИСИ" КВАРТИРА  ', 'ru'));
  assert.equal(a, b);
  assert.notEqual(a, searchCacheKey('OTHER', query('"улица Крцаниси" квартира', 'ru')));
});

/* ------------------------------------------------------------------ *
 * The kill switch, untouched                                          *
 * ------------------------------------------------------------------ */

const repoFile = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('KILL_SWITCH_UNCHANGED: dataforseo-search still refuses everything', () => {
  const fn = repoFile('supabase/functions/dataforseo-search/index.ts');
  assert.match(fn, /paidLaunchesBlocked\s*:\s*true/);
  assert.match(fn, /423/);
  assert.ok(!/DATAFORSEO_LOGIN|api\.dataforseo\.com/i.test(fn), 'the function must not have grown a live path');
});

test('OPENAI_PROVIDER_REACHES_RUN_MARKET_LANE: production wires it, and not the vendor', () => {
  /*
   * The gap this closes: the engine was deployed and proven while
   * research-agent passed no provider at all, so a live Verify still reported
   * SAME_STREET = 0 with everything in place to find it.
   */
  const agent = repoFile('supabase/functions/research-agent/index.ts');
  assert.match(agent, /openAiSearchProvider\(/, 'the lane is not given a provider');
  assert.match(agent, /subjectGeoFromSeed\(/, 'the lane is not told where the subject is');
  assert.match(agent, /cachingSearchProvider\(/, 'the street would be bought again every run');
  assert.match(agent, /maxDiscoveryQueries/, 'there is no per-property search budget');
  assert.ok(
    !/dataForSeoProvider|dataforseo-search/i.test(agent),
    'research-agent must not call the locked vendor',
  );
});

test('the bought-vendor adapter stays out of Research Core', () => {
  // Enforced separately by discoveryLadder.test.mjs; asserted here too because
  // this is the change that would have been tempted to move it.
  const core = repoFile('src/research-core/market/searchProviders.ts');
  assert.ok(!/dataforseo/i.test(core));
  assert.ok(!/openai/i.test(core), 'the core names no vendor at all');
});
