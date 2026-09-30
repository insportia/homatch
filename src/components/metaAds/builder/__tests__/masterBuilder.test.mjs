// The Meta Ads master builder: housing lock, advice severities, funding
// disclosure, and every mm_b_ key backed by six real translations.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isHousingCampaign, adviceBlocks, adviceTone, isBlocking, groupAdvice, depositAmountCents, addLocation, destinationForGoal,
  strategyExplanationKeys, STRATEGY_REASON_CODES, TARGETING_ADJUSTMENT_CODES, PLAN_ISSUE_CODES, ADVICE_CODES, LEAD_FORM_ISSUE_CODES,
} from '../masterLogic.ts';
import { META_MASTER_BUILDER_STRINGS as S } from '../../../../../scripts/meta-master-builder-i18n-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const B = 'src/components/metaAds/builder';
const SOURCES = [
  'src/pages/outreach/MetaAdsCreatePage.tsx',
  ...fs.readdirSync(path.join(ROOT, B)).filter((f) => /\.(tsx?|mjs)$/.test(f)).map((f) => `${B}/${f}`),
];

test('housing: property ads lock ages and gender, with the calm explanation', () => {
  assert.equal(isHousingCampaign({ property_id: '123456', offer: null }), true);
  assert.equal(isHousingCampaign({ property_id: null, offer: { isProperty: true, dealKind: 'RENT_LONG' } }), true);
  assert.equal(isHousingCampaign({ property_id: null, offer: { isProperty: false, dealKind: 'OTHER' } }), false);
  assert.equal(isHousingCampaign({ property_id: null, offer: { isProperty: true, dealKind: 'COMMERCIAL' } }), false);
  assert.equal(isHousingCampaign({ property_id: null, offer: null, special_ad_categories: ['HOUSING'] }), true);

  const aud = read(`${B}/AudienceStep.tsx`);
  assert.match(aud, /\{housing && \(\s*<div data-mm-housing-lock=""[\s\S]*?t\('mm_b_housing_lock'\)/);
  assert.match(aud, /<fieldset className="min-w-0" disabled=\{housing\}>/, 'ages are locked for housing');
  assert.match(aud, /disabled=\{housing\} onClick=\{\(\) => save\(\{ gender: g \}\)\}/, 'gender is locked for housing');
  assert.match(aud, /mm_b_housing_radius_note/);
  assert.match(S.mm_b_housing_lock[0], /18–65\+/);
  assert.match(S.mm_b_housing_lock[0], /HOMATCH handles the technical targeting/);
});

test('only BLOCKING_ERROR blocks; INFO is neutral, RECOMMENDATION and WARNING are amber', () => {
  for (const sev of ['INFO', 'RECOMMENDATION', 'WARNING']) {
    assert.equal(adviceBlocks([{ severity: sev, code: 'X' }]), false, `${sev} never blocks`);
    assert.equal(isBlocking({ severity: sev }), false);
  }
  assert.equal(adviceBlocks([{ severity: 'INFO', code: 'X' }, { severity: 'BLOCKING_ERROR', code: 'Y' }]), true);
  assert.deepEqual(['INFO', 'RECOMMENDATION', 'WARNING', 'BLOCKING_ERROR'].map(adviceTone), ['neutral', 'amber', 'amber', 'red']);

  const g = groupAdvice([
    { severity: 'INFO', code: 'STRONGEST_CREATIVES_RUN_FIRST' },
    { severity: 'RECOMMENDATION', code: 'MEDIA_RESOLUTION_LOW', creativeId: 'a' },
    { severity: 'BLOCKING_ERROR', code: 'HEADLINE_REQUIRED', creativeId: 'a' },
  ]);
  assert.equal(g.general.length, 1);
  assert.equal(g.byCreative.get('a')[0].severity, 'BLOCKING_ERROR', 'blocking first');

  const logic = read(`${B}/masterLogic.ts`);
  assert.match(logic, /export const BLOCKING_SEVERITY: AdviceSeverity = 'BLOCKING_ERROR';/);
  assert.match(logic, /export const isBlocking = \(a: \{ severity: string \}\) => a\.severity === BLOCKING_SEVERITY;/);
  const page = read('src/pages/outreach/MetaAdsCreatePage.tsx');
  assert.match(page, /const creativeBlocked = adviceBlocks\(advice\);/);
  assert.match(page, /disabled=\{step === 'creative' && creativeBlocked\}/, 'Continue is held only by blocking creative advice');
  assert.ok(!/disabled=\{[^}]*'(WARNING|RECOMMENDATION|INFO)'/.test(page), 'no other severity disables anything');
});

test('the funding card renders the disclosure, and the copy never says refunded', () => {
  const card = read(`${B}/FundingCard.tsx`);
  assert.match(card, /<p data-mm-disclosure=""[^>]*>[\s\S]*?\{t\('mm_b_funding_disclosure'\)\}/);
  // Rendered unconditionally: it is outside the {!funding ? … : …} branch.
  const tail = card.slice(card.lastIndexOf(')}', card.indexOf('data-mm-disclosure')));
  assert.ok(tail.includes('mm_b_funding_disclosure'));
  assert.match(card, /depositCheckout\(addCents\)/);
  assert.match(card, /depositAmountCents\(funding\.shortfallCents\)/);
  assert.ok(!/feePercent\s*\/\s*100|\*\s*0\.09/.test(card), 'no fee math in the browser');
  for (const f of ['BudgetStep.tsx', 'ReviewStep.tsx']) assert.match(read(`${B}/${f}`), /<FundingCard funding=\{strategy\?\.funding \?\? null\}/);

  const [en] = S.mm_b_funding_disclosure;
  assert.match(en, /non-refundable to cash/);
  assert.match(en, /stays in your HOMATCH balance/);
  assert.match(en, /Released to HOMATCH Balance/);
  for (const [k, v] of Object.entries(S)) {
    assert.ok(!/\brefunded\b|\brefund\b/i.test(v[0]), `${k} never says refund`);
    assert.ok(!/შესატყვისი/.test(v[1]), `${k}: match is დამთხვევა`);
    assert.ok(!/confirmed buyer/i.test(v[0]), `${k}: never "confirmed buyer"`);
  }

  assert.equal(depositAmountCents(0), 0);
  assert.equal(depositAmountCents(1), 500, 'never under the minimum');
  assert.equal(depositAmountCents(900), 900);
  assert.equal(depositAmountCents(901), 1000, 'rounded up to a whole unit');
});

test('strategy copy is built only from codes the server sent', () => {
  const strategy = read('src/lib/metaAds/strategy.ts');
  const union = strategy.slice(strategy.indexOf('export type StrategyReason ='), strategy.indexOf(';', strategy.indexOf('export type StrategyReason =')));
  const declared = [...union.matchAll(/'([A-Z_]+)'/g)].map((m) => m[1]).sort();
  assert.deepEqual([...STRATEGY_REASON_CODES].sort(), declared, 'one sentence per StrategyReason');
  assert.deepEqual(strategyExplanationKeys(['SINGLE_CREATIVE', 'INVENTED_CODE'], ['HOUSING_ALL_GENDERS', 'NOPE']),
    ['mm_b_reason_SINGLE_CREATIVE', 'mm_b_adj_HOUSING_ALL_GENDERS']);
  assert.deepEqual(strategyExplanationKeys([], []), []);
  const card = read(`${B}/StrategyCard.tsx`);
  assert.match(card, /strategyExplanationKeys\(s\.reasonCodes,/);

  // Every advice code creativeAdvice() and checkMedia() can emit has copy.
  const adv = read('src/lib/metaAds/creativeAdvice.ts');
  const pay = read('src/lib/metaAds/payload.ts');
  const emitted = new Set([
    ...[...adv.matchAll(/code: '([A-Z_]+)'/g)].map((m) => m[1]),
    ...[...pay.matchAll(/'(media_[a-z_]+)'/g)].map((m) => m[1].toUpperCase()),
  ]);
  for (const c of emitted) assert.ok(ADVICE_CODES.includes(c), `advice code ${c} is explained`);
});

test('locations: a place inside a chosen country replaces it, and back', () => {
  const ge = { type: 'country', key: 'GE', name: 'Georgia', countryCode: 'GE' };
  const tbs = { type: 'city', key: '1234', name: 'Tbilisi', countryCode: 'GE', radiusKm: 25 };
  let r = addLocation([ge], tbs);
  assert.deepEqual(r.list.map((l) => l.key), ['1234']);
  assert.deepEqual(r.replaced, ['Georgia']);
  r = addLocation(r.list, ge);
  assert.deepEqual(r.list.map((l) => l.key), ['GE']);
  assert.equal(addLocation([ge], ge).list.length, 1, 'no duplicates');
});

test('MESSAGES gets a messaging destination, from the goal step and from a pre-login draft', () => {
  assert.deepEqual(destinationForGoal('MESSAGES', null, true), { type: 'MESSAGING', messagingApp: 'MESSENGER' });
  assert.deepEqual(destinationForGoal('MESSAGES', { type: 'MESSAGING', messagingApp: 'WHATSAPP' }, true), { type: 'MESSAGING', messagingApp: 'WHATSAPP' });
  assert.deepEqual(destinationForGoal('LEADS_ON_META', null, false), { type: 'META_FORM', formId: null });
  const page = read('src/pages/outreach/MetaAdsCreatePage.tsx');
  assert.match(page, /destination: destinationForGoal\(local\?\.goal \?\? 'LEADS_ON_META', null, false\)/);
  assert.match(page, /destination: destinationForGoal\(g, campaign\.destination, !!page\)/);
  assert.match(page, /\(status\?\.settings\.goalsEnabled \?\? \[\]\)\.includes\(g\)/, 'MESSAGES is offered when the account enables it');
});

test('every mm_b_ key used exists with six non-empty values and matching placeholders', () => {
  const EXPAND = {
    mm_b_reason_: STRATEGY_REASON_CODES, mm_b_adj_: TARGETING_ADJUSTMENT_CODES, mm_b_issue_: PLAN_ISSUE_CODES,
    mm_b_adv_: ADVICE_CODES, mm_b_lf_issue_: LEAD_FORM_ISSUE_CODES, mm_b_gender_: ['ALL', 'FEMALE', 'MALE'],
    mm_b_loc_kind_: ['country', 'region', 'city'], mm_b_loc_ph_: ['country', 'region', 'city'],
    mm_b_sev_: ['INFO', 'RECOMMENDATION', 'WARNING', 'BLOCKING_ERROR'],
  };
  const used = new Set();
  for (const f of SOURCES) {
    const src = read(f);
    for (const m of src.matchAll(/mm_b_[A-Za-z0-9_]*/g)) {
      const key = m[0];
      if (src.slice(m.index + key.length, m.index + key.length + 2) === '${') {
        assert.ok(EXPAND[key], `${f}: templated key prefix ${key} has a known expansion`);
        for (const c of EXPAND[key]) used.add(`${key}${c}`);
      } else if (!key.endsWith('_')) {
        used.add(key);
      }
    }
  }
  for (const [prefix, codes] of Object.entries(EXPAND)) for (const c of codes) used.add(`${prefix}${c}`);
  used.add('mm_b_issue_OTHER'); used.add('mm_b_adv_OTHER'); used.add('mm_b_lf_issue_OTHER');
  assert.ok(used.size > 100);
  const holes = (s) => [...s.matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort().join(',');
  for (const key of used) {
    const v = S[key];
    assert.ok(Array.isArray(v) && v.length === 6, `${key} exists with six locales`);
    v.forEach((x, i) => assert.ok(typeof x === 'string' && x.trim().length > 0, `${key}[${i}] non-empty`));
    v.forEach((x, i) => assert.equal(holes(x), holes(v[0]), `${key}[${i}] placeholders match English`));
  }
  for (const key of Object.keys(S)) assert.ok(key.startsWith('mm_b_'), `${key} is in the mm_b_ namespace`);
});
