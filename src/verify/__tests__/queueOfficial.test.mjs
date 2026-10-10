// QUEUE mode, research-agent side: the job's verify_tasks rows are read back
// as the exact worker view every downstream stage already consumes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  officialTaskPlan, followUpTasks, queueWorkerView, singleTaskView, entityTask, taskResult, publicTaskError, MAX_QUEUE_ENTITY_COMPANIES,
} from '../queueOfficial.ts';

const CODE = '01.18.06.019.055.03.01.503';
let n = 0;
const row = (o) => ({ id: `t${++n}`, created_at: `2026-10-10T10:00:${String(n).padStart(2, '0')}Z`, attempts: 1, input: { cadastral: CODE }, ...o });

test('a cadastral job plans TAS_MAP, TAS and MyGov with scope keys; property jobs stay legacy', () => {
  const plan = officialTaskPlan({ mode: 'cadastral', query: CODE }, { tasImplementation: { active: 'API_FIRST', fallback: 'LEGACY' }, captchaPolicy: { enabled: true } });
  assert.deepEqual(plan.map((p) => [p.source, p.dedupeKey, p.scopeKey]), [
    ['TAS_MAP', 'TAS_MAP', `TAS_MAP:${CODE}`],
    ['tas', 'tas', `tas:${CODE}`],
    ['mygov', 'mygov', `mygov:${CODE}`],
  ]);
  assert.deepEqual(plan[2].input.captchaPolicy, { enabled: true });
  assert.equal(officialTaskPlan({ mode: 'cadastral', query: CODE }, { tasImplementation: { active: 'LEGACY' } })[1].source, 'tas_legacy');
  assert.deepEqual(officialTaskPlan({ mode: 'property', query: 'Villion' }), []);
});

test('the worker view is RUNNING until every task is terminal, then COMPLETE in source order', () => {
  const rows = [
    row({ source: 'mygov', dedupe_key: 'mygov', state: 'RUNNING', started_at: '2026-10-10T10:01:00Z' }),
    row({ source: 'TAS_MAP', dedupe_key: 'TAS_MAP', state: 'SUCCEEDED', started_at: '2026-10-10T10:00:30Z', finished_at: '2026-10-10T10:02:00Z', result: { source: 'TAS_MAP', status: 'SEARCH_CONFIRMED', documents: [] } }),
    row({ source: 'tas', dedupe_key: 'tas', state: 'WAITING_SHARED' }),
  ];
  const v = queueWorkerView(rows);
  assert.equal(v.status, 'RUNNING');
  assert.equal(v.runStartedAt, '2026-10-10T10:00:30Z');
  assert.deepEqual(v.results.map((r) => r.source), ['TAS_MAP']);
  assert.deepEqual(v.steps.map((s) => s.key), ['TAS_MAP', 'tas', 'mygov']);

  rows[0] = { ...rows[0], state: 'SUCCEEDED', finished_at: '2026-10-10T10:05:00Z', result: { source: 'mygov', status: 'SEARCH_CONFIRMED', queueEntities: [{ name: 'შპს მილენიო გრუპი', identificationCode: '404670272' }] } };
  rows[2] = { ...rows[2], state: 'SUCCEEDED', reused: 'SHARED', finished_at: '2026-10-10T10:04:00Z', result: { source: 'tas', status: 'SEARCH_CONFIRMED', documents: [{ id: 'tas_1', rawText: 'x', fullTextRef: { sha256: 'a', path: 'p', chars: 90000 } }] } };
  const done = queueWorkerView(rows);
  assert.equal(done.status, 'COMPLETE');
  assert.equal(done.completedAt, '2026-10-10T10:05:00Z');
  assert.deepEqual(done.results.map((r) => r.source), ['TAS_MAP', 'tas', 'mygov']);
  assert.equal(done.results[1].queue.reused, 'SHARED', 'shared work is traceable');
  assert.equal(done.results[1].documents[0].fullTextRef.chars, 90000, 'the complete-evidence reference survives');
  assert.equal('queueEntities' in done.results[2], false);
  assert.deepEqual(done.discoveredEntities.map((e) => e.identificationCode), ['404670272']);
});

test('nothing started yet reads as QUEUED (waiting its turn, not slow)', () => {
  assert.equal(queueWorkerView([row({ source: 'tas', dedupe_key: 'tas', state: 'QUEUED' })]).status, 'QUEUED');
});

test('a failed source is an honest FAILED result; human verification is a skip, not a failure', () => {
  const failed = taskResult(row({ source: 'mygov', dedupe_key: 'mygov', state: 'DEAD', error: 'LEASE_EXPIRED after 3 attempts' }));
  assert.equal(failed.status, 'FAILED');
  assert.equal(failed.error, 'SOURCE_TIMED_OUT', 'internal error text never travels');
  const human = taskResult(row({ source: 'rstax', dedupe_key: 'rstax:404670272', state: 'FAILED', error: 'HUMAN_VERIFICATION_REQUIRED', input: { idCode: '404670272', name: 'Millenio Group' } }));
  assert.equal(human.status, 'SKIPPED_HUMAN_VERIFICATION');
  assert.deepEqual(human.forEntity, { name: 'Millenio Group', idCode: '404670272' });
  assert.equal(publicTaskError('SHARED_PRODUCER_DEAD: x'), 'SHARED_SOURCE_UNAVAILABLE');
  assert.equal(taskResult(row({ source: 'tas', dedupe_key: 'tas', state: 'RUNNING' })), null);
});

test('registry follow-ups: once, after the primary sources, bounded, from primary documents only', () => {
  const ents = (k) => Array.from({ length: 5 }, (_, i) => ({ name: `Co ${k}${i}`, identificationCode: `40${k}00000${i}` }));
  const rows = [
    row({ source: 'TAS_MAP', dedupe_key: 'TAS_MAP', state: 'SUCCEEDED', result: { source: 'TAS_MAP' } }),
    row({ source: 'tas', dedupe_key: 'tas', state: 'RUNNING' }),
    row({ source: 'mygov', dedupe_key: 'mygov', state: 'SUCCEEDED', result: { source: 'mygov', queueEntities: ents(1) } }),
  ];
  assert.deepEqual(followUpTasks(rows), [], 'nothing while a primary source is still running');
  rows[1] = { ...rows[1], state: 'SUCCEEDED', result: { source: 'tas' } };
  const plan = followUpTasks(rows);
  assert.equal(plan.length, MAX_QUEUE_ENTITY_COMPANIES * 2);
  assert.deepEqual([...new Set(plan.map((p) => p.source))], ['enreg', 'debtor']);
  assert.equal(plan[0].scopeKey, 'enreg:401000000');
  // Planned rows exist now; an entity result naming more companies fans out nothing.
  const after = [...rows, ...plan.map((p) => row({ source: p.source, dedupe_key: p.dedupeKey, state: 'SUCCEEDED', input: p.input, result: { source: p.source, queueEntities: ents(9) } }))];
  assert.deepEqual(followUpTasks(after), []);
});

test('TAS API failure falls back to the legacy browser workflow once, when configured', () => {
  const rows = [row({ source: 'tas', dedupe_key: 'tas', state: 'DEAD', error: 'x' })];
  const plan = followUpTasks(rows, { tasImplementation: { active: 'API_FIRST', fallback: 'LEGACY' } });
  assert.deepEqual(plan.map((p) => [p.source, p.scopeKey]), [['tas_legacy', `tas_legacy:${CODE}`]]);
  assert.deepEqual(followUpTasks(rows, { tasImplementation: { active: 'API_FIRST', fallback: null } }), []);
  const withFallback = [...rows, row({ source: 'tas_legacy', dedupe_key: 'tas_legacy', state: 'SUCCEEDED', result: { source: 'tas', status: 'SEARCH_CONFIRMED' } })];
  assert.deepEqual(followUpTasks(withFallback, { tasImplementation: { fallback: 'LEGACY' } }).filter((p) => p.source === 'tas_legacy'), []);
  const v = queueWorkerView(withFallback);
  assert.deepEqual(v.results.map((r) => [r.source, r.status]), [['tas', 'SEARCH_CONFIRMED']], 'the fallback stands for TAS');
});

test('entity tasks: identified companies share across jobs, name searches do not', () => {
  assert.equal(entityTask('enreg', { idCode: '404670272', name: 'Millenio' }).scopeKey, 'enreg:404670272');
  assert.equal(entityTask('enreg', { idCode: null, name: 'Millenio Group' }).scopeKey, null);
  assert.deepEqual(entityTask('rstax', { idCode: '404670272', name: 'M' }, { enabled: true }).input.captchaPolicy, { enabled: true });
  assert.deepEqual(singleTaskView(null), { status: 'FAILED', results: [] });
  assert.equal(singleTaskView(row({ source: 'enreg', dedupe_key: 'enreg:1', state: 'QUEUED' })).status, 'QUEUED');
  assert.equal(singleTaskView(row({ source: 'enreg', dedupe_key: 'enreg:1', state: 'DEAD', input: { idCode: '1', name: 'A' } })).results[0].status, 'FAILED');
});

test('research-agent wires QUEUE mode behind the admin flag and keeps LEGACY the default', () => {
  const src = readFileSync(new URL('../../../supabase/functions/research-agent/index.ts', import.meta.url), 'utf8');
  assert.match(src, /verify_execution_mode/);
  assert.match(src, /return v === 'QUEUE' \|\| v\?\.mode === 'QUEUE' \? 'QUEUE' : 'LEGACY';/);
  assert.match(src, /queueWorkerView\(rows\)/);
  assert.match(src, /research_job_advance_acquire/);
  assert.match(src, /client_request_id/);
  const mig = readFileSync(new URL('../../../supabase/migrations/20261024090000_verify_durable_execution.sql', import.meta.url), 'utf8');
  assert.match(mig, /'verify_execution_mode', '"LEGACY"'::jsonb/);
});
