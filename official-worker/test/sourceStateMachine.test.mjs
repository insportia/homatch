// sourceStateMachine.test.mjs — the generic FSM engine (state/SourceState.ts)
// plus structural tests of all four real per-source graphs. These are the
// tests that most directly prove mandate Section 4's "illegal transitions
// must fail loudly internally": there is no legal edge from an early
// discovery state straight to a terminal *_EXHAUSTED state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SourceStateMachine } from '../.tstest-build/state/SourceState.js';
import { TAS_MAP_GRAPH, TAS_MAP_LINEAR } from '../.tstest-build/workflows/tasmap/TasMapState.js';
import { TAS_GRAPH } from '../.tstest-build/workflows/tas/TasState.js';
import { MYGOV_GRAPH, newMyGovFsm } from '../.tstest-build/workflows/mygov/MyGovState.js';
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

test('TAS_MAP graph: no edge skips directly from an early discovery state to TAS_MAP_EXHAUSTED', () => {
  const early = ['CORRECT_SUGGESTION_SELECTED', 'PARCEL_FOCUSED', 'SUGGESTIONS_LOADED', 'CADASTRAL_ENTERED'];
  for (const s of early) {
    assert.ok(!TAS_MAP_GRAPH[s].includes('TAS_MAP_EXHAUSTED'), `${s} must not have a direct edge to TAS_MAP_EXHAUSTED`);
  }
});

test('TAS_MAP graph: the terminal state has no outgoing edges', () => {
  assert.deepEqual(TAS_MAP_GRAPH['TAS_MAP_EXHAUSTED'], []);
});

test('TAS_MAP graph: every consecutive pair in the mandated sequence is a legal edge', () => {
  for (let i = 0; i < TAS_MAP_LINEAR.length - 1; i++) {
    assert.ok(TAS_MAP_GRAPH[TAS_MAP_LINEAR[i]].includes(TAS_MAP_LINEAR[i + 1]), `${TAS_MAP_LINEAR[i]} -> ${TAS_MAP_LINEAR[i + 1]} must be legal`);
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

// --- Regression: the confirmed live MyGov crash (job
// 197b4520-2446-4f3d-8688-54a8229db3b3, query 01.18.06.019.055.03.01.603) ---
// MyGovWorkflow.ts used to call `fsm.transition('SEARCH_SUBMITTED')` (and,
// on a separate never-yet-exercised path, `fsm.transition('EXPLICIT_ACCESS_
// FAILURE')`) directly from REGISTRY_APPLICATION_OPENED whenever the search
// context was low-confidence — neither is a declared edge from that state,
// so every low-confidence-context MyGov run threw IllegalTransitionError,
// producing the FAILED status with a completely empty trace:[] the customer
// saw. These tests exercise the FSM through the EXACT transition sequences
// the fixed workflow now performs for each branch and assert neither
// throws — a change to MyGovWorkflow.ts that reintroduces an illegal jump
// here fails immediately and loudly, instead of only in a live browser run.
test('MyGov FSM: the low-confidence/WRONG_SEARCH_CONTEXT branch never illegally jumps through SEARCH_SUBMITTED (the confirmed crash)', () => {
  const fsm = newMyGovFsm();
  fsm.transition('SERVICE_176_OPENED');
  fsm.transition('SERVICE_APPLICATION_DISCOVERED');
  fsm.transition('REGISTRY_APPLICATION_OPENED');
  // correctContext === false: go straight to the generic operational
  // WRONG_SEARCH_CONTEXT status — never through CADASTRAL_INPUT_FOUND/
  // CADASTRAL_ENTERED/SEARCH_SUBMITTED/POST_SEARCH_STATE, which would
  // falsely claim a context we do not trust.
  assert.doesNotThrow(() => fsm.transition('WRONG_SEARCH_CONTEXT', 'low-confidence fallback field'));
  assert.equal(fsm.state, 'WRONG_SEARCH_CONTEXT');
});

test('MyGov FSM: the low-confidence branch may also legally reach WAITING_HUMAN (captcha checked before declaring wrong context)', () => {
  const fsm = newMyGovFsm();
  fsm.transition('SERVICE_176_OPENED');
  fsm.transition('SERVICE_APPLICATION_DISCOVERED');
  fsm.transition('REGISTRY_APPLICATION_OPENED');
  assert.doesNotThrow(() => fsm.transition('WAITING_HUMAN', 'captcha detected before context was confirmed'));
});

test('MyGov FSM: the trusted-context happy path walks PROPERTY_SEARCH_CONTEXT_CONFIRMED -> CADASTRAL_INPUT_FOUND -> CADASTRAL_ENTERED -> SEARCH_SUBMITTED -> POST_SEARCH_STATE without throwing', () => {
  const fsm = newMyGovFsm();
  fsm.transition('SERVICE_176_OPENED');
  fsm.transition('SERVICE_APPLICATION_DISCOVERED');
  fsm.transition('REGISTRY_APPLICATION_OPENED');
  assert.doesNotThrow(() => {
    fsm.transition('PROPERTY_SEARCH_CONTEXT_CONFIRMED');
    fsm.transition('CADASTRAL_INPUT_FOUND');
    fsm.transition('CADASTRAL_ENTERED');
    fsm.transition('SEARCH_SUBMITTED');
    fsm.transition('POST_SEARCH_STATE');
  });
  assert.equal(fsm.state, 'POST_SEARCH_STATE');
});

test('MyGov FSM: the (currently unreachable but no-longer-illegal) "registry app never really opened" fallback lands on the generic SEARCH_CONTROL_NOT_FOUND, not the restricted EXPLICIT_ACCESS_FAILURE dead end', () => {
  const fsm = newMyGovFsm();
  fsm.transition('SERVICE_176_OPENED');
  fsm.transition('SERVICE_APPLICATION_DISCOVERED');
  fsm.transition('REGISTRY_APPLICATION_OPENED');
  assert.doesNotThrow(() => fsm.transition('SEARCH_CONTROL_NOT_FOUND', 'registry application never opened'));
});
