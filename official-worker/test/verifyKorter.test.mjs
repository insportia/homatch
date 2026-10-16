// verifyKorter.test.mjs — the isolated Verify Korter provider: the access
// classifier over fixture robots.txt / terms documents, the production probe
// with a fake fetch (only robots.txt and the terms page are requested), the
// licensed-feed normaliser (ASKING vs HISTORICAL never mixed) and dedupe
// against MyHome.ge / SS.ge. Nothing here touches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyKorterAccess, checkKorterAccess, robotsAllows, readTerms, htmlToText, korterFeedConfigured, KORTER_USER_AGENT,
} from '../.tstest-build/verify/korter/access.js';
import {
  normalizeKorterFeed, dedupeKorterAgainstMarketplace, sameFlat, addressKey, dedupeKey, fetchKorterFeed, KorterFeedNotConfigured,
} from '../.tstest-build/verify/korter/feed.js';
import { korterStatusCache } from '../.tstest-build/verify/korter/index.js';

const AT = '2026-10-11T12:00:00.000Z';
const ROBOTS_OPEN = 'User-agent: *\nDisallow: /api/\nDisallow: /*?sort=\nSitemap: https://korter.ge/sitemap.xml\n';
const ROBOTS_CLOSED = 'User-agent: *\nDisallow: /\n';
// Wording of korter.ge/terms-of-service §5.3 as published (public search, 2026-10-11).
const TERMS_KORTER = `<html><body><h1>Korter website terms of use</h1>
<p>This Site is operated by Flatfy OÜ.</p>
<p>5.3 You must not use or attempt to use any automated program (including, without limitation, any spider or other web crawler) to access our system or this Site, unless such program identifies itself in the User Agent field and fully complies with the Robots Exclusion Protocol ("Permitted Programs"). Any such use or attempted use of an automated program (other than a Permitted Program) shall be a misuse of our system and this Site. You must not use any scraping technology on the Site.</p>
</body></html>`;
const TERMS_NEUTRAL = '<html><body><p>Use of this site is subject to these terms. We may revise them.</p></body></html>';
const TERMS_API = '<html><body><p>Partners may request API access through our public API programme.</p></body></html>';

const doc = (url, status, body = '', error = null) => ({ url, status, body, error });
const R = 'https://korter.ge/robots.txt';
const T = 'https://korter.ge/terms-of-service';

test('robots: RFC 9309 longest match, our token group over "*", empty disallow allows', () => {
  assert.equal(robotsAllows(ROBOTS_OPEN, '/'), true);
  assert.equal(robotsAllows(ROBOTS_OPEN, '/api/listings'), false);
  assert.equal(robotsAllows(ROBOTS_CLOSED, '/'), false);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /\n\nUser-agent: homatch\nDisallow:\n', '/'), true);
  assert.equal(robotsAllows('User-agent: *\nDisallow: /en/\nAllow: /en/apartments\n', '/en/apartments-for-sale-tbilisi'), true);
});

test('terms: the published scraping clause is recognised and quoted', () => {
  const t = readTerms(htmlToText(TERMS_KORTER));
  assert.equal(t.scrapingProhibited, true);
  assert.equal(t.automatedAccessRestricted, true);
  assert.equal(t.documentedApi, false);
  assert.ok(t.excerpts.some((e) => e.includes('You must not use any scraping technology on the Site.')));
  assert.equal(readTerms(htmlToText(TERMS_NEUTRAL)).scrapingProhibited, false);
  assert.equal(readTerms(htmlToText(TERMS_API)).documentedApi, true);
});

test('classifier: every status, in precedence order', () => {
  const c = (robots, terms, feedConfigured = false) => classifyKorterAccess({ robots, terms, feedConfigured, fetchedAt: AT });
  assert.equal(c(doc(R, 200, ROBOTS_OPEN), doc(T, 200, TERMS_KORTER)).status, 'BLOCKED_BY_TERMS');
  assert.equal(c(doc(R, 200, ROBOTS_CLOSED), doc(T, 200, TERMS_NEUTRAL)).status, 'BLOCKED_BY_ROBOTS');
  assert.equal(c(doc(R, 200, ROBOTS_OPEN), doc(T, 200, TERMS_NEUTRAL)).status, 'NO_DOCUMENTED_API');
  assert.equal(c(doc(R, 404, 'not found'), doc(T, 200, TERMS_NEUTRAL)).status, 'NO_DOCUMENTED_API');
  assert.equal(c(doc(R, null, '', 'ENOTFOUND'), doc(T, 403, 'blocked')).status, 'UNREACHABLE');
  // A licensed feed is the only authorisation, whatever the public site says.
  const feed = c(doc(R, 200, ROBOTS_CLOSED), doc(T, 200, TERMS_KORTER), true);
  assert.equal(feed.status, 'AUTHORIZED_FEED');
  assert.equal(feed.extractionAllowed, true);
  const blocked = c(doc(R, 200, ROBOTS_OPEN), doc(T, 200, TERMS_KORTER));
  assert.equal(blocked.extractionAllowed, false);
  assert.deepEqual(blocked.evidence.urls, [R, T]);
  assert.equal(blocked.evidence.fetchedAt, AT);
  assert.ok(blocked.evidence.excerpts.some((e) => e.url === T && /scraping technology/.test(e.text)));
  assert.equal(blocked.evidence.terms.scrapingProhibited, true);
});

test('production probe: two plain GETs (robots + terms) with an identifying UA, nothing else', async () => {
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, ua: init.headers['User-Agent'], method: init.method });
    return url.endsWith('/robots.txt') ? { status: 200, text: async () => ROBOTS_OPEN } : { status: 200, text: async () => TERMS_KORTER };
  };
  const r = await checkKorterAccess({ fetchImpl, env: {}, now: () => new Date(AT) });
  assert.deepEqual(seen.map((s) => s.url).sort(), [R, T].sort());
  assert.ok(seen.every((s) => s.method === 'GET' && s.ua === KORTER_USER_AGENT && /HOMATCH/.test(s.ua)));
  assert.equal(r.status, 'BLOCKED_BY_TERMS');
  assert.equal(r.provider, 'KORTER');

  const down = await checkKorterAccess({ fetchImpl: async () => { throw new Error('getaddrinfo ENOTFOUND korter.ge'); }, env: {} });
  assert.equal(down.status, 'UNREACHABLE');
  assert.match(down.evidence.fetches[0].error, /ENOTFOUND/);
});

test('status cache: one probe per TTL, refresh forces a new one', async () => {
  let n = 0;
  const get = korterStatusCache(60_000, async () => { n++; return classifyKorterAccess({ robots: doc(R, 200, ROBOTS_OPEN), terms: doc(T, 200, TERMS_KORTER), feedConfigured: false, fetchedAt: AT }); });
  const a = await get();
  const b = await get();
  assert.equal(n, 1);
  assert.equal(a.cached, false);
  assert.equal(b.cached, true);
  await get(true);
  assert.equal(n, 2);
});

const FEED = [
  { id: 'k1', url: 'https://korter.ge/en/villion-tbilisi/flat-1', project: 'Villion', address: 'Krtsanisi St 6', district: 'Krtsanisi', city: 'Tbilisi', area: 94.1, floor: 7, rooms: 3, price: 330000, currency: 'usd', priceKind: 'asking', listedAt: '2026-09-01', condition: 'white frame', sellerPhone: '+995555123456', description: 'private' },
  { id: 'k2', url: 'https://korter.ge/en/villion-tbilisi/flat-2', project: 'Villion', address: 'Krtsanisi St 6', area: 101, floor: 9, price: 300000, currency: 'USD', priceKind: 'sold', updatedAt: '2025-11-02T00:00:00Z' },
  { id: 'k3', url: 'https://korter.ge/en/x/flat-3', address: 'Krtsanisi St 6', area: 90, price: 280000, currency: 'USD' }, // no price kind
  { id: 'k4', url: 'https://evil.example/flat-4', area: 90, price: 280000, currency: 'USD', priceKind: 'asking' },
  { id: 'k1', url: 'https://korter.ge/en/villion-tbilisi/flat-1', area: 94.1, price: 330000, currency: 'USD', priceKind: 'asking' }, // duplicate id
];

test('normaliser: provenance, stated timestamps, ASKING and HISTORICAL in separate lists, privacy', () => {
  const r = normalizeKorterFeed(FEED, { fetchedAt: AT, scope: 'DISTRICT' });
  assert.deepEqual(r.asking.map((c) => c.sourceListingId), ['k1']);
  assert.deepEqual(r.historical.map((c) => c.sourceListingId), ['k2']);
  assert.ok(r.asking.every((c) => c.priceKind === 'ASKING') && r.historical.every((c) => c.priceKind === 'HISTORICAL'));
  assert.deepEqual(r.rejected.map((x) => x.reason).sort(), ['NO_KORTER_URL', 'PRICE_KIND_UNSTATED']);
  const k1 = r.asking[0];
  assert.equal(k1.source, 'KORTER');
  assert.equal(k1.project, 'Villion');
  assert.equal(k1.currency, 'USD');
  assert.equal(k1.pricePerSqm, Math.round((330000 / 94.1) * 100) / 100);
  assert.equal(k1.publishedAt, '2026-09-01T00:00:00.000Z');
  assert.equal(k1.observedAt, AT);
  assert.deepEqual(k1.provenance, { provider: 'KORTER', channel: 'LICENSED_FEED', feedItemId: 'k1', fetchedAt: AT });
  assert.equal(k1.phoneHash, null);
  const json = JSON.stringify(r);
  assert.ok(!json.includes('555123456') && !json.includes('private'));
  assert.equal(r.historical[0].updatedAt, '2025-11-02T00:00:00.000Z');
  assert.equal(r.historical[0].publishedAt, null, 'a missing date is never invented');
});

test('dedupe vs MyHome.ge / SS.ge: address + area + floor + price window', () => {
  assert.equal(addressKey('კრწანისის ქ. 6, თბილისი'), addressKey('კრწანისის ქუჩა 6'));
  assert.equal(dedupeKey({ address: 'Krtsanisi St 6, Tbilisi', areaSqm: 94.1, floor: 7 }), 'krtsanisi 6|94|7');
  const base = { address: 'Krtsanisi St. 6', areaSqm: 94.1, floor: 7, price: 330000, currency: 'USD' };
  assert.equal(sameFlat(base, { ...base, address: 'Krtsanisi street 6, Tbilisi', areaSqm: 94.5, price: 340000 }), true);
  assert.equal(sameFlat(base, { ...base, floor: 8 }), false, 'same layout another floor is another flat');
  assert.equal(sameFlat(base, { ...base, price: 420000 }), false, 'outside the price window');
  assert.equal(sameFlat(base, { ...base, areaSqm: 120 }), false);
  assert.equal(sameFlat(base, { ...base, currency: 'GEL' }), false);

  const { asking, historical } = normalizeKorterFeed(FEED, { fetchedAt: AT });
  const ssge = [{ source: 'SSGE', sourceListingId: 's9', address: 'Krtsanisi street 6', areaSqm: 94, floor: 7, price: 335000, currency: 'USD' }];
  const d = dedupeKorterAgainstMarketplace([...asking, ...historical], ssge);
  assert.deepEqual(d.duplicates, [{ korterId: 'k1', matched: 'SSGE:s9' }]);
  assert.deepEqual(d.kept.map((k) => k.sourceListingId), ['k2'], 'a HISTORICAL row is never merged into a live ask');
});

test('licensed feed: refused without KORTER_FEED_URL + KORTER_FEED_KEY; used with them', async () => {
  assert.equal(korterFeedConfigured({}), false);
  assert.equal(korterFeedConfigured({ KORTER_FEED_URL: 'https://feed.example/v1', KORTER_FEED_KEY: '' }), false);
  let called = false;
  await assert.rejects(fetchKorterFeed({ city: 'Tbilisi' }, { env: {}, fetchImpl: async () => { called = true; } }), KorterFeedNotConfigured);
  assert.equal(called, false, 'no network call without a licensed feed');

  const env = { KORTER_FEED_URL: 'https://feed.example/v1/listings', KORTER_FEED_KEY: 'k' };
  let seen = null;
  const r = await fetchKorterFeed({ city: 'Tbilisi', district: 'Krtsanisi' }, {
    env, now: () => new Date(AT),
    fetchImpl: async (url, init) => { seen = { url, auth: init.headers.Authorization }; return { status: 200, json: async () => ({ items: FEED }) }; },
  });
  assert.match(seen.url, /^https:\/\/feed\.example\/v1\/listings\?city=Tbilisi&district=Krtsanisi/);
  assert.equal(seen.auth, 'Bearer k');
  assert.equal(r.asking.length, 1);
  assert.equal(r.asking[0].scope, 'DISTRICT');
});
