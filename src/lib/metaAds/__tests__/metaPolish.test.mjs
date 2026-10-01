// Meta Ads production polish: Leads on Facebook/Instagram decided honestly,
// campaign owners visible to Admin only, the audience a property ad runs with
// stored as it runs, one CTA rule for payload/preview/editor, and capacity
// pressure that actually slows optional analytics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { instantFormsState, missingInstantFormScopes, INSTANT_FORM_PERMISSIONS } from '../instantForms.ts';
import { campaignMatchesSearch, personSearchText } from '../adminView.ts';
import { ctaOptions, resolveCta, creativeParams, GOAL_SPECS } from '../payload.ts';
import { housingNormalized, effectiveRadiusKm } from '../../../components/metaAds/builder/masterLogic.ts';
import { applyTargeting } from '../targeting.ts';
import { pressureOf, allowance } from '../rateLimit.ts';

const read = (p) => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8');
const T = read('src/i18n/translations.ts');
/** The six values of a key, in bundle order (en first). */
const values = (key) => [...T.matchAll(new RegExp(`^  ${key}: (.*),$`, 'gm'))].map((m) => m[1]);
const SCOPE_NAMES = /leads_retrieval|pages_manage_ads|pages_manage_metadata|ads_management|business_management|pages_show_list|pages_read_engagement/;

/* ── A. Instant Forms ─────────────────────────────────────────────────── */

test('Instant Forms: the switch on but permissions missing is safely unavailable; granted is available', () => {
  const req = INSTANT_FORM_PERMISSIONS;
  const base = ['ads_management', 'ads_read', 'business_management', 'pages_show_list', 'pages_read_engagement', 'public_profile'];
  assert.equal(instantFormsState({ goalEnabled: true, granted: base, required: req, offeredByLogin: false }), 'COMING_SOON', 'production today');
  assert.equal(instantFormsState({ goalEnabled: true, granted: base, required: req, offeredByLogin: true }), 'RECONNECT');
  assert.equal(instantFormsState({ goalEnabled: true, granted: [...base, ...req], required: req, offeredByLogin: false }), 'AVAILABLE');
  assert.equal(instantFormsState({ goalEnabled: true, granted: [...base, 'leads_retrieval'], required: req, offeredByLogin: false }), 'COMING_SOON', 'all three, not some');
  assert.equal(instantFormsState({ goalEnabled: false, granted: [...base, ...req], required: req, offeredByLogin: true }), 'DISABLED');
  assert.equal(instantFormsState({ goalEnabled: true, granted: [], required: req, offeredByLogin: false, mock: true }), 'AVAILABLE');
  assert.deepEqual(missingInstantFormScopes(base, req), ['leads_retrieval', 'pages_manage_ads', 'pages_manage_metadata']);
  // One list: the UI's copy equals the server's.
  assert.match(read('supabase/functions/_shared/metaAds.ts'), new RegExp(`INSTANT_FORM_SCOPES = ${JSON.stringify([...req]).replace(/"/g, "'").replace(/,/g, ', ').replace(/[[\]]/g, '\\$&')}`));
});

test('Instant Forms: the server decides the state; permission checks are not weakened', () => {
  const api = read('supabase/functions/meta-ads-api/index.ts');
  assert.match(api, /instant_forms: instantForms,/);
  assert.match(api, /contains\('granted_scopes', INSTANT_FORM_SCOPES\)/, '"offered" = some connection already holds them');
  // Creating forms and subscribing the page still require the permissions.
  assert.match(api, /if \(mode === 'REAL' && !hasScopes\(formConn\?\.granted_scopes, INSTANT_FORM_SCOPES\)\)/);
  assert.match(read('supabase/functions/meta-ads-api/actions.ts'), /if \(mode === 'REAL' && !hasScopes\(conn\?\.granted_scopes, INSTANT_FORM_SCOPES\)\)/);
  // …and the refusal names no permission to the customer.
  for (const f of ['supabase/functions/meta-ads-api/index.ts', 'supabase/functions/meta-ads-api/actions.ts']) {
    assert.doesNotMatch(read(f), /needed: INSTANT_FORM_SCOPES/, f);
  }
});

test('Instant Forms: no permission name is ever shown to a customer', () => {
  const B = 'src/components/metaAds/builder';
  const files = ['src/pages/outreach/MetaAdsCreatePage.tsx', ...readdirSync(new URL(`../../../../${B}`, import.meta.url)).filter((f) => /\.tsx?$/.test(f)).map((f) => `${B}/${f}`)];
  for (const f of files) {
    const src = read(f);
    assert.doesNotMatch(src, /missing_scopes|granted_scopes/, `${f} renders no scope list`);
    assert.doesNotMatch(src, /'madsb_instant_forms_permission'|'madsb_goal_needs_form_permissions'|'mm_b_lf_permission'/, `${f} uses the product-word keys`);
  }
  for (const k of ['mm_b_goal_soon', 'mm_b_goal_reconnect', 'mm_b_lf_soon', 'mm_b_lf_reconnect']) {
    const v = values(k);
    assert.equal(v.length, 6, k);
    for (const s of v) assert.doesNotMatch(s, SCOPE_NAMES, `${k}: ${s}`);
  }
  assert.match(values('mm_b_lf_soon')[1], /Facebook\/Instagram ლიდების მიღება მალე იქნება ხელმისაწვდომი/);
  const page = read('src/pages/outreach/MetaAdsCreatePage.tsx');
  assert.match(page, /const enabled = switchedOn && forms === 'AVAILABLE';/, 'the goal stays unavailable until the server says AVAILABLE');
});

test('Instant Forms: Admin sees the technical blocker — permission names and counts, never tokens', () => {
  const api = read('supabase/functions/meta-ads-api/index.ts');
  const probe = api.slice(api.indexOf("case 'admin_test_connection':"), api.indexOf("case 'admin_sync':"));
  assert.match(probe, /requiredScopes: INSTANT_FORM_SCOPES, connectedTotal: connTotal \?\? 0, connectedWithScopes: connWithForms \?\? 0/);
  assert.doesNotMatch(probe, /access_token|meta_tokens|oauth_nonce/);
  assert.match(read('src/components/admin/metaAds/ApiHealthPanel.tsx'), /data-mm-probe-forms=/);
  assert.match(read('src/pages/admin/AdminMetaAdsPage.tsx'), /data-mm-admin-forms-missing=\{c\.user_id\}/);
});

/* ── B. Admin identity ────────────────────────────────────────────────── */

test('Admin owner lookup: admin-only, exactly the ids asked, no phone and no tokens, nothing copied', () => {
  const actions = read('supabase/functions/meta-ads-api/actions.ts');
  const body = actions.slice(actions.indexOf("case 'admin_meta_people':"), actions.indexOf('/* ── ADMIN: SETTINGS + KILL SWITCHES'));
  assert.match(body, /if \(!me\.is_admin\) return json\(\{ error: 'forbidden', code: 'FORBIDDEN' \}, 403\);/);
  assert.ok(body.indexOf('!me.is_admin') < body.indexOf("from('users')"), 'refused before anything is read');
  assert.match(body, /filter\(\(v: string\) => UUID\.test\(v\)\)\)\]\.slice\(0, 500\)/, 'uuid ids only, at most 500');
  assert.match(body, /from\('users'\)\.select\('id,full_name,nickname,username,email,suspended_at'\)\.in\('id', ids\)/);
  assert.doesNotMatch(body, /phone|access_token|meta_tokens|oauth_nonce|\.insert\(|\.update\(|\.upsert\(/);
  // users stays own-row-only: no migration widens it.
  for (const f of readdirSync(new URL('../../../../supabase/migrations', import.meta.url))) {
    if (f > '20261002210000') assert.doesNotMatch(read(`supabase/migrations/${f}`), /on (public\.)?users\b[\s\S]*for select/i, f);
  }
});

test('Admin search: email, name, username, user id, campaign name/id, Meta campaign id, ad account', () => {
  const c = { id: 'c0ffee00-0000-4000-8000-000000000001', user_id: 'u5e70000-0000-4000-8000-000000000002', name: 'Vake spring',
    external_campaign_id: '120251631548530356', ad_account_external_id: 'act_920919324393041', property_id: null };
  const p = { name: 'Nino Beridze', username: 'nino', email: 'nino@example.test', adAccounts: [{ id: 'act_920919324393041', name: 'Nino Ads' }] };
  for (const q of ['nino@example', 'Beridze', 'NINO', 'u5e70000', 'Vake spring', 'c0ffee00', '1202516315', '920919324393041', 'Nino Ads']) {
    assert.ok(campaignMatchesSearch(c, p, q), q);
  }
  assert.ok(!campaignMatchesSearch(c, p, 'giorgi@example'));
  assert.ok(campaignMatchesSearch(c, null, ''), 'empty search matches everything');
  assert.match(personSearchText(p, c.user_id), /nino@example\.test/);
  const page = read('src/pages/admin/AdminMetaAdsPage.tsx');
  assert.match(page, /campaignMatchesSearch\(c, people\[c\.user_id\], search\)/);
  for (const tab of ['<Owner id={c.user_id} person={people[c.user_id]} />', '<Owner id={l.user_id} />', '<Owner id={e.user_id} />', '<Owner id={m.user_id} />']) {
    assert.ok(page.includes(tab), tab);
  }
  assert.match(page, /searchUsers\(f, 25\)/, 'Finance filters by email or name through the admin user search');
  assert.match(read('src/components/admin/metaAds/GuardPanel.tsx'), /<Owner id=\{inc\.user_id\} \/>/);
});

/* ── C. Audience ──────────────────────────────────────────────────────── */

test('a property ad stores the audience it runs with — the same rule the server applies', () => {
  const narrowed = { locations: [{ type: 'city', key: '1', name: 'Batumi', countryCode: 'GE', radiusKm: 10 }, { type: 'country', key: 'GE', name: 'Georgia', countryCode: 'GE' }],
    ageMin: 30, ageMax: 45, gender: 'FEMALE' };
  const n = housingNormalized(narrowed);
  assert.deepEqual([n.ageMin, n.ageMax, n.gender], [18, 65, 'ALL']);
  assert.equal(n.locations[0].radiusKm, 25);
  assert.equal(n.locations[1].radiusKm, undefined, 'countries keep no radius');
  assert.deepEqual(housingNormalized(n), n, 'idempotent');
  // The server makes the same audience from the stored values — and from the stale ones.
  const fromStored = applyTargeting(n, ['HOUSING']).spec;
  const fromStale = applyTargeting(narrowed, ['HOUSING']).spec;
  assert.deepEqual(fromStored, fromStale);
  assert.equal(effectiveRadiusKm(10, true), 25);
  assert.equal(effectiveRadiusKm(10, false), 10, 'a non-property ad keeps the chosen radius');
  // Not a property ad: the customer's narrowing is kept as chosen.
  assert.deepEqual(applyTargeting(narrowed, []).spec.genders, [2]);
});

test('audience step: no Meta rulebook, controls persist, retargeting follows its switch', () => {
  const aud = read('src/components/metaAds/builder/AudienceStep.tsx');
  assert.doesNotMatch(aud, /t\('mm_b_housing_rule'\)|t\('mm_b_housing_radius_note'/);
  assert.match(aud, /React\.useEffect\(\(\) => \{ if \(stale\) save\(\{\}\); \}, \[stale\]\)/, 'stale stored values are put right once');
  assert.match(aud, /status\?\.settings\.retargetingEnabled !== false \|\| campaign\.audience_id === a\.id/);
  const review = read('src/components/metaAds/builder/ReviewStep.tsx');
  assert.match(review, /effectiveRadiusKm\(l\.radiusKm, rule\.minRadiusKm\)/, 'the review shows the radius that will run');
  assert.doesNotMatch(review, /t\('madsb_housing_short'\)/);
});

/* ── D. Creative / CTA ────────────────────────────────────────────────── */

test('CTA: only buttons Meta documents for the goal and destination; an invalid choice is never sent', () => {
  assert.ok(!GOAL_SPECS.LEADS_ON_META.allowedCtas.includes('CONTACT_US'), 'not a documented lead-ad CTA');
  assert.ok(!GOAL_SPECS.PROMOTE.allowedCtas.includes('SEE_MORE'));
  assert.deepEqual([...ctaOptions('MESSAGES', 'MESSENGER')], ['MESSAGE_PAGE']);
  assert.deepEqual([...ctaOptions('MESSAGES', 'WHATSAPP')], ['WHATSAPP_MESSAGE']);
  assert.deepEqual([...ctaOptions('ENGAGEMENT')], []);
  assert.equal(resolveCta('LEADS_ON_META', 'APPLY_NOW'), 'APPLY_NOW', 'a valid choice is kept');
  assert.equal(resolveCta('LEADS_ON_META', 'CONTACT_US'), 'SIGN_UP', 'a no-longer-valid stored choice falls back to the default');
  assert.equal(resolveCta('LEADS_ON_META', null), 'SIGN_UP');
  assert.equal(resolveCta('PROMOTE', 'SEE_MORE'), 'LEARN_MORE');
  assert.equal(resolveCta('MESSAGES', 'LEARN_MORE', 'WHATSAPP'), 'WHATSAPP_MESSAGE');
  for (const goal of Object.keys(GOAL_SPECS)) {
    for (const app of [null, 'MESSENGER', 'WHATSAPP', 'INSTAGRAM_DIRECT']) {
      for (const chosen of [null, 'LEARN_MORE', 'SIGN_UP', 'CONTACT_US', 'SEE_MORE', 'BOOK_TRAVEL', 'MESSAGE_PAGE']) {
        const cta = resolveCta(goal, chosen, app);
        const opts = ctaOptions(goal, app);
        assert.ok(opts.length === 0 || opts.includes(cta), `${goal}/${app}/${chosen} → ${cta}`);
      }
    }
  }
});

test('CTA: the Meta payload, the preview, the review and the editor use one rule', () => {
  const ctx = { pageId: 'p1', instagramUserId: null, pixelId: null, leadFormId: 'f1', messagingApp: 'WHATSAPP', whatsappNumber: '+995', countries: ['GE'],
    startTime: 'x', endTime: 'y', websiteUrl: 'https://www.homatch.live/p/123456' };
  const cr = { id: 'cr-1-abcdef', kind: 'IMAGE', imageHash: 'h', videoId: null, thumbnailUrl: null, primaryText: 'Hi', headline: 'Vake 2BR', description: 'Near the park', cta: 'LEARN_MORE' };
  const wa = creativeParams('MESSAGES', cr, ctx).object_story_spec.link_data;
  assert.equal(wa.call_to_action.type, 'WHATSAPP_MESSAGE');
  assert.equal(wa.call_to_action.value.app_destination, 'WHATSAPP');
  assert.equal(wa.name, 'Vake 2BR', 'the message ad carries the headline the customer can now edit');
  assert.equal(wa.description, 'Near the park');
  const site = creativeParams('LEADS_ON_WEBSITE', { ...cr, cta: 'GET_QUOTE' }, ctx).object_story_spec.link_data;
  assert.equal(site.call_to_action.type, 'GET_QUOTE');
  assert.equal(site.link, ctx.websiteUrl);
  assert.equal(site.caption, undefined, 'the display link stays derived from the URL — HOMATCH sets no caption');
  const lead = creativeParams('LEADS_ON_META', { ...cr, cta: 'CONTACT_US' }, { ...ctx, messagingApp: null }).object_story_spec.link_data;
  assert.equal(lead.call_to_action.type, 'SIGN_UP');
  assert.equal(lead.call_to_action.value.lead_gen_form_id, 'f1');

  const preview = read('src/components/metaAds/builder/AdPreview.tsx');
  assert.match(preview, /resolveCta\(goal, creative\?\.cta, app\)/);
  assert.match(preview, /const editable = \(field: PreviewField\) => field === 'media' \? false : field === 'cta' \? ctaEditable : true;/, 'only real editors are clickable');
  assert.match(preview, /data-mm-preview-display-link=""/);
  assert.match(read('src/components/metaAds/builder/ReviewStep.tsx'), /resolveCta\(goal, withMedia\[0\]\?\.cta, campaign\.destination\?\.messagingApp \?\? null\)/);
  const editor = read('src/components/metaAds/builder/CreativeStep.tsx');
  assert.match(editor, /const needsHeadline = goal !== 'ENGAGEMENT';/, 'message ads get their headline and description editors');
  assert.match(editor, /const activeCta = resolveCta\(goal, creative\.cta, messagingApp\);/);
  assert.match(editor, /data-mm-cta-fixed=\{options\[0\]\}/, 'a single valid button is shown, not offered');
  assert.match(editor, /cta: resolveCta\(campaign\.goal as MetaGoal, null, campaign\.destination\?\.messagingApp \?\? null\)/, 'a new creative starts on its goal\'s default');
  assert.equal(values('madsb_cta_whatsapp_message').length, 6);
  // A quick second edit never drops the first: pending changes are merged before the debounced save.
  assert.match(editor, /pending\.current = \{ \.\.\.pending\.current, \.\.\.patch \};/);
});

/* ── E. Capacity ──────────────────────────────────────────────────────── */

test('capacity: ELEVATED halves insights and drops heavy breakdowns; throttle stops the account', () => {
  assert.deepEqual(allowance('ELEVATED', 7), { status: true, insights: true, insightsSlowdown: 2, breakdowns: false });
  assert.deepEqual(allowance('HIGH', 7), { status: true, insights: false, insightsSlowdown: 1, breakdowns: false });
  assert.equal(allowance('CRITICAL', 7).status, false);
  assert.equal(allowance('CRITICAL', 10).status, true);
  assert.equal(allowance('THROTTLED', 10).status, false);
  assert.equal(pressureOf([{ callCount: 8, totalCputime: 1, totalTime: 1, regainMinutes: 0 }]), 'NORMAL', 'production now');
  assert.equal(pressureOf([{ callCount: 60, totalCputime: 1, totalTime: 1, regainMinutes: 0 }]), 'ELEVATED');
  assert.equal(pressureOf([{ callCount: 10, totalCputime: 1, totalTime: 1, regainMinutes: 3 }]), 'THROTTLED');

  const monitor = read('supabase/functions/meta-ads-api/monitor.ts');
  assert.match(monitor, /insightsDue\(c, false, room\.insightsSlowdown, now\)/);
  assert.match(monitor, /syncInsights\(sb, c, token, \{ breakdowns: room\.breakdowns \}\)/);
  const ins = read('supabase/functions/meta-ads-api/insightsSync.ts');
  assert.match(ins, /filter\(\(q\) => opts\.breakdowns !== false \|\| q\.breakdown === 'none'\)/);
  assert.match(ins, /INSIGHTS_MIN_MINUTES \* Math\.max\(1, slowdown\) \* 60_000/);
  const idx = read('supabase/functions/meta-ads-api/index.ts');
  const maint = idx.slice(idx.indexOf('async function maintenance'));
  assert.match(maint, /pressureFor\(c\.ad_account_external_id\) === 'THROTTLED'\) \{ report\.skippedThrottled \+= 1; continue; \}/);
  assert.match(maint, /\(p === 'NORMAL' \|\| p === 'ELEVATED'\)\) await maybeScanDuplicates/, 'duplicate scans wait under HIGH pressure');
});
