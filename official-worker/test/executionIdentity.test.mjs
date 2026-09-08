import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  executionIdentity,
  resultExecutionIdentity,
  isTerminalExecutionStatus,
  normalizeEntityName,
  shouldSkipDuplicateExecution,
  dedupeProposedSteps,
} from '../.tstest-build/orchestrator/ResearchContext.js';
import { isCaptchaNetworkBlocked } from '../.tstest-build/browser/CaptchaBlock.js';

/*
 * DUPLICATE SOURCE EXECUTION — reproduced from the real production job
 * 3aa36828-471a-4cd0-8a46-4e3f2b4c4c92 (2026-09-08), whose ten recorded
 * browser executions were exactly:
 *
 *   1 TAS_MAP SEARCH_CONFIRMED
 *   2 tas     SEARCH_CONFIRMED
 *   3 mygov   SEARCH_CONTROL_NOT_FOUND
 *   4 enreg   SEARCH_CONFIRMED           404670272 "შპს მილენიო გრუპი"
 *   5 rstax   SKIPPED_HUMAN_VERIFICATION 404670272 "შპს მილენიო გრუპი"
 *   6 debtor  NO_RESULT_CONFIRMED        404670272 "შპს მილენიო გრუპი"
 *   7 enreg   SEARCH_CONFIRMED           405068386 "შპს მილენიო გრუპი"
 *   8 rstax   SKIPPED_HUMAN_VERIFICATION 405068386 "შპს მილენიო გრუპი"
 *   9 debtor  NO_RESULT_CONFIRMED        405068386 "შპს მილენიო გრუპი"
 *  10 enreg   START                      (no idCode) "Millennio Group"
 *
 * Row 10 is the defect: research-agent's guard compares the candidate name
 * against recorded execution names with a string compare, and the candidate
 * arrived in Latin script while every recorded execution carried the Georgian
 * name. It therefore started a THIRD enreg execution for a company enreg had
 * already resolved twice — and it never finished (still status START).
 *
 * Rows 5 and 8 are the customer-visible consequence of having no worker-side
 * guard at all: the SAME rs.ge CAPTCHA was raised twice in one Verify, so the
 * customer had to skip it twice.
 */

const PRODUCTION_RESULTS = [
  { source: 'TAS_MAP', status: 'SEARCH_CONFIRMED', forEntity: null },
  { source: 'tas', status: 'SEARCH_CONFIRMED', forEntity: null },
  { source: 'mygov', status: 'SEARCH_CONTROL_NOT_FOUND', forEntity: null },
  { source: 'enreg', status: 'SEARCH_CONFIRMED', forEntity: { idCode: '404670272', name: 'შპს მილენიო გრუპი' } },
  { source: 'rstax', status: 'SKIPPED_HUMAN_VERIFICATION', forEntity: { idCode: '404670272', name: 'შპს მილენიო გრუპი' } },
  { source: 'debtor', status: 'NO_RESULT_CONFIRMED', forEntity: { idCode: '404670272', name: 'შპს მილენიო გრუპი' } },
];

const step = (source, idCode, name) => ({ type: 'entity', source, idCode, name });

/* ------------------------------------------------------------------ *
 * Terminal semantics.                                                 *
 * ------------------------------------------------------------------ */

test('SKIPPED_HUMAN_VERIFICATION is TERMINAL — the mandate\'s explicit rule', () => {
  assert.equal(isTerminalExecutionStatus('SKIPPED_HUMAN_VERIFICATION'), true);
});

test('every mandated terminal status is terminal, and a pause is not', () => {
  for (const s of ['COMPLETED_EQUIVALENT_SEARCH_CONFIRMED'].slice(0, 0)) assert.ok(s);
  for (const s of ['SEARCH_CONFIRMED', 'NO_RESULT_CONFIRMED', 'SOURCE_EXHAUSTED', 'SOURCE_UNAVAILABLE', 'SOURCE_TECHNICAL_FAILURE', 'SEARCH_CONTROL_NOT_FOUND', 'BLOCKED', 'FAILED']) {
    assert.equal(isTerminalExecutionStatus(s), true, `${s} must be terminal`);
  }
  // A paused execution is NOT terminal — it is about to be resumed or skipped.
  assert.equal(isTerminalExecutionStatus('WAITING_HUMAN'), false);
  // Row 10's status: an execution that never finished must not look done.
  assert.equal(isTerminalExecutionStatus('START'), false);
  assert.equal(isTerminalExecutionStatus(undefined), false);
  assert.equal(isTerminalExecutionStatus(null), false);
});

/* ------------------------------------------------------------------ *
 * Execution identity.                                                 *
 * ------------------------------------------------------------------ */

test('identity is stable between a step and the result it produces', () => {
  const s = step('rstax', '404670272', 'შპს მილენიო გრუპი');
  assert.equal(
    executionIdentity(s),
    resultExecutionIdentity({ source: 'rstax', forEntity: { idCode: '404670272', name: 'შპს მილენიო გრუპი' } })
  );
});

test('the registry id, not the name, identifies an identified entity', () => {
  // Same company id reached under two different spellings is ONE identity.
  assert.equal(
    executionIdentity(step('enreg', '404670272', 'შპს მილენიო გრუპი')),
    executionIdentity(step('enreg', '404670272', 'Millennio Group'))
  );
  // Two different registry ids are genuinely different identities and are
  // both legitimately researched (rows 4-6 and 7-9 are NOT the same company).
  assert.notEqual(
    executionIdentity(step('enreg', '404670272', 'x')),
    executionIdentity(step('enreg', '405068386', 'x'))
  );
});

test('a source step and an entity step of the same source never collide', () => {
  assert.notEqual(executionIdentity({ type: 'source', key: 'enreg' }), executionIdentity(step('enreg', '404670272', 'x')));
});

test('name normalization strips legal form, quotes, case and spacing', () => {
  assert.equal(normalizeEntityName('შპს "მილენიო გრუპი"'), normalizeEntityName('მილენიო   გრუპი'));
  assert.equal(normalizeEntityName('Millennio Group LLC'), normalizeEntityName('  millennio   group  '));
  assert.equal(normalizeEntityName(null), '');
});

/* ------------------------------------------------------------------ *
 * THE PRODUCTION SCENARIO.                                            *
 * ------------------------------------------------------------------ */

test('PRODUCTION ROW 5/8: a skipped source is never scheduled again for the same entity', () => {
  const d = shouldSkipDuplicateExecution(step('rstax', '404670272', 'შპს მილენიო გრუპი'), PRODUCTION_RESULTS);
  assert.equal(d.skip, true);
  assert.equal(d.reason, 'already_terminal_for_this_identity');
});

test('PRODUCTION ROW 10: a name-only enreg is refused once an identified enreg already ran', () => {
  // The exact candidate research-agent produced: Latin name, no idCode.
  const d = shouldSkipDuplicateExecution(step('enreg', null, 'Millennio Group'), PRODUCTION_RESULTS);
  assert.equal(d.skip, true, 'the third enreg execution must never be scheduled');
  assert.equal(d.reason, 'subsumed_by_identified_entity_execution');
});

test('the row 10 rule is script-independent — it needs no transliteration guess', () => {
  for (const name of ['Millennio Group', 'მილენიო გრუპი', 'MILENIO GROUP', 'Millenio  Group']) {
    assert.equal(shouldSkipDuplicateExecution(step('enreg', null, name), PRODUCTION_RESULTS).skip, true, name);
  }
});

test('a genuinely new company is still researched — dedupe must not block real work', () => {
  const d = shouldSkipDuplicateExecution(step('enreg', '405068386', 'სხვა კომპანია'), PRODUCTION_RESULTS);
  assert.equal(d.skip, false);
  assert.equal(d.reason, 'not_a_duplicate');
});

test('a name-only lookup IS allowed when that source has no identified execution yet', () => {
  // Only TAS/mygov have run — enreg has never run for any entity.
  const early = PRODUCTION_RESULTS.slice(0, 3);
  assert.equal(shouldSkipDuplicateExecution(step('enreg', null, 'Millennio Group'), early).skip, false);
});

test('a still-running or paused execution does NOT block a retry', () => {
  const paused = [{ source: 'rstax', status: 'WAITING_HUMAN', forEntity: { idCode: '404670272', name: 'x' } }];
  assert.equal(shouldSkipDuplicateExecution(step('rstax', '404670272', 'x'), paused).skip, false);
});

test('a technically failed source is terminal — it is not retried inside the same job', () => {
  const failed = [{ source: 'mygov', status: 'SEARCH_CONTROL_NOT_FOUND', forEntity: null }];
  assert.equal(shouldSkipDuplicateExecution({ type: 'source', key: 'mygov' }, failed).skip, true);
});

/* ------------------------------------------------------------------ *
 * Concurrency / batch scheduling.                                     *
 * ------------------------------------------------------------------ */

test('one append can never enqueue the same identity twice', () => {
  const proposed = [
    step('enreg', '404670272', 'a'),
    step('enreg', '404670272', 'a'), // duplicate within the same batch
    step('rstax', '404670272', 'a'),
  ];
  const out = dedupeProposedSteps(proposed, []);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map(executionIdentity), ['entity:enreg:id:404670272', 'entity:rstax:id:404670272']);
});

test('a proposed step already present in the plan is not enqueued a second time', () => {
  const planned = [step('rstax', '404670272', 'a')];
  const out = dedupeProposedSteps([step('rstax', '404670272', 'a')], [], planned);
  assert.equal(out.length, 0);
});

test('the whole production entity batch collapses to nothing once it has run', () => {
  const proposed = ['enreg', 'rstax', 'debtor'].map((s) => step(s, '404670272', 'შპს მილენიო გრუპი'));
  assert.deepEqual(dedupeProposedSteps(proposed, PRODUCTION_RESULTS), []);
});

/* ------------------------------------------------------------------ *
 * Wiring — the guard is actually on the execution path.               *
 * ------------------------------------------------------------------ */

const here = fileURLToPath(new URL('.', import.meta.url));
const orchestrator = readFileSync(`${here}../src/orchestrator/ResearchOrchestrator.ts`, 'utf8');
const indexSource = readFileSync(`${here}../src/index.ts`, 'utf8');

test('the run loop refuses a duplicate before spending a browser page on it', () => {
  const run = orchestrator.slice(orchestrator.indexOf('private async run('));
  assert.match(run, /shouldSkipDuplicateExecution\(step, job\.results\)/);
  assert.match(run, /duplicate_execution_skipped/);
  // Dropped, never recorded as a finding: "already done" says nothing about
  // the property.
  const guard = run.slice(run.indexOf('const duplicate ='), run.indexOf('const { result, keep }'));
  assert.equal(/resultConfirmed|noResultConfirmed|propertyRisk|verdict/.test(guard), false);
});

test('entity steps are deduped at append time as well as at execution time', () => {
  assert.match(orchestrator, /dedupeProposedSteps\(\s*buildEntitySteps\(candidates, MAX_AUTO_ENREG_ENTITIES\),\s*job\.results,\s*job\.steps\s*\)/);
});

/* ------------------------------------------------------------------ *
 * DUPLICATE SKIP — idempotency.                                       *
 * ------------------------------------------------------------------ */

test('skip and resume are idempotent at the HTTP layer, and a real precondition stays a 409', () => {
  assert.match(indexSource, /function humanActionResponse\(/);
  const h = indexSource.slice(indexSource.indexOf('function humanActionResponse('), indexSource.indexOf("app.post('/research/:id/resume'"));
  assert.match(h, /NOT_FOUND.*404|res\.status\(404\)/s, 'a missing job is still 404');
  assert.match(h, /NOT_READY/, 'an unsolved challenge is still an error');
  assert.match(h, /alreadyResolved/, 'a repeat must report the resulting state');
  // Neither endpoint may answer a duplicate with a hard error any more.
  const skip = indexSource.slice(indexSource.indexOf("app.post('/research/:id/skip'"));
  assert.equal(/res\.status\(404\)/.test(skip.slice(0, 400)), false, 'a duplicate skip must not 404');
});

test('the orchestrator reports ALREADY_RESOLVED instead of failing a repeat action', () => {
  for (const fn of ['async resume(', 'async skip(']) {
    const body = orchestrator.slice(orchestrator.indexOf(fn), orchestrator.indexOf(fn) + 2200);
    assert.match(body, /ALREADY_RESOLVED/, `${fn} must be idempotent`);
    assert.match(body, /if \(!job\) return \{ ok: false[^}]*NOT_FOUND/, `${fn} must still 404 an unknown job`);
  }
});

/* ------------------------------------------------------------------ *
 * CAPTCHA network block.                                              *
 * ------------------------------------------------------------------ */

test('server-side CAPTCHA rejections are recognized', () => {
  for (const text of [
    'Our systems have detected unusual traffic from your computer network.',
    'Sorry, we can\'t process your request right now. Please try again later.',
    'Your computer or network may be sending automated queries.',
    'Too many requests',
    'ავტომატური მოთხოვნები',
  ]) {
    assert.equal(isCaptchaNetworkBlocked(text), true, text);
  }
});

test('an ordinary solvable challenge is NOT treated as a block', () => {
  for (const text of ['I am not a robot', 'Select all images with traffic lights', 'მე არ ვარ რობოტი', '']) {
    assert.equal(isCaptchaNetworkBlocked(text), false, JSON.stringify(text));
  }
});

test('a blocked CAPTCHA is recorded but the human still gets the SAME live page', () => {
  /*
   * The extension is non-negotiable: every Verify Chromium job loads Buster,
   * and a challenge must reach the human on the same page in the same context
   * so the yellow assist control is available. A network-block observation is
   * therefore logged for visibility, never used to end the source.
   */
  const run = orchestrator.slice(orchestrator.indexOf('private async run('));
  const block = run.slice(run.indexOf('captchaNetworkBlocked(blockedSession.page)'), run.indexOf("job.status = 'WAITING_HUMAN';"));
  assert.match(block, /captcha_network_blocked/, 'the block must be observable in production logs');
  assert.equal(/SOURCE_UNAVAILABLE|continue;|return;/.test(block), false, 'a block must not end or divert the source');
  /*
   * The rejected mechanism was routing Verify through the DEVELOPER'S own
   * browser (WAITING_HUMAN_LOCAL / LOCAL_BROWSER / the homatch-verify-helper
   * extension), which made a developer's PC, phone and internet part of
   * production. That must never come back, so it is still forbidden by name.
   *
   * This is deliberately narrower than the bare word "handoff", which it used
   * to match. The CUSTOMER-side handoff added in 2026-09 is a different thing
   * entirely: the customer opens the same public lookup in their own browser
   * when the source has refused our datacenter outright. The worker's only
   * part in it is the informational `networkBlocked` flag below — it starts
   * nothing, diverts nothing, and the assertions that follow are what
   * actually pin that down.
   */
  assert.equal(
    /WAITING_HUMAN_LOCAL|LOCAL_BROWSER|localVerification|homatch-verify-helper/i.test(run),
    false,
    'the developer-browser handoff must never return to the production line'
  );
  // The job still parks in the SAME session for the human + extension, and
  // the block observation is informational only.
  assert.match(run, /job\.status = 'WAITING_HUMAN';/);
  assert.match(block, /networkBlocked = true/, 'the refusal must be recorded');
  assert.equal(
    /this\.sessions\.delete|closeSession|releaseHuman/.test(block),
    false,
    'observing a refusal must not tear down the live session'
  );
});

test('the block predicate itself is still available and correct', () => {
  assert.equal(isCaptchaNetworkBlocked('Your computer or network may be sending automated queries'), true);
  assert.equal(isCaptchaNetworkBlocked('I am not a robot'), false);
});
