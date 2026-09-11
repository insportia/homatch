import { createClient } from 'jsr:@supabase/supabase-js@2';
import { beginExecution, settleExecution, releaseExecution } from '../_shared/billing.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' },
});

type JsonMap = Record<string, unknown>;

function scalar(value: unknown, fallback: unknown) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return value; }
  }
  return value;
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function updateJob(db: any, jobId: string, patch: JsonMap) {
  const { error } = await db.from('matching_jobs').update({
    ...patch,
    updated_at: new Date().toISOString(),
  }).eq('id', jobId);
  if (error) throw error;
}

async function event(db: any, jobId: string, eventType: string, payload: JsonMap = {}) {
  const { error } = await db.from('matching_job_events').insert({
    job_id: jobId,
    event_type: eventType,
    payload,
  });
  if (error) throw error;
}

async function invoke(
  baseUrl: string,
  serviceKey: string,
  functionName: string,
  body: JsonMap,
  timeout: number,
) {
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
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!response.ok && response.status !== 423) {
    throw new Error(`${functionName} ${response.status}: ${data?.error || text}`);
  }
  return { status: response.status, data };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const baseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!baseUrl || !serviceKey) return json({ error: 'Server configuration missing' }, 500);

  const authorization = req.headers.get('Authorization') || '';
  const token = authorization.replace(/^Bearer\s+/i, '');
  const db = createClient(baseUrl, serviceKey);

  let jobId: string | null = null;
  // Visible to the catch below, which is outside the try that creates it.
  let grantRef: Awaited<ReturnType<typeof beginExecution>> | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const propertyId = String(body.propertyId || '');
    if (!propertyId) return json({ error: 'propertyId required' }, 400);

    const serviceInvocation = token === serviceKey;
    let authenticatedAuthId: string | null = null;
    if (!serviceInvocation) {
      const { data: authData, error: authError } = await db.auth.getUser(token);
      if (authError || !authData.user) return json({ error: 'Unauthorized' }, 401);
      authenticatedAuthId = authData.user.id;
    }

    let userQuery = db.from('users').select('id,is_admin');
    userQuery = serviceInvocation
      ? userQuery.eq('id', String(body.userId || ''))
      : userQuery.eq('auth_id', authenticatedAuthId);
    const { data: homatchUser, error: userError } = await userQuery.maybeSingle();
    if (userError) throw userError;
    if (!homatchUser) return json({ error: 'Homatch user not found' }, 403);

    const { data: property, error: propertyError } = await db
      .from('properties')
      .select('id,user_id,title,matching_status')
      .eq('id', propertyId)
      .eq('is_deleted', false)
      .maybeSingle();
    if (propertyError) throw propertyError;
    if (!property) return json({ error: 'Property not found' }, 404);
    if (property.user_id !== homatchUser.id && homatchUser.is_admin !== true) {
      return json({ error: 'Forbidden' }, 403);
    }

    let campaignId = body.campaignId ? String(body.campaignId) : '';
    if (campaignId) {
      const { data: requestedCampaign } = await db
        .from('matching_campaigns')
        .select('id')
        .eq('id', campaignId)
        .eq('property_id', propertyId)
        .maybeSingle();
      if (!requestedCampaign) campaignId = '';
    }
    if (!campaignId) {
      const { data: existingCampaign, error: campaignLookupError } = await db
        .from('matching_campaigns')
        .select('id')
        .eq('property_id', propertyId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (campaignLookupError) throw campaignLookupError;
      if (existingCampaign) {
        campaignId = existingCampaign.id;
      } else {
        const { data: createdCampaign, error: campaignCreateError } = await db
          .from('matching_campaigns')
          .insert({ property_id: propertyId, user_id: property.user_id, status_v2: 'ACTIVE' })
          .select('id')
          .single();
        if (campaignCreateError) throw campaignCreateError;
        campaignId = createdCampaign.id;
      }
    }

    const suppliedKey = String(body.idempotencyKey || crypto.randomUUID());
    const idempotencyKey = `${homatchUser.id}:${suppliedKey}`;
    const { data: priorJob, error: priorError } = await db
      .from('matching_jobs')
      .select('id,status,matches_created')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();
    if (priorError) throw priorError;
    if (priorJob) {
      return json({
        success: true,
        idempotent: true,
        jobId: priorJob.id,
        campaignId,
        status: priorJob.status,
        matchesCreated: priorJob.matches_created,
      });
    }

    /* ---- billing ----
     *
     * This is the Find Clients SEARCH. One full search a month is included on
     * every plan; after that the wallet funds it, with no monthly ceiling on
     * how many a customer may run.
     *
     * Placed AFTER the idempotency check on purpose: a replayed request
     * returns the earlier job above and never reaches here, so it cannot hold
     * a second lot of credits for one logical search.
     *
     * NOTE FOR THE OPERATOR: unlocking an individual match still charges
     * separately through atomic_match_unlock, which is the pre-existing and
     * untouched revenue line for revealing one contact. Whether the search
     * charge and the per-contact charge should be consolidated is a product
     * decision, and it is deliberately NOT made here. */
    const grant = await beginExecution(db, {
      userId: homatchUser.id,
      productCode: 'FIND_CLIENTS',
      idempotencyKey: `findclients:${idempotencyKey}`,
      jobRef: propertyId,
      // Present when the customer accepted a best-effort budget smaller than
      // the estimate ("search with my 10 Credits"). Absent means "as much of
      // the estimate as the balance covers".
      authorizedMaxCredits: body.authorizedMaxCredits != null
        ? Number(body.authorizedMaxCredits) : undefined,
      metadata: { campaignId, propertyId },
    });
    grantRef = grant;

    if (!grant.ok) {
      const { data: ent } = await db.rpc('billing_entitlements', { p_user_id: homatchUser.id });
      return json({
        error: grant.reason === 'BELOW_MIN_VIABLE_BUDGET'
          ? 'This search needs a little more balance to be worth running.'
          : 'This search needs Credits to continue.',
        reasonCode: grant.reason ?? 'BILLING_REQUIRED',
        planCode: grant.planCode,
        walletBalance: Number(ent?.wallet?.balance ?? 0),
        // What they would need, so the client can say it rather than showing a
        // dead-end "insufficient balance".
        minViableBudgetCredits: grant.minViableBudgetCredits,
        budget: grant.budget ?? null,
        firstTopupPromoAvailable: !!ent?.first_topup_promo_available,
      }, 402);
    }

    const startedAt = new Date().toISOString();
    const { data: createdJob, error: jobError } = await db.from('matching_jobs').insert({
      property_id: propertyId,
      campaign_id: campaignId,
      user_id: property.user_id,
      idempotency_key: idempotencyKey,
      status: 'queued',
      progress: 0,
      current_step: 'Queued for internal matching',
      current_tier: 1,
      provider_results: {
        internal_data: 'READY',
        external_discovery: 'PREFLIGHT',
      },
      started_at: startedAt,
    }).select('id').single();
    if (jobError || !createdJob) throw jobError || new Error('Could not create matching job');
    jobId = createdJob.id;

    await event(db, jobId, 'JOB_STARTED', {
      message: 'Matching started from existing Homatch research',
      propertyId,
      campaignId,
    });
    await updateJob(db, jobId, {
      status: 'analysing_property',
      progress: 10,
      current_step: 'Loading previously collected buyer signals',
    });

    const settingKeys = [
      'external_discovery_enabled',
      'provider_kill_switch',
      'provider_disabled_list',
      'external_discovery_strong_score',
      'external_discovery_min_strong_matches',
      'external_discovery_fresh_hours',
      'external_discovery_max_jobs_per_property_tick',
    ];
    const { data: settingRows, error: settingsError } = await db
      .from('admin_settings')
      .select('key,value')
      .in('key', settingKeys);
    if (settingsError) throw settingsError;
    const settings = Object.fromEntries((settingRows || []).map((row: any) => [row.key, scalar(row.value, null)]));
    const externalEnabled = settings.external_discovery_enabled === true;
    const killSwitch = settings.provider_kill_switch !== false;
    const disabledProviders = Array.isArray(settings.provider_disabled_list)
      ? settings.provider_disabled_list.map((value: unknown) => String(value).toUpperCase())
      : [];
    const externalControlled = externalEnabled && !killSwitch;

    await updateJob(db, jobId, {
      status: 'classifying',
      progress: 30,
      current_step: 'Scoring existing real buyer signals',
      provider_results: {
        internal_data: 'LIVE',
        external_discovery: externalControlled ? 'CONTROLLED' : 'LOCKED',
      },
    });
    await event(db, jobId, 'INTERNAL_MATCHING_START', {
      message: 'Using deduplicated signals already paid for and stored in Homatch',
    });

    const internal = await invoke(baseUrl, serviceKey, 'run-matching-v2', {
      propertyId,
      campaignId,
      intentProfileBatchSize: 5000,
    }, 180_000);
    if (internal.data?.error) throw new Error(String(internal.data.error));

    await event(db, jobId, 'INTERNAL_MATCHING_COMPLETE', {
      message: `Internal matching created ${Number(internal.data?.matchesCreated || 0)} new matches`,
      candidateSignals: Number(internal.data?.candidateSignals || 0),
      profilesConsidered: Number(internal.data?.profilesConsidered || 0),
      matchesCreated: Number(internal.data?.matchesCreated || 0),
      matchesSkipped: Number(internal.data?.matchesSkipped || 0),
      bestScore: Number(internal.data?.bestScore || 0),
      buckets: internal.data?.buckets || {},
    });

    const strongScore = Number(settings.external_discovery_strong_score || 70);
    const minStrong = Number(settings.external_discovery_min_strong_matches || 3);
    const freshHours = Number(settings.external_discovery_fresh_hours || 24);
    const freshSince = new Date(Date.now() - Math.max(1, freshHours) * 3_600_000).toISOString();
    const { count: strongCount, error: strongError } = await db
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('property_id', propertyId)
      .gte('match_score', strongScore)
      .gte('created_at', freshSince);
    if (strongError) throw strongError;

    let externalResult: any = null;
    if (Number(strongCount || 0) >= minStrong) {
      await event(db, jobId, 'EXTERNAL_DISCOVERY_NOT_NEEDED', {
        message: 'Internal results reached the strong-match target; no paid provider call was needed',
        strongMatches: Number(strongCount || 0),
        required: minStrong,
      });
    } else if (!externalControlled) {
      await event(db, jobId, 'EXTERNAL_DISCOVERY_LOCKED', {
        message: 'External discovery stayed locked; no paid provider call was made',
        externalDiscoveryEnabled: externalEnabled,
        providerKillSwitch: killSwitch,
        disabledProviders,
        strongMatches: Number(strongCount || 0),
        required: minStrong,
      });
    } else {
      await updateJob(db, jobId, {
        status: 'searching_sources',
        progress: 65,
        current_step: 'Controlled external discovery: budget and claim checks',
      });
      await event(db, jobId, 'EXTERNAL_DISCOVERY_START', {
        message: 'Internal results were insufficient; starting controlled queue consumer',
        strongMatches: Number(strongCount || 0),
        required: minStrong,
      });
      // The authorised budget, in the provider's own unit. wallet_reserve
      // worked this out from what the credits buy at THIS plan's member rate,
      // so the same 10 Credits authorises more underlying discovery on Premium
      // than on Free. The worker must not spend past it.
      const budgetCents = Number(grant.providerBudgetCeilingCents ?? 0);
      const maxSpendUsd = budgetCents > 0 ? budgetCents / 100 : null;

      // A smaller budget should produce a deliberately SCOPED search, not a
      // full one interrupted half way. Fewer, highest-yield jobs rather than a
      // broad sweep that runs out of money mid-sweep.
      const configuredMax = Math.min(25, Math.max(1, Number(settings.external_discovery_max_jobs_per_property_tick || 10)));
      const maxJobs = grant.partialBudget
        ? Math.max(1, Math.min(configuredMax, Math.floor(configuredMax / 2)))
        : configuredMax;

      const external = await invoke(baseUrl, serviceKey, 'discovery-queue-worker', {
        mode: 'execute',
        propertyId,
        campaignId,
        limit: maxJobs,
        // A hard ceiling, enforced inside the worker before each provider call.
        maxSpendUsd,
        qualityTier: grant.qualityTier,
      }, 330_000);
      externalResult = external.data;
      await event(db, jobId, external.status === 423 ? 'EXTERNAL_DISCOVERY_LOCKED' : 'EXTERNAL_DISCOVERY_COMPLETE', {
        message: external.status === 423
          ? 'Controlled consumer blocked the provider call'
          : `Controlled consumer processed ${Number(external.data?.processed || 0)} queue jobs`,
        processed: Number(external.data?.processed || 0),
        completed: Array.isArray(external.data?.completed) ? external.data.completed.length : 0,
        failures: Array.isArray(external.data?.failures) ? external.data.failures.length : 0,
        blocked: external.data?.blocked === true,
        reason: external.data?.reason || null,
        budgetExhausted: external.data?.budgetExhausted === true,
        spentUsd: Number(external.data?.spentUsd || 0),
        authorizedSpendUsd: maxSpendUsd,
      });
    }

    await updateJob(db, jobId, {
      status: 'ranking',
      progress: 90,
      current_step: 'Finalising ranked matches',
    });

    const [candidateCountResult, matchCountResult, costResult] = await Promise.all([
      db.from('property_signal_candidates').select('signal_id', { count: 'exact', head: true }).eq('property_id', propertyId),
      db.from('matches').select('id', { count: 'exact', head: true }).eq('property_id', propertyId),
      db.from('cost_events').select('cost_usd').eq('property_id', propertyId).gte('timestamp', startedAt),
    ]);
    if (candidateCountResult.error) throw candidateCountResult.error;
    if (matchCountResult.error) throw matchCountResult.error;
    if (costResult.error) throw costResult.error;
    const totalCost = (costResult.data || []).reduce((sum: number, row: any) => sum + Number(row.cost_usd || 0), 0);
    const totalMatches = Number(matchCountResult.count || 0);
    const candidateSignals = Number(candidateCountResult.count || internal.data?.candidateSignals || 0);
    const profilesConsidered = Number(internal.data?.profilesConsidered || 0);
    const skipped = Number(internal.data?.matchesSkipped || 0);

    const noResultsReason = totalMatches === 0
      ? (!externalControlled ? 'NO_INTERNAL_MATCHES_EXTERNAL_LOCKED' : 'NO_QUALIFIED_DEMAND_FOUND')
      : null;
    await updateJob(db, jobId, {
      status: totalMatches > 0 ? 'completed' : 'partially_completed',
      progress: 100,
      current_step: totalMatches > 0
        ? `Completed with ${totalMatches} ranked matches`
        : 'Completed without a qualified demand match',
      signals_collected: candidateSignals,
      signals_classified: profilesConsidered,
      signals_rejected: skipped,
      candidates_after_filter: totalMatches,
      matches_created: totalMatches,
      matches_found: totalMatches,
      queries_run: Number(externalResult?.processed || 0),
      tiers_run: 1,
      cost_usd_total: totalCost,
      failure_reason: noResultsReason,
      completed_at: new Date().toISOString(),
    });
    await event(db, jobId, 'JOB_COMPLETE', {
      message: `Matching completed with ${totalMatches} real matches`,
      totalMatches,
      candidateSignals,
      costUsd: totalCost,
      paidProviderCalls: Number(externalResult?.processed || 0),
    });

    /* ---- the search includes its results ----
     *
     * A Find Clients search is a billed execution. Charging again to reveal
     * what it found would be charging twice for one thing, so every match this
     * job produced is stamped with the reservation that paid for it and
     * atomic_match_unlock reveals those for zero.
     *
     * Scoped to matches created since this job started, so it cannot
     * retroactively make somebody's older, separately-priced matches free. */
    if (grant.reservationId) {
      const { error: includeErr } = await db
        .from('matches')
        .update({ unlock_included_reservation_id: grant.reservationId })
        .eq('property_id', propertyId)
        .gte('created_at', startedAt)
        .is('unlock_included_reservation_id', null);
      if (includeErr) {
        // Loud, because the alternative is silently charging a customer twice.
        console.error('[match-campaign] could not mark results as included', includeErr);
        await event(db, jobId, 'INCLUDE_MARK_FAILED', { message: includeErr.message });
      }
    }

    /* ---- settle on what the pipeline actually spent ----
     *
     * totalCost is summed from cost_events written by the providers this run
     * actually called, so a search that found its answer in existing Homatch
     * data costs the customer far less than one that had to go out and buy
     * fresh discovery. That is the reuse economics working as intended. */
    let creditsCharged = 0;
    try {
      const settled = await settleExecution(db, grant, {
        provider: 'homatch_matching',
        providerOperation: 'find_clients_search',
        providerRequestId: jobId ?? undefined,
        searchCount: Number(externalResult?.processed || 0),
        durationMs: Date.now() - new Date(startedAt).getTime(),
        rawProviderCostCents: totalCost * 100,
        metadata: {
          quality_tier: grant.qualityTier,
          result_ceiling: grant.resultCeiling,
          matches: totalMatches,
          candidate_signals: candidateSignals,
        },
      }, totalMatches > 0 ? 'SUCCESS' : 'PARTIAL');
      creditsCharged = settled.chargedCredits;
    } catch (e) {
      console.error('[match-campaign] settle failed; sweeper will reconcile', e);
    }

    return json({
      success: true,
      jobId,
      campaignId,
      status: totalMatches > 0 ? 'completed' : 'partially_completed',
      billing: {
        funding: grant.funding,
        planCode: grant.planCode,
        qualityTier: grant.qualityTier,
        resultCeiling: grant.resultCeiling,
        creditsCharged,
        creditsAuthorized: grant.authorizedMaxCredits,
        // True when the customer chose to search with less than the estimate.
        partialBudget: grant.partialBudget,
        // Results of a paid search are included; revealing them costs nothing.
        resultsIncluded: !!grant.reservationId,
      },
      matchesCreated: totalMatches,
      candidateSignals,
      costUsd: totalCost,
      externalDiscovery: externalControlled ? (externalResult || { skipped: true }) : { locked: true },
    });
  } catch (error) {
    const errorMessage = message(error);
    // Our pipeline broke. The customer keeps their credits and, if the run was
    // allowance-funded, their included search for the month.
    if (grantRef) {
      await releaseExecution(db, grantRef, 'pipeline_error').catch(() => undefined);
    }
    if (jobId) {
      await event(db, jobId, 'JOB_FAILED', { message: errorMessage }).catch(() => undefined);
      await updateJob(db, jobId, {
        status: 'failed',
        progress: 100,
        current_step: 'Matching failed',
        failure_reason: 'PIPELINE_ERROR',
        error_message: errorMessage.slice(0, 1000),
        completed_at: new Date().toISOString(),
      }).catch(() => undefined);
    }
    return json({ error: errorMessage, jobId }, 500);
  }
});
