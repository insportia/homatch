// HOMATCH Verify final polish: the curated market comparables and the plain
// explanation when the evidence is insufficient (job 8ba97da9, flat N601,
// Krtsanisi St. 6, 94.10 m²). Rebuild-safe: the stored .601 market shape,
// as persisted before this change, renders the new view without re-synthesis.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { COMPARABLES, reportWith } from './fixtures/krtsanisiMarketFixture.mjs';
import { buildIntelligenceBundle } from '../intelligence/bundle.ts';
import { buildEvidencePackage } from '../intelligence/evidencePackage.ts';
import { marketView, differencesFromSubject, insufficiencyOf, MAX_COMPARABLES } from '../marketPresentation.ts';
import { VERIFY_FINAL_MARKET_STRINGS } from '../../../scripts/verify-final-market-i18n-data.mjs';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
const EXCLUDED = ['დიდი დიღომი', 'საბურთალო', 'გლდანი', 'ვარკეთილი', 'Didi Dighomi', 'Saburtalo', 'Gldani', 'Varketili'];

/* The .601 synthesis_json.market as stored in production (2026-10-11), trimmed to what the view reads. */
const STORED_601 = {
  currency: 'USD',
  subjectArea: 94.1,
  headline: { state: 'EVIDENCE_LIMITED', count: 1, minimumSample: 3 },
  valuation: {
    state: 'INSUFFICIENT_EVIDENCE', currency: 'USD', sizeBand: { min: 61.2, max: 127 }, localOnly: true, levelsUsed: [],
    priceBasis: null, reasonCode: 'TOO_FEW_DEFENSIBLE_COMPARABLES', pricePerSqm: null, usedComparables: 0, minimumComparables: 3, defensibleComparables: 1,
  },
  hierarchy: {
    levelCounts: { 1: 0, 2: 0, 3: 1, 4: 0, 5: 0 },
    excluded: { STALE: 1, DISTRICT_UNKNOWN: 5, SIZE_OUT_OF_BAND: 22, UNRELATED_DISTRICT: 42 },
    comparables: [{
      url: 'https://home.ss.ge/ka/real-estate/iyideba-3-otaxiani-bina-ortatchalashi-35448687', area: 127, flags: ['LISTING_DATE_UNKNOWN', 'ASKING_NOT_TRANSACTION'],
      level: 3, rooms: 3, reason: 'SAME_STREET', source: 'საჯარო განცხადება', address: 'კრწანისის ქ., ორთაჭალა, თბილისი', currency: 'USD', dealType: 'SALE',
      district: 'ORTACHALA', levelKey: 'SAME_STREET', freshness: 'UNDATED', priceKind: 'ASKING', totalPrice: 440000, pricePerSqm: 3465, valuationUse: false,
    }],
  },
  ranked: [],
  tiers: [],
};

test('stored .601 market: one curated Krtsanisi St. comparable, with address, area, price, total and differences', () => {
  const v = marketView(STORED_601);
  assert.equal(v.headline.state, 'EVIDENCE_LIMITED');
  assert.equal(v.comparables.length, 1);
  const c = v.comparables[0];
  assert.equal(c.levelKey, 'vfm_level_same_street');
  assert.equal(c.address, 'კრწანისის ქ., ორთაჭალა, თბილისი');
  assert.equal(c.area, 127);
  assert.equal(c.pricePerSqm, 3465);
  assert.equal(c.totalPrice, 440000);
  assert.equal(c.districtKey, 'vrx_area_ortachala');
  assert.equal(c.broader, false);
  assert.equal(c.project, null, 'no project name is invented when the listing did not state one');
  const keys = c.differences.map((d) => d.key);
  assert.deepEqual(c.differences[0], { key: 'vfm_diff_larger', vars: { pct: '35' } });
  for (const k of ['vfm_diff_condition_unknown', 'vfm_diff_status_unconfirmed', 'vfm_diff_undated', 'vfm_diff_asking']) assert.ok(keys.includes(k), k);
  assert.ok(!JSON.stringify(v).includes('home.ss.ge'), 'no listing URL reaches the customer view');
});

test('stored .601 market: insufficient evidence explained, with no valuation number', () => {
  const v = marketView(STORED_601);
  const i = v.insufficiency;
  assert.deepEqual(
    { have: i.have, need: i.need, other: i.otherDistricts, size: i.sizeOutOfBand, band: i.sizeBand, area: i.subjectAreaKnown },
    { have: 1, need: 3, other: 47, size: 22, band: { min: 61.2, max: 127 }, area: true },
  );
  assert.deepEqual(i.missingKeys, ['vfm_missing_local', 'vfm_missing_size', 'vfm_missing_other_districts', 'vfm_missing_transactions']);
  assert.deepEqual(i.nextStepKeys, ['vfm_next_same_project', 'vfm_next_same_street', 'vfm_next_registered_sales', 'vfm_next_developer_prices']);
  // The explanation is counts and steps; it carries no price.
  assert.ok(!/3465|pricePerSqm|median/.test(JSON.stringify(i)));
  // An ESTIMATE has no insufficiency block.
  assert.equal(insufficiencyOf({ valuation: { state: 'ESTIMATE' } }), null);
  // Unknown subject area is named as missing.
  const noArea = insufficiencyOf({ valuation: { state: 'INSUFFICIENT_EVIDENCE', defensibleComparables: 0, minimumComparables: 3 }, hierarchy: { excluded: {} } });
  assert.ok(noArea.missingKeys.includes('vfm_missing_area') && noArea.nextStepKeys.includes('vfm_next_subject_area'));
});

test('rebuilt from the run: hierarchy order, at most six, project/floor/condition carried, no excluded district', () => {
  const report = reportWith(COMPARABLES);
  const pkg = buildEvidencePackage(report);
  const m = buildIntelligenceBundle(report, pkg).market;
  const v = marketView(m);
  assert.ok(v.comparables.length >= 1 && v.comparables.length <= MAX_COMPARABLES);
  const levels = m.hierarchy.comparables.map((c) => c.level);
  assert.deepEqual(levels, [...levels].sort((a, b) => a - b), 'hierarchy order');
  for (const c of v.comparables) {
    assert.ok(!EXCLUDED.some((d) => String(c.address ?? '').includes(d)), c.address);
    assert.ok(c.levelKey && c.levelKey.startsWith('vfm_level_'));
  }
  for (const c of m.hierarchy.comparables) assert.ok(['ACTIVE', 'EXPIRED', 'UNKNOWN'].includes(c.state));
  assert.equal(v.insufficiency?.have, m.valuation.defensibleComparables);
});

test('differences: size within 5% is similar; condition rungs compare against the subject', () => {
  assert.deepEqual(differencesFromSubject({ area: 96, state: 'ACTIVE', priceKind: 'TRANSACTION', condition: 'WHITE_FRAME' }, { area: 94.1, condition: 'WHITE_FRAME' }), [{ key: 'vfm_diff_size_similar' }]);
  assert.deepEqual(
    differencesFromSubject({ area: 80, state: 'EXPIRED', priceKind: 'ASKING', condition: 'NEWLY_RENOVATED', freshness: 'FRESH' }, { area: 94.1, condition: 'WHITE_FRAME' }).map((d) => d.key),
    ['vfm_diff_smaller', 'vfm_diff_better_condition', 'vfm_diff_not_active', 'vfm_diff_asking'],
  );
});

test('a level-5 listing is labelled orientation-only; a rent listing never shows', () => {
  const m = {
    ...STORED_601,
    hierarchy: {
      ...STORED_601.hierarchy,
      comparables: [
        { level: 5, pricePerSqm: 2100, currency: 'USD', dealType: 'SALE', district: 'ORTACHALA', area: 90, project: 'Some Residence', floor: 4, condition: 'WHITE_FRAME', state: 'ACTIVE', listingDate: '2026-09-20T10:00:00Z' },
        { level: 3, pricePerSqm: 20, currency: 'USD', dealType: 'RENT', district: 'ORTACHALA', area: 90 },
      ],
    },
  };
  const v = marketView(m);
  assert.equal(v.comparables.length, 1);
  const c = v.comparables[0];
  assert.equal(c.broader, true);
  assert.equal(c.project, 'Some Residence');
  assert.equal(c.floor, 4);
  assert.equal(c.conditionKey, 'vfm_cond_white_frame');
  assert.equal(c.statusKey, 'vfm_status_active');
  assert.equal(c.listingDate, '2026-09-20');
  assert.equal(c.totalPrice, 189000, 'total computed from price per m² × area when the listing gave none');
});

test('i18n: every vfm key in six locales, placeholders intact, natural Georgian terms, no em dash', () => {
  const src = read('src/components/verify/MarketPosition.tsx') + read('src/verify/marketPresentation.ts');
  const used = new Set([...src.matchAll(/'(vfm_[a-z0-9_]+)'/g)].map((m) => m[1]));
  for (const k of used) assert.ok(VERIFY_FINAL_MARKET_STRINGS[k], `missing copy: ${k}`);
  const bundle = read('src/i18n/translations.ts');
  for (const [k, row] of Object.entries(VERIFY_FINAL_MARKET_STRINGS)) {
    assert.equal(row.length, 6, k);
    const ph = (s) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort().join(',');
    for (const s of row) {
      assert.equal(ph(s), ph(row[0]), `${k}: placeholders`);
      assert.ok(!s.includes('—'), `${k}: em dash`);
    }
    assert.equal((bundle.match(new RegExp(`\\b${k}:`, 'g')) ?? []).length, 6, `${k} not applied to all six locales`);
  }
  assert.ok(!/შესატყვისი/.test(JSON.stringify(VERIFY_FINAL_MARKET_STRINGS)));
  assert.match(VERIFY_FINAL_MARKET_STRINGS.vfm_insufficient_body[1], /ციფრს არ ვასახელებთ/);
});

test('component: the insufficient block replaces the generic note; URLs are never rendered', () => {
  const tsx = read('src/components/verify/MarketPosition.tsx');
  assert.match(tsx, /view\.insufficiency \? \(\s*<Insufficient/);
  assert.ok(!/c\.url|href=\{c\./.test(tsx));
  assert.ok(!/text-\[1[01]px\]/.test(tsx));
  assert.ok(!/\b(ml|mr|pl|pr)-\d/.test(tsx), 'logical properties only (RTL)');
});
