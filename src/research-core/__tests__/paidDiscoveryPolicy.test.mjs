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
