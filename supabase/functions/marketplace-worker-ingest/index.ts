// MARKETPLACE WORKER INGEST — the only door a marketplace worker has into HOMATCH.
//
// verify_jwt = false: a worker is not a user. It authenticates with its OWN
// token, issued per worker and stored only as a sha256 hash in
// discovery_marketplace_workers.token_hash. A worker never holds a Supabase
// key of any kind and can only:
//
//   claim   lease QUEUED runs addressed to it (claim_marketplace_worker_runs;
//           a worker that is not ACTIVE and enabled receives nothing)
//   report  send results for a run it holds: validated (worker-contract.ts),
//           bounded, URL-checked; partial batches allowed; terminal is final;
//           a FAILED report marked retryable is re-queued within the retry budget
//   heartbeat  extend this run's own lease while it is still working
//
// CONCURRENT: every eligible worker received its own runs at dispatch and
// claims them independently, in parallel, within per-provider and global
// bounds (claim_marketplace_worker_runs; policy in dispatch.ts).
//
// Every report re-processes the search (deterministic pipeline), so results
// from fast workers are visible while slow ones are still searching.
//
// No real worker is registered by this foundation; with an empty registry
// every request is refused.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  canTransition, validateWorkerReport, type WorkerRunStatus,
} from '../../../src/research-core/marketplace/worker-contract.ts';
import { DEFAULT_LEASE_SECONDS, leaseUntil, retryDecision } from '../../../src/research-core/marketplace/dispatch.ts';
import { loadMarketplaceSwitches, processAndStore, reapRuns } from '../_shared/marketplaceSearch.ts';
import { myHomeRestricted } from '../_shared/myHomeAccess.ts';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 2_000_000;

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Constant-time comparison of two equal-length hex strings. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const baseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!baseUrl || !serviceKey) return json({ error: 'not configured' }, 500);
  const db = createClient(baseUrl, serviceKey, { auth: { persistSession: false } });

  const length = Number(req.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);

  /* WHO: worker id + its own bearer token, checked against the stored hash. */
  const workerId = String(req.headers.get('x-homatch-worker') ?? '');
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(workerId) || token.length < 32) return json({ error: 'Unauthorized' }, 401);
  const { data: worker } = await db.from('discovery_marketplace_workers')
    .select('worker_id,source_key,state,enabled,token_hash,max_attempts,health').eq('worker_id', workerId).maybeSingle();
  const presented = await sha256Hex(token);
  if (!worker?.token_hash || !sameHex(presented, worker.token_hash)) return json({ error: 'Unauthorized' }, 401);
  if (worker.state !== 'ACTIVE' || !worker.enabled) return json({ error: 'WORKER_NOT_ACTIVE' }, 403);

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); } catch { return json({ error: 'BAD_JSON' }, 400); }
  const action = String(body.action ?? '');

  try {
    // Scoped to this authenticated worker; there is no worker clearance action.
    if (workerId === 'myhome-agent' && (action === 'source-health' || action === 'restrict-access')) {
      if (action === 'restrict-access') {
        const { error } = await db.from('discovery_marketplace_workers').update({
          health: { ...(worker.health ?? {}), status: 'DOWN', accessRestricted: true, checkedAt: new Date().toISOString() },
        }).eq('worker_id', workerId);
        if (error) throw error;
        return json({ accessRestricted: true });
      }
      // jsonb containment takes JSON text: postgrest-js serializes an array
      // argument as a Postgres array literal (cs.{[object Object]}) and fails.
      const { data, error } = await db.from('discovery_marketplace_worker_runs')
        .select('created_at,errors').eq('worker_id', workerId).contains('errors', '[{"code":"ACCESS_DENIED"}]')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw error;
      return json({ accessRestricted: myHomeRestricted(worker.health, data) });
    }
    const leaseSeconds = Math.max(15, Math.min(900, Math.trunc(Number(body.leaseSeconds)) || DEFAULT_LEASE_SECONDS));
    const maxAttempts = Number(worker.max_attempts) || 3;

    if (action === 'claim') {
      const switches = await loadMarketplaceSwitches(db);
      if (!switches.enabled || (workerId === 'myhome-agent' ? !switches.myhomeEnabled : workerId === 'ssge-agent' ? !switches.ssgeEnabled : switches.providersKilled)) return json({ runs: [] });
      /* Free this worker's lapsed leases first (retry or close each run on its own), then claim
         within the per-provider and global bounds the SQL enforces atomically. */
      const { data: stale } = await db.from('discovery_marketplace_worker_runs')
        .select('id,worker_id,status,attempts,returned_count,lease_expires_at,deadline_at,errors')
        .eq('worker_id', workerId).in('status', ['SEARCHING', 'RESULTS_RECEIVED', 'PROCESSING'])
        .lte('lease_expires_at', new Date().toISOString()).limit(200);
      await reapRuns(db, (stale ?? []) as Array<Record<string, unknown>>, () => maxAttempts);
      const { data, error } = await db.rpc('claim_marketplace_worker_runs', {
        p_worker_id: workerId, p_limit: Number(body.limit) || 5, p_lease_seconds: leaseSeconds,
      });
      if (error) throw new Error(error.message);
      return json({ runs: (data ?? []).map((r: Record<string, unknown>) => ({
        runId: r.id, deadlineAt: r.deadline_at, leaseExpiresAt: r.lease_expires_at, attempt: r.attempts, request: r.request,
        queryApplied: r.query_applied, returnedCount: r.returned_count,
      })) });
    }

    /* Each report or heartbeat is about ONE run the worker holds; other runs are never touched. */
    const runId = String(body.runId ?? '');
    if (!UUID.test(runId)) return json({ error: 'BAD_RUN' }, 400);
    const { data: run } = await db.from('discovery_marketplace_worker_runs')
      .select('id,search_id,worker_id,status,attempts,discovered_count,returned_count,rejected_count,deadline_at').eq('id', runId).maybeSingle();
    /* A worker can report only on its own run. */
    if (!run || run.worker_id !== workerId) return json({ error: 'NOT_FOUND' }, 404);

    if (action === 'heartbeat') {
      if (!['SEARCHING', 'RESULTS_RECEIVED', 'PROCESSING'].includes(run.status)) return json({ error: 'RUN_CLOSED', status: run.status }, 409);
      const lease = leaseUntil(new Date(), run.deadline_at, leaseSeconds);
      await db.from('discovery_marketplace_worker_runs').update({ lease_expires_at: lease, last_heartbeat_at: new Date().toISOString() })
        .eq('id', run.id).eq('status', run.status);
      return json({ leaseExpiresAt: lease });
    }

    if (action === 'report') {
      const v = validateWorkerReport(body.result, worker.source_key);
      if (!v.ok) return json({ error: 'INVALID_REPORT', reason: v.reason }, 422);
      const report = v.report;
      if (!canTransition(run.status as WorkerRunStatus, report.status)) return json({ error: 'RUN_CLOSED', status: run.status }, 409);

      const nowDate = new Date();
      const now = nowDate.toISOString();
      if (report.listings.length) {
        const rows = report.listings.map((c) => ({
          search_id: run.search_id, worker_run_id: run.id, source_key: worker.source_key, source_listing_id: c.sourceListingId,
          exact_url: c.exactUrl, raw: c, observed_at: c.observedAt, updated_at: now,
        }));
        const { error } = await db.from('discovery_marketplace_listings').upsert(rows, { onConflict: 'search_id,source_key,source_listing_id' });
        if (error) throw new Error(error.message);
      }
      // Replayed batches upsert the same identities; do not inflate run totals.
      const { count: persisted, error: countError } = await db.from('discovery_marketplace_listings')
        .select('id', { count: 'exact', head: true }).eq('search_id', run.search_id).eq('worker_run_id', run.id);
      if (countError || persisted === null) throw countError ?? new Error('Missing persisted listing count');
      const returned = persisted;
      /* A transient failure with budget left goes back to the queue; it never fails the search. */
      const requeue = report.status === 'FAILED'
        && retryDecision({ attempts: Number(run.attempts) || 0, deadlineAt: run.deadline_at, returnedCount: returned }, report.retryable, nowDate, maxAttempts) === 'REQUEUE';
      const { data: updated, error: runError } = await db.from('discovery_marketplace_worker_runs').update({
        status: requeue ? 'QUEUED' : report.status,
        discovered_count: Math.max(Number(run.discovered_count) || 0, report.discoveredCount),
        returned_count: returned,
        rejected_count: (Number(run.rejected_count) || 0) + report.rejected.length,
        errors: report.errors,
        metrics: report.metrics,
        query_applied: report.queryApplied,
        /* Every non-final report is also a heartbeat: the lease is this run's own. */
        lease_expires_at: report.final || requeue ? null : leaseUntil(nowDate, run.deadline_at, leaseSeconds),
        last_heartbeat_at: now,
        completed_at: report.final && !requeue ? now : null,
        updated_at: now,
      }).eq('id', run.id).eq('status', run.status).select('id').maybeSingle();
      if (runError || !updated) throw runError ?? new Error('Run changed before acknowledgement');
      /* Results from this worker are processed now, whatever the others are doing. */
      const outcome = await processAndStore(db, run.search_id);
      return json({ accepted: report.listings.length, rejected: report.rejected, requeued: requeue, searchStatus: outcome?.status ?? null });
    }

    return json({ error: 'UNKNOWN_ACTION' }, 400);
  } catch (error) {
    console.error('marketplace-worker-ingest', action, error instanceof Error ? error.message : String(error));
    return json({ error: 'INTERNAL' }, 500);
  }
});
