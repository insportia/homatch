// A green tick that a failing test cannot turn red is not a gate.
//
// WHY THIS EXISTS
//
// A suite run here was read as passing while its own output contained a real
// failure. The runner was not at fault, and neither was npm or CI: measured
// one layer at a time against a deliberately failing test, every one of them
// returned 1.
//
//   node --test <failing file>     exit 1
//   node scripts/run-tests.mjs     exit 1
//   npm test                       exit 1
//   npm test | cat                 exit 0   <-- here
//   npm test | tee log             exit 0
//   npm test | tail -10            exit 0
//
// A POSIX shell reports the status of the LAST command in a pipeline. Put the
// canonical command on the left of a `|` and the exit code you read belongs to
// `tail`, which has no opinion about tests. Worse, node:test prints its
// failure details AFTER the summary counts, so a truncated view of a failing
// run shows an assertion dump and never reaches the `fail` line — the two
// things a reader uses to tell pass from fail both disappear at once.
//
// Looking for that pipe turned up a second way to get a green tick, and this
// one was in the repository rather than in how it was being read:
//
//   NODE_TEST_CONTEXT=child-v8 npm test   exit 0, with no tests run at all
//
// node:test sets that variable for every file it runs. A `node --test` that
// inherits it believes it is already inside a run, skips the files, and exits
// 0. The runner now deletes it before spawning, so the canonical command's
// verdict no longer depends on the environment it was launched from.
//
// WHAT THIS PINS
//
// The dependency the whole gate rests on: that a failing test really does make
// the process exit non-zero. That is Node's behaviour, not ours, and it is
// exactly the kind of assumption that is never checked until it is wrong. It
// is exercised here against a real spawned run rather than asserted about.
//
// Then the hazard above, demonstrated live; the runner's immunity to it; and
// the two properties that keep a piped read honest — it exits with the child's
// status rather than its own, and it says the verdict out loud so the last
// line of any view of the output is the answer.

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const RUNNER = join(process.cwd(), 'scripts', 'run-tests.mjs');

/**
 * Run node:test over one temporary file and report how it went.
 *
 * `keepTestContext` decides whether the child inherits NODE_TEST_CONTEXT.
 * This file IS a test, so that variable is set in this very process, and a
 * child that sees it starts in child mode and exits 0 no matter how many
 * assertions failed. Stripping it is what makes the measurement mean
 * anything; keeping it is how the second test below proves the hazard is
 * real rather than described.
 */
function runTemp(body, { keepTestContext = false } = {}) {
  // Deliberately OUTSIDE the repository, so the runner's own walk can never
  // pick these up and this file cannot make the real suite fail or pass.
  const dir = mkdtempSync(join(tmpdir(), 'homatch-testgate-'));
  const file = join(dir, 'probe.test.mjs');
  writeFileSync(file, body, 'utf8');
  const env = { ...process.env };
  if (!keepTestContext) delete env.NODE_TEST_CONTEXT;
  try {
    const res = spawnSync(process.execPath, ['--test', file], { encoding: 'utf8', env });
    return { status: res.status, signal: res.signal, out: `${res.stdout || ''}${res.stderr || ''}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const PASSING = `
import test from 'node:test';
test('passes', () => {});
`;

const FAILING = `
import test from 'node:test';
import assert from 'node:assert/strict';
test('fails on purpose', () => { assert.equal(1, 2); });
`;

test('a failing test makes the test process exit non-zero', () => {
  const r = runTemp(FAILING);
  assert.notEqual(r.status, 0, 'a real failure must not exit 0');
  assert.equal(r.signal, null, 'and must fail by status, not by dying');
  // The failure is visible as well as fatal — a silent non-zero is its own
  // kind of unreadable.
  assert.match(r.out, /fail 1/);
});

test('a passing test exits zero', () => {
  const r = runTemp(PASSING);
  assert.equal(r.status, 0, `a clean run must exit 0, got ${r.status}`);
});

test('an inherited NODE_TEST_CONTEXT skips every file and still exits zero', () => {
  /*
   * The hazard, demonstrated rather than asserted about — and it is worse
   * than "failures are ignored".
   *
   * node:test sets NODE_TEST_CONTEXT for each file it runs, and anything
   * spawned from inside a test inherits it. A `node --test` that sees it
   * decides it is already inside a test run, warns that run() was called
   * recursively, SKIPS RUNNING THE FILES ALTOGETHER, and exits 0.
   *
   * So the failure is not swallowed. Nothing executes at all, and the silence
   * is reported as success. Measured on the canonical command before the fix,
   * with a deliberately failing test in the tree:
   *
   *   npm test                             exit 1, 3555 tests, fail 1
   *   NODE_TEST_CONTEXT=child-v8 npm test  exit 0, no tests, no output
   */
  const r = runTemp(FAILING, { keepTestContext: true });
  assert.equal(process.env.NODE_TEST_CONTEXT, 'child-v8', 'this process is itself a test child');
  assert.equal(r.status, 0, 'if this ever stops being 0, Node changed and the guard below can go');
  assert.match(r.out, /skipping running files/i, 'nothing ran');
  assert.ok(!/^ℹ tests/m.test(r.out), 'and there is no summary at all to read');
});

test('the runner does not let that variable reach its child', () => {
  // The fix for the above, and the reason `npm test` cannot be turned green
  // by the environment it happens to be launched from.
  const src = readFileSync(RUNNER, 'utf8');
  assert.match(src, /delete childEnv\.NODE_TEST_CONTEXT;/);
  assert.match(src, /env: childEnv,/);
});

test('the runner exits with the test process status, never its own', () => {
  // Source-read rather than executed: running the full suite from inside the
  // full suite would take seven seconds and recurse.
  const src = readFileSync(RUNNER, 'utf8');
  assert.match(
    src,
    /process\.exit\(res\.status \?\? 1\)/,
    'run-tests.mjs must propagate the child status, and treat "no status" as failure',
  );
  // A run that produced no files, or walked a missing root, must not be able
  // to report success — a partial run read as a full one is the same lie in a
  // different shape.
  assert.match(src, /refusing to report success on a partial run/);
  assert.match(src, /refusing to report success\./);
});

test('the runner states the verdict, so a piped read cannot end on an error dump', () => {
  const src = readFileSync(RUNNER, 'utf8');
  assert.match(src, /TEST GATE: PASS/);
  assert.match(src, /TEST GATE: FAIL/);
  // Derived from the status it already has. Scraping the output for a word
  // like "fail" would make the verdict depend on the reporter's wording,
  // which is precisely the fragility this is meant to remove.
  assert.match(src, /const failed = res\.status !== 0;/);
  assert.ok(
    !/stdout[\s\S]{0,80}(includes|match)\(['"/]fail/.test(src),
    'the verdict must come from the exit status, not from parsing test output',
  );
});

test('the canonical command is the one CI runs', () => {
  // If package.json's "test" script and the workflows ever name different
  // things, everything proven here is proven about a command nobody runs.
  const pkg = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8'));
  assert.equal(pkg.scripts.test, 'node scripts/run-tests.mjs');
  for (const wf of ['deploy.yml', 'pr-check.yml']) {
    const src = readFileSync(join(process.cwd(), '.github', 'workflows', wf), 'utf8');
    assert.match(src, /^\s*run: pnpm test\s*$/m, `${wf} must invoke the canonical suite`);
    // And it must invoke it bare. A pipe on that line would hand CI the exit
    // code of whatever is downstream of the `|`.
    assert.ok(
      !/run: pnpm test\s*(\||>)/.test(src),
      `${wf} pipes or redirects pnpm test, which discards its exit status`,
    );
  }
});
