import assert from 'node:assert/strict';
import test from 'node:test';
import { allocate, authorizeProviderSpend } from '../marketplace/commercial.ts';

test('the owner examples: $5 and $10 split exactly', () => {
  assert.deepEqual(allocate(50), { credits: 50, grossCents: 500, providerCapCents: 225, homatchCents: 275, vatCents: 76, netCents: 199 });
  assert.deepEqual(allocate(100), { credits: 100, grossCents: 1000, providerCapCents: 450, homatchCents: 550, vatCents: 153, netCents: 397 });
});

test('50 credits is the minimum; invalid input is refused', () => {
  assert.deepEqual(allocate(49), { error: 'BELOW_CAMPAIGN_MINIMUM' });
  assert.deepEqual(allocate(0), { error: 'INVALID_CREDITS' });
  assert.deepEqual(allocate(50.5), { error: 'INVALID_CREDITS' });
  assert.deepEqual(allocate(50, -1), { error: 'INVALID_VAT_RATE' });
});

test('invariants hold for every amount: provider never above 45%, parts sum to gross', () => {
  for (let credits = 50; credits <= 5000; credits += 7) {
    const a = allocate(credits);
    assert.ok(a.providerCapCents * 10_000 <= a.grossCents * 4500, `cap ≤ 45% at ${credits}`);
    assert.equal(a.providerCapCents + a.homatchCents, a.grossCents);
    assert.equal(a.homatchCents - a.vatCents, a.netCents);
    assert.ok(a.netCents > 0);
  }
});

test('provider spend gate: unknown cost refused, cap never exceeded, kill switch wins', () => {
  const a = allocate(50);
  assert.deepEqual(authorizeProviderSpend(a, 0, null), { allowed: false, reason: 'UNKNOWN_COST' });
  assert.deepEqual(authorizeProviderSpend(a, 0, Number.NaN), { allowed: false, reason: 'UNKNOWN_COST' });
  assert.deepEqual(authorizeProviderSpend(a, 200, 25), { allowed: true, remainingCents: 0 });
  assert.deepEqual(authorizeProviderSpend(a, 200, 26), { allowed: false, reason: 'PROVIDER_CAP_REACHED' });
  assert.deepEqual(authorizeProviderSpend(a, 0, 1, { killSwitch: true }), { allowed: false, reason: 'KILL_SWITCH' });
});
