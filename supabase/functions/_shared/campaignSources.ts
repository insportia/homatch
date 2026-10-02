// A campaign's SOURCE JOBS: what gets queued when current internal demand
// falls short, and how the discovery driver executes one.
//
// Four kinds, rows in discovery_query_queue owned by a matching job (FIND
// BUYERS/TENANTS) or a discovery run (FIND PROPERTY), derived from the run's
// stored DiscoveryPlan (src/research-core/discovery/discovery-plan.ts):
//
//   TELEGRAM          read the enabled public Telegram targets now (the
//                     official worker's MTProto session, through community-sync)
//   TELEGRAM_SOURCES  search Telegram for public communities in the campaign's
//                     languages and audit them (never joins anything)
//   FORUM             read the permitted forum boards (demand-discovery)
//   PORTAL            read one live portal adapter for a SUPPLY plan (supply-discovery)
//
// Provider cost of every kind is zero: Telegram and the forums charge nothing
// per request. Classification of what they collect is metered separately.
//
// The worker functions are called with the service key and `source: 'campaign'`,
// so each still applies its own admin switch; a switch turned off between
// queueing and execution cancels the job rather than running it.

import { type DiscoveryPlan, plannedSourceJobs } from '../../../src/research-core/discovery/discovery-plan.ts';
import { invokeFunction, errorText } from './campaignRun.ts';

export type SourceProvider = 'TELEGRAM' | 'TELEGRAM_SOURCES' | 'FORUM' | 'PORTAL';

export interface QueuedSource { provider: SourceProvider; id: string }

/** Store a run's DiscoveryPlan. Every run has one, even when nothing is queued. */
export async function storePlan(
  db: any,
  opts: { plan: DiscoveryPlan; userId: string; matchingJobId?: string | null; discoveryRunId?: string | null },
): Promise<string> {
  const { data, error } = await db.from('discovery_search_plans').insert({
    direction: opts.plan.direction,
    user_id: opts.userId,
    matching_job_id: opts.matchingJobId ?? null,
    discovery_run_id: opts.discoveryRunId ?? null,
    market: opts.plan.market,
    plan: opts.plan,
    plan_version: opts.plan.version,
  }).select('id').single();
  if (error) throw error;
  return String(data.id);
}

/**
 * Queue the source jobs a plan implies (plannedSourceJobs is the only place
 * their shape is decided). Each row carries a dedupe key derived from the run,
 * so a retried request finds the rows it already queued instead of adding a
 * second set.
 */
export async function queuePlannedJobs(
  db: any,
  opts: {
    plan: DiscoveryPlan;
    planId: string;
    runKey: string;
    matchingJobId?: string | null;
    discoveryRunId?: string | null;
    propertyId?: string | null;
  },
): Promise<QueuedSource[]> {
  const planned = plannedSourceJobs(opts.plan, opts.runKey);
  if (!planned.length) return [];
  const rows = planned.map((job) => ({
    property_id: opts.propertyId ?? null,
    matching_job_id: opts.matchingJobId ?? null,
    discovery_run_id: opts.discoveryRunId ?? null,
    search_plan_id: opts.planId,
    search_direction: opts.plan.direction,
    tranche: job.tranche,
    executor: job.executor,
    dedupe_key: job.dedupeKey,
    status: 'PENDING',
    platform: job.platform,
    language: job.language,
    provider: job.provider,
    query: job.dedupeKey,
    query_kind: job.queryKind,
    priority: job.priority,
    metadata: job.metadata,
    /* Native routes charge nothing per request; compute and AI are metered
       where they happen, never assumed zero. */
    estimated_cost_usd: 0,
  }));
  const { data, error } = await db.from('discovery_query_queue').insert(rows).select('id,provider');
  if (error && String(error.code) !== '23505') throw error;
  if (!error) {
    return ((data ?? []) as Array<{ id: string; provider: SourceProvider }>).map((r) => ({ id: r.id, provider: r.provider }));
  }
  /* A replay: return what the first request queued. */
  const { data: existing, error: readError } = await db.from('discovery_query_queue')
    .select('id,provider').in('dedupe_key', planned.map((job) => job.dedupeKey));
  if (readError) throw readError;
  return ((existing ?? []) as Array<{ id: string; provider: SourceProvider }>).map((r) => ({ id: r.id, provider: r.provider }));
}

export interface SourceOutcome {
  outcome: 'DONE' | 'RETRY' | 'FAILED' | 'CANCELLED';
  resultCount: number;
  error: string | null;
  retrySeconds: number | null;
  metadata: Record<string, unknown>;
}

/** Integration failures that retrying cannot fix without an operator. */
const PERMANENT = new Set(['NOT_CONFIGURED', 'DISABLED', 'AUTH_FAILED']);

export async function executeSourceJob(
  baseUrl: string,
  serviceKey: string,
  job: { id: string; provider: string | null; matching_job_id: string | null; discovery_run_id?: string | null; executor?: string | null; metadata: any },
): Promise<SourceOutcome> {
  const provider = String(job.provider ?? '').toUpperCase();
  const trace = `campaign-${String(job.matching_job_id ?? job.discovery_run_id ?? job.id).slice(0, 8)}`;
  try {
    if (provider === 'TELEGRAM') {
      const { data } = await invokeFunction(baseUrl, serviceKey, 'community-sync',
        { action: 'sync', source: 'campaign', maxTargets: 10, trace }, 150_000);
      if (data?.skipped) return cancelled(String(data.skipped));
      const failure = data?.integrationFailure as { kind?: string; detail?: string; retryAfterSeconds?: number | null } | null;
      if (failure?.kind) {
        if (PERMANENT.has(failure.kind)) return failed(`TELEGRAM_${failure.kind}`);
        return retry(`TELEGRAM_${failure.kind}`, failure.retryAfterSeconds ?? 120);
      }
      return done(Number(data?.totals?.newMessages ?? 0) + Number(data?.totals?.changedMessages ?? 0), {
        targetsConsidered: Number(data?.targetsConsidered ?? 0),
        synced: Number(data?.synced ?? 0),
        newMessages: Number(data?.totals?.newMessages ?? 0),
      });
    }

    if (provider === 'TELEGRAM_SOURCES') {
      const queries: string[] = Array.isArray(job.metadata?.queries) ? job.metadata.queries.map(String) : [];
      const { data } = await invokeFunction(baseUrl, serviceKey, 'community-sync',
        { action: 'discover', source: 'campaign', queries, maxQueries: Math.min(6, queries.length || 6), trace }, 150_000);
      if (data?.skipped) return cancelled(String(data.skipped));
      if (data?.stoppedBy) {
        const kind = String(data.stoppedBy);
        if (PERMANENT.has(kind)) return failed(`TELEGRAM_${kind}`);
        if (kind === 'RATE_LIMITED') return retry('TELEGRAM_RATE_LIMITED', 300);
      }
      return done(Number(data?.newlyRegistered ?? 0), {
        queriesRun: Number(data?.queriesRun ?? 0),
        communitiesFound: Number(data?.communitiesFound ?? 0),
        newlyRegistered: Number(data?.newlyRegistered ?? 0),
      });
    }

    if (provider === 'FORUM') {
      const { data } = await invokeFunction(baseUrl, serviceKey, 'demand-discovery',
        { source: 'campaign', maxThreads: 3 }, 150_000);
      if (data?.skipped) return cancelled(String(data.skipped));
      return done(Number(data?.signalsNew ?? 0), {
        postsRead: Number(data?.postsRead ?? 0),
        signalsNew: Number(data?.signalsNew ?? 0),
        sourcesPermitted: Number(data?.sourcesPermitted ?? 0),
      });
    }

    if (provider === 'PORTAL') {
      const meta = job.metadata ?? {};
      const { data } = await invokeFunction(baseUrl, serviceKey, 'supply-discovery', {
        mode: 'portal-job', adapterId: meta.adapterId, subject: meta.subject, executor: job.executor ?? 'EDGE',
        runId: job.discovery_run_id ?? null, limitPerSource: 6, trace,
      }, 150_000);
      const kind = String(data?.outcome ?? '');
      if (kind === 'OK') {
        return done(Number(data?.observations ?? 0), {
          adapterId: meta.adapterId, parsed: Number(data?.parsed ?? 0),
          discovered: Number(data?.discovered ?? 0), reused: Number(data?.reused ?? 0),
          networkRequests: data?.networkRequests ?? null, entitiesTouched: data?.resolution?.entitiesTouched ?? null,
        });
      }
      /* Not live, not supported, no adapter, a malformed job: retrying cannot help. */
      if (['SOURCE_NOT_LIVE', 'ADAPTER_MISSING', 'UNSUPPORTED', 'BAD_JOB'].includes(kind)) {
        return failed(`PORTAL_${kind}`);
      }
      /* A refusal or an error from the site: bounded retry with backoff. */
      return retry(`PORTAL_${kind || 'ERROR'}: ${String(data?.detail ?? data?.error ?? '').slice(0, 200)}`, 300);
    }

    /* Retired or unknown providers are never executed. The claim function
       does not hand them out; this is the second lock on the same door. */
    return failed(`UNSUPPORTED_PROVIDER: ${provider || 'none'}`);
  } catch (error) {
    return retry(errorText(error).slice(0, 300), 60);
  }
}

const done = (resultCount: number, metadata: Record<string, unknown>): SourceOutcome =>
  ({ outcome: 'DONE', resultCount, error: null, retrySeconds: null, metadata });
const retry = (error: string, retrySeconds: number): SourceOutcome =>
  ({ outcome: 'RETRY', resultCount: 0, error, retrySeconds, metadata: {} });
const failed = (error: string): SourceOutcome =>
  ({ outcome: 'FAILED', resultCount: 0, error, retrySeconds: null, metadata: {} });
const cancelled = (reason: string): SourceOutcome =>
  ({ outcome: 'CANCELLED', resultCount: 0, error: reason, retrySeconds: null, metadata: {} });
