// Paid discovery pricing: v1 (2026-10-16, 37/63 of the gross price) stays exactly as it was
// for the campaigns stamped with it; v2 (Finance V2, 2026-10-19) takes VAT out first and splits
// the VAT-exclusive revenue 37/63. New campaigns are stamped v2; the TS module, its SQL twins,
// Find Buyers' start and settlement all follow the campaign's own policy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const POLICY = read('src/research-core/billing/paidDiscoveryPolicy.ts');
const CAMPAIGN = read('supabase/functions/_shared/findBuyers/campaign.ts');
const RUN = read('supabase/functions/_shared/campaignRun.ts');
const BILLING = read('supabase/functions/_shared/billing.ts');
const V1 = read('supabase/migrations/20261107091700_paid_discovery_pricing_policy.sql');
const V2 = read('supabase/migrations/20261119090000_finance_v2_engine.sql');

test('the TS policy and its SQL twins state the same shares and policy ids', () => {
  assert.match(POLICY, /PAID_DISCOVERY_PROVIDER_BPS = 6300/);
  assert.match(POLICY, /PAID_DISCOVERY_POLICY_ID = 'paid_discovery_37_63_v1'/);
  assert.match(POLICY, /PAID_DISCOVERY_VAT_POLICY_ID = 'paid_discovery_37_63_vat_v2'/);
  assert.match(POLICY, /PAID_DISCOVERY_VAT_BPS = 1800/);
  assert.match(POLICY, /PAID_DISCOVERY_CURRENT_POLICY = PAID_DISCOVERY_VAT_POLICY_ID/, 'new campaigns: v2');
  // v1 SQL twin is untouched; v2 twins use the same integer rounding as the TS module.
  assert.match(V1, /returns integer language sql immutable parallel safe as \$\$ select 6300 \$\$/);
  assert.match(V2, /when 'paid_discovery_37_63_vat_v2' then floor\(p_price_micros \* 6300 \/ 11800\)::bigint/);
  assert.match(V2, /when 'paid_discovery_37_63_v1'     then floor\(p_price_micros \* 6300 \/ 10000\)::bigint/);
  assert.match(V2, /when 'paid_discovery_37_63_vat_v2' then ceil\(greatest\(p_spend_micros, 0\) \* 11800 \/ 6300\)::bigint/);
  assert.match(V2, /pricing_policy in \('paid_discovery_37_63_v1', 'paid_discovery_37_63_vat_v2'\)/);
  // VAT math lives in the v2 branch only: executionShare is the single place the 1.18 enters.
  const code = POLICY.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.match(code, /function executionShare\(policy: PaidDiscoveryPolicyId\)[\s\S]{0,200}den: 10_000 \+ PAID_DISCOVERY_VAT_BPS \}\s*: \{ num: PAID_DISCOVERY_PROVIDER_BPS, den: 10_000 \}/);
  assert.doesNotMatch(code, /0\.63|1\.18/, 'no floating split constants: integer bps only');
});

test('new Find Buyers campaigns are budgeted and stamped with the current policy', () => {
  assert.match(CAMPAIGN, /const econ0 = paidDiscoveryEconomics\(input\.credits, rate\);/);
  assert.match(CAMPAIGN, /pricing_policy: econ\.pricingPolicy,/);
  assert.match(CAMPAIGN, /allocateCampaign\(credits, creditsPerUsd, PAID_DISCOVERY_CURRENT_POLICY\)/);
});

test('settlement follows the campaign policy: v2 on its own ledger spend, v1 unchanged, the wallet still clamps', () => {
  assert.match(RUN, /if \(pricing\?\.pricing_policy === PAID_DISCOVERY_VAT_POLICY_ID\) \{\s*const \{ data: spent, error: spentError \} = await db\.rpc\('find_buyers_campaign_spend_micros'/);
  assert.match(RUN, /if \(spentError\) throw spentError;/, 'a v2 campaign never settles on a guessed spend');
  assert.match(RUN, /creditsForSpend\(spentMicros, Number\(pricing\.credits_per_usd\) \|\| 10, PAID_DISCOVERY_VAT_POLICY_ID\)/);
  assert.match(RUN, /\} else if \(pricing\?\.pricing_policy === PAID_DISCOVERY_POLICY_ID\) \{\s*priceCredits = creditsForSpend\(Math\.round\(costUsd \* 1_000_000\), Number\(pricing\.credits_per_usd\) \|\| 10\);/);
  assert.match(RUN, /settleExecution\(db, grant, \{\s*priceCredits,/);
  assert.match(BILLING, /if \(usage\.priceCredits != null[\s\S]{0,120}actualCredits = usage\.priceCredits;/);
  assert.match(BILLING, /rpc\('wallet_settle', \{\s*p_reservation_id: grant\.reservationId,\s*p_actual_credits: actualCredits/);
});

test('extensions follow the campaign policy; legacy campaigns keep the admin share', () => {
  assert.match(V2, /v_provider_micros := case when v_camp\.pricing_policy = 'paid_discovery_37_63_vat_v2'\s*then public\.paid_discovery_execution_micros\(v_camp\.pricing_policy, v_value_micros\)\s*else floor\(\(v_value_micros \* v_share\) \/ 10000\.0\) end;/);
  assert.match(V2, /when v_camp\.pricing_policy = 'paid_discovery_37_63_v1'\s*then public\.paid_discovery_provider_share_bps\(\)\s*else greatest\(0, least\(9000, public\.billing_setting_num\('find_buyers_provider_share_bps', 5000\)\)\)/);
});
