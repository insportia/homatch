// FIND BUYERS 2.0 — smart internal match expansion (owner, 2026-10-18): what the owner reads.
//   * each person carries ONE price: VIP overrides EXACT, otherwise nearby / similar;
//   * "why this match" is built only from the stored evidence, and what is uncertain is said;
//   * a tolerance band reads as a discovery setting, never as purchasing capacity;
//   * every category / kind / confidence / uncertainty key exists in six languages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bandLabels, leadCategory, leadPriceKey, matchReasons, selectionTotals, UNCERTAINTY_CODES } from '../leadSummary.ts';
import { FIND_BUYERS_MATCH_EXPANSION_STRINGS as S } from '../../../scripts/find-buyers-match-expansion-i18n-data.mjs';
import { validate } from '../../../scripts/lib/i18nSplice.mjs';

const t = (k, v = {}) => `${k}${Object.keys(v).length ? `(${Object.entries(v).map(([a, b]) => `${a}=${b}`).join(',')})` : ''}`;
const usd = (n) => `$${n}`;

test('one price per person: VIP overrides EXACT; never stacked', () => {
  assert.equal(leadPriceKey({ segment: 'PREMIUM', category: 'VIP' }), 'PREMIUM');
  assert.equal(leadPriceKey({ segment: 'PREMIUM', category: 'EXACT' }), 'PREMIUM');
  assert.equal(leadPriceKey({ segment: 'STANDARD', category: 'EXACT' }), 'EXACT');
  assert.equal(leadPriceKey({ segment: 'STANDARD', category: 'NEARBY_SIMILAR' }), 'STANDARD');
  assert.equal(leadPriceKey({ segment: 'STANDARD', category: 'NEARBY_SIMILAR', priceKey: 'EXACT' }), 'EXACT', 'the server key wins');
  const items = [
    { matchId: 'a', segment: 'STANDARD', category: 'EXACT', priceKey: 'EXACT', unlocked: false, priceCredits: 5 },
    { matchId: 'b', segment: 'STANDARD', category: 'NEARBY_SIMILAR', priceKey: 'STANDARD', unlocked: false, priceCredits: 3 },
    { matchId: 'c', segment: 'PREMIUM', category: 'VIP', priceKey: 'PREMIUM', unlocked: false, priceCredits: 10 },
    { matchId: 'd', segment: 'STANDARD', category: 'EXACT', priceKey: 'EXACT', unlocked: true, priceCredits: 5 },
  ];
  assert.deepEqual(selectionTotals(items, new Set(['a', 'b', 'c', 'd'])), { standard: 1, exact: 1, premium: 1, already: 1, credits: 18 });
  assert.equal(leadCategory({ segment: 'PREMIUM' }), 'VIP', 'a pre-expansion feed still shows VIP');
  assert.equal(leadCategory({ segment: 'STANDARD' }), null);
});

test('why this match: measured geography, the budget difference, similarities, and the uncertainty', () => {
  const nearby = matchReasons({
    kind: 'NEARBY_AREA',
    explanation: {
      geo: { level: 'NEARBY_AREA', demandPlace: 'Isani', supplyPlace: 'Krtsanisi', km: 1.84, samples: [23, 144], priceLevelRatio: 1.12, streetMentioned: false },
      budget: { verdict: 'ABOVE_MAX_TOLERANCE', outsideBy: 13840, tolerance: 15000, currency: 'USD', flexible: false },
      similarity: { agreed: ['TRANSACTION', 'CITY', 'PROPERTY_TYPE', 'BEDROOMS', 'PRICE'], amenities: { agreed: ['PARKING', 'NOT_A_FEATURE'] } },
      uncertainty: ['ABOVE_MAX', 'SOMETHING_NEW'],
    },
  }, t, usd);
  assert.deepEqual(nearby.reasons, [
    'hl_why_geo_nearby(from=Isani,to=Krtsanisi,km=1.84)',
    'hl_why_geo_measured(a=23,b=144)',
    'hl_why_price_level',
    'hl_why_budget_above(amount=$13840,tolerance=$15000)',
    'hl_why_also(list=hl_dim_transaction, hl_dim_property_type, hl_dim_bedrooms)',
    'hl_why_amenities_ok(list=hl_feature_PARKING)',
  ]);
  assert.deepEqual(nearby.uncertain, ['hl_unc_ABOVE_MAX'], 'unknown codes are left out, never printed raw');
  const exact = matchReasons({ kind: 'EXACT_LOCATION', explanation: { geo: { level: 'EXACT_AREA', demandPlace: 'Krtsanisi', streetMentioned: true }, budget: { verdict: 'WITHIN' } } }, t, usd);
  assert.deepEqual(exact.reasons, ['hl_why_geo_exact(place=Krtsanisi)', 'hl_why_street', 'hl_why_budget_within']);
  assert.deepEqual(matchReasons({ kind: undefined, explanation: undefined }, t, usd), { reasons: [], uncertain: [] });
});

test('the owner\'s tolerance bands read as ranges', () => {
  const bands = [{ upTo: 50000, tolerance: 5000 }, { upTo: 119999, tolerance: 10000 }, { upTo: null, tolerance: 15000 }];
  assert.deepEqual(bandLabels(bands, 'USD', t, usd), [
    'hl_band_upto(max=$50000): ±$5000', '$50001–$119999: ±$10000', 'hl_band_from(min=$120000): ±$15000',
  ]);
});

test('six languages, every dynamic key, Georgian terminology, honest tolerance copy', () => {
  assert.deepEqual(validate(S, 'find-buyers-match-expansion'), []);
  const need = [
    ...['EXACT', 'NEARBY_SIMILAR', 'VIP'].flatMap((c) => [`hl_cat_${c}`, `hl_cat_${c}_desc`, `hl_section_${c}`]),
    ...['HIGH', 'MEDIUM', 'LOW'].map((c) => `hl_conf_${c}`),
    ...['EXACT_LOCATION', 'SAME_AREA_BUDGET_FLEX', 'NEARBY_AREA', 'CITY_WIDE', 'SIMILAR_PROPERTY'].map((k) => `hl_kind_${k}`),
    ...UNCERTAINTY_CODES.map((c) => `hl_unc_${c}`),
    'hl_cta_unlock_exact', 'hl_bulk_exact', 'hl_bulk_summary_tiers', 'im_unlock_contact_from',
  ];
  for (const k of need) {
    assert.ok(S[k], `missing ${k}`);
    assert.equal(S[k].length, 6, `${k} has six languages`);
    assert.ok(S[k].every((v) => typeof v === 'string' && v.trim()), `${k} has no empty language`);
  }
  const all = JSON.stringify(S);
  assert.ok(!all.includes('შესატყვისი'), 'match is დამთხვევა');
  assert.ok(!/confirmed buyer/i.test(all));
  assert.match(S.hl_why_budget_above[0], /not proof/i);
  assert.match(S.hl_reach_budget_hint[0], /not proof/i);
  assert.match(S.hl_why_street[0], /supporting detail only/i, 'a street never makes a match exact');
});
