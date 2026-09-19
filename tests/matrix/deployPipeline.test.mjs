/*
 * THE TEN WAYS THIS PIPELINE HAS LOST, OR COULD LOSE, A DEPLOYMENT.
 *
 * On 2026-09-19 the deploy workflow reported success three times over work it
 * had not done, and each time it advanced refs/deployed/edge afterwards --
 * which erased the evidence, because the next run measured its scope from the
 * false ref and correctly concluded that nothing was owed. ai-talk-session sat
 * at version 107 for the rest of the day underneath three green deployments.
 *
 * The defect was never a single wrong value. It was that ONE cross-job string
 * (`needs.scope.outputs.edge`) decided both whether the work happened and
 * whether the work was checked, so when the string was wrong every guard
 * written to catch it was disabled by the same mistake it was guarding.
 *
 * So these tests do not check that the pipeline works. They check that each
 * of the ten specific ways it can be wrong is LOUD: a failure, or a named,
 * self-reported state -- never a green run that quietly leaves work owed and
 * then forgets it was owed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { compareArtifacts, uploadAccounting, ABSENT } from '../../scripts/edgeArtifacts.mjs';

const WORKFLOW = readFileSync('.github/workflows/deploy.yml', 'utf8');
const SCOPE_URL = pathToFileURL(resolve('scripts/deploy-scope.mjs')).href;

/**
 * The deploy-functions job on its own, so "the workflow mentions X somewhere"
 * can never be mistaken for "the deploy job does X".
 */
function job(name) {
  const start = WORKFLOW.indexOf(`\n  ${name}:\n`);
  assert.ok(start >= 0, `the ${name} job is gone`);
  const rest = WORKFLOW.slice(start + 1);
  const next = rest.slice(1).search(/\n {2}[a-z][a-z-]*:\n/);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

/* ── A throwaway repository, so history-shaped facts are not clone-shaped ──
 *
 * The Validate job checks out at depth 1, so any test that reads this
 * repository's own history is a test that silently stops running in CI. These
 * build the history they need.
 */
function repo() {
  const dir = mkdtempSync(join(tmpdir(), 'deploy-pipeline-'));
  const g = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args],
    { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  g('init', '-q', '-b', 'main');
  const write = (path, body) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), body);
  };
  const fn = (name, body = 'export default 1;\n') => write(`supabase/functions/${name}/index.ts`, body);
  const commit = (msg) => { g('add', '-A'); g('commit', '-q', '-m', msg); return g('rev-parse', 'HEAD'); };
  return { dir, g, write, fn, commit, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/** deploymentScope() as the deploy job runs it: in that checkout, from that ref. */
function scopeIn(dir) {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    `import { deploymentScope } from ${JSON.stringify(SCOPE_URL)};
     console.log(JSON.stringify(deploymentScope()));`],
  { cwd: dir, encoding: 'utf8' });
  return JSON.parse(out);
}

/* ── 1. Owed functions exist ─────────────────────────────────────────────*/

test('1: owed functions exist — exactly those are named, and the deploy job reads that list', () => {
  const r = repo();
  try {
    r.fn('ai-talk-session');
    r.fn('storage-sign');
    const base = r.commit('base');
    r.g('update-ref', 'refs/deployed/edge', base);
    r.g('update-ref', 'refs/deployed/frontend', base);
    r.g('update-ref', 'refs/deployed/worker', base);
    r.g('update-ref', 'refs/deployed/migrations', base);

    r.fn('ai-talk-session', 'export default 2; // the fix\n');
    r.commit('fix the assistant');

    const scope = scopeIn(r.dir);
    assert.equal(scope.components.edge.deploy, true);
    assert.deepEqual(scope.functions, ['ai-talk-session'], 'scope named the wrong work');
  } finally { r.cleanup(); }

  // And the loops upload from that list rather than from a job output. Both
  // of them: the JWT loop and the no-JWT loop each iterate a hand-maintained
  // name list, and a list read from two different places is two lists.
  const deploy = job('deploy-functions');
  assert.equal((deploy.match(/OWED_LIST=\$\(cat "\$RUNNER_TEMP\/owed\.txt"\)/g) || []).length, 2,
    'a deploy loop is getting its work from somewhere other than the computed owed list');
});

/* ── 2. No work owed ─────────────────────────────────────────────────────*/

test('2: no work owed — the job still runs and says NO_WORK about itself', () => {
  const r = repo();
  try {
    r.fn('ai-talk-session');
    const head = r.commit('base');
    for (const c of ['edge', 'frontend', 'worker', 'migrations']) r.g('update-ref', `refs/deployed/${c}`, head);
    const scope = scopeIn(r.dir);
    assert.equal(scope.components.edge.deploy, false);
    assert.equal(scope.components.edge.reason, 'UP_TO_DATE');
    assert.deepEqual(scope.functions, []);
  } finally { r.cleanup(); }

  const deploy = job('deploy-functions');
  /*
   * The job must START. `d810e3ec` was skipped outright because a cross-job
   * output did not arrive as 'true', and a skipped job cannot report anything
   * about itself -- which is how "skipped" came to be read downstream as
   * "nothing was owed" and the ref advanced over five owed functions.
   */
  assert.ok(!/^ {4}if:/m.test(deploy), 'deploy-functions has a job-level condition again');
  assert.match(deploy, /NO_WORK/, 'the job cannot report that it had nothing to do');
});

/* ── 3. Empty function list, unexpectedly ────────────────────────────────*/

test('3: owed > 0 and uploaded = 0 is a failure, not a green run', () => {
  // Run 8618f244, exactly: edge='true' arrived, functions='' arrived, the
  // loops matched nothing, and the job exited 0.
  const r = uploadAccounting(5, 0);
  assert.equal(r.ok, false);
  assert.match(r.reason, /5 function\(s\) owed and 0 uploaded/);

  // The subtler version: owed but present in neither hand-maintained list, so
  // no loop matches it and nothing anywhere notices.
  assert.equal(uploadAccounting(3, 2).ok, false, 'a function owed but in no deploy list passes silently');
  assert.equal(uploadAccounting(0, 0).ok, true, 'an honest NO_WORK run must still pass');
  assert.equal(uploadAccounting(2, 2).ok, true);

  const deploy = job('deploy-functions');
  assert.match(deploy, /uploadAccounting/, 'the accounting is not wired into the job');
});

/* ── 4. The upload exits 0 and the artifact does not move ────────────────*/

test('4: a CLI exit code is not deployment proof — the version has to advance', () => {
  const pre = { 'ai-talk-session': { version: 107, updated_at: 1_000 } };
  const post = { 'ai-talk-session': { version: 107, updated_at: 1_000 } };
  const r = compareArtifacts(pre, post, 2_000);
  assert.equal(r.ok, false);
  assert.match(r.rows[0].reason, /version did not advance \(107 -> 107\)/);

  const moved = compareArtifacts(pre, { 'ai-talk-session': { version: 108, updated_at: 3_000 } }, 2_000);
  assert.equal(moved.ok, true);
});

/* ── 5. One function out of several ──────────────────────────────────────*/

test('5: one unmoved function fails the run and is named', () => {
  const pre = {
    'ai-talk-session': { version: 107, updated_at: 1_000 },
    'comm-agent': { version: 31, updated_at: 1_000 },
    'investment-consultant': { version: 4, updated_at: 1_000 },
  };
  const post = {
    'ai-talk-session': { version: 107, updated_at: 1_000 }, // the one run 8618f244 dropped
    'comm-agent': { version: 32, updated_at: 3_000 },
    'investment-consultant': { version: 5, updated_at: 3_000 },
  };
  const r = compareArtifacts(pre, post, 2_000);
  assert.equal(r.ok, false);
  assert.deepEqual(r.rows.filter((x) => !x.ok).map((x) => x.name), ['ai-talk-session']);

  // And a failed upload names itself rather than being averaged away by the
  // parallel loop's exit code.
  const deploy = job('deploy-functions');
  assert.match(deploy, /touch "\$TMP\/\$fn\.failed"/);
  assert.match(deploy, /::error::Failed to deploy: \$\{FAILED\[\*\]\}/);
});

/* ── 6. Stale updated_at ─────────────────────────────────────────────────*/

test('6: a version that advanced before this run started does not count', () => {
  // Another run's upload, landing in the window. The version moved; it was
  // not this run that moved it.
  const r = compareArtifacts(
    { 'ai-talk-session': { version: 107, updated_at: 1_000 } },
    { 'ai-talk-session': { version: 108, updated_at: 1_500 } },
    2_000,
  );
  assert.equal(r.ok, false);
  assert.match(r.rows[0].reason, /predates this run/);
});

/* ── 7. The expected artifact is missing entirely ────────────────────────*/

test('7: a function that production has never heard of cannot pass verification', () => {
  const r = compareArtifacts({ 'active-search-notify': { ...ABSENT } }, { 'active-search-notify': { ...ABSENT } }, 1);
  assert.equal(r.ok, false);
  assert.match(r.rows[0].reason, /version did not advance \(0 -> 0\)/);

  // A first deploy of a genuinely new function is the same rule, passing.
  assert.equal(
    compareArtifacts({ 'active-search-notify': { ...ABSENT } }, { 'active-search-notify': { version: 1, updated_at: 9 } }, 5).ok,
    true,
  );

  /*
   * And the check runs whatever the deploy step thought of itself. The old
   * one was `if: needs.scope.outputs.edge == 'true'` on a job that only
   * existed under that same condition -- a verification that can only run
   * when the thing it verifies claims success.
   */
  const deploy = job('deploy-functions');
  const prove = deploy.slice(deploy.indexOf('- name: Prove it in production'));
  assert.match(prove.split('\n')[1], /if: always\(\)/, 'the proof is conditional on the claim it is checking');
  assert.ok(!/needs\.scope\.outputs/.test(deploy), 'a cross-job output is deployment authority again');
});

/* ── 8. A queued run superseded by a descendant ──────────────────────────*/

test('8: a run whose base is newer than its own HEAD deploys nothing', () => {
  const r = repo();
  try {
    r.fn('ai-talk-session');
    const older = r.commit('the commit this run is for');
    r.fn('ai-talk-session', 'export default 2;\n');
    const newer = r.commit('the commit that got there first');

    // Production already has `newer`. This run is for `older`.
    for (const c of ['edge', 'frontend', 'worker', 'migrations']) r.g('update-ref', `refs/deployed/${c}`, newer);
    r.g('checkout', '-q', older);

    const scope = scopeIn(r.dir);
    assert.equal(scope.components.edge.deploy, false, 'the pipeline would have downgraded production');
    assert.equal(scope.components.edge.reason, 'SUPERSEDED');
    assert.deepEqual(scope.functions, []);
  } finally { r.cleanup(); }
});

/* ── 9. main advances while the run waits ────────────────────────────────*/

test('9: work owed by an earlier commit survives later commits that touch nothing', () => {
  /*
   * The original incident, at the deploy job rather than at the scope job.
   * dafdebd2 fixed the language bug; two unrelated commits landed on top. Any
   * reading of HEAD~1..HEAD names no edge function at all, so the fix was
   * never queued. The base is what is DEPLOYED, so it still is.
   */
  const r = repo();
  try {
    r.fn('ai-talk-session');
    r.write('README.md', 'x\n');
    const base = r.commit('base');
    for (const c of ['edge', 'frontend', 'worker', 'migrations']) r.g('update-ref', `refs/deployed/${c}`, base);

    r.fn('ai-talk-session', 'export default 2; // the P0 fix\n');
    r.commit('the fix nobody deployed');
    r.write('README.md', 'y\n');
    r.commit('an unrelated commit from another session');
    r.write('README.md', 'z\n');
    r.commit('and another');

    const scope = scopeIn(r.dir);
    assert.deepEqual(scope.functions, ['ai-talk-session'], 'the owed fix was lost behind later commits');
  } finally { r.cleanup(); }
});

/* ── 10. The deployed ref is falsely ahead ───────────────────────────────*/

test('10: a falsely advanced ref is visible, and only a proven artifact can advance one', () => {
  // A ref ahead of HEAD reports SUPERSEDED, never UP_TO_DATE. The two look
  // alike from a summary and mean opposite things: one says production has
  // this, the other says production claims something this run cannot account
  // for -- which is the state refs/deployed/edge was in for most of
  // 2026-09-19 while reporting everything current.
  const r = repo();
  try {
    r.fn('ai-talk-session');
    const head = r.commit('base');
    r.fn('ai-talk-session', 'export default 2;\n');
    const ahead = r.commit('never actually deployed');
    for (const c of ['edge', 'frontend', 'worker', 'migrations']) r.g('update-ref', `refs/deployed/${c}`, ahead);
    r.g('checkout', '-q', head);
    assert.equal(scopeIn(r.dir).components.edge.reason, 'SUPERSEDED');
  } finally { r.cleanup(); }

  /*
   * And the ref is advanced in exactly one place in the whole workflow: the
   * step after the artifact proof, in the same job, guarded by success().
   * It used to advance in a terminal job that read another job's `result`,
   * and a result is a job's opinion of itself.
   */
  const advances = [...WORKFLOW.matchAll(/update-ref\s+"?(refs\/deployed\/[\w$]+)/g)].map((m) => m[1]);
  assert.deepEqual(
    advances.filter((a) => a.includes('edge')), ['refs/deployed/edge'],
    'refs/deployed/edge is written from somewhere other than the one proven place',
  );
  // The only other writer is record-deployment's generic helper, and the sole
  // component it is still handed is the frontend.
  assert.deepEqual(advances.filter((a) => a.includes('$')), ['refs/deployed/$component']);

  const deploy = job('deploy-functions');
  const proveAt = deploy.indexOf('- name: Prove it in production');
  const advanceAt = deploy.indexOf('- name: Advance refs/deployed/edge');
  assert.ok(proveAt > 0 && advanceAt > proveAt, 'the ref advances before the artifact is proven');
  assert.match(deploy.slice(advanceAt), /if: success\(\)/);

  // The terminal job no longer has an opinion about the edge at all. Read
  // without its comments: the comments there EXPLAIN the removed inference,
  // and a test that cannot tell an explanation from a decision is a test that
  // punishes writing the reason down.
  const record = job('record-deployment')
    .split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.ok(!/advance edge/.test(record), 'record-deployment is deciding the edge ref again');
  assert.ok(!/deploy-functions\.result/.test(record), 'the edge ref is being inferred from a job result again');
  assert.ok(!/needs\.scope\.outputs\.edge/.test(record), 'the broken output is back in the ref decision');
});
