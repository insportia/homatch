// How a Find Buyers / Find Tenants campaign run ENDS -- one implementation,
// used by match-campaign when it can finish in one request and by the
// discovery driver when the run waited for its source jobs.
//
// Two rules this exists to hold:
//
//   1. THE RESULT IS WHAT THIS RUN FOUND. A run used to report every match the
//      property had ever had ("Matching completed with 74 real matches") when
//      it had created none, and none of the 74 rested on demand from the last
//      30 days. The count here is new matches created by THIS run, on demand
//      inside the active window, and nothing else. Earlier matches that are
//      still current are reported separately and labelled as such.
//
//   2. THE MONEY ENDS EXACTLY ONCE. Settlement charges measured usage against
//      the reservation and releases the rest; a failure releases everything.
//      The driver and match-campaign both call this, and the conditional
//      status update below means only one of them ever gets to.

import { settleExecution, releaseExecution, type ExecutionGrant } from './billing.ts';
import { finishSocialCampaign } from './findBuyers/campaign.ts';
import {
  judgeActiveDemand,
  type ActiveDemandFreshnessPolicy,
} from '../../../src/research-core/discovery/freshness-policy.ts';

type Json = Record<string, unknown>;

export const TERMINAL_JOB_STATUSES = ['completed', 'partially_completed', 'failed', 'cancelled', 'budget_reached'] as const;

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function updateJob(db: any, jobId: string, patch: Json) {
  const { error } = await db.from('matching_jobs').update({
    ...patch,
    updated_at: new Date().toISOString(),
  }).eq('id', jobId);
  if (error) throw error;
}

export async function jobEvent(db: any, jobId: string, eventType: string, payload: Json = {}) {
  const { error } = await db.from('matching_job_events').insert({ job_id: jobId, event_type: eventType, payload });
  if (error) throw error;
}

export async function invokeFunction(
  baseUrl: string,
  serviceKey: string,
  functionName: string,
  body: Json,
  timeout: number,
): Promise<{ status: number; data: any }> {
  const response = await fetch(`${baseUrl}/functions/v1/${functionName}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const text = await response.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
  if (!response.ok && response.status !== 423) {
    throw new Error(`${functionName} ${response.status}: ${data?.error || text.slice(0, 300)}`);
  }
  return { status: response.status, data };
}

/**
 * Claim the right to finish a job. Only the caller whose conditional update
 * moves the job out of `fromStatuses` proceeds; a second driver tick, or a
 * match-campaign racing the driver, gets false and does nothing.
 */
export async function claimJobTransition(
  db: any, jobId: string, fromStatuses: string[], patch: Json,
): Promise<boolean> {
  const { data, error } = await db.from('matching_jobs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .in('status', fromStatuses)
    .select('id');
  if (error) throw error;
  return Array.isArray(data) && data.length === 1;
}

export interface CampaignJobRef {
  id: string;
  property_id: string;
  campaign_id: string | null;
  started_at: string;
}

export interface FinalizeResult {
  status: 'completed' | 'partially_completed';
  freshMatches: number;
  /** FIND BUYERS: potential buyers/tenants from public social demand, this run. */
  socialLeads: number;
  stillCurrentFromEarlier: number;
  creditsCharged: number;
  costUsd: number;
}

/**
 * Count, include, settle, and write the truthful ending. The caller must have
 * already moved the job to 'ranking' through claimJobTransition, so this runs
 * once per job.
 */
export async function finalizeCampaignJob(
  db: any,
  job: CampaignJobRef,
  grant: ExecutionGrant | null,
  policy: ActiveDemandFreshnessPolicy,
  context: { sourceJobs?: Json; internal?: Json; noResultsReason?: string | null } = {},
): Promise<FinalizeResult> {
  /* Social provider runs end FIRST: abort what is still open and book its
     cost, so the cost_events read below (settlement COGS) is complete. */
  await finishSocialCampaign(db, job.id, 'FINALIZE').catch((error) =>
    jobEvent(db, job.id, 'SOCIAL_FINISH_FAILED', { message: errorText(error) }).catch(() => undefined));
  const { count: socialCount } = await db.from('find_buyers_leads')
    .select('id', { count: 'exact', head: true }).eq('matching_job_id', job.id);
  const socialLeads = Number(socialCount ?? 0);
  const now = Date.now();
  const [createdRes, earlierRes, costRes] = await Promise.all([
    db.from('matches').select('id,demand_published_at')
      .eq('property_id', job.property_id).gte('created_at', job.started_at),
    db.from('matches').select('id,demand_published_at')
      .eq('property_id', job.property_id).lt('created_at', job.started_at)
      .in('status', ['NEW', 'PREVIEWED']),
    db.from('cost_events').select('cost_usd')
      .eq('property_id', job.property_id).gte('timestamp', job.started_at),
  ]);
  if (createdRes.error) throw createdRes.error;
  if (earlierRes.error) throw earlierRes.error;
  if (costRes.error) throw costRes.error;

  const current = (row: any) => judgeActiveDemand(row.demand_published_at ?? null, { policy, now }).eligible;
  const created = (createdRes.data ?? []) as any[];
  const freshMatches = created.filter(current).length;
  const stillCurrentFromEarlier = ((earlierRes.data ?? []) as any[]).filter(current).length;
  const costUsd = ((costRes.data ?? []) as any[]).reduce((sum, row) => sum + Number(row.cost_usd || 0), 0);

  /* Results this run produced are opened against the reservation that paid
     for the search, exactly as before the run became asynchronous. */
  if (grant?.reservationId && created.length > 0) {
    const { error } = await db.from('matches')
      .update({ unlock_included_reservation_id: grant.reservationId })
      .in('id', created.map((row) => row.id))
      .is('unlock_included_reservation_id', null)
      .is('unlock_included_allowance_id', null);
    if (error) await jobEvent(db, job.id, 'INCLUDE_MARK_FAILED', { message: error.message }).catch(() => undefined);
  }

  let creditsCharged = 0;
  if (grant) {
    try {
      const settled = await settleExecution(db, grant, {
        provider: 'homatch_matching',
        providerOperation: 'find_clients_search',
        providerRequestId: job.id,
        searchCount: Number((context.sourceJobs as any)?.done ?? 0),
        durationMs: now - new Date(job.started_at).getTime(),
        rawProviderCostCents: costUsd * 100,
        metadata: {
          quality_tier: grant.qualityTier,
          fresh_matches: freshMatches,
          social_leads: socialLeads,
          active_window_days: policy.activeMaxDays,
        },
      }, freshMatches + socialLeads > 0 ? 'SUCCESS' : 'PARTIAL');
      creditsCharged = settled.chargedCredits;
      /* "Expand Research": usage beyond the original reservation is charged to the
         campaign's budget extensions in order; every unused extension credit is
         released. A campaign without extensions makes this a no-op. */
      const beyond = Math.max(0, Number(settled.requestedCredits ?? 0) - settled.chargedCredits);
      const { data: ext, error: extError } = await db.rpc('find_buyers_settle_extensions', {
        p_job_id: job.id, p_remaining_credits: beyond,
      });
      if (extError) {
        await jobEvent(db, job.id, 'EXTENSION_SETTLE_DEFERRED', { message: extError.message }).catch(() => undefined);
      } else {
        creditsCharged += Number((ext as { chargedCredits?: number } | null)?.chargedCredits ?? 0);
      }
    } catch (error) {
      /* The reservation's own expiry sweeper reconciles it; the job still ends. */
      await jobEvent(db, job.id, 'SETTLE_DEFERRED', { message: errorText(error) }).catch(() => undefined);
    }
  }

  const found = freshMatches + socialLeads;
  const status = found > 0 ? 'completed' : 'partially_completed';
  const days = policy.activeMaxDays;
  await updateJob(db, job.id, {
    status,
    progress: 100,
    current_step: found > 0
      ? `Found ${found} new potentially interested people (posted in the last ${days} days)`
      : `No new current demand found (last ${days} days)`,
    matches_created: freshMatches,
    matches_found: freshMatches,
    fresh_matches_created: freshMatches,
    candidates_after_filter: freshMatches,
    cost_usd_total: costUsd,
    failure_reason: found > 0 ? null : (context.noResultsReason ?? 'NO_CURRENT_DEMAND_FOUND'),
    completed_at: new Date().toISOString(),
  });
  await jobEvent(db, job.id, 'JOB_COMPLETE', {
    message: freshMatches > 0
      ? `Found ${freshMatches} new potentially interested people whose demand is from the last ${days} days`
      : `No new potentially interested people with demand from the last ${days} days`,
    freshMatches,
    socialLeads,
    stillCurrentFromEarlier,
    activeWindowDays: days,
    creditsCharged,
    costUsd,
    sourceJobs: context.sourceJobs ?? null,
    internal: context.internal ?? null,
  });

  return { status, freshMatches, socialLeads, stillCurrentFromEarlier, creditsCharged, costUsd };
}

/** End a job that could not finish: release the whole reservation, say why. */
export async function failCampaignJob(
  db: any, job: CampaignJobRef, grant: ExecutionGrant | null, reason: string, detail: string,
  status: 'failed' | 'budget_reached' | 'cancelled' = 'failed',
) {
  /* Open provider runs are aborted and their cost booked (HOMATCH absorbs it:
     the customer's whole reservation is released below). */
  await finishSocialCampaign(db, job.id, reason).catch(() => undefined);
  if (grant) await releaseExecution(db, grant, reason.toLowerCase()).catch(() => undefined);
  /* A failed search keeps none of its budget extensions either. */
  await db.rpc('find_buyers_settle_extensions', { p_job_id: job.id, p_remaining_credits: 0 })
    .then(() => undefined, () => undefined);
  await db.from('discovery_query_queue')
    .update({ status: 'CANCELLED', cancel_reason: reason, finished_at: new Date().toISOString(), lease_expires_at: null })
    .eq('matching_job_id', job.id)
    .in('status', ['PENDING', 'RETRY_WAIT']);
  await updateJob(db, job.id, {
    status,
    progress: 100,
    current_step: status === 'budget_reached' ? 'Stopped at the budget you set'
      : reason === 'DISCOVERY_UNAVAILABLE' ? 'The search could not start' : 'The search could not finish',
    failure_reason: reason,
    error_message: detail.slice(0, 1000),
    completed_at: new Date().toISOString(),
  }).catch(() => undefined);
  await jobEvent(db, job.id, status === 'budget_reached' ? 'BUDGET_REACHED' : 'JOB_FAILED', { reason, message: detail })
    .catch(() => undefined);
}
