// Retention dates shown to customers: whole days rounded up, expired moved to
// tombstones, legacy (undated) rows never shown, and the source files never
// compute an expiry of their own — the server's is the only one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { daysLeft, retentionView } from '../retentionView.ts';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const row = (id, expires_at, expired = false) => ({ source_id: id, product: 'VERIFY_REPORT', available_at: '2026-09-01T00:00:00Z', expires_at, state: expired ? 'EXPIRED' : 'ACTIVE', expired, label: null });

test('days left round up: hours count as a day, the exact boundary is expired', () => {
  assert.equal(daysLeft('2026-10-15T13:00:00Z', NOW), 1);
  assert.equal(daysLeft('2026-10-22T12:00:00Z', NOW), 7);
  assert.equal(daysLeft('2026-10-15T12:00:00Z', NOW), 0);
});

test('view splits live, soon and expired; undated legacy rows are not shown', () => {
  const v = retentionView([
    row('a', '2026-11-10T00:00:00Z'), row('b', '2026-10-17T00:00:00Z'),
    row('c', '2026-10-15T12:00:00Z'), row('d', '2026-10-01T00:00:00Z', true), row('e', null),
  ], NOW);
  assert.deepEqual(v.active.map((r) => r.source_id), ['b', 'a']);
  assert.deepEqual(v.expiringSoon.map((r) => r.source_id), ['b']);
  assert.deepEqual(v.expired.map((r) => r.source_id), ['c', 'd']);
});

test('the client never derives an expiry date', () => {
  for (const f of ['src/services/retention.ts', 'src/services/retentionView.ts', 'src/components/retention/RetentionPanel.tsx']) {
    const src = readFileSync(f, 'utf8');
    assert.ok(!/30\s*\*\s*(24|86_?400)|addDays|setDate\(/.test(src), `${f} computes an expiry`);
  }
});

test('history screens render the notice only through the server-dated panel', () => {
  for (const [f, product] of [['src/pages/VerifyHistoryPage.tsx', 'VERIFY_REPORT'], ['src/pages/ContractsHistoryPage.tsx', 'CONTRACT_DOCUMENT']]) {
    assert.match(readFileSync(f, 'utf8'), new RegExp(`<RetentionPanel product="${product}" />`));
  }
  const panel = readFileSync('src/components/retention/RetentionPanel.tsx', 'utf8');
  assert.match(panel, /view\.active\.length === 0 && view\.expired\.length === 0\)\) return null/);
});

import { retentionMode, retentionErrorCode, RETENTION_ERRORS } from '../retentionView.ts';

test('control center: one plain state for every combination of switches', () => {
  const s = (effective_at, purge_enabled, auto_run) => retentionMode({ config: { effective_at, purge_enabled }, auto_run });
  assert.equal(s(null, false, false), 'OFF');
  assert.equal(s(null, true, true), 'OFF', 'no rule means nothing expires, whatever else is on');
  assert.equal(s('2026-10-15T00:00:00Z', false, true), 'DATING');
  assert.equal(s('2026-10-15T00:00:00Z', true, false), 'MANUAL');
  assert.equal(s('2026-10-15T00:00:00Z', true, true), 'ON');
});

test('control center: server refusals become words, unknown ones a safe generic', () => {
  assert.equal(retentionErrorCode('ERROR: RETENTION_GRACE_TOO_SHORT'), 'RETENTION_GRACE_TOO_SHORT');
  assert.equal(retentionErrorCode('forbidden'), 'generic');
  assert.equal(retentionErrorCode(undefined), 'generic');
});

test('control center: every dynamically built label exists in all six languages', () => {
  const tr = readFileSync('src/i18n/translations.ts', 'utf8');
  const keys = [
    ...['off', 'dating', 'manual', 'on'].map((m) => `rt_cc_status_${m}`),
    ...[...RETENTION_ERRORS, 'generic'].map((c) => `rt_cc_err_${c}`),
    'rt_cc_product_VERIFY_REPORT', 'rt_cc_product_CONTRACT_DOCUMENT',
  ];
  for (const k of keys) {
    const n = (tr.match(new RegExp(`\\b${k}:`, 'g')) ?? []).length;
    assert.equal(n, 6, `${k} is in ${n} of 6 languages`);
  }
});

import { artifactsMode, ttlParts } from '../retentionView.ts';

test('object-level control center: one plain state; self-tests never count as "on"', () => {
  const s = (paused, auto_run, cats) => artifactsMode({ settings: { paused }, auto_run, categories: cats });
  const cache = (enabled) => ({ kind: 'REGENERABLE_CACHE', enabled });
  const test_ = { kind: 'SELFTEST', enabled: true };
  assert.equal(s(false, true, [cache(false), test_]), 'OFF', 'only self-tests enabled is still off');
  assert.equal(s(true, true, [cache(true)]), 'PAUSED', 'the kill switch wins over everything');
  assert.equal(s(false, false, [cache(true)]), 'MANUAL');
  assert.equal(s(false, true, [cache(true)]), 'ON');
});

test('ttl reads as whole days, hours or minutes', () => {
  assert.deepEqual(ttlParts(30 * 86_400), { n: 30, unit: 'days' });
  assert.deepEqual(ttlParts(120), { n: 2, unit: 'minutes' });
  assert.deepEqual(ttlParts(7_200), { n: 2, unit: 'hours' });
});

test('object-level control center: every dynamically built label exists in all six languages', () => {
  const tr = readFileSync('src/i18n/translations.ts', 'utf8');
  const cats = ['verify_document_cache', 'generated_report', 'selftest_supabase', 'selftest_r2'];
  const sql = readFileSync('supabase/migrations/20261104090000_storage_retention_artifacts.sql', 'utf8');
  const areas = [...sql.slice(sql.indexOf('function public.retention_protected_areas')).matchAll(/'area', '([a-z-]+)'/g)].map((m) => m[1].replace(/-/g, '_'));
  assert.ok(areas.length >= 7);
  const seeded = [...sql.matchAll(/^\s+\('([a-z_0-9]+)', '[^']+', '(REGENERABLE_CACHE|TEMPORARY_ARTIFACT|SELFTEST)'/gm)].map((m) => m[1]);
  assert.deepEqual(seeded.sort(), [...cats].sort(), 'every seeded category has a label below');
  const keys = [
    ...['off', 'paused', 'manual', 'on'].map((m) => `rt_ax_status_${m}`),
    ...['days', 'hours', 'minutes'].map((u) => `rt_ax_ttl_${u}`),
    ...['REGENERABLE_CACHE', 'TEMPORARY_ARTIFACT', 'SELFTEST'].map((k) => `rt_ax_kind_${k}`),
    ...cats.flatMap((c) => [`rt_ax_cat_${c}`, `rt_ax_cat_${c}_desc`]),
    ...areas.map((a) => `rt_ax_protected_${a}`),
    ...['pending', 'problems', 'deleted', 'notices', 'log'].map((k) => `rt_ax_tab_${k}`),
    ...[...RETENTION_ERRORS, 'generic'].map((c) => `rt_cc_err_${c}`),
    'notif_retention_expiring_title', 'notif_retention_expiring_body', 'notif_retention_file',
  ];
  for (const k of keys) {
    const n = (tr.match(new RegExp(`\\b${k}:`, 'g')) ?? []).length;
    assert.equal(n, 6, `${k} is in ${n} of 6 languages`);
  }
});

test('control center: every change goes through the validated server functions, and deletion asks first', () => {
  const panel = readFileSync('src/components/retention/AdminRetentionPanel.tsx', 'utf8');
  const svc = readFileSync('src/services/retentionAdmin.ts', 'utf8');
  assert.ok(!/admin_set_setting|from\('admin_settings'\)|from\('retention_/.test(panel + svc), 'no direct table write');
  assert.match(svc, /rpc\('retention_artifacts_configure'/);
  assert.match(svc, /rpc\('retention_category_set'/);
  // the record-level switches are gone from the screen
  for (const gone of ['purge_enabled', 'effective_at', 'legacy_grace_until', 'reminders_enabled', 'knowledge_enabled', 'retention_admin_configure']) {
    assert.ok(!(panel + svc).includes(gone), `${gone} is still on the admin screen`);
  }
  // turning on automatic deletion, resuming, enabling a category and running now all confirm first
  assert.match(panel, /rt_ax_confirm_auto_title/);
  assert.match(panel, /rt_ax_confirm_resume_title/);
  assert.match(panel, /rt_ax_confirm_cat_on_title/);
  assert.match(panel, /rt_ax_confirm_run_title/);
  // pausing never asks: the emergency stop is one tap
  assert.match(panel, /\? apply\(\{ paused: true \}\)/);
});
