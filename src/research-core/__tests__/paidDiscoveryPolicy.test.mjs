// The owner's paid discovery split: HOMATCH 37% / providers 63% of the TOTAL
// price P, charged as consumed ÷ 0.63 and capped at P. These are the release
// assertions the brief names; if one moves, the policy moved.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PAID_DISCOVERY_HOMATCH_BPS, PAID_DISCOVERY_PROVIDER_BPS, PAID_DISCOVERY_POLICY_ID,
  allocateCampaign, allocatePriceMicros, chargeForSpend, creditsForSpend, minimumCampaignCredits, formatUsdCents,
} from '../billing/paidDiscoveryPolicy.ts';

const RATE = 10; // 10 credits = $1

test('37/63 is 55%−18%·P / 45%+18%·P of the total price', () => {
  assert.equal(PAID_DISCOVERY_PROVIDER_BPS, 4500 + 1800);
  assert.equal(PAID_DISCOVERY_HOMATCH_BPS, 5500 - 1800);
});

for (const [usd, homatch, provider] of [[5, '$1.85', '$3.15'], [10, '$3.70', '$6.30'], [30, '$11.10', '$18.90'], [100, '$37.00', '$63.00']]) {
  test(`$${usd} → ${homatch} HOMATCH / ${provider} providers`, () => {
    const a = allocateCampaign(usd * RATE, RATE);
    assert.equal(a.policy, PAID_DISCOVERY_POLICY_ID);
    assert.equal(formatUsdCents(a.homatchMarginCents), homatch);
    assert.equal(formatUsdCents(a.providerBudgetCents), provider);
    assert.equal(a.homatchMarginMicros + a.providerBudgetMicros, a.priceMicros);
  });
}

test('never the VAT-inclusive $2.745 figure', () => {
  const a = allocateCampaign(50, RATE);
  assert.equal(a.providerBudgetMicros, 3_150_000);
  assert.notEqual(a.providerBudgetMicros, 2_745_000);
});

test('a fully used $5 campaign charges exactly $5 and releases nothing', () => {
  const c = chargeForSpend(3_150_000, 50, RATE);
  assert.equal(c.chargeCents, 500);
  assert.equal(c.chargeCredits, 50);
  assert.equal(c.releasedCredits, 0);
  assert.equal(c.homatchMarginCents, 185);
});

test('provider spend can never exceed the $3.15 cap of a $5 campaign, nor the charge exceed $5', () => {
  const c = chargeForSpend(9_000_000, 50, RATE);
  assert.equal(c.spendMicros, 3_150_000);
  assert.equal(c.chargeCredits, 50);
  assert.equal(c.capped, true);
});

test('partial spend charges consumed ÷ 0.63 rounded up to the cent; the rest is released', () => {
  const c = chargeForSpend(1_000_000, 50, RATE); // $1 of provider spend
  assert.equal(c.chargeCents, 159); // $1.5873 → $1.59
  assert.equal(c.chargeCredits, 15.9);
  assert.equal(c.releasedCredits, 34.1);
});

test('no spend (cancelled before any provider ran) charges 0 and releases everything', () => {
  const c = chargeForSpend(0, 50, RATE);
  assert.equal(c.chargeCredits, 0);
  assert.equal(c.releasedCredits, 50);
});

test('the charge is the same whichever unit the split is computed from', () => {
  assert.deepEqual(allocateCampaign(300, RATE), allocatePriceMicros(30_000_000));
});

test('the minimum paid campaign is 50 credits ($5) and cannot be configured lower', () => {
  assert.equal(minimumCampaignCredits(RATE), 50);
  assert.equal(minimumCampaignCredits(RATE, 1), 50);
  assert.equal(minimumCampaignCredits(RATE, 10), 100);
});

test('bad money input throws instead of charging NaN', () => {
  assert.throws(() => chargeForSpend(-1, 50, RATE));
  assert.throws(() => allocateCampaign(Number.NaN, RATE));
});

test('uncapped credits-for-spend agrees with the capped charge below the cap', () => {
  for (const spend of [0, 1, 999_999, 1_000_000, 3_150_000]) assert.equal(creditsForSpend(spend, RATE), chargeForSpend(spend, 50, RATE).chargeCredits);
  assert.equal(creditsForSpend(6_300_000, RATE), 100); // beyond a $5 cap: the wallet clamps, extensions carry the rest
});

/* ── Finance V2 (2026-10-19): paid_discovery_37_63_vat_v2 — VAT out first, then 37/63 ── */
import {
  PAID_DISCOVERY_VAT_POLICY_ID, PAID_DISCOVERY_CURRENT_POLICY, isPaidDiscoveryPolicy,
} from '../billing/paidDiscoveryPolicy.ts';

const V2 = PAID_DISCOVERY_VAT_POLICY_ID;

test('v2 owner examples: VAT, VAT-exclusive revenue, HOMATCH 37% and execution 63% of it', () => {
  // [$ gross, VAT µ$, net µ$, HOMATCH µ$, execution µ$] — the brief's $5 / $10 / $30 table
  for (const [usd, vat, net, homatch, execution] of [
    [5, 762712, 4237288, 1567797, 2669491],
    [10, 1525424, 8474576, 3135593, 5338983],
    [30, 4576271, 25423729, 9406780, 16016949],
  ]) {
    const a = allocatePriceMicros(usd * 1_000_000, V2);
    assert.equal(a.policy, V2);
    assert.equal(a.vatMicros, vat, `$${usd} VAT`);
    assert.equal(a.netMicros, net, `$${usd} net`);
    assert.equal(a.homatchMarginMicros, homatch, `$${usd} HOMATCH`);
    assert.equal(a.providerBudgetMicros, execution, `$${usd} execution`);
    assert.equal(a.vatMicros + a.homatchMarginMicros + a.providerBudgetMicros, a.priceMicros, 'nothing lost, nothing invented');
  }
});

test('v2: VAT is extracted once — never gross × 18%, never added on top of the price', () => {
  const a = allocateCampaign(100, RATE, V2); // $10
  assert.notEqual(a.vatMicros, 1_800_000, 'not 18% of the gross');
  assert.equal(a.priceMicros, 10_000_000, 'the customer price is the displayed price');
  assert.ok(chargeForSpend(a.providerBudgetMicros, 100, RATE, V2).chargeCredits <= 100, 'a fully used budget never charges above the price');
});

test('v2 charge for spend: × 11800/6300, rounded up to the cent, capped; partial runs pay only what they used', () => {
  assert.equal(creditsForSpend(3_000_000, RATE, V2), 56.2, '$3 of execution → $5.62');
  assert.equal(creditsForSpend(3_000_000, RATE), 47.7, 'v1 unchanged → $4.77');
  assert.equal(creditsForSpend(0, RATE, V2), 0, 'nothing used → nothing charged');
  const full = chargeForSpend(2_669_491, 50, RATE, V2);
  assert.equal(full.chargeCredits, 50, 'a $5 campaign that used its whole execution budget charges exactly $5');
  assert.equal(full.releasedCredits, 0);
  const over = chargeForSpend(9_000_000, 50, RATE, V2);
  assert.ok(over.capped && over.chargeCredits === 50, 'never above the authorised price');
  const part = chargeForSpend(1_000_000, 100, RATE, V2);
  assert.equal(part.chargeCents, 188, '$1 of provider + AI → $1.88');
  assert.equal(part.releasedCredits, 100 - 18.8, 'the unused budget is released, never charged');
  assert.equal(part.homatchMarginCents, 159 - 100, 'HOMATCH margin is the VAT-exclusive charge minus spend');
});

test('provider plus AI cost share one execution ceiling', () => {
  const a = allocateCampaign(50, RATE, V2);
  const apify = 2_000_000; const ai = 600_000;
  assert.ok(apify + ai <= a.providerBudgetMicros, '$2.60 fits $2.669491');
  assert.ok(apify + ai + 100_000 > a.providerBudgetMicros, 'one more $0.10 call would not');
});

test('policy identity: new campaigns are v2, v1 stays recognised, nothing else is a paid campaign', () => {
  assert.equal(PAID_DISCOVERY_CURRENT_POLICY, V2);
  assert.ok(isPaidDiscoveryPolicy(V2) && isPaidDiscoveryPolicy(PAID_DISCOVERY_POLICY_ID));
  assert.ok(!isPaidDiscoveryPolicy(null) && !isPaidDiscoveryPolicy('paid_discovery_37_63_v3'));
  // Historical compatibility: v1 numbers are exactly what they were.
  assert.equal(allocatePriceMicros(10_000_000).providerBudgetMicros, 6_300_000);
  assert.equal(allocatePriceMicros(10_000_000).vatMicros, 0, 'v1 had no VAT inside the split');
});
