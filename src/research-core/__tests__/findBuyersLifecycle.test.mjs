// FIND BUYERS — launch readiness, the owner's view of the server lifecycle,
// live arrivals and numbered pages (no network, no database).
import test from 'node:test';
import assert from 'node:assert/strict';

import { decideReadiness, outcomeWithoutExternalWork } from '../findBuyers/readiness.ts';
import { campaignView, arrivalAction, pageWindow, parsePage, currentState, networkNodes } from '../../findBuyers/campaignView.ts';

const off = { socialEnabled: false, providerConfigured: true, eligibleActors: 0, nativeSourceDiscoveryEnabled: false, telegramEnabled: true, forumEnabled: false };

test('A. zero executable work → not ready (the 2026-10-04 production configuration)', () => {
  /* production: social switch off, 0 eligible actors, native discovery off (telegram flag on). */
  const r = decideReadiness(off);
  assert.equal(r.ready, false);
  assert.equal(r.reason, 'DISCOVERY_SWITCHED_OFF');
  assert.equal(decideReadiness({ ...off, socialEnabled: true }).reason, 'NO_ELIGIBLE_SOURCE');
  assert.equal(decideReadiness({ ...off, socialEnabled: true, eligibleActors: 3, providerConfigured: false }).reason, 'PROVIDER_NOT_CONFIGURED');
  assert.equal(decideReadiness({ ...off, nativeSourceDiscoveryEnabled: true, telegramEnabled: false }).reason, 'DISCOVERY_UNAVAILABLE');
});

test('B. valid readiness: one verified actor, or native discovery, is executable work', () => {
  assert.deepEqual(decideReadiness({ ...off, socialEnabled: true, eligibleActors: 1 }), { ready: true, social: true, native: false, reason: null });
  assert.equal(decideReadiness({ ...off, nativeSourceDiscoveryEnabled: true }).ready, true);
});

test('M. planning queued nothing and nothing internal → UNAVAILABLE (released), never completed-zero', () => {
  assert.equal(outcomeWithoutExternalWork(0), 'UNAVAILABLE');
  assert.equal(outcomeWithoutExternalWork(2), 'INTERNAL_RESULTS');
});

const base = { sources: [], queue: { total: 0, queued: 0, running: 0, done: 0, failed: 0 }, signalsAnalyzed: 0, newResults: 0, strong: 0 };
const nodes = (...states) => states.map((state, i) => ({ source: `S${i}`, state, results: 0 }));

test('C/F. searching with four sources running, an early result keeps the campaign searching', () => {
  const v = campaignView({ ...base, state: 'PARTIAL_RESULTS', sources: nodes('RUNNING', 'RUNNING', 'RUNNING', 'RUNNING', 'QUEUED'),
    queue: { total: 5, queued: 1, running: 4, done: 0, failed: 0 }, signalsAnalyzed: 38, newResults: 1, strong: 1 });
  assert.equal(v.live, true);
  assert.equal(v.control, 'pause');
  assert.equal(v.motion, 'active');
  assert.equal(v.metrics.sourcesWorking, 4);
  assert.equal(v.metrics.possible, 1);
  assert.equal(v.headlineKey, 'fbl_state_partial');
  assert.equal(v.progress, null, 'no finished work yet → no invented percentage');
});

test('progress is a real fraction of planned work, never a constant', () => {
  const v = campaignView({ ...base, state: 'SEARCHING', queue: { total: 10, queued: 3, running: 4, done: 2, failed: 1 } });
  assert.equal(v.progress, 0.3);
  assert.equal(campaignView({ ...base, state: 'COMPLETED_NO_RESULTS', queue: { total: 4, queued: 0, running: 0, done: 4, failed: 0 } }).progress, null);
});

test('G/H. completion states come only from the server and say different things', () => {
  const zero = campaignView({ ...base, state: 'COMPLETED_NO_RESULTS' });
  const found = campaignView({ ...base, state: 'COMPLETED_WITH_RESULTS', newResults: 3 });
  const unavailable = campaignView({ ...base, state: 'UNAVAILABLE' });
  assert.equal(zero.headlineKey, 'fbl_state_done_zero');
  assert.equal(found.headlineKey, 'fbl_state_done_results');
  assert.equal(unavailable.headlineKey, 'fbl_state_unavailable');
  assert.notEqual(unavailable.headlineKey, zero.headlineKey, 'infrastructure failure is never "no demand"');
  for (const v of [zero, found, unavailable]) { assert.equal(v.live, false); assert.equal(v.control, 'none'); assert.equal(v.motion, 'still'); }
  assert.equal(unavailable.tone, 'problem');
});

test('I/J. pause: PAUSING keeps runs finishing (slowing, no button), PAUSED is still with resume', () => {
  const pausing = campaignView({ ...base, state: 'PAUSING', sources: nodes('RUNNING', 'QUEUED') });
  assert.equal(pausing.control, 'pausing');
  assert.equal(pausing.motion, 'slowing');
  assert.equal(pausing.canStop, false);
  const paused = campaignView({ ...base, state: 'PAUSED', sources: nodes('DONE', 'QUEUED') });
  assert.equal(paused.control, 'resume');
  assert.equal(paused.motion, 'still');
  assert.equal(paused.live, true, 'a paused search is still this property\'s search (no second campaign)');
  assert.equal(paused.headlineKey, 'fbl_state_paused');
});

test('K. the view is a pure function of server state (a refresh renders the same thing)', () => {
  const input = { ...base, state: 'SEARCHING', sources: nodes('RUNNING', 'DONE', 'FAILED'), queue: { total: 3, queued: 0, running: 1, done: 1, failed: 1 } };
  assert.deepEqual(campaignView(input), campaignView(structuredClone(input)));
  assert.equal(campaignView(input).metrics.sourcesDone, 2, 'a failed source is finished, others keep going');
});

test('R/F. live arrivals: an empty list shows them, a list being read gets an offer', () => {
  assert.equal(arrivalAction(0, 0, 1), 'auto');
  assert.equal(arrivalAction(9, 1, 2), 'offer');
  assert.equal(arrivalAction(9, 2, 2), 'none');
  assert.equal(arrivalAction(9, 3, 2), 'none');
});

test('Q. numbered pages: 0, 1 and many pages; current always visible; URL page clamped', () => {
  assert.deepEqual(pageWindow(1, 0), []);
  assert.deepEqual(pageWindow(1, 1), [1]);
  assert.deepEqual(pageWindow(1, 5), [1, 2, 'gap', 5]);
  assert.deepEqual(pageWindow(5, 12), [1, 'gap', 4, 5, 6, 'gap', 12]);
  assert.deepEqual(pageWindow(12, 12), [1, 'gap', 11, 12]);
  assert.equal(parsePage('3', 7), 3);
  assert.equal(parsePage('99', 7), 7);
  assert.equal(parsePage('x', 7), 1);
  assert.equal(parsePage(null, 0), 1);
});

test('D. a past failed/unavailable attempt never poisons a fresh READY state; it is a dated history line', () => {
  const past = { state: 'UNAVAILABLE', completedAt: '2026-10-04T15:16:38Z' };
  const ready = currentState(past, { ready: true });
  assert.equal(ready.headlineKey, 'fbl_state_ready');
  assert.equal(ready.last.headlineKey, 'fbl_state_unavailable');
  assert.equal(ready.last.at, '2026-10-04T15:16:38Z');
  assert.equal(currentState(past, { ready: false }).headlineKey, 'fbl_state_cannot_start');
  assert.equal(currentState(null, { ready: true }).last, null);
  /* E. searching only while a search is actually running */
  for (const st of ['PREPARING', 'QUEUED', 'SEARCHING', 'PARTIAL_RESULTS', 'PAUSING', 'PAUSED']) {
    const c = currentState({ state: st }, { ready: true });
    assert.notEqual(c.headlineKey, 'fbl_state_ready', st);
    assert.equal(c.last, null, st);
  }
  for (const st of ['COMPLETED_WITH_RESULTS', 'COMPLETED_NO_RESULTS', 'DEGRADED_COMPLETED', 'FAILED', 'UNAVAILABLE', 'CANCELLED']) {
    assert.equal(currentState({ state: st }, { ready: true }).headlineKey, 'fbl_state_ready', `${st} is history`);
  }
});

test('F/G. the discovery network: what ran (real counts), what could, what is off — never invented activity', () => {
  /* the owner's first real run: Telegram read 2 messages and registered 31 communities, 0 qualified */
  const nodes = networkNodes(
    [{ source: 'TELEGRAM', state: 'DONE', results: 2, checked: 2, communities: 31, qualified: 0 }],
    [{ family: 'TELEGRAM', state: 'AVAILABLE' }, { family: 'FACEBOOK', state: 'DISABLED' }, { family: 'INSTAGRAM', state: 'DISABLED' }, { family: 'FORUM', state: 'DISABLED' }],
  );
  assert.deepEqual(nodes.map((n) => [n.source, n.state, n.executed]), [
    ['TELEGRAM', 'DONE', true], ['FACEBOOK', 'DISABLED', false], ['FORUM', 'DISABLED', false], ['INSTAGRAM', 'DISABLED', false],
  ]);
  assert.equal(nodes[0].checked, 2);
  assert.equal(nodes[0].communities, 31);
  assert.equal(nodes[0].qualified, 0, '33 items are never 33 buyers');
  /* before any search: available families are AVAILABLE; after a run, an available family that did not run is NOT_SELECTED */
  assert.equal(networkNodes([], [{ family: 'VK', state: 'AVAILABLE' }])[0].state, 'AVAILABLE');
  assert.equal(networkNodes([{ source: 'TELEGRAM', state: 'DONE', results: 0 }], [{ family: 'VK', state: 'AVAILABLE' }])[1].state, 'NOT_SELECTED');
  /* a future family appears by itself */
  assert.equal(networkNodes(null, [{ family: 'NEW_SOURCE', state: 'AVAILABLE' }])[0].source, 'NEW_SOURCE');
  /* metrics read "checked", from the real per-source counts */
  const v = campaignView({ state: 'COMPLETED_NO_RESULTS', sources: [], queue: { total: 2, queued: 0, running: 0, done: 2, failed: 0 },
    signalsAnalyzed: 0, signalsChecked: 2, newResults: 0, strong: 0 });
  assert.equal(v.metrics.signals, 2);
  assert.equal(v.metrics.possible, 0);
});
