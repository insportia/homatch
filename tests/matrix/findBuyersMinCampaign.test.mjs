// FIND BUYERS / FIND TENANTS — $5 MINIMUM CAMPAIGN AND THE EXECUTION BUDGET (20261119120000).
// The money invariants, read from the sources (the SQL also runs against Postgres in
// tests/sql/find_buyers_min_5_execution_budget.sql):
//   * exactly 50 credits = $5 everywhere a campaign is priced or offered: server refusal,
//     public config, presets, the launch panel's floor — larger budgets stay supported;
//   * the split is never re-implemented here: the execution budget is the central paid
//     discovery policy's provider share, stamped on the campaign (Global Finance V2's seam);
//   * every OpenAI call is paid from that budget and refused when it cannot be covered;
//   * the atomic reserve holds the classification of in-flight runs inside the ceiling.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const read = (p) => readFileSync(join(process.cwd(), p), 'utf8');
const SQL = read('supabase/migrations/20261119120000_find_buyers_min_5_execution_budget.sql');
const CAMPAIGN = read('supabase/functions/_shared/findBuyers/campaign.ts');
const MATCH = read('supabase/functions/match-campaign/index.ts');
const AI = read('supabase/functions/_shared/findBuyers/aiClassify.ts');
const PIPELINE = read('supabase/functions/_shared/findBuyers/pipeline.ts');
const EXECUTOR = read('supabase/functions/_shared/findBuyers/executor.ts');
const ADAPTIVE = read('supabase/functions/_shared/findBuyers/adaptive.ts');
const LEADS = read('src/services/homatchLeads.ts');
const PANEL = read('src/components/campaign/CampaignLaunchPanel.tsx');
const SERVICE = read('src/services/findBuyers.ts');
const POLICY = read('src/research-core/billing/paidDiscoveryPolicy.ts');
const SELECTOR = read('src/components/findBuyers/ResearchBudgetSelector.tsx');

test('1. the server minimum is exactly $5 = 50 credits, refused before any credit is reserved', () => {
  assert.match(CAMPAIGN, /minUsd: PAID_DISCOVERY_MIN_USD,/, 'no stale admin value (was 10) moves it');
  assert.match(CAMPAIGN, /return minimumCampaignCredits\(creditsPerUsd, minUsd\);/, 'one minimum, the policy\'s');
  const refuse = MATCH.indexOf("reasonCode: 'BELOW_CAMPAIGN_MINIMUM'");
  const reserve = MATCH.indexOf('const grant = await beginExecution(');
  assert.ok(refuse > 0 && reserve > refuse, 'the minimum is checked before the wallet reservation');
  assert.match(MATCH, /minBudgetUsd: campaignMinCredits \/ walletRate,/);
  assert.match(MATCH, /requestedBudget > discovery\.campaignMaxCredits/, 'larger budgets up to the configured maximum');
});

test('2. every read offers the same minimum and starts the ladder at 50', () => {
  assert.match(LEADS, /export const RESEARCH_PRESETS = \[50, 100, 500, 1000, 1500, 2000\] as const;/);
  assert.match(LEADS, /export const RESEARCH_MIN_CREDITS = 50;/);
  assert.match(PANEL, /minCredits=\{fbConfig\?\.minCredits\}/);
  const mirrored = Number(SERVICE.match(/export const FIND_BUYERS_MIN_USD = (\d+);/)?.[1]);
  assert.equal(mirrored, Number(POLICY.match(/export const PAID_DISCOVERY_MIN_USD = (\d+);/)?.[1]), 'the offer mirrors the policy minimum');
  assert.match(SERVICE, /minCredits: Math\.ceil\(FIND_BUYERS_MIN_USD \* rate\),/, 'the launch floor is $5 in wallet credits');
  assert.match(SELECTOR, /50: \['rb_preset_50_name', 'rb_preset_50_desc'\]/);
  assert.match(SQL, /set value = '5'::jsonb\s+where key = 'find_buyers_min_usd'/);
  assert.match(SQL, /set value = '\[50, 100, 500, 1000, 1500, 2000\]'::jsonb\s+where key = 'search_budget_presets_find_clients'/);
  assert.match(SQL, /5::numeric as min_usd/, 'public config: $5');
});

test('3. no second finance engine: VAT and the split live only in the central policy', () => {
  // Finance V2: the split is the central policy's CURRENT policy (VAT-first 37/63), named explicitly.
  assert.match(CAMPAIGN, /const a = allocateCampaign\(credits, creditsPerUsd, PAID_DISCOVERY_CURRENT_POLICY\);/, 'the execution budget is the policy\'s');
  const dirs = ['supabase/functions/_shared/findBuyers', 'src/research-core/findBuyers'];
  for (const d of dirs) for (const f of readdirSync(join(process.cwd(), d)).filter((x) => /\.ts$/.test(x))) {
    const code = read(`${d}/${f}`).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    assert.doesNotMatch(code, /\bvat\b|\b0\.63\b|\b6300\b|\b3700\b|\b0\.18\b/i, `${d}/${f} computes no VAT or split of its own`);
  }
  assert.doesNotMatch(SQL.replace(/--.*$/gm, ''), /provider_share_bps\s*:=|\bvat\b/i, 'the migration does not touch the split');
});

test('4. every OpenAI call is paid from the execution budget, never past it', () => {
  const gate = AI.indexOf('opts.gate.admit(classifyCallCeilingMicros(opts.book, batch.length))');
  const send = AI.indexOf('await openAiJson<');
  assert.ok(gate > 0 && send > gate, 'the classification gate runs before the request');
  assert.match(AI, /opts\.gate\?\.spend\(res\.costMicros\);/, 'what it cost is taken off');
  assert.match(AI, /if \(answered === 'NO_BUDGET'\) return;/, 'a refused batch is not retried into the ceiling');
  assert.match(PIPELINE, /gate: aiGate,/);
  assert.match(PIPELINE, /intentGate\.admit\(aiCallCeilingMicros\(/, 'the legacy intent path is gated too');
  assert.match(EXECUTOR, /const aiGate = await campaignAiGate\(db, campaign\.matching_job_id, settings\.aiHeadroomPerItemMicros, run\.id\);/, 'one gate per run');
  assert.match(EXECUTOR, /remaining = spend \? spend\.headroomMicros :/, 'deepening sees the OpenAI spend');
  const adapt = ADAPTIVE.indexOf('executionHeadroomMicros(evidence.budgetMicros, evidence.spentMicros) >= ceiling');
  assert.ok(adapt > 0 && adapt < ADAPTIVE.indexOf('ADAPTIVE_SYSTEM_PROMPT,\n      modelInput'), 'the planner asks only when it can pay');
  assert.match(CAMPAIGN, /return new AiSpendGate\(spend \? spend\.headroomMicros : 0\);/, 'unknown spend shuts the gate');
});

test('5. the atomic reserve holds the classification still owed inside the ceiling', () => {
  assert.match(SQL, /v_ai_hold := v_ai_hold \+ v_limit \* v_per_item;/);
  assert.match(SQL, /if v_committed \+ v_estimate \+ v_ai_hold > v_c\.provider_budget_micros then/);
  assert.match(SQL, /status in \('RESERVED', 'STARTING', 'RUNNING'\) and cost_booked_at is null;/, 'only runs still in flight hold headroom');
  assert.match(SQL, /'find_buyers_ai_headroom_micros_per_item', '250'::jsonb/);
  assert.match(SQL, /revoke all on function public\.find_buyers_reserve_actor_run\(.*\) from public, anon, authenticated;/);
});
