// Verify's budget gate and cancel path (capacity audit 2026-10-18).
//
// * An ERROR from verify_budget_gate used to be folded into 'NONE' (= "this
//   job has no budget"), so the chargeable stage ran without the check. It is
//   now 'ERROR': the stage is not started this time and the next poll / drive
//   tick asks again. Nothing is paused, charged or released by an ERROR.
// * Cancel now stops a running Developer Ads Actor the way pause always did,
//   but only under the advance lease, and never writes result_json.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ra = readFileSync(new URL('../../../supabase/functions/research-agent/index.ts', import.meta.url), 'utf8');
const slice = (from, to) => ra.slice(ra.indexOf(from), ra.indexOf(to, ra.indexOf(from)));

test('a gate error is ERROR, never NONE', () => {
  const gate = slice('async function budgetGate(', '/** True when the stage must not start now');
  assert.match(gate, /Promise<'GO' \| 'AWAIT' \| 'LIMIT' \| 'NONE' \| 'ERROR'>/);
  assert.match(gate, /if \(error\) \{[\s\S]*?return 'ERROR';\s*\}/);
  assert.match(gate, /catch \(e\) \{[\s\S]*?return 'ERROR';\s*\}/);
  // NONE remains the gate's own answer for an unbudgeted job
  assert.match(gate, /return d === 'GO' \|\| d === 'AWAIT' \|\| d === 'LIMIT' \? d : 'NONE';/);
});

test('holdForBudget defers on ERROR without pausing or touching billing', () => {
  const hold = slice('async function holdForBudget(', "const p = j.result_json || {};");
  assert.match(hold, /if \(decision === 'ERROR'\) return true;/);
  assert.ok(hold.indexOf("decision === 'ERROR'") < hold.indexOf("decision !== 'AWAIT'"));
  assert.doesNotMatch(hold, /closeBilling|PAUSED/);
});

test('the paid Developer Ads Actor never starts without an answer from the gate', () => {
  const ads = slice('async function advanceDeveloperAds(', 'Exactly one paid run per job');
  assert.match(ads, /const gate = await budgetGate\(sb, j\.id, 'DEVELOPER_ADS'\);\s*if \(gate === 'ERROR'\) return true;/);
  assert.ok(ads.indexOf("gate === 'ERROR'") < ads.indexOf('apifyStartRun') || !ads.includes('apifyStartRun'));
});

test('pause and cancel stop a running Actor through the same helper; cancel only under the lease', () => {
  assert.match(ra, /async function stopRunningDeveloperAds\(sb: any, j: any, p: any\): Promise<boolean> \{\s*const ads = p\?\._developerAds;\s*if \(!\(ads\?\.state === 'RUNNING' && ads\.runId\)\) return false;/);
  const pause = slice('async function applyPause(', 'p._pause = pause;');
  assert.match(pause, /await stopRunningDeveloperAds\(sb, j, p\);/);
  const under = slice('async function stopDeveloperAdsUnderLease(', 'async function stopRunningDeveloperAds(');
  assert.match(under, /research_job_advance_acquire/);
  assert.match(under, /if \(error \|\| !data\) return;/);
  assert.match(under, /stopRunningDeveloperAds\(sb, j, \{ \.\.\.j\.result_json \}\)/);
  assert.match(under, /finally \{\s*if \(token\) \{\s*try \{\s*await sb\.rpc\('research_job_advance_release'/);
  const cancel = slice("if (action === 'cancel')", "await closeBilling(sb, id, 'STOPPED');");
  assert.match(cancel, /if \(j\.result_json\?\._developerAds\?\.state === 'RUNNING'\) await stopDeveloperAdsUnderLease\(sb, j\);/);
  assert.ok(cancel.indexOf('stopDeveloperAdsUnderLease') < cancel.indexOf("status: 'CANCELLED'"));
});

/* ── Recovery: a deferred job is never stranded, and never charged for an outage ── */
import { settlementOutcome } from '../pauseResume.ts';

test('a deferred stage writes nothing, so the job stays first in line for the next drive tick', () => {
  const hold = slice('async function holdForBudget(', "const p = j.result_json || {};");
  const errorBranch = hold.slice(hold.indexOf("decision === 'ERROR'"), hold.indexOf("decision !== 'AWAIT'"));
  assert.doesNotMatch(errorBranch, /update\(|rpc\(/);
  const drive = slice('async function driveLiveJobs(', 'async function retireAbandonedJobs(');
  assert.match(drive, /\.in\('status', DRIVE_LIVE_STATUSES\)/);
  assert.match(drive, /\.order\('updated_at', \{ ascending: true \}\)/);
  assert.match(drive, /await retireAbandonedJobs\(sb\);/);
  assert.match(drive, /await settleVerifyBudgets\(sb\);/);
});

test('past the driver window it is retired FAILED with its evidence untouched, and its budget is released in full', () => {
  const retire = slice('async function retireAbandonedJobs(', 'catch (e)');
  assert.match(retire, /\.lt\('created_at', cutoff\)/);
  assert.match(retire, /status: 'FAILED'/);
  assert.doesNotMatch(retire, /result_json|evidence_bundle/);
  assert.equal(settlementOutcome({ status: 'FAILED' }, { maxSynthesisAttempts: 4, synthesisGraceMs: 7_200_000 }), 'SYSTEM_FAILED');
  const sql = readFileSync(new URL('../../../supabase/migrations/20261026100000_verify_credit_budget.sql', import.meta.url), 'utf8');
  assert.match(sql, /when p_outcome = 'SYSTEM_FAILED' then 'RELEASED'/);
});

test('cancel prices the stopped Actor exactly like pause: its cost_events row is part of the job cost', () => {
  const sql = readFileSync(new URL('../../../supabase/migrations/20261026100000_verify_credit_budget.sql', import.meta.url), 'utf8');
  const cost = sql.slice(sql.indexOf('create or replace function public.verify_job_cost('), sql.indexOf('$$;', sql.indexOf('create or replace function public.verify_job_cost(')));
  assert.match(cost, /from public\.cost_events ce\s+where ce\.job_id = p_job_id and ce\.provider::text <> 'OPENAI'/);
  assert.match(ra, /operation_type: 'DEVELOPER_ADS_VERIFY'/);
  const record = slice('async function recordDeveloperAdsCost(', 'catch (e)');
  assert.match(record, /if \(p\.costRecorded\) return;/);
  assert.match(record, /job_id: job\.id/);
});
