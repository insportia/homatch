import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fromSearchSnippet, streetNumberFrom } from '../listingExtract.ts';
import { sameStreet, sameAddress, matchesProject } from '../geoResolve.ts';
import { classifyDomain, worthExtracting, SEED_DOMAINS } from '../discoverySources.ts';
import { dedupeSyndicated, statsByTier, headlineTier, LOCAL_TIERS } from '../geoTier.ts';
import { runDiscovery } from '../discoveryRun.ts';
import { harvestProvider, noSearchProvider, normaliseSerp } from '../searchProviders.ts';

/*
 * THE KRTSANISI ACCEPTANCE FIXTURE.
 *
 * ── WHAT THIS PROVES, AND WHY IT IS NOT A HARDCODED ANSWER ───────────
 *
 * Every row below is a REAL search result harvested on 2026-09-20 by running
 * the staged multilingual query family against the public index: 166 results
 * across 39 domains, in Georgian, English and Russian.
 *
 * The fixture is the RAW INDEX EVIDENCE — titles and snippets exactly as the
 * search engine returned them. The listing is not written down as a fact; the
 * pipeline has to recover it, and if extraction, address normalisation or
 * project identity regress, these tests fail.
 *
 * ── WHAT THE OLD PIPELINE SAID ABOUT THIS STREET ─────────────────────
 *
 *   SAME_PROJECT 0 · SAME_STREET 0 · MICROLOCATION 0
 *
 * while myhome.ge, korter.ge, ss.ge, estatehub.ge and the developer's own site
 * were all publicly advertising inventory on it. The zero was our search.
 */

const SUBJECT = {
  names: ['Villion', 'ვილიონ'],
  address: 'კრწანისის ქუჩა 6',
  developer: 'შპს მილენიო გრუპი',
  lat: 41.67653101,
  lon: 44.82462376,
};

const STREET_HINTS = ['Krtsanisi', 'Крцаниси', 'კრწანისი', 'krcanisi', 'krwanisi'];

/** Real harvested rows, verbatim. */
const HARVEST = [
  {
    domain: 'korter.ge',
    url: 'https://korter.ge/house-on-krtsanisi-6-tbilisi',
    title: 'ბინები და გეგმები Villion თბილისში',
    snippet: 'ბინების გაყიდვა Villion-ში · 3 ოთახიანი ბინა, 471 285 ₾-დან, 82.2 მ², Villion, კრწანისის ქუჩა 6',
    query: '"Villion" კრწანისი ბინა',
  },
  {
    domain: 'myhome.ge',
    url: 'https://www.myhome.ge/ru/s/#result-1',
    title: 'Квартиры В Крцаниси',
    snippet: '201,447 · 3,919₾ /м² · 51.4 · Крцаниси улица. 7 сент., 18:45 ; 1,045 · 17₾ /м² · 60 · Крцаниси улица 16.',
    query: 'site:myhome.ge крцаниси улица',
  },
  {
    domain: 'myhome.ge',
    url: 'https://www.myhome.ge/ru/s/#result-2',
    title: 'Продается 3 комнатная квартира в крцаниси',
    snippet: 'Продается 3 комнатная квартира, Крцаниси улица 6 ; 97.2 м². Площадь ; 7/8 этаж ; 3 Комнаты',
    query: '"Крцаниси улица 6" квартира',
  },
  {
    domain: 'estatehub.ge',
    url: 'https://estatehub.ge/#result-1',
    title: 'Apartment for sale in Krtsanisi',
    snippet: 'Krtsanisi Street 6, Tbilisi — 97.2 m², 3 rooms, floor 7/8',
    query: '"Krtsanisi Street 6" apartment',
  },
  {
    domain: 'home.ss.ge',
    url: 'https://home.ss.ge/ka/udzravi-qoneba/30233493',
    title: 'Продаются квартиры, Ортачала, ул. Крцаниси',
    snippet: 'Посмотрите квартиры, Ортачала, ул. Крцаниси на ss.ge ... 6. 146,000 $ m² - 1,446 $. Продается',
    query: '"улица Крцаниси" квартира продажа',
  },
  {
    domain: 'korter.ge',
    url: 'https://korter.ge/#result-2',
    title: 'Продается 6-комнатная квартира площадью 150 м² в Тбилиси',
    snippet: 'Продается 6-комнатная квартира площадью 150 м² в Тбилиси, ул. Крцаниси 25. Цена — $375,000',
    query: '"улица Крцаниси" квартира продажа',
  },
  {
    domain: 'myhome.ge',
    url: 'https://www.myhome.ge/ru/s/#result-3',
    title: 'Продается 4 комнатная квартира в крцаниси',
    snippet: 'Крцаниси улица 14 ; 108 м². Площадь ; 4 Комнаты',
    query: '"улица Крцаниси" квартира продажа',
  },
  {
    domain: 'facebook.com',
    url: 'https://www.facebook.com/#result-1',
    title: 'Villion Krtsanisi',
    snippet: 'ბინები კრწანისის ქუჩა 6 — ფოტოები',
    query: '"Villion" Krtsanisi Tbilisi',
  },
];

/* ------------------------------------------------------------------ *
 * The acceptance fixture itself                                       *
 * ------------------------------------------------------------------ */

test('the known public listing at Krtsanisi 6 is recovered by the pipeline', () => {
  /*
   * THE BAR. A 97.2 m², 3-room flat on floor 7/8 at Крцаниси улица 6 was
   * publicly indexed the whole time the report said SAME_STREET = 0.
   */
  const row = HARVEST.find((h) => h.domain === 'myhome.ge' && /97\.2/.test(h.snippet));
  const listing = fromSearchSnippet(row, STREET_HINTS);

  assert.ok(listing, 'the pipeline extracted nothing from a result that plainly states the facts');
  assert.equal(listing.area, 97.2, 'the area must be recovered');
  assert.equal(listing.rooms, 3);
  assert.equal(listing.confidence, 'INDEX', 'index evidence must be labelled as such');
  assert.equal(streetNumberFrom(row.snippet), '6', 'the street number must be recovered');

  // And it must resolve onto the subject's street — the classification that
  // was failing even where the evidence had been seen.
  assert.ok(listing.address, 'no address was isolated');
  assert.ok(sameStreet(listing.address, SUBJECT.address), `not matched to the street: ${listing.address}`);
  assert.ok(sameAddress(`Крцаниси улица 6`, SUBJECT.address), 'the exact address must resolve');
});

test('the same property on a second domain is recognised as one property', () => {
  // estatehub.ge — not in the seed registry — carries the same 97.2 m² flat at
  // number 6 in English. Two domains, one apartment.
  const ru = fromSearchSnippet(HARVEST.find((h) => h.domain === 'myhome.ge' && /97\.2/.test(h.snippet)), STREET_HINTS);
  const en = fromSearchSnippet(HARVEST.find((h) => h.domain === 'estatehub.ge'), STREET_HINTS);
  assert.ok(ru && en);
  assert.equal(en.area, 97.2);
  assert.ok(sameStreet(ru.address, en.address), 'the two spellings must resolve to one street');

  const { unique, duplicatesRemoved } = dedupeSyndicated([
    { ...ru, area: 97.2, rooms: 3 }, { ...en, area: 97.2, rooms: 3 },
  ]);
  assert.equal(unique.length, 1, 'one apartment must not be counted twice');
  assert.equal(duplicatesRemoved, 1);
});

test("the developer's own inventory is recognised as the same project", () => {
  // korter.ge states Villion, the address and a price for 82.2 m² — which is
  // exactly the floorSize minimum the building's ld+json publishes.
  const row = HARVEST.find((h) => h.domain === 'korter.ge' && /82\.2/.test(h.snippet));
  const listing = fromSearchSnippet(row, STREET_HINTS);
  assert.ok(listing);
  assert.equal(listing.area, 82.2);

  const m = matchesProject(
    { project: 'Villion', address: 'კრწანისის ქუჩა 6' },
    SUBJECT
  );
  assert.equal(m.same, true);
  assert.equal(m.reason, 'ADDRESS', 'the address is what corroborates the name');
});

test('other numbers on the same street are street evidence, never same-project', () => {
  /*
   * 14, 16 and 25 are real neighbours and must not be promoted. The distinction
   * is the whole point of separating TIER 1 from TIER 2.
   */
  for (const [domain, number] of [['myhome.ge', '14'], ['korter.ge', '25']]) {
    const row = HARVEST.find((h) => h.domain === domain && h.snippet.includes(` ${number}`));
    assert.ok(row, `${domain} ${number} missing from the harvest`);
    assert.equal(streetNumberFrom(row.snippet), number);
    assert.ok(sameStreet(row.snippet, SUBJECT.address), 'still the same street');
    assert.equal(
      sameAddress(row.snippet, SUBJECT.address), false,
      `number ${number} must not resolve to number 6`
    );
  }
});

/* ------------------------------------------------------------------ *
 * Discovery breadth                                                   *
 * ------------------------------------------------------------------ */

test('a domain outside the seed registry still enters the pipeline', () => {
  /*
   * estatehub.ge carried the acceptance fixture and was not in the seed list.
   * A registry that rejected unknown domains would have discarded the single
   * most relevant result of the run.
   */
  assert.equal(SEED_DOMAINS['estatehub.ge'], undefined, 'fixture assumption: not seeded');
  const cls = classifyDomain('estatehub.ge');
  assert.equal(cls, 'DISCOVERED_UNCLASSIFIED');
  assert.equal(worthExtracting(cls), true, 'an unknown domain must not be rejected on sight');
});

test('social results are discovery context, never property records', () => {
  const cls = classifyDomain('facebook.com');
  assert.equal(cls, 'SOCIAL');
  assert.equal(worthExtracting(cls), false);
});

test('seeded portals keep their category', () => {
  assert.equal(classifyDomain('myhome.ge'), 'PORTAL');
  assert.equal(classifyDomain('www.korter.ge'), 'PROJECT_INDEX');
  assert.equal(classifyDomain('villion.ge'), 'DEVELOPER');
  assert.equal(classifyDomain('realting.com'), 'INTERNATIONAL');
});

/* ------------------------------------------------------------------ *
 * What the buyer ends up with                                         *
 * ------------------------------------------------------------------ */

test('a local tier now exists and outranks the city', () => {
  /*
   * With local evidence recovered, the headline finally describes this street
   * instead of the city — the outcome the presentation rules were written for
   * and could not reach while discovery returned nothing.
   */
  const local = [
    { address: 'Крцаниси улица 6', pricePerSqm: 2056, area: 97.2 },
    { address: 'Krtsanisi Street 6', pricePerSqm: 1990, area: 100 },
    { address: 'კრწანისის ქუჩა 6', pricePerSqm: 2100, area: 56.8 },
    { address: 'ვაკე, თბილისი', pricePerSqm: 4300, area: 80 },
  ];
  const tierOf = (l) =>
    sameAddress(l.address, SUBJECT.address) ? 'TIER_1_SAME_PROJECT'
      : sameStreet(l.address, SUBJECT.address) ? 'TIER_2_SAME_STREET'
        : 'TIER_5_CITY';

  const stats = statsByTier(local, tierOf);
  const head = headlineTier(stats);
  assert.ok(head, 'a local tier with three observations must be allowed to headline');
  assert.equal(head.tier, 'TIER_1_SAME_PROJECT');
  assert.equal(head.sample, 3);
  assert.equal(head.median, 2056);
  // And the expensive city observation stays out of it.
  assert.ok(head.max < 4300);
});

test('no diagnostic from this file could ever reach a customer', () => {
  /*
   * Domains, queries, extraction outcomes and failure counts are how we debug
   * discovery. None of it is a fact about the property, and section 15 of the
   * mandate keeps it internal.
   */
  const listing = fromSearchSnippet(HARVEST[0], STREET_HINTS);
  assert.ok(listing);
  for (const field of Object.keys(listing)) {
    assert.ok(
      !/query|domainsQueried|failed|blocked|robots|crawler/i.test(field),
      `${field} is a diagnostic and must not be on a listing`
    );
  }
});

/* ------------------------------------------------------------------ *
 * END TO END, THROUGH THE ENGINE THAT PRODUCTION RUNS                 *
 * ------------------------------------------------------------------ */

/*
 * The bar the owner set: the known public evidence must be recovered THROUGH
 * THE DISCOVERY PIPELINE, not written down as an answer. So this drives
 * runDiscovery() — the same function the market lane calls — over the raw
 * harvested rows, and asserts on what comes out the far end.
 */
const SUBJECT_GEO = {
  names: SUBJECT.names,
  address: SUBJECT.address,
  developer: SUBJECT.developer,
  lat: SUBJECT.lat,
  lon: SUBJECT.lon,
  district: 'კრწანისი',
  city: 'თბილისი',
  streetHints: STREET_HINTS,
};

/** The formulations that were actually executed, in the order they were run. */
const PLAN = [...new Set(HARVEST.map((h) => h.query))].map((text, i) => ({
  text,
  language: /[Ѐ-ӿ]/.test(text) ? 'ru' : /[Ⴀ-ჿ]/.test(text) ? 'ka' : 'en',
  precision: i < 2 ? 'BUILDING' : 'STREET',
  key: `k${i}`,
}));

const runHarvest = () => runDiscovery({
  plan: PLAN,
  subject: SUBJECT_GEO,
  search: harvestProvider(HARVEST.map((h) => ({ ...h }))),
});

test('KNOWN_PUBLIC_LOCAL_EVIDENCE_DISCOVERED = YES, through the real engine', async () => {
  const report = await runHarvest();

  assert.equal(report.providerStatus, 'OK');
  assert.equal(
    report.knownPublicLocalEvidenceDiscovered, true,
    'the engine found no local evidence in results that plainly state a local address'
  );

  // The acceptance listing, as the engine classified it.
  const subjectFlat = report.listings.find((l) => l.area === 97.2);
  assert.ok(subjectFlat, 'the 97.2 m² flat at Krtsanisi 6 did not survive the pipeline');
  assert.ok(
    LOCAL_TIERS.includes(subjectFlat.tier),
    `classified ${subjectFlat.tier}, which is not local evidence`
  );
  // Identical address to the subject, so it is the building itself — which is
  // stronger than the SAME_STREET the bar required, and reached by resolution
  // rather than by a name.
  assert.equal(subjectFlat.tier, 'TIER_1_SAME_PROJECT');
  assert.ok(sameAddress(subjectFlat.address, SUBJECT.address));
  assert.equal(subjectFlat.rooms, 3);
  assert.equal(subjectFlat.confidence, 'INDEX');
});

test('the five tiers are populated separately and never merged', async () => {
  const report = await runHarvest();
  const local = LOCAL_TIERS.reduce((n, t) => n + report.tierCounts[t], 0);
  assert.ok(local >= 3, `only ${local} local results: ${JSON.stringify(report.tierCounts)}`);
  assert.ok(report.tierCounts.TIER_2_SAME_STREET > 0, 'the neighbours on this street are street evidence');

  // Every statistic carries its own tier and no statistic spans two.
  const tiers = report.tierStats.map((s) => s.tier);
  assert.equal(new Set(tiers).size, tiers.length);
  for (const s of report.tierStats) assert.ok(s.sample > 0);

  /*
   * A HEADLINE IS EARNED, AND THIS HARVEST DOES NOT EARN ONE.
   *
   * Most of these snippets state an address and an area without a rate, so no
   * local tier reaches three PRICED observations — and the honest result is
   * no headline at all. The rule being protected is the one the Villion report
   * broke: the city tier may never be promoted to fill that silence.
   */
  assert.equal(report.headline, null, 'three priced local observations are required, not three addresses');
  assert.ok(
    !report.headline || LOCAL_TIERS.includes(report.headline.tier),
    'a headline may only ever come from a local tier'
  );
});

test('every discovered URL is accounted for, including the ones that failed', async () => {
  const report = await runHarvest();
  const urls = report.ledger.filter((r) => r.url).length;
  assert.equal(urls, report.rawUrlsDiscovered);
  const tallied = Object.values(report.outcomes).reduce((a, b) => a + b, 0);
  assert.ok(tallied >= urls, 'an outcome is recorded for every row');

  // The social result is context, never a property record — and it is
  // recorded as such rather than silently dropped.
  const fb = report.ledger.find((r) => r.domain === 'facebook.com');
  assert.ok(fb);
  assert.equal(fb.outcome, 'SOURCE_NOT_SUPPORTED');
});

test('a domain nobody seeded still produced evidence', async () => {
  const report = await runHarvest();
  assert.ok(report.domainsNew.includes('estatehub.ge'), 'the unknown domain was not even recorded');
  assert.ok(
    report.domainsProducingEvidence.includes('estatehub.ge'),
    'the unknown domain carried the acceptance listing and must be credited with it'
  );
  const tally = report.perDomain.find((d) => d.domain === 'estatehub.ge');
  assert.ok(tally.extracted > 0);
});

test('a locked provider is reported as locked, never as an empty market', async () => {
  /*
   * The distinction the whole layer exists for. DataForSEO is behind a kill
   * switch; a run that could not ask must not be indistinguishable from a
   * street with nothing for sale on it.
   */
  const report = await runDiscovery({
    plan: PLAN, subject: SUBJECT_GEO, search: noSearchProvider,
  });
  assert.equal(report.providerStatus, 'PROVIDER_LOCKED');
  assert.equal(report.listings.length, 0);
  assert.equal(report.knownPublicLocalEvidenceDiscovered, false);
  assert.equal(report.tierCounts.TIER_5_CITY, 0, 'a blocked run invents no city-wide fallback either');
});

test('a SERP envelope is read for urls wherever the provider puts them', () => {
  const hits = normaliseSerp({
    tasks: [{ result: [{ items: [
      { type: 'organic', url: 'https://www.myhome.ge/ru/s/1', title: 'A', description: 'D' },
      { type: 'organic', url: 'https://korter.ge/x', title: 'B', snippet: 'E' },
      { type: 'organic', url: 'https://www.myhome.ge/ru/s/1', title: 'A', description: 'D' },
    ] }] }],
  });
  assert.equal(hits.length, 2, 'repeated urls are one result');
  assert.equal(hits[0].snippet, 'D');
  assert.equal(hits[1].snippet, 'E');
});

test('a category page proves the street has inventory and is not a listing', async () => {
  /*
   * „327 предложений на улице Крцаниси" is a real, useful discovery: it
   * places supply on the subject's street. It is also not a flat, and counting
   * it among comparables would pad a local sample with rows that can never be
   * priced — an inflated local number being exactly as misleading as the
   * city-wide one it replaced.
   */
  const report = await runDiscovery({
    plan: [{ text: 'index page', language: 'ru', precision: 'STREET', key: 'x' }],
    subject: SUBJECT_GEO,
    search: harvestProvider([{
      query: 'index page',
      url: 'https://tranio.ru/georgia/tbilisi/#result-1',
      title: 'Недвижимость на улице Крцаниси',
      snippet: '327 предложений на улице Крцаниси',
    }]),
  });

  assert.equal(report.tierCounts.TIER_2_SAME_STREET, 1, 'it is still local evidence');
  assert.equal(
    report.tierCountsMeasurable.TIER_2_SAME_STREET, 0,
    'and it must never be counted as a priceable comparable'
  );
  assert.equal(report.listings[0].measurable, false);
  assert.equal(report.tierStats.length, 0, 'nothing measurable means no statistic');
});

test('a page is only fetched where the source permits that kind of fetch', async () => {
  /*
   * myhome.ge answers 403 to every non-browser client; korter.ge is
   * server-rendered. A plain HTTP fetcher pointed at the first would earn a
   * 403 and record a portal with no inventory — which is how a blocked read
   * became "the market is thin" in the first place. So access is a property of
   * the source and the fetcher has to match it.
   */
  const tried = [];
  const plainHttp = {
    id: 'HTTP',
    async fetch(url) { tried.push(url); return { ok: false, status: 403, body: '' }; },
  };
  const browser = {
    id: 'BROWSER',
    canDriveBrowser: true,
    async fetch(url) { tried.push(url); return { ok: false, status: 403, body: '' }; },
  };

  const rows = HARVEST.map((h) => ({ ...h }));
  await runDiscovery({
    plan: PLAN, subject: SUBJECT_GEO, search: harvestProvider(rows), fetchPage: plainHttp,
  });
  assert.ok(
    !tried.some((u) => u.includes('myhome.ge')),
    'a non-browser fetcher must never be pointed at a browser-only source'
  );
  assert.ok(
    tried.some((u) => u.includes('estatehub.ge')),
    'an unregistered domain must still be tried — this is the one that carried the listing'
  );
  assert.ok(
    !tried.some((u) => u.includes('tranio')),
    'a source recorded as index-only is not fetched at all'
  );

  tried.length = 0;
  await runDiscovery({
    plan: PLAN, subject: SUBJECT_GEO, search: harvestProvider(rows), fetchPage: browser,
  });
  assert.ok(tried.some((u) => u.includes('myhome.ge')), 'a browser fetcher may read it');
});

test('a failed page read never erases what the index already stated', async () => {
  // The snippet is read first, always. A fetch that then fails must leave the
  // index evidence standing rather than turning a known flat into nothing.
  const report = await runDiscovery({
    plan: PLAN,
    subject: SUBJECT_GEO,
    search: harvestProvider(HARVEST.map((h) => ({ ...h }))),
    fetchPage: {
      id: 'BROKEN',
      canDriveBrowser: true,
      async fetch() { return { ok: false, status: 500, body: '' }; },
    },
  });
  const flat = report.listings.find((l) => l.area === 97.2);
  assert.ok(flat, 'the index evidence was lost when the page read failed');
  assert.equal(flat.confidence, 'INDEX');
});
