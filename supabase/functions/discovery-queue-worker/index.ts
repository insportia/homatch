import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { isRetiredProvider, retiredReason, RETIRED_PROVIDERS } from '../_shared/retiredProviders.ts';
import { drive, adminStop, adminRetry } from './driver.ts';

// DATAFORSEO AND APIFY ARE RETIRED, AND THIS WORKER CAN NO LONGER REACH THEM.
//
// They were the only two providers it executed. Until now the launch code for
// both was still here, behind external_discovery_enabled and
// provider_kill_switch: safe while production kept those settings locked, and
// one admin preset away from spending money on a provider the architecture had
// left behind. The reconcile mode was worse -- it re-read Apify datasets with
// the token whenever it was called, consulting neither setting.
//
// Retirement is now a property of this code rather than of a settings row. A
// claimed DATAFORSEO or APIFY job is failed as PROVIDER_RETIRED, non-retryable,
// before any request could be built, and there is no request left to build: the
// endpoints, the actor ids, the dataset reader and the result normalisers are
// gone. The queue, the claim, the budget ceiling and the persistence contract
// are kept intact, so a provider that is not retired can be added to
// executeProvider() without rebuilding any of it.
//
// Historical jobs, datasets, raw results and cost_events are untouched.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' },
});

class ProviderError extends Error {
  retryable: boolean;
  status: number;
  constructor(message: string, retryable = true, status = 500) {
    super(message);
    this.retryable = retryable;
    this.status = status;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const baseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const db = createClient(baseUrl, serviceKey);

  try {
    const body = await req.json().catch(() => ({}));
    const mode = String(body.mode || 'execute').toLowerCase();
    /* The control center's two actions. A signed-in ADMIN, nothing else; they
       never reach the provider paths below. */
    if (mode === 'admin_stop' || mode === 'admin_retry') {
      if (!(await isAdminCaller(req, db))) return json({ error: 'Admin only' }, 403);
      return json(mode === 'admin_stop'
        ? await adminStop(db, String(body.jobId || ''))
        : await adminRetry(db, String(body.jobId || '')));
    }
    if (!(await isAuthorized(req, db, serviceKey))) return json({ error: 'Internal only' }, 403);
    if (mode === 'health' || mode === 'audit') return json(await audit(db));
    /* The campaign discovery driver (see driver.ts): source jobs for
       TELEGRAM / TELEGRAM_SOURCES / FORUM, then classify, match, settle. */
    if (mode === 'drive') return json(await drive(db, baseUrl, serviceKey, body));
    if (mode === 'reconcile') {
      // Reconcile re-read already-paid Apify datasets through the Apify API.
      // Apify is retired, so there is nothing it may call.
      return json({ success: false, mode: 'reconcile', retired: true, provider: 'APIFY', error: retiredReason('APIFY') }, 423);
    }
    if (mode !== 'execute') return json({ error: 'Unsupported mode' }, 400);
    const result = await executeControlledJobs(db, baseUrl, serviceKey, body);
    return json(result, result.blocked ? 423 : result.success ? 200 : 500);
  } catch (error) {
    return json({ success: false, error: message(error) }, 500);
  }
});

async function isAdminCaller(req: Request, db: any) {
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!bearer) return false;
  const { data: auth } = await db.auth.getUser(bearer);
  if (!auth?.user) return false;
  const { data: user } = await db.from('users').select('is_admin').eq('auth_id', auth.user.id).maybeSingle();
  return user?.is_admin === true;
}

async function isAuthorized(req: Request, db: any, serviceKey: string) {
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (serviceKey && bearer === serviceKey) return true;
  const presented = req.headers.get('x-cron-token') || '';
  if (!presented) return false;
  const expected = await setting(db, 'continuous_worker_token', '');
  if (expected && presented === String(expected)) return true;
  /* The driver schedule's own token (homatch-discovery-driver). */
  const driverToken = await setting(db, 'discovery_driver_token', '');
  return !!driverToken && presented === String(driverToken);
}

async function audit(db: any) {
  const keys = [
    'external_discovery_enabled', 'provider_kill_switch', 'provider_disabled_list',
    'spend_cap_global', 'spend_cap_dataforseo', 'spend_cap_apify',
    'external_provider_reported_cap_apify', 'external_provider_spend_floor_apify',
    'external_provider_spend_floor_apify_until', 'external_estimated_cost_dataforseo',
    'external_estimated_cost_apify', 'external_consumer_max_results',
  ];
  const { data: rows, error } = await db.from('admin_settings').select('key,value').in('key', keys);
  if (error) throw error;
  const settings = Object.fromEntries((rows || []).map((row: any) => [row.key, scalar(row.value, null)]));
  const statusNames = ['PENDING', 'PROCESSING', 'DONE', 'FAILED'];
  const statusResults = await Promise.all(statusNames.map((status) => db.from('discovery_query_queue').select('id', { count: 'exact', head: true }).eq('status', status)));
  const queueCounts: Record<string, number> = {};
  for (let index = 0; index < statusNames.length; index++) {
    if (statusResults[index].error) throw statusResults[index].error;
    queueCounts[statusNames[index]] = Number(statusResults[index].count || 0);
  }
  const { count: doneWithDataset, error: datasetCountError } = await db.from('discovery_query_queue').select('id', { count: 'exact', head: true }).eq('status', 'DONE').not('dataset_id', 'is', null);
  if (datasetCountError) throw datasetCountError;
  return {
    success: true,
    mode: 'CONTROLLED_EXTERNAL_CONSUMER',
    paidLaunchesEnabled: settings.external_discovery_enabled === true && settings.provider_kill_switch === false,
    settings,
    queue: queueCounts,
    doneWithDataset: Number(doneWithDataset || 0),
    // Reported as retired rather than as configured or not: whether a token is
    // still in the environment no longer decides anything.
    providers: Object.fromEntries(RETIRED_PROVIDERS.map((name) => [name, { retired: true }])),
  };
}

async function executeControlledJobs(db: any, baseUrl: string, serviceKey: string, body: any) {
  const propertyId = String(body.propertyId || '');
  if (!propertyId) throw new ProviderError('propertyId required', false, 400);
  const enabled = await setting(db, 'external_discovery_enabled', false);
  const kill = await setting(db, 'provider_kill_switch', true);
  if (enabled !== true || kill !== false) {
    return { success: true, blocked: true, processed: 0, reason: 'EXTERNAL_DISCOVERY_SAFETY_LOCK' };
  }
  const disabledProvidersRaw = await setting(db, 'provider_disabled_list', []);
  const disabledProviders = Array.isArray(disabledProvidersRaw)
    ? disabledProvidersRaw.map((value: unknown) => String(value).toUpperCase())
    : [];
  const configuredMax = Number(await setting(db, 'external_discovery_max_jobs_per_property_tick', 10));
  const requested = Number(body.limit || configuredMax);
  const limit = Math.min(25, Math.max(1, requested || 1));
  const completed: any[] = [];
  const failures: any[] = [];

  // -- The authorised spend ceiling ----------------------------------------
  //
  // When the caller passes maxSpendUsd, the customer has authorised exactly
  // that much provider spend and not a cent more. The check happens BEFORE
  // each provider call, against that call's own estimate, so the budget is
  // never discovered to be exceeded after the money is already gone.
  //
  // Null means no per-run ceiling: the pre-existing global spend caps and the
  // kill switches still apply, as they always did.
  const maxSpendUsd = body.maxSpendUsd == null ? null : Number(body.maxSpendUsd);
  let spentUsd = 0;
  let budgetExhausted = false;

  // A smaller budget should buy the HIGHEST-YIELD work, not simply the first
  // work in the queue. claim_external_discovery_jobs_for_property already
  // returns in priority order; this only decides when to stop.
  for (let index = 0; index < limit; index++) {
    if (maxSpendUsd != null && spentUsd >= maxSpendUsd) {
      budgetExhausted = true;
      break;
    }

    const { data: claimed, error: claimError } = await db.rpc('claim_external_discovery_jobs_for_property', {
      p_property_id: propertyId,
      p_limit: 1,
    });
    if (claimError) throw claimError;
    const job = claimed?.[0];
    if (!job) break;

    // Would THIS job take us past what the customer authorised? Release it
    // and stop, rather than running it and overrunning.
    const jobEstimate = Number(job.estimated_cost_usd || 0);
    if (maxSpendUsd != null && spentUsd + jobEstimate > maxSpendUsd) {
      // Hand the job back to the queue rather than leaving it claimed. There is
      // no release RPC, but fail_external_discovery_job with retryable=true is
      // exactly a requeue, and it is what the error path already uses. Leaving
      // it claimed would strand a perfectly good job until the stale-claim
      // sweeper ran.
      await db.rpc('fail_external_discovery_job', {
        p_job_id: job.id,
        p_claim_token: job.claim_token,
        p_error: 'BUDGET_CEILING_REACHED: not started, returned to the queue',
        p_retryable: true,
      });
      await event(db, job, 'BUDGET_CEILING_REACHED', {
        message: 'Stopped before this job to stay inside the authorised budget',
        estimatedCostUsd: jobEstimate,
        spentUsd,
        authorizedSpendUsd: maxSpendUsd,
      });
      budgetExhausted = true;
      break;
    }

    await event(db, job, 'CLAIMED', { provider: job.provider, platform: job.platform, estimatedCostUsd: job.estimated_cost_usd });
    try {
      const { data: allowed, error: guardError } = await db.rpc('external_discovery_job_execution_allows', {
        p_job_id: job.id,
        p_claim_token: job.claim_token,
      });
      if (guardError) throw guardError;
      if (allowed !== true) throw new ProviderError('EXECUTION_GUARD_REJECTED', true, 423);
      const execution = await executeProvider(job, Number(await setting(db, 'external_consumer_max_results', 100)), disabledProviders);
      const accountedCost = execution.costUsd > 0 ? execution.costUsd : Number(job.estimated_cost_usd || 0);
      const { data: persisted, error: persistError } = await db.rpc('persist_external_discovery_results', {
        p_job_id: job.id,
        p_results: execution.results,
        p_actual_cost_usd: accountedCost,
        p_external_run_id: execution.externalRunId || null,
        p_dataset_id: execution.datasetId || null,
        p_claim_token: job.claim_token,
        p_reconcile: false,
      });
      if (persistError) throw new ProviderError(`PERSISTENCE_FAILED: ${persistError.message}`, true, 500);
      spentUsd += accountedCost;
      completed.push({ ...persisted, providerCostUsd: execution.costUsd, accountedCostUsd: accountedCost });
    } catch (error) {
      const failure = error instanceof ProviderError ? error : new ProviderError(message(error), true, 500);
      await failJob(db, job, failure);
      failures.push({ jobId: job.id, provider: job.provider, retryable: failure.retryable, error: failure.message });
    }
  }

  if (completed.length) await invokeMatching(baseUrl, serviceKey, propertyId, body.campaignId || null);
  return {
    success: failures.length === 0,
    blocked: false,
    processed: completed.length + failures.length,
    completed,
    failures,
    // Reported back so the caller can settle on what was really spent and tell
    // the customer their search stopped at the budget rather than at an error.
    spentUsd: Math.round(spentUsd * 10000) / 10000,
    authorizedSpendUsd: maxSpendUsd,
    budgetExhausted,
  };
}

async function executeProvider(job: any, _maxResults: number, disabledProviders: string[] = []): Promise<{
  results: unknown[];
  costUsd: number;
  externalRunId?: string | null;
  datasetId?: string | null;
}> {
  const provider = String(job.provider || '').toUpperCase();
  // Retired first, and unconditionally: no setting can re-enable these.
  if (isRetiredProvider(provider)) {
    throw new ProviderError(`PROVIDER_RETIRED: ${retiredReason(provider)}`, false, 423);
  }
  // Per-provider admin disable (AdminProvidersPage's per-card toggle, backed by
  // admin_settings.provider_disabled_list). The master provider_kill_switch
  // above is a separate, coarser circuit breaker; this is the finer-grained one
  // the admin UI promises.
  if (disabledProviders.includes(provider)) {
    throw new ProviderError(`PROVIDER_DISABLED_BY_ADMIN: ${provider}`, false, 423);
  }
  throw new ProviderError(`UNSUPPORTED_PROVIDER: ${provider}`, false, 400);
}

async function failJob(db: any, job: any, error: ProviderError) {
  const text = error.message.slice(0, 1000);
  await db.rpc('fail_external_discovery_job', {
    p_job_id: job.id,
    p_claim_token: job.claim_token,
    p_error: text,
    p_retryable: error.retryable,
  });
  // A retired provider was never called, so there is no provider cost -- not
  // even a zero -- to record against it.
  const retired = error.message.startsWith('PROVIDER_RETIRED');
  if (!retired) await db.from('cost_events').insert({
    provider: String(job.provider || '').toUpperCase(),
    operation_type: 'EXTERNAL_DISCOVERY_FAILED',
    source: `queue:${job.id}`,
    market: job.metadata?.country_code || 'GE',
    units: 0,
    cost_usd: 0,
    success: false,
    cache_hit: false,
    property_id: job.property_id,
    discovery_job_id: job.id,
  });
  await event(db, job, 'FAILED', { provider: job.provider, retryable: error.retryable, error: text });
  if (!retired && /usage.{0,20}(limit|exceed)|platform usage|billing|payment|required|unauthori[sz]ed|invalid credential/i.test(text)) {
    await db.from('admin_settings').update({ value: true, updated_at: new Date().toISOString() }).eq('key', 'provider_kill_switch');
  }
}

async function event(db: any, job: any, eventType: string, payload: any) {
  const { error } = await db.from('external_discovery_events').insert({ job_id: job.id, property_id: job.property_id, event_type: eventType, payload });
  if (error) console.error('external_discovery_event', error.message);
}

async function invokeMatching(baseUrl: string, serviceKey: string, propertyId: string, campaignId: string | null) {
  try {
    const response = await fetch(`${baseUrl}/functions/v1/run-matching-v2`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${serviceKey}`, apikey: serviceKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ propertyId, campaignId, intentProfileBatchSize: 2500 }),
      signal: AbortSignal.timeout(120000),
    });
    if (!response.ok) console.error('run-matching-v2', response.status, (await response.text()).slice(0, 500));
  } catch (error) { console.error('run-matching-v2', message(error)); }
}

async function setting(db: any, key: string, fallback: any) {
  const { data, error } = await db.from('admin_settings').select('value').eq('key', key).maybeSingle();
  if (error) throw error;
  return scalar(data?.value, fallback);
}
function scalar(value: any, fallback: any) { if (value === null || value === undefined) return fallback; if (typeof value === 'string') { try { return JSON.parse(value); } catch { return value; } } return value; }
function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
