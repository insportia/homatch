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
