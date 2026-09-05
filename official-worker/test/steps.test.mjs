import assert from 'node:assert/strict';
import { buildInitialSteps, stepMatchesResult, primaryStepsRemain, buildEntitySteps } from '../src/lib/steps.js';

let n = 0;
function t(name, fn) { n++; fn(); console.log(`ok - ${name}`); }

t('buildInitialSteps: cadastral mode gets tas/msmap/mygov as source steps', () => {
  const steps = buildInitialSteps({ mode: 'cadastral' });
  assert.deepEqual(steps, [{ type: 'source', key: 'tas' }, { type: 'source', key: 'msmap' }, { type: 'source', key: 'mygov' }]);
});

t('buildInitialSteps: property mode gets enreg/msmap/napr as source steps', () => {
  const steps = buildInitialSteps({ mode: 'property' });
  assert.deepEqual(steps.map(s => s.key), ['enreg', 'msmap', 'napr']);
});

t('stepMatchesResult: a primary source step matches only its own non-entity result', () => {
  const step = { type: 'source', key: 'tas' };
  assert.equal(stepMatchesResult(step, { source: 'tas', forEntity: null }), true);
  assert.equal(stepMatchesResult(step, { source: 'msmap', forEntity: null }), false);
});

t('stepMatchesResult: a primary source step never matches an entity-triggered result on the same source key (property mode enreg vs entity_enreg both use source=\'enreg\')', () => {
  const primaryEnregStep = { type: 'source', key: 'enreg' };
  const entityResult = { source: 'enreg', forEntity: { idCode: '123456789', name: 'შპს X' } };
  assert.equal(stepMatchesResult(primaryEnregStep, entityResult), false);
});

t('stepMatchesResult: an entity_enreg step matches only the result for its exact idCode, not a different discovered entity sharing the source', () => {
  const stepA = { type: 'entity_enreg', idCode: '111111111', name: 'შპს A' };
  const resultA = { source: 'enreg', forEntity: { idCode: '111111111', name: 'შპს A' } };
  const resultB = { source: 'enreg', forEntity: { idCode: '222222222', name: 'შპს B' } };
  assert.equal(stepMatchesResult(stepA, resultA), true);
  assert.equal(stepMatchesResult(stepA, resultB), false);
});

t('stepMatchesResult: null/undefined step never matches anything (safe default, never accidentally clobbers results)', () => {
  assert.equal(stepMatchesResult(null, { source: 'tas' }), false);
  assert.equal(stepMatchesResult(undefined, { source: 'tas' }), false);
});

t('primaryStepsRemain: true while a source-type step is still ahead', () => {
  const steps = [{ type: 'source', key: 'tas' }, { type: 'source', key: 'msmap' }, { type: 'source', key: 'mygov' }];
  assert.equal(primaryStepsRemain(steps, 1), true); // msmap, mygov still ahead
});

t('primaryStepsRemain: false once only entity_enreg steps are left (the transition point for appending)', () => {
  const steps = [{ type: 'source', key: 'tas' }, { type: 'source', key: 'msmap' }, { type: 'source', key: 'mygov' }, { type: 'entity_enreg', idCode: '1', name: 'X' }];
  assert.equal(primaryStepsRemain(steps, 3), false); // only the already-appended entity step remains at/after index 3
  assert.equal(primaryStepsRemain(steps, 2), true); // mygov (a source step) is still at index 2
});

t('buildEntitySteps: converts confirmed ledger entities into entity_enreg steps, capped', () => {
  const confirmed = [
    { idCode: '111111111', name: 'შპს A' },
    { idCode: '222222222', name: 'შპს B' },
    { idCode: '333333333', name: 'შპს C' },
    { idCode: '444444444', name: 'შპს D' },
  ];
  const steps = buildEntitySteps(confirmed, 3);
  assert.equal(steps.length, 3); // capped at MAX_AUTO_ENREG_ENTITIES-equivalent
  assert.deepEqual(steps[0], { type: 'entity_enreg', idCode: '111111111', name: 'შპს A' });
  assert.deepEqual(steps.map(s => s.idCode), ['111111111', '222222222', '333333333']);
});

t('buildEntitySteps: empty confirmed list yields no steps (no entities discovered -> no auto-ENREG)', () => {
  assert.deepEqual(buildEntitySteps([], 3), []);
});

t('end-to-end simulation: full step-graph lifecycle without a browser (pure state machine)', () => {
  // Simulates what run() does, using only these pure helpers, to prove the
  // whole graph transition (primary sources -> entity discovery -> ENREG
  // follow-up steps -> completion) is coherent without needing Playwright.
  const job = { mode: 'cadastral' };
  job.steps = buildInitialSteps(job);
  const results = [];
  const fakeLedgerConfirmed = [{ idCode: '999999999', name: 'შპს Test Entity' }];
  let entityStepsAppended = false;
  for (let i = 0; i < job.steps.length; i++) {
    const step = job.steps[i];
    const r = { source: step.type === 'entity_enreg' ? 'enreg' : step.key, forEntity: step.type === 'entity_enreg' ? { idCode: step.idCode, name: step.name } : null };
    results.splice(0, results.length, ...results.filter(x => !stepMatchesResult(step, x)), r);
    if (!primaryStepsRemain(job.steps, i + 1) && !entityStepsAppended) {
      entityStepsAppended = true;
      job.steps.push(...buildEntitySteps(fakeLedgerConfirmed, 3));
    }
  }
  assert.equal(job.steps.length, 4); // tas, msmap, mygov, + 1 entity_enreg
  assert.equal(results.length, 4);
  assert.equal(results[3].forEntity.idCode, '999999999');
});

console.log(`\n${n} passed`);
