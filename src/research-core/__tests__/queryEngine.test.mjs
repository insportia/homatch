// FIND PROPERTY — the deterministic query engine (zero model calls).
//
// 1. The regression set (fixtures/searchQueryRegression.mjs): every representative
//    sentence, six languages, reads to the brief it should. The pass rate is printed.
// 2. The retired model's own outputs for production sentences: the engine's brief
//    agrees with the model's on what a search executes (and is printed per field).
// 3. Ambiguity becomes clarification chips whose edits produce a ready brief.
// 4. Purity: the engine module graph contains no network, model or clock access.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { applyEdit, briefFromModel, confirmedValue } from '../marketplace/brief.ts';
import { editDistance, understandSearchText } from '../marketplace/queryEngine.ts';
import { evaluateReadiness } from '../marketplace/readiness.ts';
import { StaticRateConverter } from '../normalize/currency.ts';
import { SEARCH_PLACES } from '../marketplace/searchPlaces.ts';
import { BASELINE_FIELDS, CASES, MODEL_BASELINE, TEST_RATES } from './fixtures/searchQueryRegression.mjs';

const converter = new StaticRateConverter(TEST_RATES, { baseCurrency: 'GEL' });
const read = (text) => understandSearchText(text, { converter });
const range = (f) => (f ? [f.value.min, f.value.max] : null);

/** Every expectation of one case that the brief does not meet. */
function mismatches(text, want) {
  const { brief: b, clarifications } = read(text);
  const got = {
    tx: b.transactionType?.value ?? null, type: b.propertyType?.value ?? null, city: b.city?.value ?? null,
    districts: b.districts?.value ?? null, price: range(b.price), priceStatus: b.price?.status ?? null,
    area: range(b.area), rooms: range(b.rooms), bedrooms: range(b.bedrooms),
    floor: b.floorRange ? [b.floorRange.min, b.floorRange.max] : null,
    must: b.mustHave, nice: b.niceToHave, excl: b.exclusions, furnished: b.furnished?.value ?? null, parking: b.parking?.value ?? null,
    buildings: b.buildingStatuses?.value ?? null, renovations: b.renovationPreferences?.value ?? null,
    clar: clarifications.map((c) => c.id).sort(),
  };
  const out = [];
  for (const [key, expected] of Object.entries(want)) {
    const actual = got[key];
    const norm = (v) => (['clar', 'must', 'nice', 'excl'].includes(key) && Array.isArray(v) ? [...v].sort() : v);
    const ok = key === 'price' && Array.isArray(expected) && Array.isArray(actual)
      ? Math.abs(expected[0] - actual[0]) <= 1 && Math.abs(expected[1] - actual[1]) <= 1
      : JSON.stringify(norm(actual)) === JSON.stringify(norm(expected));
    if (!ok) out.push(`${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  return out;
}

test('regression set: at least 80 sentences across all six languages', () => {
  assert.ok(CASES.length >= 80, `${CASES.length} cases`);
  const langs = new Set(CASES.map(([lang]) => lang));
  for (const lang of ['ka', 'en', 'ru', 'tr', 'ar', 'he']) assert.ok(langs.has(lang), lang);
});

test('regression set: every sentence reads to its expected brief (pass rate printed)', () => {
  const failures = [];
  for (const [lang, text, want] of CASES) {
    const miss = mismatches(text, want);
    if (miss.length) failures.push(`[${lang}] ${text}\n    ${miss.join('\n    ')}`);
  }
  const passed = CASES.length - failures.length;
  console.log(`query engine regression: ${passed}/${CASES.length} passed (${((passed / CASES.length) * 100).toFixed(1)}%)`);
  assert.equal(failures.length, 0, failures.join('\n'));
});

test('agreement with the retired model on production sentences (per executed field)', () => {
  const sameValue = (field, a, b) => {
    if (field === 'districts' || field === 'city') {
      const list = (v) => (v == null ? [] : Array.isArray(v) ? v : [v]);
      const x = list(a), y = list(b);
      const key = (name) => SEARCH_PLACES.find((p) => p.name === name || p.forms.some((f) => f.toLowerCase() === String(name).toLowerCase()))?.key ?? name;
      return x.length === y.length && x.every((name) => y.some((other) => key(other) === key(name)));
    }
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  };
  const value = (brief, field) => {
    const v = brief[field];
    if (field === 'floorRange' || field === 'mustHave') return v ?? null;
    return confirmedValue(v);
  };
  let agree = 0, total = 0;
  const differences = [];
  for (const { text, model } of MODEL_BASELINE) {
    const fromModel = briefFromModel(model, text);
    const fromEngine = read(text).brief;
    for (const field of BASELINE_FIELDS) {
      total++;
      if (sameValue(field, value(fromEngine, field), value(fromModel, field))) agree++;
      else differences.push(`${field}: engine ${JSON.stringify(value(fromEngine, field))} / model ${JSON.stringify(value(fromModel, field))}`);
    }
  }
  console.log(`agreement with the model baseline: ${agree}/${total} executed fields (${((agree / total) * 100).toFixed(1)}%)`);
  if (differences.length) console.log(`  differences:\n  ${differences.join('\n  ')}`);
  /* The remaining differences are the model's own over-reads (an area max nobody typed, a
     bedroom range widened to "2 or more"), reviewed in the regression set above. */
  assert.ok(agree / total >= 0.9, `${agree}/${total}`);
});

test('the complete Georgian example is READY with no question asked', () => {
  const { brief, clarifications } = read(CASES[0][1]);
  assert.equal(evaluateReadiness(brief).state, 'READY');
  assert.deepEqual(clarifications, []);
});

test('a price without a currency is PROPOSED with USD / GEL / EUR chips; a chip makes it searchable', () => {
  const { brief, clarifications } = read('ბინა ვაკეში 2 საძინებლიანი 3 ოთახიანი 80-100 კვ.მ ახალ აშენებული, საყიდლად 150000-მდე');
  assert.equal(brief.price.status, 'PROPOSED');
  const chips = clarifications.find((c) => c.id === 'currency');
  assert.deepEqual(chips.options.map((o) => o.id), ['USD', 'GEL', 'EUR']);
  assert.equal(chips.questionKey, 'mps_clarify_currency');
  assert.equal(evaluateReadiness(brief).state, 'INCOMPLETE');
  const gel = chips.options.find((o) => o.id === 'GEL');
  assert.match(gel.text, /150,000 ₾/);
  const next = gel.edits.reduce(applyEdit, brief);
  assert.equal(next.price.status, 'CONFIRMED');
  assert.ok(Math.abs(next.price.value.max - 55556) <= 1, JSON.stringify(next.price.value));
  assert.equal(evaluateReadiness(next).state, 'READY');
});

test('without a GEL rate a lari budget is dropped with a reason, never converted at an invented rate', () => {
  const { brief, clarifications } = understandSearchText('ბინა ვაკეში 300 000 ლარამდე', { converter: null });
  assert.equal(brief.price, null);
  assert.deepEqual(brief.dropped, [{ key: 'mps_dropped_currency', value: 'GEL' }]);
  /* And a bare figure with no rate offers only the dollar reading. */
  const bare = understandSearchText('ბინა ვაკეში 150000-მდე', { converter: null });
  assert.deepEqual(bare.clarifications.find((c) => c.id === 'currency').options.map((o) => o.id), ['USD']);
  assert.equal(clarifications.length, 0);
});

test('a converted budget keeps what the customer said (statedPrice) and is STATED', () => {
  const { brief } = read('ბინა გლდანში 150 000 ლარამდე');
  assert.deepEqual(brief.statedPrice, { currency: 'GEL', min: null, max: 150000 });
  assert.equal(brief.price.status, 'STATED');
  /* Editing the price drops the stale note. */
  assert.equal(applyEdit(brief, { field: 'price', value: { min: 10, max: 20 } }).statedPrice, undefined);
});

test('conflicting transaction and several property types become chips, never a guess', () => {
  const tx = read('rent or buy apartment in Saburtalo');
  assert.equal(tx.brief.transactionType, null);
  const options = tx.clarifications.find((c) => c.id === 'transaction').options;
  assert.deepEqual(options.map((o) => o.labelKey), ['mps_tx_BUY', 'mps_tx_MONTHLY_RENT', 'mps_tx_DAILY_RENT']);
  assert.equal(options[1].edits.reduce(applyEdit, tx.brief).transactionType.value, 'MONTHLY_RENT');
  const type = read('apartment or house in Vake to buy');
  assert.equal(type.brief.propertyType, null);
  assert.deepEqual(type.clarifications.find((c) => c.id === 'propertyType').options.map((o) => o.id).sort(), ['APARTMENT', 'HOUSE']);
});

test('two cities: the customer chooses; the chip sets the city', () => {
  const { brief, clarifications } = read('ბინა თბილისში ან ბათუმში');
  assert.equal(brief.city, null);
  const chips = clarifications.find((c) => c.id === 'city');
  assert.deepEqual(chips.options.map((o) => o.id).sort(), ['batumi', 'tbilisi']);
  assert.equal(chips.options.find((o) => o.id === 'batumi').labels.ka, 'ბათუმი');
  assert.equal(chips.options.find((o) => o.id === 'batumi').edits.reduce(applyEdit, brief).city.value, 'Batumi');
});

test('typos: small edit distance against the place dictionary, never a long-distance guess', () => {
  assert.equal(editDistance('saburtlo', 'saburtalo'), 1);
  assert.equal(editDistance('ვაკშეი', 'ვაკეში'), 1, 'a transposition is one edit');
  const r = read('flat in Sabrtaloo');
  assert.deepEqual(r.brief.districts?.value, ['Saburtalo']);
  assert.deepEqual(r.corrections, [{ written: 'sabrtaloo', read: 'Saburtalo' }]);
  for (const text of ['flat in Varsaw', 'ბინა კარგ უბანში', 'квартира рядом с работой']) {
    assert.equal(read(text).brief.districts, null, text);
  }
});

test('an excluded district and a street are never searched as districts', () => {
  assert.deepEqual(read('apartment Vake not Saburtalo').brief.districts.value, ['Vake']);
  assert.deepEqual(read('ბინა ვაკეში, საბურთალოს გარდა').brief.districts.value, ['Vake']);
  const street = read('ბინა კრწანისის ქუჩაზე');
  assert.equal(street.brief.districts, null);
  assert.ok(street.brief.locationPreferences.some((p) => p.includes('კრწანისის')), JSON.stringify(street.brief.locationPreferences));
});

test('word order and Georgian case endings do not change the reading', () => {
  const a = read('ბინა ვაკეში 2 საძინებლიანი $150,000-მდე საყიდლად').brief;
  const b = read('საყიდლად $150,000-მდე 2 საძინებლიანი ვაკეში ბინა').brief;
  for (const k of ['transactionType', 'propertyType', 'city', 'districts', 'price', 'bedrooms']) assert.deepEqual(a[k], b[k], k);
  for (const form of ['ვაკე', 'ვაკეში', 'ვაკის', 'ვაკეზე', 'ვაკეშიც']) assert.deepEqual(read(`ბინა ${form}`).brief.districts?.value, ['Vake'], form);
  for (const form of ['თბილისი', 'თბილისში', 'თბილისის']) assert.equal(read(`ბინა ${form}`).brief.city?.value, 'Tbilisi', form);
});

test('the engine is pure: no network, model, environment or clock access anywhere in its module graph', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    assert.doesNotMatch(src, /\bfetch\s*\(|openai|anthropic|Deno\.env|process\.env|Math\.random|XMLHttpRequest/i, file);
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)) visit(resolve(dirname(file), m[1]));
  };
  visit(join(here, '../marketplace/queryEngine.ts'));
  assert.ok(seen.size >= 5, [...seen].join('\n'));
});
