// META ADS — MOBILE SIMPLIFICATION, REAL SIGNAL INTELLIGENCE, LEADS REPAIR &
// DOMAIN GUARD. The rules behind the release:
//   A  mobile shell: one bottom bar, safe area, money on one line, no mid-word breaks
//   B  clickability: selected / disabled / priority states never colour alone
//   C  location: refinements coexist with countries; one effective geography
//   D  audience: META REQUIRED vs HOMATCH RECOMMENDED vs USER CHOICE; the advertiser's own country
//   E  creative: field help, ☆/★ priority, "დამეხმაროს HOMATCH AI"
//   F  domain guard: classifier, preflight, launch re-check (no frontend bypass), admin evidence, no AI
//   G  leads: one customer action, admin cause, no fake availability
//   H  intelligence: one learning model — NEW / COLLECTING / USING_SIGNALS
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyDomainScope, domainFingerprint, DOMAIN_CASE_REASON } from '../domainScope.ts';
import { effectiveLocations, housingRule, declaredSpecialAdCategories, audienceAuthority } from '../targeting.ts';
import { learningStage, evidenceOf } from '../analysis.ts';
import { afterTerms, instantFormsCause, instantFormsState, termsOutcome, INSTANT_FORM_PERMISSIONS, LEAD_TERMS_URL } from '../instantForms.ts';
import { addLocation, geographyGroups, refinedCountries } from '../../../components/metaAds/builder/masterLogic.ts';
import { preflightDetails } from '../../../components/metaAds/builder/steps.ts';
import { META_MOBILE_STRINGS as M } from '../../../../scripts/meta-mobile-i18n-data.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const B = 'src/components/metaAds/builder';
const page = read('src/pages/outreach/MetaAdsCreatePage.tsx');

/* ── A · MOBILE SHELL ──────────────────────────────────────────────────── */

test('A: one bottom bar on phones — the builder bar covers the app nav, respects the safe area, and the page reserves its height', () => {
  assert.match(page, /data-madsb-nav="" className="fixed inset-x-0 bottom-0 z-\[60\] md:z-30/, 'above the app bottom nav (z-50), at the very bottom');
  assert.doesNotMatch(page, /bottom-\[calc\(3\.75rem/, 'never stacked above the app nav');
  assert.match(page, /pb-\[calc\(0\.625rem\+env\(safe-area-inset-bottom,0px\)\)\]/, 'the bar pads the home indicator');
  assert.match(page, /pb-\[calc\(6\.5rem\+env\(safe-area-inset-bottom,0px\)\)\]/, 'the last control scrolls clear of the bar');
  assert.equal((page.match(/min-h-11 shrink-0/g) ?? []).length, 3, 'Back, Continue and Launch are 44px targets');
  // The hero and the check notice once, at the start — later steps start with the work.
  assert.match(page, /step !== 'account' && 'hidden md:block'/);
  assert.match(page, /\{step === 'account' && preflight\?\.status !== 'READY' && \(/);
});

test('A: money stays on one line; Georgian words never split in the middle', () => {
  const budget = read(`${B}/BudgetStep.tsx`);
  const summary = budget.slice(budget.indexOf('export function FinancialSummary'));
  assert.equal((summary.match(/<dd className="shrink-0 whitespace-nowrap/g) ?? []).length, 3, 'media, fee and charged-now');
  assert.ok(!/<dt className="text-sm/.test(summary), 'labels can shrink (min-w-0), never the amount');
  const funding = read(`${B}/FundingCard.tsx`);
  for (const dd of funding.match(/<dd className=\{?[`"]shrink-0[^>]*/g) ?? []) assert.match(dd, /whitespace-nowrap/, dd);
  for (const f of fs.readdirSync(path.join(ROOT, B)).filter((x) => x.endsWith('.tsx'))) {
    assert.doesNotMatch(read(`${B}/${f}`), /overflow-wrap:anywhere|break-all/, `${f}: words break only where they must`);
  }
});

/* ── B · CLICKABILITY ──────────────────────────────────────────────────── */

test('B: a choice card shows DEFAULT / HOVER / PRESSED / SELECTED / DISABLED distinctly, never by colour alone', () => {
  const ui = read(`${B}/ui.tsx`);
  assert.match(ui, /aria-pressed=\{active\}/);
  assert.match(ui, /active \? 'border-\[hsl\(var\(--gold-border\)\)\] bg-\[hsl\(var\(--gold-soft\)\)\] ring-1/, 'selected: gold ring');
  assert.match(ui, /\{active && <Check/, 'selected: a check mark, not only colour');
  assert.match(ui, /active:scale-\[0\.99\] motion-reduce:active:scale-100/, 'pressed, and reduced motion respected');
  assert.match(ui, /disabled && 'cursor-not-allowed border-dashed/, 'disabled: dashed and readable');
  assert.doesNotMatch(ui, /opacity-55/, 'no grey ghost');
  assert.match(ui, /min-h-11/);
});

test('B: folded sections say what is chosen, announce their state, and keep switches reachable', () => {
  const kit = read(`${B}/FinishKit.tsx`);
  assert.match(kit, /export function Fold/);
  assert.match(kit, /data-mm-fold=\{id\} aria-expanded=\{open\} aria-controls=\{panel\}/);
  assert.match(kit, /\{summary != null && !open && <span/, 'the summary is text');
  assert.match(kit, /min-h-\[52px\]/);
});

/* ── C · LOCATION ──────────────────────────────────────────────────────── */

const GE = { type: 'country', key: 'GE', name: 'Georgia', countryCode: 'GE' };
const KZ = { type: 'country', key: 'KZ', name: 'Kazakhstan', countryCode: 'KZ' };
const TBS = { type: 'city', key: '1963014', name: 'Tbilisi', countryCode: 'GE', radiusKm: 15 };
const PIN = { type: 'pin', key: '41.70990,44.75160', name: 'Pin 1', countryCode: 'GE', radiusKm: 5 };

test('C: a pin, then countries, then a city — every action can repeat and nothing silently disappears', () => {
  let list = addLocation([], PIN).list;
  list = addLocation(list, GE).list;
  list = addLocation(list, KZ).list;
  list = addLocation(list, TBS).list;
  assert.deepEqual(list.map((l) => l.key), ['41.70990,44.75160', 'GE', 'KZ', '1963014'], 'all four kept, in order');
  assert.deepEqual(addLocation(list, GE).list.length, 4, 'a repeat is a no-op, not an error');
  assert.ok(refinedCountries(list).has('GE'));
  // What runs: Georgia as its places, Kazakhstan whole.
  assert.deepEqual(effectiveLocations(list).map((l) => l.key), ['41.70990,44.75160', 'KZ', '1963014']);
  const groups = geographyGroups(list);
  assert.deepEqual(groups.map((g) => [g.countryCode, g.whole, g.places.map((p) => p.key)]), [
    ['GE', false, ['41.70990,44.75160', '1963014']],
    ['KZ', true, []],
  ]);
});

test('C: the audience step leads with the effective geography, country → city → (optional) a precise spot', () => {
  const aud = read(`${B}/AudienceStep.tsx`);
  assert.match(aud, /t\('mm_m_where_title'\)/);
  assert.match(aud, /data-mm-geo-summary=""/);
  assert.match(aud, /geographyGroups\(locations\)/);
  assert.ok(aud.indexOf('data-mm-geo-summary') < aud.indexOf('<LocationPicker') && aud.indexOf('<LocationPicker') < aud.indexOf('<GeoMap'), 'summary, search, then the map');
  // The map is part of the Audience workspace (closure release): always in view, never folded away.
  assert.doesNotMatch(aud, /<More label=\{t\('mm_m_precise'\)\}/);
  assert.match(aud, /<GeoMap locations=\{locations\}/);
  assert.match(aud, /mm_m_loc_refined/, 'a refined country says it runs as its places');
  assert.match(read('src/lib/metaAds/strategy.ts'), /const locations = effectiveLocations\(intent\.locations\);/, 'the plan runs the effective places');
});

/* ── D · AUDIENCE ──────────────────────────────────────────────────────── */

test('D: Meta\'s housing rule from the places AND the advertiser\'s own country — Meta\'s data, never a guess', () => {
  assert.equal(housingRule(true, ['GE']).restricted, false, 'Georgian advertiser, Georgian ad');
  assert.equal(housingRule(true, ['GE'], 'GE').restricted, false);
  assert.equal(housingRule(true, ['GE'], null).restricted, false, 'unknown country: only the places decide');
  const us = housingRule(true, ['GE'], 'US');
  assert.deepEqual([us.restricted, us.minRadiusKm], [true, 25], 'a US advertiser is restricted wherever the ad runs');
  assert.equal(housingRule(false, ['GE'], 'US').restricted, false, 'not a housing offer');
  assert.deepEqual(declaredSpecialAdCategories(['HOUSING'], { locations: [TBS] }, 'US'), ['HOUSING']);
  // The country comes from Meta's own ad-account field, stored on refresh, read by the server.
  const index = read('supabase/functions/meta-ads-api/index.ts');
  assert.match(index, /fields=business_country_code/);
  assert.match(read('supabase/functions/meta-ads-api/engine.ts'), /acct\?\.capabilities\?\.business_country_code \?\? null/);
});

test('D: three authorities, named in code and on screen — a recommendation is never a Meta rule', () => {
  assert.equal(audienceAuthority({ restricted: true, countries: ['DE'], minRadiusKm: 15 }, 'ages', { narrow: true }), 'META_REQUIRED');
  assert.equal(audienceAuthority({ restricted: false, countries: [], minRadiusKm: null }, 'ages', { narrow: true }), 'HOMATCH_RECOMMENDED');
  assert.equal(audienceAuthority({ restricted: false, countries: [], minRadiusKm: null }, 'ages', { narrow: false }), 'USER_CHOICE');
  const aud = read(`${B}/AudienceStep.tsx`);
  for (const a of ['META_REQUIRED', 'HOMATCH_RECOMMENDED', 'USER_CHOICE']) assert.match(aud, new RegExp(`data-mm-authority="${a}"`));
  assert.match(aud, /mm_m_meta_rule_us_advertiser/);
  assert.match(aud, /\(readyAudiences\.length > 0 \|\| !!campaign\.audience_id\) &&/, 'no empty retargeting section');
});

/* ── E · CREATIVE ──────────────────────────────────────────────────────── */

test('E: creative fields explain themselves; priority is an unmistakable ☆/★ toggle; the AI button says what it does', () => {
  const cr = read(`${B}/CreativeStep.tsx`);
  assert.match(cr, /\{creative\.priority \? '★' : '☆'\}/);
  assert.match(cr, /aria-pressed=\{!!creative\.priority\} onClick=\{\(\) => edit\(\{ priority: !creative\.priority \}\)\} data-mm-priority-toggle=""/);
  assert.match(cr, /mm_m_priority_on' : 'mm_m_priority_make'/);
  assert.match(cr, /aria-describedby=\{`mm-m-prio-\$\{creative\.id\}`\}/, 'the explanation is announced');
  for (const k of ['mm_m_field_primary', 'mm_m_field_primary_ph', 'mm_m_field_headline_d', 'mm_m_field_description_d', 'mm_m_ai_help']) assert.match(cr, new RegExp(k));
  assert.equal(M.mm_m_ai_help[1], 'დამეხმაროს HOMATCH AI');
  assert.equal(M.mm_m_field_primary[1], 'დაწერეთ თქვენი სარეკლამო ტექსტი / აღწერა');
  assert.equal(M.mm_m_field_headline_d[1], 'მოკლე მთავარი ფრაზა, რომელსაც მომხმარებელი პირველ რიგში დაინახავს.');
  assert.equal(M.mm_m_priority_explain[1], 'ამ კრეატივს HOMATCH პირველ რიგში გაითვალისწინებს, თუმცა შედეგების მიხედვით სხვა კრეატივებიც შეიძლება უკეთ იმუშაოს.');
  // Guidance is folded, never two cards that look selected.
  assert.doesNotMatch(cr, /<HelperCard emoji="⭐"/);
  // The AI writes positively — and its fact guard stays.
  const index = read('supabase/functions/meta-ads-api/index.ts');
  assert.match(index, /Tone: warm, positive and constructive/);
  assert.match(index, /Never invent prices, sizes, locations, amenities, discounts or deadlines/);
});

/* ── F · DOMAIN GUARD ──────────────────────────────────────────────────── */

test('F: the real-estate ecosystem is allowed; clearly unrelated or high-risk ads are blocked; borderline goes to a person', () => {
  const v = (texts, extra = {}) => classifyDomainScope({ hasProperty: false, offer: { isProperty: false, title: '' }, texts, ...extra }).decision;
  for (const s of [
    'Apartment renovation in Tbilisi — kitchens and bathrooms',
    'Interior design studio for new homes',
    'Ремонт квартир под ключ',
    'ბინის რემონტი და ინტერიერის დიზაინი',
    'Plot of land for sale near Mtskheta',
    'Architect for your new house',
    'Property management for landlords',
    'Satılık daire, Batum',
    'شقة للبيع في تبليسي',
    'דירה להשכרה בבטומי',
  ]) assert.equal(v([s]), 'ALLOWED', s);
  for (const s of ['Online casino bonus', 'Sports betting odds today', 'Bitcoin trading signals', 'Every new sneaker 50% off', 'Pizza delivery in 30 minutes', 'კაზინო ბონუსი']) {
    assert.equal(v([s]), 'BLOCKED_OUT_OF_SCOPE', s);
  }
  assert.equal(v(['Moving company, fast and careful']), 'NEEDS_REVIEW', 'no clear signal: a person decides');
  assert.equal(v(['Apartment with a casino bonus']), 'NEEDS_REVIEW', 'mixed: a person decides');
  assert.equal(classifyDomainScope({ hasProperty: true, texts: ['Two bedrooms in Vake'] }).decision, 'ALLOWED');
  assert.equal(classifyDomainScope({ hasProperty: true, texts: ['Flat next to the casino'] }).decision, 'NEEDS_REVIEW', 'a property is never refused by a word');
  // Signals are categories, never the text.
  assert.deepEqual(classifyDomainScope({ hasProperty: false, texts: ['Online casino bonus'] }).signals, ['GAMBLING']);
  // The approval is tied to the exact copy.
  const a = { hasProperty: false, offer: { isProperty: false, title: 'Moving' }, texts: ['A'] };
  assert.notEqual(domainFingerprint(a), domainFingerprint({ ...a, texts: ['B'] }));
});

test('F: the server decides — preflight, and again at launch; a frontend that skips the check is still refused', () => {
  const engine = read('supabase/functions/meta-ads-api/engine.ts');
  const index = read('supabase/functions/meta-ads-api/index.ts');
  assert.match(engine, /const domain = await domainCheck\(sb, uid, c, \{ owned, creatives: creatives \?\? \[\] \}\);/);
  assert.match(engine, /add\('domain_scope', 'ACTION_REQUIRED', `BLOCKED_OUT_OF_SCOPE:/);
  assert.match(engine, /add\('domain_scope', 'WARNING', `IN_REVIEW:\$\{domain\.verdict\.reason\}`\); manualReview = true;/);
  const launch = index.slice(index.indexOf("const scope = await domainCheck(sb, uid, c);"));
  assert.ok(launch.length > 0, 'launch re-runs the guard on the stored campaign');
  assert.match(launch.slice(0, 600), /OUT_OF_SCOPE/);
  assert.match(launch.slice(0, 600), /IN_REVIEW/);
  // Order in the launch handler: fingerprint (what was checked) → scope → only then the LAUNCHING transition.
  const iFp = index.indexOf("return json({ error: 'PREFLIGHT_STALE'");
  const iScope = index.indexOf('const scope = await domainCheck(sb, uid, c);');
  const iLaunching = index.indexOf("if (!canTransition(c.status, 'LAUNCHING'))");
  assert.ok(iFp > 0 && iFp < iScope && iScope < iLaunching, 'the guard runs before anything reaches Meta');
  // Audit evidence for admin: classification, reason, signals, source, time; a person's decision is respected.
  assert.match(engine, /findings = \{ domain: verdict\.decision, domain_reason: verdict\.reason, signals: verdict\.signals, domain_fingerprint: fingerprint, source: 'DETERMINISTIC', checked_at:/);
  assert.match(engine, /reason: DOMAIN_CASE_REASON, severity: 'HIGH', findings,\s*status: 'REJECTED'/);
  assert.match(engine, /m\.status === 'REJECTED' && m\.decided_by/);
  assert.equal(DOMAIN_CASE_REASON, 'DOMAIN_SCOPE');
  assert.match(read('src/pages/admin/AdminMetaAdsPage.tsx'), /m\.reason === 'DOMAIN_SCOPE' && m\.findings/);
  // No creative text goes to an AI model to classify scope.
  const dc = engine.slice(engine.indexOf('export async function domainCheck'), engine.indexOf('export function withoutInstagram'));
  assert.doesNotMatch(dc, /fetch\(|openai|anthropic|gemini|callAi|aiJson/i);
  // The customer reads one kind sentence, never the matched words.
  assert.deepEqual(preflightDetails('BLOCKED_OUT_OF_SCOPE:GAMBLING'), [{ key: 'mm_m_scope_blocked', value: '' }]);
  assert.deepEqual(preflightDetails('IN_REVIEW:NO_REAL_ESTATE_SIGNAL'), [{ key: 'mm_m_scope_review', value: '' }]);
  assert.equal(M.mm_m_scope_blocked[1], 'HOMATCH Ads შექმნილია უძრავი ქონებისა და მასთან დაკავშირებული სერვისებისთვის. ეს რეკლამა ამ მიმართულებას არ შეესაბამება. შეგიძლიათ შექმნათ უძრავ ქონებასთან დაკავშირებული კამპანია.');
  assert.match(page, /code === 'OUT_OF_SCOPE'|'OUT_OF_SCOPE'/);
});

/* ── G · LEADS ─────────────────────────────────────────────────────────── */

test('G: leads — the real blocker named for admin, one action for the customer, no form builder that cannot work', () => {
  // Production today: CONNECTED, the three permissions missing, nothing declined → the configuration never asked.
  const prod = { granted_scopes: ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement'], declined_scopes: [] };
  assert.equal(instantFormsCause(prod), 'NOT_REQUESTED');
  assert.equal(instantFormsCause({ ...prod, declined_scopes: ['leads_retrieval'] }), 'DECLINED');
  // The login configuration now requests them: a token without them needs a reconnect (closure release).
  assert.equal(instantFormsState({ goalEnabled: true, granted: prod.granted_scopes, required: INSTANT_FORM_PERMISSIONS, check: null }), 'PERMISSIONS_MISSING', 'not faked available');
  const dest = read(`${B}/DestinationStep.tsx`);
  assert.match(dest, /data-mm-forms-action="RECONNECT"/);
  assert.match(dest, /data-mm-forms-action="USE_MESSAGES"/);
  assert.match(dest, /\{formsState === 'READY' && \(!creating \?/, 'the form builder only when forms can work');
  assert.doesNotMatch(dest, /leads_retrieval|pages_manage_ads|pages_manage_metadata/);
  assert.match(read('src/pages/admin/AdminMetaAdsPage.tsx'), /mm_m_admin_forms_\$\{formsCause\(c\)\}/);
  for (const k of ['mm_m_forms_reconnect_cta', 'mm_m_forms_use_messages']) {
    for (const v of M[k]) assert.doesNotMatch(v, /leads_retrieval|pages_manage|permission/i);
  }
});

/* ── H · INTELLIGENCE ──────────────────────────────────────────────────── */

test('H: one truthful learning model — a new campaign has no evidence; a running one uses Meta\'s reported results', () => {
  assert.equal(learningStage(false, 'HIGH_CONFIDENCE'), 'NEW', 'a draft never claims evidence');
  assert.equal(learningStage(true, 'INSUFFICIENT_DATA'), 'COLLECTING');
  assert.equal(learningStage(true, null), 'COLLECTING');
  assert.equal(learningStage(true, evidenceOf(0, 0)), 'COLLECTING');
  assert.equal(learningStage(true, 'EARLY_SIGNAL'), 'USING_SIGNALS');
  assert.equal(M.mm_m_stage_NEW_d[1], 'ჯერ ვიწყებთ საწყისი სტრატეგიით. შედეგების დაგროვების შემდეგ HOMATCH რეალურ რეაქციებს გამოიყენებს აუდიტორიისა და კრეატივების გასაუმჯობესებლად.');
  assert.match(read(`${B}/ReviewInsights.tsx`), /<LearningStageCard stage="NEW" \/>/);
  assert.match(read('src/components/metaAds/campaign/OverviewSection.tsx'), /learningStage\(!!d\.campaign\.external_campaign_id, evidence as Evidence\)/);
  // Never a promise of automatic optimisation, never an inferred trait.
  for (const [k, v] of Object.entries(M)) if (k.startsWith('mm_m_stage_')) {
    assert.doesNotMatch(v[0], /automatically|guarantee|religion|ethnic|income/i, k);
  }
  assert.match(M.mm_m_stage_USING_SIGNALS_d[0], /Nothing changes without your approval/);
});

test('review: a summary first, the rest folded; the check and the fee stay in view', () => {
  const review = read(`${B}/ReviewStep.tsx`);
  const iSummary = review.indexOf('data-mm-review-summary');
  const iCheck = review.indexOf('madsb_preflight_title');
  const iDetails = review.indexOf("mm_m_review_all_details");
  assert.ok(iSummary > 0 && iSummary < iCheck && iCheck < iDetails, 'summary → check → details');
  assert.ok(review.indexOf('<FinancialSummary') < iDetails, 'the fee is never folded away');
  const ins = read(`${B}/ReviewInsights.tsx`);
  assert.match(ins, /data-mm-insights-toggle=""/);
  assert.match(ins, /mm_m_review_ready|mm_m_review_suggestions/);
  assert.match(ins, /if \(warnings\) setOpen\(true\)/, 'a real warning opens itself');
});

test('every mm_m_ key: six real translations, placeholders intact, and present in the bundle', () => {
  const bundle = read('src/i18n/translations.ts');
  for (const [k, v] of Object.entries(M)) {
    assert.equal(v.length, 6, k);
    const ph = (s) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join();
    for (const s of v) { assert.ok(s.trim(), k); assert.equal(ph(s), ph(v[0]), `${k} placeholders`); }
    assert.ok(bundle.includes(`  ${k}: `), `${k} applied`);
  }
  const used = new Set();
  for (const f of [page, ...fs.readdirSync(path.join(ROOT, B)).filter((x) => /\.tsx?$/.test(x)).map((x) => read(`${B}/${x}`))]) {
    for (const m of f.matchAll(/'(mm_m_[a-z_]+)'/g)) used.add(m[1]);
  }
  for (const k of used) assert.ok(M[k], `${k} has copy`);
  for (const s of ['NEW', 'COLLECTING', 'USING_SIGNALS']) { assert.ok(M[`mm_m_stage_${s}`]); assert.ok(M[`mm_m_stage_${s}_d`]); }
  for (const c of ['NOT_REQUESTED', 'DECLINED']) assert.ok(M[`mm_m_admin_forms_${c}`]);
});

/* ── G2 · META LEAD ADS TERMS ──────────────────────────────────────────── */

test('G2: Terms acceptance is its own state — never collapsed into "coming soon", never assumed', () => {
  const req = INSTANT_FORM_PERMISSIONS;
  const base = ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement'];
  const ready = { goalEnabled: true, granted: [...base, ...req], required: req };
  const ok = { tosField: true, readWithLeadPermissions: true, formsReadable: true, formsCount: 0 };
  assert.equal(instantFormsState({ ...ready, check: { ...ok, tosField: false } }), 'TERMS_REQUIRED', 'everything ready except the terms');
  assert.equal(instantFormsState({ ...ready, check: ok }), 'READY', 'Meta confirmed');
  assert.equal(instantFormsState({ ...ready, check: null }), 'TERMS_UNKNOWN', 'never checked is checked, not assumed');
  assert.equal(instantFormsState({ ...ready, check: ok, pageSelected: false }), 'PAGE_UNAVAILABLE');
  // Permissions first; the terms come next.
  const noPerms = { goalEnabled: true, granted: base, required: req, check: { tosField: false, readWithLeadPermissions: false } };
  assert.equal(instantFormsState(noPerms), 'PERMISSIONS_MISSING');
  assert.equal(afterTerms({ ...ready, check: { tosField: false, readWithLeadPermissions: true, formsReadable: false } }), 'FORM_ACCESS_UNAVAILABLE', 'Terms accepted ✓ · next: form access');
  assert.equal(instantFormsState({ ...ready, goalEnabled: false, check: ok }), 'DISABLED');
});

test('G2: the round trip ends only on Meta\'s answer — a closing window proves nothing', () => {
  assert.equal(termsOutcome({ pageAtOpen: '1', pageNow: '1', terms: 'ACCEPTED', windowOpen: false }), 'ACCEPTED');
  assert.equal(termsOutcome({ pageAtOpen: '1', pageNow: '1', terms: 'REQUIRED', windowOpen: false }), 'NOT_ACCEPTED', 'closed without accepting');
  assert.equal(termsOutcome({ pageAtOpen: '1', pageNow: '1', terms: 'REQUIRED', windowOpen: true }), 'WAITING');
  assert.equal(termsOutcome({ pageAtOpen: '1', pageNow: '1', terms: 'UNKNOWN', windowOpen: false }), 'UNCONFIRMED', 'unknown is never "not accepted"');
  assert.equal(termsOutcome({ pageAtOpen: '1', pageNow: '2', terms: 'ACCEPTED', windowOpen: false }), 'PAGE_CHANGED', 'another Page is not this acceptance');
  assert.equal(LEAD_TERMS_URL('123'), 'https://www.facebook.com/ads/leadgen/tos?page_id=123', 'Meta\'s own page');
});

test('G2: HOMATCH opens Meta\'s own terms page and re-checks with Meta — it never accepts, copies, frames or trusts messages', () => {
  const flow = read(`${B}/LeadTermsFlow.tsx`);
  assert.match(flow, /window\.open\('', 'homatch-meta-lead-terms', 'popup,/);
  assert.match(flow, /w\.opener = null/);
  assert.match(flow, /w\.location\.href = url/);
  assert.match(flow, /target="_blank" rel="noopener noreferrer"/, 'blocked popup: a real link the owner taps');
  assert.doesNotMatch(flow, /addEventListener\('message'|onmessage|postMessage/, 'no message is trusted');
  assert.doesNotMatch(flow, /<iframe/i, 'facebook.com is never framed');
  assert.doesNotMatch(flow, /localStorage|sessionStorage/, 'no local "accepted" flag');
  assert.match(flow, /await recheckLeadForms\(\);\s*await onRechecked\(\);/, 'Meta is asked, then the server status reloads');
  for (const o of ['WAITING', 'NOT_ACCEPTED', 'UNCONFIRMED', 'POPUP_BLOCKED', 'META_ERROR', 'SESSION_EXPIRED', 'PAGE_CHANGED', 'TIMEOUT', 'ACCEPTED']) {
    assert.match(flow, new RegExp(`${o}: 'mm_l_`), `${o} has its sentence`);
  }
  // Server: reads leadgen_tos_accepted with the Page token; writes no acceptance anywhere.
  const engine = read('supabase/functions/meta-ads-api/engine.ts');
  const index = read('supabase/functions/meta-ads-api/index.ts');
  assert.match(engine, /fields=leadgen_tos_accepted`, \{ token: pageAccessToken, attempts: 1 \}/);
  assert.match(engine, /if \(typeof res\?\.leadgen_tos_accepted === 'boolean'\) tosField = res\.leadgen_tos_accepted;/);
  const recheck = index.slice(index.indexOf("case 'forms_recheck'"), index.indexOf("case 'select_asset'"));
  assert.ok(recheck.length > 100);
  assert.doesNotMatch(recheck, /method: 'POST'|leadgen_tos_accepted: true/, 'nothing is accepted for the owner');
  assert.match(recheck, /graph\('\/me\/permissions'/, 'permissions re-read');
  assert.match(recheck, /checkLeadPage\(sb, uid, page, token, granted\)/, 'terms and forms re-read from Meta');
  assert.match(engine, /readLeadTerms\(page\.external_id, pt\)/);
  assert.match(engine, /leadgen_forms\?fields=id&limit=25/, 'form access re-read');
  assert.match(index, /check: leadCheck,/, 'the status decides from the stored check');
  assert.match(engine, /leadTermsEvidence\(leadCheckOf\(page\?\.capabilities\)\) === 'REQUIRED'\) add\('lead_terms', 'ACTION_REQUIRED', 'LEAD_TERMS_REQUIRED'\)/, 'preflight holds it on evidence only');
  // The Leads goal stays selectable when the owner can resolve it here.
  assert.match(page, /const enabled = switchedOn && FORMS_ACTIONABLE\.has\(forms\);/);
  assert.equal(M.mm_l_terms_cta[1], 'Meta-ს პირობებთან დათანხმება');
  for (const [k, v] of Object.entries(M)) if (k.startsWith('mm_l_')) for (const x of v) assert.doesNotMatch(x, /leads_retrieval|pages_manage|permission/i, k);
});
