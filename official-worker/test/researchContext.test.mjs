// researchContext.test.mjs — orchestrator/ResearchContext.ts's pure step
// bookkeeping, ported from the pre-refactor lib/steps.js's test suite.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildInitialSteps, stepMatchesResult, primaryStepsRemain, buildEntitySteps } from '../.tstest-build/orchestrator/ResearchContext.js';

// Order per the 2026-09-06 "Fix Homatch Verify by implementing this exact
// pipeline in code" mandate: TAS Map -> TAS Document -> NAPR Property.
test('buildInitialSteps: cadastral mode is msmap/tas/mygov (TAS Map -> TAS Document -> NAPR Property)', () => {
  assert.deepEqual(
    buildInitialSteps({ mode: 'cadastral' }).map((s) => s.key),
    ['msmap', 'tas', 'mygov']
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
  const step = { type: 'entity', source: 'enreg', idCode: '405123456', name: 'შპს Example' };
  assert.ok(stepMatchesResult(step, { source: 'enreg', forEntity: { idCode: '405123456' } }));
  assert.ok(!stepMatchesResult(step, { source: 'enreg', forEntity: { idCode: '999999999' } }));
  assert.ok(!stepMatchesResult(step, { source: 'enreg', forEntity: null }));
});

// 2026-09-06, "FINANCIAL SOURCE EXPANSION" mandate: the same generalized
// entity-step shape now also serves rstax/debtor — a match must require the
// SOURCE to line up too, not just the idCode, since research-agent can
// trigger an enreg, rstax, AND debtor lookup for the exact same company
// idCode in the same job, and each must only ever consume its OWN result.
test('stepMatchesResult: entity steps for different sources (rstax vs debtor) on the SAME idCode never cross-match', () => {
  const rstaxStep = { type: 'entity', source: 'rstax', idCode: '404670272', name: 'შპს Example' };
  const debtorStep = { type: 'entity', source: 'debtor', idCode: '404670272', name: 'შპს Example' };
  assert.ok(stepMatchesResult(rstaxStep, { source: 'rstax', forEntity: { idCode: '404670272' } }));
  assert.ok(!stepMatchesResult(rstaxStep, { source: 'debtor', forEntity: { idCode: '404670272' } }));
  assert.ok(stepMatchesResult(debtorStep, { source: 'debtor', forEntity: { idCode: '404670272' } }));
  assert.ok(!stepMatchesResult(debtorStep, { source: 'rstax', forEntity: { idCode: '404670272' } }));
});

test('primaryStepsRemain: true while a source-type step is still pending, false once all consumed', () => {
  const steps = [{ type: 'source', key: 'tas' }, { type: 'source', key: 'msmap' }, { type: 'entity', source: 'enreg', idCode: '1', name: 'x' }];
  assert.ok(primaryStepsRemain(steps, 1));
  assert.ok(!primaryStepsRemain(steps, 2));
});

// 2026-09-06, "Fix Homatch Verify by implementing this exact pipeline in
// code" mandate: buildEntitySteps now chains EnregWorker -> RsTaxpayerWorker
// -> DebtorWorker (in that order) for each bounded entity, not enreg alone.
test('buildEntitySteps: bounded by maxEntities (companies, not steps), only confirmed (id-code) entities, name-only never queued', () => {
  const entities = [
    { identificationCode: '1', name: 'A' },
    { identificationCode: null, name: 'B (incomplete)' },
    { identificationCode: '2', name: 'C' },
    { identificationCode: '3', name: 'D' },
  ];
  const steps = buildEntitySteps(entities, 2);
  // 2 companies * 3 sources (enreg/rstax/debtor) each = 6 steps.
  assert.equal(steps.length, 6);
  assert.ok(steps.every((s) => s.type === 'entity'));
});

test('buildEntitySteps: emits enreg -> rstax -> debtor in that exact order, for the SAME idCode/name, per entity', () => {
  const steps = buildEntitySteps([{ identificationCode: '405123456', name: 'შპს Example' }], 3);
  assert.deepEqual(
    steps.map((s) => s.source),
    ['enreg', 'rstax', 'debtor']
  );
  assert.ok(steps.every((s) => s.idCode === '405123456' && s.name === 'შპს Example'));
});

test('buildEntitySteps: multiple entities each get their own full enreg->rstax->debtor triple, in entity order', () => {
  const steps = buildEntitySteps(
    [
      { identificationCode: '1', name: 'A' },
      { identificationCode: '2', name: 'B' },
    ],
    5
  );
  assert.deepEqual(
    steps.map((s) => `${s.idCode}:${s.source}`),
    ['1:enreg', '1:rstax', '1:debtor', '2:enreg', '2:rstax', '2:debtor']
  );
});
