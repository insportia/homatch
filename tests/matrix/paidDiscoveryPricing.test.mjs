// The 37/63 paid discovery policy is ONE policy: the TS module, its SQL twin, Find
// Buyers' start and settlement all point at it, and only new campaigns use it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');
const POLICY = read('src/research-core/billing/paidDiscoveryPolicy.ts');
const CAMPAIGN = read('supabase/functions/_shared/findBuyers/campaign.ts');
const RUN = read('supabase/functions/_shared/campaignRun.ts');
const BILLING = read('supabase/functions/_shared/billing.ts');
const MIGRATION = read('supabase/migrations/20261107091700_paid_discovery_pricing_policy.sql');

test('the TS policy and its SQL twin state the same share and policy id', () => {
  assert.match(POLICY, /PAID_DISCOVERY_PROVIDER_BPS = 6300/);
  assert.match(POLICY, /PAID_DISCOVERY_POLICY_ID = 'paid_discovery_37_63_v1'/);
  assert.match(MIGRATION, /returns integer language sql immutable parallel safe as \$\$ select 6300 \$\$/);
  assert.match(MIGRATION, /pricing_policy in \('paid_discovery_37_63_v1'\)/);
  const code = POLICY.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(code, /1\.18|11800|vat/i, 'no VAT-inclusive math in the split');
});

test('new Find Buyers campaigns are budgeted and stamped with the policy', () => {
  assert.match(CAMPAIGN, /const econ0 = paidDiscoveryEconomics\(input\.credits, rate\);/);
  assert.match(CAMPAIGN, /pricing_policy: econ\.pricingPolicy,/);
});

test('settlement charges consumed ÷ 0.63 only for stamped campaigns, and the wallet still clamps', () => {
  assert.match(RUN, /pricing\?\.pricing_policy === PAID_DISCOVERY_POLICY_ID\s*\? creditsForSpend\(/);
  assert.match(RUN, /settleExecution\(db, grant, \{\s*priceCredits,/);
  assert.match(BILLING, /if \(usage\.priceCredits != null[\s\S]{0,120}actualCredits = usage\.priceCredits;/);
  assert.match(BILLING, /rpc\('wallet_settle', \{\s*p_reservation_id: grant\.reservationId,\s*p_actual_credits: actualCredits/);
});

test('extensions follow the campaign policy; legacy campaigns keep the admin share', () => {
  assert.match(MIGRATION, /when v_camp\.pricing_policy = 'paid_discovery_37_63_v1'\s*then public\.paid_discovery_provider_share_bps\(\)\s*else greatest\(0, least\(9000, public\.billing_setting_num\('find_buyers_provider_share_bps', 5000\)\)\)/);
});
