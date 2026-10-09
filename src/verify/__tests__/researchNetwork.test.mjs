// The research network: what each node is allowed to claim.
//
//   - a node is DONE only when the pipeline has passed it;
//   - an UNAVAILABLE / PARTIAL section is never drawn as done;
//   - a stopped run marks nothing newly done and exposes the failure;
//   - counters only for numbers the server actually established;
//   - no percentage anywhere;
//   - same input, same picture (remount safety).

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { networkState, RING_KEYS, stageRank } from '../researchNetwork.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const byKey = (s) => Object.fromEntries(s.nodes.map((n) => [n.key, n.state]));
const doneSet = (s) => new Set(s.nodes.filter((n) => n.state === 'DONE').map((n) => n.key));

test('initial state: before the first poll the run is at the beginning', () => {
  const s = networkState({});
  const k = byKey(s);
  assert.equal(k.started, 'ACTIVE');
  for (const key of RING_KEYS.slice(1)) assert.equal(k[key], 'IDLE', key);
  assert.equal(k.complete, 'IDLE');
  assert.equal(s.activeKey, 'started');
  assert.equal(s.terminal, 'RUNNING');
  assert.equal(s.settled, false);
  assert.deepEqual(s.counters, []);
  // every node carries its i18n keys
  for (const n of s.nodes) {
    assert.match(n.labelKey, /^verify_net_node_/);
    assert.match(n.stateKey, /^verify_net_state_/);
  }
});

test('active research: the official stage activates official records only', () => {
  const s = networkState({ status: 'RUNNING', stage: 'BROWSER_WAITING' });
  const k = byKey(s);
  assert.equal(k.started, 'DONE');
  assert.equal(k.identity, 'DONE');
  assert.equal(k.location, 'DONE');
  assert.equal(k.official, 'ACTIVE');
  assert.equal(k.documents, 'IDLE');
  assert.equal(k.market, 'IDLE');
  assert.equal(k.synthesis, 'IDLE');
  assert.equal(k.complete, 'IDLE');
  assert.equal(s.activeKey, 'official');
  // a person-gated wait is still the official step
  assert.equal(byKey(networkState({ status: 'WAITING_HUMAN', stage: 'CAPTCHA_REQUIRED' })).official, 'ACTIVE');
  assert.equal(networkState({ status: 'WAITING_HUMAN', stage: 'CAPTCHA_REQUIRED' }).terminal, 'WAITING');
});

test('market stage: everything before it is done, nothing after it is', () => {
  const s = networkState({ status: 'RUNNING', stage: 'MARKET_WAITING' });
  const k = byKey(s);
  for (const key of ['started', 'identity', 'location', 'official', 'documents', 'registry', 'context']) {
    assert.equal(k[key], 'DONE', key);
  }
  assert.equal(k.market, 'ACTIVE');
  assert.equal(k.crosscheck, 'IDLE');
  assert.equal(k.synthesis, 'IDLE');
  assert.equal(s.activeKey, 'market');
});

test('the parallel market lane shows as active while running, never done early', () => {
  const s = networkState({ status: 'RUNNING', stage: 'BROWSER_WAITING', liveCounters: { marketState: 'RUNNING' } });
  assert.equal(byKey(s).market, 'ACTIVE');
  // the main pipeline step is still the one announced
  assert.equal(s.activeKey, 'official');
  const folded = networkState({ status: 'RUNNING', stage: 'BROWSER_WAITING', liveCounters: { marketState: 'FOLDED' } });
  assert.notEqual(byKey(folded).market, 'DONE');
});

test('partial provider failure: an UNAVAILABLE / PARTIAL section is never DONE', () => {
  const s = networkState({
    status: 'RUNNING',
    stage: 'MARKET_WAITING',
    sections: [
      { id: 'OFFICIAL', maturity: 'UNAVAILABLE' },
      { id: 'LOCATION', maturity: 'PARTIAL' },
      { id: 'PROPERTY', maturity: 'ENRICHING' },
    ],
  });
  const k = byKey(s);
  assert.equal(k.official, 'UNAVAILABLE');
  assert.equal(k.documents, 'UNAVAILABLE');
  assert.equal(k.location, 'PARTIAL');
  assert.equal(k.identity, 'DONE');
  assert.equal(k.market, 'ACTIVE');
  const official = s.nodes.find((n) => n.key === 'official');
  assert.equal(official.stateKey, 'verify_net_state_unavailable');

  // a lost market lane with no market evidence is unavailable, not done
  const lost = networkState({
    status: 'RUNNING',
    stage: 'SYNTHESIS_WAITING',
    liveCounters: { marketState: 'TIMED_OUT' },
    sections: [{ id: 'MARKET', maturity: 'PENDING' }],
  });
  assert.equal(byKey(lost).market, 'UNAVAILABLE');
  // one of two registry sections missing reads as partial
  const reg = networkState({
    status: 'RUNNING',
    stage: 'MARKET_READY',
    sections: [{ id: 'DEVELOPER', maturity: 'UNAVAILABLE' }, { id: 'PARTICIPANTS', maturity: 'ENRICHING' }],
  });
  assert.equal(byKey(reg).registry, 'PARTIAL');
});

test('research complete but no report yet: synthesis is active, the core is not done', () => {
  const s = networkState({ status: 'COMPLETE', stage: 'COMPLETE', synthesizing: true });
  const k = byKey(s);
  assert.equal(k.crosscheck, 'DONE');
  assert.equal(k.synthesis, 'ACTIVE');
  assert.notEqual(k.complete, 'DONE');
  assert.equal(s.settled, false);
});

test('successful completion: the network settles, everything reached is done', () => {
  const s = networkState({
    status: 'COMPLETE',
    stage: 'COMPLETE',
    reportReady: true,
    sections: [{ id: 'PARTICIPANTS', maturity: 'UNAVAILABLE' }, { id: 'DEVELOPER', maturity: 'UNAVAILABLE' }],
  });
  const k = byKey(s);
  assert.equal(k.complete, 'DONE');
  assert.equal(k.synthesis, 'DONE');
  assert.equal(k.official, 'DONE');
  assert.equal(k.registry, 'UNAVAILABLE');
  assert.equal(s.terminal, 'COMPLETE');
  assert.equal(s.settled, true);
  assert.equal(s.activeKey, null);
  assert.ok(!s.nodes.some((n) => n.state === 'ACTIVE'), 'a finished network still has a moving node');
});

test('true failure: nothing newly done, the stopped step and the core read as unavailable', () => {
  const running = networkState({ status: 'RUNNING', stage: 'OFFICIAL_READY' });
  const failed = networkState({ status: 'FAILED', stage: 'OFFICIAL_READY' });
  for (const key of doneSet(failed)) assert.ok(doneSet(running).has(key), `${key} became done on failure`);
  const k = byKey(failed);
  assert.equal(k.documents, 'UNAVAILABLE');
  assert.equal(k.complete, 'UNAVAILABLE');
  assert.equal(k.synthesis, 'IDLE');
  assert.equal(failed.terminal, 'FAILED');
  assert.equal(failed.settled, true);
  assert.equal(failed.activeKey, null);

  // the server sometimes writes stage FAILED: then nothing but `started` is claimed
  const lost = networkState({ status: 'FAILED', stage: 'FAILED' });
  assert.deepEqual([...doneSet(lost)], ['started']);
  assert.equal(lost.terminal, 'FAILED');
  assert.equal(byKey(lost).complete, 'UNAVAILABLE');
  // an unknown stage on a live run claims nothing beyond the start either
  assert.deepEqual([...doneSet(networkState({ status: 'RUNNING', stage: 'SOME_NEW_STAGE' }))], ['started']);
  assert.equal(stageRank('SOME_NEW_STAGE'), null);
});

test('counters: only established, non-null, non-zero numbers are shown', () => {
  const none = networkState({
    status: 'RUNNING',
    stage: 'OFFICIAL_READY',
    liveCounters: {
      documentsReviewed: null,
      officialDecisions: null,
      marketComparables: null,
      sourcesCompleted: null,
      sourcesTotal: null,
      officialCases: null,
      marketState: null,
      synthesisState: null,
    },
  });
  assert.deepEqual(none.counters, []);

  const some = networkState({
    status: 'RUNNING',
    stage: 'MARKET_WAITING',
    liveCounters: { documentsReviewed: 12, officialDecisions: null, marketComparables: 7, officialCases: 3 },
  });
  assert.deepEqual(some.counters.map((c) => [c.key, c.value]), [['documents', 12], ['comparables', 7]]);
  for (const c of some.counters) assert.match(c.labelKey, /^verify_net_count_/);

  // strings, NaN, negatives and zero are not counts
  const junk = networkState({ liveCounters: { documentsReviewed: '12', officialDecisions: Number.NaN, marketComparables: -1 } });
  assert.deepEqual(junk.counters, []);
  assert.deepEqual(networkState({ liveCounters: { documentsReviewed: 0 } }).counters, []);
});

test('no percentage anywhere in the network output or its renderer', () => {
  const inputs = [
    {},
    { status: 'RUNNING', stage: 'MARKET_WAITING', liveCounters: { documentsReviewed: 4 } },
    { status: 'COMPLETE', stage: 'COMPLETE', reportReady: true },
    { status: 'FAILED', stage: 'OFFICIAL_READY' },
  ];
  for (const input of inputs) {
    const json = JSON.stringify(networkState(input));
    assert.ok(!/percent|pct|%/i.test(json), `a percentage leaked: ${json}`);
  }
  const mod = read('src/verify/researchNetwork.ts').replace(/\/\/.*$/gm, '');
  assert.ok(!/estimateProgress|percent/i.test(mod), 'the network module reads the estimate');
  const view = read('src/components/verify/ResearchNetwork.tsx');
  assert.ok(!/estimateProgress|aria-valuenow/.test(view), 'the network renders a progress value');
});

test('deterministic: the same input always yields the same picture (remount safety)', () => {
  const input = {
    status: 'RUNNING',
    stage: 'PUBLIC_RESEARCH_WAITING',
    sections: [{ id: 'OFFICIAL', maturity: 'PARTIAL' }],
    liveCounters: { documentsReviewed: 9, marketState: 'RUNNING' },
  };
  const a = networkState(input);
  const b = networkState(structuredClone(input));
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(networkState(input)), JSON.stringify(a));
});

test('stage order never moves a node backwards as the pipeline advances', () => {
  const order = [
    'QUEUED', 'IDENTITY_WAITING', 'BROWSER_READY', 'BROWSER_WAITING', 'OFFICIAL_READY',
    'OFFICIAL_COLLECTION_WAITING', 'ENREG_CHECK_PENDING', 'PUBLIC_RESEARCH_READY',
    'PUBLIC_RESEARCH_CHECK_PENDING', 'MARKET_READY', 'MARKET_WAITING',
    'RECONCILIATION_CHECK_PENDING', 'SYNTHESIS_READY', 'SYNTHESIS_WAITING', 'COMPLETE',
  ];
  let prev = new Set();
  for (const stage of order) {
    const done = doneSet(networkState({ status: 'RUNNING', stage }));
    for (const key of prev) assert.ok(done.has(key), `${key} un-done at ${stage}`);
    prev = done;
  }
});

test('a financial-entity detour after the market step never un-finishes passed nodes', () => {
  const before = networkState({ stage: 'RECONCILIATION_CHECK_PENDING', status: 'CREATED' });
  const detour = networkState({ stage: 'FINANCIAL_ENTITY_WAITING', status: 'RUNNING', liveCounters: { resumeStage: 'SYNTHESIS_READY' } });
  const doneBefore = before.nodes.filter((n) => n.state === 'DONE').map((n) => n.key);
  const doneDuring = detour.nodes.filter((n) => n.state === 'DONE').map((n) => n.key);
  for (const k of doneBefore) assert.ok(doneDuring.includes(k), `${k} went backwards during the detour`);
});
