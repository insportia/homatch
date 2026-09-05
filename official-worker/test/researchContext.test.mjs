// researchContext.test.mjs — orchestrator/ResearchContext.ts's pure step
// bookkeeping, ported from the pre-refactor lib/steps.js's test suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialSteps, stepMatchesResult, primaryStepsRemain, buildEntitySteps } from '../.tstest-build/orchestrator/ResearchContext.js';

test('buildInitialSteps: cadastral mode is tas/msmap/mygov', () => {
  assert.deepEqual(
    buildInitialSteps({ mode: 'cadastral' }).map((s) => s.key),
    ['tas', 'msmap', 'mygov']
  );
});
test('buildInitialSteps: property mode is enreg/msmap/napr', () => {
  assert.deepEqual(
    buildInitialSteps({ mode: 'property' }).map((s) => s.key),
    ['enreg', 'msmap', 'napr']
  );
});

test('stepMatchesResult: a primary source step matches only a non-entity result with the same key', () => {
  const step = { type: 'source', key: 'enreg' };
  assert.ok(stepMatchesResult(step, { source: 'enreg', forEntity: null }));
  assert.ok(!stepMatchesResult(step, { source: 'enreg', forEntity: { idCode: '123' } }));
  assert.ok(!stepMatchesResult(step, { source: 'tas', forEntity: null }));
});

test('stepMatchesResult: an entity-triggered step matches only the SAME entity\'s enreg result, not the primary one', () => {
  const step = { type: 'entity_enreg', idCode: '405123456', name: 'შპს Example' };
  assert.ok(stepMatchesResult(step, { source: 'enreg', forEntity: { idCode: '405123456' } }));
  assert.ok(!stepMatchesResult(step, { source: 'enreg', forEntity: { idCode: '999999999' } }));
  assert.ok(!stepMatchesResult(step, { source: 'enreg', forEntity: null }));
});

test('primaryStepsRemain: true while a source-type step is still pending, false once all consumed', () => {
  const steps = [{ type: 'source', key: 'tas' }, { type: 'source', key: 'msmap' }, { type: 'entity_enreg', idCode: '1', name: 'x' }];
  assert.ok(primaryStepsRemain(steps, 1));
  assert.ok(!primaryStepsRemain(steps, 2));
});

test('buildEntitySteps: bounded by maxEntities, only confirmed (id-code) entities, name-only never queued', () => {
  const entities = [
    { identificationCode: '1', name: 'A' },
    { identificationCode: null, name: 'B (incomplete)' },
    { identificationCode: '2', name: 'C' },
    { identificationCode: '3', name: 'D' },
  ];
  const steps = buildEntitySteps(entities, 2);
  assert.equal(steps.length, 2);
  assert.deepEqual(steps.map((s) => s.idCode), ['1', '2']);
  assert.ok(steps.every((s) => s.type === 'entity_enreg'));
});
