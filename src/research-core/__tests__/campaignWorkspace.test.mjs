// The External Matching campaign workspace reads its stages and outcome only
// from the server lifecycle. These lock the rules that keep it honest: nothing
// is DONE that the server has not proven, a stopped run never shows later steps
// as finished, and a run's outcome routes to results, empty or problem states
// exactly as the state machine says.
import test from 'node:test';
import assert from 'node:assert/strict';
import { campaignOutcome, campaignStages } from '../../findBuyers/campaignView.ts';

const q = (o = {}) => ({ total: 0, queued: 0, running: 0, done: 0, failed: 0, ...o });
const states = (input) => campaignStages(input).map((s) => s.state);

test('a run that has not started work shows only "preparing" in progress', () => {
  assert.deepEqual(states({ state: 'PREPARING', queue: q(), newResults: 0 }), ['ACTIVE', 'PENDING', 'PENDING', 'PENDING', 'PENDING']);
  assert.deepEqual(states({ state: 'QUEUED', queue: q({ total: 4, queued: 4 }), newResults: 0 }), ['ACTIVE', 'PENDING', 'PENDING', 'PENDING', 'PENDING']);
});

test('discovery is active while steps are outstanding; evaluation only once something finished or was found', () => {
  assert.deepEqual(states({ state: 'SEARCHING', queue: q({ total: 4, running: 2, queued: 2 }), newResults: 0 }), ['DONE', 'ACTIVE', 'PENDING', 'PENDING', 'PENDING']);
  assert.deepEqual(states({ state: 'SEARCHING', queue: q({ total: 4, running: 1, done: 3 }), newResults: 0 }), ['DONE', 'ACTIVE', 'ACTIVE', 'PENDING', 'PENDING']);
  assert.deepEqual(states({ state: 'PARTIAL_RESULTS', queue: q({ total: 4, running: 4 }), newResults: 2 }), ['DONE', 'ACTIVE', 'ACTIVE', 'PENDING', 'PENDING']);
});

test('all steps finished → evaluating; FINISHING → organizing; settled success → all done', () => {
  assert.deepEqual(states({ state: 'SEARCHING', queue: q({ total: 4, done: 4 }), newResults: 1 }), ['DONE', 'DONE', 'ACTIVE', 'PENDING', 'PENDING']);
  assert.deepEqual(states({ state: 'SEARCHING', stage: 'FINISHING', queue: q({ total: 4, done: 4 }), newResults: 1 }), ['DONE', 'DONE', 'DONE', 'ACTIVE', 'PENDING']);
  for (const s of ['COMPLETED_WITH_RESULTS', 'COMPLETED_NO_RESULTS', 'DEGRADED_COMPLETED']) {
    assert.deepEqual(states({ state: s, queue: q({ total: 4, done: 3, failed: 1 }), newResults: 0 }), ['DONE', 'DONE', 'DONE', 'DONE', 'DONE']);
  }
});

test('a failed or cancelled run never claims the steps it did not reach', () => {
  const failed = states({ state: 'FAILED', queue: q({ total: 4, failed: 2, queued: 2 }), newResults: 0 });
  assert.deepEqual(failed, ['DONE', 'DONE', 'HALTED', 'PENDING', 'PENDING']);
  const early = states({ state: 'CANCELLED', queue: q(), newResults: 0 });
  assert.deepEqual(early, ['HALTED', 'PENDING', 'PENDING', 'PENDING', 'PENDING']);
  assert.ok(!early.slice(1).includes('DONE'));
});

test('paused work is held, not running', () => {
  assert.deepEqual(states({ state: 'PAUSED', queue: q({ total: 4, queued: 3, done: 1 }), newResults: 0 }), ['DONE', 'HALTED', 'HALTED', 'PENDING', 'PENDING']);
});

test('outcome follows the state machine and the real result count', () => {
  assert.equal(campaignOutcome('SEARCHING', 3), 'running');
  assert.equal(campaignOutcome('PAUSING', 0), 'paused');
  assert.equal(campaignOutcome('COMPLETED_WITH_RESULTS', 5), 'results');
  assert.equal(campaignOutcome('COMPLETED_NO_RESULTS', 0), 'empty');
  assert.equal(campaignOutcome('DEGRADED_COMPLETED', 2), 'partial');
  assert.equal(campaignOutcome('DEGRADED_COMPLETED', 0), 'failed');
  assert.equal(campaignOutcome('FAILED', 0), 'failed');
  assert.equal(campaignOutcome('UNAVAILABLE', 1), 'partial');
  assert.equal(campaignOutcome('CANCELLED', 0), 'cancelled');
  assert.equal(campaignOutcome('CANCELLED', 4), 'partial');
});
