// META ADS CLOSURE — Lead Ads Terms states, empty-by-default multilingual
// locations and the targets-only map, the guided Lead Form Builder, HOMATCH AI
// creatives (explicit, cached, billed, idempotent) and the video cover.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { instantFormsState, leadTermsEvidence, leadCheckOf, termsOutcome, INSTANT_FORM_PERMISSIONS } from '../instantForms.ts';
import { queryVariants, looksLikeStreet, transliterate, countryNameMatches, metaLocale, locationTypeOf } from '../geoQuery.ts';
import { validateLeadFormSpec, leadFormPayload, leadFormPreview, leadFormReadiness, suggestLeadQuestions, privacyIsHomatch, isSensitiveQuestion } from '../leadForms.ts';
import {
  validateAnalysis, analysisFingerprint, generationPrompt, sanitizeInstruction, clampVariations, sizeForAspect, tokenCostCents,
  validGeneratedImage, roleToCreative, GENERATION_STAGES, MAX_VARIATIONS,
} from '../creativeAi.ts';
import { sampleTimes, frameStats, coverScore, bestCover, formatTime } from '../videoCover.ts';
import { mapTargets } from '../../../components/metaAds/builder/geo/mapTargets.ts';
import { circleRing, placePoint, project } from '../../../components/metaAds/builder/geo/places.ts';

const read = (p) => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8');
const GRANTED_OLD = ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement', 'public_profile'];
const GRANTED_ALL = [...GRANTED_OLD, ...INSTANT_FORM_PERMISSIONS];
const state = (granted, check, extra = {}) => instantFormsState({ goalEnabled: true, granted, required: [...INSTANT_FORM_PERMISSIONS], check, ...extra });

/* ── TERMS ─────────────────────────────────────────────────────────── */

test('terms: accepted + forms readable = READY', () => {
  assert.equal(state(GRANTED_ALL, { tosField: true, readWithLeadPermissions: true, formsReadable: true, formsCount: 0 }), 'READY');
});

test('terms: a real refusal with lead permissions = TERMS_REQUIRED', () => {
  assert.equal(state(GRANTED_ALL, { tosField: false, readWithLeadPermissions: true, formsReadable: true }), 'TERMS_REQUIRED');
  assert.equal(state(GRANTED_ALL, { createRefusedForTerms: true, formsReadable: true }), 'TERMS_REQUIRED');
});

test('terms: false read WITHOUT lead permissions is not evidence — never "not accepted"', () => {
  // The production case: an old token (6 scopes) read leadgen_tos_accepted=false.
  const c = { tosField: false, readWithLeadPermissions: false };
  assert.equal(leadTermsEvidence(c), 'UNKNOWN');
  assert.equal(state(GRANTED_OLD, c), 'PERMISSIONS_MISSING', 'missing permissions come first');
  assert.notEqual(state(GRANTED_ALL, { ...c, formsReadable: true }), 'TERMS_REQUIRED');
});

test('terms: unknown, API error, page and form access are distinct states', () => {
  assert.equal(state(GRANTED_ALL, { formsReadable: true }), 'TERMS_UNKNOWN');
  assert.equal(state(GRANTED_ALL, null), 'TERMS_UNKNOWN', 'never checked is unknown, not refused');
  assert.equal(state(GRANTED_ALL, { error: 'OAuthException' }), 'META_ERROR');
  assert.equal(state(GRANTED_ALL, { formsReadable: false }), 'FORM_ACCESS_UNAVAILABLE');
  assert.equal(state(GRANTED_ALL, null, { pageSelected: false }), 'PAGE_UNAVAILABLE');
  assert.equal(state(GRANTED_OLD, null), 'PERMISSIONS_MISSING');
});

test('terms: a capability proves acceptance — the Page already has forms, or Meta dated the acceptance', () => {
  assert.equal(leadTermsEvidence({ formsCount: 2, tosField: false, readWithLeadPermissions: false }), 'ACCEPTED');
  assert.equal(leadTermsEvidence({ acceptanceTime: true }), 'ACCEPTED');
  assert.equal(state(GRANTED_ALL, { formsCount: 1, formsReadable: true }), 'READY');
});

test('terms: the stored capability round-trips and an unknown outcome is UNCONFIRMED, never NOT_ACCEPTED', () => {
  const c = leadCheckOf({ leadgen_tos_checked_at: '2026-10-02T06:44:03Z', leadgen_tos_accepted: true, leadgen_tos_read_with_lead_permissions: true, leadgen_forms_readable: true, leadgen_forms_count: 3 });
  assert.equal(leadTermsEvidence(c), 'ACCEPTED');
  assert.equal(leadCheckOf({}), null);
  assert.equal(termsOutcome({ pageAtOpen: 'p', pageNow: 'p', terms: 'UNKNOWN', windowOpen: false }), 'UNCONFIRMED');
  assert.equal(termsOutcome({ pageAtOpen: 'p', pageNow: 'p', terms: 'ACCEPTED', windowOpen: false }), 'ACCEPTED');
});

test('terms: "Check with Meta" does a fresh server read and the UI takes the new state at once', () => {
  const idx = read('supabase/functions/meta-ads-api/index.ts');
  const recheck = idx.slice(idx.indexOf("case 'forms_recheck'"), idx.indexOf("case 'forms_recheck'") + 4000);
  assert.match(recheck, /graph\('\/me\/permissions'/);
  assert.match(recheck, /checkLeadPage\(/);
  const dest = read('src/components/metaAds/builder/DestinationStep.tsx');
  assert.match(dest, /recheckLeadForms/);
  assert.doesNotMatch(read('src/lib/metaAds/instantForms.ts'), /1202088052996866/, 'no Page is hard-coded');
});

/* ── LOCATIONS ─────────────────────────────────────────────────────── */

test('location: a new campaign starts with no places — no US, UAE, Georgia, IP or locale default', () => {
  const aud = read('src/components/metaAds/builder/AudienceStep.tsx');
  assert.match(aud, /stored\?\.locations \?\? \[\]/);
  assert.doesNotMatch(aud, /defaultCountries|navigator\.language|geolocation/);
  const brief = read('src/components/metaAds/builder/BriefStep.tsx');
  assert.match(brief, /locations: \[\]/);
  const engine = read('supabase/functions/meta-ads-api/engine.ts');
  assert.match(engine, /normalizeIntent\(c\.targeting, \[\]\)/, 'the server adds no default country to targeting');
});

test('location: multilingual queries reach Meta as typed, then in Latin', () => {
  assert.deepEqual(queryVariants('თბილისი'), ['თბილისი', 'tbilisi']);
  assert.deepEqual(queryVariants('ვაკე'), ['ვაკე', 'vake']);
  assert.deepEqual(queryVariants('Тбилиси'), ['Тбилиси', 'Tbilisi']);
  assert.deepEqual(queryVariants('Ваке'), ['Ваке', 'Vake']);
  assert.deepEqual(queryVariants('Tbilisi'), ['Tbilisi']);
  assert.deepEqual(queryVariants('ქალაქი ბათუმი'), ['ბათუმი', 'batumi'], 'noise words are dropped');
  assert.equal(transliterate('ჭავჭავაძე'), 'chavchavadze');
  assert.equal(metaLocale('ka'), 'ka_GE');
  assert.equal(locationTypeOf('subcity'), 'neighborhood');
});

test('location: a street is recognised (Meta cannot target it) in any language', () => {
  for (const q of ['რუსთაველის გამზირი', 'Rustaveli Avenue', 'проспект Руставели', 'Chavchavadze street 12']) assert.ok(looksLikeStreet(q), q);
  for (const q of ['Tbilisi', 'ვაკე', 'Ваке', 'Batumi']) assert.ok(!looksLikeStreet(q), q);
});

test('location: a country is found by its name in any interface language', () => {
  assert.ok(countryNameMatches('GE', 'საქართველო'));
  assert.ok(countryNameMatches('GE', 'Грузия'));
  assert.ok(countryNameMatches('GE', 'georgia'));
  assert.ok(!countryNameMatches('US', 'საქართველო'));
});

const deps = { centroids: { GE: [43.4, 42.3], AE: [54, 24] }, georgiaBbox: [40, 41, 46.8, 43.6], point: placePoint, ring: circleRing, project };
const tbilisi = { type: 'city', key: 'c1', name: 'Tbilisi', countryCode: 'GE', radiusKm: 10, lat: 41.7151, lng: 44.8271 };
const batumi = { type: 'city', key: 'c2', name: 'Batumi', countryCode: 'GE', radiusKm: 10, lat: 41.6168, lng: 41.6367 };

test('map: 0 places = an empty, neutral view; nothing is drawn as a target', () => {
  const m = mapTargets([], null, deps);
  assert.equal(m.items.length, 0);
  assert.equal(m.scope, 'empty');
  assert.equal(m.georgiaWhole, false, 'Georgia is never highlighted unless targeted');
});

test('map: 1 place = its real circle; 2 places = both inside the fitted view', () => {
  const one = mapTargets([tbilisi], null, deps);
  assert.equal(one.items.length, 1);
  assert.equal(one.items[0].km, 10);
  assert.ok(one.items[0].ring.length > 10);
  const two = mapTargets([tbilisi, batumi], null, deps);
  assert.deepEqual(two.items.map((i) => i.n), [1, 2]);
  for (const l of [tbilisi, batumi]) {
    const [x, y] = project(l.lng, l.lat);
    assert.ok(x > two.view.x && x < two.view.x + two.view.w && y > two.view.y && y < two.view.y + two.view.h, `${l.name} is in view`);
  }
  assert.ok(two.view.w > one.view.w, 'the view widens to fit both');
});

test('map: removing a place removes it; housing floor redraws the radius; unknown positions are never guessed', () => {
  assert.equal(mapTargets([batumi], null, deps).items[0].name, 'Batumi');
  assert.equal(mapTargets([tbilisi], 25, deps).items[0].km, 25);
  const nowhere = mapTargets([{ type: 'neighborhood', key: 'n1', name: 'Somewhere unknown', countryCode: 'XX' }], null, deps);
  assert.equal(nowhere.items[0].drawn, false);
  const gm = read('src/components/metaAds/builder/GeoMap.tsx');
  assert.doesNotMatch(gm, /\bhome\b\s*[?:]|homeLat|navigator\.geolocation/, 'no home / device marker');
});

test('map: visible beside the list, not folded away', () => {
  const aud = read('src/components/metaAds/builder/AudienceStep.tsx');
  assert.match(aud, /<GeoMap/);
  assert.match(aud, /data-mm-geo-empty/);
});

/* ── LEAD FORMS ────────────────────────────────────────────────────── */

const spec = (o = {}) => ({
  name: 'Vake viewing', locale: 'en', contactFields: ['FULL_NAME', 'PHONE'], questions: ['timeframe'],
  privacyPolicyUrl: 'https://agency.example/privacy', thankYouMessage: 'We will call you', ...o,
});

test('lead form: privacy is required and must be a https link', () => {
  assert.ok(validateLeadFormSpec(spec({ privacyPolicyUrl: '' })).some((i) => i.code === 'PRIVACY_URL_REQUIRED'));
  assert.ok(validateLeadFormSpec(spec({ privacyPolicyUrl: 'http://x.example' })).some((i) => i.code === 'PRIVACY_URL_REQUIRED'));
  assert.equal(validateLeadFormSpec(spec()).length, 0);
  assert.ok(privacyIsHomatch('https://homatch.live/privacy'));
  assert.equal(leadFormReadiness(spec({ privacyPolicyUrl: 'https://homatch.live/privacy' })).find((r) => r.key === 'privacy').state, 'warn');
});

test('lead form: unsupported and sensitive questions are refused before Meta', () => {
  assert.ok(validateLeadFormSpec(spec({ questions: ['religion'] })).some((i) => i.code === 'QUESTION_UNKNOWN'));
  assert.ok(isSensitiveQuestion('What is your religion?'));
  assert.ok(!isSensitiveQuestion('Do you want a terrace?'));
  const bad = spec({ customQuestions: [{ label: 'What is your monthly income?', options: ['Low', 'High'] }] });
  assert.ok(validateLeadFormSpec(bad).some((i) => i.code === 'QUESTION_SENSITIVE'));
  assert.ok(validateLeadFormSpec(spec({ customQuestions: [{ label: 'Floor?', options: ['Low'] }] })).some((i) => i.code === 'CUSTOM_QUESTION_OPTIONS'));
});

test('lead form: a complete form is ready; intro, custom questions and thank-you reach the payload and preview', () => {
  const s = spec({ intro: { title: 'New in Vake', points: ['Viewings this week'] }, customQuestions: [{ label: 'Which floor?', options: ['Low', 'High'] }], thankYouTitle: 'Thanks!' });
  assert.ok(leadFormReadiness(s).every((r) => r.state !== 'todo'));
  const p = leadFormPayload(s);
  assert.ok(JSON.stringify(p).includes('Which floor?'));
  assert.ok(String(p.context_card).includes('New in Vake'));
  const pv = leadFormPreview(s);
  assert.ok(JSON.stringify(pv).includes('New in Vake'));
});

test('lead form: suggestions follow the campaign — none for a non-property business', () => {
  assert.deepEqual(suggestLeadQuestions({ isProperty: false }), []);
  assert.ok(suggestLeadQuestions({ isProperty: true, dealKind: 'SALE' }).includes('budget'));
  assert.ok(!suggestLeadQuestions({ isProperty: true, dealKind: 'RENT_LONG' }).includes('budget'));
});

test('lead form: Meta creation happens only after the explicit confirm; a terms refusal is reported, not hidden', () => {
  const b = read('src/components/metaAds/builder/LeadFormBuilder.tsx');
  assert.match(b, /data-mm-lf-confirm-create/);
  const calls = [...b.matchAll(/createPremiumLeadForm\(/g)].length;
  assert.equal(calls, 1, 'one creation call');
  const confirmAt = b.indexOf('data-mm-lf-confirm=');
  assert.ok(confirmAt > 0);
  assert.match(b, /LEAD_TERMS_REQUIRED/);
  const actions = read('supabase/functions/meta-ads-api/actions.ts');
  assert.match(actions, /LEAD_TERMS_REQUIRED/);
});

/* ── CREATIVE AI ───────────────────────────────────────────────────── */

const concept = (i, extra = {}) => ({ title: `Concept ${i}`, angle: 'Calm city living', visual: 'Warm evening light', composition: 'Building left third', cta: 'Book a viewing', safeArea: 'TOP', ...extra });

test('creative AI: analysis is validated — 2–3 concepts, promised results removed, junk refused', () => {
  const a = validateAnalysis({ subject: 'A modern building', strengths: ['Good light'], issues: [], concepts: [concept(1), concept(2), concept(3), concept(4)] });
  assert.equal(a.concepts.length, 3);
  assert.deepEqual(a.concepts.map((c) => c.id), ['c1', 'c2', 'c3']);
  assert.equal(validateAnalysis({ subject: 'x', concepts: [concept(1)] }), null, 'one concept is not enough');
  assert.equal(validateAnalysis(null), null);
  const claims = validateAnalysis({ subject: 's', strengths: ['Will increase conversions by 40%'], concepts: [concept(1, { angle: 'Proven to double leads' }), concept(2), concept(3)] });
  assert.deepEqual(claims.strengths, [], 'a promised result is never shown');
  assert.equal(claims.concepts.length, 2, 'a concept built on a promise is dropped');
  assert.ok(!claims.concepts.some((c) => /double/i.test(c.angle)));
});

test('creative AI: the cache key changes with the image or the campaign, not with re-opening', () => {
  const ctx = { goal: 'LEADS_ON_META', headline: 'Vake', locations: ['Tbilisi'] };
  assert.equal(analysisFingerprint('u/a.jpg', ctx), analysisFingerprint('u/a.jpg', { ...ctx }));
  assert.notEqual(analysisFingerprint('u/a.jpg', ctx), analysisFingerprint('u/b.jpg', ctx));
  assert.notEqual(analysisFingerprint('u/a.jpg', ctx), analysisFingerprint('u/a.jpg', { ...ctx, headline: 'Saburtalo' }));
});

test('creative AI: the prompt is built server-side, keeps the subject truthful, renders no text and carries the instruction', () => {
  const p = generationPrompt({ analysis: { subject: 'A brick building in Vake' }, concept: { id: 'c1', ...concept(1) }, ctx: { propertyType: 'apartment', city: 'Tbilisi' }, instruction: 'Focus on the view', variation: 1 });
  assert.match(p, /brick building in Vake/);
  assert.match(p, /Do NOT render any words/);
  assert.match(p, /Do not add rooms/);
  assert.match(p, /Focus on the view/);
  assert.notEqual(p, generationPrompt({ analysis: { subject: 'A brick building in Vake' }, concept: { id: 'c1', ...concept(1) }, ctx: {}, variation: 0 }), 'variations differ');
  assert.equal(sanitizeInstruction('Add the logo of Nike').rejected, true);
  assert.equal(sanitizeInstruction('Make it more premium').text, 'Make it more premium');
  assert.equal(sanitizeInstruction('x'.repeat(500)).text.length, 240);
});

test('creative AI: 3 variations by default, 1 for a refine; size follows the source shape', () => {
  assert.equal(MAX_VARIATIONS, 3);
  assert.equal(clampVariations(undefined), 3);
  assert.equal(clampVariations(9), 3);
  assert.equal(clampVariations(0), 1);
  assert.equal(clampVariations(3, true), 1);
  assert.equal(sizeForAspect(1080, 1920), '1024x1536');
  assert.equal(sizeForAspect(1920, 1080), '1536x1024');
  assert.equal(sizeForAspect(1080, 1080), '1024x1024');
});

test('creative AI: measured cost = tokens × price book (gpt-image-1 medium portrait ≈ 6.3¢ output)', () => {
  assert.equal(tokenCostCents({ inputTokens: 0, outputTokens: 1584 }, { input: 10, output: 40, perUnits: 1_000_000 }), 6.336);
  assert.equal(tokenCostCents({ inputTokens: 1000, outputTokens: 0 }, { input: 10, output: 40, perUnits: 1_000_000 }), 1);
});

test('creative AI: a generated image is used only when it is a real PNG of the requested size', () => {
  const png = new Uint8Array(9000);
  png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const put = (o, v) => { png[o] = (v >>> 24) & 255; png[o + 1] = (v >>> 16) & 255; png[o + 2] = (v >>> 8) & 255; png[o + 3] = v & 255; };
  put(16, 1024); put(20, 1536);
  assert.ok(validGeneratedImage(png, { width: 1024, height: 1536 }));
  assert.ok(!validGeneratedImage(png, { width: 1024, height: 1024 }));
  assert.ok(!validGeneratedImage(png.slice(0, 100), { width: 1024, height: 1536 }));
});

test('creative AI: roles map to real HOMATCH behaviour — no invented Meta priority field', () => {
  assert.deepEqual(roleToCreative('PRIMARY'), { priority: true, sortBias: 0 });
  assert.equal(roleToCreative('TEST').priority, false);
  const srv = read('supabase/functions/meta-ads-api/creativeAi.ts');
  assert.doesNotMatch(srv, /priority_level|meta_priority/);
});

test('creative AI: nothing runs on upload; the panel loads lazily on an explicit click', () => {
  const cs = read('src/components/metaAds/builder/CreativeStep.tsx');
  const upload = cs.slice(cs.indexOf('const upload = async'), cs.indexOf('const aiCreative ='));
  assert.doesNotMatch(upload, /aiAnalyze|aiGenerate|creative_ai|setImproveFor/);
  assert.match(cs, /lazy\(\(\) => import\('\.\/CreativeAiPanel'\)\)/);
  assert.match(cs, /data-mm-ai-improve/);
  const svc = read('src/services/metaAds.ts');
  const addCreative = svc.slice(svc.indexOf('export async function addCreative'), svc.indexOf('export async function updateCreative'));
  assert.doesNotMatch(addCreative, /creative_ai/);
});

test('creative AI: generation needs a confirm, one idempotency key per request, and a price from the server', () => {
  const panel = read('src/components/metaAds/builder/CreativeAiPanel.tsx');
  assert.match(panel, /data-mm-ai-confirm-go/);
  assert.match(panel, /keyRef\.current \?\?= crypto\.randomUUID\(\)/);
  assert.match(panel, /aiQuote\(/);
  assert.doesNotMatch(panel, /credits:\s*\d/, 'no price is computed in the browser');
  const srv = read('supabase/functions/meta-ads-api/creativeAi.ts');
  assert.match(srv, /IDEMPOTENCY_KEY_REQUIRED/);
  assert.match(srv, /eq\('idempotency_key', key\)/);
  assert.match(srv, /replay: true/);
  assert.match(srv, /idempotencyKey: `meta-ai:\$\{job\.id\}`/);
  assert.match(srv, /requireFullBudget: true, allowIncluded: false/);
  assert.match(srv, /billing_price_quote/);
  assert.doesNotMatch(srv, /body\.(price|credits|cost)/, 'never a client price');
});

test('creative AI: insufficient credits → 402; no usable image → full release; partial → only delivered images; stale → release', () => {
  const srv = read('supabase/functions/meta-ads-api/creativeAi.ts');
  assert.match(srv, /INSUFFICIENT_CREDITS[\s\S]{0,200}402/);
  assert.match(srv, /if \(!images\.length\) \{\s*await releaseExecution\(sb, grant, 'NO_USABLE_IMAGES'/);
  assert.match(srv, /settleExecution\(sb, grant, actual, images\.length < variations \? 'PARTIAL' : 'SUCCESS'\)/);
  assert.match(srv, /usage\.inputTokens \+= g\.inTok/, 'cost counts only saved images');
  assert.match(srv, /if \(!settled\) await releaseExecution\(sb, grant, 'GENERATION_ERROR'\)/);
  assert.match(srv, /releaseExecution\(sb, grant, 'STALE_JOB'\)/);
});

test('creative AI: ownership is checked server-side; prompts and reservations never reach the client; original untouched', () => {
  const srv = read('supabase/functions/meta-ads-api/creativeAi.ts');
  assert.match(srv, /from\('meta_creatives'\)\.select\('\*'\)\.eq\('id', String\(id\)\)\.eq\('user_id', uid\)/);
  assert.match(srv, /startsWith\(`\$\{uid\}\/`\)/);
  const pub = srv.slice(srv.indexOf('async function publicJob'), srv.indexOf('async function quoteFor'));
  assert.doesNotMatch(pub, /reservation_id|prompt|instruction/);
  const use = srv.slice(srv.indexOf("case 'creative_ai_use'"), srv.indexOf('default:', srv.indexOf("case 'creative_ai_use'")));
  assert.match(use, /from\('meta_creatives'\)\.insert/);
  assert.doesNotMatch(use, /from\('meta_creatives'\)\.update/, 'the original creative is never rewritten');
  assert.match(use, /sourcePath/, 'lineage is stored');
  assert.ok(GENERATION_STAGES.includes('GENERATING'));
});

test('creative AI: migration — the product, the price book, one job per key, owner-only reads', () => {
  const m = read('supabase/migrations/20261006100000_meta_ads_creative_ai.sql') + read('supabase/migrations/20261006100100_meta_ads_creative_ai_pricing.sql');
  assert.match(m, /'META_AD_IMAGE_GEN'/);
  assert.match(m, /'OPENAI', 'gpt-image-1', 'OUTPUT_TOKEN', 40\.00/);
  assert.match(m, /unique \(user_id, idempotency_key\)/);
  assert.match(m, /for select to authenticated/);
  assert.doesNotMatch(m, /grant (insert|update|delete)/i);
  assert.match(m, /'forms_recheck','brief_interpret','delivery_estimate'/, 'the rate-limit events are allowed at last');
});

/* ── VIDEO ─────────────────────────────────────────────────────────── */

test('video: cover sampling skips the edges and picks the sharp, well-exposed frame', () => {
  const ts = sampleTimes(20, 8);
  assert.equal(ts.length, 8);
  assert.ok(ts[0] > 0 && ts[ts.length - 1] < 20);
  assert.deepEqual(sampleTimes(0.5), [0.25]);
  const black = { t: 1, luma: 5, contrast: 2, sharpness: 0.5 };
  const blur = { t: 2, luma: 120, contrast: 30, sharpness: 2 };
  const good = { t: 3, luma: 130, contrast: 60, sharpness: 20 };
  assert.equal(bestCover([black, blur, good]).t, 3);
  assert.ok(coverScore(good) > coverScore(blur) && coverScore(blur) > coverScore(black));
  assert.equal(bestCover([good, { ...good, t: 9 }]).t, 3, 'deterministic: ties go to the earlier frame');
  assert.equal(formatTime(75.4), '1:15');
});

test('video: frame statistics separate a flat frame from a detailed one', () => {
  const w = 8, h = 8;
  const flat = new Uint8ClampedArray(w * h * 4).fill(128);
  const checker = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { const v = ((i % w) + Math.floor(i / w)) % 2 ? 230 : 30; checker.set([v, v, v, 255], i * 4); }
  assert.ok(frameStats(0, checker, w, h, 1).sharpness > frameStats(0, flat, w, h, 1).sharpness);
  assert.equal(frameStats(0, flat, w, h, 1).contrast, 0);
});

test('video: a real player with controls, a chosen cover, and the cover sent to Meta without touching the video', () => {
  const v = read('src/components/metaAds/builder/VideoCreative.tsx');
  for (const a of ['data-mm-video-play', 'data-mm-video-seek', 'data-mm-video-mute', 'data-mm-video-volume', 'data-mm-video-full', 'data-mm-video-use-frame', 'data-mm-video-auto']) assert.match(v, new RegExp(a));
  assert.match(v, /saveVideoCover/);
  const svc = read('src/services/metaAds.ts');
  assert.match(svc, /covers\/\$\{crypto\.randomUUID\(\)\}\.jpg/);
  const eng = read('supabase/functions/meta-ads-api/engine.ts');
  assert.match(eng, /m0\.cover\?\.path/);
  assert.match(eng, /imageHash = await uploadImage\(acct\.external_id, new Uint8Array\(await cov\.arrayBuffer\(\)\)/);
});
