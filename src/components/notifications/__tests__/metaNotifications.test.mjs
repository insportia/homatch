import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import {
  categoryOf, isMetaRow, META_CATEGORIES, META_NOTIFICATION_TYPES, metaCategoryFilter,
  metaCategoryOf, metaSeverityOf,
} from '../../../lib/notifications/feed.ts';
import { META_MASTER_ADMIN_STRINGS } from '../../../../scripts/meta-master-admin-i18n-data.mjs';

/*
 * META ADS IN THE ONE NOTIFICATION CENTRE.
 *
 *   Meta rows are ordinary notifications, filed into five finer categories.
 *   The settings screen offers exactly the switches the notifier reads, with
 *   the notifier's own defaults, plus the email channel.
 *   Every mm_a_ / mm_n_ key the admin and notification surfaces use exists in
 *   the data file in all six languages with the same placeholders.
 */

const ROOT = process.cwd();
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').split('\r\n').join('\n');

const row = (type, metadata = {}) => ({
  id: '00000000-0000-0000-0000-000000000001', type, title: 'stored', read: false,
  created_at: '2026-09-30T08:00:00.000000+00:00', metadata,
});

/* ── Categories ─────────────────────────────────────────────────────────── */

test('the five META_* types are the Meta rows, and nothing else is', () => {
  assert.deepEqual([...META_NOTIFICATION_TYPES].sort(),
    ['META_ADS_BALANCE', 'META_CAMPAIGN_STATUS', 'META_GUARD', 'META_LEAD', 'META_RECOMMENDATION']);
  for (const type of META_NOTIFICATION_TYPES) assert.equal(isMetaRow(row(type)), true, type);
  for (const type of ['MATCH_FOUND', 'LOW_CREDITS', 'CAMPAIGN_SENT', 'ANNOUNCEMENT']) {
    assert.equal(isMetaRow(row(type)), false, type);
    assert.equal(metaCategoryOf(row(type)), null, type);
    assert.equal(metaSeverityOf(row(type)), null, type);
  }
});

test('Meta rows map onto exactly the five categories', () => {
  assert.deepEqual([...META_CATEGORIES], ['CAMPAIGN', 'LEADS', 'BILLING', 'GUARD', 'SYSTEM']);
  const cases = [
    /* What the notifier writes: metadata.category wins. */
    [row('META_CAMPAIGN_STATUS', { kind: 'META_EVENT', category: 'CAMPAIGN' }), 'CAMPAIGN'],
    [row('META_CAMPAIGN_STATUS', { kind: 'META_EVENT', category: 'SYSTEM' }), 'SYSTEM'],
    [row('META_CAMPAIGN_STATUS', { kind: 'META_EVENT', category: 'LEADS' }), 'LEADS'],
    [row('META_GUARD', { kind: 'META_EVENT', category: 'GUARD' }), 'GUARD'],
    [row('META_ADS_BALANCE', { kind: 'META_EVENT', category: 'BILLING' }), 'BILLING'],
    [row('META_RECOMMENDATION', { kind: 'META_EVENT', category: 'CAMPAIGN' }), 'CAMPAIGN'],
    [row('META_CAMPAIGN_STATUS', { kind: 'META_BRIEF', category: 'CAMPAIGN' }), 'CAMPAIGN'],
    /* A lead is LEADS whatever its metadata says. */
    [row('META_LEAD', { kind: 'META_LEAD', category: 'LEADS' }), 'LEADS'],
    [row('META_LEAD'), 'LEADS'],
    [row('META_LEAD', { category: 'CAMPAIGN' }), 'LEADS'],
    /* A row missing its category is filed from its type. */
    [row('META_GUARD'), 'GUARD'],
    [row('META_ADS_BALANCE'), 'BILLING'],
    [row('META_CAMPAIGN_STATUS'), 'CAMPAIGN'],
    [row('META_RECOMMENDATION', { category: 'nonsense' }), 'CAMPAIGN'],
  ];
  for (const [r, want] of cases) assert.equal(metaCategoryOf(r), want, `${r.type} ${JSON.stringify(r.metadata)}`);
});

test('Meta rows keep a place in the feed\'s own categories', () => {
  assert.equal(categoryOf(row('META_ADS_BALANCE', { category: 'BILLING' })), 'BILLING');
  assert.equal(categoryOf(row('META_GUARD', { category: 'GUARD' })), 'SERVICE');
  assert.equal(categoryOf(row('META_LEAD', { kind: 'META_LEAD' })), 'SERVICE');
});

test('severity is read from metadata and defaults to INFO', () => {
  assert.equal(metaSeverityOf(row('META_GUARD', { severity: 'CRITICAL' })), 'CRITICAL');
  assert.equal(metaSeverityOf(row('META_CAMPAIGN_STATUS', { severity: 'IMPORTANT' })), 'IMPORTANT');
  assert.equal(metaSeverityOf(row('META_CAMPAIGN_STATUS', { severity: 'INFO' })), 'INFO');
  assert.equal(metaSeverityOf(row('META_LEAD')), 'INFO');
});

test('the server-side category filter selects the same rows the client files there', () => {
  for (const c of META_CATEGORIES) {
    const f = metaCategoryFilter(c);
    assert.equal(f.category, c);
    for (const t of f.types) assert.ok(META_NOTIFICATION_TYPES.includes(t));
  }
  assert.ok(metaCategoryFilter('LEADS').types.includes('META_LEAD'));
  assert.ok(!metaCategoryFilter('GUARD').types.includes('META_LEAD'));
});

test('the centre renders severity, the Meta category and the icon per type', () => {
  const pres = read('src', 'components', 'notifications', 'presentation.tsx');
  const page = read('src', 'pages', 'NotificationsPage.tsx');
  for (const type of META_NOTIFICATION_TYPES) assert.match(pres, new RegExp(`${type}: \\w+,`), `${type} has no icon`);
  for (const c of META_CATEGORIES) assert.match(pres, new RegExp(`${c}: 'mm_n_cat_${c.toLowerCase()}'`));
  for (const s of ['CRITICAL', 'IMPORTANT', 'INFO']) assert.match(pres, new RegExp(`${s}: 'mm_n_sev_${s}'`));
  /* Paging and the deep link are the canonical ones, not a second path. */
  assert.match(page, /keysetOrFilter\(options\.cursor\)/);
  assert.match(page, /\.eq\('metadata->>category', f\.category\)/);
  assert.match(page, /notificationHref\(notif\)/);
  assert.match(page, /markAllNotificationsRead/);
});

/* ── Settings ───────────────────────────────────────────────────────────── */

test('the settings expose exactly the notifier\'s Meta switches, with its defaults, and email', () => {
  const prefs = read('src', 'services', 'notificationPreferences.ts');
  const notifier = read('supabase', 'functions', 'meta-ads-api', 'notifier.ts');
  const events = read('src', 'lib', 'metaAds', 'events.ts');

  const keys = [...prefs.match(/export const META_NOTIFICATION_CATEGORIES = \[([\s\S]*?)\] as const;/)[1]
    .matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(keys, ['meta_performance', 'meta_leads', 'meta_billing', 'meta_daily_brief', 'meta_weekly_brief']);

  const defaultsBlock = prefs.match(/export const META_CATEGORY_DEFAULTS[^=]*= \{([\s\S]*?)\};/)[1];
  const defaults = Object.fromEntries([...defaultsBlock.matchAll(/(meta_\w+): (true|false)/g)].map((m) => [m[1], m[2] === 'true']));
  assert.deepEqual(defaults, {
    meta_performance: true, meta_leads: true, meta_billing: true, meta_daily_brief: false, meta_weekly_brief: true,
  });

  /* The notifier reads the same keys and falls back to the same defaults. */
  const engine = Object.fromEntries([...events.match(/export const DEFAULT_PREFERENCES[^=]*= \{([^}]*)\}/)[1]
    .matchAll(/(\w+): (true|false)/g)].map((m) => [m[1], m[2] === 'true']));
  const pairs = [...notifier.matchAll(/flag\('(meta_\w+)', DEFAULT_PREFERENCES\.(\w+)\)/g)].map((m) => [m[1], m[2]]);
  assert.equal(pairs.length, 5, 'recipientFor no longer reads five Meta switches');
  for (const [key, field] of pairs) {
    assert.ok(keys.includes(key), `the notifier reads ${key}, which the settings do not offer`);
    assert.equal(defaults[key], engine[field], `${key}: settings default differs from the notifier's`);
  }

  /* Email: read, defaulted on, and written. */
  assert.match(notifier, /email_enabled/);
  assert.match(prefs, /emailEnabled: true/);
  assert.match(prefs, /select\('[^']*email_enabled[^']*'\)/);
  assert.match(prefs, /email_enabled: prefs\.emailEnabled/);
  assert.match(prefs, /emailEnabled: data\.email_enabled \?\? true/);

  const panel = read('src', 'components', 'notifications', 'NotificationSettings.tsx');
  assert.match(panel, /META_NOTIFICATION_CATEGORIES\.map/);
  assert.match(panel, /metaCategoryOn\(prefs\.categories, key\)/);
  assert.match(panel, /emailEnabled: on/);
  assert.match(panel, /pushEnabled: on/);
  assert.match(panel, /mm_n_integrity_note/);
  /* The push flow is the existing one, not a rebuilt one. */
  assert.match(panel, /from '@\/lib\/push'/);
  assert.doesNotMatch(panel, /serviceWorker\.register|pushManager\.subscribe/);
});

/* ── Copy ───────────────────────────────────────────────────────────────── */

const SURFACES = [
  ['src', 'pages', 'admin', 'AdminMetaAdsPage.tsx'],
  ['src', 'components', 'admin', 'metaAds', 'GuardPanel.tsx'],
  ['src', 'components', 'admin', 'metaAds', 'FeePolicyPanel.tsx'],
  ['src', 'components', 'admin', 'metaAds', 'EconomicsPanel.tsx'],
  ['src', 'components', 'admin', 'metaAds', 'kit.tsx'],
  ['src', 'components', 'notifications', 'presentation.tsx'],
  ['src', 'components', 'notifications', 'NotificationSettings.tsx'],
  ['src', 'pages', 'NotificationsPage.tsx'],
];

const holes = (s) => [...String(s).matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]).sort().join(',');

function referencedKeys() {
  const keys = new Set();
  for (const p of SURFACES) {
    const src = read(...p);
    for (const m of src.matchAll(/'((?:mm_a|mm_n)_\w+)'/g)) keys.add(m[1]);
  }
  /* Keys built from a template, expanded from the values they range over. */
  for (const act of ['CLEAR_INCIDENT', 'DISMISS_INCIDENT', 'MARK_REVIEWED', 'REINSTATE_ACCOUNT',
    'SUSPEND_ACCOUNT', 'UNLOCK_CAMPAIGN', 'ACCEPT_EXTERNAL', 'RESTORE_CONFIG']) keys.add(`mm_a_act_${act}`);
  for (const kind of ['STANDARD_PERCENT', 'FEE_EXEMPT', 'CUSTOM_PERCENT']) keys.add(`mm_a_fee_kind_${kind}`);
  for (const k of ['meta_performance', 'meta_leads', 'meta_billing', 'meta_daily_brief', 'meta_weekly_brief']) keys.add(`mm_n_pref_${k}`);
  return keys;
}

test('every dynamic key family is actually built the way the test expands it', () => {
  assert.match(read(...SURFACES[1]), /t\(`mm_a_act_\$\{act\}`\)/);
  assert.match(read(...SURFACES[2]), /t\(`mm_a_fee_kind_\$\{k\}`\)/);
  assert.match(read(...SURFACES[6]), /t\(`mm_n_pref_\$\{key\}`/);
  const guard = read(...SURFACES[1]);
  const acts = read('src', 'services', 'metaAds.ts').match(/export type AdminGuardAct = ([^;]+);/)[1];
  for (const act of acts.matchAll(/'(\w+)'/g)) assert.match(guard, new RegExp(`'${act[1]}'`), `${act[1]} has no button`);
});

test('every mm_a_ / mm_n_ key used exists in six non-empty languages with matching placeholders', () => {
  const keys = referencedKeys();
  assert.ok(keys.size > 60, `only ${keys.size} keys found; the scan is broken`);
  for (const key of keys) {
    const values = META_MASTER_ADMIN_STRINGS[key];
    assert.ok(Array.isArray(values), `${key} is used but not in scripts/meta-master-admin-i18n-data.mjs`);
    assert.equal(values.length, 6, `${key} has ${values.length} languages`);
    const want = holes(values[0]);
    values.forEach((v, i) => {
      assert.ok(typeof v === 'string' && v.trim().length > 0, `${key}[${i}] is empty`);
      assert.equal(holes(v), want, `${key}[${i}] placeholders differ from English`);
    });
  }
});

test('the data file itself is whole: six entries each, placeholders identical, Georgian terms', () => {
  for (const [key, values] of Object.entries(META_MASTER_ADMIN_STRINGS)) {
    assert.match(key, /^mm_[an]_/);
    assert.equal(values.length, 6, key);
    const want = holes(values[0]);
    for (const v of values) {
      assert.ok(v.trim().length > 0, key);
      assert.equal(holes(v), want, key);
    }
    assert.doesNotMatch(values[1], /შესატყვისი/, `${key}: match is დამთხვევა`);
  }
  assert.match(META_MASTER_ADMIN_STRINGS.mm_n_cat_leads[1], /ლიდ/);
});
