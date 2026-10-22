// Verify background job state machine (VERIFY_V2_AUDIT F1).
//
// Production evidence: background job 0015e291… went COMPLETED at 12:10:46
// with current_stage SYNTHESIS_WAITING while its research job 61c1c38c…'s
// report only became READY at 12:12:34. Every recent completed Verify had the
// same COMPLETED/SYNTHESIS_WAITING pair.
//
// The SQL half (terminal stage written once, concurrent finishes) is in
// tests/sql/verify_background_job_terminal_stage.sql + run-verify-background-job.sh.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  verifyMirror, VERIFY_MAX_SYNTHESIS_ATTEMPTS, VERIFY_SYNTHESIS_SETTLE_GRACE_MS,
  VERIFY_REPORT_WRITING_STAGE,
} from '../verifyMirror.ts';
import { settlementOutcome } from '../../verify/pauseResume.ts';
import { presentableStage, presentableProgress } from '../jobState.ts';
import { phaseFor } from '../../verify/progress.ts';

const read = (p) => readFileSync(new URL(`../../../${p}`, import.meta.url), 'utf8');

const COMPLETED_AT = '2026-10-22T12:10:41.985Z';
const NOW = Date.parse('2026-10-22T12:10:46.000Z');
const job = (over = {}) => ({
  status: 'COMPLETE', stage: 'COMPLETE', cancelled_at: null,
  synthesis_state: 'PENDING', synthesis_attempts: 1, completed_at: COMPLETED_AT, ...over,
});

test('the reference job at 12:10:46: research COMPLETE, report PENDING → still PROCESSING, writing the report', () => {
  const m = verifyMirror(job(), NOW);
  assert.equal(m.state, 'PROCESSING');
  assert.equal(m.stage, VERIFY_REPORT_WRITING_STAGE);
  assert.ok(m.progress < 100, 'never 100 before the report exists');
  assert.equal(m.errorKey, null);
});

test('report not started yet (NONE) or a failed attempt with attempts left → still PROCESSING', () => {
  assert.equal(verifyMirror(job({ synthesis_state: 'NONE', synthesis_attempts: 0 }), NOW).state, 'PROCESSING');
  assert.equal(verifyMirror(job({ synthesis_state: 'FAILED', synthesis_attempts: 2 }), NOW).state, 'PROCESSING');
});

test('success: report READY → COMPLETED with the terminal stage COMPLETE at 100', () => {
  assert.deepEqual(verifyMirror(job({ synthesis_state: 'READY' }), Date.parse('2026-10-22T12:12:40Z')),
    { state: 'COMPLETED', stage: 'COMPLETE', progress: 100, errorKey: null });
});

test('synthesis failed after the last attempt → FAILED (billing: SYSTEM_FAILED, nothing charged)', () => {
  const m = verifyMirror(job({ synthesis_state: 'FAILED', synthesis_attempts: VERIFY_MAX_SYNTHESIS_ATTEMPTS }), NOW);
  assert.deepEqual(m, { state: 'FAILED', stage: 'FAILED', progress: null, errorKey: 'verify_result_failed' });
});

test('a report still missing past the settle grace → FAILED, exactly when billing releases', () => {
  const late = Date.parse(COMPLETED_AT) + VERIFY_SYNTHESIS_SETTLE_GRACE_MS + 1;
  assert.equal(verifyMirror(job({ synthesis_state: 'PENDING' }), late).state, 'FAILED');
  assert.equal(verifyMirror(job({ synthesis_state: 'PENDING' }), late - 2).state, 'PROCESSING');
});

test('the terminal decision is billing\'s: COMPLETED ⇔ COMPLETE, FAILED ⇔ SYSTEM_FAILED, PROCESSING ⇔ wait', () => {
  const opts = (now) => ({ maxSynthesisAttempts: VERIFY_MAX_SYNTHESIS_ATTEMPTS, synthesisGraceMs: VERIFY_SYNTHESIS_SETTLE_GRACE_MS, now });
  const expected = { COMPLETE: 'COMPLETED', SYSTEM_FAILED: 'FAILED', null: 'PROCESSING' };
  for (const synthesis_state of ['NONE', 'PENDING', 'READY', 'FAILED', null]) {
    for (const synthesis_attempts of [0, 1, 3, 4, 5]) {
      for (const now of [NOW, Date.parse(COMPLETED_AT) + VERIFY_SYNTHESIS_SETTLE_GRACE_MS + 60_000]) {
        const r = job({ synthesis_state, synthesis_attempts });
        const billing = settlementOutcome(r, opts(now));
        assert.equal(verifyMirror(r, now).state, expected[String(billing)], JSON.stringify({ r, now, billing }));
      }
    }
  }
});

test('running, failed and cancelled research map as before, with terminal stages for the terminal ones', () => {
  const running = verifyMirror({ status: 'RUNNING', stage: 'MARKET_WAITING' }, NOW);
  assert.equal(running.state, 'PROCESSING');
  assert.equal(running.stage, 'MARKET_WAITING');
  assert.equal(verifyMirror({ status: 'CREATED', stage: 'QUEUED' }, NOW).state, 'QUEUED');
  assert.deepEqual(verifyMirror({ status: 'FAILED', stage: 'FAILED' }, NOW),
    { state: 'FAILED', stage: 'FAILED', progress: null, errorKey: 'verify_result_failed' });
  assert.equal(verifyMirror({ status: 'RUNNING', stage: 'SYNTHESIS_WAITING', cancelled_at: '2026-10-22T12:00:00Z' }, NOW).state, 'CANCELLED');
  assert.equal(verifyMirror({ status: 'CANCELLED', stage: 'X' }, NOW).stage, 'CANCELLED');
});

test('the attempt budget and grace are the ones research-agent settles billing with', () => {
  const ra = read('supabase/functions/research-agent/index.ts');
  assert.match(ra, new RegExp(`const MAX_SYNTHESIS_ATTEMPTS = ${VERIFY_MAX_SYNTHESIS_ATTEMPTS};`));
  assert.equal(VERIFY_SYNTHESIS_SETTLE_GRACE_MS, 2 * 60 * 60 * 1000);
  assert.match(ra, /const SYNTHESIS_SETTLE_GRACE_MS = 2 \* 60 \* 60 \* 1000;/);
});

test('jobs-worker mirrors Verify through verifyMirror and reads the columns it needs', () => {
  const w = read('supabase/functions/jobs-worker/index.ts');
  assert.match(w, /import \{ verifyMirror \} from '\.\.\/\.\.\/\.\.\/src\/jobs\/verifyMirror\.ts';/);
  assert.match(w, /\.select\('id,status,stage,cancelled_at,synthesis_state,synthesis_attempts,completed_at'\)/);
  assert.match(w, /const m = verifyMirror\(r\);/);
  assert.doesNotMatch(w, /function verifyState\(/, 'one mapping, not two');
});

test('the migration writes the terminal stage in the same UPDATE, once, for VERIFY only', () => {
  const sql = read('supabase/migrations/20261120090000_verify_background_job_terminal_stage.sql');
  const body = sql.slice(sql.indexOf('create or replace function public.background_job_finish('));
  // Same signature as 20260911211715.
  assert.match(body, /p_job_id uuid,\s+p_state text,\s+p_result_ref text default null,\s+p_error_code text default null,\s+p_user_safe_error text default null,\s+p_last_error text default null\s+\)\s+returns jsonb/);
  // Locked, and terminal jobs return before any write: retries and races are no-ops.
  const lock = body.indexOf('for update');
  const already = body.indexOf("'alreadyTerminal', true");
  const update = body.indexOf('update public.background_jobs');
  assert.ok(lock > 0 && already > lock && update > already, 'lock → alreadyTerminal → update');
  assert.match(body, /v_stage := case when v_job\.product_type = 'VERIFY' then/);
  assert.match(body, /current_stage = coalesce\(v_stage, current_stage\)/);
  assert.match(body, /when stages @> jsonb_build_array\(jsonb_build_object\('stage', v_stage\)\) then stages/);
  assert.equal((body.match(/update public\.background_jobs/g) ?? []).length, 1, 'one UPDATE');
  assert.match(sql, /revoke execute on function public\.background_job_finish\(uuid, text, text, text, text, text\) from public, anon, authenticated;/);
  assert.doesNotMatch(sql, /update public\.background_jobs\s+set[\s\S]*where state/i, 'no backfill of historical rows');
});

test('readers: a terminal job never presents a stale working stage; REPORT_WRITING reads as "building the report"', () => {
  assert.equal(presentableStage('COMPLETED', 'SYNTHESIS_WAITING'), null);
  assert.equal(presentableStage('FAILED', 'MARKET_WAITING'), null);
  assert.equal(presentableStage('COMPLETED', 'COMPLETE'), 'COMPLETE');
  assert.equal(presentableStage('PROCESSING', 'REPORT_WRITING'), 'REPORT_WRITING');
  assert.equal(presentableStage('PROCESSING', ''), null);
  assert.equal(presentableProgress('COMPLETED', 88), 100);
  assert.equal(presentableProgress('PROCESSING', 95), 95);
  assert.equal(phaseFor('REPORT_WRITING'), 'SYNTHESIS');
  assert.match(read('src/services/backgroundJobs.ts'), /currentStage: presentableStage\(state, o\.currentStage as string \| null \| undefined\)/);
});
