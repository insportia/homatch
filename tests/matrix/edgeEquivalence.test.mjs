/*
 * PROVING A DEPLOY THAT DID NOT NEED TO HAPPEN.
 *
 * Run #676 failed with nothing wrong. Five functions were owed, one had a
 * changed bundle and uploaded, and four were already byte-identical to the
 * revision being deployed -- so `supabase functions deploy` printed "No
 * change found", skipped the upload and exited 0, and the guard, which knew
 * only "the version must advance", called all four unproven.
 *
 * The rule was too narrow in one direction and too trusting in the other: it
 * could not pass a function that needed no upload, and it could not fail a
 * function whose version moved for the wrong reason. Both are fixed by asking
 * production what it is actually running and comparing that to the revision.
 *
 * These ten are the cases that rule has to get right. Six of them would pass
 * under a rule that just believed the CLI, and six would pass under a rule
 * that just watched the version counter; only the artifact answers all ten.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  compareSources, evaluate, evaluateAll, locate, normalise,
} from '../../scripts/edgeEquivalence.mjs';

const WORKFLOW = readFileSync('.github/workflows/deploy.yml', 'utf8');

/* A function's expected sources, and what production stores for it. */
const SRC = {
  'supabase/functions/comm-agent/index.ts': 'export const a = 1;\n',
  'supabase/functions/_shared/comm/llm.ts': 'export const llm = 2;\n',
};
/** Production names files with an unstable prefix; both shapes are real. */
const PROD = {
  'homatch/supabase/functions/comm-agent/index.ts': SRC['supabase/functions/comm-agent/index.ts'],
  'homatch/supabase/functions/_shared/comm/llm.ts': SRC['supabase/functions/_shared/comm/llm.ts'],
};
const equiv = (expected, deployed) => compareSources(expected, deployed);
const v = (version, updated_at = 1_000) => ({ version, updated_at });

/* ── 1 ───────────────────────────────────────────────────────────────────*/

test('1: changed source, artifact updates, equivalent -> PASS as UPLOADED', () => {
  const r = evaluate({
    name: 'ai-talk-session',
    pre: v(107, 1_000), post: v(108, 3_000),
    equivalence: equiv(SRC, PROD), sinceMs: 2_000,
  });
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'UPLOADED');
  assert.equal(r.from, 107); assert.equal(r.to, 108);
});

/* ── 2 ───────────────────────────────────────────────────────────────────*/

test('2: changed source, CLI exits 0, artifact unchanged and not equivalent -> FAIL', () => {
  // The failure this whole mechanism exists for, now caught by content
  // rather than by a timestamp that a dedupe would have excused.
  const stale = { ...PROD, 'homatch/supabase/functions/comm-agent/index.ts': 'export const a = 0; // last week\n' };
  const r = evaluate({
    name: 'comm-agent', pre: v(31), post: v(31), equivalence: equiv(SRC, stale), sinceMs: 2_000,
  });
  assert.equal(r.ok, false);
  assert.equal(r.mode, 'STALE');
  assert.match(r.reason, /nothing was uploaded and production is not running this revision/);
});

/* ── 3 ───────────────────────────────────────────────────────────────────*/

test('3: "No change found", artifact equivalent -> PASS as ALREADY_CURRENT', () => {
  // Run #676's comm-agent. No upload was due; production is already correct.
  const r = evaluate({
    name: 'comm-agent', pre: v(31, 1_000), post: v(31, 1_000), equivalence: equiv(SRC, PROD), sinceMs: 2_000,
  });
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'ALREADY_CURRENT');
  // And it did NOT need a version bump to say so.
  assert.equal(r.from, r.to);
});

/* ── 4 ───────────────────────────────────────────────────────────────────*/

test('4: "No change found" but the artifact is NOT equivalent -> FAIL', () => {
  // "No change found" is the CLI reporting on its own work. It is never the
  // authority; if it were, this case would pass and production would be
  // running something nobody asked for.
  const missing = { 'homatch/supabase/functions/comm-agent/index.ts': SRC['supabase/functions/comm-agent/index.ts'] };
  const r = evaluate({ name: 'comm-agent', pre: v(31), post: v(31), equivalence: equiv(SRC, missing), sinceMs: 1 });
  assert.equal(r.ok, false);
  assert.match(r.reason, /_shared\/comm\/llm\.ts \(not present in the deployed artifact\)/);
});

/* ── 5 ───────────────────────────────────────────────────────────────────*/

test('5: version unchanged, artifact equivalent -> PASS (no manufactured bump)', () => {
  const r = evaluate({ name: 'investment-consultant', pre: v(2), post: v(2), equivalence: equiv(SRC, PROD), sinceMs: 9_999 });
  assert.equal(r.ok, true, 'a correct artifact was failed for not moving an integer');
  assert.equal(r.mode, 'ALREADY_CURRENT');
  // sinceMs is deliberately in the future here: with no upload there is no
  // upload to date, so the timestamp rule must not apply.
});

/* ── 6 ───────────────────────────────────────────────────────────────────*/

test('6: version advanced but the artifact is NOT equivalent -> FAIL', () => {
  // Something was uploaded. It was not this revision.
  const wrong = { ...PROD, 'homatch/supabase/functions/_shared/comm/llm.ts': 'export const llm = 999;\n' };
  const r = evaluate({ name: 'comm-agent', pre: v(31, 1_000), post: v(32, 3_000), equivalence: equiv(SRC, wrong), sinceMs: 2_000 });
  assert.equal(r.ok, false);
  assert.equal(r.mode, 'UPLOADED_WRONG_SOURCE');
  assert.match(r.reason, /version advanced 31 -> 32 but the deployed source is not this revision/);
});

/* ── 7 ───────────────────────────────────────────────────────────────────*/

test('7: a mixed set of one real upload and four deduped equivalents -> PASS', () => {
  // Run #676, decided correctly.
  const rows = evaluateAll([
    { name: 'ai-talk-session', pre: v(107, 1_000), post: v(108, 3_000), equivalence: equiv(SRC, PROD), sinceMs: 2_000 },
    { name: 'comm-agent', pre: v(31), post: v(31), equivalence: equiv(SRC, PROD), sinceMs: 2_000 },
    { name: 'comm-campaign-launch', pre: v(29), post: v(29), equivalence: equiv(SRC, PROD), sinceMs: 2_000 },
    { name: 'comm-dispatch-worker', pre: v(22), post: v(22), equivalence: equiv(SRC, PROD), sinceMs: 2_000 },
    { name: 'investment-consultant', pre: v(2), post: v(2), equivalence: equiv(SRC, PROD), sinceMs: 2_000 },
  ]);
  assert.equal(rows.ok, true);
  assert.deepEqual(rows.rows.map((r) => r.mode),
    ['UPLOADED', 'ALREADY_CURRENT', 'ALREADY_CURRENT', 'ALREADY_CURRENT', 'ALREADY_CURRENT']);
});

/* ── 8 ───────────────────────────────────────────────────────────────────*/

test('8: one non-equivalent function fails the WHOLE edge verification', () => {
  const wrong = { ...PROD, 'homatch/supabase/functions/comm-agent/index.ts': 'export const a = 7;\n' };
  const rows = evaluateAll([
    { name: 'ai-talk-session', pre: v(107, 1_000), post: v(108, 3_000), equivalence: equiv(SRC, PROD), sinceMs: 2_000 },
    { name: 'comm-agent', pre: v(31), post: v(31), equivalence: equiv(SRC, wrong), sinceMs: 2_000 },
  ]);
  assert.equal(rows.ok, false, 'four good functions excused a bad one');
  assert.deepEqual(rows.rows.filter((r) => !r.ok).map((r) => r.name), ['comm-agent']);
});

/* ── 9 ───────────────────────────────────────────────────────────────────*/

test('9: the ref cannot advance until every function is equivalent', () => {
  // Structural: the advance step runs after the proof step, in the same job,
  // under success(). An unproven function fails that step, so success() is
  // false and the ref is never written.
  const start = WORKFLOW.indexOf('\n  deploy-functions:\n');
  const job = WORKFLOW.slice(start);
  const proveAt = job.indexOf('- name: Prove it in production');
  const advanceAt = job.indexOf('- name: Advance refs/deployed/edge');
  assert.ok(proveAt > 0 && advanceAt > proveAt, 'the ref advances before the artifact is proven');
  assert.match(job.slice(advanceAt), /if: success\(\)/);
  // And equivalence is what that step actually runs.
  assert.match(job.slice(proveAt, advanceAt), /functions download/);
  assert.match(job.slice(proveAt, advanceAt), /edgeArtifacts\.mjs verify/);
  // An unverifiable artifact is a failure, never a pass.
  const r = evaluate({ name: 'comm-agent', pre: v(31), post: v(31), equivalence: { checked: false, reason: 'download failed' } });
  assert.equal(r.ok, false);
  assert.equal(r.mode, 'UNVERIFIABLE');
});

/* ── 10 ──────────────────────────────────────────────────────────────────*/

test('10: path normalisation cannot hide a real source difference', () => {
  /*
   * The prefix really is unstable -- comm-agent stores
   * `homatch/supabase/functions/...` and ai-talk-session stores
   * `homatch/functions/...` -- so matching has to tolerate it. The danger is
   * tolerating too much and letting some other file answer for this one.
   */
  assert.equal(
    locate('supabase/functions/ai-talk-session/index.ts', ['homatch/functions/ai-talk-session/index.ts']),
    'homatch/functions/ai-talk-session/index.ts', 'the real ai-talk-session prefix stopped matching',
  );
  // A same-named file in another function must NOT answer for this one.
  assert.equal(locate('supabase/functions/_shared/comm/llm.ts', ['homatch/supabase/functions/_shared/other/llm.ts']), null);
  // An ambiguous match is refused rather than guessed.
  assert.equal(locate('supabase/functions/comm-agent/index.ts', [
    'a/supabase/functions/comm-agent/index.ts', 'b/supabase/functions/comm-agent/index.ts',
  ]), null);
  // A partial path component must not match: `.../xcomm-agent/index.ts` is a
  // different directory, and endsWith() alone would have accepted it.
  assert.equal(locate('supabase/functions/comm-agent/index.ts', ['homatch/supabase/functions/xcomm-agent/index.ts']), null);

  // Line endings are forgiven; nothing else is.
  assert.equal(normalise('a\r\nb'), 'a\nb');
  assert.equal(compareSources({ 'supabase/functions/f/index.ts': 'a\r\nb' },
    { 'homatch/supabase/functions/f/index.ts': 'a\nb' }).equivalent, true);
  assert.equal(compareSources({ 'supabase/functions/f/index.ts': 'a b' },
    { 'homatch/supabase/functions/f/index.ts': 'a  b' }).equivalent, false, 'whitespace differences were forgiven');

  // An empty expectation is never "equivalent": nothing checked is not proof.
  assert.equal(compareSources({}, PROD).equivalent, false);

  // The digest is deterministic and changes when content does.
  const a = compareSources(SRC, PROD).digest;
  const b = compareSources(SRC, PROD).digest;
  const c = compareSources(SRC, { ...PROD, 'homatch/supabase/functions/comm-agent/index.ts': 'export const a = 2;\n' }).digest;
  assert.equal(a, b);
  assert.notEqual(a, c);
});
