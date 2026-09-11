// Location & Living, which was built at both ends and connected at neither.
//
// Found by reading a real finished production report rather than a fixture:
// the report had no Location section and no Infrastructure section, and the
// job's stored data said why.
//
//   publicResearch.nearbyPlaces = []
//   location = { nearby: [], minimal: true }
//
// Two independent breaks, each enough on its own:
//
//   1. The ten location topics were in the research target list and were
//      being searched for — and the return schema the model was handed had no
//      field to put an answer in. Every one of them was dropped on the floor.
//
//   2. The address resolver read Georgian only. That report's address was
//      "Krtsanisi St, 6, Tbilisi", so nothing resolved at all — for a
//      district this module has a written profile for.
//
// The section was then correctly omitted, because there was genuinely no
// evidence to write it from. Which is why nothing looked broken.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildLocationIntelligence,
  cityOfAddress,
  districtOfAddress,
  streetOf,
  nearbyPlaces,
} from '../locationIntelligence.ts';
import { buildIntelligencePrompt } from '../prompt.ts';
import { buildEvidencePackage } from '../evidencePackage.ts';

const ROOT = process.cwd();
const agent = () =>
  readFileSync(join(ROOT, 'supabase', 'functions', 'research-agent', 'index.ts'), 'utf8').replace(/\r\n/g, '\n');

/* ── the research has somewhere to put the answer ────────────────────── */

test('the research schema asks for the places it searches for', () => {
  // The failure was silent by construction: the model was told to search ten
  // location topics and then handed a JSON shape with no location field.
  const src = agent();
  const schema = src.slice(src.indexOf('"awardsRecognition":string[]'), src.indexOf('"awardsRecognition":string[]') + 600);
  assert.match(schema, /"nearbyPlaces":/, 'the research still has nowhere to report a nearby place');
});

test('the requested shape is the one the normaliser accepts', () => {
  // A schema that asks for something the normaliser drops is the same bug
  // one layer along.
  const src = agent();
  const i = src.indexOf('"nearbyPlaces":{');
  assert.ok(i > 0, 'the place shape is not specified');
  const shape = src.slice(i, i + 400);
  for (const field of ['category', 'name', 'note']) {
    assert.ok(shape.includes(`"${field}"`), `the schema does not ask for ${field}`);
  }
  const categories = src.slice(src.indexOf('const PLACE_CATEGORIES'), src.indexOf('MAX_PLACES_PER_CATEGORY'));
  for (const c of ['SCHOOL', 'SUPERMARKET', 'PHARMACY', 'TRANSPORT']) {
    assert.ok(shape.includes(c), `the schema omits the ${c} category`);
    assert.ok(categories.includes(c), `the normaliser does not accept ${c}`);
  }
});

test('the research is told never to invent a distance', () => {
  // We have coordinates for neither end. "350m from the building" is the
  // precise-sounding fabrication this product exists to avoid.
  const src = agent();
  const i = src.indexOf('nearbyPlaces: the few genuinely NEAREST');
  assert.ok(i > 0, 'the place instruction is gone');
  const instruction = src.slice(i, i + 700);
  assert.match(instruction, /NEVER compute or estimate a distance or a travel time/);
  assert.match(instruction, /Nothing found for a kind = simply no entry/);
});

/* ── an address is an address in either script ───────────────────────── */

test('the address from the real production report now resolves', () => {
  const r = buildLocationIntelligence(['Krtsanisi St, 6, Tbilisi']);
  assert.equal(r.city, 'თბილისი');
  assert.equal(r.district, 'კრწანისი');
  assert.equal(r.street, 'Krtsanisi St 6');
  assert.equal(r.minimal, false, 'the address still resolves to nothing');
  assert.ok(r.profile, 'a district with a written profile produced none');
});

test('both scripts reach the same canonical district', () => {
  for (const [latin, georgian] of [
    ['Tbilisi, Vake, Chavchavadze Ave 40', 'ვაკე'],
    ['Saburtalo, Tbilisi', 'საბურთალო'],
    ['Mtatsminda district, Tbilisi', 'მთაწმინდა'],
    ['Chughureti, Tbilisi', 'ჩუღურეთი'],
  ]) {
    assert.equal(districtOfAddress(latin), georgian, `${latin} did not resolve`);
  }
  assert.equal(districtOfAddress('თბილისი, ვაკე'), 'ვაკე', 'the Georgian path regressed');
});

test('a place name inside a longer word is not a place', () => {
  // "Vera" inside "Veranda", "Gori" inside "Gorgasali". A district claimed
  // from a substring would put a curated area profile on the wrong property.
  assert.equal(districtOfAddress('Veranda Residence, Tbilisi'), undefined);
  assert.equal(cityOfAddress('Gorgasali Street 12'), undefined);
  assert.equal(buildLocationIntelligence(['Veranda Residence, Gorgasali 12']).minimal, true);
});

test('a Latin street needs a street word, not just capitals', () => {
  assert.equal(streetOf('Chavchavadze Ave 40'), 'Chavchavadze Ave 40');
  assert.equal(streetOf('Krtsanisi St, 6'), 'Krtsanisi St 6');
  assert.equal(streetOf('Villion Krtsanisi Homes'), undefined, 'a project name was read as a street');
});

test('an unrecognised area produces silence, not a guess', () => {
  const r = buildLocationIntelligence(['somewhere nobody named']);
  assert.equal(r.minimal, true);
  assert.equal(r.profile, undefined);
  assert.deepEqual(r.nearby, []);
});

/* ── the places carry no invented numbers ────────────────────────────── */

test('a place keeps what a source said and nothing more', () => {
  const places = nearbyPlaces([
    { category: 'SUPERMARKET', name: 'Goodwill', note: 'on the same street' },
    { category: 'SCHOOL', name: 'School No. 55' },
  ]);
  assert.equal(places.length, 2);
  assert.equal(places[0].note, 'on the same street');
  assert.equal(places[1].note ?? null, null, 'a note was invented for a place that had none');
  for (const p of places) {
    assert.ok(p.whyKey.startsWith('verify_place_why_'), 'the reason is prose instead of a translation key');
  }
});

/* ── and the report knows what to do with it ─────────────────────────── */

test('the model is told the area profile is background, not a finding', () => {
  const { system } = buildIntelligencePrompt(buildEvidencePackage({ entityName: 'x' }));
  assert.match(system, /location\.profile is GENERAL AREA KNOWLEDGE/);
  assert.match(system, /must not be cited/);
  assert.match(system, /NEVER write a\ndistance, a walking time or a number of minutes that is not quoted from a source/);
});

test('no district and no places means no paragraph about the area', () => {
  const { system } = buildIntelligencePrompt(buildEvidencePackage({ entityName: 'x' }));
  assert.match(system, /silence is correct/);
});
