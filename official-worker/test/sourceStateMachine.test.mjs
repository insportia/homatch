// sourceStateMachine.test.mjs — the generic FSM engine (state/SourceState.ts)
// plus structural tests of all four real per-source graphs. These are the
// tests that most directly prove mandate Section 4's "illegal transitions
// must fail loudly internally": there is no legal edge from an early
// discovery state straight to a terminal *_EXHAUSTED state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SourceStateMachine } from '../.tstest-build/state/SourceState.js';
import { MSMAP_GRAPH, MSMAP_LINEAR } from '../.tstest-build/workflows/msmap/MsMapState.js';
import { TAS_GRAPH } from '../.tstest-build/workflows/tas/TasState.js';
import { MYGOV_GRAPH } from '../.tstest-build/workflows/mygov/MyGovState.js';
import { ENREG_GRAPH, ENREG_LINEAR } from '../.tstest-build/workflows/enreg/EnregState.js';

test('SourceStateMachine: a declared transition succeeds and is recorded', () => {
  const fsm = new SourceStateMachine('test', { A: ['B'], B: ['C'], C: [] }, 'A');
  fsm.transition('B');
  fsm.transition('C');
  assert.equal(fsm.state, 'C');
  assert.equal(fsm.trace.length, 2);
  assert.ok(fsm.reached('A'));
  assert.ok(fsm.reached('B'));
});

test('SourceStateMachine: an undeclared transition throws IllegalTransitionError, not a silent state change', () => {
  const fsm = new SourceStateMachine('test', { A: ['B'], B: ['C'], C: [] }, 'A');
  assert.throws(() => fsm.transition('C'), /illegal state transition: A -> C/);
  assert.equal(fsm.state, 'A'); // unchanged — the illegal call never mutated state
});

test('MSMAP graph: no edge skips directly from an early discovery state to MSMAP_EXHAUSTED', () => {
  const early = ['CORRECT_SUGGESTION_SELECTED', 'PARCEL_FOCUSED', 'SUGGESTIONS_LOADED', 'CADASTRAL_ENTERED'];
  for (const s of early) {
    assert.ok(!MSMAP_GRAPH[s].includes('MSMAP_EXHAUSTED'), `${s} must not have a direct edge to MSMAP_EXHAUSTED`);
  }
});

test('MSMAP graph: the terminal state has no outgoing edges', () => {
  assert.deepEqual(MSMAP_GRAPH['MSMAP_EXHAUSTED'], []);
});

test('MSMAP graph: every consecutive pair in the mandated sequence is a legal edge', () => {
  for (let i = 0; i < MSMAP_LINEAR.length - 1; i++) {
    assert.ok(MSMAP_GRAPH[MSMAP_LINEAR[i]].includes(MSMAP_LINEAR[i + 1]), `${MSMAP_LINEAR[i]} -> ${MSMAP_LINEAR[i + 1]} must be legal`);
  }
});

test('TAS graph: CHILDREN_ENUMERATED cannot jump straight to TAS_EXHAUSTED', () => {
  assert.ok(!TAS_GRAPH['CHILDREN_ENUMERATED'].includes('TAS_EXHAUSTED'));
});

test('TAS graph: NEXT_CHILD can loop back to CHILD_DOCUMENT_OPENED (more children) or proceed to RESULT_EXHAUSTED (none left)', () => {
  assert.ok(TAS_GRAPH['NEXT_CHILD'].includes('CHILD_DOCUMENT_OPENED'));
  assert.ok(TAS_GRAPH['NEXT_CHILD'].includes('RESULT_EXHAUSTED'));
});

test('TAS graph: NEXT_RESULT can loop back to RESULT_OPENED (more results) or proceed to ALL_RESULTS_EXHAUSTED', () => {
  assert.ok(TAS_GRAPH['NEXT_RESULT'].includes('RESULT_OPENED'));
  assert.ok(TAS_GRAPH['NEXT_RESULT'].includes('ALL_RESULTS_EXHAUSTED'));
});

test('TAS graph: only ALL_RESULTS_EXHAUSTED may reach TAS_EXHAUSTED', () => {
  const reachers = Object.keys(TAS_GRAPH).filter((s) => TAS_GRAPH[s].includes('TAS_EXHAUSTED'));
  assert.deepEqual(reachers, ['ALL_RESULTS_EXHAUSTED']);
});

test('MyGov graph: WRONG_SEARCH_CONTEXT-equivalent (EXPLICIT_ACCESS_FAILURE) is a dead end, never leads to MYGOV_EXHAUSTED', () => {
  assert.deepEqual(MYGOV_GRAPH['EXPLICIT_ACCESS_FAILURE'], []);
});

test('MyGov graph: CONFIRMED_ZERO_RESULTS is the only bare state besides RESULTS_TRAVERSED that reaches MYGOV_EXHAUSTED', () => {
  const reachers = Object.keys(MYGOV_GRAPH).filter((s) => MYGOV_GRAPH[s].includes('MYGOV_EXHAUSTED')).sort();
  assert.deepEqual(reachers, ['CONFIRMED_ZERO_RESULTS', 'RESULTS_TRAVERSED']);
});

test('MyGov graph: USER_SKIPPED leads only to MYGOV_SKIPPED_HUMAN_VERIFICATION, never back into the search branch', () => {
  assert.deepEqual(MYGOV_GRAPH['USER_SKIPPED'], ['MYGOV_SKIPPED_HUMAN_VERIFICATION']);
});

test('ENREG graph: the 25-state sequence is fully linear and in the mandated order', () => {
  for (let i = 0; i < ENREG_LINEAR.length - 1; i++) {
    assert.ok(ENREG_GRAPH[ENREG_LINEAR[i]].includes(ENREG_LINEAR[i + 1]));
  }
  assert.deepEqual(ENREG_GRAPH['ENREG_EXHAUSTED'], []);
});

test('ENREG graph: RESULTS_RETURNED can fall through to NO_RESULT_CONFIRMED (a real negative) as well as forward progress', () => {
  assert.ok(ENREG_GRAPH['RESULTS_RETURNED'].includes('NO_RESULT_CONFIRMED'));
  assert.ok(ENREG_GRAPH['RESULTS_RETURNED'].includes('CORRECT_ENTITY_MATCHED'));
});
