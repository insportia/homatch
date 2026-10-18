// FIND PROPERTY CAPACITY — one portal run per identical request, and a limit on NEW LIVE
// portal searches only (migration 20261116090000_find_property_capacity.sql).
//
// The portal runtimes read one or two searches at a time, so the platform can run roughly
// 25–60 fresh portal searches an hour. Every search answers at once from HOMATCH's shared
// listing pool (serveCachedListings); this module decides, per source, whether it also needs a
// portal run of its own:
//
//   REUSED   an identical request finished < 30 min ago: answered from that run
//   SHARED   an identical request is being read now: a follower of that run (never claimed)
//   LIVE     a new portal run (the only thing the per-user quota counts)
//   LIVE_REFRESH_LIMIT   this customer's live quota is used: the pool answers, with the time it frees up
//   SOURCE_BUSY          the portal's queue could not finish it before its deadline: the pool answers now
//   LIVE_REFRESH_UNAVAILABLE  the dispatch itself could not run: the pool answers, nothing goes live
//
// Followers are answered from the leader's fresh listings BY REFERENCE (resolveSharedRuns +
// sharedListingRows): a thousand identical searches never copy a portal's rows a thousand times.
// Free search only: nothing here reserves, charges or settles.

// deno-lint-ignore no-explicit-any
type Db = any;

const RUNS = 'discovery_marketplace_worker_runs';
const TERMINAL = ['COMPLETE', 'PARTIAL', 'FAILED', 'TIMED_OUT', 'BLOCKED'];

/** The live-search quota the migration enforces (mirrored here for the UI and tests). */
export const LIVE_SEARCH_LIMITS = {
  NORMAL: { concurrent: 3, perHour: 20, perDay: 100 },
  SUSPICIOUS: { concurrent: 1, perHour: 5, perDay: 20 },
  /** Live searches from one IP in an hour before an unestablished account on it is treated as suspicious. */
  ipSoftPerHour: 60,
} as const;

/** Codes of a source answered from the pool instead of a portal run of its own. */
export const DEFERRED_CODES = ['LIVE_REFRESH_LIMIT', 'SOURCE_BUSY', 'LIVE_REFRESH_UNAVAILABLE'] as const;
export type DeferredCode = typeof DEFERRED_CODES[number];
export type DispatchMode = 'LIVE' | 'SHARED' | 'REUSED' | DeferredCode;

export interface DispatchOutcome {
  tier: string;
  live: number;
  limit: { reason: 'CONCURRENT' | 'HOURLY' | 'DAILY'; retryAt: string | null; maxActive: number } | null;
  degraded: boolean;
  runs: Array<{ id?: string; workerId: string; mode: DispatchMode; retryAt: string | null }>;
}

/** The caller's address as the edge sees it (first hop of X-Forwarded-For). Used only as a soft signal. */
export function clientIp(req: Request): string | null {
  const first = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || (req.headers.get('cf-connecting-ip') ?? '').trim();
  return first ? first.slice(0, 64) : null;
}

/**
 * Create this search's worker runs. One transaction decides every source and the quota
 * (marketplace_dispatch_search). If it cannot run, nothing goes live: every source is closed
 * at once and answered from the pool, so the customer still gets every listing HOMATCH has.
 */
export async function dispatchSearch(db: Db, a: {
  searchId: string; userId: string; ip: string | null;
  runs: Array<{ workerId: string; request: unknown; requestKey: string; deadlineAt: string }>;
}, now = new Date()): Promise<DispatchOutcome> {
  try {
    const { data, error } = await db.rpc('marketplace_dispatch_search', {
      p_search_id: a.searchId, p_user_id: a.userId, p_ip: a.ip,
      p_runs: a.runs.map((r) => ({ worker_id: r.workerId, request: r.request, request_key: r.requestKey, deadline_at: r.deadlineAt })),
    });
    if (error || !data) throw error ?? new Error('no dispatch decision');
    return { tier: String(data.tier), live: Number(data.live) || 0, limit: data.limit ?? null, degraded: false, runs: data.runs ?? [] };
  } catch (error) {
    console.error(JSON.stringify({ event: 'marketplace_dispatch_degraded', searchId: a.searchId, message: String((error as Error)?.message ?? error).slice(0, 200) }));
    const at = now.toISOString();
    const { error: insertError } = await db.from(RUNS).insert(a.runs.map((r) => ({
      search_id: a.searchId, worker_id: r.workerId, request: r.request, deadline_at: r.deadlineAt, request_key: r.requestKey,
      status: 'TIMED_OUT', completed_at: at, errors: [{ code: 'LIVE_REFRESH_UNAVAILABLE', message: '' }],
      query_applied: { deferred: 'LIVE_REFRESH_UNAVAILABLE' }, pool_pending: true,
    })));
    if (insertError) throw new Error(`degraded dispatch failed: ${insertError.message}`);
    return { tier: 'UNKNOWN', live: 0, limit: null, degraded: true, runs: a.runs.map((r) => ({ workerId: r.workerId, mode: 'LIVE_REFRESH_UNAVAILABLE', retryAt: null })) };
  }
}

/** What the customer is told about live portal refresh for a new search. */
export function liveRefreshOf(o: DispatchOutcome): { state: 'LIVE' | 'LIMITED' | 'BUSY' | 'UNAVAILABLE'; reason?: string; retryAt?: string | null; maxActive?: number } {
  if (o.degraded) return { state: 'UNAVAILABLE' };
  if (o.limit && o.runs.some((r) => r.mode === 'LIVE_REFRESH_LIMIT')) return { state: 'LIMITED', reason: o.limit.reason, retryAt: o.limit.retryAt, maxActive: o.limit.maxActive };
  if (o.runs.length && o.runs.every((r) => r.mode === 'SOURCE_BUSY')) {
    const at = o.runs.map((r) => r.retryAt).filter(Boolean).sort()[0] ?? null;
    return { state: 'BUSY', retryAt: at };
  }
  return { state: 'LIVE' };
}

/**
 * Resolve this search's follower runs whose leader has finished: each takes the leader's
 * status and counts (its listings are read by reference). A leader that disappeared or ran
 * past its deadline closes its followers so the pool answers them. Guarded on QUEUED, so a
 * concurrent settle never applies twice. Mutates the rows' status like reapRuns.
 */
export async function resolveSharedRuns(db: Db, runRows: Array<Record<string, unknown>>, now = new Date()): Promise<number> {
  const waiting = runRows.filter((r) => r.shared_run_id && r.status === 'QUEUED');
  if (!waiting.length) return 0;
  const { data: leaders } = await db.from(RUNS)
    .select('id,search_id,status,returned_count,discovered_count,errors,query_applied,completed_at,deadline_at')
    .in('id', [...new Set(waiting.map((r) => String(r.shared_run_id)))]);
  const byId = new Map<string, Record<string, unknown>>((leaders ?? []).map((l: Record<string, unknown>) => [String(l.id), l] as [string, Record<string, unknown>]));
  let settled = 0;
  for (const f of waiting) {
    const leader = byId.get(String(f.shared_run_id));
    let update: Record<string, unknown> | null = null;
    if (!leader) {
      update = { status: 'TIMED_OUT', errors: [{ code: 'SHARED_RUN_GONE', message: '' }] };
    } else if (TERMINAL.includes(String(leader.status))) {
      /* The searcher whose run this was cancelled: the run passes to the oldest follower instead. */
      if (((leader.errors as Array<{ code?: string }>) ?? []).some((e) => e?.code === 'CANCELLED_BY_CUSTOMER')) {
        await db.rpc('marketplace_hand_over_shared_runs', { p_search_id: leader.search_id });
        continue;
      }
      update = {
        status: leader.status, returned_count: Number(leader.returned_count) || 0, discovered_count: Number(leader.discovered_count) || 0,
        errors: leader.errors ?? [],
        query_applied: { ...((leader.query_applied ?? {}) as Record<string, unknown>), sharedFromRun: leader.id, sharedCheckedAt: leader.completed_at },
      };
    } else if (Date.parse(String(leader.deadline_at)) <= now.getTime()) {
      update = { status: 'TIMED_OUT', errors: [{ code: 'DEADLINE', message: '' }], query_applied: { sharedFromRun: leader.id } };
    }
    if (!update) continue;
    const { data } = await db.from(RUNS).update({ ...update, lease_expires_at: null, completed_at: now.toISOString(), updated_at: now.toISOString() })
      .eq('id', f.id).eq('status', 'QUEUED').select('id,status');
    if (data?.length) {
      Object.assign(f, { status: update.status, returned_count: update.returned_count ?? 0, query_applied: update.query_applied ?? f.query_applied });
      settled++;
    }
  }
  return settled;
}

/** The leader runs whose fresh listings these runs share: leader run id → the follower's worker. */
export function sharedLeaders(runRows: Array<Record<string, unknown>>): Map<string, string> {
  return new Map(runRows
    .filter((r) => r.shared_run_id && ['COMPLETE', 'PARTIAL'].includes(String(r.status)) && Number(r.returned_count) > 0)
    .map((r) => [String(r.shared_run_id), String(r.worker_id)] as [string, string]));
}

export interface ListingRow { raw: { retrievalMetadata?: { observationLevel?: string } } & Record<string, unknown>; worker_run_id: string; source_key: string; source_listing_id: string }

/** Every fresh listing the leader runs reported, paged (never their own pool copies). */
export async function sharedListingRows(db: Db, leaderIds: string[], pageRows = 1000): Promise<ListingRow[]> {
  const out: ListingRow[] = [];
  if (!leaderIds.length) return out;
  for (let from = 0; ; from += pageRows) {
    const { data, error } = await db.from('discovery_marketplace_listings').select('raw,worker_run_id,source_key,source_listing_id')
      .in('worker_run_id', leaderIds).order('created_at', { ascending: true }).order('id', { ascending: true }).range(from, from + pageRows - 1);
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as ListingRow[]).filter((r) => r.raw?.retrievalMetadata?.observationLevel !== 'CACHED'));
    if (!data || data.length < pageRows) return out;
  }
}

/** One row per listing: a fresh observation replaces a pool (CACHED) copy of the same listing. */
export function mergeListingRows(own: ListingRow[], shared: ListingRow[]): ListingRow[] {
  const key = (r: ListingRow) => `${r.source_key}:${r.source_listing_id}`;
  const cached = (r: ListingRow) => r.raw?.retrievalMetadata?.observationLevel === 'CACHED';
  const out = new Map<string, ListingRow>();
  for (const r of [...own, ...shared]) {
    const prior = out.get(key(r));
    if (!prior || (cached(prior) && !cached(r))) out.set(key(r), r);
  }
  return [...out.values()];
}
