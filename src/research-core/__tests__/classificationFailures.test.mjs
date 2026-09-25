// A NETWORK TIMEOUT DISCARDED 300 SIGNALS AND NOBODY COULD TELL.
//
// The evidence gate reported 510 ERROR against 119 CLASSIFIED and asked
// whether that was acceptable. It is not, and it is also not one problem.
//
// The ERROR rows do not arrive the way individual content judgements would.
// Around 85% came in seven single minutes, each spanning dozens of unrelated
// sources — 111 errors across 31 sources in one minute, 83 across 57 in
// another. That is the signature of classify-signals-v2's chunk-level catch:
// one OpenAI call throws and every signal in the batch is written ERROR.
//
// And ERROR was terminal, because the selector read only PENDING. Nothing
// retried them and nothing could.
//
// These tests pin the fix, and pin the thing the fix must not become: a
// relabelling exercise. The 510 existing rows keep ERROR.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync('supabase/functions/classify-signals-v2/index.ts', 'utf8');
const CODE = SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const MIGRATION = readFileSync(
  'supabase/migrations/20260925190000_classification_failure_families.sql', 'utf8',
);

/* ── the defect ────────────────────────────────────────────────────────── */

test('a provider failure returns signals to PENDING rather than burying them', () => {
  /*
   * THE FIX, IN ONE ASSERTION. The catch used to write ERROR unconditionally.
   * A batch failure says nothing about the content — the model never saw it —
   * so the signal is owed another look.
   */
  const chunkCatch = CODE.slice(CODE.indexOf("catch(e){console.error('classification chunk'"));
  assert.match(chunkCatch, /classification_status:exhausted\?'ERROR':'PENDING'/);
  assert.match(chunkCatch, /BATCH_FAILED/);
});

test('the retry is bounded, so an unclassifiable signal stops costing money', () => {
  // Unbounded retry is the opposite failure: a signal nothing can classify
  // consumes budget forever.
  assert.match(CODE, /const MAX_ATTEMPTS=\d+;/);
  assert.match(CODE, /classification_attempts',MAX_ATTEMPTS/);
  assert.match(CODE, /exhausted=tried>=MAX_ATTEMPTS/);
  assert.match(CODE, /ATTEMPTS_EXHAUSTED/);
});

test('the attempt counter is actually read, not just written', () => {
  /*
   * The half that would silently defeat the whole thing: incrementing a
   * counter the selector never reads means every signal is attempt 1 forever
   * and a permanently broken signal retries without end.
   */
  assert.match(CODE, /select\(`id,original_text,language,platform,classification_attempts/);
  assert.match(CODE, /\.lt\('classification_attempts',MAX_ATTEMPTS\)/);
});

test('the three causes are recorded separately', () => {
  /*
   * One word for three different things is what made this invisible for a
   * month. The provider failing, the model declining to answer, and our own
   * write failing need different responses and now have different names.
   */
  /*
   * The kind is written as a literal for two of them and through a ternary
   * for the batch case -- exhausted ? ATTEMPTS_EXHAUSTED : BATCH_FAILED --
   * so the assertion looks for the value inside an error-kind assignment
   * rather than for one exact spelling of it.
   */
  const kindWrites = [...CODE.matchAll(/classification_error_kind:([^,}]+)/g)].map((m) => m[1]).join(' | ');
  for (const kind of ['BATCH_FAILED', 'MODEL_OMITTED', 'WRITE_FAILED', 'ATTEMPTS_EXHAUSTED']) {
    assert.ok(kindWrites.includes(kind), `${kind} is never recorded (writes: ${kindWrites})`);
  }
});

test('every error path records which attempt it was', () => {
  // Otherwise a MODEL_OMITTED signal sits at attempt 0 forever and is
  // reselected on every run.
  const writes = [...CODE.matchAll(/classification_status:'ERROR'[^}]*}/g)].map((m) => m[0]);
  assert.ok(writes.length >= 2, 'the error writes could not be found');
  for (const write of writes) {
    assert.match(write, /classification_attempts/, `an error write leaves the counter alone: ${write.slice(0, 80)}`);
  }
});

test('a retry is reported, so a healthy run and a thrashing one look different', () => {
  assert.match(CODE, /retried/);
  assert.match(CODE, /errors,retried,totalCostUsd/);
});

/* ── and it must not become a relabelling exercise ─────────────────────── */

test('nothing backfills or rewrites the existing ERROR rows', () => {
  /*
   * The one change that would make this worse. Improving a metric by renaming
   * its failures is explicitly not the job, so the migration adds columns and
   * touches no existing value: the 510 keep ERROR with a NULL kind, which
   * reads as "recorded before the pipeline separated causes".
   */
  /*
   * An UPDATE ... SET, not any mention of the column. The families function
   * READS `where classification_status = 'ERROR'`, and a guard that cannot
   * tell a read from a write would fail on the very query that reports the
   * problem.
   */
  assert.equal(/update\s+public\.raw_signals/i.test(MIGRATION), false,
    'the migration rewrites existing signal rows');
  assert.equal(/set\s+classification_(status|error_kind)\s*=/i.test(MIGRATION), false,
    'the migration reassigns a classification value');
  assert.match(MIGRATION, /add column if not exists classification_error_kind/);
});

test('the legacy rows are named as legacy rather than explained away', () => {
  // LEGACY_UNSEPARATED is an honest label for 256 rows whose cause was never
  // recorded. Inventing a family for them would be the fabrication.
  assert.match(MIGRATION, /LEGACY_UNSEPARATED/);
  assert.match(MIGRATION, /predates this column/);
});

test('the source-selection half is named as a different defect', () => {
  /*
   * 139 of the 510 came from r/Riyadh and r/opensooqsd, and 83 from
   * r/CheatProctoredTests and r/GeorgiaRealEstateExam — the US state's
   * licensing exam, registered by a sweep for "Georgia real estate". Those
   * are posts about passing an AWS certification correctly producing no
   * property intent. Calling them classifier failures would be blaming the
   * wrong component and fixing nothing.
   */
  assert.match(MIGRATION, /SOURCE_WRONG_MARKET/);
  assert.match(MIGRATION, /SOURCE_WRONG_SUBJECT/);
  assert.match(SRC, /SOURCE SELECTION defect/);
});

test('the families function reports counts and no rate', () => {
  /*
   * "66% error" was the misleading number that started this, because it
   * divided three unrelated things by one total. The function returns counts
   * per family and lets a person do the arithmetic they can defend.
   */
  const fn = MIGRATION.slice(MIGRATION.indexOf('create or replace function public.classification_failure_families'));
  const signature = fn.slice(0, fn.indexOf(')'));
  assert.equal(/rate|percent|ratio/i.test(signature), false, 'the failure report computes a rate');
  assert.match(fn, /count\(distinct rs\.source_id\)/,
    'the report cannot show that one failure spanned many sources');
});
