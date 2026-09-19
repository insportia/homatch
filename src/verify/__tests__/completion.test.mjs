// THE FEW SECONDS WHERE IT SAID "COMPLETE" AND WAS NOT.
//
// Observed on a real production run with a real cadastral case: the customer
// was told the verification had completed, and then watched it carry on
// finishing for several seconds.
//
// The cause was two answers to one question. research_jobs.status reaching
// COMPLETE means the PIPELINE finished; the report the customer reads is a
// separate fetch the page makes afterwards, and that round trip is a second
// or three — longer when the edge function is cold. The global job indicator
// watched the background job's terminal state and announced completion inside
// that window, knowing nothing about the screen.
//
// So this walks the exact transition sequence, one simulated state at a time,
// and asserts what the customer is allowed to be told at each one. No timers,
// no sleeps: the fix is a state contract, and a contract can be read.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyCustomerState, isVerifyCustomerComplete } from '../completion.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** A job mid-research: evidence accumulating, nothing final. */
const researching = (over = {}) => ({
  jobStatus: 'RUNNING', stage: 'MARKET', hasReport: false,
  synthesis: null, synthesisLoading: false, synthesisSettled: false, ...over,
});

/** The synthesised customer report, once it exists. */
const REPORT = { summary: 'x', sections: [] };

/**
 * The real sequence, as the page goes through it. Each entry is what the
 * page knows at that instant — nothing is invented and nothing is skipped.
 */
const SEQUENCE = [
  ['nothing yet', researching({ jobStatus: null, stage: null }), 'IDLE'],
  ['research running', researching(), 'RESEARCHING'],
  ['evidence in, still running', researching({ hasReport: true }), 'RESEARCHING'],
  ['synthesis stage', researching({ hasReport: true, stage: 'SYNTHESIS' }), 'FINALIZING'],
  // THE WINDOW. The pipeline says COMPLETE; the customer's report has not
  // been fetched yet. This is the instant the toast used to fire.
  ['pipeline complete, fetch not started', researching({ jobStatus: 'COMPLETE', stage: 'COMPLETE', hasReport: true }), 'FINALIZING'],
  ['pipeline complete, fetch in flight', researching({ jobStatus: 'COMPLETE', stage: 'COMPLETE', hasReport: true, synthesisLoading: true }), 'FINALIZING'],
  // Only now.
  ['report settled and present', researching({ jobStatus: 'COMPLETE', stage: 'COMPLETE', hasReport: true, synthesis: REPORT, synthesisSettled: true }), 'COMPLETE'],
];

test('EARLY_COMPLETE_VISIBLE = NO: nothing is COMPLETE until the report has settled', () => {
  const seen = [];
  for (const [label, input, expected] of SEQUENCE) {
    const got = verifyCustomerState(input);
    seen.push(got);
    assert.equal(got, expected, `${label}: expected ${expected}, got ${got}`);
  }
  // COMPLETE appears exactly once, and only at the very end.
  assert.equal(seen.filter((s) => s === 'COMPLETE').length, 1);
  assert.equal(seen[seen.length - 1], 'COMPLETE');
  assert.ok(!seen.slice(0, -1).includes('COMPLETE'), 'COMPLETE was reached before the end');
});

test('SYNTHESIS_STATE_VISIBLE = YES: the wait has a name, not a blank', () => {
  // Every instant between "research done" and "report readable" must be a
  // state the interface can describe calmly. A gap here is what a spinner
  // with no explanation is made of.
  const window = SEQUENCE.slice(3, 6).map(([, input]) => verifyCustomerState(input));
  assert.deepEqual(window, ['FINALIZING', 'FINALIZING', 'FINALIZING']);
});

test('FINAL_REPORT_READY_BEFORE_COMPLETE = YES', () => {
  // The implication, stated directly: COMPLETE cannot be true while the
  // report is absent or still being fetched.
  const cases = [
    { synthesis: null, synthesisSettled: false, synthesisLoading: false },
    { synthesis: null, synthesisSettled: false, synthesisLoading: true },
    { synthesis: REPORT, synthesisSettled: false, synthesisLoading: true },
  ];
  for (const c of cases) {
    const input = { jobStatus: 'COMPLETE', stage: 'COMPLETE', hasReport: true, ...c };
    assert.equal(isVerifyCustomerComplete(input), false, JSON.stringify(c));
  }
  assert.equal(
    isVerifyCustomerComplete({ jobStatus: 'COMPLETE', stage: 'COMPLETE', hasReport: true, synthesis: REPORT, synthesisLoading: false, synthesisSettled: true }),
    true,
  );
});

test('POST_COMPLETE_MATERIAL_MUTATION = NO: once COMPLETE, nothing left can change it', () => {
  // The state is a pure function of what has settled. Re-evaluating it with
  // the same settled inputs cannot move off COMPLETE, and no later poll of a
  // finished job carries anything that would.
  const final = { jobStatus: 'COMPLETE', stage: 'COMPLETE', hasReport: true, synthesis: REPORT, synthesisLoading: false, synthesisSettled: true };
  assert.equal(verifyCustomerState(final), 'COMPLETE');
  assert.equal(verifyCustomerState({ ...final }), 'COMPLETE');
  // A late duplicate status poll — the same row read again — changes nothing.
  assert.equal(verifyCustomerState({ ...final, stage: 'COMPLETE' }), 'COMPLETE');
});

test('a synthesis that will never arrive still ends the run', () => {
  /*
   * The other half of the contract. If the report cannot be produced, the
   * fetch settles having failed, and the page falls back to the evidence
   * view — which is a real result, just not the synthesised one. Without
   * `synthesisSettled` a degraded run would finalise for ever, which is a
   * worse lie than finishing early.
   */
  const failed = { jobStatus: 'COMPLETE', stage: 'COMPLETE', hasReport: true, synthesis: null, synthesisLoading: false, synthesisSettled: true };
  assert.equal(verifyCustomerState(failed), 'COMPLETE');
});

test('the states a customer must act on are never a completion', () => {
  const base = { hasReport: true, synthesis: REPORT, synthesisLoading: false, synthesisSettled: true };
  assert.equal(verifyCustomerState({ ...base, jobStatus: 'WAITING_HUMAN' }), 'NEEDS_HUMAN');
  assert.equal(verifyCustomerState({ ...base, jobStatus: 'RUNNING', stage: 'CAPTCHA_REQUIRED' }), 'NEEDS_HUMAN');
  assert.equal(verifyCustomerState({ ...base, jobStatus: 'CANCELLED' }), 'STOPPED');
  assert.equal(verifyCustomerState({ ...base, jobStatus: 'FAILED' }), 'FAILED');
  // A pipeline that says COMPLETE with no evidence at all is not a success.
  assert.equal(verifyCustomerState({ ...base, jobStatus: 'COMPLETE', hasReport: false }), 'FAILED');
});

/* ── THE TWO SURFACES READ THE SAME RULE ──────────────────────────────── */

test('the page derives its progress and finalizing state from this module', () => {
  const src = readFileSync(join(ROOT, 'src', 'pages', 'VerifyPage.tsx'), 'utf8');
  assert.match(src, /import\s*\{\s*verifyCustomerState\s*\}\s*from\s*'@\/verify\/completion'/);
  // 100% is reserved for a report that exists — driven by the predicate now,
  // not by a raw truthiness check on the fetched object.
  assert.match(src, /reportReady=\{customerState==='COMPLETE'\}/);
  assert.match(src, /synthesizing=\{customerState==='FINALIZING'\}/);
  assert.ok(
    !/reportReady=\{!!synthesis\}/.test(src),
    'reportReady must come from the one predicate, not from a local truthiness test',
  );
});

test('the global indicator does not announce a completion for the screen in view', () => {
  const src = readFileSync(join(ROOT, 'src', 'components', 'jobs', 'JobIndicator.tsx'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  // The completion loop dismisses rather than raising, when the customer is
  // standing on that job's own result screen.
  assert.match(code, /if \(presentedHere\(job\)\) \{\s*dismissCompletion\(job\.id\);\s*continue;\s*\}/);
  // And the pill uses the same rule, so one concept governs both.
  assert.match(code, /const active = jobs\.filter\(\(j\) => !isTerminal\(j\.state\) && !presentedHere\(j\)\)/);
  // Everything running elsewhere is still announced: the toast call survives.
  assert.match(code, /toast\.success\(/);
  assert.match(code, /toast\.error\(/);
});
