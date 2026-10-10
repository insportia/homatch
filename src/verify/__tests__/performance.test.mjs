// Verify end-to-end performance: Start → report READY from server timestamps,
// stage spans, queue wait, retries, critical path and bottleneck.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildVerifyPerformance, taskTimeline } from '../performance.ts';

const T = (hms) => `2026-10-10T${hms}Z`;

const job = {
  id: 'job-1',
  status: 'COMPLETE',
  created_at: T('10:00:00'),
  completed_at: T('10:11:45'),
  synthesis_state: 'READY',
  synthesis_at: T('10:12:52.300'),
};

const tasks = [
  { id: 'a', source: 'TAS_MAP', dedupe_key: 'TAS_MAP', state: 'SUCCEEDED', attempts: 1, created_at: T('10:00:41'), started_at: T('10:00:45'), finished_at: T('10:01:30'), result: { _exec: { startedAt: T('10:00:45'), finishedAt: T('10:01:30'), ms: 45000, attempt: 1 } } },
  { id: 'b', source: 'tas', dedupe_key: 'tas', state: 'SUCCEEDED', attempts: 1, created_at: T('10:00:41'), started_at: T('10:00:44'), finished_at: T('10:05:00'), exec: { startedAt: T('10:00:44'), finishedAt: T('10:05:00'), ms: 256000, attempt: 1 } },
  // MyGov: first attempt gave up on a CAPTCHA, the second succeeded.
  { id: 'c', source: 'mygov', dedupe_key: 'mygov', state: 'SUCCEEDED', attempts: 2, created_at: T('10:00:41'), started_at: T('10:00:46'), finished_at: T('10:06:05'), exec: { startedAt: T('10:03:30'), finishedAt: T('10:06:05'), ms: 155000, attempt: 2 } },
];

const resultJson = {
  _stageTimes: {
    identity: { startedAt: T('10:00:02'), finishedAt: T('10:00:40') },
    official_browser: { startedAt: T('10:00:41'), finishedAt: T('10:06:10'), outcome: 'COMPLETE', mode: 'QUEUE' },
    official_collection: { startedAt: T('10:06:12'), finishedAt: T('10:07:00') },
    public_research: { startedAt: T('10:07:05'), finishedAt: T('10:09:00') },
    market: { startedAt: T('10:09:03'), finishedAt: T('10:10:30') },
    synthesis: { startedAt: T('10:10:33'), finishedAt: T('10:11:40') },
  },
  browserOfficial: {
    results: [
      { source: 'tas', status: 'SEARCH_CONFIRMED', tasApi: { ledger: { incomplete: true }, timings: { search: 1200, detail: { ms: 8000 }, priorityCases: { ms: 90000, status: 'COMPLETE' }, attachmentDownloads: { startedAt: T('10:01:00'), endedAt: T('10:03:20') }, pdfText: 30000, olderCases: { ms: 40000, complete: false } } } },
      { source: 'mygov', status: 'SEARCH_CONFIRMED' },
    ],
  },
};

const timing = { startedAt: T('10:11:47'), modelStartedAt: T('10:11:50'), modelEndedAt: T('10:12:50'), modelMs: 60000, persistAt: T('10:12:52'), trigger: 'research' };
const captcha = [{ task_id: 'c', source: 'mygov', solve_ms: 25000, outcome: 'ACCEPTED' }, { task_id: 'c', source: 'mygov', solve_ms: 15000, outcome: 'NO_CHANGE' }];

test('Start → report READY, research and synthesis split, from server timestamps only', () => {
  const p = buildVerifyPerformance(job, tasks, resultJson, timing, { captcha });
  assert.equal(p.state, 'READY');
  assert.equal(p.startedAt, job.created_at);
  assert.equal(p.readyAt, job.synthesis_at);
  assert.equal(p.totalMs, 12 * 60_000 + 52_300);
  assert.equal(p.researchMs, 11 * 60_000 + 45_000);
  assert.equal(p.synthesisMs, 67_300);
  assert.equal(p.synthesisWaitMs, 2_000);
  assert.equal(p.synthesisBuildMs, 65_000);
  assert.equal(p.modelMs, 60_000);
  assert.equal(p.totalMs, p.researchMs + p.synthesisMs);
});

test('queue wait, worker execution and retries are separated from customer waiting time', () => {
  const p = buildVerifyPerformance(job, tasks, resultJson, timing, { captcha });
  assert.equal(p.queueWaitMs, 3_000, 'first task enqueued 10:00:41, first claim 10:00:44');
  assert.equal(p.firstWorkerActivityAt, T('10:00:44.000'));
  // Union of execution intervals: 10:00:44→10:05:00 and 10:03:30→10:06:05 → 10:00:44→10:06:05.
  assert.equal(p.workerMs, 5 * 60_000 + 21_000);
  assert.ok(p.workerMs < p.totalMs, 'machine time is not what the customer waited');
  assert.deepEqual(p.retries, { count: 1, ms: 164_000 });
  const mygov = p.stages.find((s) => s.key === 'task:mygov');
  assert.equal(mygov.attempts, 2);
  assert.equal(mygov.retryMs, 164_000, 'first claim 10:00:46 → final attempt 10:03:30');
  assert.equal(mygov.execMs, 155_000);
  assert.equal(mygov.queueMs, 5_000);
  assert.equal(mygov.captchaMs, 40_000);
  assert.equal(p.coverage.sources.mygov.attempts, 2);
});

test('stages cover the pipeline in order with hand-off gaps, and the bottleneck is the most specific culprit', () => {
  const p = buildVerifyPerformance(job, tasks, resultJson, timing, { captcha });
  const top = p.stages.filter((s) => s.kind === 'pipeline' || s.kind === 'synthesis').map((s) => s.key);
  assert.deepEqual(top, ['identity', 'official_browser', 'official_collection', 'public_research', 'market', 'synthesis', 'finalize', 'report_wait', 'report_build', 'report_persist']);
  assert.equal(p.stages.find((s) => s.key === 'official_browser').ms, 329_000);
  assert.equal(p.stages.find((s) => s.key === 'identity').gapBeforeMs, 2_000);
  assert.equal(p.stages.find((s) => s.key === 'finalize').ms, 5_000);
  assert.equal(p.stages.find((s) => s.key === 'report_persist').ms, 300);
  // Every millisecond of the wait is either a stage or a hand-off.
  const covered = p.stages.filter((s) => s.parent === null).reduce((n, s) => n + (s.ms ?? 0), 0);
  assert.equal(covered + p.handoffMs, p.totalMs);
  // Official sources ran in parallel; MyGov finished last, so it held the stage.
  assert.ok(p.criticalPath.indexOf('official_browser') < p.criticalPath.indexOf('task:mygov'));
  assert.equal(p.bottleneck, 'task:mygov');
});

test('TAS sub-steps come from tasApi.timings in any reasonable shape; newest-two coverage is reported', () => {
  const p = buildVerifyPerformance(job, tasks, resultJson, timing, {});
  const tas = p.stages.filter((s) => s.kind === 'tas');
  assert.deepEqual(tas.map((s) => s.key), ['tas.search', 'tas.detail', 'tas.priorityCases', 'tas.attachmentDownloads', 'tas.pdfText', 'tas.olderCases']);
  assert.ok(tas.every((s) => s.parent === 'task:tas'));
  assert.equal(tas.find((s) => s.key === 'tas.attachmentDownloads').ms, 140_000);
  assert.equal(tas.find((s) => s.key === 'tas.olderCases').status, 'PARTIAL');
  assert.equal(p.coverage.tasPriority, 'COMPLETE', 'an incomplete ledger (older cases deferred) does not override the newest-two result');
});

test('when TAS is the straggler the bottleneck descends into its slowest sub-step', () => {
  const slowTas = tasks.map((t) => (t.source === 'tas' ? { ...t, finished_at: T('10:06:08') } : t));
  const p = buildVerifyPerformance(job, slowTas, resultJson, timing, {});
  assert.equal(p.bottleneck, 'tas.attachmentDownloads');
});

test('a running job reports elapsed time from the server clock and no total', () => {
  const running = { id: 'job-2', status: 'RUNNING', created_at: T('10:00:00'), synthesis_state: 'NONE' };
  const p = buildVerifyPerformance(running, tasks.slice(0, 2).map((t) => ({ ...t, state: 'RUNNING', finished_at: null })), { _stageTimes: { identity: resultJson._stageTimes.identity } }, null, { now: T('10:03:00') });
  assert.equal(p.state, 'RUNNING');
  assert.equal(p.totalMs, null);
  assert.equal(p.elapsedMs, 180_000);
  assert.equal(p.readyAt, null);
});

test('research complete but the report not yet READY is not counted as ready', () => {
  const p = buildVerifyPerformance({ ...job, synthesis_state: 'PENDING', synthesis_at: T('10:11:46') }, tasks, resultJson, null, {});
  assert.equal(p.state, 'RESEARCH_COMPLETE');
  assert.equal(p.readyAt, null);
  assert.equal(p.totalMs, null);
  assert.equal(p.researchMs, 705_000);
});

test('legacy (in-worker) jobs and reports written before _timing still get a timeline', () => {
  const legacy = {
    _stageTimes: { official_browser: { startedAt: T('10:00:41'), runStartedAt: T('10:01:41'), finishedAt: T('10:06:10'), outcome: 'COMPLETE', mode: 'LEGACY' } },
    _tasExecution: { implementation: 'API_FIRST', durationMs: 200_000 },
    browserOfficial: { results: [{ source: 'tas', status: 'SEARCH_CONFIRMED' }, { source: 'mygov', status: 'SEARCH_CONFIRMED', captchaResolution: [{ latencyMs: 30_000 }] }] },
  };
  const p = buildVerifyPerformance(job, [], legacy, null, {});
  assert.equal(p.queueWaitMs, 60_000, 'admission wait in the worker');
  assert.equal(p.workerMs, 269_000);
  assert.equal(p.stages.find((s) => s.key === 'task:tas').ms, 200_000);
  assert.equal(p.stages.find((s) => s.key === 'task:mygov').captchaMs, 30_000);
  const report = p.stages.find((s) => s.key === 'report');
  assert.equal(report.ms, 67_300);
  assert.equal(p.totalMs, 772_300);
});

test('a reused (cached) task contributes no worker time and is labelled as reused', () => {
  const cached = [{ id: 'x', source: 'tas', dedupe_key: 'tas', state: 'SUCCEEDED', reused: 'CACHE', attempts: 0, created_at: T('10:00:41'), started_at: T('10:00:41'), finished_at: T('10:00:41'), result: { _exec: { startedAt: T('09:00:00'), ms: 300000 } } }];
  const p = buildVerifyPerformance(job, cached, {}, null, {});
  assert.equal(p.workerMs, null);
  assert.equal(p.stages.find((s) => s.key === 'task:tas').status, 'SUCCEEDED·CACHE');
});

test('garbage in never throws', () => {
  const p = buildVerifyPerformance(null, null, null, null);
  assert.equal(p.totalMs, null);
  assert.deepEqual(p.stages, []);
  assert.equal(p.bottleneck, null);
  assert.deepEqual(buildVerifyPerformance({ created_at: 'nope' }, [{ source: 'tas', started_at: 'x' }], { _stageTimes: 'x' }, { startedAt: 1 }).retries, { count: 0, ms: 0 });
});

test('taskTimeline keeps timing columns and the worker stamp only', () => {
  const [t] = taskTimeline([{ ...tasks[0], input: { secret: 1 }, result: { documents: [1, 2], _exec: tasks[0].result._exec } }]);
  assert.deepEqual(Object.keys(t).sort(), ['attempts', 'created_at', 'dedupe_key', 'exec', 'finished_at', 'id', 'reused', 'source', 'started_at', 'state']);
  assert.equal(t.exec.ms, 45000);
});

test('wiring: research-agent stamps and serves performance; synthesis _timing never reaches a customer', () => {
  const ra = readFileSync(new URL('../../../supabase/functions/research-agent/index.ts', import.meta.url), 'utf8');
  assert.match(ra, /buildVerifyPerformance\(/, 'admin diagnostics computes the performance view');
  assert.match(ra, /official_browser/, 'the official stage span is stamped');
  assert.match(ra, /taskTimeline\(/, 'the finished job keeps its task timeline');
  const vs = readFileSync(new URL('../../../supabase/functions/verify-synthesis/index.ts', import.meta.url), 'utf8');
  assert.match(vs, /_timing/, 'verify-synthesis records its timing');
  assert.match(vs, /_timing:\s*_droppedTiming/, 'forCustomer strips _timing like _usage');
});
