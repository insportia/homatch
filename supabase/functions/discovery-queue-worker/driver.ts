// THE DISCOVERY DRIVER -- the minute tick that carries an asynchronous
// campaign from "sources queued" to a settled, truthful ending.
//
// Each tick does three bounded things and returns:
//
//   1. RECOVER + EXECUTE source jobs. claim_discovery_source_jobs first puts
//      back any job whose lease ran out (its worker died), then leases a few
//      runnable ones. Each is executed through the worker function that owns
//      it and finished with its claim token, so a job is never finished by a
//      caller that no longer holds it.
//
//   2. ADVANCE campaigns whose source jobs are all terminal, or whose
//      deadline has passed: classify what was collected, match again under the
//      30-day rule, settle the reservation and write the ending. The move out
//      of 'searching_sources' is a conditional update, so two overlapping ticks
//      cannot both finish -- or both charge -- the same campaign.
//
//   3. RESCUE campaigns stuck mid-finish (a tick that died between
//      'classifying' and the ending): release the reservation and say so.
//
// The driver never calls a retired provider, holds no provider credentials,
// and does nothing at all while campaign source discovery is switched off
// and no campaign is waiting.

import type { ExecutionGrant } from '../_shared/billing.ts';
import { loadDiscoverySettings, type DiscoverySettings } from '../_shared/discoverySettings.ts';
import { markLanguagesDiscovered } from '../_shared/campaignLanguages.ts';
import {
  claimJobTransition, errorText, failCampaignJob, finalizeCampaignJob, invokeFunction, jobEvent, updateJob,
  type CampaignJobRef,
} from '../_shared/campaignRun.ts';
import { executeSourceJob } from '../_shared/campaignSources.ts';
import {
  claimRunTransition, failDiscoveryRun, finalizeDiscoveryRun, runEvent, updateRun, type RunRef,
} from '../_shared/discoveryRun.ts';
import { fetchCurrentFx } from '../_shared/fx.ts';
import { sourceGroupOf } from '../../../src/research-core/discovery/discovery-plan.ts';

const OPEN_SOURCE_STATES = ['PENDING', 'PROCESSING', 'RETRY_WAIT'];
const STUCK_AFTER_MS = 12 * 60_000;

export async function drive(db: any, baseUrl: string, serviceKey: string, body: any) {
  const started = Date.now();
  const settings = await loadDiscoverySettings(db);
  const report: Record<string, unknown> = { mode: 'drive' };

  /* One source job per tick: jobs run one after another and each may take
     up to ~150s, so claiming more than one would let the later leases lapse
     and the same job be claimed twice. The driver ticks every minute. */
  report.sourceJobs = await runSourceJobs(db, baseUrl, serviceKey, settings, Math.min(5, Number(body.limit) || 1), 'EDGE');
  /* Portal jobs routed through the official worker: same claim, same lease;
     the network hop is the worker's (supply-discovery picks the transport). */
  if (settings.workerRouteEnabled) {
    report.workerRoutedJobs = await runSourceJobs(db, baseUrl, serviceKey, settings, 1, 'WORKER');
  }
  report.campaigns = await advanceCampaigns(db, baseUrl, serviceKey, settings, started);
  report.runs = await advanceRuns(db, baseUrl, serviceKey, started);
  report.pauseExpired = await expirePausedCampaigns(db);
  report.runPauseExpired = await expirePausedRuns(db);
  report.rescued = await rescueStuck(db);
  report.runsRescued = await rescueStuckRuns(db);
  report.elapsedMs = Date.now() - started;
  return { success: true, ...report };
}

async function runSourceJobs(
  db: any, baseUrl: string, serviceKey: string, settings: DiscoverySettings, limit: number, executor: 'EDGE' | 'WORKER',
) {
  /* v2: one job per run per pass (a large campaign cannot monopolise the
     queue), per-provider concurrency caps, and only EDGE-executor jobs --
     WORKER jobs are leased by the official Railway worker. */
  const { data: claimed, error } = await db.rpc('claim_discovery_source_jobs_v2', {
    p_limit: limit,
    p_lease_seconds: settings.sourceJobLeaseSeconds,
    p_max_attempts: settings.sourceJobMaxAttempts,
    p_executor: executor,
    p_providers: executor === 'WORKER' ? ['PORTAL'] : null,
  });
  if (error) throw error;
  const results: Array<Record<string, unknown>> = [];
  for (const job of (claimed ?? []) as any[]) {
    const outcome = await executeSourceJob(baseUrl, serviceKey, job);
    const { data: finalStatus, error: finishError } = await db.rpc('finish_discovery_source_job', {
      p_job_id: job.id,
      p_claim_token: job.claim_token,
      p_outcome: outcome.outcome,
      p_result_count: outcome.resultCount,
      p_cost_usd: 0,
      p_error: outcome.error,
      p_retry_seconds: outcome.retrySeconds,
      p_max_attempts: settings.sourceJobMaxAttempts,
      p_metadata: { last_outcome: outcome.metadata },
    });
    results.push({
      id: job.id, provider: job.provider, outcome: outcome.outcome,
      status: finishError ? `FINISH_FAILED: ${finishError.message}` : finalStatus,
      resultCount: outcome.resultCount, error: outcome.error,
    });
    if (job.discovery_run_id) {
      await runEvent(db, job.discovery_run_id, 'SOURCE_JOB_FINISHED', {
        sourceGroup: sourceGroupOf(String(job.provider)), status: finalStatus ?? null,
        resultCount: outcome.resultCount,
      }).catch(() => undefined);
    }
    if (job.matching_job_id) {
      await jobEvent(db, job.matching_job_id, 'SOURCE_JOB_FINISHED', {
        provider: job.provider, status: finalStatus ?? null, resultCount: outcome.resultCount,
        error: outcome.error, providerCostUsd: 0,
      }).catch(() => undefined);
    }
  }
  return results;
}

async function advanceCampaigns(db: any, baseUrl: string, serviceKey: string, settings: DiscoverySettings, started: number) {
  const { data: waiting, error } = await db.from('matching_jobs')
    .select('id,property_id,campaign_id,started_at,discovery_deadline_at,billing_grant,search_languages')
    .eq('status', 'searching_sources')
    .not('discovery_deadline_at', 'is', null)
    .order('discovery_deadline_at', { ascending: true })
    .limit(3);
  if (error) throw error;

  const results: Array<Record<string, unknown>> = [];
  for (const row of (waiting ?? []) as any[]) {
    /* Stay inside one edge invocation's budget. */
    if (Date.now() - started > 25_000) break;
    const job: CampaignJobRef = { id: row.id, property_id: row.property_id, campaign_id: row.campaign_id, started_at: row.started_at };
    const grant = (row.billing_grant ?? null) as ExecutionGrant | null;

    const { data: sources, error: sourcesError } = await db.from('discovery_query_queue')
      .select('id,provider,status,result_count').eq('matching_job_id', row.id);
    if (sourcesError) throw sourcesError;
    const list = (sources ?? []) as any[];
    const open = list.filter((s) => OPEN_SOURCE_STATES.includes(s.status));
    const pastDeadline = Date.parse(row.discovery_deadline_at) <= Date.now();
    if (open.length > 0 && !pastDeadline) {
      await updateJob(db, row.id, {
        progress: Math.min(80, 45 + Math.round(35 * (list.length - open.length) / Math.max(1, list.length))),
        current_step: `Searching sources for current demand (${list.length - open.length} of ${list.length} done)`,
      }).catch(() => undefined);
      results.push({ jobId: row.id, waiting: open.length });
      continue;
    }

    /* The reservation must still be held. One that expired was released by
       the billing sweeper, and finishing would settle against nothing. */
    if (grant?.reservationId) {
      const { data: reservation } = await db.from('usage_reservations')
        .select('status').eq('id', grant.reservationId).maybeSingle();
      if (reservation && reservation.status !== 'RESERVED') {
        if (await claimJobTransition(db, row.id, ['searching_sources'], { status: 'ranking' })) {
          await failCampaignJob(db, job, null, 'RESERVATION_NOT_HELD',
            `the campaign budget reservation is ${reservation.status}; nothing was charged`, 'budget_reached');
        }
        results.push({ jobId: row.id, ended: 'RESERVATION_NOT_HELD' });
        continue;
      }
    }

    if (!(await claimJobTransition(db, row.id, ['searching_sources'], {
      status: 'classifying', progress: 82, current_step: 'Reading what the sources collected',
    }))) {
      continue;
    }

    try {
      if (open.length > 0) {
        await db.from('discovery_query_queue')
          .update({ status: 'CANCELLED', cancel_reason: 'CAMPAIGN_DEADLINE', finished_at: new Date().toISOString() })
          .eq('matching_job_id', row.id).in('status', ['PENDING', 'RETRY_WAIT']);
        await jobEvent(db, row.id, 'SOURCE_DISCOVERY_DEADLINE', {
          message: 'The search window closed before every source answered; the campaign finished with what arrived',
          stillOpen: open.length,
        });
      }
      const summary = {
        total: list.length,
        done: list.filter((s) => s.status === 'DONE').length,
        failed: list.filter((s) => s.status === 'FAILED').length,
        cancelled: list.filter((s) => s.status === 'CANCELLED').length + open.length,
        collected: list.reduce((n, s) => n + Number(s.result_count || 0), 0),
      };

      /* Classify what arrived. Bounded, and skipped when nothing new came in. */
      let classified: any = null;
      if (summary.collected > 0) {
        const res = await invokeFunction(baseUrl, serviceKey, 'classify-signals-v2',
          { source: 'campaign', batchSize: Math.min(200, Math.max(50, summary.collected)) }, 150_000);
        classified = res.data;
      }

      await updateJob(db, row.id, { status: 'ranking', progress: 90, current_step: 'Matching current demand against your property' });
      const matched = await invokeFunction(baseUrl, serviceKey, 'run-matching-v2', {
        propertyId: row.property_id, campaignId: row.campaign_id, intentProfileBatchSize: 5000,
        fxRates: await fetchCurrentFx(),
      }, 150_000);
      if (matched.data?.error) throw new Error(String(matched.data.error));

      if (summary.done > 0 && row.campaign_id && Array.isArray(row.search_languages) && row.search_languages.length) {
        await markLanguagesDiscovered(db, row.campaign_id, row.search_languages).catch(() => undefined);
      }

      const result = await finalizeCampaignJob(db, job, grant, settings.freshness, {
        sourceJobs: summary,
        internal: {
          classified: classified?.processed ?? classified?.classified ?? null,
          matchesCreatedThisPass: Number(matched.data?.matchesCreated || 0),
          rejectedStaleDemand: Number(matched.data?.rejectedAncientDemand || 0),
        },
        noResultsReason: summary.done === 0 ? 'SOURCES_UNAVAILABLE' : 'NO_CURRENT_DEMAND_FOUND',
      });
      await updateJob(db, row.id, { queries_run: summary.done, signals_collected: summary.collected }).catch(() => undefined);
      results.push({ jobId: row.id, ended: result.status, freshMatches: result.freshMatches });
    } catch (error) {
      await failCampaignJob(db, job, grant, 'PIPELINE_ERROR', errorText(error));
      results.push({ jobId: row.id, ended: 'failed', error: errorText(error) });
    }
  }
  return results;
}

/**
 * A paused campaign still holds its budget reservation, which expires one hour
 * after it was taken. Before it lapses the campaign is stopped -- the driver
 * then finishes it with what arrived and settles only what was delivered --
 * rather than left to end as "reservation not held" with nothing to show.
 */
const PAUSE_STOP_BEFORE_EXPIRY_MS = 8 * 60_000;
async function expirePausedCampaigns(db: any) {
  const { data, error } = await db.from('matching_jobs')
    .select('id,user_id,billing_grant,paused_at')
    .eq('status', 'paused')
    .not('discovery_deadline_at', 'is', null)
    .limit(10);
  if (error) throw error;
  const stopped: string[] = [];
  for (const row of (data ?? []) as any[]) {
    const reservationId = (row.billing_grant as ExecutionGrant | null)?.reservationId;
    let expiresAt = Number.POSITIVE_INFINITY;
    if (reservationId) {
      const { data: reservation } = await db.from('usage_reservations')
        .select('expires_at,status').eq('id', reservationId).maybeSingle();
      if (reservation?.expires_at) expiresAt = Date.parse(reservation.expires_at);
    }
    if (expiresAt - Date.now() > PAUSE_STOP_BEFORE_EXPIRY_MS) continue;
    const { data: outcome } = await db.rpc('discovery_control', {
      p_kind: 'MATCHING_JOB', p_id: row.id, p_user_id: row.user_id, p_action: 'stop',
    });
    if (outcome?.ok) {
      await jobEvent(db, row.id, 'PAUSE_EXPIRED', {
        message: 'The pause reached the end of the reserved budget window; the search finished with what had arrived',
      }).catch(() => undefined);
      stopped.push(row.id);
    }
  }
  return stopped;
}

/**
 * FIND PROPERTY runs: the same three moves as a campaign. Wait while source
 * jobs are open and the window is open; then claim the ending (one tick only),
 * match the customer's plan against what is stored -- including everything
 * this run just collected -- and settle only what was delivered.
 */
async function advanceRuns(db: any, baseUrl: string, serviceKey: string, started: number) {
  const { data: waiting, error } = await db.from('discovery_runs')
    .select('id,user_id,intent_profile_id,started_at,deadline_at,billing_grant')
    .eq('status', 'SEARCHING')
    .not('deadline_at', 'is', null)
    .order('deadline_at', { ascending: true })
    .limit(3);
  if (error) throw error;
  const results: Array<Record<string, unknown>> = [];
  for (const row of (waiting ?? []) as any[]) {
    if (Date.now() - started > 25_000) break;
    const run: RunRef = { id: row.id, user_id: row.user_id, intent_profile_id: row.intent_profile_id, started_at: row.started_at };
    const grant = (row.billing_grant ?? null) as ExecutionGrant | null;
    const { data: sources, error: sourcesError } = await db.from('discovery_query_queue')
      .select('id,provider,status,result_count').eq('discovery_run_id', row.id);
    if (sourcesError) throw sourcesError;
    const list = (sources ?? []) as any[];
    const open = list.filter((s) => OPEN_SOURCE_STATES.includes(s.status));
    const pastDeadline = Date.parse(row.deadline_at) <= Date.now();
    if (open.length > 0 && !pastDeadline) {
      await updateRun(db, row.id, {
        stage: 'SEARCHING_SOURCES',
        progress: Math.min(80, 20 + Math.round(60 * (list.length - open.length) / Math.max(1, list.length))),
      }).catch(() => undefined);
      results.push({ runId: row.id, waiting: open.length });
      continue;
    }
    if (grant?.reservationId) {
      const { data: reservation } = await db.from('usage_reservations').select('status').eq('id', grant.reservationId).maybeSingle();
      if (reservation && reservation.status !== 'RESERVED') {
        if (await claimRunTransition(db, row.id, ['SEARCHING'], { status: 'MATCHING' })) {
          await failDiscoveryRun(db, row.id, null, 'RESERVATION_NOT_HELD',
            `the search budget reservation is ${reservation.status}; nothing was charged`, 'BUDGET_REACHED');
        }
        results.push({ runId: row.id, ended: 'RESERVATION_NOT_HELD' });
        continue;
      }
    }
    if (!(await claimRunTransition(db, row.id, ['SEARCHING'], { status: 'MATCHING', stage: 'VALIDATING', progress: 85 }))) continue;
    try {
      if (open.length > 0) {
        await db.from('discovery_query_queue')
          .update({ status: 'CANCELLED', cancel_reason: 'RUN_DEADLINE', finished_at: new Date().toISOString() })
          .eq('discovery_run_id', row.id).in('status', ['PENDING', 'RETRY_WAIT', 'PAUSED']);
        await runEvent(db, row.id, 'SOURCE_DISCOVERY_DEADLINE', { stillOpen: open.length });
      }
      const summary = {
        total: list.length,
        done: list.filter((s) => s.status === 'DONE').length,
        failed: list.filter((s) => s.status === 'FAILED').length,
        cancelled: list.filter((s) => s.status === 'CANCELLED').length + open.length,
        collected: list.reduce((n, s) => n + Number(s.result_count || 0), 0),
      };
      /* Group what was collected into entities before matching, so the
         same flat posted five times is one property, not five results. */
      const { data: planRow } = await db.from('discovery_search_plans')
        .select('plan').eq('discovery_run_id', row.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      const subject = (planRow?.plan as any)?.subject ?? null;
      if (subject?.city) {
        await invokeFunction(baseUrl, serviceKey, 'supply-discovery', {
          mode: 'resolve-market', countryCode: subject.countryCode, city: subject.city, transaction: subject.transaction,
        }, 120_000).catch((error) => runEvent(db, row.id, 'RESOLUTION_SKIPPED', { message: errorText(error) }));
      }
      await updateRun(db, row.id, { stage: 'MATCHING', progress: 90 }).catch(() => undefined);
      let matching: any = null;
      if (row.intent_profile_id) {
        const res = await invokeFunction(baseUrl, serviceKey, 'supply-matching', {
          intentProfileIds: [row.intent_profile_id], maxDemand: 1, trace: `run-${String(row.id).slice(0, 8)}`,
        }, 150_000);
        matching = res.data ?? null;
      }
      const ended = await finalizeDiscoveryRun(db, run, grant, {
        sourceJobs: summary,
        matching: matching ? { persisted: matching?.totals?.persisted ?? null, examined: matching?.totals?.candidatesRead ?? null } : null,
        noResultsReason: summary.done === 0 ? 'SOURCES_UNAVAILABLE' : 'NO_MATCHING_LISTINGS_FOUND',
      });
      results.push({ runId: row.id, ended: ended.status, delivered: ended.delivered });
    } catch (error) {
      await failDiscoveryRun(db, row.id, grant, 'PIPELINE_ERROR', errorText(error));
      results.push({ runId: row.id, ended: 'FAILED', error: errorText(error) });
    }
  }
  return results;
}

/** A run left in MATCHING by a tick that died: release, never charge blind. */
async function rescueStuckRuns(db: any) {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
  const { data, error } = await db.from('discovery_runs')
    .select('id,billing_grant').eq('status', 'MATCHING').lt('updated_at', cutoff).limit(5);
  if (error) throw error;
  const rescued: string[] = [];
  for (const row of (data ?? []) as any[]) {
    if (!(await claimRunTransition(db, row.id, ['MATCHING'], { status: 'FAILED' }))) continue;
    await failDiscoveryRun(db, row.id, row.billing_grant ?? null, 'WORKER_STOPPED',
      'the search stopped while finishing; the whole budget was released');
    rescued.push(row.id);
  }
  return rescued;
}

async function expirePausedRuns(db: any) {
  const { data, error } = await db.from('discovery_runs')
    .select('id,user_id,billing_grant').eq('status', 'PAUSED').limit(10);
  if (error) throw error;
  const stopped: string[] = [];
  for (const row of (data ?? []) as any[]) {
    const reservationId = (row.billing_grant as ExecutionGrant | null)?.reservationId;
    let expiresAt = Number.POSITIVE_INFINITY;
    if (reservationId) {
      const { data: reservation } = await db.from('usage_reservations').select('expires_at').eq('id', reservationId).maybeSingle();
      if (reservation?.expires_at) expiresAt = Date.parse(reservation.expires_at);
    }
    if (expiresAt - Date.now() > PAUSE_STOP_BEFORE_EXPIRY_MS) continue;
    const { data: outcome } = await db.rpc('discovery_control', {
      p_kind: 'DISCOVERY_RUN', p_id: row.id, p_user_id: row.user_id, p_action: 'stop',
    });
    if (outcome?.ok) {
      await runEvent(db, row.id, 'PAUSE_EXPIRED', {}).catch(() => undefined);
      stopped.push(row.id);
    }
  }
  return stopped;
}

/** A job left in 'classifying' or 'ranking' by a tick that died. */
async function rescueStuck(db: any) {
  const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
  const { data, error } = await db.from('matching_jobs')
    .select('id,property_id,campaign_id,started_at,billing_grant')
    .in('status', ['classifying', 'ranking'])
    .not('discovery_deadline_at', 'is', null)
    .lt('updated_at', cutoff)
    .limit(5);
  if (error) throw error;
  const rescued: string[] = [];
  for (const row of (data ?? []) as any[]) {
    if (!(await claimJobTransition(db, row.id, ['classifying', 'ranking'], { status: 'failed' }))) continue;
    await failCampaignJob(db, row, row.billing_grant ?? null, 'WORKER_STOPPED',
      'the search stopped while finishing; the whole budget was released');
    rescued.push(row.id);
  }
  return rescued;
}

/**
 * Stop a running campaign from the control center. The whole reservation is
 * released -- an operator stopping a run must never leave the customer
 * charged for work that did not finish -- and open source jobs are cancelled.
 */
export async function adminStop(db: any, jobId: string) {
  if (!jobId) return { success: false, error: 'jobId required' };
  const { data: row } = await db.from('matching_jobs')
    .select('id,property_id,campaign_id,started_at,billing_grant,status').eq('id', jobId).maybeSingle();
  if (!row) return { success: false, error: 'not found' };
  const running = ['queued', 'analysing_property', 'generating_queries', 'searching_sources',
    'collecting_results', 'normalizing', 'deduplicating', 'classifying', 'ranking'];
  if (!(await claimJobTransition(db, jobId, running, { status: 'cancelled' }))) {
    return { success: false, error: `the job is already ${row.status}` };
  }
  await failCampaignJob(db, row, row.billing_grant ?? null, 'STOPPED_BY_ADMIN',
    'an operator stopped this search; the whole budget was released', 'cancelled');
  return { success: true, jobId, status: 'cancelled' };
}

/**
 * Re-queue a campaign's failed or waiting source jobs, while that campaign is
 * still searching. Never a retired provider: the filter below names the only
 * three the driver can run.
 */
export async function adminRetry(db: any, jobId: string) {
  if (!jobId) return { success: false, error: 'jobId required' };
  const { data: job } = await db.from('matching_jobs').select('status').eq('id', jobId).maybeSingle();
  if (!job) return { success: false, error: 'not found' };
  if (job.status !== 'searching_sources') return { success: false, error: `the job is ${job.status}, not searching` };
  const { data, error } = await db.from('discovery_query_queue')
    .update({ status: 'PENDING', next_attempt_at: new Date().toISOString(), last_error: null, cancel_reason: null, finished_at: null })
    .eq('matching_job_id', jobId)
    .in('status', ['FAILED', 'RETRY_WAIT'])
    .in('provider', ['TELEGRAM', 'TELEGRAM_SOURCES', 'FORUM', 'PORTAL'])
    .select('id');
  if (error) return { success: false, error: error.message };
  return { success: true, jobId, requeued: Array.isArray(data) ? data.length : 0 };
}
