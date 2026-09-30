// DISCOVERY ENGINE — the guarantees the Find Buyers / Find Tenants campaign
// rests on, read from the sources that implement them.
//
//   * retired providers (DATAFORSEO, APIFY) can never be claimed or queued
//   * the 30-day active-demand rule is the one rule both matchers apply, and
//     it is applied again where matches are shown and sold
//   * a campaign is PAYG-only with a 50-Credit minimum, and reports only what
//     THIS run found
//   * every new schedule is inert until its admin switch is on
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const MIGRATION = read('supabase/migrations/20260930130000_discovery_engine_queue_freshness_campaigns.sql');
const CAMPAIGN = read('supabase/functions/match-campaign/index.ts');
const SOURCES = read('supabase/functions/_shared/campaignSources.ts');
const RUN = read('supabase/functions/_shared/campaignRun.ts');
const DRIVER = read('supabase/functions/discovery-queue-worker/driver.ts');
const V2 = read('supabase/functions/run-matching-v2/index.ts');
const V1 = read('supabase/functions/run-matching/index.ts');
const UNLOCK = read('supabase/functions/atomic-unlock/index.ts');
const CLASSIFY = read('supabase/functions/classify-signals-v2/index.ts');
const COMMUNITY = read('supabase/functions/community-sync/index.ts');
const FORUM = read('supabase/functions/demand-discovery/index.ts');

const claimFn = MIGRATION.slice(
  MIGRATION.indexOf('create or replace function public.claim_discovery_source_jobs'),
  MIGRATION.indexOf('create or replace function public.finish_discovery_source_job'),
);

test('the source-job claim can only hand out Telegram and forum work, and recovers expired leases', () => {
  assert.match(claimFn, /in \('TELEGRAM', 'FORUM', 'TELEGRAM_SOURCES'\)/);
  assert.doesNotMatch(claimFn, /APIFY|DATAFORSEO/, 'no retired provider is named as claimable');
  assert.match(claimFn, /lease_expires_at < now\(\)/, 'a dead worker\'s job is put back');
  assert.match(claimFn, /skip locked/i);
});

test('the dead retired-provider rows are cancelled, not deleted', () => {
  assert.match(MIGRATION, /set status = 'CANCELLED',\s*cancel_reason = 'PROVIDER_RETIRED'/);
  assert.doesNotMatch(MIGRATION, /delete from public\.discovery_query_queue/i);
});

test('a campaign never queues a retired provider', () => {
  assert.doesNotMatch(SOURCES, /provider: '(APIFY|DATAFORSEO)'/);
  assert.match(SOURCES, /UNSUPPORTED_PROVIDER/, 'the executor refuses anything it does not know');
  assert.doesNotMatch(CAMPAIGN, /'discovery-queue-worker', \{\s*mode: 'execute'/, 'the paid external consumer is not called');
});

test('both matchers apply the canonical active-demand gate and record the demand date', () => {
  for (const [name, src] of [['run-matching-v2', V2], ['run-matching', V1]]) {
    assert.match(src, /judgeActiveDemand\(/, `${name} uses the canonical 30-day judge`);
    assert.doesNotMatch(src, /judgeDemandFreshness\(/, `${name} no longer uses the 365/180-day rule`);
    assert.match(src, /demand_published_at:/, `${name} stores when the person posted`);
  }
});

test('run-matching-v2 rejects a known city, budget or bedroom conflict, and reads every city spelling', () => {
  assert.match(V2, /cityGate\(/);
  assert.match(V2, /budgetVerdict === 'CONFLICT'/);
  assert.match(V2, /bedroomsVerdict === 'CONFLICT'/);
  assert.match(V2, /marketCitySpellings\(/);
  assert.doesNotMatch(V2, /\.ilike\('city', marketCity\)/, 'the single-spelling city filter is gone');
});

test('demand outside the window cannot be sold: atomic-unlock refuses before charging', () => {
  const guard = UNLOCK.indexOf("reasonCode: 'DEMAND_NOT_CURRENT'");
  const charge = UNLOCK.indexOf("rpc('atomic_match_unlock'");
  assert.ok(guard > 0 && charge > 0 && guard < charge, 'the freshness refusal comes before the charge');
  assert.match(UNLOCK, /from\('match_unlocks'\)/, 're-opening an already paid match is never refused');
});

test('a campaign is PAYG-only, 50 Credits minimum, and its budget is the ceiling', () => {
  assert.match(CAMPAIGN, /allowIncluded: false/);
  assert.match(CAMPAIGN, /budgetIsCeiling: true/);
  assert.match(CAMPAIGN, /BELOW_CAMPAIGN_MINIMUM/);
  assert.match(MIGRATION, /\('campaign_min_credits', '50'::jsonb\)/);
  assert.match(MIGRATION, /set min_viable_budget_credits = 50/);
  assert.match(MIGRATION, /set included_per_period = 0\s+where product_code = 'FIND_CLIENTS'/);
});

test('the result is what this run found — never every match the property ever had', () => {
  assert.doesNotMatch(CAMPAIGN, /Matching completed with \$\{totalMatches\} real matches/);
  assert.match(RUN, /\.gte\('created_at', job\.started_at\)/, 'counted from this run\'s start');
  assert.match(RUN, /fresh_matches_created: freshMatches/);
  assert.match(RUN, /\.in\('status', fromStatuses\)/, 'finishing is a conditional transition, so it happens once');
});

test('the driver settles against a held reservation and releases on failure', () => {
  assert.match(DRIVER, /usage_reservations/);
  assert.match(DRIVER, /RESERVATION_NOT_HELD/);
  assert.match(RUN, /releaseExecution\(/);
});

test('every new schedule is inert until its switch is on', () => {
  for (const key of ['telegram_discovery_enabled', 'discovery_background_refresh_enabled', 'forum_discovery_enabled',
    'classifier_schedule_enabled', 'campaign_source_discovery_enabled']) {
    assert.match(MIGRATION, new RegExp(`\\('${key}', 'false'::jsonb\\)`), `${key} defaults to off`);
  }
  assert.match(COMMUNITY, /BACKGROUND_REFRESH_DISABLED/);
  assert.match(FORUM, /FORUM_DISCOVERY_DISABLED/);
  assert.match(CLASSIFY, /CLASSIFIER_SCHEDULE_DISABLED/);
});

test('Telegram costs nothing per request and the classifier never pays twice for the same words', () => {
  assert.match(DRIVER, /p_cost_usd: 0/);
  assert.match(MIGRATION, /'TELEGRAM', 'Telegram'/);
  assert.match(CLASSIFY, /reusableVerdict\(/);
  assert.match(CLASSIFY, /cache_hit:true/);
});

test('each schedule checks its switch in SQL, so it is inert whatever function version is live', () => {
  const schedules = MIGRATION.slice(MIGRATION.indexOf('-- ── 7. SCHEDULES'));
  for (const [fn, key] of [
    ['discovery-queue-worker', 'campaign_source_discovery_enabled'],
    ['community-sync', 'discovery_background_refresh_enabled'],
    ['demand-discovery', 'forum_discovery_enabled'],
    ['classify-signals-v2', 'classifier_schedule_enabled'],
  ]) {
    const at = schedules.indexOf(`functions/v1/${fn}'`);
    const cmd = schedules.slice(at, schedules.indexOf('$cron$', at));
    assert.match(cmd, new RegExp(`where [\\s\\S]*key = '${key}'\\) = 'true'`), `${fn} fires without checking ${key}`);
  }
});

test('the demand-date backfill does not make old matches look recently changed', () => {
  const at = MIGRATION.indexOf('set demand_published_at = r.published_at');
  const before = MIGRATION.slice(Math.max(0, at - 400), at);
  const after = MIGRATION.slice(at, at + 400);
  assert.match(before, /alter table public\.matches disable trigger trg_matches_updated;/);
  assert.match(after, /alter table public\.matches enable trigger trg_matches_updated;/);
});

test('freshness is judged on the demand\'s own publication date, never on updated_at or created_at', () => {
  const current = read('src/matching/currentDemand.ts');
  assert.match(current, /judgeActiveDemand\(row\.demand_published_at/);
  assert.doesNotMatch(current, /judgeActiveDemand\([^)]*(updated_at|created_at)/);
  assert.match(UNLOCK, /judgeActiveDemand\(match\.demand_published_at/);
  assert.doesNotMatch(RUN, /judgeActiveDemand\([^)]*(updated_at|created_at)/);
  assert.match(V2, /demand_published_at: signal\.published_at/);
});

test('the queue columns production already had are declared by the repository', () => {
  for (const col of ['claimed_at timestamptz', 'claim_token uuid', 'estimated_cost_usd numeric', 'finished_at timestamptz', 'actual_cost_usd numeric']) {
    assert.ok(MIGRATION.includes(`add column if not exists ${col}`), col);
  }
});

test('cross-currency budgets use only current, dated rates', () => {
  /* The match writer never fetches: rates arrive from the orchestrators and
     are re-validated. */
  assert.match(V2, /ratesFromPayload\(fxRates\)/);
  assert.doesNotMatch(V2, /NBG_RATES_URL/);
  assert.match(CAMPAIGN, /fxRates,/);
  assert.match(DRIVER, /fxRates: await fetchCurrentFx\(\)/);
  const gates = read('src/research-core/match/structured-gates.ts');
  assert.match(gates, /FX_TABLE_MAX_AGE_DAYS = 7/);
  assert.match(gates, /FX_NBG_MAX_AGE_DAYS = 3/);
});
