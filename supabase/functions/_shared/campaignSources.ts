// A campaign's SOURCE JOBS: what gets queued when current internal demand
// falls short, and how the discovery driver executes one.
//
// Three kinds, all rows in discovery_query_queue with matching_job_id set:
//
//   TELEGRAM          read the enabled public Telegram targets now (the
//                     official worker's MTProto session, through community-sync)
//   TELEGRAM_SOURCES  search Telegram for public communities in the campaign's
//                     languages and audit them (never joins anything)
//   FORUM             read the permitted forum boards (demand-discovery)
//
// Provider cost of every kind is zero: Telegram and the forums charge nothing
// per request. Classification of what they collect is metered separately.
//
// The worker functions are called with the service key and `source: 'campaign'`,
// so each still applies its own admin switch; a switch turned off between
// queueing and execution cancels the job rather than running it.

import { sourceQueriesFor } from '../../../src/research-core/discovery/telegram-sources.ts';
import { invokeFunction, errorText } from './campaignRun.ts';

export type SourceProvider = 'TELEGRAM' | 'TELEGRAM_SOURCES' | 'FORUM';

export interface QueuedSource { provider: SourceProvider; id: string }

export async function queueCampaignSourceJobs(
  db: any,
  opts: {
    jobId: string;
    propertyId: string;
    languages: string[];
    telegram: boolean;
    forum: boolean;
    countryCode: string;
  },
): Promise<QueuedSource[]> {
  const market = (opts.countryCode || 'GE').toUpperCase();
  const rows: Record<string, unknown>[] = [];
  const base = {
    property_id: opts.propertyId,
    matching_job_id: opts.jobId,
    status: 'PENDING',
    estimated_cost_usd: 0,
  };
  if (opts.telegram) {
    rows.push({
      ...base, platform: 'TELEGRAM', language: 'multi', provider: 'TELEGRAM',
      query: `sync:${opts.jobId}`, query_kind: 'CAMPAIGN_SYNC', priority: 70,
      metadata: { market },
    });
    const queries = sourceQueriesFor(market, opts.languages).map((q) => q.query);
    if (queries.length) {
      rows.push({
        ...base, platform: 'TELEGRAM', language: opts.languages.join(',') || 'multi', provider: 'TELEGRAM_SOURCES',
        query: `discover:${opts.jobId}`, query_kind: 'SOURCE_DISCOVERY', priority: 60,
        metadata: { market, languages: opts.languages, queries },
      });
    }
  }
  if (opts.forum) {
    rows.push({
      ...base, platform: 'FORUM', language: 'multi', provider: 'FORUM',
      query: `forum:${opts.jobId}`, query_kind: 'CAMPAIGN_FORUM', priority: 65,
      metadata: { market },
    });
  }
  if (!rows.length) return [];
  const { data, error } = await db.from('discovery_query_queue').insert(rows).select('id,provider');
  if (error) throw error;
  return ((data ?? []) as Array<{ id: string; provider: SourceProvider }>).map((r) => ({ id: r.id, provider: r.provider }));
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
  job: { id: string; provider: string | null; matching_job_id: string | null; metadata: any },
): Promise<SourceOutcome> {
  const provider = String(job.provider ?? '').toUpperCase();
  const trace = `campaign-${String(job.matching_job_id ?? job.id).slice(0, 8)}`;
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
