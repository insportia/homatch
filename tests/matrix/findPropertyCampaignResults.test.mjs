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
const SQL = read('supabase/migrations/20261115090000_find_property_campaign_results.sql');
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
  assert.match(RUN, /const allocation = allocateCampaign\(budget, rate\);/);
  assert.match(RUN, /requireFullBudget: true,\n      \.\.\.\(isTest \? \{ minViableOverrideCredits: test\.credits \} : \{\}\),/);
  /* The override can only LOWER the product minimum. */
  assert.match(BILLING, /\? Math\.min\(budgetRules\.minViableBudgetCredits, override\)/);
});

test('alternatives are shown only when asked for, and labelled as not matches', () => {
  assert.match(RESULTS, /MATCHES: \['EXACT', 'POTENTIAL'\]/);
  assert.match(PAGE, /effectiveView === 'ALTERNATIVE' \? <p/);
});
