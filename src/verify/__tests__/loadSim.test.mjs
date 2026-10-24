// loadSim.test.mjs — the burst projection (scripts/verify/load-sim.mjs) behaves like the system it models:
// more replicas never slow a burst, worker slots bind at one replica, a source cap binds past that, and
// a single job matches the measured median. The mechanism itself is tested with the real QueueRunner in
// official-worker/test/loadReplicas.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../../../scripts/verify/load-sim.mjs';

test('calibrated: one verification alone reproduces the measured production 14 min median', () => {
  const runs = Array.from({ length: 60 }, (_, i) => simulate({ jobs: 1, replicas: 1, seed: i + 1 }).allDoneMinutes).sort((a, b) => a - b);
  assert.ok(runs[30] >= 12 && runs[30] <= 16, `single-job median ${runs[30]} min`);
});

test('replicas help until RS (cap 4) binds; government caps are inputs, never tuned here', () => {
  const one = simulate({ jobs: 200, replicas: 1 });
  const three = simulate({ jobs: 200, replicas: 3 });
  const six = simulate({ jobs: 200, replicas: 6 });
  const ten = simulate({ jobs: 200, replicas: 10 });
  assert.match(one.bindingSource, /worker slots/, 'one replica is short of slots');
  assert.ok(three.officialMinutes < one.officialMinutes / 2);
  assert.equal(six.bindingSource, 'rstax', 'at six replicas the RS registry cap is the limit');
  assert.equal(ten.officialMinutes, six.officialMinutes, 'ten replicas cannot beat the RS cap');
  // More browser slots per replica reach the same ceiling with fewer replicas (worker setting, not a source cap).
  assert.ok(simulate({ jobs: 200, replicas: 3, browserSlots: 5 }).officialMinutes <= six.officialMinutes + 1);
  for (const jobs of [50, 200, 1000]) {
    let prev = Infinity;
    for (const replicas of [1, 3, 6, 10]) {
      const r = simulate({ jobs, replicas });
      assert.ok(r.officialMinutes <= prev, `${jobs} jobs: ${replicas} replicas slower than fewer`);
      prev = r.officialMinutes;
    }
  }
});
