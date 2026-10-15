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

test('control center: every change goes through the validated server function', () => {
  const panel = readFileSync('src/components/retention/AdminRetentionPanel.tsx', 'utf8');
  const svc = readFileSync('src/services/retentionAdmin.ts', 'utf8');
  assert.ok(!/admin_set_setting|from\('admin_settings'\)/.test(panel + svc), 'no direct settings write');
  assert.match(svc, /rpc\('retention_admin_configure'/);
  // deleting and the rule itself always ask first
  assert.match(panel, /askDelete\(\)/);
  assert.match(panel, /rt_cc_confirm_delete_title/);
  assert.match(panel, /rt_cc_confirm_rule_on_title/);
  assert.match(panel, /rt_cc_confirm_rule_off_title/);
});
