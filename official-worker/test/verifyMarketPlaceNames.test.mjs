// verifyMarketPlaceNames.test.mjs — owner 2026-10-24: the market search must work for every city in Georgia. When the caller
// has no district name, the parcel centre names the city and its localities (Nominatim reverse, Overpass is_in fallback),
// and every name is searched as its own DISTRICT attempt — never the whole city. Engines and lookups are faked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VerifyMarketRuntime, parseVerifyMarketProfile } from '../.tstest-build/verify/VerifyMarketRuntime.js';
import { placeFromNominatim, placeFromOverpass, placeNamesAt, inGeorgia } from '../.tstest-build/verify/placeNames.js';

const BATUMI = [41.6413, 41.6339];

test('Nominatim and Overpass answers become Georgian city + locality names, most specific first', () => {
  const nom = placeFromNominatim({ address: { road: 'შერიფ ხიმშიაშვილის ქუჩა', suburb: 'ახალი ბულვარი', city_district: 'ბათუმი', city: 'ბათუმი', state: 'აჭარა' } });
  assert.deepEqual(nom, { city: 'ბათუმი', localities: ['ახალი ბულვარი', 'ბათუმი'], street: 'შერიფ ხიმშიაშვილის ქუჩა', source: 'NOMINATIM' });
  const village = placeFromNominatim({ address: { village: 'წავკისი', municipality: 'თეთრიწყაროს მუნიციპალიტეტი' } });
  assert.equal(village.city, 'წავკისი');
  assert.ok(village.localities.includes('წავკისი'), 'a village inside a municipality is its own locality');
  const ov = placeFromOverpass({ elements: [{ tags: { admin_level: '4', name: 'Adjara' } }, { tags: { admin_level: '8', 'name:ka': 'ქუთაისი', name: 'Kutaisi' } }, { tags: { admin_level: '10', 'name:ka': 'ავტოქარხანა' } }] });
  assert.deepEqual(ov, { city: 'ქუთაისი', localities: ['ავტოქარხანა'], street: null, source: 'OVERPASS' });
  assert.equal(placeFromNominatim({}), null);
  assert.equal(inGeorgia(55.75, 37.6), false);
});

test('Nominatim silent → Overpass answers; outside Georgia nothing is asked', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    if (url.includes('nominatim')) return new Response('', { status: 503 });
    return new Response(JSON.stringify({ elements: [{ tags: { admin_level: '8', 'name:ka': 'ბათუმი' } }, { tags: { admin_level: '9', 'name:ka': 'ძველი ბათუმი' } }] }), { headers: { 'Content-Type': 'application/json' } });
  };
  const p = await placeNamesAt(...BATUMI, fetchImpl);
  assert.deepEqual([p.city, p.localities, p.source], ['ბათუმი', ['ძველი ბათუმი'], 'OVERPASS']);
  assert.equal(calls.length, 2);
  assert.equal(await placeNamesAt(55.75, 37.6, async () => { throw new Error('must not be called'); }), null);
});

test('a profile with only a Georgian parcel centre is accepted; neither city nor centre is refused', () => {
  const p = parseVerifyMarketProfile({ city: '', district: null, latitude: BATUMI[0], longitude: BATUMI[1], propertyType: 'APARTMENT', areaSqm: 60 });
  assert.equal(p.city, '');
  assert.equal(p.latitude, BATUMI[0]);
  assert.equal(parseVerifyMarketProfile({ city: '', propertyType: 'APARTMENT' }), null);
  assert.equal(parseVerifyMarketProfile({ city: '', latitude: 55.75, longitude: 37.6 }), null);
  assert.ok(parseVerifyMarketProfile({ city: 'თბილისი', district: 'ვაკე' }), 'the old contract still works');
});

test('the runtime names the place from the centre and searches every locality in the named city, never city-wide', async () => {
  const seen = [];
  const acquire = async (request, { report }) => {
    seen.push({ city: request.city, districts: request.districts });
    await report({ status: 'RESULTS_RECEIVED', listings: [] });
  };
  const rt = new VerifyMarketRuntime({ acquireMyHome: acquire, acquireSsge: acquire, placeNames: async () => ({ city: 'ბათუმი', localities: ['ახალი ბულვარი', 'ბათუმი'], street: null, source: 'NOMINATIM' }) });
  const job = rt.start(parseVerifyMarketProfile({ city: '', latitude: BATUMI[0], longitude: BATUMI[1], propertyType: 'APARTMENT', areaSqm: 60 }), ['MYHOME']);
  while (job.status !== 'COMPLETE') await new Promise((r) => setTimeout(r, 5));
  assert.equal(job.profile.city, 'ბათუმი');
  assert.deepEqual(seen.map((s) => s.districts), [['ახალი ბულვარი'], ['ბათუმი']]);
  assert.ok(seen.every((s) => s.city === 'ბათუმი' && s.districts.length === 1), 'one named locality per attempt');
  assert.equal(job.place.source, 'NOMINATIM');

  const none = new VerifyMarketRuntime({ acquireMyHome: acquire, acquireSsge: acquire, placeNames: async () => null });
  seen.length = 0;
  const j2 = none.start(parseVerifyMarketProfile({ city: '', latitude: BATUMI[0], longitude: BATUMI[1], propertyType: 'APARTMENT', areaSqm: 60 }), ['MYHOME']);
  while (j2.status !== 'COMPLETE') await new Promise((r) => setTimeout(r, 5));
  assert.equal(seen.length, 0, 'no name, no search');
  assert.equal(j2.sources.MYHOME.attempts[0].error, 'NO_DISTRICT');
});

test('a district the caller read is searched first; the centre only adds names', async () => {
  const seen = [];
  const acquire = async (request, { report }) => { seen.push(request.districts[0]); await report({ status: 'RESULTS_RECEIVED', listings: [] }); };
  const rt = new VerifyMarketRuntime({ acquireMyHome: acquire, acquireSsge: acquire, placeNames: async () => ({ city: 'თბილისი', localities: ['ვაშლიჯვარი'], street: null, source: 'NOMINATIM' }) });
  const job = rt.start(parseVerifyMarketProfile({ city: 'თბილისი', district: 'საბურთალო', latitude: 41.7194, longitude: 44.724, propertyType: 'APARTMENT', areaSqm: 60 }), ['MYHOME']);
  while (job.status !== 'COMPLETE') await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(seen, ['საბურთალო'], 'city and district were known: no lookup needed');
});
