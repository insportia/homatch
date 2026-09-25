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

import {
  compareArtifacts, uploadAccounting, ABSENT,
  proveArtifact, matchDeployedName, isProven, PROOF, fetchArtifact,
} from '../../scripts/edgeArtifacts.mjs';

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

/* ── THE ARTIFACT PROOF ───────────────────────────────────────────────────
 *
 * Ten more, and they are about a different question than the ten above.
 *
 * Those ask "did the pipeline do the work and admit it when it didn't?".
 * These ask "is the code production is running the code this revision says
 * it should be running?" -- which the pipeline could not ask until
 * 2026-09-25, and answered with the version counter instead.
 *
 * Every case below is modelled on something that actually happened in run
 * 36099775881 or the two before it. The fixtures are small on purpose: the
 * rule is pure, so it can be driven directly rather than grepped for.
 */

const FN = 'demo-fn';
const ENTRY = `supabase/functions/${FN}/index.ts`;
const SHARED = 'supabase/functions/_shared/comm/auth.ts';
const SRC = 'src/lib/ai/identity.ts';

/** The repository at this revision. */
const expectedTree = ({ entry = 'ENTRY@v2', shared = 'SHARED@v2', src = 'SRC@v2' } = {}) =>
  ({ [ENTRY]: entry, [SHARED]: shared, [SRC]: src });

/*
 * What production hands back. The `homatch/` prefix is not decoration: it is
 * how the CLI names files when a closure reaches into src/, and dropping it
 * would test a path the real API never takes.
 */
const deployedTree = ({
  version = 7, entry = 'ENTRY@v2', shared = 'SHARED@v2', src = 'SRC@v2', ...rest
} = {}) => ({
  version,
  updated_at: 5_000,
  ezbr_sha256: `sha-${entry}-${shared}-${src}`,
  files: [
    { name: `homatch/${ENTRY}`, content: entry },
    { name: `homatch/${SHARED}`, content: shared },
    { name: `homatch/${SRC}`, content: src },
  ],
  ...rest,
});

const prove = (deployed, expected = expectedTree()) =>
  proveArtifact({ name: FN, expected, deployed });

test('artifact 1: everything reached production — proven, and the ref may advance', () => {
  const proof = prove(deployedTree({ version: 8 }));
  assert.equal(proof.state, PROOF.PROVEN_EXACT);
  assert.ok(isProven(proof));
  assert.deepEqual(proof.mismatched, []);
  assert.equal(proof.deployedFileCount, 3);
});

test('artifact 2: a partial deployment leaves one function unproven, so the ref stays', () => {
  const good = prove(deployedTree({ version: 8 }));
  const bad = prove(deployedTree({ version: 7, shared: 'SHARED@v1' }));
  assert.ok(isProven(good));
  assert.ok(!isProven(bad), 'a stale function passed');
  assert.equal([good, bad].every(isProven), false, 'the run as a whole must not be proven');
});

test('artifact 3: the retry after a partial deploy — dedup and fresh upload both prove', () => {
  /* A was already correct and this run deduplicated it: the version does not
     move. B uploaded now. Under the old rule A was UNPROVEN forever and the
     ref could never advance again. */
  const deduped = prove(deployedTree({ version: 7 }));
  const uploaded = prove(deployedTree({ version: 8 }));
  assert.equal(deduped.state, PROOF.PROVEN_EXACT);
  assert.equal(uploaded.state, PROOF.PROVEN_EXACT);
  assert.ok([deduped, uploaded].every(isProven), 'a converged production still cannot advance the ref');
});

test('artifact 4: the CLI said deployed and exited 0, and production is stale — fails anyway', () => {
  const proof = prove(deployedTree({ version: 9, entry: 'ENTRY@v1' }));
  assert.equal(proof.state, PROOF.STALE);
  assert.ok(!isProven(proof));
  assert.deepEqual(proof.mismatched, [ENTRY]);
});

test('artifact 5: "No change found" over a deployed artifact that differs — fails', () => {
  const proof = prove(deployedTree({ version: 7, src: 'SRC@v1' }));
  assert.equal(proof.state, PROOF.STALE);
  assert.deepEqual(proof.mismatched, [SRC]);
});

test('artifact 6: "No change found" over an identical artifact — passes', () => {
  const proof = prove(deployedTree({ version: 7 }));
  assert.equal(proof.state, PROOF.PROVEN_EXACT);
  assert.ok(isProven(proof));
});

test('artifact 7: the entrypoint is untouched and a _shared dependency is not', () => {
  /* The exact shape of the owed set in run 36099775881: eleven of the
     eighteen functions were owed for a dependency they do not mention. */
  const proof = prove(deployedTree({ version: 7, shared: 'SHARED@v1' }));
  assert.equal(proof.state, PROOF.STALE, 'an old dependency in a current entrypoint was accepted');
  assert.deepEqual(proof.mismatched, [SHARED]);
  assert.ok(!proof.mismatched.includes(ENTRY), 'the entrypoint is not the thing that changed');
});

test('artifact 8: a rate-limited deploy leaves production stale — unproven and retryable', () => {
  /* The bundle never reached production, so production still answers with
     the previous revision. Nothing here advances the ref, and nothing here
     makes the next attempt impossible. */
  const proof = prove(deployedTree({ version: 7, entry: 'ENTRY@v1', shared: 'SHARED@v1' }));
  assert.ok(!isProven(proof));
  assert.equal(proof.state, PROOF.STALE);
  assert.equal(proof.mismatched.length, 2);
});

test('artifact 9: platform-side dedup — "Deploying" then "Deployed", version unmoved, artifact right', () => {
  /*
   * cartesia-access-token, run 36099775881. The CLI decided the bundle had
   * changed and uploaded 95 kB; the platform recognised an eszip it already
   * had and minted no new version. Deployment evidence says nothing
   * happened. The artifact says production is correct, and the artifact is
   * what the ref is about.
   */
  const proof = prove(deployedTree({ version: 26 }));
  assert.equal(proof.version, 26);
  assert.equal(proof.state, PROOF.PROVEN_EXACT);
  assert.ok(isProven(proof), 'the platform-side dedup case regressed');
});

test('artifact 10: the version incremented and the artifact is wrong — MUST fail', () => {
  /*
   * The direction the old rule got backwards. An increment proves an upload
   * occurred, never that it carried this revision.
   */
  const proof = prove(deployedTree({ version: 99, entry: 'ENTRY@v1', src: 'SRC@v1' }));
  assert.ok(!isProven(proof), 'a version bump over the wrong tree was accepted as proof');
  assert.equal(proof.state, PROOF.STALE);
});

test('artifact: production that will not say what it runs is UNAVAILABLE, never assumed', () => {
  const noFiles = prove(deployedTree({ version: 8, files: null }));
  assert.equal(noFiles.state, PROOF.UNAVAILABLE);
  assert.ok(!isProven(noFiles), 'a function with no artifact evidence was treated as proven');

  /* The one substitute allowed, and only when the hash is one we can
     reproduce rather than one we merely received. */
  const hashed = proveArtifact({
    name: FN,
    expected: expectedTree(),
    deployed: { version: 8, updated_at: 5_000, ezbr_sha256: 'abc123', files: null },
    expectedEzbr: 'abc123',
  });
  assert.equal(hashed.state, PROOF.PROVEN_HASH);
  assert.ok(isProven(hashed));
});

test('artifact: production running a file this revision does not have is INCOMPLETE', () => {
  const deployed = deployedTree({ version: 8 });
  deployed.files.push({ name: 'homatch/src/removed/gone.ts', content: 'x' });
  const proof = prove(deployed);
  assert.equal(proof.state, PROOF.INCOMPLETE);
  assert.deepEqual(proof.foreign, ['homatch/src/removed/gone.ts']);
});

test('artifact: a deployment missing the entrypoint cannot be proven', () => {
  const deployed = deployedTree({ version: 8 });
  deployed.files = deployed.files.filter((f) => !f.name.endsWith(`${FN}/index.ts`));
  const proof = prove(deployed);
  assert.equal(proof.state, PROOF.INCOMPLETE);
  assert.ok(!isProven(proof));
});

test('artifact: both CLI naming layouts resolve, and neither resolves ambiguously', () => {
  /* functions/… when the closure stays inside supabase/functions, homatch/…
     when it reaches into src/. Both are real; both are measured. */
  assert.deepEqual(matchDeployedName('functions/_shared/comm/auth.ts', [SHARED]), [SHARED]);
  assert.deepEqual(matchDeployedName(`homatch/${SHARED}`, [SHARED]), [SHARED]);
  assert.deepEqual(matchDeployedName('functions/_shared/comm/auth.ts', [ENTRY, SRC]), []);
});

/* ── MUTATION GUARDS ──────────────────────────────────────────────────────
 *
 * Each of these fails if a specific weakening is applied to the rule. They
 * are written as behaviour rather than as a grep, so they survive the file
 * being rewritten and they cannot be satisfied by a comment.
 */

test('mutation: deleting the content comparison makes two different productions identical', () => {
  /*
   * Same version, same updated_at, same file count, same names. Content is
   * the ONLY input that differs, so a rule that stopped reading contents
   * would have to return the same verdict for both.
   */
  const exact = prove(deployedTree({ version: 7 }));
  const stale = prove(deployedTree({ version: 7, shared: 'SHARED@v1' }));
  assert.equal(exact.deployedFileCount, stale.deployedFileCount);
  assert.equal(exact.version, stale.version);
  assert.notEqual(exact.state, stale.state, 'the proof is no longer reading file contents');
});

test('mutation: accepting a version increment alone flips case 10 green', () => {
  const bumpedAndWrong = prove(deployedTree({ version: 99, entry: 'ENTRY@v1' }));
  const unbumpedAndRight = prove(deployedTree({ version: 1 }));
  assert.ok(!isProven(bumpedAndWrong), 'version increment is being treated as proof');
  assert.ok(isProven(unbumpedAndRight), 'an unmoved version is being treated as failure');
});

test('mutation: ignoring the dependency closure flips case 7 green', () => {
  /* The entrypoint is byte-perfect in both. Only a dependency differs, so a
     rule that compared the top-level file alone would pass the stale one. */
  const stale = prove(deployedTree({ version: 7, shared: 'SHARED@v1' }));
  const entryOnly = stale.mismatched.filter((p) => p === ENTRY);
  assert.deepEqual(entryOnly, [], 'the entrypoint is unchanged, as the case requires');
  assert.ok(!isProven(stale), 'a stale _shared dependency is being ignored');
});

test('the workflow wires the artifact proof, bounded concurrency and a best-effort warm-up', () => {
  const deploy = job('deploy-functions');

  /* Eight simultaneous anonymous ECR pulls from one runner IP. */
  assert.ok(!/RUNNING >= [3-9]/.test(deploy), 'edge deploy concurrency is unbounded again');
  assert.equal((deploy.match(/RUNNING >= 2/g) ?? []).length, 2, 'both deploy loops must be bounded');

  /* The warm-up is an optimisation and must never be able to fail the job or
     stand in for proof. */
  const warm = deploy.slice(deploy.indexOf('- name: Warm the edge-runtime image'));
  assert.match(warm.slice(0, 400), /continue-on-error: true/, 'the warm-up can fail the deploy');
  assert.ok(!/edge-runtime:v[0-9]+\.[0-9]+\.[0-9]+["'\s]*$/m.test(warm.split('- name:')[1] ?? ''),
    'the edge-runtime tag is hardcoded and will go stale when the CLI is bumped');

  /* And the proof itself still runs, after the deploys, before the ref. */
  const proveAt = deploy.indexOf('- name: Prove it in production');
  assert.ok(deploy.indexOf('- name: Warm the edge-runtime image') < proveAt);
  assert.match(deploy.slice(proveAt), /edgeArtifacts\.mjs verify/);
});

/*
 * HOW THE DEPLOYED FILES ARE ASKED FOR.
 *
 * CI is the only place this runs against the real API, so the route logic is
 * driven here with a stub rather than taken on trust. The plain endpoint is
 * the one that answered with `files` when this was measured on 2026-09-25;
 * the second form exists so a rename cannot silently turn every function
 * UNAVAILABLE, and the plain route stays the only one allowed to fail a run.
 */
test('artifact source: the plain route is preferred, and asked once when it answers', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        version: 3, updated_at: 9, files: [{ name: 'functions/x/index.ts', content: 'a' }],
      }),
    };
  };
  const got = await fetchArtifact('x', { projectRef: 'r', token: 't', fetchImpl });
  assert.equal(calls.length, 1, 'the API was asked twice when once was enough');
  assert.ok(!calls[0].includes('include_files'));
  assert.equal(got.route, 'plain');
  assert.equal(got.files.length, 1);
});

test('artifact source: a plain route without files falls through to the explicit form', async () => {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const files = url.includes('include_files')
      ? [{ name: 'functions/x/index.ts', content: 'a' }]
      : undefined;
    return { ok: true, status: 200, json: async () => ({ version: 3, updated_at: 9, files }) };
  };
  const got = await fetchArtifact('x', { projectRef: 'r', token: 't', fetchImpl });
  assert.equal(calls.length, 2);
  assert.equal(got.route, 'include_files');
  assert.equal(got.files.length, 1);
});

test('artifact source: no files from any route is UNAVAILABLE, never a pass', async () => {
  const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ version: 3, updated_at: 9 }) });
  const got = await fetchArtifact('x', { projectRef: 'r', token: 't', fetchImpl });
  assert.equal(got.files, null);
  const proof = proveArtifact({
    name: 'x', expected: { 'supabase/functions/x/index.ts': 'a' }, deployed: got,
  });
  assert.equal(proof.state, PROOF.UNAVAILABLE);
  assert.ok(!isProven(proof), 'a function with no artifact evidence was allowed to advance the ref');
});

test('artifact source: a function production has never heard of is ABSENT, and unprovable', async () => {
  const fetchImpl = async () => ({ ok: false, status: 404, json: async () => ({}) });
  const got = await fetchArtifact('x', { projectRef: 'r', token: 't', fetchImpl });
  assert.equal(got.absent, true);
  const proof = proveArtifact({
    name: 'x', expected: { 'supabase/functions/x/index.ts': 'a' }, deployed: got,
  });
  assert.equal(proof.state, PROOF.UNAVAILABLE);
});
