// F5 (2026-10-22): no Verify report stored usable coordinates.
//
// Proven on job 61c1c38c (01.14.07.001.044, Tskneti highway 31): the TAS_MAP
// result carried only the ms.gov.ge START view, the modern cadastral plan
// prints no grid numbers, and the edge's Nominatim geocode answered nothing.
// These tests pin the projection, the centre candidates the stored data
// carries, the decision between them, and the location contract: distances
// only from a verified centre, mentioned places never with one, old reports
// still readable. Every network answer here is a recorded FIXTURE.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  centerFromBrowserOfficial,
  centerFromCadastralPlan,
  centerFromMsMapUrl,
  centerFromSituationalDrawingText,
  centersFromSituationalDrawings,
  haversineM,
  legacyPlanNamesParcel,
  utmToLatLng,
} from '../neighborhood.ts';
import { chooseCenter, centerConfidence, CENTER_DISAGREEMENT_M } from '../locationCenter.ts';
import { officialCenterCandidates, resolveNeighborhood, resolveSubjectCenter } from '../neighborhoodFetch.ts';
import { locationContract, mentionedPlaces, withNeighborhood } from '../locationIntelligence.ts';
import {
  REF_ADDRESS, REF_NOMINATIM, REF_PARCEL, REF_STORED_LOCATION, REF_TAS_MAP_RESULT,
  DIGOMI_LEGACY_PLAN, DIGOMI_PARCEL, DIGOMI_PLAN_CENTER,
  KRTSANISI_LEGACY_PLAN, KRTSANISI_MAP_CENTER, KRTSANISI_PARCEL,
} from '../../__tests__/fixtures/locationF5Fixture.mjs';
import { OVERPASS_KRTSANISI_FIXTURE } from '../../__tests__/fixtures/overpassKrtsanisiFixture.mjs';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const now = () => new Date('2026-10-22T13:00:00.000Z');
const refJob = { exactUnit: { code: REF_PARCEL }, browserOfficial: { results: [REF_TAS_MAP_RESULT] } };

function fakeFetch(routes) {
  const calls = [];
  const f = async (url, init = {}) => {
    calls.push({ url, init });
    for (const [match, answer] of routes) {
      if (url.includes(match)) {
        const body = answer();
        if (body instanceof Error) throw body;
        if (typeof body === 'number') return { ok: false, status: body, json: async () => null };
        return { ok: true, status: 200, json: async () => body };
      }
    }
    return { ok: false, status: 404, json: async () => null };
  };
  f.calls = calls;
  return f;
}

/* ── projection: WGS 84 / UTM 38N → WGS 84 ───────────────────────────── */

/* An independent forward projection (Krüger n-series, as in Karney 2011 and
   the Wikipedia UTM article), so the inverse is not checked against itself. */
function latLngToUtm38(lat, lng) {
  const a = 6378137, f = 1 / 298.257223563, k0 = 0.9996, E0 = 500000;
  const n = f / (2 - f);
  const A = (a / (1 + n)) * (1 + n ** 2 / 4 + n ** 4 / 64);
  const al = [n / 2 - (2 / 3) * n ** 2 + (5 / 16) * n ** 3, (13 / 48) * n ** 2 - (3 / 5) * n ** 3, (61 / 240) * n ** 3];
  const phi = (lat * Math.PI) / 180, dl = ((lng - 45) * Math.PI) / 180;
  const c = (2 * Math.sqrt(n)) / (1 + n);
  const t = Math.sinh(Math.atanh(Math.sin(phi)) - c * Math.atanh(c * Math.sin(phi)));
  const xi = Math.atan(t / Math.cos(dl)), eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let E = eta, N = xi;
  for (let j = 1; j <= 3; j++) {
    E += al[j - 1] * Math.cos(2 * j * xi) * Math.sinh(2 * j * eta);
    N += al[j - 1] * Math.sin(2 * j * xi) * Math.cosh(2 * j * eta);
  }
  return { easting: E0 + k0 * A * E, northing: k0 * A * N };
}

test('UTM 38N inverse: the central meridian at the equator is (0°, 45°)', () => {
  const p = utmToLatLng(500000, 0);
  assert.ok(Math.abs(p.lat) < 1e-9 && Math.abs(p.lng - 45) < 1e-9);
});

test('UTM 38N inverse agrees with an independent forward projection across Georgia to under 0.1 m', () => {
  for (const [lat, lng] of [[41.0, 40.0], [41.69, 44.80], [42.27, 42.70], [43.5, 46.7], [41.75, 44.73], [42.0, 45.0]]) {
    const { easting, northing } = latLngToUtm38(lat, lng);
    const back = utmToLatLng(easting, northing);
    assert.ok(haversineM(back, { lat, lng }) < 0.1, `${lat},${lng} came back ${back.lat},${back.lng}`);
  }
});

test('two official sources agree through the projection: legacy UTM sheets vs the map and the modern plan', () => {
  const krt = centerFromSituationalDrawingText(KRTSANISI_LEGACY_PLAN);
  assert.ok(haversineM(krt, KRTSANISI_MAP_CENTER) < 50, `Krtsanisi sheet ${JSON.stringify(krt)} is far from the ms.gov.ge centre`);
  const dig = centerFromSituationalDrawingText(DIGOMI_LEGACY_PLAN);
  assert.ok(haversineM(dig, DIGOMI_PLAN_CENTER) < 50, `Digomi sheet ${JSON.stringify(dig)} is far from the modern plan centre`);
});

/* ── what the stored reference job carries ──────────────────────────── */

test('job 61c1c38c: the stored TAS_MAP result has no map centre and its modern plan prints no grid', () => {
  const bo = refJob.browserOfficial;
  assert.equal(centerFromBrowserOfficial(bo, REF_PARCEL), null, 'the start view was read as the parcel');
  assert.equal(centerFromCadastralPlan(bo, REF_PARCEL), null);
  // The one grid in the stored data is a situational drawing that names no parcel code.
  const drawings = centersFromSituationalDrawings(bo, REF_PARCEL);
  assert.equal(drawings.length, 1);
  assert.equal(drawings[0].namesParcel, false);
  assert.equal(drawings[0].evidence, 'NAPR registration 882025596274');
  assert.ok(Math.abs(drawings[0].lat - 41.74853) < 1e-4 && Math.abs(drawings[0].lng - 44.80347) < 1e-4);
  const cands = officialCenterCandidates(bo, REF_PARCEL);
  assert.deepEqual(cands.map((c) => [c.basis, centerConfidence(c)]), [['SITUATIONAL_DRAWING', 'MEDIUM']]);
  assert.equal(cands[0].retrievedAt, '2026-10-22T11:57:45.881Z');
});

test('legacy sheets that print the parcel code are plans (HIGH); the anonymous drawing is not', () => {
  assert.equal(legacyPlanNamesParcel(DIGOMI_LEGACY_PLAN, DIGOMI_PARCEL), true);
  assert.equal(legacyPlanNamesParcel(KRTSANISI_LEGACY_PLAN, KRTSANISI_PARCEL), true);
  assert.equal(legacyPlanNamesParcel(KRTSANISI_LEGACY_PLAN, DIGOMI_PARCEL), false, 'another parcel\'s sheet was accepted');
  assert.equal(legacyPlanNamesParcel(REF_TAS_MAP_RESULT.documents[0].rawText, REF_PARCEL), false);
  const bo = { results: [{ source: 'TAS_MAP', status: 'SEARCH_CONFIRMED', queryEntered: KRTSANISI_PARCEL, documents: [{ title: 'NAPR registration 882013110065', rawText: KRTSANISI_LEGACY_PLAN }] }] };
  assert.deepEqual(officialCenterCandidates(bo, KRTSANISI_PARCEL).map((c) => c.basis), ['CADASTRAL_PLAN']);
});

test('the grid reader refuses noise: unregular rows, wide spans, no UTM mark', () => {
  assert.equal(centerFromSituationalDrawingText(KRTSANISI_LEGACY_PLAN.replace('UTM\n(saerTaSoriso)', '')), null);
  assert.equal(centerFromSituationalDrawingText('situaciuri naxazi\n485400486900\n4613850\n4613900\n1:500'), null, 'a 1.5 km frame');
  assert.equal(centerFromSituationalDrawingText('situaciuri naxazi\n485400485417485450\n4613850\n4613900\n1:500'), null, 'irregular steps');
  assert.equal(centerFromSituationalDrawingText('situaciuri naxazi\n485400485450\n4613850\n1:500'), null, 'one northing');
  // Grid rows below the scale bar are not grid.
  assert.equal(centerFromSituationalDrawingText('situaciuri naxazi\n1:500\n485400485450\n4613850\n4613900'), null);
});

test('a city-wide ms.gov.ge view (Z=12) is not a parcel centre', () => {
  assert.equal(centerFromMsMapUrl('https://ms.gov.ge/msmap/#C=44.7874667-41.7233507@Z=12'), null);
  assert.ok(centerFromMsMapUrl('https://ms.gov.ge/msmap/#C=44.8246494-41.6765159@Z=18'));
});

/* ── the decision ───────────────────────────────────────────────────── */

const drawing = { lat: 41.74853, lng: 44.80347, basis: 'SITUATIONAL_DRAWING', parcel: REF_PARCEL };
const house = { lat: 41.7102748, lng: 44.7311562, basis: 'GEOCODED_ADDRESS', precision: 'HOUSE' };
const plan = { lat: 41.7103, lng: 44.7310, basis: 'CADASTRAL_PLAN', parcel: REF_PARCEL };

test('a drawing alone is never a centre: UNCORROBORATED_DRAWING, no distances', () => {
  const d = chooseCenter([drawing]);
  assert.equal(d.center, null);
  assert.equal(d.issue, 'UNCORROBORATED_DRAWING');
  assert.equal(d.candidates.length, 1);
});

// Owner decision 2026-10-23 (job 61c1c38c): a drawing that names an application,
// not the parcel, does not outrank a house-VALIDATED registry-address geocode.
test('a drawing 7.5 km from the house-validated geocode is set aside: the geocode is the centre, the conflict stays on record', () => {
  const d = chooseCenter([house, drawing]);
  assert.equal(d.center.basis, 'GEOCODED_ADDRESS');
  assert.equal(d.center.precision, 'HOUSE');
  assert.equal(d.center.confidence, 'MEDIUM');
  assert.equal(d.issue, 'DRAWING_SET_ASIDE');
  const kept = d.candidates.find((c) => c.basis === 'SITUATIONAL_DRAWING');
  assert.equal(kept.chosen, false);
  assert.equal(kept.disagrees, true);
  assert.ok(kept.distanceFromCenterM > 7000);
  assert.ok(haversineM(house, drawing) > 7000);
});

test('against a street-precision geocode the same drawing is a CENTER_CONFLICT: neither is used, both are kept and flagged', () => {
  const street = { ...house, precision: 'STREET' };
  const d = chooseCenter([street, drawing]);
  assert.equal(d.center, null);
  assert.equal(d.issue, 'CENTER_CONFLICT');
  assert.ok(d.candidates.every((c) => c.disagrees && !c.chosen && c.distanceFromCenterM === null));
});

test('a set-aside drawing is a limitation in the V2 contract and the centre is labelled an approximate address geocode', () => {
  const d = chooseCenter([house, drawing]);
  const contract = locationContract({ neighborhood: { status: 'OK', center: d.center, candidates: d.candidates, centerIssue: d.issue, fetchedAt: '2026-10-23T00:00:00Z', groups: [], transit: null } });
  assert.equal(contract.center.method, 'ADDRESS_GEOCODE');
  assert.equal(contract.center.precision, 'HOUSE');
  assert.ok(contract.coverage.limitations.includes('DRAWING_SET_ASIDE'));
  assert.equal(contract.coverage.centerIssue, 'DRAWING_SET_ASIDE');
  assert.equal(contract.centerCandidates.filter((c) => c.disagrees).length, 1);
});

test('a drawing within 1 km of the address geocode is used, with the geocode kept as corroboration', () => {
  const near = { ...house, lat: drawing.lat + 0.002, lng: drawing.lng };
  const d = chooseCenter([near, drawing]);
  assert.equal(d.center.basis, 'SITUATIONAL_DRAWING');
  assert.equal(d.center.confidence, 'MEDIUM');
  const g = d.candidates.find((c) => c.basis === 'GEOCODED_ADDRESS');
  assert.equal(g.disagrees, false);
  assert.ok(g.distanceFromCenterM > 150 && g.distanceFromCenterM < 300);
});

test('the parcel wins over a far geocode, which is flagged rather than dropped', () => {
  const farGeocode = { ...house, lat: 41.76 };
  const d = chooseCenter([farGeocode, plan]);
  assert.equal(d.center.basis, 'CADASTRAL_PLAN');
  assert.equal(d.center.confidence, 'HIGH');
  assert.equal(d.issue, null);
  const g = d.candidates.find((c) => c.basis === 'GEOCODED_ADDRESS');
  assert.equal(g.disagrees, true);
  assert.ok(g.distanceFromCenterM > CENTER_DISAGREEMENT_M);
});

test('priority: map view, plan, earlier map view, then geocode house before street; outside Georgia is dropped', () => {
  const ms = { lat: 41.71, lng: 44.73, basis: 'MS_MAP_PARCEL' };
  const earlier = { lat: 41.71, lng: 44.73, basis: 'MS_MAP_PARCEL_EARLIER' };
  const street = { ...house, precision: 'STREET' };
  assert.equal(chooseCenter([street, house, earlier, plan, ms]).center.basis, 'MS_MAP_PARCEL');
  assert.equal(chooseCenter([street, house, earlier, plan]).center.basis, 'CADASTRAL_PLAN');
  assert.equal(chooseCenter([street, house, earlier]).center.basis, 'MS_MAP_PARCEL_EARLIER');
  assert.equal(chooseCenter([street, house]).center.precision, 'HOUSE');
  assert.equal(chooseCenter([street]).center.confidence, 'LOW');
  assert.deepEqual(chooseCenter([{ lat: 44.73, lng: 41.71, basis: 'CADASTRAL_PLAN' }]), { center: null, candidates: [], issue: null });
});

/* ── the reference job end to end, network recorded ─────────────────── */

test('job 61c1c38c with the recorded Nominatim answer: CENTER_CONFLICT, no Overpass call, nothing measured', async () => {
  const f = fakeFetch([['nominatim', () => REF_NOMINATIM], ['interpreter', () => OVERPASS_KRTSANISI_FIXTURE]]);
  const n = await resolveNeighborhood({ resultJson: refJob, query: REF_PARCEL, address: REF_ADDRESS, previous: REF_STORED_LOCATION.neighborhood, fetchImpl: f, now });
  assert.equal(n.status, 'NO_LOCATION');
  assert.equal(n.centerIssue, 'CENTER_CONFLICT');
  assert.equal(n.center, null);
  assert.deepEqual(n.candidates.map((c) => c.basis).sort(), ['GEOCODED_ADDRESS', 'SITUATIONAL_DRAWING']);
  assert.equal(f.calls.filter((c) => c.url.includes('interpreter')).length, 0, 'distances were measured from an unverified centre');
  assert.deepEqual(n.places, []);
  const geo = f.calls.find((c) => c.url.includes('nominatim'));
  assert.match(geo.init.headers['User-Agent'], /HOMATCH/);
  assert.equal(geo.init.headers.Referer, 'https://homatch.live/');
});

test('job 61c1c38c when Nominatim refuses (as it did from the edge): UNCORROBORATED_DRAWING, the status is recorded', async () => {
  const f = fakeFetch([['nominatim', () => 403]]);
  const r = await resolveSubjectCenter({ resultJson: refJob, query: REF_PARCEL, address: REF_ADDRESS, previous: null, fetchImpl: f, now });
  assert.equal(r.center, null);
  assert.equal(r.issue, 'UNCORROBORATED_DRAWING');
  assert.ok(r.geocode.length >= 1 && r.geocode.every((s) => s === '403'), JSON.stringify(r.geocode));
});

test('a rebuild reuses the stored geocode instead of asking Nominatim again', async () => {
  const f1 = fakeFetch([['nominatim', () => REF_NOMINATIM]]);
  const first = await resolveNeighborhood({ resultJson: refJob, query: REF_PARCEL, address: REF_ADDRESS, previous: null, fetchImpl: f1, now });
  const f2 = fakeFetch([]);
  const second = await resolveNeighborhood({ resultJson: refJob, query: REF_PARCEL, address: REF_ADDRESS, previous: first, fetchImpl: f2, now });
  assert.equal(f2.calls.length, 0);
  assert.equal(second.centerIssue, 'CENTER_CONFLICT');
});

test('a legacy plan naming the parcel places it (HIGH) with no geocode, then ONE Overpass query measures from it', async () => {
  const job = { exactUnit: { code: `${KRTSANISI_PARCEL}.03.01.601` }, browserOfficial: { results: [{ ...REF_TAS_MAP_RESULT, queryEntered: `${KRTSANISI_PARCEL}.03.01.601`, documents: [{ title: 'NAPR registration 882013110065', rawText: KRTSANISI_LEGACY_PLAN }] }] } };
  const f = fakeFetch([['interpreter', () => OVERPASS_KRTSANISI_FIXTURE]]);
  const n = await resolveNeighborhood({ resultJson: job, query: null, address: 'თბილისი, კრწანისის ქ. 6', previous: null, fetchImpl: f, now });
  assert.equal(n.status, 'OK');
  assert.equal(n.center.basis, 'CADASTRAL_PLAN');
  assert.equal(n.center.parcel, KRTSANISI_PARCEL);
  assert.equal(f.calls.length, 1, 'geocoded despite a HIGH official centre');
  assert.ok(n.places.length > 0 && n.places.every((p) => typeof p.lat === 'number' && typeof p.lng === 'number'));
});

/* ── the contract: measured vs mentioned, old reports ──────────────── */

test('distances exist only from a verified centre: no centre, no measured places, whatever was stored', () => {
  const corrupt = { ...REF_STORED_LOCATION, neighborhood: { ...REF_STORED_LOCATION.neighborhood, status: 'OK', places: [{ category: 'GROCERY', name: 'X', kind: 'supermarket', distanceM: 120, key: 'x', osm: 'n1' }] } };
  const c = locationContract(corrupt);
  assert.equal(c.center, null);
  assert.deepEqual(c.measuredPlaces, []);
  assert.ok(c.coverage.limitations.includes('NO_VERIFIED_CENTER'));
});

test('measured places carry OSM id, coordinates, straight-line metres, source and date', async () => {
  const job = { exactUnit: { code: KRTSANISI_PARCEL }, browserOfficial: { results: [{ ...REF_TAS_MAP_RESULT, queryEntered: KRTSANISI_PARCEL, documents: [{ title: 't', rawText: KRTSANISI_LEGACY_PLAN }] }] } };
  const n = await resolveNeighborhood({ resultJson: job, query: null, address: null, previous: null, fetchImpl: fakeFetch([['interpreter', () => OVERPASS_KRTSANISI_FIXTURE]]), now });
  const loc = withNeighborhood({ nearby: [], minimal: false }, n);
  const c = locationContract(loc);
  assert.equal(c.center.method, 'UTM_GRID_OF_CADASTRAL_PLAN');
  assert.equal(c.center.confidence, 'HIGH');
  assert.equal(c.center.lon, n.center.lng);
  const p = c.measuredPlaces[0];
  assert.deepEqual(Object.keys(p).sort(), ['category', 'lat', 'lon', 'measure', 'name', 'osmId', 'retrievedAt', 'source', 'straightLineM']);
  assert.equal(p.measure, 'STRAIGHT_LINE');
  assert.equal(p.source, 'OSM_OVERPASS');
  assert.ok(Math.abs(haversineM({ lat: p.lat, lng: p.lon }, n.center) - p.straightLineM) <= 60, 'the stored metres are not from the stored centre');
  assert.ok(c.coverage.limitations.includes('DISTANCES_ARE_STRAIGHT_LINE'));
});

test('mentioned places never carry a distance: not from the AI note, not from a stored field', () => {
  const m = mentionedPlaces([
    { category: 'SUPERMARKET', name: 'Nikora', note: 'დაახლოებით 350 მ, ფეხით 5 წუთი' },
    { category: 'SCHOOL', name: 'School 1', note: 'on the same street https://example.ge/project' },
  ]);
  assert.equal(m[0].description, null, 'an unmeasured distance survived');
  assert.equal(m[1].sourceUrl, 'https://example.ge/project');
  const c = locationContract({ ...REF_STORED_LOCATION, mentionedPlaces: [{ ...m[0], distanceM: 350, straightLineM: 350 }] });
  assert.deepEqual(Object.keys(c.mentionedPlaces[0]).sort(), ['category', 'description', 'name', 'origin', 'sourceUrl']);
  assert.equal(c.mentionedPlaces[0].origin, 'PUBLIC_DESCRIPTION');
});

test('old shape: the stored 61c1c38c location reads as a contract, unchanged', () => {
  const c = locationContract(REF_STORED_LOCATION);
  assert.equal(c.version, 2);
  assert.equal(c.center, null);
  assert.deepEqual(c.centerCandidates, []);
  assert.deepEqual(c.mentionedPlaces.map((p) => p.name), ['Carrefour', 'კუს ტბა']);
  assert.equal(c.coverage.status, 'NO_LOCATION');
  assert.ok(c.coverage.limitations.includes('MENTIONED_PLACES_UNMEASURED'));
  // An old OK lookup: centre without provenance, places without coordinates.
  const old = locationContract({ nearby: [], minimal: false, neighborhood: { ...REF_STORED_LOCATION.neighborhood, status: 'OK', center: { ...DIGOMI_PLAN_CENTER, basis: 'CADASTRAL_PLAN', parcel: DIGOMI_PARCEL }, places: [{ category: 'PARK', name: 'P', kind: 'park', distanceM: 200, key: 'p', osm: 'w1' }] } });
  assert.equal(old.center.confidence, 'HIGH');
  assert.equal(old.center.retrievedAt, REF_STORED_LOCATION.neighborhood.fetchedAt);
  assert.deepEqual([old.measuredPlaces[0].lat, old.measuredPlaces[0].straightLineM], [null, 200]);
  assert.equal(locationContract(null).coverage.status, 'NOT_RUN');
});

/* ── wiring and UI ─────────────────────────────────────────────────── */

test('fresh photos take the same centre decision; the report labels mentioned places and the conflict', () => {
  const agent = read('supabase/functions/research-agent/index.ts');
  assert.match(agent, /resolveSubjectCenter\(\{\s*resultJson: rj, query: null, address: freshPhotoAddress\(sj, rj\)/);
  assert.ok(!/geocodeAddress\(freshPhotoAddress/.test(agent), 'fresh photos still geocode on their own');
  const report = read('src/components/verify/VerifyReport.tsx');
  const label = report.indexOf("t('verify_place_mentioned_label')");
  assert.ok(label > 0 && label < report.indexOf('{places.map((p, i)'), 'mentioned places are not labelled as such');
  assert.match(read('src/components/verify/NeighborhoodSection.tsx'), /n\.centerIssue === 'CENTER_CONFLICT'\s*\?\s*'verify_nb_center_conflict'/);
  const bundle = read('src/i18n/translations.ts');
  for (const key of ['verify_place_mentioned_label', 'verify_nb_center_conflict', 'verify_nb_basis_SITUATIONAL_DRAWING']) {
    assert.equal((bundle.match(new RegExp(`\\b${key}:`, 'g')) ?? []).length, 6, `${key} is not in all six locales`);
  }
});

test('the model input is byte-identical to before F5: contract fields, candidates and place coordinates stay out', async () => {
  const { locationForModel } = await import('../locationIntelligence.ts');
  const stored = { ...REF_STORED_LOCATION.neighborhood, status: 'OK', center: { ...DIGOMI_PLAN_CENTER, basis: 'CADASTRAL_PLAN', parcel: DIGOMI_PARCEL }, places: [{ category: 'PARK', name: 'P', kind: 'park', distanceM: 200, key: 'p', osm: 'w1' }] };
  const base = { city: 'თბილისი', nearby: REF_STORED_LOCATION.nearby, minimal: false };
  // What withNeighborhood returned before F5, for the same input.
  const before = { ...base, neighborhood: stored, nearby: [], minimal: false };
  const withF5 = { ...stored, candidates: [{ ...stored.center, confidence: 'HIGH', evidence: 'x', retrievedAt: 'y', chosen: true, distanceFromCenterM: 0, disagrees: false }], centerIssue: null,
    center: { ...stored.center, confidence: 'HIGH', evidence: 'x', retrievedAt: 'y' }, places: stored.places.map((p) => ({ ...p, lat: 41.7, lng: 44.7 })) };
  assert.equal(JSON.stringify(locationForModel(withNeighborhood(base, withF5))), JSON.stringify(before));
  const prompt = read('src/verify/intelligence/prompt.ts');
  assert.match(prompt, /location: locationForModel\(bundle\?\.location\)/);
});
