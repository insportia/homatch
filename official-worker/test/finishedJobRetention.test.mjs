// The Verify orchestrator kept every job it ever ran in memory (capacity audit
// 2026-10-18). Terminal jobs are now dropped after the window in which
// research-agent can still ask for them; live jobs never are.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { shouldEvictFinishedJob, FINISHED_JOB_RETENTION_MS } = await import('../.tstest-build/orchestrator/ResearchContext.js');

const NOW = Date.parse('2026-10-18T12:00:00Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

test('retention matches research-agent DRIVE_MAX_AGE_MS (6 h)', () => {
  assert.equal(FINISHED_JOB_RETENTION_MS, 6 * 60 * 60 * 1000);
  const ra = readFileSync(new URL('../../supabase/functions/research-agent/index.ts', import.meta.url), 'utf8');
  assert.match(ra, /DRIVE_MAX_AGE_MS\s*=\s*6\s*\*\s*60\s*\*\s*60\s*\*\s*1000/);
});

test('terminal jobs older than the window are evicted', () => {
  for (const status of ['COMPLETE', 'FAILED', 'CANCELLED']) {
    assert.equal(shouldEvictFinishedJob({ status, updatedAt: ago(FINISHED_JOB_RETENTION_MS + 1) }, NOW), true, status);
  }
});

test('terminal jobs inside the window are kept', () => {
  assert.equal(shouldEvictFinishedJob({ status: 'COMPLETE', updatedAt: ago(FINISHED_JOB_RETENTION_MS - 1) }, NOW), false);
});

test('live jobs are never evicted, however old', () => {
  for (const status of ['RUNNING', 'WAITING_HUMAN', 'QUEUED']) {
    assert.equal(shouldEvictFinishedJob({ status, updatedAt: ago(10 * FINISHED_JOB_RETENTION_MS) }, NOW), false, status);
  }
});

test('an unparsable timestamp keeps the job', () => {
  assert.equal(shouldEvictFinishedJob({ status: 'COMPLETE', updatedAt: 'nope' }, NOW), false);
});

test('the orchestrator sweep calls the eviction and skips jobs holding a slot, session or browser', () => {
  const src = readFileSync(new URL('../src/orchestrator/ResearchOrchestrator.ts', import.meta.url), 'utf8');
  assert.match(src, /await this\.sweepStalledJobs\(\);\s*this\.evictFinishedJobs\(\);/);
  assert.match(src, /if \(this\.active\.has\(id\) \|\| this\.sessions\.has\(id\) \|\| this\.jobBrowsers\.has\(id\)\) continue;/);
});
