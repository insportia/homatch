// FIND BUYERS — source execution truth on the owner's screen. Six states from
// what actually happened; never imply a source ran. Includes the 2026-10-04
// owner search (job 123bd287): Telegram ran, the social planner failed, every
// social family must read BLOCKED — not "available" — and "only Telegram".
import test from 'node:test';
import assert from 'node:assert/strict';

import { networkNodes, executionState, searchScope } from '../../findBuyers/campaignView.ts';

const NET = ['FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'LINKEDIN', 'X', 'TELEGRAM', 'FORUM'].map((family) => ({ family, state: family === 'FORUM' ? 'DISABLED' : 'AVAILABLE' }));
const telegramDone = [{ source: 'TELEGRAM', state: 'DONE', checked: 0, communities: 0, qualified: 0, total: 2, running: 0, queued: 0, done: 2, failed: 0, results: 0 }];

test('the 2026-10-04 run: only Telegram ran; social families are BLOCKED by the planner failure', () => {
  const plan = { outcome: 'FAILED', reason: 'PLANNER_ERROR', queued: 0 };
  const nodes = networkNodes(telegramDone, NET);
  const by = Object.fromEntries(nodes.map((n) => [n.source, executionState(n, plan)]));
  assert.equal(by.TELEGRAM, 'COMPLETED');
  for (const f of ['FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'LINKEDIN', 'X']) assert.equal(by[f], 'BLOCKED', f);
  assert.equal(by.FORUM, 'BLOCKED', 'switched off is blocked');
  const scope = searchScope(nodes, plan);
  assert.equal(scope.onlySource, 'TELEGRAM');
  assert.deepEqual(scope.executed, ['TELEGRAM']);
  assert.equal(scope.socialBlocked, true);
  assert.equal(scope.socialReason, 'PLANNER_ERROR');
});

test('a social planner that queued work: unused families are SKIPPED, not blocked', () => {
  const plan = { outcome: 'QUEUED', reason: null, queued: 4 };
  const sources = [...telegramDone, { source: 'FACEBOOK', state: 'RUNNING', checked: 3, communities: 0, qualified: 1 }, { source: 'TIKTOK', state: 'QUEUED', checked: 0, communities: 0, qualified: 0 },
    { source: 'X', state: 'FAILED', checked: 0, communities: 0, qualified: 0 }];
  const nodes = networkNodes(sources, NET);
  const by = Object.fromEntries(nodes.map((n) => [n.source, executionState(n, plan)]));
  assert.deepEqual([by.TELEGRAM, by.FACEBOOK, by.TIKTOK, by.X, by.INSTAGRAM, by.LINKEDIN], ['COMPLETED', 'RUNNING', 'PLANNED', 'FAILED', 'SKIPPED', 'SKIPPED']);
  const scope = searchScope(nodes, plan);
  assert.equal(scope.socialBlocked, false);
  assert.equal(scope.onlySource, null);
  assert.ok(!scope.executed.includes('TIKTOK'), 'a planned source has not executed');
});

test('a native source is never blocked by the social planner; nothing claims to have run before a search', () => {
  const plan = { outcome: 'SKIPPED', reason: 'NO_ACTOR_READY', queued: 0 };
  const nodes = networkNodes([], NET);
  assert.equal(executionState(nodes.find((n) => n.source === 'TELEGRAM'), plan), 'AVAILABLE', 'no run yet: available, not run');
  assert.deepEqual(searchScope(nodes, plan).executed, []);
  const skippedNative = networkNodes([{ source: 'FACEBOOK', state: 'DONE', checked: 1, communities: 0, qualified: 0 }], NET).find((n) => n.source === 'TELEGRAM');
  assert.equal(executionState(skippedNative, { outcome: 'FAILED', reason: 'PLANNER_ERROR', queued: 0 }), 'SKIPPED');
});
