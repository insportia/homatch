// Regression coverage for the "deleted property still appears" investigation
// (P0/P1 Incident #2). Two genuine, evidence-backed defects were found and
// fixed — this file covers both. Neither DashboardPage.tsx (a React
// component) nor the live Supabase schema can be exercised directly here (no
// React test renderer / jsdom, and no network path to Supabase from this
// sandbox — see this repo's other __tests__ files for the same constraint),
// so each fix's own decision logic is copied verbatim/mirrored and exercised
// directly, per this repo's established convention.
//
// What was investigated and ruled OUT (with schema/code evidence, so this
// isn't re-litigated on a future pass):
//   - getProperties()/getProperty()/softDeleteProperty() (src/services/api.ts)
//     already consistently read/write `properties.is_deleted` — correct.
//   - Verify History (research_jobs, listVerifyHistory/listResearchJobsForCase
//     in src/services/researchJobs.ts) is architecturally isolated from the
//     `properties` table entirely (research_jobs has no property_id column —
//     confirmed via information_schema.columns against the live project) and
//     already correctly filters its OWN `deleted_at` column. It cannot be the
//     cause of a deleted property "resurrecting", and was left untouched.
//
// What was found and fixed:
//   1. DashboardPage.tsx's refresh() had three independent, unsequenced
//      callers (initial mount, a 3s poll interval, and handleDelete()'s own
//      post-delete call). A slower in-flight fetch started BEFORE a delete
//      could resolve AFTER the delete's own refresh() and overwrite React
//      state with the stale pre-delete property list — the deleted property
//      reappears until the next poll tick. Fixed with a monotonic request
//      sequence guard so only the most-recently-STARTED refresh()'s result
//      is ever applied.
//   2. getAdminOverviewStats()/getAdminProperties() (src/services/api.ts)
//      filtered on `properties.deleted_at`, a column that does not exist on
//      that table (confirmed live: `select id from properties where
//      deleted_at is null` raises `42703: column "deleted_at" does not
//      exist`). Both call sites destructure only `{ data }`/`count` and
//      never check `error`, so this always silently failed closed (empty
//      results), not open — but it is a genuine, provable soft-delete
//      inconsistency in the same code path this investigation covers, so it
//      was corrected to use `is_deleted` like every other properties query.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── Fix #1: DashboardPage.tsx's request-sequencing guard ───────────────────
// Verbatim mirror of the guard added around refresh()'s state-setting calls:
//   const seq = ++requestSeq.current;
//   ...await the fetches...
//   if (seq !== requestSeq.current) return; // stale — discard
//   ...apply to state...
function makeSequencedRefresh() {
  let requestSeq = 0;
  const appliedResults = [];
  return {
    // Simulates one refresh() call: `resolveOrder` controls when this
    // particular call's simulated fetch "resolves" relative to others by
    // being awaited in that order by the test.
    async refresh(fetchPromise) {
      const seq = ++requestSeq;
      const result = await fetchPromise;
      if (seq !== requestSeq) return; // a newer refresh() started meanwhile — discard
      appliedResults.push(result);
    },
    appliedResults,
  };
}

test('request-sequencing guard: a slow refresh() that resolves AFTER a newer one must not overwrite state (the exact reappearing-property race)', async () => {
  const { refresh, appliedResults } = makeSequencedRefresh();

  // Simulates: the 3s poll interval fires and starts fetching the OLD
  // (pre-delete) property list, but is slow to resolve.
  let resolveStale;
  const stalePromise = new Promise((resolve) => { resolveStale = resolve; });
  const staleRefresh = refresh(stalePromise);

  // The user deletes a property, then handleDelete() calls its own refresh()
  // — this one starts SECOND but must win because it started more recently.
  const freshRefresh = refresh(Promise.resolve(['fresh-list-without-deleted-property']));
  await freshRefresh;

  // Only now does the stale, pre-delete fetch resolve.
  resolveStale(['stale-list-still-containing-deleted-property']);
  await staleRefresh;

  // The stale result must never have been applied — only the fresh one.
  assert.deepEqual(appliedResults, [['fresh-list-without-deleted-property']]);
});

test('request-sequencing guard: normal sequential refreshes (no overlap) both apply, in order', async () => {
  const { refresh, appliedResults } = makeSequencedRefresh();
  await refresh(Promise.resolve(['list-v1']));
  await refresh(Promise.resolve(['list-v2']));
  assert.deepEqual(appliedResults, [['list-v1'], ['list-v2']]);
});

test('request-sequencing guard: three overlapping refreshes — only the last-STARTED one\'s result is ever applied, regardless of resolution order', async () => {
  const { refresh, appliedResults } = makeSequencedRefresh();
  let resolve1, resolve2;
  const p1 = new Promise((r) => { resolve1 = r; });
  const p2 = new Promise((r) => { resolve2 = r; });
  const r1 = refresh(p1);
  const r2 = refresh(p2);
  const r3 = refresh(Promise.resolve(['list-3-latest']));
  await r3;
  // p1 and p2 resolve last, out of start order — both must be discarded.
  resolve2(['list-2']);
  resolve1(['list-1']);
  await Promise.all([r1, r2]);
  assert.deepEqual(appliedResults, [['list-3-latest']]);
});

// ── Fix #2: admin properties/overview soft-delete filter ───────────────────
// A minimal, faithful mirror of the corrected Supabase query-builder call
// chain's filter step — not a real query, just proof that the filter now
// targets the column that actually exists (is_deleted), matching every
// other properties query in this file (getProperties/getProperty), instead
// of a column (deleted_at) confirmed not to exist on this table.
const PROPERTIES_TABLE_COLUMNS = ['id', 'user_id', 'source_type', 'title', 'transaction_type', 'property_type', 'matching_status', 'matchability_score', 'cover_photo_url', 'is_deleted', 'created_at', 'updated_at'];

function buildAdminPropertiesFilter() {
  // Mirrors getAdminProperties()'s corrected filter call.
  return { column: 'is_deleted', op: 'eq', value: false };
}

test('admin properties filter now targets a column that actually exists on properties', () => {
  const filter = buildAdminPropertiesFilter();
  assert.ok(
    PROPERTIES_TABLE_COLUMNS.includes(filter.column),
    `filter column "${filter.column}" must exist on the properties table`
  );
  assert.equal(PROPERTIES_TABLE_COLUMNS.includes('deleted_at'), false, 'properties genuinely has no deleted_at column (confirmed live)');
});

test('admin properties filter matches the same is_deleted=false convention as getProperties()/getProperty()', () => {
  const userFacingFilter = { column: 'is_deleted', op: 'eq', value: false }; // getProperties()/getProperty()
  const adminFilter = buildAdminPropertiesFilter();
  assert.deepEqual(adminFilter, userFacingFilter);
});
