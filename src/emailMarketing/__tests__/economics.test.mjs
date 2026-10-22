// Email Marketing economics: the owner's published figures (2026-10-22) must come out
// of the code exactly, and provider cost layers must never be blended with allocations.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOMATCH_PLANS, OVERAGE_GROSS_PER_1K, allocate, cheapestTx, marketingTierFor, overageBlock, scenario, splitVat, txCostOnTier, RESEND_TX_TIERS,
} from '../economics.ts';

const r2 = (n) => Math.round(n * 100) / 100;

test('VAT is extracted from VAT-inclusive prices, then 37/63 of net (owner figures)', () => {
  const pro = allocate(50);
  assert.deepEqual([r2(pro.net), r2(pro.vat), r2(pro.homatch), r2(pro.execution)], [42.37, 7.63, 15.68, 26.69]);
  const scale = allocate(220);
  assert.deepEqual([r2(scale.net), r2(scale.vat), r2(scale.homatch), r2(scale.execution)], [186.44, 33.56, 68.98, 117.46]);
  const s = splitVat(118);
  assert.equal(r2(s.net), 100);
  assert.equal(r2(s.vat), 18);
  /* full precision internally: the parts add up exactly */
  assert.ok(Math.abs(pro.homatch + pro.execution - pro.net) < 1e-9);
});

test('customer plans are exactly the commercial terms', () => {
  assert.deepEqual(HOMATCH_PLANS.FREE, { grossUsd: 0, includedEmails: 50, period: 'LIFETIME' });
  assert.deepEqual(HOMATCH_PLANS.PRO, { grossUsd: 50, includedEmails: 50000, period: 'MONTH' });
  assert.deepEqual(HOMATCH_PLANS.SCALE, { grossUsd: 220, includedEmails: 100000, period: 'MONTH' });
  assert.equal(OVERAGE_GROSS_PER_1K, 2.2);
});

test('Resend transactional tiers: base + started-thousand overage, cheapest tier per volume', () => {
  const pro50 = RESEND_TX_TIERS.find((t) => t.name === 'Pro 50k');
  assert.equal(txCostOnTier(pro50, 50_000), 20);
  assert.equal(txCostOnTier(pro50, 50_001), 20.9);
  assert.equal(txCostOnTier(RESEND_TX_TIERS[0], 3_001), null, 'Free has no overage');
  assert.equal(cheapestTx(100_000).costUsd, 35, 'Pro 100k is cheaper than Scale 100k when domains do not matter');
  assert.equal(cheapestTx(100_000, 11).costUsd, 90, 'needing >10 domains forces Scale');
  assert.equal(cheapestTx(1_000_000, 11).costUsd, 650);
});

test('Marketing (Broadcasts) is contact-priced, not per email', () => {
  assert.equal(marketingTierFor(4_000).monthlyUsd, 40);
  assert.equal(marketingTierFor(50_000).monthlyUsd, 250);
  assert.equal(marketingTierFor(200_000), null, 'above the published range is unknown, never guessed');
  const few = scenario('PRO', 'BROADCAST', 50_000, 5_000);
  const many = scenario('PRO', 'BROADCAST', 50_000, 50_000);
  assert.equal(few.providerCostUsd, 40);
  assert.equal(many.providerCostUsd, 250);
  assert.ok(many.contributionUsd < 0, 'a Pro customer emailing 50,000 distinct contacts loses money on Broadcasts');
});

test('transactional full-use Pro month is priced at the account marginal rate', () => {
  const s = scenario('PRO', 'TRANSACTIONAL', 50_000, 0, RESEND_TX_TIERS[3]);
  assert.equal(s.providerCostUsd, 45);
  assert.equal(r2(s.contributionUsd), -2.63);
  assert.equal(r2(s.executionHeadroomUsd), -18.31);
  const sc = scenario('SCALE', 'TRANSACTIONAL', 100_000, 0, RESEND_TX_TIERS[3]);
  assert.equal(sc.providerCostUsd, 90);
  assert.equal(r2(sc.contributionUsd), 96.44);
});

test('an overage block covers its provider cost', () => {
  const b = overageBlock(RESEND_TX_TIERS[3]);
  assert.equal(r2(b.net), 1.86);
  assert.ok(b.net > b.providerCostUsd);
});
