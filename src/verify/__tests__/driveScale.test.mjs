// driveScale.test.mjs — the Verify driver at scale (owner 2026-10-24). The SQL claim itself is proven on PGlite by
// scripts/verify/drive-claim-db-check.mjs; this covers the pool, the fan-out bound and the research-agent wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { driveSettings, shouldFanOut, runPool, jobsPerTick, stepDelayMs, chainNextStep, STATUS_CHAIN_MAX_STEPS, STATUS_CHAIN_BUDGET_MS, DRIVE_DEFAULTS } from '../driveScale.ts';

const ra = readFileSync(fileURLToPath(new URL('../../../supabase/functions/research-agent/index.ts', import.meta.url)), 'utf8');

test('settings are clamped; missing means the defaults', () => {
  assert.deepEqual(driveSettings(null), DRIVE_DEFAULTS);
  assert.deepEqual(driveSettings({ batch: 99, maxFanout: -4 }), { batch: 10, maxFanout: 0 });
  assert.equal(jobsPerTick(DRIVE_DEFAULTS), DRIVE_DEFAULTS.batch * (DRIVE_DEFAULTS.maxFanout + 1));
  assert.ok(jobsPerTick(DRIVE_DEFAULTS) >= 180, 'one tick keeps a 200-job burst moving');
});

test('a full claim chains one more invocation, up to the bound; a partial claim never does', () => {
  const s = { batch: 3, maxFanout: 2 };
  assert.equal(shouldFanOut(3, s, 0), true);
  assert.equal(shouldFanOut(3, s, 1), true);
  assert.equal(shouldFanOut(3, s, 2), false, 'the chain stops at maxFanout');
  assert.equal(shouldFanOut(2, s, 0), false, 'work ran out: no empty invocations');
});

test('the pool runs jobs concurrently up to the limit, and one failure never stops the rest', async () => {
  let inFlight = 0, peak = 0;
  const done = [];
  await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (i) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 10));
    inFlight--;
    if (i === 2) throw new Error('job 2 failed');
    done.push(i);
  });
  assert.equal(peak, 3);
  assert.deepEqual(done.sort(), [1, 3, 4, 5, 6, 7]);
});

test('research-agent claims through verify_drive_claim, fans out with the cron token, and keeps the old sweep as fallback', () => {
  assert.match(ra, /sb\.rpc\('verify_drive_claim', \{ p_limit: scale\.batch \}\)/);
  assert.match(ra, /if \(token && shouldFanOut\(ids\.length, scale, depth\)\)/);
  assert.match(ra, /body: JSON\.stringify\(\{ action: 'drive', depth: depth \+ 1 \}\)/);
  assert.match(ra, /await runPool\(ids, scale\.batch, \(id\) => driveJob\(sb, key, model, id\)\)/);
  assert.match(ra, /event: 'claim_rpc_unavailable'/);
  assert.match(ra, /driveLiveJobs\(svc, dk, dm, depth, expected\)/);
  // The bookkeeping sweeps stay once per tick.
  assert.match(ra, /if \(depth === 0\) \{\n\s+await driveSynthesis\(sb\);/);
});

test('queue time is not execution time: waiting tasks never expire the stage; each running task gets its own window', async () => {
  const { queueWorkerView } = await import('../queueOfficial.ts');
  const row = (k, state, started) => ({ id: k, source: k, dedupe_key: k, state, attempts: 1, started_at: started, created_at: '2026-10-24T10:00:00Z' });
  const v = queueWorkerView([row('TAS_MAP', 'SUCCEEDED', '2026-10-24T10:01:00Z'), row('tas', 'RUNNING', '2026-10-24T10:20:00Z'), row('mygov', 'QUEUED', null)]);
  assert.equal(v.waitingTasks, 1);
  assert.equal(v.latestRunningStartedAt, '2026-10-24T10:20:00Z');
  assert.match(ra, /if \(w\?\.view === 'queue' && Number\(w\?\.waitingTasks\) > 0\) return Number\.isFinite\(launched\) && Date\.now\(\) - launched > OFFICIAL_QUEUE_WAIT_CAP_MS;/);
  assert.match(ra, /return Number\.isFinite\(startedRun\) && Date\.now\(\) - startedRun > OFFICIAL_BROWSER_DEADLINE_MS;/);
  const rec = readFileSync(fileURLToPath(new URL('../officialRecovery.ts', import.meta.url)), 'utf8');
  assert.match(rec, /in\('state', \['QUEUED', 'WAITING_SHARED'\]\)\.neq\('source', 'rstax'\);\n\s+if \(\(count \?\? 0\) > 0\) return false;/);
});

test('a waiting job shows its position and a measured estimate', () => {
  assert.match(ra, /sb\.rpc\('verify_queue_position', \{ p_job_id: j\.id \}\)/);
  assert.match(ra, /etaSeconds: typeof w\?\.etaSeconds === 'number' \? w\.etaSeconds : null/);
  const page = readFileSync(fileURLToPath(new URL('../../pages/VerifyPage.tsx', import.meta.url)), 'utf8');
  assert.match(page, /<ResearchStream queue=\{typeof progress\?\.queuePosition==='number'/);
  const rs = readFileSync(fileURLToPath(new URL('../../components/verify/ResearchStream.tsx', import.meta.url)), 'utf8');
  assert.match(rs, /t\('verify_queue_line_eta', \{ n: queue\.position, min:/);
});

test('the batch claim re-checks the claim on the locked row (two drivers never get one job)', () => {
  const sql = readFileSync(fileURLToPath(new URL('../../../supabase/migrations/20261205090000_verify_drive_claim.sql', import.meta.url)), 'utf8');
  const pick = sql.slice(sql.indexOf('pick as ('), sql.indexOf('for update of r skip locked'));
  // Postgres re-evaluates the locking scan's own WHERE on the newest row version; the CTE's snapshot is not enough.
  assert.match(pick, /where r\.status in \('CREATED', 'RUNNING'\)/);
  assert.match(pick, /and \(r\.driver_claimed_at is null or r\.driver_claimed_at < now\(\)/);
  assert.match(pick, /and r\.deleted_at is null\s+and r\.cancelled_at is null/);
});

/* ── no idle gap between stages (owner 2026-10-30, Verify V3 speed) ── */
test('a step that moves the job into an internal state is followed at once; waits and no-progress keep the spacing', () => {
  const S = 3000;
  // A model stage finished: parked in an internal state, the next stage can launch now.
  assert.equal(stepDelayMs({ stage: 'OFFICIAL_COLLECTION_WAITING', status: 'RUNNING' }, { stage: 'PUBLIC_RESEARCH_READY', status: 'CREATED' }, S), 0);
  assert.equal(stepDelayMs({ stage: 'PUBLIC_RESEARCH_WAITING', status: 'RUNNING' }, { stage: 'PUBLIC_RESEARCH_CHECK_PENDING', status: 'CREATED' }, S), 0);
  assert.equal(stepDelayMs({ stage: 'BROWSER_WAITING', status: 'RUNNING' }, { stage: 'OFFICIAL_READY', status: 'CREATED' }, S), 0);
  // The step launched an outside wait (OpenAI background response, browser worker, financial lookup): poll at the old pace.
  for (const w of ['IDENTITY_WAITING', 'OFFICIAL_COLLECTION_WAITING', 'PUBLIC_RESEARCH_WAITING', 'MARKET_WAITING', 'SYNTHESIS_WAITING', 'BROWSER_WAITING', 'FINANCIAL_ENTITY_WAITING']) {
    assert.equal(stepDelayMs({ stage: 'X_READY', status: 'CREATED' }, { stage: w, status: 'RUNNING' }, S), S, w);
  }
  // Nothing changed (still waiting, or a no-op step): never spin.
  assert.equal(stepDelayMs({ stage: 'PUBLIC_RESEARCH_WAITING', status: 'RUNNING' }, { stage: 'PUBLIC_RESEARCH_WAITING', status: 'RUNNING' }, S), S);
  assert.equal(stepDelayMs({ stage: 'OFFICIAL_READY', status: 'CREATED' }, { stage: 'OFFICIAL_READY', status: 'CREATED' }, S), S);
  // Unknown either side: the old spacing.
  assert.equal(stepDelayMs(null, { stage: 'OFFICIAL_READY', status: 'CREATED' }, S), S);
  assert.equal(stepDelayMs({ stage: 'OFFICIAL_READY', status: 'CREATED' }, null, S), S);
  assert.equal(stepDelayMs({ stage: 'OFFICIAL_READY', status: 'CREATED' }, { stage: null, status: 'CREATED' }, S), S);
});

test('driveJob keeps every guard and only drops the sleep through stepDelayMs', () => {
  const drive = ra.slice(ra.indexOf('async function driveJob('), ra.indexOf('async function driveJob(') + 2600);
  assert.match(drive, /for \(let i = 0; i < DRIVE_TICKS_PER_JOB && Date\.now\(\) < deadline; i\+\+\)/, 'step and wall-clock budgets');
  assert.match(drive, /if \(!\(await advanceExclusive\(sb, key, model, j, jobLanguage\(j\)\)\)\) return;/, 'the lease');
  assert.match(drive, /if \(await recoverStalledOfficial\(sb, j\)\) return;/, 'stall recovery');
  assert.match(drive, /const wait = stepDelayMs\(j, after, DRIVE_TICK_SPACING_MS\);\n\s+if \(wait > 0\) await new Promise\(\(r\) => setTimeout\(r, wait\)\);/);
  assert.match(drive, /await releaseJob\(sb, id\);/, 'the claim is always released');
  assert.equal((drive.match(/setTimeout\(r, DRIVE_TICK_SPACING_MS\)/g) ?? []).length, 0, 'no unconditional sleep left');
});

/* ── the page's status poll chains internal hand-offs (prod d84f06db: 24 s per hand-off) ── */
test('chainNextStep: an internal hand-off is stepped again at once; waits, no-progress and finished/paused/human jobs are not', () => {
  const W = (stage) => ({ stage, status: 'RUNNING' });
  const C = (stage) => ({ stage, status: 'CREATED' });
  assert.equal(chainNextStep(W('PUBLIC_RESEARCH_WAITING'), C('PUBLIC_RESEARCH_CHECK_PENDING')), true);
  assert.equal(chainNextStep(C('PUBLIC_RESEARCH_CHECK_PENDING'), C('MARKET_READY')), true);
  assert.equal(chainNextStep(C('MARKET_READY'), C('RECONCILIATION_CHECK_PENDING')), true);
  assert.equal(chainNextStep(C('RECONCILIATION_CHECK_PENDING'), C('SYNTHESIS_READY')), true);
  assert.equal(chainNextStep(W('FINANCIAL_ENTITY_WAITING'), C('PUBLIC_RESEARCH_READY')), true);
  assert.equal(chainNextStep(C('PUBLIC_RESEARCH_READY'), W('PUBLIC_RESEARCH_WAITING')), false, 'a launched wait stops the chain');
  assert.equal(chainNextStep(C('MARKET_READY'), C('MARKET_READY')), false, 'a hold (marketplace still running) never spins');
  assert.equal(chainNextStep(C('SYNTHESIS_READY'), { stage: 'COMPLETE', status: 'COMPLETE' }), false);
  assert.equal(chainNextStep(C('X_READY'), { stage: 'BROWSER_WAITING', status: 'WAITING_HUMAN' }), false);
  assert.equal(chainNextStep(C('X_READY'), { stage: 'MARKET_READY', status: 'PAUSED' }), false);
  assert.equal(chainNextStep(C('X_READY'), { ...C('MARKET_READY'), cancelled_at: '2026-10-30T00:00:00Z' }), false);
  assert.equal(chainNextStep(C('X_READY'), null), false);
  assert.ok(STATUS_CHAIN_MAX_STEPS >= 4 && STATUS_CHAIN_MAX_STEPS <= 6);
  assert.ok(STATUS_CHAIN_BUDGET_MS <= 10_000, 'the status response is never held long');
});

test('the status path chains under the lease and the budget, and re-reads the row after every step', () => {
  const at = ra.indexOf("if (action === 'status' || action === 'resume' || action === 'skip')");
  const block = ra.slice(at, at + 6000);
  assert.match(block, /for \(let n = 0; n < STATUS_CHAIN_MAX_STEPS && Date\.now\(\) < until && chainNextStep\(before, r\.data\); n\+\+\)/);
  assert.match(block, /if \(!\(await advanceExclusive\(sb, key, model, r\.data, lang\)\)\) break;/);
  assert.match(block, /const until = Date\.now\(\) \+ STATUS_CHAIN_BUDGET_MS;/);
});
