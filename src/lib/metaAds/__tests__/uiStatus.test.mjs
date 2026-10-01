// The canonical customer-facing campaign status. "Active" means Meta is
// running it; a campaign Meta reports as paused is never counted as active.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { uiStatus, needsAttention, statusCounts, matchesKpi, statusFromMeta, UI_STATUSES } from '../uiStatus.ts';

const read = (p) => readFileSync(new URL(`../../../../${p}`, import.meta.url), 'utf8');

/* Production on 2026-10-01, as read from meta_campaigns: three drafts, one
   draft the HOMATCH check sent back, and the real campaign the owner paused in
   Meta Ads Manager. The old dashboard counted it as "Active: 1". */
const PRODUCTION = [
  { status: 'DRAFT', external_status: null, guard_state: 'OK', launched_at: null },
  { status: 'DRAFT', external_status: null, guard_state: 'OK', launched_at: null },
  { status: 'DRAFT', external_status: null, guard_state: 'OK', launched_at: null },
  { status: 'NEEDS_CHANGES', external_status: null, guard_state: 'OK', launched_at: null },
  { status: 'PAUSED', external_status: 'PAUSED', guard_state: 'OK', launched_at: '2026-09-30T18:30:56Z', attention: false },
];

test('the real scenario: a HOMATCH campaign that Meta reports PAUSED is Paused, not Active', () => {
  const real = PRODUCTION[4];
  assert.equal(uiStatus(real), 'PAUSED');
  assert.equal(matchesKpi(real, 'active'), false);
  assert.equal(matchesKpi(real, 'paused'), true);
  assert.deepEqual(statusCounts(PRODUCTION), { total: 5, active: 0, paused: 1, attention: 1 });
  assert.equal(statusFromMeta(real), true, 'its state is Meta\'s, shown as "Synced with Meta"');
});

test('Meta\'s paused wins over a HOMATCH status that has not caught up, at any level', () => {
  for (const meta of ['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED']) {
    assert.equal(uiStatus({ status: 'ACTIVE', external_status: meta, launched_at: '2026-09-30T00:00:00Z' }), 'PAUSED', meta);
  }
  assert.equal(uiStatus({ status: 'ACTIVE', external_status: 'ACTIVE', launched_at: 'x' }), 'ACTIVE');
});

test('being created, ready or enabled in HOMATCH is never Active', () => {
  for (const s of ['DRAFT', 'CONNECTION_REQUIRED', 'CREATIVE_REQUIRED', 'AUDIENCE_REQUIRED', 'PREFLIGHT_REQUIRED']) assert.equal(uiStatus({ status: s }), 'DRAFT', s);
  assert.equal(uiStatus({ status: 'READY' }), 'READY');
  for (const s of ['SUBMITTED', 'META_REVIEW', 'LAUNCHING']) assert.equal(uiStatus({ status: s }), 'IN_REVIEW', s);
  assert.equal(statusCounts([{ status: 'READY' }, { status: 'META_REVIEW' }, { status: 'DRAFT' }]).active, 0);
});

test('every distinct state maps, and the overriding states win', () => {
  assert.equal(uiStatus({ status: 'COMPLETED' }), 'ENDED');
  assert.equal(uiStatus({ status: 'ARCHIVED' }), 'ENDED');
  assert.equal(uiStatus({ status: 'FAILED' }), 'FAILED');
  assert.equal(uiStatus({ status: 'REJECTED' }), 'NEEDS_ATTENTION');
  assert.equal(uiStatus({ status: 'NEEDS_CHANGES' }), 'NEEDS_ATTENTION');
  assert.equal(uiStatus({ status: 'PAYMENT_REQUIRED' }), 'NEEDS_ATTENTION');
  // Guard lock beats Meta's "active".
  assert.equal(uiStatus({ status: 'ACTIVE', external_status: 'ACTIVE', guard_state: 'LOCKED_FOR_REVIEW', launched_at: 'x' }), 'LOCKED');
  // Lost control of a launched campaign beats delivery, but not for a draft or an ended one.
  assert.equal(uiStatus({ status: 'ACTIVE', last_error_key: 'meta_err_reconnect', launched_at: 'x' }), 'ACCESS_LOST');
  assert.equal(uiStatus({ status: 'DRAFT', last_error_key: 'meta_err_reconnect' }), 'DRAFT');
  assert.equal(uiStatus({ status: 'COMPLETED', last_error_key: 'meta_err_reconnect', launched_at: 'x' }), 'ENDED');
  assert.equal(new Set(UI_STATUSES).size, 10);
});

test('needs attention: action required, whatever the status — and nothing else', () => {
  assert.equal(needsAttention({ status: 'PAUSED', external_status: 'PAUSED', launched_at: 'x', attention: true }), true, 'a paused campaign with a Guard/health flag');
  assert.equal(needsAttention({ status: 'PAUSED', external_status: 'PAUSED', launched_at: 'x', attention: false }), false, 'paused alone is not a problem');
  assert.equal(needsAttention({ status: 'ACTIVE', guard_state: 'NEEDS_REVIEW', launched_at: 'x' }), true);
  assert.equal(needsAttention({ status: 'FAILED' }), true);
  assert.equal(needsAttention({ status: 'DRAFT', attention: true }), false, 'a stale flag on a draft is not attention');
  assert.equal(matchesKpi({ status: 'DRAFT' }, 'all'), true);
});

test('server and client count with the same function; the old "live" rule is gone', () => {
  const actions = read('supabase/functions/meta-ads-api/actions.ts');
  assert.match(actions, /counts: statusCounts\(rows\)/);
  assert.doesNotMatch(actions, /\['SUBMITTED', 'META_REVIEW', 'ACTIVE', 'PAUSED'\]\.includes\(r\.status\)/);
  const dash = read('src/components/metaAds/workspace/GlobalDashboard.tsx');
  assert.match(dash, /statusCounts\(\(data\?\.campaigns \?\? \[\]\)\.map\(statusOf\)\)/, 'counts come from the rows on screen');
  assert.match(dash, /matchesKpi\(statusOf\(r\), view\)/, 'the list is filtered by the same rule');
  assert.doesNotMatch(dash, /counts\.live|data\.counts/, 'the client never shows a count it did not derive');
});
