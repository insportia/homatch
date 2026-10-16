// Paid social campaign settlement: consumed ÷ 0.63, rounded up to the cent,
// never above the reservation; nothing consumed → everything released.
import assert from 'node:assert/strict';
import test from 'node:test';
import { settlePaidSocialRun } from '../findPropertySettlement.ts';

const grant = { ok: true, reservationId: 'r1', authorizedMaxCredits: 50, productCode: 'FIND_PROPERTY' };
function fakeDb() {
  const calls = [];
  return { calls, rpc: async (fn, args) => { calls.push({ fn, args }); return { data: [{ settled_credits: args.p_actual_credits }], error: null }; } };
}
const run = (spendMicros) => ({ runId: 'run-1', spendMicros, creditsPerUsd: 10, durationMs: 1000, offers: 3, delivered: 2 });

test('a fully used $5 campaign charges 50 credits ($5.00)', async () => {
  const db = fakeDb();
  const r = await settlePaidSocialRun(db, grant, run(3_150_000), async () => { throw new Error('no release expected'); });
  assert.equal(r.creditsCharged, 50);
  assert.equal(db.calls[0].args.p_actual_credits, 50);
  assert.equal(db.calls[0].args.p_usage.metadata.pricing, 'paid_discovery_37_63_v1');
});

test('$1 of provider spend charges $1.59 (15.9 credits); the rest is released by the wallet', async () => {
  const db = fakeDb();
  const r = await settlePaidSocialRun(db, grant, run(1_000_000), async () => {});
  assert.equal(r.creditsCharged, 15.9);
});

test('spend above the cap never charges above the reservation', async () => {
  const db = fakeDb();
  const r = await settlePaidSocialRun(db, grant, run(9_000_000), async () => {});
  assert.equal(r.creditsCharged, 50);
  assert.equal(r.capped, true);
});

test('nothing consumed: released, not settled', async () => {
  const db = fakeDb();
  let released = null;
  const r = await settlePaidSocialRun(db, grant, run(0), async (g, reason) => { released = reason; });
  assert.equal(r.action, 'RELEASE');
  assert.equal(r.creditsCharged, 0);
  assert.equal(released, 'no_provider_spend');
  assert.equal(db.calls.length, 0, 'no wallet_settle');
});
