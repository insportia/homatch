import assert from 'node:assert/strict';
import test from 'node:test';
import { allocate, authorizeProviderSpend, FIND_PROPERTY_MIN_CREDITS } from '../findPropertyCommercial.ts';

test('the owner examples: 37% HOMATCH / 63% providers of the total price', () => {
  for (const [credits, homatch, provider] of [[50, 185, 315], [100, 370, 630], [300, 1110, 1890], [1000, 3700, 6300]]) {
    const a = allocate(credits);
    assert.equal(a.homatchCents, homatch);
    assert.equal(a.providerCapCents, provider);
    assert.equal(a.providerCapMicros, provider * 10_000);
    assert.equal(a.policy, 'paid_discovery_37_63_v1');
  }
});

test('50 credits ($5) is the minimum; invalid input is refused', () => {
  assert.equal(FIND_PROPERTY_MIN_CREDITS, 50);
  assert.deepEqual(allocate(49), { error: 'BELOW_CAMPAIGN_MINIMUM' });
  assert.deepEqual(allocate(0), { error: 'INVALID_CREDITS' });
  assert.deepEqual(allocate(50.5), { error: 'INVALID_CREDITS' });
});

test('invariants hold for every amount: provider never above 63%, parts sum to gross', () => {
  for (let credits = 50; credits <= 5000; credits += 7) {
    const a = allocate(credits);
    assert.ok(a.providerCapCents * 10_000 <= a.grossCents * 6300, `cap ≤ 63% at ${credits}`);
    assert.equal(a.providerCapCents + a.homatchCents, a.grossCents);
    assert.ok(a.homatchCents > 0);
  }
});

test('provider spend gate: unknown cost refused, $5 never spends above $3.15, kill switch wins', () => {
  const a = allocate(50);
  assert.deepEqual(authorizeProviderSpend(a, 0, null), { allowed: false, reason: 'UNKNOWN_COST' });
  assert.deepEqual(authorizeProviderSpend(a, 0, Number.NaN), { allowed: false, reason: 'UNKNOWN_COST' });
  assert.deepEqual(authorizeProviderSpend(a, 300, 15), { allowed: true, remainingCents: 0 });
  assert.deepEqual(authorizeProviderSpend(a, 300, 16), { allowed: false, reason: 'PROVIDER_CAP_REACHED' });
  assert.deepEqual(authorizeProviderSpend(a, 0, 1, { killSwitch: true }), { allowed: false, reason: 'KILL_SWITCH' });
});
