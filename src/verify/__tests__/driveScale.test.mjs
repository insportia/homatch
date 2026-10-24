// driveScale.test.mjs — the Verify driver at scale (owner 2026-10-24). The SQL claim itself is proven on PGlite by
// scripts/verify/drive-claim-db-check.mjs; this covers the pool, the fan-out bound and the research-agent wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { driveSettings, shouldFanOut, runPool, jobsPerTick, DRIVE_DEFAULTS } from '../driveScale.ts';

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
  const sql = readFileSync(fileURLToPath(new URL('../../../supabase/migrations/20261201090000_verify_drive_claim.sql', import.meta.url)), 'utf8');
  const pick = sql.slice(sql.indexOf('pick as ('), sql.indexOf('for update of r skip locked'));
  // Postgres re-evaluates the locking scan's own WHERE on the newest row version; the CTE's snapshot is not enough.
  assert.match(pick, /where r\.status in \('CREATED', 'RUNNING'\)/);
  assert.match(pick, /and \(r\.driver_claimed_at is null or r\.driver_claimed_at < now\(\)/);
  assert.match(pick, /and r\.deleted_at is null\s+and r\.cancelled_at is null/);
});
