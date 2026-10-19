import assert from 'node:assert/strict';
import test from 'node:test';
import { allocate, authorizeProviderSpend, FIND_PROPERTY_MIN_CREDITS } from '../findPropertyCommercial.ts';

test('the owner examples (Finance V2): VAT out first, then 37% HOMATCH / 63% execution of the VAT-exclusive revenue', () => {
  // [credits, VAT ¢, HOMATCH ¢, execution ¢, execution µ$]: $5 → $0.76 / $1.57 / $2.66 (2,669,491 µ$), $10 → $1.53 / $3.14 / $5.33 (cents floored; the remainder is VAT)
  for (const [credits, vat, homatch, provider, providerMicros] of [[50, 77, 157, 266, 2669491], [100, 153, 314, 533, 5338983], [300, 458, 941, 1601, 16016949]]) {
    const a = allocate(credits);
    assert.equal(a.vatCents, vat, `${credits} VAT`);
    assert.equal(a.homatchCents, homatch, `${credits} HOMATCH`);
    assert.equal(a.providerCapCents, provider, `${credits} execution`);
    assert.equal(a.providerCapMicros, providerMicros);
    assert.equal(a.policy, 'paid_discovery_37_63_vat_v2');
  }
});

test('50 credits ($5) is the minimum; invalid input is refused', () => {
  assert.equal(FIND_PROPERTY_MIN_CREDITS, 50);
  assert.deepEqual(allocate(49), { error: 'BELOW_CAMPAIGN_MINIMUM' });
  assert.deepEqual(allocate(0), { error: 'INVALID_CREDITS' });
  assert.deepEqual(allocate(50.5), { error: 'INVALID_CREDITS' });
});

test('invariants hold for every amount: execution never above 63% of VAT-exclusive revenue, parts sum to gross', () => {
  for (let credits = 50; credits <= 5000; credits += 7) {
    const a = allocate(credits);
    assert.ok(a.providerCapMicros * 11_800 <= a.grossCents * 10_000 * 6300, `cap ≤ 63% of gross/1.18 at ${credits}`);
    assert.equal(a.providerCapCents + a.homatchCents + a.vatCents, a.grossCents);
    assert.ok(a.vatCents > 0);
    assert.ok(a.homatchCents > 0);
  }
});

test('provider spend gate: unknown cost refused, $5 never spends above $2.66, kill switch wins', () => {
  const a = allocate(50);
  assert.deepEqual(authorizeProviderSpend(a, 0, null), { allowed: false, reason: 'UNKNOWN_COST' });
  assert.deepEqual(authorizeProviderSpend(a, 0, Number.NaN), { allowed: false, reason: 'UNKNOWN_COST' });
  assert.deepEqual(authorizeProviderSpend(a, 250, 16), { allowed: true, remainingCents: 0 });
  assert.deepEqual(authorizeProviderSpend(a, 250, 17), { allowed: false, reason: 'PROVIDER_CAP_REACHED' });
  assert.deepEqual(authorizeProviderSpend(a, 0, 1, { killSwitch: true }), { allowed: false, reason: 'KILL_SWITCH' });
});
