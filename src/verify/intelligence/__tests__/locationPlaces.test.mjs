// Location & Living: what is actually near this property.
//
// bundle.location held a parsed address and a curated district paragraph and
// nothing else — no schools, no shops, no transport — so the section could
// not answer the question a buyer is really asking. The places now come from
// the existing public-research stage rather than a new provider.
//
// The rule that matters most here is what we DO NOT say. We have coordinates
// for neither the property nor the school, so any distance or travel time
// would be invented, and "350m from the building" is exactly the kind of
// precise-sounding invention that makes a whole report untrustworthy.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLocationIntelligence, nearbyPlaces, PLACE_WHY_KEYS } from '../locationIntelligence.ts';
import { PUBLIC_RESEARCH_TARGETS, LOCATION_TARGETS, publicResearchScope } from '../../researchPlan.ts';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

/* ── the research actually looks for them ────────────────────────────── */

test('the plan asks about the things that make an area livable', () => {
  for (const t of ['nearby schools', 'nearby supermarkets', 'nearby pharmacies', 'public transport access']) {
    assert.ok(PUBLIC_RESEARCH_TARGETS.includes(t), `the plan never searches for "${t}"`);
  }
});

test('every archetype gets the location targets, including land', () => {
  // A land parcel has no facade to research, but it still has a road to it
  // and a school down it.
  for (const cls of ['APARTMENT_IN_PROJECT', 'PRIVATE_RESALE', 'PRIVATE_HOUSE', 'LAND', 'COMMERCIAL']) {
    const { targets } = publicResearchScope(cls);
    for (const t of LOCATION_TARGETS) {
      assert.ok(targets.includes(t), `${cls} does not research "${t}"`);
    }
  }
});

test('land still has no building fabric researched', () => {
  // Adding location targets must not have widened the narrowed scopes.
  const { targets } = publicResearchScope('LAND');
  for (const t of ['facade', 'elevators', 'insulation']) {
    assert.ok(!targets.includes(t), `${t} is researched for a bare parcel again`);
  }
});

/* ── no invented geography ───────────────────────────────────────────── */

test('no distance or travel time is ever produced', () => {
  const places = nearbyPlaces([
    { category: 'SCHOOL', name: 'Public School N55', note: 'on the same street' },
    { category: 'SUPERMARKET', name: 'Nikora' },
  ]);
  for (const p of places) {
    assert.ok(!('distance' in p), 'a distance was produced');
    assert.ok(!('travelTime' in p), 'a travel time was produced');
    assert.ok(!/\d+\s*(m|km|მეტრ|წუთ|min)\b/i.test(p.name), 'a distance was baked into the name');
  }
});

test('relative context is carried only when a source actually said it', () => {
  // Found by category, because the list is ordered by what a buyer cares
  // about rather than by the order the research happened to return.
  const places = nearbyPlaces([
    { category: 'SCHOOL', name: 'Public School N55', note: 'on the same street' },
    { category: 'PHARMACY', name: 'Aversi' },
  ]);
  const withNote = places.find((p) => p.category === 'SCHOOL');
  const without = places.find((p) => p.category === 'PHARMACY');
  assert.equal(withNote.note, 'on the same street');
  assert.equal(without.note, null, 'a note was invented for a place that had none');
});

/* ── place, context, why ─────────────────────────────────────────────── */

test('every place carries why it matters to somebody living there', () => {
  const places = nearbyPlaces([{ category: 'TRANSPORT', name: 'Metro Vazha-Pshavela' }]);
  assert.equal(places[0].whyKey, 'verify_place_why_transport');
  assert.ok(places[0].name);
});

test('the reason is a translation key, not prose written per report', () => {
  for (const key of Object.values(PLACE_WHY_KEYS)) {
    assert.ok(/^verify_place_why_/.test(key), `${key} is not an i18n key`);
  }
  const bundle = read('src/i18n/translations.ts');
  for (const key of Object.values(PLACE_WHY_KEYS)) {
    const n = bundle.split(`\n  ${key}: `).length - 1;
    assert.equal(n, 6, `${key} is defined ${n} times, expected all six languages`);
  }
});

/* ── a shortlist, not an index ───────────────────────────────────────── */

test('the same place found twice is one place', () => {
  const places = nearbyPlaces([
    { category: 'SUPERMARKET', name: 'Nikora' },
    { category: 'SUPERMARKET', name: 'nikora' },
    { category: 'SUPERMARKET', name: 'Nikora  ' },
  ]);
  assert.equal(places.length, 1, 'the same supermarket was listed more than once');
});

test('daily needs come before getting around', () => {
  const places = nearbyPlaces([
    { category: 'CITY_CENTRE', name: 'Freedom Square' },
    { category: 'SUPERMARKET', name: 'Nikora' },
    { category: 'TRANSPORT', name: 'Bus 37' },
  ]);
  assert.deepEqual(places.map((p) => p.category), ['SUPERMARKET', 'TRANSPORT', 'CITY_CENTRE']);
});

test('an unknown category is dropped rather than shown', () => {
  const places = nearbyPlaces([
    { category: 'CASINO', name: 'Somewhere' },
    { category: 'SCHOOL', name: '' },
    { category: 'SCHOOL', name: 'Public School N55' },
  ]);
  assert.deepEqual(places.map((p) => p.name), ['Public School N55']);
});

test('malformed input yields no places and never throws', () => {
  for (const v of [null, undefined, 'nope', 42, {}, [null, 7, 'x']]) {
    assert.deepEqual(nearbyPlaces(v), []);
  }
});

/* ── it reaches the bundle ───────────────────────────────────────────── */

test('location intelligence carries the places alongside the address', () => {
  const loc = buildLocationIntelligence(
    ['თბილისი, კრწანისის ქუჩა 6'],
    [{ category: 'SUPERMARKET', name: 'Nikora', note: 'on the same street' }]
  );
  assert.equal(loc.nearby.length, 1);
  assert.equal(loc.nearby[0].name, 'Nikora');
  // The existing address parsing is untouched.
  assert.ok(loc.district || loc.street, 'the address stopped being parsed');
});

test('a property with no researched places still builds', () => {
  const loc = buildLocationIntelligence(['თბილისი, კრწანისის ქუჩა 6'], undefined);
  assert.deepEqual(loc.nearby, []);
  assert.equal(loc.minimal, false);
});
