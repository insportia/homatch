import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  addressKey, sameStreet, sameAddress, romanise, distanceMetres, matchesProject,
  SAME_BUILDING_M, MICROLOCATION_M,
} from '../geoResolve.ts';
import { fromLdJson, fromPageText, sellerTypeFrom } from '../listingExtract.ts';
import { sourceForUrl, fetchableSources, MARKET_SOURCES } from '../discoverySources.ts';

/*
 * RESOLUTION, AGAINST THE PAGES THAT ACTUALLY EXIST.
 *
 * Every fixture below was read off a live page on 2026-09-20 while working out
 * why the Villion run reported SAME_PROJECT = 0 and SAME_STREET = 0 for a
 * building whose own page is the first search result.
 */

/* ------------------------------------------------------------------ *
 * Addresses across three scripts                                      *
 * ------------------------------------------------------------------ */

const KRTSANISI_6 = [
  'კრწანისის ქუჩა 6',
  'კრწანისის ქ. 6',
  'კრწანისის ქუჩა, 6',        // korter.ge writes it this way
  'Krtsanisi Street 6',
  'Krtsanisi St 6',
  'Крцаниси 6',
  'ул. Крцаниси 6',
];

test('every written form of the subject address resolves to one identity', () => {
  for (const a of KRTSANISI_6) {
    for (const b of KRTSANISI_6) {
      assert.ok(sameAddress(a, b), `${a}  !=  ${b}`);
    }
  }
});

test('the street survives without a number, and the number is kept apart', () => {
  assert.ok(sameStreet('კრწანისის ქუჩა', 'Krtsanisi Street 14'));
  // Same street, different building — that is TIER 2, never TIER 1.
  assert.equal(sameAddress('კრწანისის ქუჩა 6', 'Krtsanisi Street 14'), false);
  assert.equal(addressKey('Krtsanisi Street 14').number, '14');
});

test('a different street is never the same street', () => {
  assert.equal(sameStreet('კრწანისის ქუჩა 6', 'ვაკის ქუჩა 6'), false);
  assert.equal(sameStreet('Krtsanisi Street 6', 'Chavchavadze Avenue 6'), false);
  assert.equal(sameStreet('', 'Krtsanisi Street 6'), false, 'nothing matches nothing');
});

test('romanisation collapses the three scripts the market is written in', () => {
  assert.equal(romanise('კრწანისი').startsWith('k'), true);
  assert.equal(romanise('Крцаниси').includes('krtsanisi'), true);
  assert.equal(romanise('KRTSANISI'), 'krtsanisi');
});

/* ------------------------------------------------------------------ *
 * Coordinates                                                         *
 * ------------------------------------------------------------------ */

// korter.ge publishes these for Villion.
const VILLION_GEO = { lat: 41.67653101, lon: 44.82462376 };

test('two points in the same building measure as the same building', () => {
  const nudged = { lat: 41.67657, lon: 44.82466 };
  const d = distanceMetres(VILLION_GEO, nudged);
  assert.ok(d !== null && d < SAME_BUILDING_M, `measured ${d}m`);
});

test('a flat down the road is microlocation, not the same building', () => {
  const nearby = { lat: 41.6790, lon: 44.8250 };
  const d = distanceMetres(VILLION_GEO, nearby);
  assert.ok(d !== null && d > SAME_BUILDING_M && d < MICROLOCATION_M, `measured ${d}m`);
});

test('a flat across the city is neither', () => {
  const vake = { lat: 41.7090, lon: 44.7600 };
  assert.ok(distanceMetres(VILLION_GEO, vake) > MICROLOCATION_M);
});

test('a missing coordinate measures nothing rather than zero', () => {
  // Zero would read as "same building", which is the dangerous default.
  assert.equal(distanceMetres(VILLION_GEO, { lat: null, lon: null }), null);
  assert.equal(distanceMetres({}, {}), null);
});

/* ------------------------------------------------------------------ *
 * Project identity                                                    *
 * ------------------------------------------------------------------ */

const VILLION = {
  names: ['Villion', 'ვილიონ', 'VILLION Krtsanisi Homes'],
  address: 'კრწანისის ქუჩა 6',
  developer: 'შპს მილენიო გრუპი',
  ...VILLION_GEO,
};

test('coordinates alone settle project identity', () => {
  const m = matchesProject({ project: null, lat: 41.67655, lon: 44.82464 }, VILLION);
  assert.equal(m.same, true);
  assert.equal(m.reason, 'COORDINATES');
});

test('a name plus the address is the same project', () => {
  const m = matchesProject({ project: 'Villion', address: 'Krtsanisi Street 6' }, VILLION);
  assert.equal(m.same, true);
  assert.equal(m.reason, 'ADDRESS');
});

test('the developer corroborates across languages and legal forms', () => {
  // korter.ge writes the brand "Millennio Group"; the register says
  // „შპს მილენიო გრუპი". Romanised, one contains the other.
  const m = matchesProject({ project: 'Villion', developer: 'Millennio Group' }, VILLION);
  assert.equal(m.same, true);
  assert.equal(m.reason, 'DEVELOPER');
});

test('A NAME ALONE IS NEVER ENOUGH', () => {
  /*
   * The assertion that stops "Villa Residence" becoming "Villion". Names
   * repeat across cities and developers reuse them, so an uncorroborated name
   * is reported as NAME_ONLY and classified no better than nearby supply.
   */
  const m = matchesProject({ project: 'Villion' }, VILLION);
  assert.equal(m.same, false);
  assert.equal(m.reason, 'NAME_ONLY');

  const other = matchesProject(
    { project: 'Villa Residence', address: 'ვაკის ქუჩა 12', developer: 'Other LLC' },
    VILLION
  );
  assert.equal(other.same, false);
});

test('a different project at a different address is rejected outright', () => {
  const m = matchesProject(
    { project: 'Axis Tower', address: 'Chavchavadze Avenue 1', lat: 41.709, lon: 44.76 },
    VILLION
  );
  assert.equal(m.same, false);
  assert.equal(m.reason, 'NO_MATCH');
});

/* ------------------------------------------------------------------ *
 * Extraction                                                          *
 * ------------------------------------------------------------------ */

/** The real ld+json korter.ge serves for the Villion building page. */
const KORTER_LD = [{
  '@context': 'https://schema.org/',
  '@type': ['Apartment', 'Product'],
  name: 'Villion',
  url: 'https://korter.ge/house-on-krtsanisi-6-tbilisi',
  numberOfRooms: { '@type': 'QuantitativeValue', minValue: '3', maxValue: '4' },
  brand: { '@type': 'Brand', name: 'Millennio Group' },
  floorSize: { '@type': 'QuantitativeValue', minValue: '82.2', maxValue: '168', unitCode: 'MTK' },
  yearBuilt: 2025,
  geo: { '@type': 'GeoCoordinates', latitude: 41.67653101, longitude: 44.82462376 },
  address: { '@type': 'PostalAddress', addressCountry: 'GE', addressLocality: 'თბილისი', streetAddress: 'კრწანისის ქუჩა, 6' },
}];

test('the real korter building page yields project, developer and coordinates', () => {
  const l = fromLdJson(KORTER_LD, { url: 'https://korter.ge/house-on-krtsanisi-6-tbilisi', sourceDomain: 'korter.ge' });
  assert.ok(l);
  assert.equal(l.project, 'Villion');
  assert.equal(l.developer, 'Millennio Group');
  assert.equal(l.lat, 41.67653101);
  assert.equal(l.areaMin, 82.2);
  assert.equal(l.areaMax, 168);
  assert.equal(l.rooms, 3);
  assert.equal(l.isProjectPage, true, 'a size RANGE describes a development, not one flat');
  // And it resolves to the subject.
  assert.equal(matchesProject(l, VILLION).same, true);
});

test('a page with no place in it produces nothing rather than a guess', () => {
  const junk = [
    { '@type': 'Organization', name: 'Korter' },
    { '@type': 'BreadcrumbList', itemListElement: [] },
    { '@type': 'FAQPage' },
  ];
  assert.equal(fromLdJson(junk, { url: 'https://x/', sourceDomain: 'x' }), null);
  assert.equal(fromLdJson([], { url: 'https://x/', sourceDomain: 'x' }), null);
});

test('the real myhome listing is read from rendered text', () => {
  // What the live page shows: an area, a per-m² rate and a street.
  const body = 'For sale\n90\nm²\n$\n2,056\nper m²\nKrtsanisi St, Tbilisi\n3 rooms';
  const l = fromPageText(body, {
    url: 'https://www.myhome.ge/en/real-estate/3-room-apartment-for-sale-in-krtsanisi-20592132/',
    sourceDomain: 'myhome.ge',
    streetHints: ['Krtsanisi', 'კრწანისი'],
  });
  assert.ok(l);
  assert.equal(l.area, 90);
  assert.equal(l.pricePerSqm, 2056);
  assert.ok(l.address && /Krtsanisi/i.test(l.address), l.address);
  assert.equal(l.rooms, 3);
  // Which places it on the subject's street.
  assert.ok(sameStreet(l.address, 'კრწანისის ქუჩა 6'));
});

test('a listing missing optional fields is still kept', () => {
  /*
   * A 90 m² flat on the subject's street with no floor and no condition is the
   * most relevant observation the report can carry. Requiring a complete
   * record is how a local result loses to a complete city-wide one.
   */
  const l = fromPageText('90 m²  $2,056  Krtsanisi St', {
    url: 'https://x/', sourceDomain: 'x', streetHints: ['Krtsanisi'],
  });
  assert.ok(l);
  assert.equal(l.floor, undefined);
  assert.equal(l.condition, undefined);
  assert.ok(l.pricePerSqm);
});

test('a page with no numbers and no address yields nothing', () => {
  assert.equal(fromPageText('About us. Contact. Careers.', { url: 'https://x/', sourceDomain: 'x' }), null);
  assert.equal(fromPageText('', { url: 'https://x/', sourceDomain: 'x' }), null);
});

test('seller type is read when stated and UNKNOWN when not', () => {
  assert.equal(sellerTypeFrom('იყიდება დეველოპერისგან'), 'DEVELOPER');
  assert.equal(sellerTypeFrom('Listed by agency'), 'BROKER');
  assert.equal(sellerTypeFrom('собственник'), 'OWNER');
  assert.equal(sellerTypeFrom('3 room apartment, 90 m²'), 'UNKNOWN');
});

/* ------------------------------------------------------------------ *
 * The registry                                                        *
 * ------------------------------------------------------------------ */

test('a discovered URL is matched to the source that knows how to read it', () => {
  assert.equal(sourceForUrl('https://korter.ge/house-on-krtsanisi-6-tbilisi')?.extractor, 'LDJSON');
  assert.equal(sourceForUrl('https://www.myhome.ge/en/real-estate/x/')?.domain, 'myhome.ge');
  assert.equal(sourceForUrl('https://home.ss.ge/ka/udzravi-qoneba/30233493')?.domain, 'home.ss.ge');
  assert.equal(sourceForUrl('https://example.com/x'), null);
  assert.equal(sourceForUrl('not a url'), null);
});

test('browser-only sources are excluded when no browser is available', () => {
  // myhome.ge answers 403 to every non-browser agent. Pretending otherwise
  // would produce a run that reports failures it caused itself.
  const withBrowser = fetchableSources(true).map((s) => s.domain);
  const without = fetchableSources(false).map((s) => s.domain);
  assert.ok(withBrowser.includes('myhome.ge'));
  assert.ok(!without.includes('myhome.ge'));
  assert.ok(without.includes('realting.com'), 'server-rendered sources stay available');
});

test('every registered source records how and when it was verified', () => {
  for (const s of MARKET_SOURCES) {
    assert.ok(s.note.length > 40, `${s.domain} has no evidence behind it`);
    assert.match(s.verifiedOn, /^\d{4}-\d{2}-\d{2}$/, `${s.domain} has no verification date`);
  }
});
