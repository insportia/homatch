// One source's human verification never holds — or fails — the whole research.
// Source-level guard on research-agent: an unattended WAITING_HUMAN is released
// through the SAME skip path the customer's Skip button uses, before the
// six-hour reaper could ever fail the job and discard the other sources.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../../../supabase/functions/research-agent/index.ts', import.meta.url), 'utf8');

test('the Skip button and the driver share one skip implementation', () => {
  assert.match(src, /async function skipHumanWait\(sb: any, j: any, unattended = false\)/);
  assert.match(src, /action === 'skip' && j\.status === 'WAITING_HUMAN'\) \{\s*j = await skipHumanWait\(sb, j\);/);
});

test('the driver releases unattended verifications before stepping live jobs', () => {
  const drive = src.slice(src.indexOf('async function driveLiveJobs'));
  assert.ok(drive.indexOf('await releaseUnattendedHumanWaits(sb)') > -1);
  assert.ok(drive.indexOf('await releaseUnattendedHumanWaits(sb)') < drive.indexOf("in('status', DRIVE_LIVE_STATUSES)"));
});

test('the release window is bounded and far shorter than the job reaper', () => {
  const wait = Number(/const HUMAN_WAIT_MAX_MS = (\d+) \* 60 \* 1000/.exec(src)?.[1]);
  const reap = Number(/const DRIVE_MAX_AGE_MS = (\d+) \* 60 \* 60 \* 1000/.exec(src)?.[1]);
  assert.ok(wait > 0 && wait <= 30, `human wait ${wait} min`);
  assert.ok(wait * 60 * 1000 < reap * 60 * 60 * 1000);
});

test('an unattended skip is recorded internally and never reaches the customer', () => {
  assert.match(src, /_unattendedVerificationSkips: \[/);
  assert.match(src, /delete r\._unattendedVerificationSkips;/);
});
