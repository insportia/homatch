// Retention access guard for service-role routes (docs/infra/STORAGE_RETENTION.md §6).
//
// RLS gates every user-client read of an expired Verify report or Contracts
// document. A route that reads with the SERVICE ROLE bypasses RLS, so it asks
// the same server-side rule explicitly: public.retention_access_blocked, the
// one place that knows a record's expiry. This file decides nothing itself.
//
// Before the retention migration exists the RPC is missing; then nothing can
// be expired and the guard allows. Any OTHER failure fails closed: a report
// whose expiry cannot be checked is not served.

export type RetentionProduct = 'VERIFY_REPORT' | 'CONTRACT_DOCUMENT';

interface RpcError { code?: string; message?: string }
export interface RpcClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: RpcError | null }>;
}

export class RetentionCheckUnavailable extends Error {}

/** PostgREST "function not in schema cache" / Postgres "undefined function". */
const missingFunction = (e: RpcError | null) => e?.code === 'PGRST202' || e?.code === '42883';

export async function retentionBlocked(sb: RpcClient, product: RetentionProduct, id: string): Promise<boolean> {
  const { data, error } = await sb.rpc('retention_access_blocked', { p_product: product, p_source_id: id });
  if (error) {
    if (missingFunction(error)) return false;
    throw new RetentionCheckUnavailable(error.code ?? 'rpc_failed');
  }
  return data === true;
}

/** The subset of ids whose retention has expired (one round trip). */
export async function retentionBlockedIds(sb: RpcClient, product: RetentionProduct, ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const { data, error } = await sb.rpc('retention_blocked_ids', { p_product: product, p_ids: ids });
  if (error) {
    if (missingFunction(error)) return new Set();
    throw new RetentionCheckUnavailable(error.code ?? 'rpc_failed');
  }
  return new Set(Array.isArray(data) ? data.map(String) : []);
}

/**
 * For a job row a route is about to serve: null when it may be served, or the
 * refusal to return. Only COMPLETE reports are ever registered, so a running
 * job costs nothing here — no round trip on the polling path.
 */
export async function expiredReportRefusal(
  sb: RpcClient, job: { id: string; status?: string | null } | null,
  respond: (body: unknown, status: number) => Response,
): Promise<Response | null> {
  if (!job || job.status !== 'COMPLETE') return null;
  try {
    return (await retentionBlocked(sb, 'VERIFY_REPORT', job.id))
      ? respond({ error: 'report_expired', code: 'REPORT_EXPIRED' }, 410)
      : null;
  } catch {
    return respond({ error: 'retention_check_unavailable', code: 'RETENTION_CHECK_UNAVAILABLE' }, 503);
  }
}

/** Same refusal by id, for routes that hold no job row (status unknown → asked). */
export async function expiredReportRefusalById(
  sb: RpcClient, jobId: string, respond: (body: unknown, status: number) => Response,
): Promise<Response | null> {
  try {
    return (await retentionBlocked(sb, 'VERIFY_REPORT', jobId))
      ? respond({ error: 'report_expired', code: 'REPORT_EXPIRED' }, 410)
      : null;
  } catch {
    return respond({ error: 'retention_check_unavailable', code: 'RETENTION_CHECK_UNAVAILABLE' }, 503);
  }
}
