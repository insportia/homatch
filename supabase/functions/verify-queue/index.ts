/*
 * verify-queue — the Railway worker's door to the durable Verify task queue.
 *
 * The worker holds no database credential (CLAUDE.md: no service key on
 * Railway). Every queue operation goes through this function, authenticated
 * with the same WORKER_TOKEN research-agent already uses towards the worker,
 * and executed by the SQL functions of migration 20261026090000, which do all
 * the locking, fencing and single-flight work atomically.
 *
 * Actions (POST JSON {action, ...}):
 *   claim      {worker, lanes[], limit}            → {tasks[]}
 *   heartbeat  {id, token}                         → {state: OK|LOST|CANCEL}
 *   complete   {id, token, result, evidenceRefs?, contentHash?, cacheScope?}
 *   fail       {id, token, error, retryable?, retryAfterSeconds?}
 *   release    {id, token}
 *   delegate   {id, token, scopeKey, input?}
 *   captcha    {events[]}                          → durable CAPTCHA ledger
 *   upload     {sha256, contentType}               → signed upload URL (or exists)
 *   metrics                                        → queue depth / age / costs
 *
 * Bounded by construction: requests over MAX_BODY_BYTES are refused, and a
 * task result is stored only up to MAX_RESULT_BYTES — large document bodies
 * travel to the private verify-evidence bucket, never through here.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const MAX_BODY_BYTES = 2_500_000;
const MAX_RESULT_BYTES = 1_500_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const LANES = new Set(['HTTP', 'BROWSER']);
const BUCKET = 'verify-evidence';
const VISUAL_BUCKET = 'verify-official-visuals';

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

/** Constant-time string comparison. */
function sameSecret(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.slice(0, max) : '');
const int = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.trunc(Number(v));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
};

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const baseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const workerToken = Deno.env.get('WORKER_TOKEN') || '';
  if (!baseUrl || !serviceKey || !workerToken) return json({ error: 'not configured' }, 500);

  const presented = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!sameSecret(presented, workerToken)) return json({ error: 'Unauthorized' }, 401);

  const length = Number(req.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
  let body: Record<string, any>;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: 'BAD_JSON' }, 400);
  }

  const db = createClient(baseUrl, serviceKey, { auth: { persistSession: false } });
  const action = str(body.action, 32);
  const id = str(body.id, 40);
  const token = Number(body.token);
  const needTask = () => UUID.test(id) && Number.isSafeInteger(token) && token > 0;

  try {
    switch (action) {
      case 'claim': {
        const lanes = (Array.isArray(body.lanes) ? body.lanes : []).map(String).filter((l: string) => LANES.has(l));
        const worker = str(body.worker, 120);
        if (!lanes.length || !worker) return json({ error: 'BAD_REQUEST' }, 400);
        const { data, error } = await db.rpc('verify_task_claim', { p_worker: worker, p_lanes: lanes, p_limit: int(body.limit, 1, 20, 1) });
        if (error) throw error;
        return json({ tasks: data ?? [] });
      }
      case 'heartbeat': {
        if (!needTask()) return json({ error: 'BAD_REQUEST' }, 400);
        const { data, error } = await db.rpc('verify_task_heartbeat', { p_task_id: id, p_token: token });
        if (error) throw error;
        return json({ state: data });
      }
      case 'complete': {
        if (!needTask()) return json({ error: 'BAD_REQUEST' }, 400);
        const result = body.result ?? {};
        if (JSON.stringify(result).length > MAX_RESULT_BYTES) return json({ error: 'RESULT_TOO_LARGE' }, 413);
        const refs = Array.isArray(body.evidenceRefs) ? body.evidenceRefs.slice(0, 500) : [];
        const { data, error } = await db.rpc('verify_task_complete', {
          p_task_id: id, p_token: token, p_result: result, p_evidence_refs: refs,
          p_content_hash: SHA256.test(str(body.contentHash, 64)) ? body.contentHash : null,
          p_cache_scope: str(body.cacheScope, 300) || null,
        });
        if (error) throw error;
        return json(data);
      }
      case 'fail': {
        if (!needTask()) return json({ error: 'BAD_REQUEST' }, 400);
        const { data, error } = await db.rpc('verify_task_fail', {
          p_task_id: id, p_token: token, p_error: str(body.error, 2000) || 'FAILED',
          p_retryable: body.retryable !== false,
          p_retry_after_seconds: body.retryAfterSeconds == null ? null : int(body.retryAfterSeconds, 1, 3600, 60),
        });
        if (error) throw error;
        return json(data);
      }
      case 'release': {
        if (!needTask()) return json({ error: 'BAD_REQUEST' }, 400);
        const { data, error } = await db.rpc('verify_task_release', { p_task_id: id, p_token: token });
        if (error) throw error;
        return json({ released: data === true });
      }
      case 'delegate': {
        if (!needTask() || !str(body.scopeKey, 300)) return json({ error: 'BAD_REQUEST' }, 400);
        const { data, error } = await db.rpc('verify_task_delegate', {
          p_task_id: id, p_token: token, p_scope_key: str(body.scopeKey, 300), p_input: body.input ?? null,
        });
        if (error) throw error;
        return json(data);
      }
      case 'captcha': {
        const events = (Array.isArray(body.events) ? body.events : []).slice(0, 100);
        let recorded = 0;
        for (const e of events) {
          const key = str(e?.idempotencyKey, 200);
          if (!key) continue;
          const { data, error } = await db.rpc('verify_captcha_record', {
            p_idempotency_key: key,
            p_task_id: UUID.test(str(e.taskId, 40)) ? e.taskId : null,
            p_job_id: UUID.test(str(e.jobId, 40)) ? e.jobId : null,
            p_source: str(e.source, 40) || 'unknown',
            p_outcome: str(e.outcome, 40) || 'UNKNOWN',
            // Unknown stays unknown (NULL), never a silent 0.
            p_cost_usd: e.costUsd != null && e.costUsd !== '' && Number.isFinite(Number(e.costUsd)) && Number(e.costUsd) >= 0 ? Number(e.costUsd) : null,
            p_solve_ms: Number.isFinite(Number(e.solveMs)) ? Math.trunc(Number(e.solveMs)) : null,
            p_kind: str(e.kind, 40) || null,
            p_error_code: str(e.errorCode, 80) || null,
            p_provider: str(e.provider, 40) || '2captcha',
          });
          if (error) throw error;
          if (data === true) recorded++;
        }
        return json({ recorded });
      }
      case 'upload': {
        const sha = str(body.sha256, 64);
        if (!SHA256.test(sha)) return json({ error: 'BAD_REQUEST' }, 400);
        // Official TAS visuals go where research-agent and verify-synthesis
        // already read them (tas/<sha>.<ext>); everything else is evidence text.
        const visual = body.contentType === 'image/jpeg' || body.contentType === 'image/png';
        const bucket = visual ? VISUAL_BUCKET : BUCKET;
        const ext = body.contentType === 'image/png' ? 'png' : body.contentType === 'image/jpeg' ? 'jpg' : body.contentType === 'application/json' ? 'json' : 'txt';
        const dir = visual ? 'tas' : `sha256/${sha.slice(0, 2)}`;
        const path = `${dir}/${sha}.${ext}`;
        // Content-addressed: an object that already exists is never re-uploaded.
        const { data: existing } = await db.storage.from(bucket).list(dir, { search: sha, limit: 1 });
        if (existing && existing.length) return json({ path, bucket, exists: true });
        const { data, error } = await db.storage.from(bucket).createSignedUploadUrl(path);
        if (error) {
          if (/exists|duplicate/i.test(String(error.message))) return json({ path, bucket, exists: true });
          throw error;
        }
        return json({ path, bucket, exists: false, signedUrl: data?.signedUrl ?? null, uploadToken: data?.token ?? null });
      }
      case 'metrics': {
        const { data, error } = await db.rpc('verify_queue_metrics');
        if (error) throw error;
        return json(data);
      }
      default:
        return json({ error: 'UNKNOWN_ACTION' }, 400);
    }
  } catch (e) {
    console.error(`verify-queue ${action} failed`, (e as Error)?.message ?? e);
    return json({ error: 'QUEUE_ERROR', retryable: true }, 503);
  }
});
