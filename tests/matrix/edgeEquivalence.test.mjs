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
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  compareSources, evaluate, evaluateAll, expectedSources, locate, normalise,
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

/* ── 11. The wiring, not just the rules ──────────────────────────────────*/

test('11: the verify CLI itself runs end to end', () => {
  /*
   * Every rule above passed while the CLI that uses them was broken: the
   * call site still handed `expectedSources` an import-closure function where
   * a root directory belonged, and run #678 died on
   * ERR_INVALID_ARG_TYPE after doing all five downloads.
   *
   * Pure-function tests cannot see that. This one runs the actual command the
   * workflow runs, against a real function in this repository, with a
   * "download" built from the repository itself -- so an equivalent artifact
   * must pass and a single changed byte must fail.
   */
  const dir = mkdtempSync(join(tmpdir(), 'verify-cli-'));
  try {
    const fn = 'anon-session';
    const expected = expectedSources(fn);
    const paths = Object.keys(expected);
    assert.ok(paths.length > 0, `${fn} has no runtime closure to test with`);

    // Lay the files out the way a download does: under the function's dir.
    const plant = (root, mutate) => {
      for (const p of paths) {
        const full = join(root, p);
        mkdirSync(dirname(full), { recursive: true });
        writeFileSync(full, mutate && p === paths[0] ? `${expected[p]}// drift\n` : expected[p]);
      }
    };
    const dl = join(dir, 'deployed');
    plant(join(dl, fn), false);

    const pre = join(dir, 'pre.json');
    const post = join(dir, 'post.json');
    writeFileSync(pre, JSON.stringify({ [fn]: { version: 16, updated_at: 1 } }));
    writeFileSync(post, JSON.stringify({ [fn]: { version: 16, updated_at: 1 } }));

    const verify = (extra = []) => {
      const r = spawnSync(process.execPath,
        ['scripts/edgeArtifacts.mjs', 'verify', pre, post, '--since', '2', '--downloads', dl, ...extra],
        { encoding: 'utf8' });
      return { code: r.status, out: `${r.stdout}${r.stderr}` };
    };

    const ok = verify();
    assert.equal(ok.code, 0, `an equivalent artifact was rejected:\n${ok.out}`);
    assert.match(ok.out, /ALREADY_CURRENT/);

    // One changed byte in one file, and the whole thing must fail.
    rmSync(dl, { recursive: true, force: true });
    plant(join(dl, fn), true);
    const bad = verify();
    assert.equal(bad.code, 1, `drift in the deployed artifact was accepted:\n${bad.out}`);
    assert.match(bad.out, /UNPROVEN/);

    // And an empty download is UNVERIFIABLE rather than quietly fine.
    rmSync(dl, { recursive: true, force: true });
    mkdirSync(join(dl, fn), { recursive: true });
    const empty = verify();
    assert.equal(empty.code, 1);
    assert.match(empty.out, /UNVERIFIABLE/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
