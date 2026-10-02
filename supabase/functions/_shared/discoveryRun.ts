// PHASE 2 — a FIND PROPERTY run's lifecycle: events, transitions, a truthful
// ending. The FIND BUYERS twin is campaignRun.ts; this mirrors it for runs
// that have no property (discovery_runs).
//
//   SEARCHING  source jobs (portals, Telegram) are queued and executing
//   PAUSED     held by the customer (discovery_control)
//   MATCHING   the driver claimed the ending: match, count, settle
//   COMPLETED / PARTIAL / FAILED / CANCELLED / BUDGET_REACHED
//
// The ending counts ONLY external listings this run delivered to the
// customer's own search (supply_matches EXTERNAL_LISTING created since the
// run started), settles measured cost against the reservation, and releases
// the rest. Unknown cost is recorded as unknown, never as zero.

import { releaseExecution, settleExecution, type ExecutionGrant } from './billing.ts';
import { errorText } from './campaignRun.ts';

type Json = Record<string, unknown>;

export const OPEN_RUN_STATES = ['QUEUED', 'SEARCHING', 'PAUSED', 'MATCHING'];

export async function runEvent(db: any, runId: string, kind: string, payload: Json = {}) {
  const { error } = await db.from('discovery_run_events').insert({ run_id: runId, kind, payload });
  if (error) throw error;
}

export async function updateRun(db: any, runId: string, patch: Json) {
  const { error } = await db.from('discovery_runs')
    .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', runId);
  if (error) throw error;
}

/** Only the caller whose conditional update moves the run proceeds. */
export async function claimRunTransition(db: any, runId: string, from: string[], patch: Json): Promise<boolean> {
  const { data, error } = await db.from('discovery_runs')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', runId).in('status', from).select('id');
  if (error) throw error;
  return Array.isArray(data) && data.length === 1;
}

export interface RunRef {
  id: string;
  user_id: string;
  intent_profile_id: string | null;
  started_at: string;
}

export async function finalizeDiscoveryRun(
  db: any,
  run: RunRef,
  grant: ExecutionGrant | null,
  context: { sourceJobs: Json; matching?: Json | null; noResultsReason?: string | null },
) {
  const now = Date.now();
  let delivered = 0;
  if (run.intent_profile_id) {
    /* Counted per PROPERTY: reposts of one flat are one delivery. */
    const { data: rows, error } = await db.from('supply_matches')
      .select('observation_id,observation:supply_observations!observation_id(entity_id)')
      .eq('intent_profile_id', run.intent_profile_id)
      .eq('source_kind', 'EXTERNAL_LISTING')
      .eq('compatibility', 'COMPATIBLE')
      .gte('created_at', run.started_at)
      .limit(1000);
    if (error) throw error;
    delivered = new Set(((rows ?? []) as any[]).map((r) => {
      const o = Array.isArray(r.observation) ? r.observation[0] : r.observation;
      return String(o?.entity_id ?? r.observation_id);
    })).size;
  }

  /* Measured provider spend of this run's source jobs. Native routes report
     0 per request; a job that did not measure leaves actual_cost_usd null and
     the run says so instead of summing it as zero. */
  const { data: jobs } = await db.from('discovery_query_queue')
    .select('actual_cost_usd,status').eq('discovery_run_id', run.id);
  const list = (jobs ?? []) as Array<{ actual_cost_usd: number | null; status: string }>;
  const finished = list.filter((j) => j.status === 'DONE');
  const costUnknown = finished.some((j) => j.actual_cost_usd === null);
  const providerCostUsd = finished.reduce((sum, j) => sum + Number(j.actual_cost_usd ?? 0), 0);

  let creditsCharged = 0;
  if (grant) {
    try {
      const settled = await settleExecution(db, grant, {
        provider: 'homatch_discovery',
        providerOperation: 'find_property_run',
        providerRequestId: run.id,
        searchCount: finished.length,
        durationMs: now - new Date(run.started_at).getTime(),
        rawProviderCostCents: providerCostUsd * 100,
        metadata: { delivered_listings: delivered, provider_cost_unknown: costUnknown },
      }, delivered > 0 ? 'SUCCESS' : 'PARTIAL');
      creditsCharged = settled.chargedCredits;
    } catch (error) {
      await runEvent(db, run.id, 'SETTLE_DEFERRED', { message: errorText(error) }).catch(() => undefined);
    }
  }

  const status = delivered > 0 ? 'COMPLETED' : 'PARTIAL';
  await updateRun(db, run.id, {
    status,
    stage: 'READY',
    progress: 100,
    results_found: delivered,
    provider_cost_usd: costUnknown ? null : providerCostUsd,
    credits_charged: creditsCharged,
    failure_reason: delivered > 0 ? null : (context.noResultsReason ?? 'NO_MATCHING_LISTINGS_FOUND'),
    completed_at: new Date().toISOString(),
  });
  await runEvent(db, run.id, 'RUN_COMPLETE', {
    delivered, creditsCharged, providerCostUsd: costUnknown ? null : providerCostUsd,
    providerCostUnknown: costUnknown, sourceJobs: context.sourceJobs, matching: context.matching ?? null,
  });
  return { status, delivered, creditsCharged };
}

/** End a run that could not finish: release the whole reservation, say why. */
export async function failDiscoveryRun(
  db: any, runId: string, grant: ExecutionGrant | null, reason: string, detail: string,
  status: 'FAILED' | 'CANCELLED' | 'BUDGET_REACHED' = 'FAILED',
) {
  if (grant) await releaseExecution(db, grant, reason.toLowerCase()).catch(() => undefined);
  await db.from('discovery_query_queue')
    .update({ status: 'CANCELLED', cancel_reason: reason, finished_at: new Date().toISOString(), lease_expires_at: null })
    .eq('discovery_run_id', runId)
    .in('status', ['PENDING', 'RETRY_WAIT', 'PAUSED']);
  await updateRun(db, runId, {
    status, stage: 'STOPPED', progress: 100, failure_reason: reason,
    error_message: detail.slice(0, 1000), completed_at: new Date().toISOString(),
  }).catch(() => undefined);
  await runEvent(db, runId, 'RUN_FAILED', { reason, message: detail }).catch(() => undefined);
}
