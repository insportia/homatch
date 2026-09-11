// Location & Living, end to end, one link at a time.
//
// This feature has now been found broken twice, and both times every
// individual piece was correct. The research searched for nearby places; the
// normaliser knew how to clean them; the bundle knew how to read them; the
// report had sections for them. What was missing was a JOIN — first a field in
// the research return schema, then a field on the type the renderer reads —
// and a missing join produces no error anywhere. The section is simply
// omitted, correctly, because there is genuinely no evidence, and the report
// looks fine.
//
// So this file does not test the pieces. It tests the CHAIN:
//
//   research prompt → return schema → parsing → result_json
//     → intelligence bundle → synthesis payload → report type → rendering
//
// Every assertion names the link it guards and what silently disappears if
// that link goes. Breaking any one of them must fail here rather than in six
// months when somebody notices the reports have no Location section.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildLocationIntelligence, nearbyPlaces } from '../locationIntelligence.ts';
import { buildIntelligenceBundle } from '../bundle.ts';
import { buildEvidencePackage } from '../evidencePackage.ts';

const ROOT = process.cwd();
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8').split('\r\n').join('\n');

const agent = () => read('supabase', 'functions', 'research-agent', 'index.ts');
const synthesis = () => read('supabase', 'functions', 'verify-synthesis', 'index.ts');
const renderer = () => read('src', 'components', 'verify', 'VerifyReport.tsx');
const i18n = () => read('src', 'i18n', 'translations.ts');

/** A report shaped like a real one, carrying places the research found. */
const REPORT_WITH_PLACES = {
  entityName: 'Test unit',
  exactUnit: { code: '01.18.06.019.055.03.01.603', address: 'Krtsanisi St 6 Tbilisi' },
  publicResearch: {
    facts: ['The building stands on Krtsanisi St 6, Tbilisi.'],
    nearbyPlaces: [
      { category: 'SUPERMARKET', name: 'Goodwill Krtsanisi', note: 'on the same street' },
      { category: 'SCHOOL', name: 'Public School No. 55', note: null },
      { category: 'TRANSPORT', name: 'Ortachala bus terminal', note: null },
    ],
  },
};

/* ── link 1: the research is asked for places ────────────────────────── */

test('LINK 1 — the research plan asks for nearby places, for every archetype', async () => {
  const { LOCATION_TARGETS, publicResearchScope } = await import('../../researchPlan.ts');
  assert.ok(LOCATION_TARGETS.length >= 5, 'the location topics are gone');
  // Location belongs to the PROPERTY, not to its developer, so unlike the
  // construction and company topics it applies to every kind of property —
  // a plot of land still has a road to it and a school down it.
  for (const cls of ['APARTMENT_IN_PROJECT', 'LAND', 'PRIVATE_HOUSE', 'PRIVATE_RESALE', 'COMMERCIAL', 'MIXED_OR_UNKNOWN']) {
    const { targets } = publicResearchScope(cls);
    assert.ok(targets.includes('public transport access'),
      `${cls} no longer researches its own location`);
  }
  // And the orchestrator uses that plan rather than a list of its own.
  assert.match(agent(), /publicResearchScope\(/, 'the research plan is not what drives the prompt');
});

/* ── link 2: the return schema has somewhere to put them ─────────────── */

test('LINK 2 — the return schema has a nearbyPlaces field', () => {
  // This is the link that broke first. The model was told to search ten
  // location topics and handed a JSON shape with no field for the answer, so
  // every one of them was dropped on the floor.
  const src = agent();
  const schema = src.slice(src.indexOf('"awardsRecognition":string[]'));
  assert.ok(/"nearbyPlaces":/.test(schema.slice(0, 600)),
    'the research has nowhere to report a nearby place — Location & Living will be empty');
});

/* ── link 3: what comes back survives parsing ────────────────────────── */

test('LINK 3 — the parser keeps a well-formed place', () => {
  const src = agent();
  assert.ok(/PUBLIC_RESEARCH_PLACE_FIELDS/.test(src), 'places are not normalised at all');
  assert.ok(/for \(const k of PUBLIC_RESEARCH_PLACE_FIELDS\)/.test(src),
    'the place fields are declared but never applied to the research output');
});

test('LINK 3 — a place with no recognised category is dropped, not invented', () => {
  const kept = nearbyPlaces([
    { category: 'SUPERMARKET', name: 'Goodwill' },
    { category: 'NIGHTCLUB', name: 'Somewhere' },
    { category: 'SCHOOL', name: '' },
  ]);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].name, 'Goodwill');
});

/* ── link 4: the bundle reads them off the report ────────────────────── */

test('LINK 4 — the bundle reads places out of result_json', () => {
  const pkg = buildEvidencePackage(REPORT_WITH_PLACES);
  const bundle = buildIntelligenceBundle(REPORT_WITH_PLACES, pkg, undefined);
  assert.ok(bundle.location, 'the bundle carries no location block at all');
  assert.equal(bundle.location.nearby.length, 3,
    'places reached result_json and were lost on the way into the bundle');
  assert.equal(bundle.location.minimal, false);
  assert.equal(bundle.location.district, 'კრწანისი', 'the address did not resolve');
});

test('LINK 4 — every place carries the reason it matters', () => {
  const pkg = buildEvidencePackage(REPORT_WITH_PLACES);
  const bundle = buildIntelligenceBundle(REPORT_WITH_PLACES, pkg, undefined);
  for (const p of bundle.location.nearby) {
    assert.ok(p.whyKey && p.whyKey.startsWith('verify_place_why_'),
      `${p.name} has no reason key, so the renderer shows a bare list`);
    assert.ok(i18n().includes(`${p.whyKey}:`), `${p.whyKey} has no translation`);
  }
});

/* ── link 5: synthesis puts it in the payload ────────────────────────── */

test('LINK 5 — the synthesis response carries the location block', () => {
  assert.match(synthesis(), /location: bundle\.location/,
    'the block is computed and then not sent to the browser');
});

/* ── link 6: the type the renderer reads declares it ─────────────────── */

test('LINK 6 — the report type has a location field', () => {
  // This is the link that broke second, and it broke silently in TypeScript:
  // the payload contained location, the type did not declare it, so nothing
  // downstream could read it and no component ever rendered it.
  const src = renderer();
  const i = src.indexOf('export interface VerifySynthesis');
  const type = src.slice(i, src.indexOf('}', i));
  assert.match(type, /location\?: LocationBlock/,
    'the renderer cannot see the location block, so it can never display it');
});

/* ── link 7: something actually renders it ───────────────────────────── */

test('LINK 7 — a component renders the places', () => {
  const src = renderer();
  assert.match(src, /const LocationLiving: React\.FC/, 'nothing renders Location & Living');
  assert.match(src, /<LocationLiving l=\{synthesis\.location\}/,
    'the component exists but is never mounted');
});

test('LINK 7 — it is mounted with the prose, and standalone when there is none', () => {
  // Evidence must not vanish because the model happened not to write a
  // paragraph about it — the same reasoning as the participants block.
  const src = renderer();
  assert.match(src, /s\.key === locationHost && synthesis\.location/,
    'the places are not attached to the section that discusses them');
  assert.match(src, /synthesis\.location && !locationHost \? <LocationLiving/,
    'with no LOCATION or INFRASTRUCTURE section written, the places disappear');
});

test('LINK 7 — the heading exists in every language', () => {
  const src = i18n();
  for (const key of ['verify_location_title', 'verify_area_context_label']) {
    assert.equal((src.match(new RegExp(`${key}:`, 'g')) ?? []).length, 6,
      `${key} is missing in some language, so those buyers see an English heading`);
  }
});

/* ── what must never appear ──────────────────────────────────────────── */

test('no distance is ever computed or displayed', () => {
  // There is a geocoder at neither end of this pipeline. A confident "350m"
  // is exactly the precise-sounding fabrication this product exists to avoid.
  const src = renderer();
  const i = src.indexOf('const LocationLiving');
  const component = src.slice(i, src.indexOf('/* ------', i + 10));
  for (const f of ['Math.sqrt', 'distance', 'km', 'metres', 'minutes']) {
    assert.ok(!new RegExp(`\\b${f}\\b`).test(component), `the component computes or invents ${f}`);
  }
  assert.match(component, /p\.note \?/, 'the only proximity text is not the source\'s own words');
});

test('nothing renders when nothing was found', () => {
  // Silence is the correct output. A heading with no content under it is what
  // gets filled with generic city description.
  const src = renderer();
  const i = src.indexOf('const LocationLiving');
  const component = src.slice(i, i + 2500);
  assert.match(component, /if \(!places\.length && !where\.length && !l\.profile\) return null;/,
    'an empty location block still renders a heading');
});

test('the area profile is labelled as general knowledge, not as a finding', () => {
  const src = renderer();
  assert.match(src, /verify_area_context_label/,
    'curated district context is presented as though our research established it');
});

test('a report with no places still builds, and says so honestly', () => {
  const bare = { entityName: 'Test', exactUnit: { code: '01.18.06.019.055.03.01.603' } };
  const bundle = buildIntelligenceBundle(bare, buildEvidencePackage(bare), undefined);
  assert.deepEqual(bundle.location.nearby, []);
  assert.equal(bundle.location.minimal, true);
});

/* ── addresses are not only Georgian ─────────────────────────────────── */

test('the address forms this product actually receives all resolve', () => {
  // Every one of these is a real shape: the Latin form is what a production
  // report carried, and Russian-language listings are ordinary here.
  const cases = [
    ['Krtsanisi St 6 Tbilisi', 'კრწანისი', 'თბილისი'],
    ['Krtsanisi St, 6, Tbilisi', 'კრწანისი', 'თბილისი'],
    ['თბილისი, კრწანისის ქუჩა 6', 'კრწანისი', 'თბილისი'],
    ['Тбилиси, Ваке, ул. Чавчавадзе 40', 'ვაკე', 'თბილისი'],
    ['Tbilisi, Saburtalo', 'საბურთალო', 'თბილისი'],
  ];
  for (const [address, district, city] of cases) {
    const r = buildLocationIntelligence([address]);
    assert.equal(r.district, district, `${address} resolved to the wrong district`);
    assert.equal(r.city, city, `${address} resolved to the wrong city`);
    assert.equal(r.minimal, false, `${address} resolved to nothing`);
  }
});

test('a place name inside a longer word is still not a place, in either script', () => {
  assert.equal(buildLocationIntelligence(['Veranda Residence, Gorgasali 12']).minimal, true);
  assert.equal(buildLocationIntelligence(['Веранда Резиденс, Горгасали 12']).minimal, true);
});

test('a Russian street keeps its own form', () => {
  const r = buildLocationIntelligence(['Тбилиси, ул. Чавчавадзе 40']);
  assert.ok(r.street && r.street.includes('Чавчавадзе'), 'the Russian street was not read');
});
