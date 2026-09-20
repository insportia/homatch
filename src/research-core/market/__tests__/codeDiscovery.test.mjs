import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  runCodeDiscovery, slugTokens, rankSubjectUrls,
  sitemapLocations, isSitemapIndex, rankChildSitemaps, linksFrom, canonicalOf,
  isPublicHttpUrl, couldBeAPropertySource,
} from '../codeDiscovery.ts';
import { buildCodeDiscoverySeeds, slugify, slugCandidates } from '../codeDiscoveryTargets.ts';
import { SEED_DOMAINS, RECORDED_NOT_PROPERTY_SOURCES } from '../discoverySources.ts';
import { LOCAL_TIERS } from '../geoTier.ts';

/*
 * DISCOVERY WITH NO SEARCH ENGINE.
 *
 * Every assertion here was written against something the live crawl actually
 * did on 2026-09-20 — right or wrong.
 */

const SUBJECT = {
  names: ['Villion'],
  address: 'კრწანისის ქუჩა 6',
  streetStem: 'კრწანისის',
  streetNumber: '6',
  district: 'კრწანისი',
  city: 'თბილისი',
  lat: 41.67653101,
  lon: 44.82462376,
  streetHints: ['Krtsanisi', 'Крцаниси', 'კრწანისი'],
};

/* ------------------------------------------------------------------ *
 * Turning a property into things a URL can be matched against         *
 * ------------------------------------------------------------------ */

test('the word for "street" is never a discovery token', () => {
  /*
   * The first live crawl carried `kucha` as a token, which matches every
   * street in Georgia. It pulled `tsitlanadze-kucha-7` out of korter's sitemap,
   * called it same-street evidence, and the subject's own building never made
   * the shortlist.
   */
  const tokens = slugTokens(SUBJECT);
  for (const bad of ['kucha', 'street', 'ulitsa', 'tbilisi']) {
    assert.ok(!tokens.includes(bad), `${bad} must not be a token`);
  }
  assert.ok(tokens.includes('krtsanisi'), 'the nominative stem must be there');
});

test('a slug is built from the nominative, because that is how sites write it', () => {
  // The address says „კრწანისის"; every korter.ge URL says `krtsanisi`.
  assert.equal(slugify('კრწანისის'), 'krtsanisi');
  assert.deepEqual(slugCandidates('კრწანისის'), ['krtsanisi', 'krtsanisis']);
});

test('the constructed building URL is the one the site actually publishes', () => {
  const urls = buildCodeDiscoverySeeds(SUBJECT, ['korter.ge']).map((t) => t.url);
  assert.ok(
    urls.includes('https://korter.ge/en/house-on-krtsanisi-6-tbilisi'),
    'this exact URL is the subject building and is in korter.ge own sitemap'
  );
  assert.ok(urls.some((u) => u.endsWith('/robots.txt')), 'robots is always asked first');
});

test('the house number decides which sitemap matches are opened first', () => {
  /*
   * building_landing.xml holds 55 URLs naming this street and the budget opens
   * a fraction of them. Taken in file order the subject was not among them:
   * discovered, shortlisted, and then never read.
   */
  const urls = [
    'https://korter.ge/krtsanisis-kucha-88-tbilisshi',
    'https://korter.ge/krtsanisi-twins-63-tbilisi',
    'https://korter.ge/house-on-krtsanisi-6-tbilisi',
    'https://korter.ge/krtsanisis-kucha-21-tbilisshi',
  ];
  const ranked = rankSubjectUrls(urls, slugTokens(SUBJECT), '6');
  assert.equal(ranked[0], 'https://korter.ge/house-on-krtsanisi-6-tbilisi');
  const twins = ranked.indexOf('https://korter.ge/krtsanisi-twins-63-tbilisi');
  assert.ok(twins !== 0, '63 must not be read as 6');
});

/* ------------------------------------------------------------------ *
 * Sitemaps and links                                                  *
 * ------------------------------------------------------------------ */

test('a sitemap index is told apart from a sitemap, and ranked', () => {
  const index = '<sitemapindex><sitemap><loc>https://x/building_landing.xml</loc></sitemap>'
    + '<sitemap><loc>https://x/blog.xml</loc></sitemap></sitemapindex>';
  assert.equal(isSitemapIndex(index), true);
  const locs = sitemapLocations(index);
  assert.equal(locs.length, 2);
  const ranked = rankChildSitemaps(locs);
  assert.equal(ranked[0], 'https://x/building_landing.xml', 'buildings before blogs');
  assert.ok(!ranked.includes('https://x/blog.xml'), 'a blog archive is not property inventory');
});

test('links are read and resolved against the page they came from', () => {
  const html = '<a href="/en/x">x</a><a href="https://other.ge/y#frag">y</a>'
    + '<link rel="canonical" href="/canonical-here">';
  const links = linksFrom(html, 'https://korter.ge/page');
  assert.ok(links.includes('https://korter.ge/en/x'));
  assert.ok(links.includes('https://other.ge/y'), 'a fragment is not part of a url');
  assert.equal(canonicalOf(html, 'https://korter.ge/page'), 'https://korter.ge/canonical-here');
});

test('the crawler will not open a connection to something that is not the public web', () => {
  // A crawler that follows links is exactly the thing that turns a stray URL
  // into a request against an internal address.
  for (const bad of [
    'http://localhost/x', 'http://127.0.0.1/x', 'http://169.254.169.254/latest/meta-data',
    'http://10.0.0.5/admin', 'file:///etc/passwd', 'http://box.local/x', 'not a url',
  ]) {
    assert.equal(isPublicHttpUrl(bad), false, bad);
  }
  assert.equal(isPublicHttpUrl('https://korter.ge/x'), true);
});

test('an app store is not a property source', () => {
  // The first live crawl followed a link out of korter.ge into play.google.com
  // and spent seven page fetches there.
  assert.equal(couldBeAPropertySource('play.google.com'), false);
  assert.equal(couldBeAPropertySource('apps.apple.com'), false);
  assert.equal(couldBeAPropertySource('estatemarket.ge'), true);
  assert.equal(couldBeAPropertySource('some-agency-nobody-knows.ge'), true);
});

/* ------------------------------------------------------------------ *
 * The registry                                                        *
 * ------------------------------------------------------------------ */

test('every source discovered in earlier work is still registered', () => {
  /*
   * A registry that loses a source loses the work that found it. These are the
   * domains recorded across the whole of the market-discovery effort.
   */
  for (const d of [
    'myhome.ge', 'home.ss.ge', 'ss.ge', 'korter.ge', 'xeli.ge', 'realting.com',
    'estatemarket.ge', 'myhomesale.ge', 'place.ge', 'realtor.ge', 'home24.ge',
    'makler.ge', 'expathome.ge', 'brokeri.ge', 'topbroker.ge', 'cgagency.ge',
    'origencollection.com', 'caucasusestate.ge', 'krtsanisi.com',
    'zarayaproperties.com', 'estatehub.ge', 'livo.ge', 'mymarket.ge',
    'tranio.com', 'tranio.ru', 'villion.ge',
  ]) {
    assert.ok(SEED_DOMAINS[d], `${d} was discovered earlier and must stay registered`);
  }
});

test('a host recorded by mistake is kept as a record, not as a target', () => {
  // adjaranet.com is a video site that reached the legacy portal regex.
  // Deleting it loses the knowledge; copying it sends a crawler at a film archive.
  assert.ok(RECORDED_NOT_PROPERTY_SOURCES['adjaranet.com']);
  assert.equal(SEED_DOMAINS['adjaranet.com'], undefined);
});

/* ------------------------------------------------------------------ *
 * A whole run, against a fake web                                     *
 * ------------------------------------------------------------------ */

function fakeWeb(pages) {
  const log = [];
  return {
    log,
    fetcher: {
      id: 'FAKE',
      async fetch(url) {
        log.push(url);
        const body = pages[url];
        return body === undefined
          ? { ok: false, status: 404, body: '' }
          : { ok: true, status: 200, body };
      },
    },
  };
}

const LD = (obj) => `<script type="application/ld+json">${JSON.stringify(obj)}</script>`;
const ALLOW_ALL = 'User-agent: *\nAllow: /';

test('a sitemap leads to the building, with no search engine involved', async () => {
  const pages = {
    'https://korter.ge/robots.txt': `${ALLOW_ALL}\nSitemap: https://korter.ge/sitemap.xml`,
    'https://korter.ge/sitemap.xml':
      '<sitemapindex><sitemap><loc>https://korter.ge/building_landing.xml</loc></sitemap></sitemapindex>',
    'https://korter.ge/building_landing.xml':
      '<urlset>'
      + '<url><loc>https://korter.ge/krtsanisis-kucha-88-tbilisshi</loc></url>'
      + '<url><loc>https://korter.ge/house-on-krtsanisi-6-tbilisi</loc></url>'
      + '</urlset>',
    'https://korter.ge/house-on-krtsanisi-6-tbilisi': LD({
      '@type': ['Apartment', 'Product'],
      name: 'Villion',
      brand: { name: 'Millennio Group' },
      numberOfRooms: { minValue: '3', maxValue: '4' },
      floorSize: { minValue: '82.2', maxValue: '168' },
      geo: { latitude: 41.67653101, longitude: 44.82462376 },
      address: { streetAddress: 'კრწანისის ქუჩა, 6' },
    }),
    'https://korter.ge/krtsanisis-kucha-88-tbilisshi': LD({
      '@type': 'Apartment',
      name: 'Something else',
      address: { streetAddress: 'კრწანისის ქუჩა, 88' },
    }),
  };
  const web = fakeWeb(pages);
  const report = await runCodeDiscovery({
    subject: SUBJECT,
    seeds: buildCodeDiscoverySeeds(SUBJECT, ['korter.ge']),
    fetcher: web.fetcher,
    seededDomains: new Set(Object.keys(SEED_DOMAINS)),
    budget: { maxPages: 20, maxPagesPerDomain: 10, maxDepth: 2, deadlineMs: 60_000, enoughLocal: 50 },
  });

  assert.equal(report.searchApiCalls, 0, 'this path buys no searches');
  assert.ok(report.sitemapsUsed >= 1);
  assert.equal(report.knownPublicLocalEvidenceDiscovered, true);

  const villion = report.listings.find((l) => l.project === 'Villion');
  assert.ok(villion, 'the subject building was not recovered');
  assert.equal(villion.developer, 'Millennio Group');
  assert.equal(villion.tier, 'TIER_1_SAME_PROJECT');

  // And the neighbour at 88 is street evidence, never the same project.
  const other = report.listings.find((l) => /88/.test(l.address ?? ''));
  assert.equal(other.tier, 'TIER_2_SAME_STREET');
});

test('robots.txt is obeyed, and a refusal is recorded as ours', async () => {
  const web = fakeWeb({
    'https://korter.ge/robots.txt': 'User-agent: *\nDisallow: /',
    'https://korter.ge/': '<html>anything</html>',
  });
  const report = await runCodeDiscovery({
    subject: SUBJECT,
    seeds: buildCodeDiscoverySeeds(SUBJECT, ['korter.ge']),
    fetcher: web.fetcher,
    budget: { maxPages: 10, maxPagesPerDomain: 5, maxDepth: 1, deadlineMs: 60_000, enoughLocal: 5 },
  });
  assert.ok(report.robotsDisallowed > 0, 'a Disallow: / must stop the crawl');
  assert.equal(report.listings.length, 0);
  assert.ok(report.ledger.some((r) => r.outcome === 'ROBOTS_DISALLOWED'));
  // And it is a statement about us, not about the street.
  assert.equal(report.knownPublicLocalEvidenceDiscovered, false);
});

test('the crawl ends on its own clock and keeps what it found', async () => {
  let clock = 0;
  const slow = {
    id: 'SLOW',
    async fetch(url) {
      clock += 20_000;
      if (url.endsWith('robots.txt')) return { ok: true, status: 200, body: ALLOW_ALL };
      return {
        ok: true,
        status: 200,
        body: LD({ '@type': 'Apartment', name: 'X', address: { streetAddress: 'Krtsanisi St, 6' } }),
      };
    },
  };
  const report = await runCodeDiscovery({
    subject: SUBJECT,
    seeds: buildCodeDiscoverySeeds(SUBJECT, ['korter.ge', 'place.ge', 'myhome.ge']),
    fetcher: slow,
    budget: { maxPages: 50, maxPagesPerDomain: 10, maxDepth: 1, deadlineMs: 60_000, enoughLocal: 99 },
    now: () => clock,
  });
  assert.equal(report.truncatedByDeadline, true, 'the run must say the clock ended it');
  assert.ok(report.pagesFetched <= 4, `fetched ${report.pagesFetched} past the deadline`);
});

test('a per-domain budget stops one generous sitemap consuming the run', async () => {
  const many = Array.from(
    { length: 50 },
    (_, i) => `<url><loc>https://korter.ge/krtsanisi-${i}</loc></url>`,
  ).join('');
  const pages = {
    'https://korter.ge/robots.txt': ALLOW_ALL,
    'https://korter.ge/sitemap.xml': `<urlset>${many}</urlset>`,
  };
  for (let i = 0; i < 50; i += 1) {
    pages[`https://korter.ge/krtsanisi-${i}`] = LD({
      '@type': 'Apartment', name: `u${i}`, address: { streetAddress: 'Krtsanisi St' },
    });
  }
  const web = fakeWeb(pages);
  const report = await runCodeDiscovery({
    subject: SUBJECT,
    seeds: buildCodeDiscoverySeeds(SUBJECT, ['korter.ge']),
    fetcher: web.fetcher,
    budget: { maxPages: 100, maxPagesPerDomain: 6, maxDepth: 2, deadlineMs: 60_000, enoughLocal: 99 },
  });
  assert.ok(report.pagesFetched <= 6, `fetched ${report.pagesFetched} from one domain`);
});

test('an unregistered domain is crawled and credited like any other', async () => {
  /*
   * The registry is a seed and never a gate. A link to a source nobody has
   * heard of gets the same treatment korter.ge gets.
   */
  const web = fakeWeb({
    'https://korter.ge/robots.txt': ALLOW_ALL,
    'https://korter.ge/': '<a href="https://brand-new-agency.ge/krtsanisi-6">see</a>',
    'https://brand-new-agency.ge/robots.txt': ALLOW_ALL,
    'https://brand-new-agency.ge/krtsanisi-6': LD({
      '@type': 'Apartment',
      name: 'Flat',
      floorSize: { value: '97.2' },
      numberOfRooms: { value: '3' },
      address: { streetAddress: 'Krtsanisi Street 6' },
    }),
  });
  const report = await runCodeDiscovery({
    subject: SUBJECT,
    seeds: buildCodeDiscoverySeeds(SUBJECT, ['korter.ge']),
    fetcher: web.fetcher,
    seededDomains: new Set(Object.keys(SEED_DOMAINS)),
    budget: { maxPages: 20, maxPagesPerDomain: 10, maxDepth: 2, deadlineMs: 60_000, enoughLocal: 50 },
  });
  assert.ok(report.newDomainsDiscovered.includes('brand-new-agency.ge'));
  assert.ok(report.newDomainsAccepted.includes('brand-new-agency.ge'));

  const flat = report.listings.find((l) => l.sourceDomain === 'brand-new-agency.ge');
  assert.ok(flat, 'an unregistered source produced no evidence');
  assert.equal(flat.area, 97.2);
  assert.ok(LOCAL_TIERS.includes(flat.tier));

  const learned = report.perDomain.find((d) => d.domain === 'brand-new-agency.ge');
  assert.equal(learned.seeded, false);
  assert.ok(learned.capabilities.includes('JSON_LD'), 'capabilities are observed, not declared');
});
