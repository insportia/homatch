// Admission control: a burst of Verify jobs never opens more browsers than
// WORKER_MAX_ACTIVE_JOBS; the rest wait in arrival order and start as slots free.
import test from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

process.env.WORKER_MAX_ACTIVE_JOBS = '2';
const config = JSON.parse(await readFile(new URL('../tsconfig.test.json', import.meta.url), 'utf8'));
for (const file of config.exclude.filter((f) => f.endsWith('.ts') && !f.endsWith('index.ts'))) {
  const input = new URL('../' + file, import.meta.url);
  const output = new URL('../.tstest-build/' + file.replace(/^src\//, '').replace(/\.ts$/, '.js'), import.meta.url);
  await mkdir(new URL('.', output), { recursive: true });
  await writeFile(output, ts.transpileModule(await readFile(input, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText);
}
const { ResearchOrchestrator } = await import('../.tstest-build/orchestrator/ResearchOrchestrator.js');

test('a burst of jobs runs at most WORKER_MAX_ACTIVE_JOBS at once; the rest queue in order', () => {
  const o = new ResearchOrchestrator();
  const started = [];
  o.run = async (job) => { started.push(job.id); job.status = 'RUNNING'; };
  const jobs = [1, 2, 3, 4].map((i) => o.start(`code-${i}`, 'cadastral'));
  assert.equal(started.length, 2, 'only two browsers open');
  assert.equal(jobs[2].queuePosition, 1);
  assert.equal(jobs[3].queuePosition, 2);
  assert.deepEqual(o.admission(), { maxActive: 2, active: 2, queued: 2 });

  jobs[0].status = 'COMPLETE';
  o.pumpQueue();
  assert.deepEqual(started, [jobs[0].id, jobs[1].id, jobs[2].id], 'the first in line starts when a slot frees');
  assert.equal(jobs[2].queuePosition, undefined);
  assert.ok(jobs[2].runStartedAt);
  assert.equal(jobs[3].queuePosition, 1);

  // A job waiting for a human keeps its slot (its browser stays open).
  jobs[1].status = 'WAITING_HUMAN';
  o.pumpQueue();
  assert.equal(started.length, 3);
});

test('cancel: a queued job leaves the line, a running one frees its slot and starts nothing more', async () => {
  const o = new ResearchOrchestrator();
  const started = [];
  o.run = async (job) => { started.push(job.id); job.status = 'RUNNING'; };
  const jobs = [1, 2, 3].map((i) => o.start(`cancel-${i}`, 'cadastral'));
  jobs[0].results = [{ source: 'TAS_MAP', status: 'SEARCH_CONFIRMED' }];

  const queued = await o.cancel(jobs[2].id);
  assert.equal(queued.code, 'CANCELLED');
  assert.deepEqual(o.admission(), { maxActive: 2, active: 2, queued: 0 });

  const running = await o.cancel(jobs[0].id);
  assert.equal(running.results, 1, 'collected results are kept');
  assert.equal(jobs[0]._abandoned, true, 'the run loop stops at its next check');
  assert.equal(jobs[0].status, 'CANCELLED');
  assert.equal(o.admission().active, 1);
  o.pumpQueue();
  assert.deepEqual(started, [jobs[0].id, jobs[1].id], 'the cancelled queued job never starts');

  assert.equal((await o.cancel(jobs[0].id)).code, 'ALREADY_FINISHED', 'idempotent');
  assert.equal((await o.cancel('missing')).code, 'NOT_FOUND');
});
