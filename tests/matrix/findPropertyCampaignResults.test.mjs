// Deep Search results, money transparency and the 20-credit test campaign (owner, 2026-10-18):
// source contracts that keep each campaign's results its own, the counts truthful, the
// customer's money readable without provider costs, and the test amount gated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const RUN = read('supabase/functions/find-property-run/index.ts');
const RESULTS = read('supabase/functions/_shared/findProperty/campaignResults.ts');
const SETTLE = read('supabase/functions/_shared/discoveryRun.ts');
const BILLING = read('supabase/functions/_shared/billing.ts');
const SQL = read('supabase/migrations/20261117090000_find_property_campaign_results.sql');
const PANEL = read('src/components/findProperty/PaidCampaignPanel.tsx');
const PAGE = read('src/components/findProperty/campaign/CampaignResultsView.tsx');
const PARTS = read('src/components/findProperty/campaign/CampaignParts.tsx');
const ROUTES = read('src/routes.tsx');

test('every campaign has its own stable results page, never the free search list', () => {
  assert.match(ROUTES, /path: '\/find-property\/campaign\/:runId', element: <FindPropertyCampaignPage \/>/);
  assert.match(PANEL, /navigate\(campaignResultsPath\(run\.id\)\)/, 'View results opens THIS campaign');
  assert.doesNotMatch(PANEL, /paidResultsPath/, 'no longer the mixed paid view of the search');
  assert.match(SQL, /primary key \(run_id, observation_id\)/);
  assert.match(SQL, /snapshot jsonb not null/, 'a snapshot keeps results stable after the observation changes');
});

test('results are read only by the campaign owner or an admin, server-side; RLS denies clients', () => {
  assert.match(RUN, /if \(!owner \|\| \(owner\.user_id !== me\.id && me\.is_admin !== true\)\) return json\(\{ error: 'Campaign not found\.', reasonCode: 'UNKNOWN_CAMPAIGN' \}, 404\);/);
  assert.match(SQL, /enable row level security/);
  assert.match(SQL, /revoke all on public\.find_property_campaign_results from anon, authenticated;/);
  assert.doesNotMatch(SQL, /create policy/i, 'no client policy at all');
  assert.match(RUN, /if \(action === 'admin_campaigns'\) \{\n      if \(me\.is_admin !== true\) return json\(\{ error: 'Forbidden' \}, 403\);/);
});

test('counts are truthful: a campaign "delivers" its judged matches, not the free search\'s deliveries', () => {
  assert.match(SETTLE, /const shown = socialCampaign \? campaignAvailable \?\? 0 : delivered;/);
  assert.match(SETTLE, /results_found: shown,/);
  assert.match(SETTLE, /delivered: campaignAvailable \?\? 0,/, 'settlement metadata records the campaign\'s own matches');
  /* The charge is unchanged: consumed provider spend ÷ 0.63 (settlePaidSocialRun with spendMicros). */
  assert.match(SETTLE, /settlePaidSocialRun\(db, grant, \{\n      runId: run\.id, spendMicros,/);
  assert.match(PARTS, /fpc_exact_label/);
  assert.match(PARTS, /<details className=\{cx\('group rounded-xl border/, 'raw volume is a collapsed detail, not the headline');
  assert.doesNotMatch(PANEL, /fpi_paid_offers_found/, 'raw offers are never the success headline');
});

test('the customer sees held / charged / released, never provider costs or margins', () => {
  assert.match(RESULTS, /from\('usage_reservations'\)\.select\('status,reserved_credits,settled_credits,released_credits,settled_at'\)/);
  const customerPart = RESULTS.slice(RESULTS.indexOf('export async function readCampaignResults'), RESULTS.indexOf('/** Admin: one campaign'));
  for (const secret of ['actual_micros', 'provider_cost_usd', 'provider_budget_micros', 'grossSpread', 'reserved_micros']) {
    assert.ok(!customerPart.includes(secret), `${secret} never reaches the customer's results`);
  }
  assert.match(PARTS, /row\(final \? 'fpc_money_charged' : 'fpc_money_used_pending'/, 'a hold is never labelled a final charge');
});

test('admin economics: gross spread only; VAT, fees and net margin are explicit unknowns', () => {
  assert.match(RESULTS, /vatUsd: null, paymentFeesUsd: null, netMarginUsd: null,/);
  assert.match(RESULTS, /grossSpreadUsd: known && revenueUsd != null \?/);
  assert.match(RESULTS, /providerRunId: a\.provider_run_id/);
  assert.match(RESULTS, /costBasis: a\.cost_basis/);
});

test('20-credit TEST campaign: Admin switch (default OFF), admins/listed testers only, exactly that amount', () => {
  assert.match(SQL, /values \('find_property_test_campaign', '\{"enabled": false, "credits": 20, "testers": \[\]\}'::jsonb\)\non conflict \(key\) do nothing;/);
  assert.match(RUN, /const allowed = v\?\.enabled === true && Number\.isFinite\(credits\) && credits >= 10 && credits < 50 && \(me\.is_admin === true \|\| testers\.includes\(me\.id\)\);/);
  assert.match(RUN, /const isTest = test\.allowed && budget === test\.credits;/);
  assert.match(RUN, /if \(!Number\.isFinite\(budget\) \|\| \(budget < minCredits && !isTest\)\) \{/);
  /* Same reservation path, full budget, 37/63 allocation of the test price. */
  assert.match(RUN, /const allocation = allocateCampaign\(budget, rate, PAID_DISCOVERY_CURRENT_POLICY\);/);
  assert.match(RUN, /requireFullBudget: true,\n      \.\.\.\(isTest \? \{ minViableOverrideCredits: test\.credits \} : \{\}\),/);
  /* The override can only LOWER the product minimum. */
  assert.match(BILLING, /\? Math\.min\(budgetRules\.minViableBudgetCredits, override\)/);
});

test('alternatives are shown only when asked for, and labelled as not matches', () => {
  assert.match(RESULTS, /MATCHES: \['EXACT', 'POTENTIAL'\]/);
  assert.match(PAGE, /effectiveView === 'ALTERNATIVE' \? <p/);
});

test('backfill is idempotent, judged as of the campaign, and cannot charge or call a provider', () => {
  const persist = RESULTS.slice(RESULTS.indexOf('export async function persistCampaignResults'), RESULTS.indexOf('const ENDED'));
  /* Writes: only this campaign's result rows (upsert on its key) and its own counts. */
  const writes = [...persist.matchAll(/from\('([a-z_]+)'\)\.(insert|upsert|update|delete)/g)].map((m) => `${m[1]}.${m[2]}`);
  assert.deepEqual([...new Set(writes)].sort(), ['discovery_runs.update', 'find_property_campaign_results.delete', 'find_property_campaign_results.upsert']);
  assert.match(persist, /upsert\(rows\.slice\(i, i \+ 500\), \{ onConflict: 'run_id,observation_id' \}\)/);
  assert.match(persist, /\.update\(\{ campaign_outcome:/, 'the run update touches campaign_outcome only');
  assert.match(persist, /\.delete\(\)\.eq\('run_id', runId\)\.in\('observation_id', stale/, 'only this campaign\'s stale rows');
  /* No money or provider path anywhere in the module. */
  for (const forbidden of ['rpc(', 'wallet_', 'usage_reservations\').update', 'credit_ledger', 'settle', 'startRun', 'abortRun', 'memo23Client', 'find_property_book_actor_cost', 'beginExecution', 'releaseExecution']) {
    assert.ok(!persist.includes(forbidden), `persistCampaignResults must not reach ${forbidden}`);
  }
  assert.ok(!RESULTS.includes('rpc('), 'campaignResults.ts calls no RPC at all');
  /* Deterministic over time: judged as of the campaign's end. */
  assert.match(persist, /const asOf = Date\.parse\(String\(run\.completed_at \?\? run\.started_at \?\? ''\)\) \|\| Date\.now\(\);/);
  assert.match(persist, /judgeCampaign\(offers, criteria, fetched, asOf, toUsd\)/);
  /* Prices in USD only through dated rates as of the campaign (fx_rates in effect then, NBG within 3 days). */
  assert.match(RESULTS, /\.lte\('effective_from', new Date\(asOf\)\.toISOString\(\)\)/);
  assert.match(RESULTS, /const nbg = ratesFromPayload\(await fetchCurrentFx\(\), asOf\);/);
  /* The lazy backfill only runs for an ENDED campaign without counts; settlement happened earlier, once (claimSettlement). */
  assert.match(RESULTS, /if \(!outcome && ENDED\.has\(String\(run\.status\)\)\) outcome = await persistCampaignResults/);
  assert.match(SETTLE, /if \(!\(await claimSettlement\(db, run\.id\)\)\) \{/);
});

test('probe-first and the Telegram output gate act before anything is reserved', () => {
  const OFFERS = read('supabase/functions/_shared/findProperty/socialOffers.ts');
  const exec = OFFERS.slice(OFFERS.indexOf('export async function executeOfferJob'), OFFERS.indexOf('async function start('));
  assert.ok(exec.indexOf('followUpDecision') < exec.indexOf('return start(db, job, run);'), 'the probe decision comes before start (the reservation)');
  assert.match(exec, /if \(decision === 'STOP_LOW_YIELD'\) return out\(\{ outcome: 'CANCELLED', error: 'LOW_YIELD_PROBE' \}\);/);
  assert.match(OFFERS, /outputVerified: a\.output_contract_verified_at != null,/);
  const PLAN = read('src/research-core/findProperty/offerCampaign.ts');
  assert.match(PLAN, /export const OUTPUT_VERIFICATION_REQUIRED: ReadonlySet<string> = new Set\(\['TELEGRAM_CHANNEL'\]\);/);
});

test('provenance: results are captured at settlement; a later rebuild is verified or says so', () => {
  const persist = RESULTS.slice(RESULTS.indexOf('export async function persistCampaignResults'), RESULTS.indexOf('const ENDED'));
  assert.match(SETTLE, /persistCampaignResults\(db, runId, 'CAMPAIGN_END'\)/, 'settlement captures them as the campaign ends');
  assert.match(RESULTS, /if \(!outcome && ENDED\.has\(String\(run\.status\)\)\) outcome = await persistCampaignResults\(db, runId\)/, 'a lazy read is a RECONSTRUCTED capture (the default)');
  /* Verified only when every actor run still owns exactly what it booked and nothing changed after the end. */
  assert.match(persist, /verified: ars\.every\(\(a\) => \(owned\.get\(a\.id\) \?\? 0\) === Number\(a\.offers_found \?\? 0\)\) && changedAfterEnd === 0,/);
  assert.match(persist, /Date\.parse\(String\(o\.updated_at \?\? ''\)\) > endedAt/);
  assert.match(persist, /campaign_outcome: \{ \.\.\.funnel, criteria, judgedAsOf: new Date\(asOf\)\.toISOString\(\), provenance \}/);
  assert.match(PAGE, /o\.provenance\.captured === 'RECONSTRUCTED' && !o\.provenance\.verified[\s\S]*fpc_rebuilt_note/, 'an unproven rebuild is labelled on the page');
});

test('the test-campaign minimum override is scoped to Find Property inside the shared billing module', () => {
  assert.match(BILLING, /export const MIN_VIABLE_OVERRIDE_PRODUCTS: ReadonlySet<string> = new Set\(\['FIND_PROPERTY'\]\);/);
  assert.match(BILLING, /const override = MIN_VIABLE_OVERRIDE_PRODUCTS\.has\(opts\.productCode\) \? Number\(opts\.minViableOverrideCredits\) : Number\.NaN;/);
  /* Its one caller passes it only for an allowed test start. */
  assert.match(RUN, /productCode: 'FIND_PROPERTY',[\s\S]{0,400}\.\.\.\(isTest \? \{ minViableOverrideCredits: test\.credits \} : \{\}\),/);
});
