// The Admin Control Center's view of a campaign: the canonical delivery
// state (the customer dashboard's own function), HOMATCH's lifecycle and
// Meta's word side by side, how fresh the sync is, and where they disagree.
import test from 'node:test';
import assert from 'node:assert/strict';
import { adminCounts, matchesAdminFilter, discrepancy, syncFreshness, ADMIN_FILTERS, STALE_AFTER_MS } from '../adminView.ts';
import { statusCounts } from '../uiStatus.ts';

const NOW = Date.parse('2026-10-01T06:30:00Z');
const ago = (m) => new Date(NOW - m * 60_000).toISOString();

/* meta_campaigns in production on 2026-10-01. */
const PAUSED_AT_META = { status: 'PAUSED', external_status: 'PAUSED', guard_state: 'OK', launched_at: '2026-09-30T18:30:56Z', external_campaign_id: '1202', last_synced_at: ago(2) };
const PRODUCTION = [
  { status: 'DRAFT' }, { status: 'DRAFT' }, { status: 'DRAFT' }, { status: 'NEEDS_CHANGES' }, PAUSED_AT_META,
];

test('the real paused campaign: Delivering 0, Paused 1 — the same answer the customer dashboard gives', () => {
  const c = adminCounts(PRODUCTION, NOW);
  assert.equal(c.delivering, 0);
  assert.equal(c.paused, 1);
  assert.equal(c.all, 5);
  assert.equal(c.drafts, 3);
  assert.equal(c.attention, 1);
  assert.equal(c.discrepancy, 0);
  assert.equal(c.stale, 0);
  const customer = statusCounts(PRODUCTION);
  assert.equal(c.delivering, customer.active);
  assert.equal(c.paused, customer.paused);
  assert.equal(c.attention, customer.attention);
});

test('a HOMATCH ACTIVE that Meta reports paused is paused, never delivering, and is flagged as a mismatch', () => {
  for (const meta of ['PAUSED', 'CAMPAIGN_PAUSED', 'ADSET_PAUSED']) {
    const row = { status: 'ACTIVE', external_status: meta, launched_at: ago(100), external_campaign_id: '1', last_synced_at: ago(1) };
    assert.equal(matchesAdminFilter(row, 'delivering', NOW), false, meta);
    assert.equal(matchesAdminFilter(row, 'paused', NOW), true, meta);
    assert.equal(discrepancy(row), 'META_PAUSED_HOMATCH_ACTIVE', meta);
  }
});

test('discrepancies: every disagreement between the lifecycle and Meta has a name; agreement has none', () => {
  const at = { launched_at: ago(100), external_campaign_id: '1', last_synced_at: ago(1) };
  assert.equal(discrepancy({ ...at, status: 'PAUSED', external_status: 'ACTIVE' }), 'META_ACTIVE_HOMATCH_PAUSED');
  assert.equal(discrepancy({ ...at, status: 'ACTIVE', external_status: 'DELETED' }), 'META_GONE');
  assert.equal(discrepancy({ ...at, status: 'META_REVIEW', external_status: 'DISAPPROVED' }), 'META_PROBLEM');
  assert.equal(discrepancy({ ...at, status: 'ACTIVE', external_status: null }), 'NO_META_STATE');
  assert.equal(discrepancy({ ...at, status: 'ACTIVE', external_status: 'ACTIVE' }), null);
  assert.equal(discrepancy(PAUSED_AT_META), null);
  // Not at Meta (or a mock id): nothing to disagree with.
  assert.equal(discrepancy({ status: 'DRAFT' }), null);
  assert.equal(discrepancy({ status: 'ACTIVE', external_status: 'PAUSED', external_campaign_id: 'mock_1' }), null);
  // Ended campaigns are no longer read; their last word is history, not a mismatch.
  assert.equal(discrepancy({ ...at, status: 'COMPLETED', external_status: 'PAUSED' }), null);
});

test('freshness: fresh within the window, stale after it, never when Meta was never read, not-synced when nothing is read', () => {
  const at = { status: 'ACTIVE', external_status: 'ACTIVE', launched_at: ago(100), external_campaign_id: '1' };
  assert.equal(syncFreshness({ ...at, last_synced_at: ago(1) }, NOW), 'FRESH');
  assert.equal(syncFreshness({ ...at, last_synced_at: new Date(NOW - STALE_AFTER_MS - 1000).toISOString() }, NOW), 'STALE');
  assert.equal(syncFreshness({ ...at, last_synced_at: null }, NOW), 'NEVER');
  assert.equal(syncFreshness({ status: 'DRAFT' }, NOW), 'NOT_SYNCED');
  assert.equal(syncFreshness({ ...at, status: 'COMPLETED', last_synced_at: ago(9000) }, NOW), 'NOT_SYNCED');
  assert.equal(syncFreshness({ ...at, external_campaign_id: 'mock_1', last_synced_at: null }, NOW), 'NOT_SYNCED');
});

test('every KPI number is exactly the number of records its filter opens', () => {
  const rows = [
    ...PRODUCTION,
    { status: 'ACTIVE', external_status: 'ACTIVE', launched_at: ago(50), external_campaign_id: '2', last_synced_at: ago(1) },
    { status: 'META_REVIEW', external_status: 'DISAPPROVED', launched_at: ago(50), external_campaign_id: '3', last_synced_at: ago(45) },
    { status: 'REJECTED', launched_at: ago(50), external_campaign_id: '4' },
    { status: 'FAILED' }, { status: 'MANUAL_REVIEW' }, { status: 'READY' },
    { status: 'ACTIVE', external_status: 'ACTIVE', guard_state: 'LOCKED_FOR_REVIEW', launched_at: ago(50), external_campaign_id: '5', last_synced_at: null },
  ];
  const counts = adminCounts(rows, NOW);
  for (const f of ADMIN_FILTERS) assert.equal(rows.filter((r) => matchesAdminFilter(r, f, NOW)).length, counts[f], f);
  assert.equal(counts.delivering, 1);
  assert.equal(counts.review, 2, 'Meta review and HOMATCH manual review');
  assert.equal(counts.drafts, 4, 'three drafts and a READY one; manual review is not a draft');
  assert.equal(counts.rejected, 1);
  assert.equal(counts.failed, 1);
  assert.equal(counts.stale, 2, 'the 45-minute-old read and the locked one never read');
});
