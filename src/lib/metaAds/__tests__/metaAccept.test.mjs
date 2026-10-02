// META ADS — FINAL ACCEPTANCE. What the owner saw on a real phone, pinned:
// no raw key ever, every readiness item leads to its field, one universal
// location search, the connection says ONE thing that is missing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CHECK_TARGET, DETAIL_KEYS, GAP_TARGET, checkTitleKey, issueTarget, severityOf } from '../readiness.ts';
import { preflightDetails } from '../../../components/metaAds/builder/steps.ts';
import { META_ACCEPT_STRINGS as A } from '../../../../scripts/meta-accept-i18n-data.mjs';

const read = (p) => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8');
const bundle = read('src/i18n/translations.ts');
const LOCALE_START = ['const en = {', 'const ka: ', 'const ru: ', 'const tr: ', 'const ar: ', 'const he: '].map((m) => bundle.indexOf(m));
/** Is `key` defined in every one of the six locale blocks? */
function inAllLocales(key) {
  return LOCALE_START.every((start, i) => {
    const end = LOCALE_START[i + 1] ?? bundle.length;
    return bundle.slice(start, end).includes(`\n  ${key}: `);
  });
}

const engine = read('supabase/functions/meta-ads-api/engine.ts');
const preflightSrc = engine.slice(engine.indexOf('export async function runPreflight'), engine.indexOf('export async function domainCheck'));

test('READINESS: every check the server can emit has a title in six languages and a field to fix it', () => {
  const keys = [...new Set([...preflightSrc.matchAll(/add\('([a-z_]+)'/g)].map((m) => m[1]))];
  assert.ok(keys.length >= 20, `found ${keys.length} checks`);
  for (const k of keys) {
    assert.ok(CHECK_TARGET[k], `${k} has a target step/field`);
    assert.equal(checkTitleKey(k), `mads_check_${k}`);
    assert.ok(inAllLocales(`mads_check_${k}`), `mads_check_${k} in all six locales`);
  }
  assert.equal(checkTitleKey('something_new'), 'mm_r_check_other', 'an unknown check is "needs attention", never its id');
  assert.ok(inAllLocales('mm_r_check_other'));
});

test('READINESS: every detail code becomes words — never a key, a rule id or a scope name', () => {
  for (const k of DETAIL_KEYS) assert.ok(inAllLocales(k), `${k} in all six locales`);
  const targeting = read('src/lib/metaAds/targeting.ts');
  const plan = read('src/lib/metaAds/strategy.ts');
  const codes = new Set([
    ...[...targeting.matchAll(/code: '([A-Z_]+)'/g)].map((m) => m[1]),
    ...[...plan.matchAll(/code: '([A-Z_]+)'/g)].map((m) => m[1]),
    ...[...preflightSrc.matchAll(/'([A-Z][A-Z_]{3,})'/g)].map((m) => m[1]),
  ]);
  const skip = /^(READY|WARNING|ACTION_REQUIRED|CUSTOM|PAGE|AD_ACCOUNT|INSTAGRAM|PIXEL|LEAD_FORM|WHATSAPP|SUSPENDED|REAL|MOCK|MANUAL_REVIEW|NEEDS_CHANGES|BLOCKED|IN_REVIEW|APPROVED|OPEN|HIGH|ENGAGEMENT|LEADS_ON_META|LEADS_ON_WEBSITE|SITE_REGISTRATIONS|PROMOTE|BLOCKING_ERROR|PAGE_REQUIRED|NONE|DISCONNECTED|META_FORM|MESSAGING|WEBSITE)$/;
  for (const c of codes) {
    if (skip.test(c)) continue;
    const d = preflightDetails(c);
    for (const { key } of d) assert.ok(inAllLocales(key), `${c} → ${key} in all six locales`);
  }
  assert.deepEqual(preflightDetails('LOCATION_REQUIRED'), [{ key: 'madsb_pfd_location_required', value: 'LOCATION_REQUIRED' }].map((x) => ({ ...x, value: '' })));
  assert.deepEqual(preflightDetails('ads_management,ads_read,business_management'), [{ key: 'mm_r_pfd_permissions', value: '' }]);
  assert.deepEqual(preflightDetails('SOME_FUTURE_CODE'), [], 'unknown → left out (the check title still speaks)');
  assert.deepEqual(preflightDetails('meta_err_<script>'), [], 'only a well-formed meta_err_ key passes');
});

test('READINESS: the screen renders titles through the map — the raw `mads_check_${key}` lookup is gone', () => {
  const review = read('src/components/metaAds/builder/ReviewStep.tsx');
  assert.doesNotMatch(review, /t\(`mads_check_\$\{ch\.key\}`/);
  assert.match(review, /t\(checkTitleKey\(ch\.key\) as never\)/);
  const steps = read('src/components/metaAds/builder/steps.ts');
  assert.match(steps, /DETAIL_KEYS\.has\(key\) \? \{ key, value: '' \} : null/, 'no unshipped key is ever built');
});

test('READINESS: issue code → step → field; BLOCKER / WARNING kept apart', () => {
  assert.deepEqual(issueTarget('targeting', 'LOCATION_REQUIRED'), { step: 'audience', field: 'locations' });
  assert.deepEqual(issueTarget('targeting', 'AGE_RANGE_INVALID'), { step: 'audience', field: 'who' });
  assert.deepEqual(issueTarget('creatives', 'HEADLINE_REQUIRED,NO_MEDIA'), { step: 'creative', field: 'headline' });
  assert.deepEqual(issueTarget('permissions', 'ads_management'), { step: 'account', field: 'connect' });
  assert.deepEqual(issueTarget('balance', 'SHORT_100'), { step: 'review', field: 'funding' });
  assert.deepEqual(issueTarget('unknown_check'), { step: 'review', field: 'check' });
  assert.equal(severityOf('ACTION_REQUIRED'), 'BLOCKER');
  assert.equal(severityOf('WARNING'), 'WARNING');
  assert.equal(severityOf('READY'), null);
  assert.equal(severityOf(undefined, false), 'BLOCKER');
});

test('READINESS: every field a link can land on exists on screen', () => {
  const sources = ['src/pages/outreach/MetaAdsCreatePage.tsx', ...['AccountPanel', 'DestinationStep', 'AudienceStep', 'BudgetStep', 'CreativeStep', 'ReviewStep', 'FundingCard']
    .map((f) => `src/components/metaAds/builder/${f}.tsx`)].map(read).join('\n');
  const fields = new Set([...Object.values(CHECK_TARGET), ...Object.values(GAP_TARGET)].map((x) => x.field));
  fields.delete('check'); // the check itself, on the review step
  for (const f of fields) {
    const anchored = sources.includes(`data-mm-field="${f}"`) || sources.includes(`field="${f}"`)
      || (f === 'page' || f === 'ad_account') && /data-mm-field=\{kind === 'PAGE' \? 'page' : kind === 'AD_ACCOUNT' \? 'ad_account'/.test(sources);
    assert.ok(anchored, `field "${f}" has an anchor`);
  }
  const page = read('src/pages/outreach/MetaAdsCreatePage.tsx');
  assert.match(page, /if \(field\) focusField\(field\);/);
  assert.match(page, /left=\{openSteps\.length\} onLeft=/, '"N left" is a link');
  assert.match(page, /data-mm-gap-link=/, 'the footer hint is a link');
  const focus = read('src/components/metaAds/builder/focusField.ts');
  assert.match(focus, /scrollIntoView\(\{ behavior: reduce \? 'auto' : 'smooth', block: 'center' \}\)/);
  assert.match(focus, /\.focus\(\{ preventScroll: true \}\)/);
  assert.match(focus, /\[data-mm-fold\]\[aria-expanded="false"\]/, 'a folded section opens');
  assert.doesNotMatch(focus, /setInterval/, 'bounded, never a poller');
});

test('copy: every new key has six real translations with the placeholders intact', () => {
  const ph = (s) => (s.match(/\{\{\w+\}\}/g) ?? []).sort().join();
  for (const [k, v] of Object.entries(A)) {
    assert.equal(v.length, 6, k);
    for (const s of v) { assert.ok(s.trim(), k); assert.equal(ph(s), ph(v[0]), `${k} placeholders`); }
    assert.ok(inAllLocales(k), `${k} applied`);
  }
});

/* ── LOCATION: one universal search ────────────────────────────────────── */

test('LOCATION: "საქართველო" and every other spelling of Georgia finds GE — from CLDR, no dictionary', async () => {
  const { countryNameMatches, rankResults, streetAreaParts, looksLikeStreet, queryVariants, SEARCH_TYPES } = await import('../geoQuery.ts');
  for (const q of ['საქართველო', 'Sakartvelo', 'Georgia', 'Грузия', 'Gürcistan', 'جورجيا', 'גאורגיה', 'GE']) assert.ok(countryNameMatches('GE', q), q);
  assert.ok(!countryNameMatches('DE', 'საქართველო'));
  assert.ok(countryNameMatches('TR', 'Турция') && countryNameMatches('TR', 'თურქეთი'));
  // Places: as typed, then the Latin spelling Meta's catalogue uses.
  assert.deepEqual(queryVariants('თბილისი'), ['თბილისი', 'tbilisi']);
  assert.deepEqual(queryVariants('Тбилиси'), ['Тбилиси', 'Tbilisi']);
  assert.deepEqual(queryVariants('ბათუმი'), ['ბათუმი', 'batumi']);
  assert.deepEqual(queryVariants('Батуми'), ['Батуми', 'Batumi']);
  assert.deepEqual([...SEARCH_TYPES.any], ['region', 'city', 'neighborhood', 'subcity'], 'one search, every kind Meta targets');
  // A street is never a city: only its other parts are asked, flagged as "nearest".
  assert.ok(looksLikeStreet('ჭავჭავაძის გამზირი 12'));
  assert.deepEqual(streetAreaParts('Vake, Chavchavadze Ave 12'), ['Vake']);
  assert.deepEqual(streetAreaParts('ჭავჭავაძის გამზირი 12'), []);
  // Ranking: an exact name (any script) first; the chosen country's places next.
  const rows = [{ type: 'city', name: 'Tbilisi Avenue', countryCode: 'US' }, { type: 'city', name: 'Tbilisi', countryCode: 'GE' }];
  assert.equal(rankResults(rows, 'თბილისი')[0].countryCode, 'GE');
  assert.equal(rankResults([{ type: 'city', name: 'Batumi', countryCode: 'TR' }, { type: 'city', name: 'Batumi', countryCode: 'GE' }], 'Batumi', 'GE')[0].countryCode, 'GE');
});

test('LOCATION: no tabs — one search; typed subtitles; cache, coalescing, retry; countries without Meta', () => {
  const picker = read('src/components/metaAds/builder/LocationPicker.tsx');
  assert.doesNotMatch(picker, /const TABS|aria-pressed=\{type ===/, 'the Country/Region/City tabs are gone');
  assert.match(picker, /geoSearch\(needle, 'any', lang, undefined, scopeCountry \?\? undefined\)/, 'the chosen country ranks, never filters');
  assert.match(picker, /const INFLIGHT = new Map/, 'identical questions share a request');
  assert.match(picker, /setTimeout\(r, 700\)/, 'one bounded retry with a pause');
  assert.match(picker, /if \(id !== reqId\.current\) return;/, 'a superseded answer is dropped');
  assert.match(picker, /needle\.length < MIN_CHARS/);
  assert.doesNotMatch(picker, /geolocation|navigator\.geolocation|ipapi|ip-api/i, 'no device or IP location');
  assert.match(picker, /export function placeSubtitle/);
  const api = read('supabase/functions/meta-ads-api/actions.ts');
  const geo = api.slice(api.indexOf("case 'geo_search'"), api.indexOf("case 'locale_search'"));
  assert.match(geo, /: 'any';/, 'the universal search is the default');
  assert.match(geo, /if \(tab === 'any'\) \{ log\(\{ meta: 'not_connected' \}\); return json\(\{ results: countries, reason: 'NOT_CONNECTED' \}\); \}/, 'countries work without Meta');
  assert.match(geo, /evt: 'meta_geo_search', tab, qlen: q\.length/, 'instrumented — the length, never the words');
  assert.doesNotMatch(geo, /evt: 'meta_geo_search'[^\n]*\bq: q\b/);
  assert.match(geo, /street \? streetAreaParts\(q\)\.flatMap\(queryVariants\)/);
  assert.match(geo, /\.\.\.\(street \? \{ nearest: true \} : \{\}\)/, 'a nearest area is labelled as such');
  const aud = read('src/components/metaAds/builder/AudienceStep.tsx');
  assert.match(aud, /data-mm-loc-chips=""/, 'chosen areas are removable chips');
});

/* ── META CONNECTION: the cleanest supported flow, the one thing missing ─ */

test('CONNECT: the Login for Business configuration is an admin setting, validated; never a credential', async () => {
  const { validateSetting, isCredentialKey } = await import('../adminSettings.ts');
  assert.deepEqual(validateSetting('meta_ads_login_config_id', '1234567890123456'), { ok: true, value: '1234567890123456' });
  assert.deepEqual(validateSetting('meta_ads_login_config_id', 'https://evil'), { ok: false, error: 'BAD_CONFIG_ID' });
  assert.deepEqual(validateSetting('meta_ads_login_config_id', 970930962712211), { ok: false, error: 'BAD_CONFIG_ID' });
  assert.equal(isCredentialKey('meta_ads_login_config_id'), false);
  const engine = read('supabase/functions/meta-ads-api/engine.ts');
  assert.match(engine, /loginConfigId: typeof m\.get\('meta_ads_login_config_id'\) === 'string' && \/\^\\d\{6,20\}\$\/\.test/);
  const shared = read('supabase/functions/_shared/metaAds.ts');
  assert.match(shared, /if \(override && \/\^\\d\{6,20\}\$\/\.test\(override\)\) return override;/);
});

test('CONNECT: a user-token configuration gets a long-lived token server-side; expiry is tracked and announced', () => {
  const shared = read('supabase/functions/_shared/metaAds.ts');
  const ex = shared.slice(shared.indexOf('export async function exchangeCodeForToken'), shared.indexOf('/* ── SIGNED REQUESTS'));
  assert.match(ex, /grant_type: 'fb_exchange_token'/);
  assert.match(ex, /method: 'POST'|tokenCall\(/, 'the exchange is a server-side POST');
  const cb = read('supabase/functions/meta-oauth/index.ts');
  assert.match(cb, /missing: missingBase/, 'the log names what Meta did not grant');
  assert.doesNotMatch(cb.slice(cb.indexOf("event: 'connected'") - 400, cb.indexOf("event: 'connected'") + 300), /token[,: ]+token\b|access_token/, 'never the token');
  const api = read('supabase/functions/meta-ads-api/index.ts');
  assert.match(api, /expires_soon: Number\.isFinite\(expiresAt\) && expiresAt > Date\.now\(\) && expiresAt - Date\.now\(\) < 7 \* 86_400_000/);
  const panel = read('src/components/metaAds/builder/AccountPanel.tsx');
  assert.match(panel, /t\(adsAccessMissing \? 'mm_r_pfd_permissions' :/, 'ONE actionable line when ad-account access is missing');
  assert.match(panel, /data-mm-connect-expiring=""/);
  assert.match(read('src/pages/outreach/MetaAdsPage.tsx'), /returnTo="\/outreach\/meta\?tab=connections"/, 'the workspace reconnect comes back to its tab');
});

/* ── HOMATCH INTELLIGENCE: optional, bounded, evidence-based ─────────────── */

test('INTELLIGENCE: hard constraints can never be crossed by a suggestion', async () => {
  const { violates, decide, prefsOf, ageFocus, proposalOf } = await import('../homatchIntelligence.ts');
  const c = { approvedDailyMinor: 1000, status: 'PAUSED', approvedLocationIds: ['city:1'], housingRestricted: false, exclusions: [] };
  const P = (kind, extra = {}) => ({ kind, entity: 'campaign', direction: 0, evidence: 'HIGH_CONFIDENCE', reasonCodes: [], ...extra });
  assert.equal(violates(P('RAISE_DAILY', { dailyMinor: 1200 }), c), 'BUDGET_INCREASE');
  assert.equal(violates(P('REDUCE_DAILY', { dailyMinor: 800 }), c), null);
  assert.equal(violates(P('CHANGE_GEOGRAPHY', { locations: ['city:1', 'country:TR'] }), c), 'GEO_EXPANSION');
  assert.equal(violates(P('CHANGE_OBJECTIVE'), c), 'OBJECTIVE_CHANGE');
  assert.equal(violates(P('ACTIVATE'), c), 'ACTIVATE_PAUSED', 'a paused campaign is never switched on');
  assert.equal(violates(P('FOCUS_AGE'), { ...c, housingRestricted: true }), 'SPECIAL_AD_CATEGORY');
  assert.equal(violates(P('DROP_EXCLUSION'), c), 'EXCLUSION_OVERRIDE');
  // Off by default; nothing is decided while off.
  assert.deepEqual(prefsOf(null), { enabled: false, optimiseFor: 'QUALITY' });
  assert.deepEqual(decide([P('REDUCE_DAILY', { dailyMinor: 800 })], prefsOf(null), c, [], 0), []);
  const on = prefsOf({ enabled: true });
  const now = 10 * 86_400_000;
  assert.equal(decide([P('RAISE_DAILY', { dailyMinor: 1200 })], on, c, [], now)[0].verdict, 'NEEDS_APPROVAL');
  assert.equal(decide([P('REDUCE_DAILY', { dailyMinor: 800, evidence: 'EARLY_SIGNAL' })], on, c, [], now)[0].reason, 'NOT_ENOUGH_EVIDENCE');
  // No oscillation: cooldown, and never the reverse of a recent change.
  assert.equal(decide([P('REDUCE_DAILY', { dailyMinor: 800, direction: -1 })], on, c, [{ entity: 'campaign', direction: 1, at: now - 86_400_000 }], now)[0].reason, 'COOLDOWN');
  assert.equal(decide([P('REDUCE_DAILY', { dailyMinor: 800, direction: -1 })], on, c, [{ entity: 'campaign', direction: 1, at: now - 4 * 86_400_000 }], now)[0].reason, 'WOULD_REVERSE');
  assert.equal(decide([P('REDUCE_DAILY', { dailyMinor: 800, direction: -1 })], on, c, [], now)[0].verdict, 'WITHIN_LIMITS');
  // Age focus only from measured data, never a preset split, never under the housing rule.
  const segs = [{ ageMin: 18, ageMax: 29, results: 20, qualified: 3, spendMinor: 5000 }, { ageMin: 30, ageMax: 65, results: 20, qualified: 12, spendMinor: 5000 }];
  const f = ageFocus(segs, 30, { housingRestricted: false });
  assert.equal(f.kind, 'FOCUS_AGE'); assert.equal(f.measuredShare, 0.8, 'the share proposed is the measured one');
  assert.equal(ageFocus(segs, 30, { housingRestricted: true }), null);
  assert.equal(ageFocus(segs.map((s) => ({ ...s, qualified: 1 })), 30, { housingRestricted: false }), null, 'too small a sample');
  assert.equal(proposalOf({ type: 'INCREASE', affected: 'campaign', confidence: 'HIGH_CONFIDENCE', reasonCodes: [], proposedDailyMinor: 1200 }).kind, 'RAISE_DAILY');
  const lib = read('src/lib/metaAds/homatchIntelligence.ts');
  assert.doesNotMatch(lib, /0\.7\b|70\s*%/, 'no hardcoded 70 % split');
});

test('INTELLIGENCE: an opt-in card on the Audience step; the campaign page only labels suggestions', () => {
  const aud = read('src/components/metaAds/builder/AudienceStep.tsx');
  assert.match(aud, /<IntelligenceCard value=\{campaign\.intelligence\}/);
  const card = read('src/components/metaAds/builder/IntelligenceCard.tsx');
  assert.match(card, /role="switch" aria-checked=\{prefs\.enabled\}/);
  const opt = read('src/components/metaAds/campaign/OptimizationSection.tsx');
  assert.match(opt, /data-mm-intel-verdict=\{v\.verdict\}/);
  assert.doesNotMatch(opt.slice(opt.indexOf('const verdictOf')), /actOnRecommendation\(r\.id, 'APPLY'[^)]*\)\s*;\s*\/\/ auto/, 'never auto-applied');
});

/* ── LEAD CENTER: a real-estate pipeline on the existing rows ────────────── */

test('LEAD CENTER: explainable quality from the person’s own answers; contact grouping never merges', async () => {
  const { autoQuality, contactMaterial, followUpBucket, priorityOf, funnelOf, breakdownOf, submissionsByContact, answerKey } = await import('../leadCenter.ts');
  assert.deepEqual(autoQuality({ fields: {}, answers: {} }), { quality: 'LOW', reasons: ['NO_REACHABLE_CONTACT'] });
  assert.equal(autoQuality({ fields: { phone_number: '+995 555 12 34 56' }, answers: {} }).quality, 'UNRATED', 'nothing answered is not LOW');
  const hi = autoQuality({ fields: { phone_number: '+995555123456' }, answers: { timeframe: 'ერთი თვის განმავლობაში', budget: '120000', agent_contact: 'yes' } });
  assert.equal(hi.quality, 'HIGH'); assert.ok(hi.reasons.includes('BUYING_SOON'), 'a Georgian answer maps to its option');
  assert.equal(answerKey('timeframe', 'В течение месяца'), 'now');
  assert.equal(contactMaterial({ fields: { phone_number: '+995 555 12-34-56' } }), 'p:995555123456');
  assert.equal(contactMaterial({ fields: { email: ' A@B.ge ' } }), 'e:a@b.ge');
  const leads = [
    { id: '1', status: 'NEW', received_at: '2026-10-02T08:00:00Z', contact_key: 'k1' },
    { id: '2', status: 'WON', received_at: '2026-09-20T08:00:00Z', contact_key: 'k1', campaign_id: 'c' },
    { id: '3', status: 'VIEWING', received_at: '2026-09-21T08:00:00Z', campaign_id: 'c' },
    { id: '4', status: 'LOST', received_at: '2026-09-22T08:00:00Z', campaign_id: 'c' },
  ];
  assert.equal(submissionsByContact(leads).get('k1'), 2, 'counted, both rows kept');
  const f = funnelOf(leads, 10000);
  assert.deepEqual([f.leads, f.qualified, f.viewing, f.won, f.lost], [4, 2, 2, 1, 1]);
  assert.equal(f.cost.perWon, 10000); assert.equal(f.cost.perQualified, 5000);
  assert.equal(funnelOf(leads, null).cost.perLead, null, 'no spend → no cost, never zero');
  assert.ok(!('roas' in f) && !('revenue' in f), 'no ROAS invented');
  assert.equal(breakdownOf(leads, 'campaign_id')[0].enough, false, 'below the sample threshold');
  const now = new Date('2026-10-02T12:00:00Z');
  assert.equal(followUpBucket('2026-10-02T09:00:00Z', now, 'Asia/Tbilisi'), 'OVERDUE');
  assert.equal(followUpBucket('2026-10-02T15:00:00Z', now, 'Asia/Tbilisi'), 'TODAY');
  assert.equal(followUpBucket('2026-10-05T09:00:00Z', now, 'Asia/Tbilisi'), 'UPCOMING');
  assert.equal(priorityOf({ ...leads[0], follow_up_at: '2026-10-01T09:00:00Z' }, now).reason, 'FOLLOW_UP_OVERDUE');
  assert.equal(priorityOf(leads[0], now).reason, 'NEW_UNCONTACTED');
  assert.equal(priorityOf(leads[1], now).score, 0, 'a closed lead is never "call first"');
});

test('LEAD CENTER: schema — owner edits the pipeline, the server owns identity; a timeline; Realtime by RLS', () => {
  const m = read('supabase/migrations/20261008100100_meta_lead_center.sql');
  assert.match(m, /or new\.contact_key is distinct from old\.contact_key then\s+raise exception 'META_ADS_SERVER_FIELD'/);
  assert.match(m, /if new\.quality is distinct from old\.quality then new\.quality_source := 'MANUAL'; end if;/, 'a manual rating stays');
  assert.match(m, /revoke insert, update, delete, truncate, references, trigger on public\.meta_lead_events from authenticated, anon;/);
  assert.match(m, /create policy meta_lead_events_select on public\.meta_lead_events\s+for select using \(user_id = public\.auth_user_id\(\) or public\.is_admin\(\)\)/);
  assert.match(m, /Notes are recorded as "changed", never copied/);
  assert.doesNotMatch(m.slice(m.indexOf('meta_lead_events_log')), /new\.note\b[^\n]*insert|to_value[^\n]*new\.note/, 'no note text in the timeline');
  assert.match(m, /check \(jsonb_typeof\(intelligence\) = 'object' and pg_column_size\(intelligence\) <= 2048\)/);
  assert.match(read('supabase/migrations/20261008100200_meta_leads_realtime.sql'), /alter publication supabase_realtime add table public\.meta_leads/);
  const ingest = read('supabase/functions/_shared/metaLeads.ts');
  assert.match(ingest, /sha256Hex\(`\$\{uid\}\|\$\{material\}`\)/, 'the key is scoped to the owner and hashed');
  const center = read('src/components/metaAds/workspace/LeadsCenter.tsx');
  assert.match(center, /\.on\('postgres_changes', \{ event: '\*', schema: 'public', table: 'meta_leads' \}/);
  assert.doesNotMatch(center, /setInterval/, 'no polling');
  const drawer = read('src/components/metaAds/workspace/LeadRecordDrawer.tsx');
  assert.match(drawer, /mm_lc_draft_never_sent/);
  assert.doesNotMatch(drawer, /sendMessage|send_whatsapp|functions\.invoke\('.*send/i, 'a draft is never sent');
});

test('CONNECT: "Meta connected" with ONE missing requirement when ad-account access was not granted', async () => {
  const { adsAccessMissing } = await import('../readiness.ts');
  // Production on 2026-10-02 10:30: six scopes, none of the ads ones.
  assert.equal(adsAccessMissing({ health: 'PERMISSION_MISSING', missing_scopes: ['ads_management', 'ads_read', 'business_management'] }), true);
  assert.equal(adsAccessMissing({ health: 'PERMISSION_MISSING', missing_scopes: ['pages_read_engagement'] }), false);
  assert.equal(adsAccessMissing({ health: 'CONNECTED', missing_scopes: [] }), false);
});

test('CONNECT: a return from Meta refreshes once — a stale ?connect= re-applied by a later step change is never a second return', () => {
  const page = read('src/pages/outreach/MetaAdsCreatePage.tsx');
  assert.match(page, /prev\.set\('step', next\); prev\.delete\('connect'\);/, 'a step change never carries ?connect= forward');
  const hook = read('src/components/metaAds/builder/useMetaConnect.ts');
  assert.match(hook, /if \(consumed && refreshFor !== `\$\{location\.pathname\}\$\{location\.search\}`\)/, 'consumed once per page load');
});
