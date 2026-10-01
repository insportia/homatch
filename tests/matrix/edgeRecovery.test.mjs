/*
 * DEPLOY #869 — an owed edge function production did not take.
 *
 * meta-webhooks was owed because src/lib/metaAds/strategy.ts (in its closure,
 * not in its directory) changed. The CLI uploaded it and exited 0; production
 * stayed on v13 with the old strategy.ts. The exact proof said STALE and held
 * refs/deployed/edge — correct — but recovery waited for an unrelated deploy.
 *
 * These tests pin the fix: the owed set follows the closure, the proof is the
 * only verdict, a STALE owed function gets exactly ONE serial redeploy through
 * the list that attempted it, and a second STALE fails closed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { affectedFunctions } from '../../scripts/deploy-scope.mjs';
import { proveArtifact, expectedClosure, closureDigest, PROOF } from '../../scripts/edgeArtifacts.mjs';
import { planRecovery, proveWithRecovery, readAttempted, MAX_RECOVERY_ATTEMPTS } from '../../scripts/release/edgeRecovery.mjs';

const ROOT = process.cwd();
const DEPLOY = readFileSync(join(ROOT, '.github/workflows/deploy.yml'), 'utf8').replace(/\r\n/g, '\n');

/* A repository shaped like the incident: two functions share a library
   module outside supabase/functions/, a third does not. */
function world(strategy = 'export const s = 1;\n') {
  const dir = mkdtempSync(join(tmpdir(), 'edge-869-'));
  const put = (p, body) => { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), body); };
  put('src/lib/metaAds/strategy.ts', strategy);
  put('src/lib/metaAds/errors.ts', "import { s } from './strategy.ts';\nexport const e = s;\n");
  put('supabase/functions/_shared/metaAds.ts', "export * from '../../../src/lib/metaAds/errors.ts';\n");
  put('supabase/functions/meta-webhooks/index.ts', "import { e } from '../_shared/metaAds.ts';\nexport default e;\n");
  put('supabase/functions/meta-ads-api/index.ts', "import { s } from '../../../src/lib/metaAds/strategy.ts';\nexport default s;\n");
  put('supabase/functions/push-send/index.ts', 'export default 0;\n');
  return { dir, put };
}

/* What production runs: the closure as it was, module by module. */
const deployedFrom = (closure) => ({
  version: 13,
  modules: Object.entries(closure).map(([p, content]) => ({ specifier: `file:///homatch/${p}`, content })),
});

test('1. entry file unchanged + imported dependency changed → the function is owed', () => {
  const { dir } = world();
  assert.deepEqual(affectedFunctions(['src/lib/metaAds/strategy.ts'], dir).sort(), ['meta-ads-api', 'meta-webhooks']);
  // The entry file is in neither diff: ownership comes from the closure.
  assert.ok(expectedClosure('meta-webhooks', dir)['src/lib/metaAds/strategy.ts'] !== undefined);
});

test('8. a shared dependency owes every function that reaches it — and only those', () => {
  const { dir } = world();
  const owed = affectedFunctions(['src/lib/metaAds/errors.ts'], dir);
  assert.deepEqual(owed, ['meta-webhooks']);
  assert.deepEqual(affectedFunctions(['supabase/functions/_shared/metaAds.ts'], dir), ['meta-webhooks']);
  assert.deepEqual(affectedFunctions(['src/lib/metaAds/strategy.ts'], dir).sort(), ['meta-ads-api', 'meta-webhooks']);
});

test('2. provider success with production unchanged → the proof says STALE, and the digests disagree', () => {
  const before = world('export const s = 1;\n');
  const old = expectedClosure('meta-webhooks', before.dir);
  before.put('src/lib/metaAds/strategy.ts', 'export const s = 2;\n'); // the PR
  const desired = expectedClosure('meta-webhooks', before.dir);
  const proof = proveArtifact({ name: 'meta-webhooks', expected: desired, deployed: deployedFrom(old) });
  assert.equal(proof.state, PROOF.STALE);
  assert.deepEqual(proof.mismatched, ['src/lib/metaAds/strategy.ts']);
  assert.notEqual(proof.deployedDigest, proof.desiredDeployedDigest);
  // Once production runs the desired closure, every number agrees.
  const ok = proveArtifact({ name: 'meta-webhooks', expected: desired, deployed: deployedFrom(desired) });
  assert.equal(ok.state, PROOF.PROVEN_EXACT);
  assert.equal(ok.deployedDigest, ok.desiredDigest);
  assert.equal(closureDigest(desired), ok.desiredDigest);
});

/* The recovery sequence with every effect recorded. */
function harness({ secondOk, deployOk = true }) {
  const calls = [];
  let active = 0;
  let maxActive = 0;
  return {
    calls,
    get maxActive() { return maxActive; },
    deploy: async (name, mode) => {
      active += 1; maxActive = Math.max(maxActive, active);
      calls.push(['deploy', name, mode]);
      await new Promise((r) => setTimeout(r, 2));
      active -= 1;
      return { ok: deployOk };
    },
    snapshot: async () => { calls.push(['snapshot']); },
    verify: async (pass) => {
      calls.push(['verify', pass]);
      return secondOk
        ? { ok: true, report: [{ name: 'meta-webhooks', state: 'PROVEN_EXACT', proven: true }] }
        : { ok: false, report: [{ name: 'meta-webhooks', state: 'STALE', proven: false }] };
    },
  };
}
const FIRST_869 = {
  ok: false,
  report: [
    { name: 'meta-ads-api', state: 'PROVEN_EXACT', proven: true },
    { name: 'meta-oauth', state: 'PROVEN_EXACT', proven: true },
    { name: 'meta-webhooks', state: 'STALE', proven: false },
  ],
};
const ATTEMPTED_869 = readAttempted('meta-ads-api nojwt\nmeta-oauth nojwt\nmeta-webhooks nojwt\n');

test('3 + 4. a STALE owed function gets exactly one redeploy, through its own list, then PROVEN_EXACT', async () => {
  const h = harness({ secondOk: true });
  const r = await proveWithRecovery({ first: FIRST_869, attempted: ATTEMPTED_869, ...h });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 1);
  assert.deepEqual(h.calls, [['deploy', 'meta-webhooks', 'nojwt'], ['snapshot'], ['verify', 2]]);
  assert.deepEqual(r.recovered, ['meta-webhooks']);
});

test('5 + 7. still STALE after the one attempt → fail closed, no second attempt', async () => {
  const h = harness({ secondOk: false });
  const r = await proveWithRecovery({ first: FIRST_869, attempted: ATTEMPTED_869, ...h });
  assert.equal(r.ok, false);
  assert.equal(r.attempts, MAX_RECOVERY_ATTEMPTS);
  assert.equal(MAX_RECOVERY_ATTEMPTS, 1);
  assert.equal(h.calls.filter((c) => c[0] === 'deploy').length, 1, 'one redeploy, never a loop');
  assert.equal(h.calls.filter((c) => c[0] === 'verify').length, 1);
});

test('6. proven and unrelated functions are never redeployed; recovery is serial', async () => {
  const first = {
    ok: false,
    report: [
      { name: 'a', state: 'STALE', proven: false }, { name: 'b', state: 'STALE', proven: false },
      { name: 'push-send', state: 'PROVEN_EXACT', proven: true },
    ],
  };
  const h = harness({ secondOk: true });
  await proveWithRecovery({ first, attempted: readAttempted('a jwt\nb nojwt\npush-send jwt'), ...h });
  assert.deepEqual(h.calls.filter((c) => c[0] === 'deploy'), [['deploy', 'a', 'jwt'], ['deploy', 'b', 'nojwt']]);
  assert.equal(h.maxActive, 1, 'no concurrent uploads during recovery');
});

test('9. the proof is mandatory: provider success never decides, and non-STALE failures are not "recovered"', async () => {
  // Deploy reports success, production still stale → failure.
  const h = harness({ secondOk: false, deployOk: true });
  assert.equal((await proveWithRecovery({ first: FIRST_869, attempted: ATTEMPTED_869, ...h })).ok, false);
  // A failed redeploy is still followed by the proof (which decides).
  const h2 = harness({ secondOk: true, deployOk: false });
  const r2 = await proveWithRecovery({ first: FIRST_869, attempted: ATTEMPTED_869, ...h2 });
  assert.equal(r2.ok, true, 'the second proof is the verdict, not the CLI exit code');
  assert.deepEqual(r2.failedDeploys, ['meta-webhooks']);
  // INCOMPLETE / UNAVAILABLE, or STALE never attempted: no production change at all.
  for (const [state, attempted] of [['INCOMPLETE', 'x nojwt'], ['UNAVAILABLE', 'x jwt'], ['STALE', '']]) {
    const h3 = harness({ secondOk: true });
    const r3 = await proveWithRecovery({ first: { ok: false, report: [{ name: 'x', state, proven: false }] }, attempted: readAttempted(attempted), ...h3 });
    assert.equal(r3.ok, false, state);
    assert.deepEqual(h3.calls, [], `${state}: nothing is redeployed`);
  }
  // A proof that passed is never "recovered".
  const h4 = harness({ secondOk: false });
  assert.equal((await proveWithRecovery({ first: { ok: true, report: [] }, attempted: new Map(), ...h4 })).ok, true);
  assert.deepEqual(h4.calls, []);
  assert.deepEqual(planRecovery([{ name: 'm', state: 'STALE', proven: false }], readAttempted('m unknown')).blocked.length, 1);
});

test('the workflow: first proof, at most one recovery, and the ref only after both', () => {
  const start = DEPLOY.indexOf('- name: Prove it in production');
  const advance = DEPLOY.indexOf('- name: Advance refs/deployed/edge');
  const prove = DEPLOY.slice(start, advance);
  const verifyAt = prove.indexOf('edgeArtifacts.mjs verify');
  const recoverAt = prove.indexOf('node scripts/release/edgeRecovery.mjs');
  assert.ok(verifyAt > 0 && recoverAt > verifyAt, 'recovery only after a first proof');
  assert.match(prove, /--report "\$RUNNER_TEMP\/proof-1\.json" --first-pass; then\n\s+exit 0\n\s+fi/);
  assert.equal(prove.split('edgeRecovery.mjs').length - 1, 1, 'one recovery invocation');
  assert.match(DEPLOY.slice(advance), /if: success\(\)/);
  // The recovery's second proof is the same verifier, not a weaker check.
  const src = readFileSync(join(ROOT, 'scripts/release/edgeRecovery.mjs'), 'utf8');
  assert.match(src, /'scripts\/edgeArtifacts\.mjs', 'verify'/);
  assert.doesNotMatch(src, /functions delete|while \(|for \(;;\)/);
});
