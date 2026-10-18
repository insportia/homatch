// The reservation sweeper runs only behind the owner's switch (off by default).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { sweepExpiredReservations, SWEEPER_SETTING, SWEEP_LIMIT } = await import('../walletSweeper.ts');

function fakeSb(value, rpcResult = { data: 3, error: null }) {
  const rpcs = [];
  return {
    rpcs,
    from: (t) => ({ select: () => ({ eq: (_c, key) => ({ maybeSingle: async () => ({ data: t === 'admin_settings' && key === SWEEPER_SETTING && value !== undefined ? { value } : null }) }) }) }),
    rpc: async (name, args) => { rpcs.push({ name, args }); return rpcResult; },
  };
}

test('off by default and when the switch is anything but true: no money moves', async () => {
  for (const v of [undefined, false, 'false', '"false"', null, 'yes']) {
    const sb = fakeSb(v);
    assert.deepEqual(await sweepExpiredReservations(sb), { enabled: false, released: null });
    assert.equal(sb.rpcs.length, 0);
  }
});

test('on: one bounded sweep per tick through the existing wallet function', async () => {
  for (const v of [true, 'true', '"true"']) {
    const sb = fakeSb(v);
    assert.deepEqual(await sweepExpiredReservations(sb), { enabled: true, released: 3 });
    assert.deepEqual(sb.rpcs, [{ name: 'wallet_sweep_expired_reservations', args: { p_limit: SWEEP_LIMIT } }]);
  }
  await assert.rejects(sweepExpiredReservations(fakeSb('true', { data: null, error: { message: 'FORBIDDEN' } })), /FORBIDDEN/);
});

test('jobs-worker runs it isolated: a sweep failure never costs the other steps their tick', () => {
  const fn = readFileSync(new URL('../../jobs-worker/index.ts', import.meta.url), 'utf8');
  assert.match(fn, /sweepExpiredReservations\(sb\)\.catch\(/);
});
