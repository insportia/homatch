// PHASE 2 — UNIVERSAL DISCOVERY: the guarantees each slice adds, read from
// the sources that implement them (docs/claude/PHASE2_DISCOVERY.md).
//
// Slice 0 (safety)
//   * the legacy v1 matcher and classifier run with the service role and have
//     no callers, so only a service-role caller may reach them
//   * the external unlock sends ONE idempotency key per opening of the dialog
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('legacy v1 run-matching and classify-signals refuse any non-service caller before touching data', () => {
  for (const fn of ['run-matching', 'classify-signals']) {
    const src = read(`supabase/functions/${fn}/index.ts`);
    const guard = src.indexOf("bearer !== serviceKey");
    const firstQuery = src.search(/\.from\('/);
    assert.ok(guard > 0, `${fn} compares the bearer with the service key`);
    assert.ok(firstQuery > guard, `${fn} checks the caller before its first query`);
    assert.match(src, /status: 403/, `${fn} answers 403`);
  }
});

test('the external unlock mints its idempotency key once per opening, never on render', () => {
  const src = read('src/components/matching/ExternalContactUnlockModal.tsx');
  assert.match(src, /const idempotencyKey = React\.useMemo\(/);
  assert.match(src, /\[open, matchId\]/);
  assert.doesNotMatch(src, /^\s*const idempotencyKey = `/m, 'no render-time key');
});

// Slice A — FIND BUYERS / TENANTS
const CAMPAIGN = read('supabase/functions/match-campaign/index.ts');
const DRIVER = read('supabase/functions/discovery-queue-worker/driver.ts');
const SOURCES = read('supabase/functions/_shared/campaignSources.ts');
const MIGRATION = read('supabase/migrations/20261008100000_phase2_universal_discovery.sql');

test('every campaign run stores its DiscoveryPlan before any source job is queued, and jobs come from the plan', () => {
  const stored = CAMPAIGN.indexOf('storePlan(db');
  const queued = CAMPAIGN.indexOf('queuePlannedJobs(db');
  assert.ok(stored > 0 && queued > stored, 'plan stored first');
  assert.match(CAMPAIGN, /compileDemandPlan\(/);
  assert.match(CAMPAIGN, /'SEARCH_PLAN_READY'/);
  assert.doesNotMatch(CAMPAIGN, /queueCampaignSourceJobs/, 'the old hand-built queue path is gone');
  assert.match(SOURCES, /plannedSourceJobs\(opts\.plan/);
  assert.match(SOURCES, /dedupe_key: job\.dedupeKey/);
});

test('pause / resume / stop run on the server through discovery_control, owner-checked', () => {
  assert.match(CAMPAIGN, /rpc\('discovery_control'/);
  assert.match(CAMPAIGN, /\.eq\('property_id', propertyId\)\.maybeSingle\(\);\s*\n\s*if \(!controlled\)/);
  assert.match(MIGRATION, /v_owner <> p_user_id/);
  const api = read('src/services/api.ts');
  assert.match(api, /if \(jobId\) await controlMatchingJob\(propertyId, jobId, 'pause'\)/, 'a running search is paused on the server first');
});

test('the driver claims through the fair v2 function, EDGE jobs only, and stops a pause before its reservation lapses', () => {
  assert.match(DRIVER, /rpc\('claim_discovery_source_jobs_v2'/);
  assert.match(DRIVER, /p_executor: 'EDGE'/);
  assert.doesNotMatch(DRIVER, /rpc\('claim_discovery_source_jobs',/);
  assert.match(DRIVER, /expirePausedCampaigns\(db\)/);
});

test('v2 holds a paused run (never cancels it) and claims only native providers', () => {
  const fn = MIGRATION.slice(MIGRATION.indexOf('create or replace function public.claim_discovery_source_jobs_v2'));
  assert.match(fn, /array\['TELEGRAM', 'TELEGRAM_SOURCES', 'FORUM', 'PORTAL'\]/);
  assert.doesNotMatch(fn.slice(0, fn.indexOf('$function$;')), /DATAFORSEO|APIFY/);
  const endedList = fn.match(/j\.status::text in \(([^)]*)\)/)[1];
  assert.doesNotMatch(endedList, /paused/, 'a paused campaign is not an ended one');
  assert.match(fn, /partition by rn\.run_key/, 'one job per run per pass');
});

test('the Matches screen finds the open search on load, so a refresh keeps progress and controls', () => {
  const page = read('src/pages/property/MatchesPage.tsx');
  assert.match(page, /findOpenMatchingJob\(propertyId\)/);
  assert.match(page, /setJobPaused\(open\.status === 'paused'\)/);
  assert.match(page, /p2d_resume_search/);
  assert.match(page, /jobRunning && 'order-first xl:order-none'/, 'controls first on a phone while a search runs');
});
