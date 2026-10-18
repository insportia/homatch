// One advancer per Verify job (capacity audit 2026-10-18). Every open tab polls
// research-agent `status` and every overlapping 30 s drive tick may step the
// same job; research_job_advance_acquire serialises them. Until 2026-10-18 an
// error from that RPC fell through to stepping UNGUARDED, so two invocations
// could run the same (paid) stage. It now skips the step; the next poll or tick
// retries.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const ra = readFileSync(new URL('../../../supabase/functions/research-agent/index.ts', import.meta.url), 'utf8');
const fn = ra.slice(ra.indexOf('async function advanceExclusive('), ra.indexOf('async function advance(sb'));

test('a lease error never steps the job unguarded', () => {
  assert.doesNotMatch(fn, /proceed unguarded/);
  assert.match(fn, /if \(!error && data === null\) return false;/);
  assert.match(fn, /if \(error\) throw error;/);
  // the catch returns before any stepping happens
  const katch = fn.slice(fn.indexOf('} catch (e) {'), fn.indexOf('try {', fn.indexOf('} catch (e) {')));
  assert.match(katch, /SKIPPED_NO_LEASE/);
  assert.match(katch, /return false;/);
  assert.ok(fn.indexOf('return false;\n  }') < fn.indexOf('await advance(sb, k, m, j, l);'));
});

test('the lease is released after the step, whatever happened', () => {
  assert.match(fn, /finally \{\s*if \(token\) \{\s*try \{\s*await sb\.rpc\('research_job_advance_release'/);
});

test('a status poll re-reads the row only when it stepped the job itself', () => {
  assert.match(ra, /if \(await advanceExclusive\(sb, key, model, j, lang\)\) \{\s*const r = await ownedBy\(sb\.from\('research_jobs'\)\.select\('\*'\)\.eq\('id', id\)\)\.maybeSingle\(\);\s*j = r\.data \|\| j;\s*\}/);
});

test('the drive loop still stops on a job it could not lease', () => {
  assert.match(ra, /if \(!\(await advanceExclusive\(sb, key, model, j, jobLanguage\(j\)\)\)\) return;/);
});
