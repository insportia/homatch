import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decideStalledJob } from '../.tstest-build/orchestrator/ResearchContext.js';

/*
 * STALLED-JOB WATCHDOG.
 *
 * Mandate: "There must be a watchdog so jobs cannot remain stuck forever."
 *
 * Before this, ResearchOrchestrator's only sweep covered `sessions` — jobs
 * already parked in WAITING_HUMAN. A job stuck in RUNNING (a government site
 * that accepts the connection and then never answers, a Playwright call with
 * no timeout of its own) had NO bound at all: it stayed RUNNING for the life
 * of the container and held its Chromium process and throwaway profile
 * directory open the whole time.
 *
 * The decision is a pure function so it can be tested for real;
 * ResearchOrchestrator itself cannot be imported here because it pulls in
 * every Playwright workflow (see tsconfig.test.json's exclude list), so the
 * EFFECTS are asserted against its source below.
 */

const here = fileURLToPath(new URL('.', import.meta.url));
const orchestratorSource = readFileSync(`${here}../src/orchestrator/ResearchOrchestrator.ts`, 'utf8');

const STALL = 20 * 60 * 1000;
const NOW = Date.parse('2026-09-08T18:00:00.000Z');
const ago = (ms) => new Date(NOW - ms).toISOString();

const job = (over = {}) => ({ status: 'RUNNING', updatedAt: ago(STALL + 60_000), results: [], ...over });

/* ------------------------------------------------------------------ *
 * What the watchdog must catch.                                       *
 * ------------------------------------------------------------------ */

test('a RUNNING job with no progress past the bound is finalized', () => {
  const d = decideStalledJob(job(), NOW, STALL);
  assert.equal(d.finalize, true);
  assert.equal(d.stalledForMs, STALL + 60_000);
});

test('evidence already gathered survives the stall — the customer still gets a report', () => {
  const d = decideStalledJob(job({ results: [{ source: 'TAS_MAP', resultConfirmed: true }] }), NOW, STALL);
  assert.equal(d.finalize, true);
  assert.equal(d.status, 'COMPLETE', 'a stall must never discard sources that already succeeded');
});

test('a stall with no result at all is FAILED — technical, never a property finding', () => {
  const d = decideStalledJob(job({ results: [] }), NOW, STALL);
  assert.equal(d.finalize, true);
  assert.equal(d.status, 'FAILED');
});

/* ------------------------------------------------------------------ *
 * What the watchdog must NOT touch.                                   *
 * ------------------------------------------------------------------ */

test('a job that is still progressing is never killed', () => {
  // `updatedAt` advances after every completed step, so a long but healthy
  // job — many slow sources — is measured on PROGRESS, not total duration.
  const d = decideStalledJob(job({ updatedAt: ago(STALL - 1000) }), NOW, STALL);
  assert.equal(d.finalize, false);
  assert.equal(d.reason, 'still_progressing');
});

test('exactly at the bound is not yet a stall (the comparison is strict)', () => {
  assert.equal(decideStalledJob(job({ updatedAt: ago(STALL) }), NOW, STALL).finalize, false);
  assert.equal(decideStalledJob(job({ updatedAt: ago(STALL + 1) }), NOW, STALL).finalize, true);
});

test('WAITING_HUMAN is never treated as a stall — a human who has not answered is not a hang', () => {
  const d = decideStalledJob(job({ status: 'WAITING_HUMAN', updatedAt: ago(10 * STALL) }), NOW, STALL);
  assert.equal(d.finalize, false);
  assert.equal(d.reason, 'not_running');
});

test('terminal and queued jobs are left alone', () => {
  for (const status of ['COMPLETE', 'FAILED', 'QUEUED']) {
    assert.equal(decideStalledJob(job({ status }), NOW, STALL).finalize, false, `${status} must not be finalized`);
  }
});

test('an already-abandoned job is never finalized twice', () => {
  const d = decideStalledJob(job({ _abandoned: true }), NOW, STALL);
  assert.equal(d.finalize, false);
  assert.equal(d.reason, 'already_abandoned');
});

test('an unparsable timestamp is ignored rather than treated as infinitely stalled', () => {
  const d = decideStalledJob(job({ updatedAt: 'not-a-date' }), NOW, STALL);
  assert.equal(d.finalize, false);
  assert.equal(d.reason, 'unparsable_timestamp');
});

/* ------------------------------------------------------------------ *
 * The effects, in the orchestrator.                                   *
 * ------------------------------------------------------------------ */

test('the watchdog actually runs on the sweep interval', () => {
  assert.match(orchestratorSource, /await this\.sweepStalledJobs\(\)/, 'the sweep must be wired into the interval');
  assert.match(orchestratorSource, /const JOB_STALL_MS = /);
});

test('a stalled job releases its Chromium and its throwaway profile', () => {
  const sweep = orchestratorSource.slice(
    orchestratorSource.indexOf('async sweepStalledJobs('),
    orchestratorSource.indexOf('getJob(')
  );
  assert.match(sweep, /closeJobBrowser\(this\.jobBrowsers\.get\(id\) \?\? null, 'job_watchdog_stalled'\)/);
  assert.match(sweep, /this\.jobBrowsers\.delete\(id\)/);
  assert.match(sweep, /this\.sessions\.delete\(id\)/);
  // The stall must be visible in the job document, not look like a normal end.
  assert.match(sweep, /job\.watchdogFinalized = true/);
  // And it must never invent property meaning.
  assert.equal(/propertyRisk|verdict|resultConfirmed = /.test(sweep), false);
});

test('the in-flight step can never resurrect a job the watchdog finalized', () => {
  // The race: the watchdog closes the browser, which makes the awaited
  // Playwright call reject; run() would otherwise carry on and overwrite the
  // finalized state with its own COMPLETE/FAILED.
  const sweep = orchestratorSource.slice(orchestratorSource.indexOf('async sweepStalledJobs('));
  const marked = sweep.indexOf('job._abandoned = true');
  const closed = sweep.indexOf('closeJobBrowser(this.jobBrowsers.get(id)');
  assert.equal(marked !== -1 && closed !== -1 && marked < closed, true, 'the job must be marked abandoned BEFORE its browser is torn down');

  const run = orchestratorSource.slice(orchestratorSource.indexOf('private async run('));
  assert.match(run, /if \(job\._abandoned\) return;/, 'run() must bail out when abandoned');
  assert.match(run, /\/\/ flight[\s\S]{0,120}if \(job\._abandoned\) return;|if \(job\._abandoned\) return;[\s\S]{0,400}job\.results = job\.results\.filter/);
  assert.match(run, /if \(job\._abandoned\) \{[\s\S]{0,400}return;/, 'the catch block must not resurrect an abandoned job');
});
