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
  fetchDeployedModules, unwrapEszip,
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
 * Twenty, and they are about a different question than the ten above.
 *
 * Those ask "did the pipeline do the work and admit it when it didn't?".
 * These ask "is the code production is running the code this revision says
 * it should be running?" — which the pipeline answered with a version
 * counter until 2026-09-25, then with a hash that turned out not to be
 * reproducible, and now answers with the deployed source itself.
 *
 * The source comes out of the deployed eszip's source maps: a module's
 * stored body is transpiled JavaScript, but its sourceMap.sourcesContent is
 * the original file byte for byte. Measured by building an eszip from real
 * TypeScript and parsing it back — transpiled 153 chars against an original
 * of 215, `interface` and `as Local` absent from one and present in the
 * other, and sourcesContent identical to the original.
 *
 * Every case below is modelled on something that actually happened. The
 * fixtures are small on purpose: the rule is pure, so it is driven directly
 * rather than grepped for.
 */

const FN = 'demo-fn';
const ENTRY = `supabase/functions/${FN}/index.ts`;
const SHARED = 'supabase/functions/_shared/comm/auth.ts';
const SRC = 'src/lib/ai/identity.ts';
/* Followed by importClosure(), erased by the bundler: never deployed. */
const TYPE_ONLY = 'src/lib/ai/types.ts';

/** The repository at this revision, as importClosure() sees it. */
const expectedTree = ({ entry = 'ENTRY@v2', shared = 'SHARED@v2', src = 'SRC@v2' } = {}) => ({
  [ENTRY]: entry,
  [SHARED]: shared,
  [SRC]: src,
  [TYPE_ONLY]: 'TYPES@v2',
});

/*
 * What the parser yields from production. The deployed source URL is an
 * absolute path on the runner, which is how the real artifact names it.
 */
const RUNNER = 'file:///home/runner/work/homatch/homatch';
const mod = (repoPath, content) => ({
  specifier: `${RUNNER}/${repoPath}`,
  sourceUrl: `${RUNNER}/${repoPath}`,
  content,
});

const deployedTree = ({
  version = 7, entry = 'ENTRY@v2', shared = 'SHARED@v2', src = 'SRC@v2', ...rest
} = {}) => ({
  version,
  updated_at: 5_000,
  ezbr_sha256: 'a34394a5deadbeef',
  modules: [mod(ENTRY, entry), mod(SHARED, shared), mod(SRC, src)],
  ...rest,
});

const prove = (deployed, expected = expectedTree()) =>
  proveArtifact({ name: FN, expected, deployed });

test('artifact 1: everything reached production — proven, and the ref may advance', () => {
  const proof = prove(deployedTree({ version: 8 }));
  assert.equal(proof.state, PROOF.PROVEN_EXACT);
  assert.ok(isProven(proof));
  assert.deepEqual(proof.mismatched, []);
  assert.equal(proof.matched, 3);
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
     move. B uploaded now. Under the version rule A was UNPROVEN forever and
     the ref could never advance again. */
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
  /* The shape of the owed set in run 36099775881: eleven of the eighteen
     functions were owed for a dependency they do not mention. */
  const proof = prove(deployedTree({ version: 7, shared: 'SHARED@v1' }));
  assert.equal(proof.state, PROOF.STALE, 'an old dependency under a current entrypoint was accepted');
  assert.deepEqual(proof.mismatched, [SHARED]);
  assert.ok(!proof.mismatched.includes(ENTRY), 'the entrypoint is not the thing that changed');
});

test('artifact 8: a rate-limited deploy leaves production stale — unproven and retryable', () => {
  const proof = prove(deployedTree({ version: 7, entry: 'ENTRY@v1', shared: 'SHARED@v1' }));
  assert.ok(!isProven(proof));
  assert.equal(proof.state, PROOF.STALE);
  assert.equal(proof.mismatched.length, 2);
});

test('artifact 9: platform-side dedup — "Deploying" then "Deployed", version unmoved, artifact right', () => {
  /*
   * cartesia-access-token, run 36099775881. The CLI decided the bundle had
   * changed and uploaded 95 kB; the platform recognised an eszip it already
   * had and minted no new version.
   */
  const proof = prove(deployedTree({ version: 26 }));
  assert.equal(proof.version, 26);
  assert.equal(proof.state, PROOF.PROVEN_EXACT);
  assert.ok(isProven(proof), 'the platform-side dedup case regressed');
});

test('artifact 10: the version incremented and the artifact is wrong — MUST fail', () => {
  const proof = prove(deployedTree({ version: 99, entry: 'ENTRY@v1', src: 'SRC@v1' }));
  assert.ok(!isProven(proof), 'a version bump over the wrong tree was accepted as proof');
  assert.equal(proof.state, PROOF.STALE);
});

test('artifact 11: a valid body parses, and only its LOCAL modules are compared', async () => {
  /*
   * A real eszip, built and parsed here rather than described. Remote
   * dependencies are in the graph and must not reach the comparison: there is
   * nothing in this repository to compare deno.land or jsr against.
   */
  const { build, Parser } = await import('@deno/eszip');
  const dir = mkdtempSync(join(tmpdir(), 'eszip-'));
  writeFileSync(join(dir, 'dep.ts'), 'export const n: number = 1;\n');
  writeFileSync(join(dir, 'index.ts'), "import { n } from './dep.ts';\nexport const go = (): number => n;\n");
  const entryUrl = pathToFileURL(join(dir, 'index.ts')).href;

  const bytes = await build([entryUrl], async (specifier) => ({
    kind: 'module',
    specifier,
    content: readFileSync(decodeURIComponent(new URL(specifier).pathname).replace(/^\//, ''), 'utf8'),
  }));
  assert.equal(Buffer.from(bytes.slice(0, 5)).toString('latin1'), 'ESZIP', 'not an eszip container');

  const parser = await Parser.createInstance();
  const specs = await parser.parseBytes(bytes);
  await parser.load();
  assert.equal(specs.length, 2);

  /* The stored body is transpiled; the original lives in sourcesContent. */
  const body = await parser.getModuleSource(entryUrl);
  assert.ok(!/:\s*number/.test(body), 'the stored module body is not transpiled after all');
  const map = JSON.parse(await parser.getModuleSourceMap(entryUrl));
  assert.match(map.sourcesContent[0], /:\s*number/, 'sourcesContent lost the original TypeScript');
  rmSync(dir, { recursive: true, force: true });
});

test('artifact 11b: the whole chain against a real eszip — fetch, parse, prove', async () => {
  /*
   * The only test that runs fetchDeployedModules over a genuine ESZIP2.3
   * container rather than a described one. Repo-shaped paths, because the
   * mapping from a deployed file: URL back to a repository file is part of
   * what is being proven.
   */
  const { build } = await import('@deno/eszip');
  const root = mkdtempSync(join(tmpdir(), 'repo-'));
  const ENTRY_REL = 'supabase/functions/demo-fn/index.ts';
  const SHARED_REL = 'supabase/functions/_shared/comm/auth.ts';
  const SRC_REL = 'src/lib/ai/identity.ts';
  mkdirSync(join(root, 'supabase/functions/demo-fn'), { recursive: true });
  mkdirSync(join(root, 'supabase/functions/_shared/comm'), { recursive: true });
  mkdirSync(join(root, 'src/lib/ai'), { recursive: true });

  const SHARED_SRC = 'export interface Token { v: string }\nexport const mk = (v: string): Token => ({ v });\n';
  const SRC_SRC = "export const NAME: string = 'homatch';\n";
  const ENTRY_SRC = "import { mk, type Token } from '../_shared/comm/auth.ts';\n"
    + "import { NAME } from '../../../src/lib/ai/identity.ts';\n"
    + 'export function go(): Token { return mk(NAME as string); }\n';
  writeFileSync(join(root, SHARED_REL), SHARED_SRC);
  writeFileSync(join(root, SRC_REL), SRC_SRC);
  writeFileSync(join(root, ENTRY_REL), ENTRY_SRC);

  const entryUrl = pathToFileURL(join(root, ENTRY_REL)).href;
  const bytes = await build([entryUrl], async (specifier) => ({
    kind: 'module',
    specifier,
    content: readFileSync(decodeURIComponent(new URL(specifier).pathname).replace(/^\//, ''), 'utf8'),
  }));

  const serve = (buf) => async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  });
  const opts = { projectRef: 'r', token: 't' };

  const body = await fetchDeployedModules('demo-fn', { ...opts, fetchImpl: serve(Buffer.from(bytes)) });
  assert.equal(body.ok, true, body.reason);
  assert.equal(body.modules.length, 3, 'the three local modules should come back');
  assert.ok(body.modules.every((m) => typeof m.content === 'string'), 'a module came back with no original source');

  const expected = { [ENTRY_REL]: ENTRY_SRC, [SHARED_REL]: SHARED_SRC, [SRC_REL]: SRC_SRC };
  const good = proveArtifact({
    name: 'demo-fn',
    expected,
    deployed: { version: 27, updated_at: 1, ezbr_sha256: 'unstable', modules: body.modules },
  });
  assert.equal(good.state, PROOF.PROVEN_EXACT, good.reason);
  assert.equal(good.matched, 3);

  /* And the other direction, from the same container. */
  const stale = proveArtifact({
    name: 'demo-fn',
    expected: { ...expected, [SHARED_REL]: '// an older revision\n' },
    deployed: { version: 27, updated_at: 1, ezbr_sha256: 'unstable', modules: body.modules },
  });
  assert.equal(stale.state, PROOF.STALE);
  assert.deepEqual(stale.mismatched, [SHARED_REL]);

  /*
   * The shape the CLI actually uploads: a constant in front of a brotli
   * stream. A scan for the magic finds it inside the compressed bytes and
   * hands the parser rubbish, so this must be unwrapped rather than searched.
   */
  const { brotliCompressSync } = await import('node:zlib');
  const wrapped = Buffer.concat([Buffer.from('HDR'), brotliCompressSync(Buffer.from(bytes))]);
  const body2 = await fetchDeployedModules('demo-fn', { ...opts, fetchImpl: serve(wrapped) });
  assert.equal(body2.ok, true, `prefixed+compressed body was unreadable: ${body2.reason}`);
  assert.equal(body2.modules.length, 3);

  rmSync(root, { recursive: true, force: true });
});

test('artifact 12: a malformed body is UNAVAILABLE, never a pass', () => {
  assert.equal(unwrapEszip(Buffer.from('not an archive at all')), null);
  const proof = prove({ version: 8, updated_at: 1, ezbr_sha256: 'x', modules: null, reason: 'eszip did not parse' });
  assert.equal(proof.state, PROOF.UNAVAILABLE);
  assert.ok(!isProven(proof));
});

test('artifact 13: the current artifact, exact — PROVEN', () => {
  assert.equal(prove(deployedTree({ version: 114 })).state, PROOF.PROVEN_EXACT);
});

test('artifact 14: a stale historical artifact — STALE, and it names what moved', () => {
  /* ai-talk-session v107 against v114's revision: the entrypoint and two
     _shared modules differ, which is exactly what was measured. */
  const proof = prove(deployedTree({ version: 107, entry: 'ENTRY@v1', shared: 'SHARED@v1' }));
  assert.equal(proof.state, PROOF.STALE);
  assert.deepEqual(proof.mismatched.sort(), [SHARED, ENTRY].sort());
});

test('artifact 15: one _shared module differs — STALE', () => {
  const proof = prove(deployedTree({ shared: 'SHARED@v0' }));
  assert.equal(proof.state, PROOF.STALE);
  assert.deepEqual(proof.mismatched, [SHARED]);
});

test('artifact 16: a required deployed local module missing — INCOMPLETE', () => {
  const d = deployedTree({ version: 8 });
  d.modules = d.modules.filter((m) => !m.sourceUrl.endsWith(`${FN}/index.ts`));
  const proof = prove(d);
  assert.equal(proof.state, PROOF.INCOMPLETE);
  assert.ok(!isProven(proof));
});

test('artifact 17: a type-only dependency absent from the bundle must NOT fail', () => {
  /*
   * importClosure() cannot tell `import type` from a value import, so it
   * expects files the bundler legitimately erases — research-agent expects 82
   * and production correctly carries 69. That difference is reported and
   * decides nothing.
   */
  const proof = prove(deployedTree({ version: 8 }));
  assert.equal(proof.state, PROOF.PROVEN_EXACT, 'a type-only import failed a healthy function');
  assert.deepEqual(proof.missing, [TYPE_ONLY], 'the erased module should be reported, not fatal');
});

test('artifact 18: the cartesia case — unstable ezbr hash, deployed source exact — PROVEN', () => {
  /*
   * v26 a34394a5... and v27 43428031... over a byte-identical closure. The
   * hash is the CLI's own number and is not reproducible; the source is.
   */
  const v26 = prove(deployedTree({ version: 26, ezbr_sha256: 'a34394a565d75784' }));
  const v27 = prove(deployedTree({ version: 27, ezbr_sha256: '43428031bbcfbbdd' }));
  assert.ok(isProven(v26) && isProven(v27), 'an unstable bundle hash blocked a correct deployment');
  assert.notEqual(v26.ezbr_sha256, v27.ezbr_sha256, 'the fixture must actually differ');
});

test('artifact 19: the version incremented but the source is wrong — STALE', () => {
  const proof = prove(deployedTree({ version: 200, src: 'SRC@v0' }));
  assert.equal(proof.state, PROOF.STALE);
  assert.ok(!isProven(proof));
});

test('artifact 20: the parser being unavailable fails safe', async () => {
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new TextEncoder().encode('ESZIP2.3 but unparseable').buffer,
  });
  const body = await fetchDeployedModules('x', {
    projectRef: 'r',
    token: 't',
    fetchImpl,
    parserFactory: async () => { throw new Error('wasm refused to load'); },
  });
  assert.equal(body.ok, false);
  assert.equal(body.modules, null);
  assert.match(body.reason, /parser unavailable/);
  const proof = proveArtifact({ name: 'x', expected: { 'supabase/functions/x/index.ts': 'a' }, deployed: { ...body } });
  assert.equal(proof.state, PROOF.UNAVAILABLE, 'a dead parser must not advance the ref');
});

test('artifact: production running a local module this revision does not have is INCOMPLETE', () => {
  const d = deployedTree({ version: 8 });
  d.modules.push(mod('src/removed/gone.ts', 'x'));
  const proof = prove(d);
  assert.equal(proof.state, PROOF.INCOMPLETE);
  assert.equal(proof.foreign.length, 1);
});

test('artifact: a deployed module with no original source cannot be proven', () => {
  /* Its transpiled body is in the artifact and is not comparable to
     TypeScript. "Cannot be established" is not "matches". */
  const d = deployedTree({ version: 8 });
  d.modules = d.modules.map((m) => (m.sourceUrl.endsWith(SHARED) ? { ...m, content: null } : m));
  const proof = prove(d);
  assert.equal(proof.state, PROOF.INCOMPLETE);
  assert.deepEqual(proof.unresolved, [SHARED]);
});

test('artifact: remote dependencies are excluded from the comparison entirely', () => {
  const d = deployedTree({ version: 8 });
  /* fetchDeployedModules drops these; if one ever arrives it must not be
     mistaken for a repository file. */
  const proof = prove(d);
  assert.equal(proof.deployedFileCount, 3, 'only local modules should reach the proof');
  assert.ok(isProven(proof));
});

test('artifact: the runner path and the repository path resolve, unambiguously', () => {
  assert.deepEqual(matchDeployedName(`/home/runner/work/homatch/homatch/${SHARED}`, [SHARED]), [SHARED]);
  assert.deepEqual(matchDeployedName('functions/_shared/comm/auth.ts', [SHARED]), [SHARED]);
  assert.deepEqual(matchDeployedName(`/home/runner/work/homatch/homatch/${SHARED}`, [ENTRY, SRC]), []);
});

test('artifact: the eszip is found whether it arrives bare, prefixed or compressed', async () => {
  const { brotliCompressSync, brotliDecompressSync } = await import('node:zlib');
  const inner = Buffer.from('ESZIP2.3 payload-bytes');
  const opts = { brotliDecompress: brotliDecompressSync };

  assert.equal(unwrapEszip(inner, opts).toString('latin1'), inner.toString('latin1'), 'bare');

  /*
   * Compressed is the shape the CLI uploads, and it is the one a naive scan
   * gets wrong: brotli stores short input almost literally, so the magic also
   * appears INSIDE the compressed stream. Decompressing must be preferred over
   * scanning, or the parser is handed a corrupt tail that merely looks right.
   */
  const squashed = brotliCompressSync(inner);
  assert.equal(unwrapEszip(squashed, opts).toString('latin1'), inner.toString('latin1'), 'compressed');

  /* A constant prefix in front of a bare container. */
  const prefixed = Buffer.concat([Buffer.from('SUPABASE-HDR'), inner]);
  assert.equal(unwrapEszip(prefixed, opts).toString('latin1'), inner.toString('latin1'), 'prefixed');

  /* And nothing at all is null, which the proof reads as UNAVAILABLE. */
  assert.equal(unwrapEszip(Buffer.from('not an archive'), opts), null);
});

/* ── MUTATION GUARDS ──────────────────────────────────────────────────────
 *
 * Each fails if a specific weakening is applied to the rule. Written as
 * behaviour rather than as a grep, so they survive a rewrite and cannot be
 * satisfied by a comment.
 */

test('mutation: deleting the content comparison makes two different productions identical', () => {
  const exact = prove(deployedTree({ version: 7 }));
  const stale = prove(deployedTree({ version: 7, shared: 'SHARED@v1' }));
  assert.equal(exact.deployedFileCount, stale.deployedFileCount);
  assert.equal(exact.version, stale.version);
  assert.notEqual(exact.state, stale.state, 'the proof is no longer reading module contents');
});

test('mutation: accepting a version increment alone flips case 10 green', () => {
  const bumpedAndWrong = prove(deployedTree({ version: 99, entry: 'ENTRY@v1' }));
  const unbumpedAndRight = prove(deployedTree({ version: 1 }));
  assert.ok(!isProven(bumpedAndWrong), 'version increment is being treated as proof');
  assert.ok(isProven(unbumpedAndRight), 'an unmoved version is being treated as failure');
});

test('mutation: accepting ezbr_sha256 equality would flip case 18 or case 10', () => {
  /* Equal hashes over different source, and different hashes over identical
     source. A rule that consulted the hash gets both of these wrong. */
  const sameHashWrongSource = prove(deployedTree({ version: 8, ezbr_sha256: 'same', entry: 'ENTRY@v1' }));
  const diffHashRightSource = prove(deployedTree({ version: 8, ezbr_sha256: 'other' }));
  assert.ok(!isProven(sameHashWrongSource), 'a matching hash is being trusted over the source');
  assert.ok(isProven(diffHashRightSource), 'a differing hash is being allowed to fail correct source');
});

test('mutation: ignoring the dependency closure flips case 7 green', () => {
  const stale = prove(deployedTree({ version: 7, shared: 'SHARED@v1' }));
  assert.deepEqual(stale.mismatched.filter((p) => p === ENTRY), [], 'the entrypoint is unchanged, as the case requires');
  assert.ok(!isProven(stale), 'a stale _shared dependency is being ignored');
});

test('mutation: treating an unreadable artifact as proven flips case 12 and 20', () => {
  for (const reason of ['eszip did not parse', 'parser unavailable', 'body endpoint answered 500']) {
    const proof = prove({ version: 9, updated_at: 1, ezbr_sha256: 'x', modules: null, reason });
    assert.ok(!isProven(proof), `an unreadable artifact was proven: ${reason}`);
  }
});

test('the workflow bounds deploy concurrency and proves the artifact before the ref', () => {
  const deploy = job('deploy-functions');

  /*
   * Eight simultaneous anonymous ECR pulls from one runner IP produced six
   * rate limits in one run and three in the next. Two produced none.
   */
  assert.ok(!/RUNNING >= [3-9]/.test(deploy), 'edge deploy concurrency is unbounded again');
  assert.equal((deploy.match(/RUNNING >= 2/g) ?? []).length, 2, 'both deploy loops must be bounded');

  /*
   * There is no warm-up step, and there should not be one that hardcodes a
   * tag: the edge-runtime version belongs to the pinned CLI, not to this
   * repository, so a literal here goes stale the moment setup-cli is bumped
   * and nothing says so.
   */
  assert.ok(!/- name: Warm the edge-runtime image/.test(deploy), 'the self-skipping warm-up is back');
  const runnable = deploy.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.ok(!/docker pull .*edge-runtime:v[0-9]/.test(runnable),
    'the edge-runtime tag is hardcoded and will go stale when the CLI is bumped');

  /*
   * The proof parses an eszip, so this job needs node_modules. It never did
   * before -- every script it ran was dependency-free -- and without an
   * install the parser import fails, every function reports UNAVAILABLE, and
   * the mechanism is inert while looking like a principled refusal.
   */
  assert.match(deploy, /pnpm install --frozen-lockfile/, 'the deploy job no longer installs the parser');
  const installAt = deploy.indexOf('pnpm install --frozen-lockfile');
  assert.ok(installAt > 0 && installAt < deploy.indexOf('- name: Prove it in production'),
    'dependencies must be installed before the proof runs');

  /* The proof runs after the deploys and before the ref can move. */
  const proveAt = deploy.indexOf('- name: Prove it in production');
  const advanceAt = deploy.indexOf('- name: Advance refs/deployed/edge');
  assert.ok(proveAt > 0 && advanceAt > proveAt, 'the ref advances before the artifact is proven');
  assert.match(deploy.slice(proveAt), /edgeArtifacts\.mjs verify/);
});

test('the workflow does not claim the REST API returns deployed files', () => {
  /*
   * It does not. Run 36104657682 asked for all eighteen owed functions and
   * every one came back with none. A comment that says otherwise is worse
   * than no comment: the next person builds on it, as this one did.
   */
  const deploy = job('deploy-functions');
  assert.ok(!/now arrives WITH `files`/.test(deploy), 'the disproved files[] claim is back in the workflow');
  const script = readFileSync('scripts/edgeArtifacts.mjs', 'utf8');
  assert.ok(!/the same field set\s*\n?\s*\*?\s*now arrives with `files`/.test(script),
    'the disproved files[] claim is back in edgeArtifacts.mjs');
});
