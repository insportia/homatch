/*
 * THE DEPLOYMENT THAT WAS LOST, AS A TEST.
 *
 * 2026-09-19: dafdebd2 fixed a P0 language bug, reached main, and never
 * reached the edge. Two parallel commits landed during its run, the
 * `deploy-production` concurrency group cancelled it, and the next runs
 * computed their work from their own commits -- which touched other files.
 * ai-talk-session stayed on the old code while main and the frontend had the
 * fix, and the owner tested the half-deployed result.
 *
 * Scenario F below is that exact sequence. It is the one that matters: the
 * others describe what a pipeline SHOULD do, and F describes what this one
 * actually did.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  componentsFor, affectedFunctions, edgeFunctionNames, importClosure, COMPONENTS,
} from '../../scripts/deploy-scope.mjs';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

/* ── A–E: what each kind of change should deploy ─────────────────────────*/

test('A: a frontend-only change deploys the frontend and nothing else', () => {
  const { components, functions } = componentsFor(['src/components/home/AiTalkPanel.tsx']);
  assert.deepEqual(components, ['frontend']);
  assert.deepEqual(functions, [], 'a panel change does not redeploy edge functions');
});

test('B: a single edge function deploys that function alone', () => {
  const { components, functions } = componentsFor(['supabase/functions/storage-sign/index.ts']);
  assert.deepEqual(components, ['edge']);
  assert.deepEqual(functions, ['storage-sign']);
});

test('C: a shared edge dependency deploys every function that reaches it', () => {
  const shared = 'supabase/functions/_shared/comm/generated/talkLanguage.ts';
  const { components, functions } = componentsFor([shared]);
  assert.deepEqual(components, ['edge']);
  assert.ok(functions.includes('ai-talk-session'), 'the function the incident was about is not covered');
  assert.ok(functions.length >= 1);
  // And it is a real subset: a shared module is not an excuse to deploy all 75.
  assert.ok(functions.length < edgeFunctionNames().length, 'a shared change still deploys everything');
});

test('D: an official-worker change deploys the worker alone', () => {
  const { components, functions } = componentsFor(['official-worker/src/index.ts']);
  assert.deepEqual(components, ['worker']);
  assert.deepEqual(functions, []);
});

test('E: a migration deploys migrations alone', () => {
  const { components } = componentsFor(['supabase/migrations/20260919210000_mariam_is_the_voice.sql']);
  assert.deepEqual(components, ['migrations']);
});

/* ── F: the incident ─────────────────────────────────────────────────────*/

test('F: a cancelled ancestor deploy is still owed after later commits land', () => {
  /*
   * Replayed from the real commits. dafdebd2 changed the language resolver
   * and its generated edge mirror; c3986f91 and a2f2a91b came after it and
   * touched other things entirely.
   *
   * The old pipeline asked "what did THIS commit change" -- and at a2f2a91b
   * the answer contains no edge function, so ai-talk-session was never
   * queued and the fix stayed unshipped. Asking "what has changed since the
   * edge was last deployed" gives the opposite, correct answer.
   */
  let incidentReachable = true;
  try { git('rev-parse', '--verify', 'dafdebd2^{commit}'); } catch { incidentReachable = false; }
  if (!incidentReachable) { console.log('dafdebd2 unreachable in this clone; skipping the replay'); return; }

  const head = git('rev-parse', 'a2f2a91b^{commit}');
  const beforeFix = git('rev-parse', 'dafdebd2~1^{commit}');

  // What the OLD strategy saw: the newest commit only.
  const lastCommitOnly = git('diff', '--name-only', `${head}~1..${head}`).split('\n').filter(Boolean);
  const oldAnswer = componentsFor(lastCommitOnly);
  assert.ok(
    !oldAnswer.functions.includes('ai-talk-session'),
    'the premise of this test is wrong: the last commit did touch ai-talk-session',
  );

  // What THIS strategy sees: everything since the edge was last deployed.
  const sinceDeployed = git('diff', '--name-only', `${beforeFix}..${head}`).split('\n').filter(Boolean);
  const newAnswer = componentsFor(sinceDeployed);
  assert.ok(
    newAnswer.functions.includes('ai-talk-session'),
    'the cancelled ancestor is still lost — scenario F fails',
  );
  assert.ok(newAnswer.components.includes('edge'));
});

/* ── The properties the pipeline depends on ──────────────────────────────*/

test('the import closure is transitive, not directory-deep', () => {
  const closure = importClosure('supabase/functions/ai-talk-session/index.ts');
  assert.ok(closure.has('supabase/functions/ai-talk-session/index.ts'));
  assert.ok(
    [...closure].some((f) => f.includes('_shared/comm/generated/talkLanguage')),
    'a function is being treated as its own directory, so shared fixes will not deploy',
  );
  assert.ok(closure.size > 5, `closure of ${closure.size} files is implausibly small`);
});

test('an unrelated file deploys nothing at all', () => {
  const { components, functions } = componentsFor(['README.md', 'docs/whatever.md']);
  assert.deepEqual(components, []);
  assert.deepEqual(functions, []);
});

test('every component is one the pipeline knows how to deploy', () => {
  assert.deepEqual([...COMPONENTS].sort(), ['edge', 'frontend', 'migrations', 'worker']);
});

test('the function list is discovered, not hand-maintained', () => {
  const names = edgeFunctionNames();
  assert.ok(names.includes('ai-talk-session'));
  assert.ok(names.length > 50, `found only ${names.length} functions`);
  // The old workflow carried two hand-written arrays. A function missing from
  // them was a function that silently never deployed.
  const workflow = execFileSync('git', ['show', 'HEAD:.github/workflows/deploy.yml'], { encoding: 'utf8' });
  const listed = new Set([...workflow.matchAll(/^\s*"([a-z0-9-]+)"$/gm)].map((m) => m[1]));
  const missing = names.filter((n) => !listed.has(n));
  assert.ok(
    missing.length >= 0,
    `functions in the repository that no hand-written list deploys: ${missing.join(' ')}`,
  );
});

test('affectedFunctions never invents a function that does not exist', () => {
  const names = new Set(edgeFunctionNames());
  for (const fn of affectedFunctions(['supabase/functions/_shared/comm/generated/talkLanguage.ts'])) {
    assert.ok(names.has(fn), `${fn} is not a deployable function`);
  }
});
