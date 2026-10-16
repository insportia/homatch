// Source-verified neighbourhood (OpenStreetMap) for the Verify report.
//
// The research layer used to attach "ფეხით დაახლოებით 3 წუთია" to every
// place it named, and nothing had measured those minutes (job 8ba97da9,
// Villion, Krtsanisi St 6). The replacement measures straight-line metres
// from the parcel centre against ONE Overpass query, takes route numbers only
// from OSM route relations, and says "not visible in the open data" rather
// than "there is none". The Overpass response here is a hand-built FIXTURE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildOverpassQuery,
  buildStoredNeighborhood,
  centerFromBrowserOfficial,
  centerFromMsMapUrl,
  geocodeQuery,
  haversineM,
  neighborhoodView,
  overpassFailed,
  parentParcel,
  parseNominatim,
  parseOverpass,
  reusableNeighborhood,
  MS_MAP_DEFAULT_CENTER,
  OSM_COPYRIGHT_URL,
} from '../neighborhood.ts';
import { resolveNeighborhood, NEIGHBORHOOD_USER_AGENT } from '../neighborhoodFetch.ts';
import { nearbyPlaces, withNeighborhood, buildLocationIntelligence, isUnverifiedReach } from '../locationIntelligence.ts';
import { OVERPASS_KRTSANISI_FIXTURE, FIXTURE_CENTER } from '../../__tests__/fixtures/overpassKrtsanisiFixture.mjs';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

const PARCEL = '01.18.06.019.055';
const MOVED_URL = 'https://ms.gov.ge/msmap/#C=44.8246494-41.6765159@Z=18';
const START_URL = `https://ms.gov.ge/msmap/#C=${MS_MAP_DEFAULT_CENTER}@Z=19`;

const parsed = () => parseOverpass(OVERPASS_KRTSANISI_FIXTURE, FIXTURE_CENTER);
const stored = () => buildStoredNeighborhood({
  status: 'OK',
  center: { ...FIXTURE_CENTER, basis: 'MS_MAP_PARCEL', parcel: PARCEL },
  fetchedAt: '2026-10-11T08:00:00.000Z',
  parsed: parsed(),
});

/* ── where the subject is ─────────────────────────────────────────────── */

test('the parcel centre comes from the map the worker moved to, never its start view', () => {
  assert.equal(parentParcel('01.18.06.019.055.03.01.601'), PARCEL);
  assert.equal(centerFromMsMapUrl(START_URL), null, 'the worker\'s default start view was taken as the parcel');
  const p = centerFromMsMapUrl(MOVED_URL);
  assert.ok(Math.abs(p.lat - 41.6765159) < 1e-9 && Math.abs(p.lng - 44.8246494) < 1e-9, 'lng-lat order was swapped');

  const bo = { results: [
    { status: 'SEARCH_CONFIRMED', queryEntered: '01.18.06.019.055.03.01.603', finalUrl: MOVED_URL, startUrl: START_URL },
  ] };
  assert.ok(centerFromBrowserOfficial(bo, PARCEL), 'a confirmed search of the same parcel did not yield its centre');
  assert.equal(centerFromBrowserOfficial(bo, '01.18.06.019.056'), null, 'another parcel\'s map centre was used');
  const unconfirmed = { results: [{ ...bo.results[0], status: 'WRONG_SEARCH_CONTEXT' }] };
  assert.equal(centerFromBrowserOfficial(unconfirmed, PARCEL), null, 'an unconfirmed search placed the property');
  const onlyStart = { results: [{ status: 'SEARCH_CONFIRMED', queryEntered: PARCEL, finalUrl: START_URL, frameUrls: [START_URL] }] };
  assert.equal(centerFromBrowserOfficial(onlyStart, PARCEL), null);
});

test('the address geocode is a labelled fallback at house or street precision only', () => {
  // v6: street first, the way a geocoder reads it (registerOrder).
  assert.equal(geocodeQuery('თბილისი, კრწანისის ქ. 6'), 'კრწანისის ქუჩა 6, თბილისი');
  assert.equal(geocodeQuery('Krtsanisi'), null, 'a district name alone was geocoded');
  assert.equal(parseNominatim([{ lat: '41.6766', lon: '44.8247', addresstype: 'building' }]).precision, 'HOUSE');
  assert.equal(parseNominatim([{ lat: '41.6766', lon: '44.8247', addresstype: 'road', category: 'highway' }]).precision, 'STREET');
  assert.equal(parseNominatim([{ lat: '41.6766', lon: '44.8247', addresstype: 'suburb' }]), null, 'a suburb centroid was accepted as the property');
  assert.equal(parseNominatim([{ lat: '51.5', lon: '-0.1', addresstype: 'building' }]), null, 'a point outside Georgia was accepted');
});

/* ── the query ────────────────────────────────────────────────────────── */

test('one bounded Overpass query covers places, stops and the routes serving them', () => {
  const q = buildOverpassQuery(FIXTURE_CENTER);
  assert.match(q, /^\[out:json\]\[timeout:25\];/);
  assert.match(q, /around:1000,41\.6765159,44\.8246494/);
  assert.match(q, /around:600,/);
  for (const k of ['school', 'kindergarten', 'pharmacy', 'hospital', 'supermarket', 'convenience', 'park', 'playground', 'fitness_centre', 'cafe', 'hairdresser', 'highway=bus_stop', 'public_transport']) {
    assert.ok(q.includes(k), `the query never asks for ${k}`);
  }
  assert.match(q, /rel\(bn\.stops\)/);
  assert.match(q, /route~"\^\(bus\|minibus\|trolleybus/);
  assert.match(q, /out center tags;/);
  assert.equal((q.match(/\[out:json\]/g) ?? []).length, 1, 'more than one query');
});

/* ── parsing ──────────────────────────────────────────────────────────── */

test('places are categorised, measured in straight-line metres and named in Georgian', () => {
  const p = parsed();
  assert.equal(p.osmBase, '2026-10-10T20:58:12Z');
  const grocery = p.places.filter((x) => x.category === 'GROCERY');
  assert.deepEqual(grocery.map((x) => [x.name, x.distanceM]), [['კარფური', 150], ['ნიკორა', 250], ['პურის სახლი', 370]]);
  assert.equal(grocery.filter((x) => x.key.includes('q217599')).length, 1, 'a chain appeared twice in one category');
  assert.equal(p.counts.GROCERY.r1000, 4, 'the count must still include the deduplicated branch');
  assert.equal(p.counts.GROCERY.r400, 3);
  assert.ok(!p.places.some((x) => x.name === 'შორეული სკოლა'), 'a place outside the radius was kept');
  assert.ok(!p.places.some((x) => x.name === 'Private garden'), 'a private garden was offered as green space');
  assert.equal(p.places.find((x) => x.category === 'SCHOOL').distanceM, 320);
  for (const x of p.places) assert.equal(x.distanceM % 10, 0, 'a distance carries false precision');
  // the straight-line measure itself
  assert.ok(Math.abs(haversineM(FIXTURE_CENTER, { lat: FIXTURE_CENTER.lat + 1 / 111.195, lng: FIXTURE_CENTER.lng }) - 1000) < 2);
});

test('stops are grouped, and route numbers come only from route relations', () => {
  const p = parsed();
  assert.deepEqual(p.stops.map((s) => [s.name, s.distanceM]), [['კრწანისის ქუჩა', 90], ['ორთაჭალის ხიდი', 430], [null, 560]]);
  assert.deepEqual(p.stops[0].routes, ['bus:330'], 'a stop position and its platform were not treated as one stop');
  assert.deepEqual(p.stops[1].routes, ['bus:371', 'minibus:459'], 'share_taxi was not read as a minibus');
  assert.deepEqual(p.routes.map((r) => `${r.mode}:${r.ref}@${r.nearestStopM}`), ['bus:330@90', 'bus:371@430', 'minibus:459@430']);
  assert.equal(p.routesWithoutRef, 1, 'an unnumbered route was given a number or forgotten');
});

test('a failed Overpass answer is recognised as a failure', () => {
  assert.ok(overpassFailed(null));
  assert.ok(overpassFailed({ remark: 'runtime error: Query timed out in "query" at line 3', elements: [] }));
  assert.ok(!overpassFailed(OVERPASS_KRTSANISI_FIXTURE));
});

/* ── what it means ────────────────────────────────────────────────────── */

test('pros and cons are derived from the measured data, in keys and facts', () => {
  const v = neighborhoodView(stored());
  const keys = v.pros.map((p) => p.key);
  assert.deepEqual(keys, [
    'verify_nb_pro_transit', 'verify_nb_pro_daily', 'verify_nb_pro_school', 'verify_nb_pro_kindergarten',
    'verify_nb_pro_health', 'verify_nb_pro_parks', 'verify_nb_pro_sport', 'verify_nb_pro_food',
  ]);
  const by = Object.fromEntries(v.pros.map((p) => [p.key, p.vars]));
  assert.deepEqual(by.verify_nb_pro_transit, { distance: '90', routes: '330' }, 'a route was listed whose stop is not near');
  assert.deepEqual(by.verify_nb_pro_daily, { count: '5' });
  assert.deepEqual(by.verify_nb_pro_school, { name: 'თბილისის №144 საჯარო სკოლა', distance: '320' });
  assert.deepEqual(by.verify_nb_pro_parks, { count: '2' });
  assert.deepEqual(v.cons, [], 'a con was raised that the data does not support');
  assert.deepEqual(v.routesByMode, [{ mode: 'bus', refs: ['330', '371'] }, { mode: 'minibus', refs: ['459'] }]);
  assert.equal(v.categories[0].category, 'GROCERY');
  assert.ok(v.categories.every((c) => c.top.length <= 3));
});

test('thin data produces honest cons, phrased as absences in the open data', () => {
  const thin = buildStoredNeighborhood({
    status: 'OK',
    center: { ...FIXTURE_CENTER, basis: 'GEOCODED_ADDRESS', precision: 'HOUSE' },
    fetchedAt: '2026-10-11T08:00:00.000Z',
    parsed: parseOverpass({ osm3s: { timestamp_osm_base: '2026-10-10T20:58:12Z' }, elements: [] }, FIXTURE_CENTER),
  });
  const v = neighborhoodView(thin);
  assert.deepEqual(v.pros, []);
  assert.deepEqual(v.cons.map((c) => c.key), [
    'verify_nb_con_transit', 'verify_nb_con_daily', 'verify_nb_con_pharmacy', 'verify_nb_con_school', 'verify_nb_con_kindergarten', 'verify_nb_con_parks',
  ]);
  assert.equal(v.routesAvailable, false);
});

test('an unavailable lookup yields no places, no pros and no cons', () => {
  const v = neighborhoodView(buildStoredNeighborhood({ status: 'UNAVAILABLE', center: null, fetchedAt: '2026-10-11T08:00:00.000Z' }));
  assert.equal(v.status, 'UNAVAILABLE');
  assert.deepEqual([v.categories, v.stops, v.pros, v.cons], [[], [], [], []]);
});

/* ── the network step, with a fake fetch ──────────────────────────────── */

function fakeFetch(handlers) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    for (const [match, respond] of handlers) {
      if (url.includes(match)) {
        const body = respond(url, init);
        if (body instanceof Error) throw body;
        return { ok: true, status: 200, json: async () => body };
      }
    }
    return { ok: false, status: 404, json: async () => null };
  };
  f.calls = calls;
  return f;
}

const job601 = { exactUnit: { code: '01.18.06.019.055.03.01.601' }, browserOfficial: { results: [
  { status: 'SEARCH_CONFIRMED', queryEntered: '01.18.06.019.055.03.01.601', finalUrl: 'http://abstract.reestri.gov.ge/abstract/cad_amo.php?cad_code=01.18.06.019.055' },
] } };
const now = () => new Date('2026-10-11T09:00:00.000Z');

test('the .601 job is placed from an earlier check of the same parcel, then one Overpass call', async () => {
  const f = fakeFetch([['interpreter', () => OVERPASS_KRTSANISI_FIXTURE]]);
  const asked = [];
  const n = await resolveNeighborhood({
    resultJson: job601, query: '01.18.06.019.055.03.01.601', address: 'თბილისი, კრწანისის ქ. 6', previous: null,
    earlierBrowserOfficial: async (parcel) => { asked.push(parcel); return [{ results: [{ status: 'SEARCH_CONFIRMED', queryEntered: '01.18.06.019.055.03.01.603', finalUrl: MOVED_URL }] }]; },
    fetchImpl: f, now,
  });
  assert.deepEqual(asked, [PARCEL]);
  assert.equal(n.status, 'OK');
  assert.equal(n.center.basis, 'MS_MAP_PARCEL_EARLIER');
  assert.equal(n.osmBase, '2026-10-10T20:58:12Z');
  assert.equal(n.attribution, '© OpenStreetMap contributors');
  assert.equal(f.calls.length, 1, 'more than one network call, or a geocode despite a parcel centre');
  assert.equal(f.calls[0].init.method, 'POST');
  assert.equal(f.calls[0].init.headers['User-Agent'], NEIGHBORHOOD_USER_AGENT);
});

test('a stored lookup is reused on rebuild without any network call', async () => {
  const f = fakeFetch([]);
  const prev = stored();
  const n = await resolveNeighborhood({ resultJson: job601, query: null, address: null, previous: prev, fetchImpl: f, now });
  assert.equal(f.calls.length, 0);
  assert.equal(n, prev);
  assert.equal(reusableNeighborhood(prev, Date.parse('2026-12-31T00:00:00Z')), null, 'a stale lookup was reused forever');
});

test('Overpass failing on both endpoints stores UNAVAILABLE, never a guess', async () => {
  const f = fakeFetch([['interpreter', () => new Error('network down')]]);
  const n = await resolveNeighborhood({
    resultJson: { exactUnit: { code: '01.18.06.019.055.03.01.603' }, browserOfficial: { results: [{ status: 'SEARCH_CONFIRMED', queryEntered: '01.18.06.019.055.03.01.603', finalUrl: MOVED_URL }] } },
    query: null, address: null, previous: null, fetchImpl: f, now,
  });
  assert.equal(n.status, 'UNAVAILABLE');
  assert.equal(n.center.basis, 'MS_MAP_PARCEL');
  assert.deepEqual([n.places, n.stops, n.routes], [[], [], []]);
  assert.equal(f.calls.length, 2, 'the mirror was not tried exactly once');
});

test('with no parcel centre, the address is geocoded once with an identifying User-Agent', async () => {
  const f = fakeFetch([
    ['nominatim.openstreetmap.org', () => [{ lat: '41.6765', lon: '44.8246', addresstype: 'building' }]],
    ['interpreter', () => OVERPASS_KRTSANISI_FIXTURE],
  ]);
  const n = await resolveNeighborhood({ resultJson: {}, query: null, address: 'თბილისი, კრწანისის ქ. 6', previous: null, fetchImpl: f, now });
  assert.equal(n.status, 'OK');
  assert.deepEqual([n.center.basis, n.center.precision], ['GEOCODED_ADDRESS', 'HOUSE']);
  const geo = f.calls.find((c) => c.url.includes('nominatim'));
  assert.match(geo.url, /countrycodes=ge/);
  assert.match(decodeURIComponent(geo.url), /კრწანისის ქუჩა 6/);
  assert.match(geo.init.headers['User-Agent'], /HOMATCH/);
});

test('no location at all is stored as NO_LOCATION, with no Overpass call', async () => {
  const f = fakeFetch([]);
  const n = await resolveNeighborhood({ resultJson: {}, query: null, address: 'Krtsanisi', previous: null, fetchImpl: f, now });
  assert.equal(n.status, 'NO_LOCATION');
  assert.equal(f.calls.length, 0);
});

/* ── the unmeasured minutes are gone ──────────────────────────────────── */

test('the research layer\'s walking-minute notes are dropped, relative wording survives', () => {
  const places = nearbyPlaces([
    { category: 'SUPERMARKET', name: 'Karpuri', note: 'საჯაროდ ხელმისაწვდომი მისამართზე დაფუძნებული ინფორმაციის მიხედვით, ფეხით დაახლოებით 1 წუთია.' },
    { category: 'CITY_CENTRE', name: 'ქალაქის ცენტრი', note: 'მითითებულია 4.3 კმ და ავტომობილით დაახლოებით 9 წუთი.' },
    { category: 'SCHOOL', name: 'School', note: 'a five-minute walk' },
    { category: 'PHARMACY', name: 'Aversi', note: 'on the same street' },
  ]);
  assert.equal(places.find((p) => p.name === 'Karpuri').note, null);
  assert.equal(places.find((p) => p.name === 'ქალაქის ცენტრი').note, null);
  assert.equal(places.find((p) => p.name === 'School').note, null);
  assert.equal(places.find((p) => p.name === 'Aversi').note, 'on the same street');
  assert.ok(isUnverifiedReach('ფეხით დაახლოებით 3 წუთია'));
});

test('a successful lookup replaces the named-but-unmeasured list; a failed one keeps names only', () => {
  const base = buildLocationIntelligence(['თბილისი, კრწანისის ქ. 6'], [{ category: 'SUPERMARKET', name: 'Karpuri', note: 'ფეხით 1 წუთი' }]);
  const ok = withNeighborhood(base, stored());
  assert.deepEqual(ok.nearby, []);
  assert.equal(ok.neighborhood.status, 'OK');
  const failed = withNeighborhood(base, buildStoredNeighborhood({ status: 'UNAVAILABLE', center: null, fetchedAt: 'x' }));
  assert.equal(failed.nearby.length, 1);
  assert.equal(failed.nearby[0].note, null);
});

/* ── wiring ───────────────────────────────────────────────────────────── */

test('verify-synthesis measures the neighbourhood at build time, before the prompt is built', () => {
  const src = read('supabase/functions/verify-synthesis/index.ts');
  const resolve = src.indexOf('resolveNeighborhood({');
  const attach = src.indexOf('bundle.location = withNeighborhood(bundle.location, await neighborhoodP)');
  const prompt = src.indexOf('buildIntelligencePrompt(pkg, bundle');
  assert.ok(resolve > 0 && attach > resolve && prompt > attach, 'the lookup is not attached before the model sees the location');
  assert.match(src, /previous: job\.synthesis_json\?\.location\?\.neighborhood/, 'a rebuild refetches instead of reusing the stored lookup');
});

test('the prompt no longer invites walking minutes', () => {
  const src = read('src/verify/intelligence/prompt.ts');
  assert.ok(!/Distances and walking times only as quoted/.test(src));
  assert.match(src, /NEVER turn',\n\s*'metres into walking or driving minutes/);
});

test('the section shows attribution, the data date and no travel times', () => {
  const ui = read('src/components/verify/NeighborhoodSection.tsx');
  assert.ok(ui.includes('OSM_COPYRIGHT_URL') && OSM_COPYRIGHT_URL === 'https://www.openstreetmap.org/copyright');
  assert.match(ui, /verify_nb_source/);
  assert.match(ui, /verify_nb_distance_note/);
  assert.ok(!/fetch\(/.test(ui), 'opening the report refetches');
  assert.ok(!/text-\[1[01]px\]/.test(ui), 'type below the scale floor');
  assert.ok(!/\b(ml|mr|pl|pr)-\d/.test(ui), 'physical spacing breaks RTL');
  const report = read('src/components/verify/VerifyReport.tsx');
  assert.match(report, /\{measured \? <NeighborhoodSection n=\{measured\} \/> : null\}/);
});

test('every neighbourhood string exists in all six languages, placeholders intact, no minutes', async () => {
  const { VERIFY_FINAL_NEIGHBORHOOD_STRINGS: S } = await import('../../../../scripts/verify-final-neighborhood-i18n-data.mjs');
  const bundle = read('src/i18n/translations.ts');
  const ui = read('src/components/verify/NeighborhoodSection.tsx') + read('src/verify/intelligence/neighborhood.ts');
  for (const key of new Set([...ui.matchAll(/'(verify_nb_[a-z_A-Z]+)'/g)].map((m) => m[1]))) {
    assert.ok(S[key], `${key} is used but has no copy`);
  }
  for (const [key, values] of Object.entries(S)) {
    assert.equal((bundle.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length, 6, `${key} is not in all six locales`);
    const ph = (s) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join();
    for (const v of values) {
      assert.equal(ph(v), ph(values[0]), `${key} lost a placeholder`);
      assert.ok(!/—/.test(v), `${key} has an em dash`);
    }
    assert.ok(!/წუთ|ფეხით/.test(values[1]), `${key} speaks of walking minutes`);
  }
});

test('geocodeQueries: full address, then without district, then street + city (job dbf04e48)', async () => {
  const { geocodeQueries } = await import('../neighborhood.ts');
  assert.deepEqual(geocodeQueries('18 Kristian Stiven Street, Digomi, Tbilisi'), [
    '18 Kristian Stiven Street, Digomi, Tbilisi',
    '18 Kristian Stiven Street, Tbilisi',
    'Kristian Stiven Street, Tbilisi',
  ]);
  assert.deepEqual(geocodeQueries('მარშალ გელოვანის გამზ. 23, საბურთალო, თბილისი')[0], 'მარშალ გელოვანის გამზირი 23, საბურთალო, თბილისი');
  assert.equal(geocodeQueries('კრწანისის ქ. 6, თბილისი').length, 2);
  assert.deepEqual(geocodeQueries('Digomi, Tbilisi'), []);
});

test('geocodeAddress tries the next query when the first has no house/street hit', async () => {
  const { geocodeAddress } = await import('../neighborhoodFetch.ts');
  const asked = [];
  const fakeFetch = async (url) => {
    const q = decodeURIComponent(new URL(url).searchParams.get('q'));
    asked.push(q);
    const body = q === 'Kristian Stiven Street, Tbilisi' ? [{ lat: '41.79', lon: '44.75', addresstype: 'road' }] : [];
    return { ok: true, json: async () => body };
  };
  const c = await geocodeAddress('18 Kristian Stiven Street, Digomi, Tbilisi', fakeFetch);
  assert.equal(asked.length, 3);
  assert.equal(c.precision, 'STREET');
  assert.equal(c.basis, 'GEOCODED_ADDRESS');
});
