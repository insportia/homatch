// The Meta Ads master builder: housing lock, advice severities, funding
// disclosure, and every mm_b_ key backed by six real translations.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isHousingCampaign, isNarrowAudience, adviceBlocks, adviceTone, isBlocking, groupAdvice, depositAmountCents, addLocation, destinationForGoal,
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

test('audience: broad is recommended, not forced; only Meta\'s Housing rule fixes ages and gender', () => {
  // The one real restriction: Meta's Housing ad category (property ads).
  assert.equal(isHousingCampaign({ property_id: '123456', offer: null }), true);
  assert.equal(isHousingCampaign({ property_id: null, offer: { isProperty: true, dealKind: 'RENT_LONG' } }), true);
  assert.equal(isHousingCampaign({ property_id: null, offer: { isProperty: false, dealKind: 'OTHER' } }), false);
  assert.equal(isHousingCampaign({ property_id: null, offer: { isProperty: true, dealKind: 'COMMERCIAL' } }), false);
  assert.equal(isHousingCampaign({ property_id: null, offer: null, special_ad_categories: ['HOUSING'] }), true);

  const aud = read(`${B}/AudienceStep.tsx`);
  // No lock presentation anywhere, and no disabled controls standing in for a rule.
  assert.doesNotMatch(aud, /Lock|mm_b_locked|mm_b_housing_lock|data-mm-housing-lock|disabled=\{housing\}/);
  // Default Gender = All, every gender selectable, ages editable (non-housing).
  assert.match(aud, /const gender = housing \? 'ALL' : stored\?\.gender \?\? 'ALL';/);
  assert.match(aud, /const GENDERS: TargetingIntentRow\['gender'\]\[\] = \['ALL', 'FEMALE', 'MALE'\];/);
  assert.match(aud, /<button key=\{g\} type="button" aria-pressed=\{gender === g\} onClick=\{\(\) => save\(\{ gender: g \}\)\}/);
  assert.match(aud, /<fieldset className="min-w-0">/, 'ages are an ordinary, enabled fieldset');
  // Narrowing shows advice, never reverts: nothing in the recommendation calls save().
  const rec = aud.slice(aud.indexOf('data-mm-audience-rec'), aud.indexOf('{/* WHO, BY RELATIONSHIP */}'));
  assert.match(aud, /\{isNarrowAudience\(\{ ageMin, ageMax, gender \}\) && \(/);
  assert.match(rec, /role="note"/);
  assert.doesNotMatch(rec, /save\(|destructive|role="alert"/, 'advice: no revert, no error styling');
  assert.match(rec, /mm_b_rec_title[\s\S]*mm_b_rec_narrow/);
  // Housing: fixed values stated as Meta's rule, as text.
  assert.match(aud, /\{housing \? \(\s*\/\*[^*]*\*\/\s*<div data-mm-housing-rule="">/);
  assert.match(aud, /mm_b_housing_radius_note/);

  // When the note shows.
  assert.equal(isNarrowAudience({ ageMin: 18, ageMax: 65, gender: 'ALL' }), false, 'the default is broad');
  assert.equal(isNarrowAudience({ ageMin: 21, ageMax: 60, gender: 'ALL' }), false, 'a light trim is fine');
  assert.equal(isNarrowAudience({ ageMin: 18, ageMax: 65, gender: 'FEMALE' }), true);
  assert.equal(isNarrowAudience({ ageMin: 18, ageMax: 65, gender: 'MALE' }), true);
  assert.equal(isNarrowAudience({ ageMin: 30, ageMax: 45, gender: 'ALL' }), true);

  // The copy: HOMATCH's recommendation, not a Meta requirement; Housing names Meta's rule.
  assert.equal(S.mm_b_rec_title[1], 'HOMATCH-ის რეკომენდაცია');
  assert.equal(S.mm_b_rec_narrow[1], 'უკეთესი შედეგისთვის გირჩევთ აუდიტორია ზედმეტად არ შეზღუდოთ და Meta-ს მისცეთ საშუალება იპოვოს ყველაზე შედეგიანი მომხმარებლები. სურვილის შემთხვევაში შეგიძლიათ თქვენი არჩევანი დატოვოთ.');
  for (const v of S.mm_b_rec_narrow) assert.doesNotMatch(v, /requires|must|required/i);
  assert.match(S.mm_b_housing_rule[0], /Meta requires all adults 18–65\+ and all genders/);
});

test('HOMATCH check: explained up front, the disabled Launch says why, copy claims only what the check does', () => {
  const page = read('src/pages/outreach/MetaAdsCreatePage.tsx');
  const review = read(`${B}/ReviewStep.tsx`);
  // Launch is available only after a READY check.
  assert.match(page, /const canLaunch = preflight\?\.status === 'READY' && !running;/);
  // The notice sits at the top of the flow until the check passes.
  assert.match(page, /\{preflight\?\.status !== 'READY' && \(\s*<div data-mm-check-notice="" role="note"/);
  assert.match(page, /mm_b_check_flow_setup[\s\S]*madsb_preflight_title[\s\S]*mads_launch/, 'set up → check → create');
  // Why Launch is unavailable: before the check, after a failed check, in manual review.
  assert.match(page, /!preflight \? 'mm_b_launch_needs_check'/);
  assert.match(page, /preflight\.status === 'MANUAL_REVIEW' \? 'mm_b_launch_in_review'/);
  assert.match(page, /preflight\.status !== 'READY' \? 'mm_b_launch_needs_fixes'/);
  assert.match(page, /aria-describedby=\{launchHint \? 'mm-b-launch-hint-nav' : undefined\}/);
  assert.match(review, /aria-describedby=\{launchHint \? 'mm-b-launch-hint' : undefined\}/);
  assert.match(review, /\{launchHint && <p id="mm-b-launch-hint" data-mm-launch-hint=""/);
  // A failed check lists what needs attention (the existing per-check list).
  assert.match(review, /preflight\.checks\.map\(\(ch\) =>/);
  // Honest copy: it checks, it adjusts only Housing audience settings, everything else is listed to fix.
  const [en] = S.mm_b_check_notice_body;
  assert.match(en, /connection, ad account, budget, creatives, destination and audience/);
  assert.match(en, /For property ads HOMATCH applies the audience settings Meta's Housing rules require/);
  assert.match(en, /listed for you to fix/);
  assert.doesNotMatch(en, /fix(es)? (it|them|everything) (for you|automatically)|repairs?/i);
  assert.equal(S.mm_b_launch_needs_check[1], 'კამპანიის შექმნამდე გაიარეთ HOMATCH-ის შემოწმება.');
});

test('funding: 0% on the customer\'s own ad account has no deposit path; the standard fee keeps it', () => {
  const card = read(`${B}/FundingCard.tsx`);
  assert.match(card, /const exempt = !!funding && !viaWallet && Number\(funding\.feePercent\) === 0;/);
  assert.match(card, /\{exempt \? \(\s*<div data-mm-funding-exempt=""/);
  assert.match(card, /\{!exempt && <p data-mm-disclosure=""/, 'no deposit disclosure when no deposit is needed');
  // Add funds lives only in the non-exempt branch.
  const exemptBranch = card.slice(card.indexOf('data-mm-funding-exempt'), card.indexOf(') : (<>'));
  assert.doesNotMatch(exemptBranch, /addFunds|mm_b_funding_add/);
  assert.match(S.mm_b_funding_exempt[0], /0%, so no HOMATCH service balance is needed/);
  assert.match(S.mm_b_funding_exempt[0], /Meta charges the ad budget directly/);
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
  // Rendered unconditionally: after the {!funding ? … : …} branch closes.
  assert.ok(card.indexOf('data-mm-disclosure') > card.lastIndexOf('        )}\n'), 'the disclosure sits outside the funding branch');
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
