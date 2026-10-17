// FIND BUYERS — the campaign list is built from the property's SEARCHES (find_buyers_campaigns
// ⨝ matching_jobs), not from its lead rows (owner, 2026-10-17): a newer search with zero leads
// is still the latest one, each search has its own new / found-again counts, and a person found
// by two searches is one person when every search is counted together.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCampaignList, featuredCampaign, isTerminalLifecycle, jobRunState, lifecycleRunState, parseClearOutcome, parseClearPreview, personKey, uniquePeople,
} from '../leadCampaigns.ts';

const lead = (id, job, over = {}) => ({ id, matching_job_id: job, match_category: 'POTENTIAL', created_at: '2026-09-01T10:00:00Z', seen_before: false, person_id: `p-${id}`, author_profile_url: null, ...over });

test('a newer search with zero leads is the latest; the older one with leads is not labelled latest', () => {
  const list = buildCampaignList({
    campaigns: [
      { matching_job_id: 'old', created_at: '2026-09-01T09:00:00Z', finalized_at: '2026-09-01T09:30:00Z' },
      { matching_job_id: 'new', created_at: '2026-10-16T09:00:00Z', finalized_at: '2026-10-16T09:40:00Z' },
    ],
    jobs: [{ id: 'old', status: 'completed', completed_at: '2026-09-01T09:30:00Z' }, { id: 'new', status: 'completed', completed_at: '2026-10-16T09:40:00Z' }],
    leads: [lead('a', 'old'), lead('b', 'old', { match_category: 'STRONG' })],
  });
  assert.deepEqual(list.map((c) => c.jobId), ['new', 'old']);
  assert.equal(list[0].total, 0);
  assert.equal(list[0].state, 'COMPLETED');
  assert.equal(list[0].completedAt, '2026-10-16T09:40:00Z');
  assert.deepEqual({ total: list[1].total, strong: list[1].strong, qualified: list[1].qualified }, { total: 2, strong: 1, qualified: 2 });
  assert.equal(featuredCampaign(list).jobId, 'new');
});

test('per search: newly discovered vs found again; rejected readings and the same person twice never counted', () => {
  const [c] = buildCampaignList({
    campaigns: [{ matching_job_id: 'j', created_at: '2026-10-10T00:00:00Z' }],
    leads: [
      lead('1', 'j'), lead('2', 'j', { seen_before: true }), lead('3', 'j', { seen_before: true, match_category: 'WEAK' }),
      lead('4', 'j', { match_category: 'REJECTED' }), lead('5', 'j', { person_id: 'p-1' }),
    ],
  });
  assert.deepEqual({ total: c.total, newPeople: c.newPeople, foundAgain: c.foundAgain, weak: c.weak }, { total: 3, newPeople: 1, foundAgain: 2, weak: 1 });
});

test('the live search outranks a stale stored status and is listed before its first lead', () => {
  const list = buildCampaignList({
    campaigns: [{ matching_job_id: 'done', created_at: '2026-10-01T00:00:00Z' }],
    jobs: [{ id: 'done', status: 'completed' }],
    live: { jobId: 'run', state: 'SEARCHING', createdAt: '2026-10-17T08:00:00Z' },
  });
  assert.deepEqual(list.map((c) => [c.jobId, c.state]), [['run', 'RUNNING'], ['done', 'COMPLETED']]);
  /* The dashboard features the newest search, the running one included: never the previous search's numbers. */
  assert.equal(featuredCampaign(list).jobId, 'run');
  /* A stored running job that the live status reports finished reads finished. */
  const after = buildCampaignList({ campaigns: [{ matching_job_id: 'run', created_at: '2026-10-17T08:00:00Z' }], jobs: [{ id: 'run', status: 'searching_sources' }],
    live: { jobId: 'run', state: 'COMPLETED_NO_RESULTS' } });
  assert.equal(after[0].state, 'COMPLETED');
  /* A finished status for a search that was never stored (could not start) is not invented. */
  assert.deepEqual(buildCampaignList({ live: { jobId: 'ghost', state: 'UNAVAILABLE', createdAt: '2026-10-17T09:00:00Z' } }), []);
});

test('lead-only jobs (no campaigns read) are still listed, dated by their earliest lead', () => {
  const list = buildCampaignList({ leads: [lead('1', 'x', { created_at: '2026-10-05T00:00:00Z' }), lead('2', 'x', { created_at: '2026-10-03T00:00:00Z' }), lead('3', 'y', { created_at: '2026-10-04T00:00:00Z' })] });
  assert.deepEqual(list.map((c) => [c.jobId, c.createdAt]), [['y', '2026-10-04T00:00:00Z'], ['x', '2026-10-03T00:00:00Z']]);
});

test('all searches together: each person once (person id, else profile URL)', () => {
  const rows = [
    lead('1', 'a', { person_id: 'P' }), lead('2', 'b', { person_id: 'P', match_category: 'STRONG' }),
    lead('3', 'a', { person_id: null, author_profile_url: 'https://fb.com/x/' }), lead('4', 'b', { person_id: null, author_profile_url: 'https://FB.com/x' }),
    lead('5', 'b', { person_id: 'Q', match_category: 'WEAK' }), lead('6', 'b', { person_id: 'R', match_category: 'REJECTED' }),
  ];
  assert.deepEqual(uniquePeople(rows), { total: 3, qualified: 2 });
  assert.equal(personKey({ id: 'z', person_id: null, author_profile_url: null }), 'l:z');
});

test('state words: job statuses and lifecycle states; terminal lifecycle states', () => {
  assert.equal(jobRunState('ranking'), 'RUNNING');
  assert.equal(jobRunState('budget_reached'), 'COMPLETED');
  assert.equal(jobRunState('failed'), 'FAILED');
  assert.equal(jobRunState(null, true), 'COMPLETED');
  assert.equal(jobRunState(undefined), 'UNKNOWN');
  assert.equal(lifecycleRunState('PAUSING'), 'RUNNING');
  assert.equal(lifecycleRunState('UNAVAILABLE'), 'FAILED');
  assert.equal(isTerminalLifecycle('COMPLETED_WITH_RESULTS'), true);
  assert.equal(isTerminalLifecycle('PAUSED'), false);
  assert.equal(featuredCampaign([]), null);
});

test('clear-results payloads parse defensively', () => {
  assert.deepEqual(parseClearPreview({ leads: 14, legacyMatches: '74', legacyUnlockedKept: 14, activeCampaign: true }), { leads: 14, legacyMatches: 74, legacyUnlockedKept: 14, activeCampaign: true });
  assert.deepEqual(parseClearPreview({}), { leads: 0, legacyMatches: 0, legacyUnlockedKept: 0, activeCampaign: false });
  assert.equal(parseClearPreview(null), null);
  assert.equal(parseClearPreview([1]), null);
  assert.deepEqual(parseClearOutcome({ leadsCleared: 3, legacyMatchesCleared: 74, clearedAt: '2026-10-17T10:00:00Z' }), { leadsCleared: 3, legacyMatchesCleared: 74, clearedAt: '2026-10-17T10:00:00Z' });
  assert.deepEqual(parseClearOutcome({ leadsCleared: -2 }), { leadsCleared: 0, legacyMatchesCleared: 0, clearedAt: null });
});
