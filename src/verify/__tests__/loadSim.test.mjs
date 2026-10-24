// loadSim.test.mjs — the burst projection (scripts/verify/load-sim.mjs) behaves like the system it models:
// more replicas never slow a burst, worker slots bind at one replica, a source cap binds past that, and raising
// that cap is what moves the 200-job time. The mechanism itself is tested with the real QueueRunner in
// official-worker/test/loadReplicas.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate } from '../../../scripts/verify/load-sim.mjs';

test('replicas help until a source cap binds; then only the cap moves the time', () => {
  const one = simulate({ jobs: 200, replicas: 1 });
  const three = simulate({ jobs: 200, replicas: 3 });
  const six = simulate({ jobs: 200, replicas: 6 });
  assert.match(one.bindingSource, /worker slots/, 'one replica is short of slots');
  assert.ok(three.officialMinutes < one.officialMinutes / 2);
  assert.equal(three.bindingSource, 'mygov', 'at three replicas MyGov (cap 16) is the limit');
  assert.ok(six.officialMinutes >= three.officialMinutes - 1, 'six replicas cannot beat the MyGov cap');
  const raised = simulate({ jobs: 200, replicas: 6, caps: { mygov: 32, tas: 36 } });
  assert.ok(raised.officialMinutes < six.officialMinutes * 0.7, 'raising the binding caps is what shortens the burst');
  for (const jobs of [50, 200, 1000]) {
    let prev = Infinity;
    for (const replicas of [1, 3, 6, 10]) {
      const r = simulate({ jobs, replicas });
      assert.ok(r.officialMinutes <= prev, `${jobs} jobs: ${replicas} replicas slower than fewer`);
      prev = r.officialMinutes;
    }
  }
});
