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
// customer's own search and charges for those alone (findPropertySettlement.ts):
// zero delivered releases the whole reservation; otherwise the charge is the
// plan's unit price per delivered property, capped at the reservation.
// Measured provider cost is recorded; unknown cost is recorded as unknown,
// never as zero.

import { releaseExecution, type ExecutionGrant } from './billing.ts';
import { errorText } from './campaignRun.ts';
import { claimSettlement, loadDeliveries, settleFindPropertyRun, settlePaidSocialRun } from './findPropertySettlement.ts';
import { finishOfferCampaign } from './findProperty/socialOffers.ts';
import { campaignSearchId } from './findProperty/socialListings.ts';
import { persistCampaignResults } from './findProperty/campaignResults.ts';
import { processAndStore } from './marketplaceSearch.ts';
import { PAID_DISCOVERY_POLICY_ID } from '../../../src/research-core/billing/paidDiscoveryPolicy.ts';

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
  /* Once per run: a repeat (a retried tick, a lost race) settles nothing again
     and reports what the first ending recorded. */
  if (!(await claimSettlement(db, run.id))) {
    const { data: ended } = await db.from('discovery_runs')
      .select('status,results_found,credits_charged').eq('id', run.id).maybeSingle();
    return {
      status: String(ended?.status ?? 'UNKNOWN'),
      delivered: Number(ended?.results_found ?? 0),
      creditsCharged: Number(ended?.credits_charged ?? 0),
      repeated: true,
    };
  }

  const now = Date.now();
  /* Counted on the server, per PROPERTY: reposts of one flat are one delivery. */
  const deliveries = await loadDeliveries(db, run.intent_profile_id, run.started_at);
  const delivered = deliveries.delivered;

  /* Measured provider spend of this run's source jobs. Native routes report
     0 per request; a job that did not measure leaves actual_cost_usd null and
     the run says so instead of summing it as zero. */
  const { data: jobs } = await db.from('discovery_query_queue')
    .select('actual_cost_usd,status').eq('discovery_run_id', run.id);
  const list = (jobs ?? []) as Array<{ actual_cost_usd: number | null; status: string }>;
  const finished = list.filter((j) => j.status === 'DONE');
  const costUnknown = finished.some((j) => j.actual_cost_usd === null);
  const providerCostUsd = finished.reduce((sum, j) => sum + Number(j.actual_cost_usd ?? 0), 0);

  /* A paid social offer campaign settles on what its providers consumed (37/63). */
  const { data: pricing } = await db.from('discovery_runs')
    .select('pricing_policy,credits_per_usd,offers_found').eq('id', run.id).maybeSingle();
  const socialCampaign = pricing?.pricing_policy === PAID_DISCOVERY_POLICY_ID;
  let spendMicros = 0;
  /* A campaign's results are ITS offers judged against the exact request — not the free
     search's deliveries (portals included), which `delivered` above counts. */
  let campaignAvailable: number | null = null;
  if (socialCampaign) {
    spendMicros = await finishOfferCampaign(db, run.id);
    campaignAvailable = await judgeCampaignOffers(db, run.id);
  }
  /* The customer pays for confirmed work (spendMicros); the run's provider cost is everything committed. */
  const committedMicros = socialCampaign
    ? Number((await db.rpc('find_property_committed_micros', { p_run_id: run.id })).data ?? spendMicros) : 0;

  /* null only when neither a settle nor a release could be recorded: the
     reservation is still held and the run says so rather than claiming 0. */
  let creditsCharged: number | null = 0;
  let billing: string = grant ? 'NONE' : 'NO_GRANT';
  try {
    const settled = socialCampaign ? await settlePaidSocialRun(db, grant, {
      runId: run.id, spendMicros, creditsPerUsd: Number(pricing?.credits_per_usd) || 10,
      durationMs: now - new Date(run.started_at).getTime(), offers: Number(pricing?.offers_found ?? 0), delivered: campaignAvailable ?? 0,
    }, (g, reason, usage) => releaseExecution(db, g, reason, usage)) : await settleFindPropertyRun(db, grant, {
      runId: run.id,
      searchCount: finished.length,
      durationMs: now - new Date(run.started_at).getTime(),
      providerCostUsd,
      providerCostUnknown: costUnknown,
      deliveries,
    }, (g, reason, usage) => releaseExecution(db, g, reason, usage));
    creditsCharged = settled.creditsCharged;
    billing = settled.action;
  } catch (error) {
    /* A charge that cannot be priced or recorded is not taken: the hold is
       released (nothing in production sweeps a stranded reservation). Only
       when even the release fails does the run say the hold is still open. */
    try {
      if (grant) await releaseExecution(db, grant, 'settle_failed');
      creditsCharged = 0;
      billing = 'RELEASED_AFTER_ERROR';
      await runEvent(db, run.id, 'SETTLE_FAILED_RELEASED', { message: errorText(error) }).catch(() => undefined);
    } catch (releaseError) {
      creditsCharged = null;
      billing = 'DEFERRED';
      await runEvent(db, run.id, 'SETTLE_DEFERRED', {
        message: errorText(error), releaseMessage: errorText(releaseError),
      }).catch(() => undefined);
    }
  }

  const shown = socialCampaign ? campaignAvailable ?? 0 : delivered;
  const status = shown > 0 ? 'COMPLETED' : 'PARTIAL';
  await updateRun(db, run.id, {
    status,
    stage: 'READY',
    progress: 100,
    results_found: shown,
    provider_cost_usd: socialCampaign ? committedMicros / 1e6 : costUnknown ? null : providerCostUsd,
    credits_charged: creditsCharged,
    failure_reason: shown > 0 ? null : (context.noResultsReason ?? 'NO_MATCHING_LISTINGS_FOUND'),
    completed_at: new Date().toISOString(),
  });
  await runEvent(db, run.id, 'RUN_COMPLETE', {
    delivered, notBilled: deliveries.excluded, billing, creditsCharged,
    providerCostUsd: costUnknown ? null : providerCostUsd,
    providerCostUnknown: costUnknown, sourceJobs: context.sourceJobs, matching: context.matching ?? null,
  });
  if (socialCampaign) await publishSocialListings(db, run.id);
  return { status, delivered: shown, creditsCharged: creditsCharged ?? 0 };
}

/** Never fatal: a campaign whose judging fails still settles; its page judges it on first read. */
async function judgeCampaignOffers(db: any, runId: string): Promise<number | null> {
  try {
    return (await persistCampaignResults(db, runId))?.available ?? null;
  } catch (error) {
    await runEvent(db, runId, 'CAMPAIGN_RESULTS_FAILED', { message: errorText(error) }).catch(() => undefined);
    return null;
  }
}

/**
 * An ended campaign's offers join its marketplace search's results (re-ranked and
 * deduplicated with the portals). Never fatal: the offers stay stored and the next
 * re-rank of that search picks them up.
 */
export async function publishSocialListings(db: any, runId: string): Promise<void> {
  try {
    const searchId = await campaignSearchId(db, runId);
    if (searchId) await processAndStore(db, searchId);
  } catch (error) {
    await runEvent(db, runId, 'SOCIAL_RESULTS_PUBLISH_FAILED', { message: errorText(error) }).catch(() => undefined);
  }
}

/** End a run that could not finish: release the whole reservation, say why. */
export async function failDiscoveryRun(
  db: any, runId: string, grant: ExecutionGrant | null, reason: string, detail: string,
  status: 'FAILED' | 'CANCELLED' | 'BUDGET_REACHED' = 'FAILED',
) {
  /* Paid social runs still in flight are aborted and booked first: a run that
     failed on HOMATCH's side is released in full, and HOMATCH carries the spend. */
  await finishOfferCampaign(db, runId).catch(() => undefined);
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
  /* Offers already found (HOMATCH carried their cost) are still shown. */
  await judgeCampaignOffers(db, runId);
  await publishSocialListings(db, runId);
}
