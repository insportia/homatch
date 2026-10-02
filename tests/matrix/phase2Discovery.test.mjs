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
const MIGRATION = read('supabase/migrations/20261009100000_phase2_universal_discovery.sql');

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

test('the driver claims through the fair v2 function per executor, and stops a pause before its reservation lapses', () => {
  assert.match(DRIVER, /rpc\('claim_discovery_source_jobs_v2'/);
  assert.match(DRIVER, /p_executor: executor/);
  assert.match(DRIVER, /runSourceJobs\(db, baseUrl, serviceKey, settings, Math\.min\(5, Number\(body\.limit\) \|\| 1\), 'EDGE'\)/);
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

// Slice B — FIND PROPERTY
const RUN_FN = read('supabase/functions/find-property-run/index.ts');
const SUPPLY_MATCHING = read('supabase/functions/supply-matching/index.ts');
const SUPPLY_DISCOVERY = read('supabase/functions/supply-discovery/index.ts');
const RUN_LIB = read('supabase/functions/_shared/discoveryRun.ts');

test('a Find Property run is PAYG through the wallet, idempotent, one open run per search', () => {
  assert.match(RUN_FN, /productCode: 'FIND_PROPERTY'/);
  assert.match(RUN_FN, /allowIncluded: false/);
  assert.match(RUN_FN, /budgetIsCeiling: true/);
  assert.match(RUN_FN, /eq\('idempotency_key', idempotencyKey\)/);
  assert.match(RUN_FN, /in\('status', OPEN_RUN_STATES\)/);
  assert.match(RUN_FN, /findPropertyDiscoveryEnabled/, 'off until an operator switches it on');
  const reserve = RUN_FN.indexOf('beginExecution(db');
  const plan = RUN_FN.indexOf('storePlan(db');
  const queue = RUN_FN.indexOf('queuePlannedJobs(db');
  assert.ok(reserve > 0 && plan > reserve && queue > plan, 'reserve, then plan, then queue');
  assert.match(RUN_FN, /releaseExecution\(db, grant/, 'a failed start releases the reservation');
  assert.match(RUN_FN, /normalisePlan\(draftFromStoredPlan\(/, 'a stored plan is re-validated, not trusted');
  assert.match(RUN_FN, /livePortalAdaptersFor\(/, 'only adapters the portal runtime executes serve PORTAL jobs');
  assert.doesNotMatch(RUN_FN, /PORTAL_SOURCES/, 'config ids (home-ss-ge) are not runtime ids (ss-ge)');
});

test('a customer plan x an external listing is written as EXTERNAL_LISTING, keyed by plan and observation', () => {
  assert.match(SUPPLY_MATCHING, /source_kind: planDemand \? 'EXTERNAL_LISTING' : 'EXTERNAL_INTELLIGENCE'/);
  assert.match(SUPPLY_MATCHING, /onConflict: planDemand \? 'intent_profile_id,observation_id' : 'signal_id,observation_id'/);
  assert.match(SUPPLY_MATCHING, /signal_id: planDemand \? null : signalId/);
});

test('a PORTAL job reads one live adapter scoped by the plan, with the budget as a real filter', () => {
  const fn = SUPPLY_DISCOVERY.slice(SUPPLY_DISCOVERY.indexOf('async function portalJob'));
  assert.match(fn, /in\('lifecycle', \['LIVE_TESTED', 'PRODUCTIVE'\]\)/);
  assert.match(fn, /eq\('active', true\)/);
  assert.match(fn, /price: \{ min: subject\.price\?\.min/);
  assert.match(fn, /persist\(db, sourceRow/, 'the same observation writer as every sweep');
  assert.match(fn, /resolveMarket\(db/, 'entity resolution runs on what was written');
});

test('a run ends by counting only what it delivered, charging only for that, unknown cost kept unknown', () => {
  const settlement = read('supabase/functions/_shared/findPropertySettlement.ts');
  assert.match(settlement, /eq\('source_kind', 'EXTERNAL_LISTING'\)/);
  assert.match(settlement, /Date\.parse\(row\.created_at\) >= started/, 'counted from this run\'s start');
  assert.match(RUN_LIB, /loadDeliveries\(db, run\.intent_profile_id, run\.started_at\)/);
  assert.match(RUN_LIB, /settleFindPropertyRun\(db, grant/);
  assert.doesNotMatch(RUN_LIB, /settleExecution/, 'never the shared work-priced settle');
  assert.match(RUN_LIB, /provider_cost_usd: costUnknown \? null : providerCostUsd/);
  const driver = read('supabase/functions/discovery-queue-worker/driver.ts');
  assert.match(driver, /advanceRuns\(db/);
  assert.match(driver, /rescueStuckRuns\(db\)/);
  assert.match(driver, /expirePausedRuns\(db\)/);
});

// Slice B — community supply
test('a listing post filtered out of demand also becomes a supply observation, deterministically', () => {
  const cls = read('supabase/functions/classify-signals-v2/index.ts');
  const lib = read('supabase/functions/_shared/communitySupply.ts');
  assert.match(cls, /recordCommunitySupply\(db,s as any\)/);
  assert.match(cls, /mode==='community-supply-backfill'/);
  assert.match(cls, /modelCalls:0/, 'the backfill never calls a model');
  assert.match(lib, /onConflict: 'source_id,external_id'/, 'a re-read updates, never duplicates');
  assert.match(lib, /field_origins: \{ \.\.\.listing\.origins, rawSignalId: signal\.id \}/, 'provenance kept per field');
  assert.doesNotMatch(lib, /first_seen_at/, 'first seen is set once, by insert');
});

test('reposts collapse: results and the delivery count are per property (entity), resolution scoped by city', () => {
  const fp = read('supabase/functions/find-property/index.ts');
  assert.match(fp, /seenEntities/);
  assert.match(read('supabase/functions/_shared/findPropertySettlement.ts'), /entity_id \?\? row\.observation_id/);
  const sd = read('supabase/functions/supply-discovery/index.ts');
  const resolver = sd.slice(sd.indexOf('async function resolveMarket'));
  assert.match(resolver.slice(0, 1500), /placeNamesFor\(city\)/);
  assert.match(read('supabase/functions/discovery-queue-worker/driver.ts'), /mode: 'resolve-market'/);
});

test('the outside-search panel shows only real server state and never a provider, cost or raw error', () => {
  const panel = read('src/components/matching/OutsideSearchPanel.tsx')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.match(panel, /latestOutsideRun\(id\)/, 'the run is read from the server, so a refresh keeps it');
  assert.match(panel, /setInterval\(\(\) => \{ void refresh\(\); \}, 5000\)/);
  assert.match(panel, /productCode="FIND_PROPERTY"/);
  assert.doesNotMatch(panel, /TELEGRAM|PORTAL'|provider|cost_usd|error_message/, 'no provider names or costs reach the customer');
  assert.match(panel, /controlOutsideRun\(run\.id, action\)/);
  const page = read('src/pages/FindPropertyPage.tsx');
  assert.match(page, /<OutsideSearchPanel /);
});

// Worker route (Hybrid) and live checks
test('portal hops route through the official worker only when an operator says so, with no service key on Railway', () => {
  const sd = read('supabase/functions/supply-discovery/index.ts');
  assert.match(sd, /new WorkerTransport\(\{/);
  assert.match(sd, /String\(body\.executor \?\? 'EDGE'\) === 'WORKER'/);
  const driver = read('supabase/functions/discovery-queue-worker/driver.ts');
  assert.match(driver, /if \(settings\.workerRouteEnabled\)/);
  assert.match(driver, /p_providers: executor === 'WORKER' \? \['PORTAL'\] : null/);
  const worker = read('official-worker/src/discovery/SafeFetch.ts') + read('official-worker/src/discovery/routes.ts');
  assert.doesNotMatch(worker, /SUPABASE_SERVICE_ROLE_KEY|service_role/, 'the worker holds no database authority');
  assert.match(worker, /lookup: \(_host: string, options: any, callback: any\)/, 'the connection is pinned');
  assert.match(worker, /answers\.some\(\(a\) => !isPublicAddress\(a\.address\)\)/, 'every DNS answer is checked');
  assert.match(read('official-worker/src/index.ts'), /mountDiscoveryRoutes\(app, \{ token: TOKEN \}\)/);
});

test('live checks are bounded, robots-first, write only admin-read rows, and never store a page body', () => {
  const sa = read('supabase/functions/source-audit/index.ts');
  const fn = sa.slice(sa.indexOf('async function liveCheck'));
  assert.match(fn, /disallowsEverything\(disallow\)/);
  const robots = fn.indexOf("robots.txt`");
  const home = fn.indexOf("https://${host}/`, { maxBytes");
  assert.ok(robots > 0 && home > robots, 'robots.txt is read before the home page');
  assert.match(fn, /from\('discovery_source_live_checks'\)\.insert\(rows\)/);
  assert.doesNotMatch(fn, /body: html|html: html|evidence: \{[^}]*html[,}]/, 'no body is stored');
  assert.ok(sa.includes("'www.myhome.ge'"), 'MyHome is re-audited from production');
});

test('admin intelligence is one admin-only read, inside the Admin shell, with no secrets or text', () => {
  const sql = read('supabase/migrations/20261009100100_phase2_admin_intelligence.sql')
    .replace(/--.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(sql, /if not public\.is_admin\(\) then\s+raise exception 'FORBIDDEN'/);
  assert.match(sql, /key not like '%token%'/);
  assert.doesNotMatch(sql, /original_text|description|phone|insert into|update public|delete from/i);
  assert.match(read('src/pages/admin/AdminDiscoveryPage.tsx'), /<DiscoveryIntelligencePanel \/>/);
  const fn = read('supabase/functions/discovery-queue-worker/index.ts');
  const live = fn.slice(fn.indexOf("mode === 'admin_live_check'"), fn.indexOf("mode === 'admin_live_check'") + 300);
  assert.match(live, /isAdminCaller\(req, db\)/);
});
