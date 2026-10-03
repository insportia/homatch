// THE SELLER-SIDE PROPERTY OWNER WORKSPACE.
//
// What is pinned here, and why each one matters to an owner:
//
//   MEDIA     a HOMATCH-managed photo always leads; a dead link on another site can
//             never stand in front of it, and an unloadable photo is explained.
//   LIFECYCLE the browser presents the server's freshness, never computes it; the
//             two dimensions (owner freshness, source health) are never merged.
//   DISCOVERY an expired property is refused a NEW search in three places (client
//             pre-check, database trigger, match-campaign) and renewal restores it.
//   LAYOUT    the Property Detail page no longer leaves a dead column: quick actions
//             are a grid, discovery is a primary section, empty columns collapse.
//   COPY      the approved Georgian strings, verbatim, in all six locales.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { coverImage, galleryImages, isManagedImage } from '../../src/property/gallery.ts';
import {
  freshnessView, mediaUnavailableReason, needsAttention, safeExternalUrl, sourceView,
} from '../../src/property/lifecycle.ts';
import { PROPERTY_OWNER_STRINGS } from '../../scripts/property-owner-i18n-data.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8');
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const EXTERNAL = 'https://static-statements.tnet.ge/uploads/202608/20260819/statements/XXB2rD26a8603155deb3.webp';

/* ── MEDIA ─────────────────────────────────────────────────────────────── */

test('a managed photo always leads, even when the property row still carries the import\'s external cover', () => {
  const images = galleryImages({
    coverPhotoUrl: EXTERNAL,
    photos: [{ storage_path: 'users/u1/property-photos/a.webp', display_order: 2 }, { storage_path: 'users/u1/property-photos/b.webp', display_order: 1 }],
    galleryImages: [EXTERNAL],
  });
  assert.deepEqual(images, ['users/u1/property-photos/b.webp', 'users/u1/property-photos/a.webp', EXTERNAL]);
  assert.equal(coverImage({ coverPhotoUrl: EXTERNAL, photos: [{ storage_path: 'k.webp' }] }), 'k.webp');
});

test('the owner\'s chosen cover still leads within the managed photos', () => {
  const images = galleryImages({
    photos: [{ storage_path: 'a', display_order: 0 }, { storage_path: 'b', display_order: 1, is_cover: true }],
  });
  assert.deepEqual(images, ['b', 'a']);
});

test('an imported-only property keeps its external photos, deduplicated (provenance is not deleted)', () => {
  assert.deepEqual(galleryImages({ coverPhotoUrl: EXTERNAL, galleryImages: [EXTERNAL] }), [EXTERNAL]);
  assert.equal(isManagedImage(EXTERNAL), false);
  assert.equal(isManagedImage('users/x/property-photos/1.webp'), true);
  assert.equal(isManagedImage(''), false);
});

test('an external image is requested without a referrer, and an unloadable one is reported, not left blank', () => {
  const img = code(read('src', 'components', 'common', 'PrivateImage.tsx'));
  assert.match(img, /referrerPolicy=\{isExternal\(resolved\) \? 'no-referrer' : undefined\}/);
  assert.match(img, /onUnavailable\?\.\(\)/);
  /* A key that could not be minted is a failure, not a permanent spinner. */
  assert.match(img, /if \(!url && src\) setFailed\(true\)/);
  const card = code(read('src', 'pages', 'property', 'MyPropertiesPage.tsx'));
  assert.match(card, /fallback=\{<MediaUnavailable compact/);
  assert.doesNotMatch(card, /fallback=\{null\}/, 'no blank fallback on the card');
});

test('the media explanation is the most precise true reason, never a code', () => {
  assert.equal(mediaUnavailableReason('LISTING_NOT_FOUND'), 'pow_source_not_found');
  assert.equal(mediaUnavailableReason('MEDIA_UNAVAILABLE'), 'pow_source_media_unavailable');
  assert.equal(mediaUnavailableReason('UNKNOWN'), 'pow_media_unavailable_body');
  assert.equal(mediaUnavailableReason(null), 'pow_media_unavailable_body');
});

test('only safe http(s) links are clickable', () => {
  assert.equal(safeExternalUrl('https://www.myhome.ge/ka/x-1/'), 'https://www.myhome.ge/ka/x-1/');
  assert.equal(safeExternalUrl('javascript:alert(1)'), null);
  assert.equal(safeExternalUrl('data:text/html,x'), null);
  assert.equal(safeExternalUrl('not a url'), null);
  assert.equal(safeExternalUrl(null), null);
});

/* ── LIFECYCLE ─────────────────────────────────────────────────────────── */

test('freshness is presented from the server\'s state, with words and an action', () => {
  assert.deepEqual(freshnessView('ACTIVE'), { tone: 'ok', label: 'pow_state_active', body: 'pow_state_active_body', renew: false });
  assert.equal(freshnessView('EXPIRING_SOON').renew, true);
  assert.equal(freshnessView('EXPIRED').label, 'pow_state_expired');
  assert.equal(freshnessView(undefined), null, 'no server answer, no invented state');
  const lifecycle = code(read('src', 'property', 'lifecycle.ts'));
  assert.doesNotMatch(lifecycle, /Date\.now\(\)|new Date\(\)/, 'the browser never computes freshness');
});

test('source health is a separate dimension and only for imported properties', () => {
  assert.equal(sourceView('LISTING_NOT_FOUND', false), null, 'a direct property has no source health');
  assert.equal(sourceView('UNKNOWN', true), null, '"not checked" is not a problem');
  assert.equal(sourceView('AVAILABLE', true), null);
  assert.equal(sourceView('LISTING_NOT_FOUND', true).body, 'pow_source_not_found');
  assert.equal(sourceView('TEMPORARILY_UNREACHABLE', true).body, 'pow_source_unreachable');
  /* ACTIVE here and gone at the source is still "needs attention" — and vice versa. */
  assert.equal(needsAttention({ freshness_state: 'ACTIVE', source_status: 'LISTING_NOT_FOUND' }, true, false), true);
  assert.equal(needsAttention({ freshness_state: 'EXPIRED', source_status: 'AVAILABLE' }, true, false), true);
  assert.equal(needsAttention({ freshness_state: 'ACTIVE', source_status: 'UNKNOWN' }, true, false), false);
  assert.equal(needsAttention({ freshness_state: 'ACTIVE', source_status: null }, false, true), true, 'a failed photo needs attention');
});

test('renewal is a server RPC that touches no money', () => {
  const svc = code(read('src', 'services', 'propertyLifecycle.ts'));
  assert.match(svc, /rpc\('renew_property', \{ p_property_id: propertyId \}\)/);
  assert.doesNotMatch(svc, /credit|reserv|charge|billing/i);
  const sql = read('supabase', 'migrations', '20261011100000_property_owner_lifecycle.sql');
  const renew = sql.slice(sql.indexOf('create or replace function public.renew_property'), sql.indexOf('-- 5. Availability'));
  assert.doesNotMatch(code(renew).replace(/--.*$/gm, ''), /credit|reservation|wallet|ledger|charge/i, 'renewal is free');
  assert.match(renew, /user_id = v_user/, 'owner-only');
  assert.match(renew, /for update/, 'serialised: a double click is one renewal');
  assert.match(renew, /ALREADY_RENEWED/);
});

test('an owner save renews (owner-confirmed), best-effort', () => {
  const edit = code(read('src', 'pages', 'property', 'EditPropertyPage.tsx'));
  assert.match(edit, /await renewProperty\(id\)\.then\(\(r\) => r\.ok && r\.renewed === true\)\.catch\(\(\) => false\)/);
});

test('archiving goes through the owner-checked RPC (the archived_at grant was missing in production)', () => {
  const svc = code(read('src', 'services', 'propertyManagement.ts'));
  assert.match(svc, /rpc\('set_property_availability'/);
  assert.match(svc, /if \(await viaAvailabilityRpc\(propertyId, false\)\) return;/);
  assert.match(svc, /if \(await viaAvailabilityRpc\(propertyId, true\)\) return;/);
});

/* ── DISCOVERY GUARD ───────────────────────────────────────────────────── */

test('an expired property is refused a new search in all three places', () => {
  const api = code(read('src', 'services', 'api.ts'));
  assert.match(api, /rpc\('my_property_lifecycle', \{ p_property_ids: \[propertyId\] \}\)/);
  assert.match(api, /'PROPERTY_EXPIRED'/);
  assert.match(api, /reasonCode === 'PROPERTY_EXPIRED'\) return \{ key: 'pow_discovery_expired_error'/);
  const fn = code(read('supabase', 'functions', 'match-campaign', 'index.ts'));
  const guard = fn.indexOf("reasonCode: 'PROPERTY_EXPIRED'");
  assert.ok(guard > 0, 'match-campaign refuses');
  assert.ok(guard < fn.indexOf("from('matching_campaigns')\n        .select('id')\n        .eq('id', campaignId)"), 'before any campaign is touched');
  assert.ok(guard > fn.indexOf("controlAction === 'pause'"), 'pause/resume/stop are unaffected');
  const sql = read('supabase', 'migrations', '20261011100000_property_owner_lifecycle.sql');
  assert.match(sql, /create trigger properties_freshness_guard\s+before update of matching_status on public\.properties/);
});

/* ── LAYOUT ────────────────────────────────────────────────────────────── */

test('the detail page is a workspace: wide canvas, no sidebar, collapsing columns', () => {
  const page = code(read('src', 'pages', 'property', 'PropertyDetailPage.tsx'));
  assert.match(page, /max-w-\[90rem\]/);
  assert.doesNotMatch(page, /md:grid-cols-3 gap-5/, 'the old 2/3 + 1/3 sidebar grid is gone');
  assert.doesNotMatch(page, /lg:items-start/, 'the gallery no longer leaves a hole under it');
  assert.match(page, /data-testid="pow-quick-actions" className="grid grid-cols-2 gap-2\.5 sm:grid-cols-\[repeat\(auto-fit,minmax\(10\.5rem,1fr\)\)\]"/);
  assert.match(page, /hasAside \? 'lg:col-span-8' : 'lg:col-span-12'/, 'no empty side column');
  assert.match(page, /\{hasAside && <aside/);
  /* Every action that was there is still there. */
  for (const key of ['prop_ask_ai_btn', 'prop_find_better_deal_btn', 'prop_verify_btn', 'dash_calculate_mortgage_property', 'ds_open_in_design_studio', 'pow_action_investment', 'mads_property_cta', 'prop_view_matches']) {
    assert.ok(page.includes(`'${key}'`), `${key} kept`);
  }
  /* The campaign machinery is the same machinery. */
  assert.match(page, /productCode="FIND_CLIENTS"/);
  assert.match(page, /startMatchingCampaign\(/);
  assert.match(page, /pauseMatchingCampaign\(/);
});

/* ── COPY ──────────────────────────────────────────────────────────────── */

test('the approved Georgian copy is verbatim', () => {
  const ka = (key) => PROPERTY_OWNER_STRINGS[key][1];
  assert.equal(ka('pow_state_active'), 'აქტიური');
  assert.equal(ka('pow_state_expiring'), 'მალე განაახლე');
  assert.equal(ka('pow_state_expired'), 'ვადაგასულია');
  assert.equal(ka('pow_source_problem'), 'წყაროზე პრობლემაა');
  assert.equal(ka('pow_media_unavailable_title'), 'ფოტო აღარ არის ხელმისაწვდომი');
  assert.equal(ka('pow_renew_free'), 'განახლება უფასოდ');
  assert.equal(ka('pow_edit_info'), 'ინფორმაციის შეცვლა');
  assert.equal(ka('pow_open_listing'), 'განცხადებაზე გადასვლა');
  assert.equal(ka('pow_update_in_homatch'), 'განახლება HOMATCH-ში');
  assert.equal(ka('pow_renew_is_free'), 'განახლება უფასოა და განცხადება კიდევ 30 დღე აქტიური იქნება.');
  assert.equal(ka('pow_state_expired_body'), 'ამ ქონების ინფორმაცია 30 დღეზე მეტია არ განახლებულა. დაადასტურე, რომ განცხადება ისევ აქტიურია.');
  assert.equal(ka('pow_media_unavailable_body'), 'ეს ქონება სხვა საიტიდან არის იმპორტირებული და წყაროზე არსებული ფოტო ამჟამად აღარ იტვირთება.');
  assert.equal(ka('pow_source_action_body'), 'თუ განცხადება ისევ აქტიურია, გადაამოწმე და განაახლე ის საიტზე, საიდანაც HOMATCH-ში შემოიტანე.');
  assert.equal(ka('pow_update_in_homatch_body'), 'HOMATCH-ში განახლებული ინფორმაცია და ფოტოები აღარ იქნება დამოკიდებული სხვა საიტზე არსებული განცხადების ხელმისაწვდომობაზე.');
  assert.equal(ka('pow_expiring_title'), 'განცხადება მალე საჭიროებს განახლებას');
  assert.equal(ka('pow_state_expiring_body'), 'დაადასტურე, რომ ქონება ისევ აქტუალურია და განცხადება კიდევ 30 დღე განახლდება.');
  assert.equal(ka('pow_source_not_found'), 'წყაროზე განცხადება აღარ იძებნება.');
  assert.equal(ka('pow_source_action_title'), 'განაახლე განცხადება წყაროზე');
  for (const [key, values] of Object.entries(PROPERTY_OWNER_STRINGS)) {
    assert.equal(values.length, 6, `${key} has six locales`);
    assert.ok(!values[1].includes('შესატყვისი'), `${key}: match is დამთხვევა`);
  }
});
