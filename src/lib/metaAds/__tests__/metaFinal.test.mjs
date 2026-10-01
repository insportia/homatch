// META ADS — FINAL PRODUCT FINISH. The rules behind the premium builder:
// Meta's housing restriction only where Meta applies it, ages/gender as the
// owner's choice elsewhere, pins and languages as real Meta targeting,
// creative priority in the plan, measured image quality, the owner's brief
// (closed vocabularies), the translation fact guard, the campaign story, the
// expectations and the holistic check — and every key the UI builds
// dynamically backed by six translations.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  housingRule, declaredSpecialAdCategories, applyTargeting, validateTargeting, normalizeIntent, targetingConstraints, reachedCountries,
  HOUSING_MIN_RADIUS_KM, HOUSING_MIN_RADIUS_KM_EUROPE, INTERNATIONAL_INTENTS,
} from '../targeting.ts';
import { buildPlan, classifySpecialAdCategories } from '../strategy.ts';
import { creativeAdvice } from '../creativeAdvice.ts';
import {
  detectCopyLanguage, copyLanguages, locationBreadth, briefHash, sanitizeUnderstanding, readBriefRules, numbersIn, factsPreserved,
  campaignConsistency, campaignStory, expectationGuide, BRIEF_AUDIENCES, BRIEF_IGNORED_REASONS,
} from '../audienceGuide.ts';
import { placePoint, insideRings, circleRing, project, unproject } from '../../../components/metaAds/builder/geo/places.ts';
import { ADVICE_CODES, STRATEGY_REASON_CODES, PLAN_ISSUE_CODES, housingNormalized } from '../../../components/metaAds/builder/masterLogic.ts';
import { META_FINAL_STRINGS as F } from '../../../../scripts/meta-final-i18n-data.mjs';
import { META_MASTER_BUILDER_STRINGS as S } from '../../../../scripts/meta-master-builder-i18n-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const GEO = JSON.parse(read('src/components/metaAds/builder/geo/geoData.json'));

const tbilisi = { type: 'city', key: '1963014', name: 'Tbilisi', countryCode: 'GE', radiusKm: 10 };
const intent = (over = {}) => ({ locations: [tbilisi], ageMin: 25, ageMax: 45, gender: 'FEMALE', ...over });

/* ── A. Meta's housing rule: only where it applies ─────────────────────── */

test('housing rule: Georgia is not restricted; US/Canada need 25 km; the European list 15 km', () => {
  assert.deepEqual(housingRule(true, ['GE']), { restricted: false, countries: [], minRadiusKm: null });
  assert.equal(housingRule(true, ['US']).minRadiusKm, HOUSING_MIN_RADIUS_KM);
  assert.equal(housingRule(true, ['CA']).restricted, true);
  assert.equal(housingRule(true, ['DE']).minRadiusKm, HOUSING_MIN_RADIUS_KM_EUROPE);
  assert.deepEqual(housingRule(true, ['GE', 'DE', 'US']).countries.sort(), ['DE', 'US']);
  assert.equal(housingRule(true, ['GE', 'DE', 'US']).minRadiusKm, 25, 'the stricter floor wins');
  assert.equal(housingRule(false, ['US']).restricted, false, 'not a housing offer');
  for (const c of ['TR', 'AM', 'AZ', 'RU', 'UA', 'IL', 'KZ', 'AE']) assert.equal(housingRule(true, [c]).restricted, false, c);
});

test('declared category: the offer\'s classification, kept only where Meta requires it — the server uses the same function', () => {
  const offer = classifySpecialAdCategories({ isProperty: true, dealKind: 'SALE' });
  assert.deepEqual(offer, ['HOUSING']);
  assert.deepEqual(declaredSpecialAdCategories(offer, { locations: [tbilisi] }), []);
  assert.deepEqual(declaredSpecialAdCategories(offer, { locations: [tbilisi, { type: 'country', key: 'GB', name: 'UK', countryCode: 'GB' }] }), ['HOUSING']);
  const engine = read('supabase/functions/meta-ads-api/engine.ts');
  assert.match(engine, /const cats = declaredSpecialAdCategories\(offerCats, targeting\);/);
  assert.match(engine, /specialAdCategories: cats,/);
});

test('a Georgian property ad keeps the owner\'s ages and gender exactly; a restricted one follows Meta and says so', () => {
  const free = applyTargeting(intent(), declaredSpecialAdCategories(['HOUSING'], intent()));
  assert.equal(free.spec.age_min, 25);
  assert.equal(free.spec.age_max, 45);
  assert.deepEqual(free.spec.genders, [2]);
  assert.deepEqual(free.adjustments, []);
  assert.equal(free.spec.geo_locations.cities[0].radius, 10, 'no radius floor in Georgia');

  const de = intent({ locations: [{ type: 'city', key: '123', name: 'Berlin', countryCode: 'DE', radiusKm: 5 }] });
  const ruled = applyTargeting(de, declaredSpecialAdCategories(['HOUSING'], de));
  assert.equal(ruled.spec.age_min, 18);
  assert.equal(ruled.spec.age_max, 65);
  assert.equal(ruled.spec.genders, undefined);
  assert.equal(ruled.spec.geo_locations.cities[0].radius, 15, 'the European floor');
  assert.deepEqual(ruled.adjustments.sort(), ['HOUSING_AGE_ALL_ADULTS', 'HOUSING_ALL_GENDERS', 'HOUSING_RADIUS_WIDENED']);
  assert.equal(targetingConstraints(['HOUSING'], ['DE']).minRadiusKm, 15);
  assert.equal(targetingConstraints(['HOUSING']).minRadiusKm, 25, 'unknown countries: the stricter floor');
  // The browser stores what will run.
  assert.deepEqual(housingNormalized(de, 15).locations[0].radiusKm, 15);
});

/* ── B. Pins and languages are real Meta targeting ─────────────────────── */

test('pins become custom_locations, languages become locales, and both survive normalization', () => {
  const t = normalizeIntent({
    locations: [{ type: 'pin', key: 'x', name: 'Around my property', countryCode: 'GE', lat: 41.70991234, lng: 44.75161234, radiusKm: 3 }],
    ageMin: 18, ageMax: 65, gender: 'ALL',
    languages: [{ key: '17', name: 'Russian', code: 'ru' }, { key: 'not-a-key', name: 'x' }],
    international: { enabled: true, intents: ['FOREIGNERS_IN_COUNTRY', 'BOGUS'], markets: ['kz', 'XX1', 'IL'] },
  }, ['GE']);
  assert.equal(t.locations[0].key, '41.70991,44.75161', 'a pin key is its point');
  assert.deepEqual(t.languages, [{ key: '17', name: 'Russian', code: 'ru' }], 'only Meta-issued numeric keys');
  assert.deepEqual(t.international, { enabled: true, intents: ['FOREIGNERS_IN_COUNTRY'], markets: ['KZ', 'IL'] });
  const a = applyTargeting(t, []);
  assert.deepEqual(a.spec.geo_locations.custom_locations, [{ latitude: 41.70991, longitude: 44.75161, radius: 3, distance_unit: 'kilometer' }]);
  assert.deepEqual(a.spec.locales, [17]);
  assert.equal(a.spec.geo_locations.countries, undefined, 'a pin inside Georgia replaces the country');
  assert.deepEqual(reachedCountries(t), ['GE']);
  assert.ok(INTERNATIONAL_INTENTS.includes('INVESTORS_ABROAD'));
});

test('validation refuses a pin without a point and a language without Meta\'s key', () => {
  const codes = (i) => validateTargeting(i).map((x) => x.code);
  assert.ok(codes(intent({ locations: [{ type: 'pin', key: 'p', name: 'p', countryCode: 'GE', lat: 200, lng: 44 }] })).includes('PIN_INVALID'));
  assert.ok(codes(intent({ languages: [{ key: 'ru', name: 'Russian' }] })).includes('LANGUAGE_KEY_INVALID'));
  assert.ok(codes(intent({ languages: Array.from({ length: 7 }, (_, i) => ({ key: String(i + 1), name: 'x' })) })).includes('TOO_MANY_LANGUAGES'));
  assert.deepEqual(codes(intent()), []);
  for (const c of ['PIN_INVALID', 'TOO_MANY_LANGUAGES', 'LANGUAGE_KEY_INVALID']) {
    assert.ok(PLAN_ISSUE_CODES.includes(c));
    assert.equal(S[`mm_b_issue_${c}`]?.length, 6);
  }
});

/* ── C. Creative priority and measured quality ────────────────────────── */

test('a priority creative is always in the plan and first in line, even when another scores higher', () => {
  const cr = (id, quality, priority = false) => ({ id, kind: 'IMAGE', ready: true, width: 1080, height: 1080, quality, priority });
  const base = { goal: 'MESSAGES', dailyBudgetCents: 160, durationDays: 7, currency: 'USD', specialAdCategories: [], destination: { type: 'MESSAGING' }, placementsMode: 'RECOMMENDED', targeting: intent() };
  const without = buildPlan({ ...base, creatives: [cr('strong', 0.95), cr('fav', 0.6)] });
  assert.deepEqual(without.adSets[0].creativeIds, ['strong'], 'a one-ad budget runs the strongest');
  const withPriority = buildPlan({ ...base, creatives: [cr('strong', 0.95), cr('fav', 0.6, true)] });
  assert.deepEqual(withPriority.adSets[0].creativeIds, ['fav'], 'the owner\'s priority is honoured');
  assert.ok(withPriority.strategy.reasonCodes.includes('PRIORITY_CREATIVE_FIRST'));
  assert.ok(STRATEGY_REASON_CODES.includes('PRIORITY_CREATIVE_FIRST'));
  assert.equal(S.mm_b_reason_PRIORITY_CREATIVE_FIRST.length, 6);
  const engine = read('supabase/functions/meta-ads-api/engine.ts');
  assert.match(engine, /priority: cr\.priority === true,/, 'the server reads the stored preference');
  assert.match(engine, /cr\.media, cr\.priority === true\]\)/, 'changing priority changes what the check approved');
});

test('image quality advice speaks only of what was measured', () => {
  const img = (luma, contrast) => ({ id: 'a', headline: 'h', primaryText: 'p', media: [{ mime: 'image/jpeg', size: 200_000, width: 1080, height: 1350, luma, contrast }] });
  const codes = (c) => creativeAdvice([c], { goal: 'MESSAGES', placements: ['facebook_feed'] }).map((a) => a.code);
  assert.ok(codes(img(40, 50)).includes('MEDIA_TOO_DARK'));
  assert.ok(codes(img(240, 50)).includes('MEDIA_WASHED_OUT'));
  assert.ok(codes(img(130, 12)).includes('MEDIA_LOW_CONTRAST'));
  assert.ok(codes(img(130, 50)).includes('MEDIA_STRONG'));
  const unmeasured = { id: 'b', headline: 'h', primaryText: 'p', media: [{ mime: 'image/jpeg', size: 200_000, width: 1080, height: 1080 }] };
  assert.ok(!codes(unmeasured).some((c) => /DARK|WASHED|CONTRAST|STRONG/.test(c)), 'nothing claimed without a measurement');
  for (const c of ['MEDIA_TOO_DARK', 'MEDIA_WASHED_OUT', 'MEDIA_LOW_CONTRAST', 'MEDIA_STRONG']) {
    assert.ok(ADVICE_CODES.includes(c)); assert.equal(S[`mm_b_adv_${c}`].length, 6);
  }
  assert.match(read('src/services/metaAds.ts'), /function lumaOf\(img: HTMLImageElement\)/);
});

/* ── D. Language intelligence and the translation fact guard ──────────── */

test('copy language is read from the script, not guessed', () => {
  assert.equal(detectCopyLanguage('Продаётся светлая квартира с балконом в Ваке'), 'ru');
  assert.equal(detectCopyLanguage('იყიდება ნათელი ბინა აივნით ვაკეში'), 'ka');
  assert.equal(detectCopyLanguage('Bright apartment with a balcony in Vake'), 'en');
  assert.equal(detectCopyLanguage('Vake\'de balkonlu aydınlık daire satılık'), 'tr');
  assert.equal(detectCopyLanguage('Продається світла квартира з балконом'), 'uk');
  assert.equal(detectCopyLanguage('דירה מוארת עם מרפסת בוואקה'), 'he');
  assert.equal(detectCopyLanguage('شقة مشرقة مع شرفة في فاكي'), 'ar');
  assert.equal(detectCopyLanguage('ok'), null, 'too little text');
  assert.deepEqual(copyLanguages([{ primary_text: 'Продаётся квартира с балконом', headline: '' }, { primary_text: 'Квартира в Тбилиси', headline: '' }]), ['ru']);
});

test('a rewrite never invents a number; a translation keeps every number', () => {
  assert.deepEqual(numbersIn('$170,000 · 85 m² · floor 7'), ['170000', '85', '7']);
  assert.equal(factsPreserved('Price $170,000, 85 m²', 'Цена 170 000 $, 85 м²'), true);
  assert.equal(factsPreserved('Price $170,000, 85 m²', 'Цена 170 тыс. $, 85 м²'), false, 'a reformatted price is not the same fact');
  const idx = read('supabase/functions/meta-ads-api/index.ts');
  assert.match(idx, /if \(numbersIn\(out\)\.some\(\(n\) => !known\.has\(n\)\)\) return false;/);
  assert.match(idx, /return op !== 'TRANSLATE' \|\| factsPreserved\(source, out\);/);
  assert.match(idx, /translate and adapt current so it reads naturally/);
});

/* ── E. The owner's brief: soft intent, closed vocabularies ───────────── */

const BRIEF = 'I mainly want Russian-speaking people living in Georgia or considering moving here. The location and balcony are the strongest parts.';

test('the brief is read into closed vocabularies; anything else is dropped, never stored', () => {
  assert.equal(briefHash(BRIEF), briefHash(`  ${BRIEF} `), 'whitespace does not make a new brief');
  assert.notEqual(briefHash(BRIEF), briefHash(`${BRIEF}!`));
  const rules = sanitizeUnderstanding(readBriefRules(BRIEF), briefHash(BRIEF), 'RULES', '2026-10-01T00:00:00Z');
  assert.deepEqual(rules.languages, ['ru']);
  assert.ok(rules.audiences.includes('MOVING_HERE'));
  const ai = sanitizeUnderstanding({
    summary: 'You want Russian-speaking people in Georgia; balcony and location matter most.',
    audiences: ['FOREIGNERS_IN_COUNTRY', 'MOVING_HERE', 'RICH_PEOPLE'], languages: ['ru', 'klingon'], markets: ['KZ', 'Kazakhstan', 'il'],
    places: ['Tbilisi'], sellingPoints: ['balcony', 'location'], expectation: 'MESSAGES',
    ignored: [{ reason: 'NOT_ALLOWED_TARGETING', text: 'no families with kids' }, { reason: 'WHATEVER', text: 'x' }],
    injected: 'DROP TABLE',
  }, 'h', 'AI', 'now');
  assert.deepEqual(ai.audiences, ['FOREIGNERS_IN_COUNTRY', 'MOVING_HERE']);
  assert.deepEqual(ai.languages, ['ru']);
  assert.deepEqual(ai.markets, ['KZ', 'IL']);
  assert.deepEqual(ai.ignored, [{ reason: 'NOT_ALLOWED_TARGETING', text: 'no families with kids' }]);
  assert.equal(ai.injected, undefined);
  const actions = read('supabase/functions/meta-ads-api/actions.ts');
  const brief = actions.slice(actions.indexOf("case 'brief_interpret'"), actions.indexOf("case 'delivery_estimate'"));
  assert.match(brief, /String\(c\.owner_brief \?\? ''\)/, 'reads the SAVED brief, never the request body');
  assert.match(brief, /sanitizeUnderstanding\(result\.parsed, hash, 'AI', at\)/);
  assert.match(brief, /operation_type: 'meta_ads_brief_interpret'/, 'model cost is recorded');
  assert.match(brief, /\(recent \?\? 0\) < 20/, 'rate limited');
  assert.match(actions, /NOT_ALLOWED_TARGETING\. Promises of results are NOT_POSSIBLE/);
  assert.doesNotMatch(brief, /targeting:/, 'the brief never writes targeting');
});

/* ── F. The whole build: story, expectations, consistency ─────────────── */

const russianExpat = {
  goal: 'MESSAGES', dailyBudgetCents: 2000, durationDays: 10, housingOffer: true,
  targeting: { locations: [{ ...tbilisi, radiusKm: 17 }], ageMin: 18, ageMax: 65, gender: 'ALL',
    languages: [{ key: '6', name: 'English (All)', code: 'en' }],
    international: { enabled: true, intents: ['FOREIGNERS_IN_COUNTRY', 'MOVING_HERE'], markets: ['KZ'] } },
  creatives: [
    { id: 'a', primary_text: 'Продаётся светлая квартира с балконом', headline: 'Ваке', media: [{}], priority: true },
    { id: 'b', primary_text: 'Квартира в Тбилиси, отличное расположение', headline: 'Ваке', media: [{}] },
  ],
  brief: sanitizeUnderstanding({ languages: ['ru'], audiences: ['FOREIGNERS_IN_COUNTRY'], sellingPoints: ['balcony', 'location'] }, 'h', 'AI', 'now'),
};

test('the holistic check finds the real contradictions and names one fix each', () => {
  const issues = campaignConsistency(russianExpat);
  const by = Object.fromEntries(issues.map((i) => [i.code, i]));
  assert.deepEqual(by.COPY_LANGUAGE_NOT_TARGETED.fix, { kind: 'TRANSLATE_COPY', code: 'en' });
  assert.deepEqual(by.ABROAD_NOT_REACHED.fix, { kind: 'ADD_MARKETS', markets: ['KZ'] });
  assert.equal(by.FOREIGNERS_WITHOUT_LANGUAGE, undefined, 'a language is chosen');
  const fixed = campaignConsistency({ ...russianExpat, targeting: { ...russianExpat.targeting, languages: [{ key: '17', name: 'Russian', code: 'ru' }], locations: [russianExpat.targeting.locations[0], { type: 'country', key: 'KZ', name: 'KZ', countryCode: 'KZ' }] } });
  assert.deepEqual(fixed.map((i) => i.code), [], 'consistent once the fixes are applied');
});

test('the campaign story is built from the build, and expectations are room to learn — never a forecast', () => {
  const story = campaignStory({ ...russianExpat, goalKey: 'messages', placeNames: ['Tbilisi'], languageNames: ['English'], marketNames: ['Kazakhstan'] });
  assert.deepEqual(story.map((s) => s.key), ['goal', 'who', 'where', 'language', 'creative', 'optimise', 'first_days', 'brief']);
  const keys = story.flatMap((s) => s.lines.map((l) => l.key));
  assert.ok(keys.includes('who_broad') && keys.includes('who_brief_FOREIGNERS_IN_COUNTRY'));
  assert.ok(keys.includes('creative_priority'));
  assert.ok(keys.includes('where_BALANCED'));
  assert.equal(expectationGuide(russianExpat).room, 'GOOD_ROOM');
  assert.equal(expectationGuide({ ...russianExpat, dailyBudgetCents: 300, durationDays: 3, creatives: [russianExpat.creatives[0]] }).room, 'TIGHT');
  for (const v of F.mm_f_expect_disclaimer) assert.doesNotMatch(v, /guarantee(d|s)? (leads|results)/i);
  assert.match(F.mm_f_learn_body[0], /varies/, '2–3 days is HOMATCH\'s practical window, not a Meta promise');
});

test('breadth is geometry: a 10 km circle is very specific, Tbilisi at 17 km balanced, a country broad', () => {
  assert.equal(locationBreadth([tbilisi]).breadth, 'VERY_SPECIFIC');
  assert.equal(locationBreadth([{ ...tbilisi, radiusKm: 17 }]).breadth, 'BALANCED');
  assert.equal(locationBreadth([{ ...tbilisi, radiusKm: 80 }]).breadth, 'BROAD');
  assert.equal(locationBreadth([{ type: 'country', key: 'GE', name: 'GE', countryCode: 'GE' }]).breadth, 'BROAD');
  assert.equal(locationBreadth([tbilisi], 25).breadth, 'BALANCED', 'Meta\'s floor is what runs');
});

/* ── G. Every dynamically built key has six translations ──────────────── */

test('every key the new UI composes exists in all six languages', () => {
  const need = [
    ...INTERNATIONAL_INTENTS.map((i) => `mm_f_intent_${i}`),
    ...BRIEF_AUDIENCES.flatMap((a) => [`mm_f_aud_${a}`, `mm_f_story_who_brief_${a}`]),
    ...BRIEF_IGNORED_REASONS.map((r) => `mm_f_ignored_${r}`),
    ...['VERY_SPECIFIC', 'BALANCED', 'BROAD'].flatMap((b) => [`mm_f_breadth_${b}`, `mm_f_breadth_${b}_d`, `mm_f_story_where_${b}`]),
    ...['GOOD_ROOM', 'SOME_ROOM', 'TIGHT'].flatMap((r) => [`mm_f_room_${r}`, `mm_f_room_${r}_d`]),
    ...['leads_on_meta', 'messages', 'leads_on_website', 'site_registrations', 'promote', 'engagement'].map((g) => `mm_f_story_goal_${g}`),
    ...['goal', 'who', 'where', 'language', 'creative', 'optimise', 'first_days', 'brief'].map((h) => `mm_f_story_h_${h}`),
    ...['COPY_LANGUAGE_NOT_TARGETED', 'BRIEF_LANGUAGE_MISSING', 'FOREIGNERS_WITHOUT_LANGUAGE', 'ABROAD_NOT_REACHED', 'TINY_AREA_FOR_ABROAD',
      'NARROW_EVERYWHERE', 'FEW_CREATIVES_FOR_BUDGET', 'MANY_PLACES_SMALL_BUDGET', 'AUDIENCE_VERY_SMALL'].flatMap((c) => [`mm_f_issue_${c}`, `mm_f_issue_${c}_d`]),
    ...['ADD_LANGUAGE', 'TRANSLATE_COPY', 'ADD_MARKETS', 'WIDEN_AREA', 'ADD_CREATIVES', 'BROADEN_AGES', 'GO'].map((k) => `mm_f_fix_${k}`),
    ...['who_broad', 'who_chosen', 'who_meta_rule', 'where_places', 'lang_chosen', 'lang_all', 'lang_copy', 'lang_international',
      'creative_one', 'creative_many', 'creative_priority', 'optimise_managed', 'first_days_learning', 'brief_summary', 'brief_points'].map((k) => `mm_f_story_${k}`),
    ...['budget_ok', 'budget_low', 'days_ok', 'days_short', 'creatives_ok', 'creatives_few'].map((k) => `mm_f_exp_${k}`),
  ];
  for (const k of need) assert.equal(F[k]?.length, 6, `${k} has six translations`);
  // Every issue campaignConsistency can return is in that list.
  const src = read('src/lib/metaAds/audienceGuide.ts');
  for (const m of src.matchAll(/code: '([A-Z_]+)', severity/g)) assert.ok(need.includes(`mm_f_issue_${m[1]}`), m[1]);
  // Terminology: tenant = მოიჯარე.
  assert.equal(F.mm_f_aud_TENANTS[1], 'მოიჯარეები');
});

/* ── H. Edge contracts: Meta's catalogues and estimate, never invented ─── */

test('languages come from Meta\'s locale search, the estimate from Meta, and both are honest when Meta says nothing', () => {
  const actions = read('supabase/functions/meta-ads-api/actions.ts');
  const loc = actions.slice(actions.indexOf("case 'locale_search'"), actions.indexOf("case 'brief_interpret'"));
  assert.match(loc, /type: 'adlocale'/);
  assert.match(loc, /MOCK_MODE_NO_META_CATALOGUE/);
  assert.match(loc, /\/\^\[0-9\]\{1,20\}\$\/\.test\(String\(r\.key\)\)/, 'only Meta-issued numeric keys');
  const est = actions.slice(actions.indexOf("case 'delivery_estimate'"), actions.indexOf('/* ── SMART STRATEGY PREVIEW'));
  assert.match(est, /\/delivery_estimate\?/);
  assert.match(est, /if \(mode === 'MOCK'\) return json\(\{ available: false, reason: 'MOCK_MODE' \}\);/);
  assert.match(est, /estimate_mau_lower_bound[\s\S]*estimate_mau_upper_bound/);
  assert.match(est, /\(recent \?\? 0\) >= 60/, 'rate limited');
  assert.match(est, /ownCampaign\(sb, uid, body\.campaignId\)/, 'own campaign only');
});

test('the migration only adds: priority, owner_brief, brief_understanding — with size limits', () => {
  const sql = read('supabase/migrations/20261003120000_meta_ads_owner_brief_priority.sql');
  assert.match(sql, /add column if not exists priority boolean not null default false/);
  assert.match(sql, /add column if not exists owner_brief text not null default ''/);
  assert.match(sql, /add column if not exists brief_understanding jsonb/);
  assert.match(sql, /char_length\(owner_brief\) <= 1500/);
  assert.doesNotMatch(sql, /\bdrop\b|\bdelete\b|\bupdate\b|\btruncate\b/i);
  assert.doesNotMatch(sql, /^\s*(begin|commit)\s*;/im, 'the runner owns the transaction');
});

/* ── I. The map draws the real circle ──────────────────────────────────── */

test('the map places Georgian cities by name in three languages and draws Meta\'s real radius', () => {
  for (const name of ['Tbilisi', 'თბილისი', 'Тбилиси']) assert.deepEqual(placePoint({ type: 'city', name, countryCode: 'GE' }), { lat: 41.7151, lng: 44.8271 }, name);
  assert.equal(placePoint({ type: 'city', name: 'Berlin', countryCode: 'DE' }), null, 'not drawn rather than drawn wrongly');
  assert.deepEqual(placePoint({ type: 'pin', name: 'x', lat: 41.7, lng: 44.75 }), { lat: 41.7, lng: 44.75 });
  assert.ok(insideRings(GEO.georgia, 44.8271, 41.7151), 'Tbilisi is inside Georgia');
  assert.ok(insideRings(GEO.georgia, 41.0153, 43.0033), 'Sokhumi is inside Georgia');
  assert.ok(!insideRings(GEO.georgia, 44.5152, 40.1872), 'Yerevan is not');
  const ring = circleRing(41.7151, 44.8271, 17);
  const R = 6371; const toRad = Math.PI / 180;
  const [lng, lat] = ring[16];
  const d = 2 * R * Math.asin(Math.sqrt(Math.sin(((lat - 41.7151) * toRad) / 2) ** 2 + Math.cos(41.7151 * toRad) * Math.cos(lat * toRad) * Math.sin(((lng - 44.8271) * toRad) / 2) ** 2));
  assert.ok(Math.abs(d - 17) < 0.05, `circle radius ${d}`);
  const [x, y] = project(44.8271, 41.7151);
  const back = unproject(x, y);
  assert.ok(Math.abs(back.lat - 41.7151) < 1e-9 && Math.abs(back.lng - 44.8271) < 1e-9);
});
