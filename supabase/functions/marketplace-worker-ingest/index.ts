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
//           bounded, URL-checked; partial batches allowed; terminal is final
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
import { processAndStore } from '../_shared/marketplaceSearch.ts';

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
    .select('worker_id,source_key,state,enabled,token_hash').eq('worker_id', workerId).maybeSingle();
  const presented = await sha256Hex(token);
  if (!worker?.token_hash || !sameHex(presented, worker.token_hash)) return json({ error: 'Unauthorized' }, 401);
  if (worker.state !== 'ACTIVE' || !worker.enabled) return json({ error: 'WORKER_NOT_ACTIVE' }, 403);

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
  let body: Record<string, unknown>;
  try { body = JSON.parse(text); } catch { return json({ error: 'BAD_JSON' }, 400); }
  const action = String(body.action ?? '');

  try {
    if (action === 'claim') {
      const { data, error } = await db.rpc('claim_marketplace_worker_runs', { p_worker_id: workerId, p_limit: Number(body.limit) || 5 });
      if (error) throw new Error(error.message);
      return json({ runs: (data ?? []).map((r: Record<string, unknown>) => ({ runId: r.id, deadlineAt: r.deadline_at, request: r.request })) });
    }

    if (action === 'report') {
      const runId = String(body.runId ?? '');
      if (!UUID.test(runId)) return json({ error: 'BAD_RUN' }, 400);
      const { data: run } = await db.from('discovery_marketplace_worker_runs')
        .select('id,search_id,worker_id,status,discovered_count,returned_count,rejected_count,deadline_at').eq('id', runId).maybeSingle();
      /* A worker can report only on its own run. */
      if (!run || run.worker_id !== workerId) return json({ error: 'NOT_FOUND' }, 404);
      const v = validateWorkerReport(body.result, worker.source_key);
      if (!v.ok) return json({ error: 'INVALID_REPORT', reason: v.reason }, 422);
      const report = v.report;
      if (!canTransition(run.status as WorkerRunStatus, report.status)) return json({ error: 'RUN_CLOSED', status: run.status }, 409);

      const now = new Date().toISOString();
      if (report.listings.length) {
        const rows = report.listings.map((c) => ({
          search_id: run.search_id, worker_run_id: run.id, source_key: worker.source_key, source_listing_id: c.sourceListingId,
          exact_url: c.exactUrl, raw: c, observed_at: c.observedAt, updated_at: now,
        }));
        const { error } = await db.from('discovery_marketplace_listings').upsert(rows, { onConflict: 'search_id,source_key,source_listing_id' });
        if (error) throw new Error(error.message);
      }
      await db.from('discovery_marketplace_worker_runs').update({
        status: report.status,
        discovered_count: Math.max(Number(run.discovered_count) || 0, report.discoveredCount),
        returned_count: (Number(run.returned_count) || 0) + report.listings.length,
        rejected_count: (Number(run.rejected_count) || 0) + report.rejected.length,
        errors: report.errors,
        metrics: report.metrics,
        query_applied: report.queryApplied,
        completed_at: report.final ? now : null,
        updated_at: now,
      }).eq('id', run.id);
      const outcome = await processAndStore(db, run.search_id);
      return json({ accepted: report.listings.length, rejected: report.rejected, searchStatus: outcome?.status ?? null });
    }

    return json({ error: 'UNKNOWN_ACTION' }, 400);
  } catch (error) {
    console.error('marketplace-worker-ingest', action, error instanceof Error ? error.message : String(error));
    return json({ error: 'INTERNAL' }, 500);
  }
});
