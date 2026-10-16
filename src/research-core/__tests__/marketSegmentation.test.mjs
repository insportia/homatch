// MARKET SEGMENTATION — a property is placed in ITS OWN local market.
//
// Policy tests run the pure module; the parity tests then read the SQL
// migration that mirrors it, so the TS planner path and the SQL admin path
// cannot drift apart silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  classifySegment, buyerSegmentCompatibility, DEFAULT_SEGMENT_RULES, percentileCont, midRank,
  segmentConfidence, placeKey, streetKey, transactionKey, typeFamily, normaliseSegmentRules,
} from '../market/segmentation.ts';
import { StaticRateConverter } from '../normalize/currency.ts';

const SQL = readFileSync(new URL('../../../supabase/migrations/20261024100000_market_segmentation.sql', import.meta.url), 'utf8');

/** n comparables in one place, ppsqm 1000, 1100, … (USD, 100 m²). */
function listings(n, place = {}, extra = {}) {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${place.tag ?? ''}${i}`,
    dedupeKey: `myhome:${place.tag ?? ''}${i}`,
    transaction: 'SALE', propertyType: 'APARTMENT', currency: 'USD',
    price: (1000 + i * 100) * 100, areaSqm: 100,
    city: 'თბილისი', district: 'ვაკე', ...place, ...extra,
  }));
}
const subjectAt = (ppsqm, extra = {}) => ({
  id: 'subject', transaction: 'SALE', propertyType: 'APARTMENT', currency: 'USD',
  price: ppsqm * 100, areaSqm: 100, city: 'Tbilisi', district: 'Vake', ...extra,
});

test('percentile_cont and mid-rank behave like Postgres', () => {
  const v = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
  assert.equal(percentileCont(v, 0.5), 5.5);
  assert.equal(Math.round(percentileCont(v, 0.3) * 100) / 100, 3.7);
  assert.equal(Math.round(percentileCont(v, 0.7) * 100) / 100, 7.3);
  assert.equal(midRank(v, 5), 0.45);
});

test('keys fold scripts, street suffixes and transaction synonyms', () => {
  assert.equal(placeKey('თბილისი'), 'tbilisi');
  assert.equal(placeKey(' Tbilisi '), 'tbilisi');
  assert.equal(placeKey('Ваке'), 'vake');
  assert.equal(streetKey('კრწანისის ქ. 16'), 'კრწანისის');
  assert.equal(streetKey('Chavchavadze Ave. 12a'), 'chavchavadze');
  assert.equal(streetKey('ул. Пекина 5'), 'пекина');
  assert.equal(transactionKey('BUY'), 'SALE');
  assert.equal(transactionKey('rent'), 'RENT');
  assert.equal(typeFamily('PENTHOUSE'), 'APARTMENT');
  assert.equal(typeFamily('VILLA'), 'HOUSE');
});

test('district level: premium, middle and economy against the local distribution', () => {
  const comps = listings(10); // 1000..1900 USD/m², p30 = 1270, p70 = 1630
  const premium = classifySegment(subjectAt(1700), comps);
  assert.equal(premium.segment, 'PREMIUM');
  assert.equal(premium.level, 'DISTRICT');
  assert.equal(premium.sampleSize, 10);
  assert.equal(premium.thresholds.economyMax, 1270);
  assert.equal(premium.thresholds.premiumMin, 1630);
  assert.equal(premium.basis.priceKind, 'ASKING');
  assert.equal(classifySegment(subjectAt(1450), comps).segment, 'MIDDLE');
  assert.equal(classifySegment(subjectAt(1100), comps).segment, 'ECONOMY');
});

test('falls back street → neighbourhood → district → city only when a level is thin', () => {
  const street = listings(8, { tag: 's', street: 'ჭავჭავაძის გამზ. 1' });
  const districtOnly = listings(4, { tag: 'd' });
  const otherDistrict = listings(20, { tag: 'o', district: 'საბურთალო' });
  const all = [...street, ...districtOnly, ...otherDistrict];

  const onStreet = classifySegment(subjectAt(1500, { street: 'ჭავჭავაძის გამზ. 37' }), all);
  assert.equal(onStreet.level, 'STREET');
  assert.equal(onStreet.sampleSize, 8);

  const elsewhere = classifySegment(subjectAt(1500, { street: 'Unknown lane 3', neighborhood: 'Lisi Lake' }), all);
  assert.deepEqual(elsewhere.basis.levelsTried.map((l) => [l.level, l.sampleSize, l.sufficient]), [
    ['STREET', 0, false], ['NEIGHBORHOOD', 0, false], ['DISTRICT', 12, true],
  ]);
  assert.equal(elsewhere.level, 'DISTRICT');

  const noDistrict = classifySegment(subjectAt(1500, { district: 'Gldani' }), all);
  assert.equal(noDistrict.level, 'CITY');
  assert.equal(noDistrict.sampleSize, 32);
  assert.equal(noDistrict.confidence, segmentConfidence(32, noDistrict.basis.dispersion, 'CITY', 8));
});

test('UNKNOWN on thin data, missing price, or a level the rules exclude', () => {
  const thin = classifySegment(subjectAt(1500), listings(7));
  assert.equal(thin.segment, 'UNKNOWN');
  assert.equal(thin.basis.reason, 'INSUFFICIENT_COMPARABLES');
  assert.equal(thin.confidence, 0);
  assert.equal(classifySegment(subjectAt(1500, { price: null, areaSqm: null }), listings(20)).basis.reason, 'SUBJECT_NO_PRICE_PER_SQM');
  const cityOnly = classifySegment(subjectAt(1500, { district: 'Gldani' }), listings(20), { levels: ['DISTRICT'] });
  assert.equal(cityOnly.segment, 'UNKNOWN');
  const lowerMin = classifySegment(subjectAt(1300), listings(7), { minComparables: 5 });
  assert.equal(lowerMin.segment, 'MIDDLE');
});

test('currency is normalised through an explicit rate, never at parity', () => {
  const gel = listings(10, {}, { currency: 'GEL' }).map((c) => ({ ...c, price: c.price * 2.7 }));
  const noRate = classifySegment(subjectAt(1500), gel);
  assert.equal(noRate.segment, 'UNKNOWN');
  assert.equal(noRate.basis.excluded.noRate, 10);

  const converter = new StaticRateConverter({ USD_GEL: 2.7 });
  const converted = classifySegment(subjectAt(1700), gel, null, { converter });
  assert.equal(converted.segment, 'PREMIUM');
  assert.equal(Math.round(converted.thresholds.premiumMin), 1630);

  const gelSubject = classifySegment(subjectAt(1700 * 2.7, { currency: 'GEL' }), listings(10), null, { converter });
  assert.equal(gelSubject.segment, 'PREMIUM');
  assert.equal(classifySegment(subjectAt(1700 * 2.7, { currency: 'GEL' }), listings(10)).basis.reason, 'SUBJECT_NO_FX_RATE');
});

test('SALE and RENT are separate markets, and so are property type families', () => {
  const rents = listings(10, {}, { transaction: 'RENT' }).map((c) => ({ ...c, price: c.price / 100 }));
  const sales = listings(10);
  const rentSubject = classifySegment(subjectAt(17, { transaction: 'RENT' }), [...rents, ...sales]);
  assert.equal(rentSubject.sampleSize, 10);
  assert.equal(rentSubject.segment, 'PREMIUM');
  assert.equal(rentSubject.basis.excluded.otherMarket, 10);
  const house = classifySegment(subjectAt(1500, { propertyType: 'HOUSE' }), sales);
  assert.equal(house.segment, 'UNKNOWN');
});

test('duplicates and the subject itself never count as comparables', () => {
  const comps = listings(8);
  const dupes = [...comps, ...comps.map((c) => ({ ...c, id: `${c.id}-copy` })), { ...subjectAt(1500) }];
  const r = classifySegment(subjectAt(1500), dupes);
  assert.equal(r.sampleSize, 8);
  assert.equal(r.basis.excluded.duplicates, 8);
});

test('confidence rises with sample size and falls with dispersion', () => {
  assert.equal(segmentConfidence(24, 0.2, 'STREET', 8), 1);
  assert.equal(segmentConfidence(8, 0.2, 'STREET', 8), 0.333);
  assert.equal(segmentConfidence(24, 0.75, 'DISTRICT', 8), 0.34);
  assert.equal(segmentConfidence(24, 0.5, 'CITY', 8), 0.49);
});

test('a buyer can be compatible with several segments, and only from a stated budget', () => {
  const t = { economyMax: 1270, premiumMin: 1630, median: 1450, currency: 'USD' };
  assert.deepEqual(buyerSegmentCompatibility({ budgetMax: 120000, areaMin: 80, areaMax: 100 }, t).segments, ['ECONOMY', 'MIDDLE']);
  assert.deepEqual(buyerSegmentCompatibility({ budgetMin: 150000, budgetMax: 200000, areaMin: 80, areaMax: 100 }, t).segments, ['MIDDLE', 'PREMIUM']);
  assert.deepEqual(buyerSegmentCompatibility({ budgetMax: 100000, areaMin: 90 }, t).segments, ['ECONOMY']);
  const none = buyerSegmentCompatibility({ areaMin: 80 }, t);
  assert.deepEqual(none.segments, []);
  assert.equal(none.reason, 'NO_STATED_BUDGET');
  assert.equal(none.budgetConfirmed, false);
  assert.equal(buyerSegmentCompatibility({ budgetMax: 200000 }, t).reason, 'NO_STATED_AREA');
  assert.equal(buyerSegmentCompatibility({ budgetMax: 540000, currency: 'GEL', areaMin: 100 }, t).reason, 'BUDGET_NO_FX_RATE');
  const gel = buyerSegmentCompatibility({ budgetMax: 540000, currency: 'GEL', areaMin: 100 }, t,
    { converter: new StaticRateConverter({ USD_GEL: 2.7 }) });
  assert.deepEqual(gel.segments, ['ECONOMY', 'MIDDLE', 'PREMIUM']);
});

test('rules are validated: bad percentiles and unknown levels fall back to defaults', () => {
  const r = normaliseSegmentRules({ economyPercentile: 0.8, premiumPercentile: 0.2, levels: ['DISTRICT', 'MOON'], minComparables: 1 });
  assert.equal(r.economyPercentile, 0.3);
  assert.equal(r.premiumPercentile, 0.7);
  assert.deepEqual(r.levels, ['DISTRICT']);
  assert.equal(r.minComparables, 3);
});

/* ── SQL parity ─────────────────────────────────────────────────────── */

test('parity: the tests/sql/buyer_intelligence.sql fixture gives the same answers in TS', () => {
  // Mirrors that fixture: L1..L9 (L0 is property F2), two GEL rows with no rate.
  const ls = listings(10).slice(1);
  const gel = [{ dedupeKey: 'ss:G1', transaction: 'BUY', propertyType: 'APARTMENT', currency: 'GEL', price: 400000, areaSqm: 100, city: 'თბილისი', district: 'ვაკე' }];
  const f1 = { id: 'f1', transaction: 'SALE', propertyType: 'APARTMENT', currency: 'USD', price: 170000, areaSqm: 100, city: 'Tbilisi', district: 'Vake' };
  const f2 = { id: 'f2', transaction: 'SALE', propertyType: 'PENTHOUSE', currency: 'USD', price: 110000, areaSqm: 100, city: 'თბილისი', district: 'Ваке' };
  const all = [...ls, ...gel, f1, f2];
  const r1 = classifySegment(f1, all);
  const r2 = classifySegment(f2, all);
  assert.equal(r1.segment, 'PREMIUM');
  assert.equal(r1.sampleSize, 10);
  assert.equal(r1.thresholds.premiumMin, 1630);
  assert.equal(r2.segment, 'ECONOMY');
  assert.equal(r2.thresholds.economyMax, 1370);
  assert.equal(r1.basis.excluded.noRate, 1);
});

test('parity: the seeded ACTIVE rule equals DEFAULT_SEGMENT_RULES', () => {
  const m = SQL.match(/-- DEFAULT_RULE_PARAMS\s*\n\s*'(\{[^']+\})'::jsonb/);
  assert.ok(m, 'seed rule params not found');
  const seeded = JSON.parse(m[1]);
  assert.deepEqual(seeded, { ...DEFAULT_SEGMENT_RULES, levels: [...DEFAULT_SEGMENT_RULES.levels] });
});

test('parity: SQL uses the same statistics and confidence constants', () => {
  assert.match(SQL, /percentile_cont\(v_econ\) within group/);
  assert.match(SQL, /percentile_cont\(v_prem\) within group/);
  assert.match(SQL, /stddev_pop\(/);
  assert.match(SQL, /least\(1\.0, p_n::numeric \/ greatest\(1, 3 \* p_min\)\)/);
  assert.match(SQL, /when 'STREET' then 1\.0 when 'NEIGHBORHOOD' then 0\.95 when 'DISTRICT' then 0\.85 else 0\.7/);
  assert.match(SQL, /when v_cv <= 0\.25 then 1\.0 when v_cv >= 0\.75 then 0\.4/);
  assert.match(SQL, /public\.fx_to_usd\(/, 'SQL must convert through fx_to_usd, never at parity');
});

test('parity: SQL street words and place aliases match the TS vocabulary', () => {
  const ts = readFileSync(new URL('../market/segmentation.ts', import.meta.url), 'utf8');
  const tsWords = [...ts.match(/const STREET_WORDS = new Set\(\[([\s\S]*?)\]\)/)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  const sqlWords = [...SQL.match(/-- STREET_WORDS\s*\n\s*array\[([\s\S]*?)\]/)[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  assert.deepEqual(sqlWords, tsWords);

  const placeSrc = readFileSync(new URL('../normalize/place.ts', import.meta.url), 'utf8');
  const rows = [...placeSrc.match(/const PLACES[^=]*=\s*\[([\s\S]*?)\n\];/)[1].matchAll(/\[([^\]]+)\]/g)]
    .map((r) => [...r[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  assert.ok(rows.length >= 20);
  for (const row of rows) {
    for (const alias of row) {
      assert.ok(SQL.includes(`('${alias}', '${row[0]}')`), `alias ${alias} → ${row[0]} missing from the SQL place table`);
    }
  }
});
