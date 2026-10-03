import { createClient } from 'jsr:@supabase/supabase-js@2';
import { beginExecution, releaseExecution } from '../_shared/billing.ts';
import { loadDiscoverySettings } from '../_shared/discoverySettings.ts';
import { claimJobTransition, finalizeCampaignJob } from '../_shared/campaignRun.ts';
import { queuePlannedJobs, storePlan } from '../_shared/campaignSources.ts';
import { compileDemandPlan } from '../../../src/research-core/discovery/discovery-plan.ts';
import { fetchCurrentFx } from '../_shared/fx.ts';
import {
  persistCampaignLanguages,
  readChoice,
  resolveForRun,
} from '../_shared/campaignLanguages.ts';
import {
  planExpansion,
  type ExpansionPlan,
} from '../../../src/research-core/discovery/search-expansion.ts';

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

    let userQuery = db.from('users').select('id,is_admin,suspended_at');
    userQuery = serviceInvocation
      ? userQuery.eq('id', String(body.userId || ''))
      : userQuery.eq('auth_id', authenticatedAuthId);
    const { data: homatchUser, error: userError } = await userQuery.maybeSingle();
    if (userError) throw userError;
    if (!homatchUser) return json({ error: 'Homatch user not found' }, 403);
    if (homatchUser.suspended_at) {
      return json({ error: 'This account is suspended.', reasonCode: 'ACCOUNT_SUSPENDED' }, 403);
    }

    const { data: property, error: propertyError } = await db
      .from('properties')
      // country_code decides which languages this market is written in, so a
      // campaign cannot resolve its search languages without it.
      .select('id,user_id,title,matching_status,transaction_type,property_type,'
        + 'facts:property_facts!property_id(country_code,city,district,total_price,currency,bedrooms,area)')
      .eq('id', propertyId)
      .eq('is_deleted', false)
      .maybeSingle();
    if (propertyError) throw propertyError;
    if (!property) return json({ error: 'Property not found' }, 404);
    if (property.user_id !== homatchUser.id && homatchUser.is_admin !== true) {
      return json({ error: 'Forbidden' }, 403);
    }

    /*
     * PAUSE / RESUME / STOP — server-side, owner-checked and atomic
     * (discovery_control). Pause holds the run's open source jobs; resume
     * continues them with the window that was left; stop closes the window and
     * the driver finishes with what arrived, settling only what was delivered.
     * The client never edits a job or a campaign row to do this.
     */
    const controlAction = String(body.action || '').toLowerCase();
    if (controlAction === 'pause' || controlAction === 'resume' || controlAction === 'stop') {
      const controlJobId = String(body.jobId || '');
      const { data: controlled } = await db.from('matching_jobs')
        .select('id,property_id,user_id').eq('id', controlJobId).eq('property_id', propertyId).maybeSingle();
      if (!controlled) return json({ error: 'That search does not belong to this property.', reasonCode: 'UNKNOWN_JOB' }, 404);
      const { data: outcome, error: controlError } = await db.rpc('discovery_control', {
        p_kind: 'MATCHING_JOB', p_id: controlJobId, p_user_id: controlled.user_id, p_action: controlAction,
      });
      if (controlError) throw controlError;
      if (!outcome?.ok) return json({ error: 'This search cannot do that now.', reasonCode: outcome?.error ?? 'REFUSED', status: outcome?.status ?? null }, 409);
      const controlEvent = { pause: 'CAMPAIGN_PAUSED', resume: 'CAMPAIGN_RESUMED', stop: 'CAMPAIGN_STOPPED' }[controlAction];
      await event(db, controlJobId, controlEvent, {
        message: controlAction === 'pause' ? 'Paused by the customer; no new source work starts until resume'
          : controlAction === 'resume' ? 'Resumed by the customer; held source work continues'
          : 'Stopped by the customer; the search finishes with what has arrived',
        ...outcome,
      }).catch(() => undefined);
      return json({ success: true, jobId: controlJobId, ...outcome });
    }

    /*
     * FRESHNESS. A property its owner has not confirmed for 30 days is not freshly
     * confirmed inventory, so a NEW search does not start for it (pause, resume and
     * stop above are unaffected). Renewal is free and restores it. Read separately
     * so a database without the lifecycle columns yet keeps working exactly as before.
     */
    const { data: freshness, error: freshnessError } = await db
      .from('properties').select('freshness_anchor_at').eq('id', propertyId).maybeSingle();
    if (freshnessError && !String(freshnessError.message ?? '').includes('freshness_anchor_at')) throw freshnessError;
    const anchor = freshness?.freshness_anchor_at ? Date.parse(String(freshness.freshness_anchor_at)) : NaN;
    if (Number.isFinite(anchor) && Date.now() - anchor >= 30 * 86_400_000) {
      return json({ error: 'This property has expired. Renew it (free) to restart discovery.', reasonCode: 'PROPERTY_EXPIRED' }, 409);
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

    /* ---- search languages ----
     *
     * Resolved HERE, on the server, from the CHOICE the client sent rather
     * than from a conclusion it computed. The same pure function the launch
     * screen previewed with runs again, so a modified client posting a wider
     * resolved set under mode EXPLICIT gains nothing -- and the set the
     * customer saw is the set that runs.
     *
     * A request with no choice keeps whatever the campaign already has. That
     * is what makes a resume a resume: re-deciding from today's market
     * defaults would turn "the customer chose Hebrew" into "we searched six
     * languages and billed for them".
     */
    const facts = Array.isArray(property.facts) ? property.facts[0] : property.facts;
    const countryCode = String(facts?.country_code || 'GE');

    const { data: storedCampaign } = await db
      .from('matching_campaigns')
      .select('status_v2, search_language_mode, search_languages_selected, search_languages_resolved, search_languages_discovered')
      .eq('id', campaignId)
      .maybeSingle();

    const languages = await resolveForRun(db, {
      countryCode,
      choice: readChoice(body.searchLanguages),
      stored: storedCampaign ?? null,
    });
    await persistCampaignLanguages(db, campaignId, languages);

    /* ---- expand search ----
     *
     * A campaign searching DEEPER rather than again. The first sweep recorded
     * what it reached (discovery_headroom) and what it read (sources_read), and
     * this turns those into an exclusion set so the customer buys only work that
     * has not been done.
     *
     * The plan is refused rather than trimmed when there is nothing to sell. In
     * particular a sweep that recorded no reach at all is NOT read as "you have
     * seen everything" — see planExpansion, where those are two different
     * refusals on purpose.
     *
     * NOTE ON IDEMPOTENCY. The expansion's key is derived from the campaign, the
     * job being extended and the exact exclusion set, with no clock and no
     * random component, and it is fed into the SAME idempotency path every search
     * uses below. So two clicks find the earlier job and reserve nothing twice,
     * while a second, genuinely different expansion changes the exclusion set and
     * is correctly a new purchase.
     */
    let expansion: { plan: ExpansionPlan; fromJobId: string } | null = null;
    if (body.expandFromJobId) {
      const fromJobId = String(body.expandFromJobId);
      const { data: previousJob } = await db
        .from('matching_jobs')
        .select('id,status,discovery_headroom,campaign_id')
        .eq('id', fromJobId)
        .eq('campaign_id', campaignId)
        .maybeSingle();

      if (!previousJob) {
        return json({ error: 'That search does not belong to this campaign.', reasonCode: 'UNKNOWN_JOB' }, 404);
      }

      /* Every sweep of this campaign, not only the one being extended: a
         campaign expanded twice must not re-read what the first expansion did. */
      const { data: sweeps } = await db
        .from('matching_jobs')
        .select('sources_read,idempotency_key')
        .eq('campaign_id', campaignId)
        .not('sources_read', 'is', null);

      const plan = planExpansion({
        campaignId,
        previousJobId: fromJobId,
        previousJobStatus: String(previousJob.status ?? ''),
        campaignStatus: String(storedCampaign?.status_v2 ?? 'ACTIVE'),
        headroom: (previousJob.discovery_headroom ?? null) as never,
        sourcesAlreadyRead: (sweeps ?? []).flatMap((row) => (row.sources_read ?? []) as string[]),
        priorExpansionKeys: (sweeps ?? [])
          .map((row) => String(row.idempotency_key ?? ''))
          .filter((key) => key.includes('expand:')),
      });

      if (!plan.eligible) {
        return json({
          error: 'There is nothing deeper to search for this campaign right now.',
          reasonCode: plan.refusal,
          /* The operator's sentence, not the customer's. The client renders its
             own copy from reasonCode; this is for the log. */
          detail: plan.rationale,
        }, 409);
      }
      expansion = { plan, fromJobId };
    }

    const suppliedKey = expansion
      ? expansion.plan.idempotencyKey
      : String(body.idempotencyKey || crypto.randomUUID());
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

    /*
     * ONE RUNNING SEARCH PER PROPERTY. A double click or a second tab carries a
     * different key, so the idempotency check above cannot see it; without this
     * it would reserve a second budget for the same search. The running job is
     * returned instead. A language expansion extends a finished sweep and is
     * exempt.
     */
    if (!expansion) {
      const { data: running } = await db
        .from('matching_jobs')
        .select('id,status')
        .eq('property_id', propertyId)
        .in('status', ['queued', 'analysing_property', 'generating_queries', 'searching_sources',
          'collecting_results', 'normalizing', 'deduplicating', 'classifying', 'ranking'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (running) {
        return json({ success: true, idempotent: true, alreadyRunning: true, jobId: running.id, campaignId, status: running.status });
      }
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
    /*
     * PAY-AS-YOU-GO, WITH A CAMPAIGN BUDGET THE CUSTOMER SETS.
     *
     * The budget is a CEILING: it is reserved in full, settlement charges what
     * the run actually used, and the rest is released. It may not be below the
     * campaign minimum (50 Credits by default), because a smaller budget buys
     * a search that cannot cover the sources worth reading. No plan allowance
     * funds a campaign -- HOMATCH is PAYG-only.
     */
    const discovery = await loadDiscoverySettings(db);
    const requestedBudget = body.authorizedMaxCredits != null
      ? Number(body.authorizedMaxCredits)
      : discovery.campaignDefaultCredits;
    if (!Number.isFinite(requestedBudget) || requestedBudget < discovery.campaignMinCredits) {
      return json({
        error: `A campaign budget starts at ${discovery.campaignMinCredits} Credits.`,
        reasonCode: 'BELOW_CAMPAIGN_MINIMUM',
        minBudgetCredits: discovery.campaignMinCredits,
      }, 400);
    }
    if (discovery.campaignMaxCredits !== null && requestedBudget > discovery.campaignMaxCredits) {
      return json({
        error: `A campaign budget is at most ${discovery.campaignMaxCredits} Credits.`,
        reasonCode: 'ABOVE_CAMPAIGN_MAXIMUM',
        maxBudgetCredits: discovery.campaignMaxCredits,
      }, 400);
    }
    const grant = await beginExecution(db, {
      userId: homatchUser.id,
      productCode: 'FIND_CLIENTS',
      idempotencyKey: `findclients:${idempotencyKey}`,
      jobRef: propertyId,
      authorizedMaxCredits: requestedBudget,
      allowIncluded: false,
      budgetIsCeiling: true,
      /* A balance below the budget is refused, not quietly shrunk: the
         customer chose this ceiling and is told if it cannot be reserved. */
      requireFullBudget: true,
      metadata: { campaignId, propertyId, campaignBudgetCredits: requestedBudget },
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
      /*
       * A SNAPSHOT, not a pointer. The campaign's language set can change
       * before the next run, and "what did this job search in" has to stay
       * answerable afterwards -- a job reading the campaign column would
       * answer with today's configuration about last week's work.
       */
      search_languages: languages.selection.languages,
      search_language_mode: languages.selection.mode,
      started_at: startedAt,
      /* So the discovery driver can settle this run after the request ends. */
      billing_grant: grant,
    }).select('id').single();
    if (jobError || !createdJob) throw jobError || new Error('Could not create matching job');
    jobId = String(createdJob.id);

    await event(db, jobId, 'JOB_STARTED', {
      message: 'Matching started from existing Homatch research',
      propertyId,
      campaignId,
    });
    /*
     * The language decision, on the record, before any work is billed.
     *
     * `newThisRun` is what makes a continuation cheap and legible: a campaign
     * that ran Hebrew and English and gains Russian schedules RUSSIAN, and
     * the event says so. Without it there is no way to tell "the set changed"
     * from "this language is new", and every edit re-buys everything.
     */
    await event(db, jobId, 'SEARCH_LANGUAGES_RESOLVED', {
      mode: languages.selection.mode,
      languages: languages.selection.languages,
      newThisRun: languages.toDiscover,
      alreadyDiscovered: languages.alreadyDiscovered,
      fromStoredConfiguration: languages.fromStoredConfiguration,
      rationale: languages.selection.rationale,
      warnings: languages.selection.warnings,
      countryCode,
    });
    await updateJob(db, jobId, {
      status: 'analysing_property',
      progress: 10,
      current_step: 'Loading previously collected buyer signals',
    });

    /* Retired-provider settings (external_discovery_enabled,
       provider_kill_switch, ...) are no longer read: the paid external
       consumer they governed could only ever claim DATAFORSEO or APIFY. */
    const settingKeys = [
      'external_discovery_min_strong_matches',
      'supply_discovery_for_campaigns',
      'supply_discovery_limit_per_source',
    ];
    const { data: settingRows, error: settingsError } = await db
      .from('admin_settings')
      .select('key,value')
      .in('key', settingKeys);
    if (settingsError) throw settingsError;
    const settings = Object.fromEntries((settingRows || []).map((row: any) => [row.key, scalar(row.value, null)]));

    /*
     * THE DISCOVERY PLAN, stored before any work: what this run will search,
     * in which tranches, within which limits. Source jobs below are derived
     * from it and nothing else (docs/claude/PHASE2_DISCOVERY.md).
     */
    const target = Math.max(1, Number(settings.external_discovery_min_strong_matches || 3));
    const plan = compileDemandPlan({
      market: countryCode || 'GE',
      languages: languages.selection.languages,
      property: {
        transactionType: (property as any).transaction_type ?? null,
        propertyType: (property as any).property_type ?? null,
        city: facts?.city ?? null,
        district: facts?.district ?? null,
        price: facts?.total_price != null ? Number(facts.total_price) : null,
        currency: facts?.currency ?? null,
        bedrooms: facts?.bedrooms != null ? Number(facts.bedrooms) : null,
        areaSqm: facts?.area != null ? Number(facts.area) : null,
      },
      switches: {
        telegram: discovery.campaignSourceDiscoveryEnabled && discovery.telegramEnabled,
        forum: discovery.campaignSourceDiscoveryEnabled && discovery.forumDiscoveryEnabled,
        portals: false,
        livePortalAdapters: [],
      },
      limits: {
        maxCredits: requestedBudget,
        deadlineMinutes: discovery.campaignDiscoveryMinutes,
        targetResults: target,
        activeDemandMaxDays: discovery.freshness.activeMaxDays,
      },
    });
    const planId = await storePlan(db, { plan, userId: property.user_id, matchingJobId: jobId });
    await updateJob(db, jobId, { search_plan_id: planId });
    await event(db, jobId, 'SEARCH_PLAN_READY', {
      message: 'Search plan ready',
      planId,
      direction: plan.direction,
      tranches: plan.tranches.map((t) => ({ tranche: t.tranche, label: t.label, sourceClasses: t.sourceClasses })),
      hardConstraints: plan.hardConstraints,
      languages: plan.languages,
    });

    await updateJob(db, jobId, {
      status: 'classifying',
      progress: 30,
      current_step: 'Scoring current buyer and tenant demand already in Homatch',
      provider_results: {
        internal_data: 'LIVE',
        source_discovery: 'PENDING',
      },
    });
    await event(db, jobId, 'INTERNAL_MATCHING_START', {
      message: 'Using deduplicated signals already paid for and stored in Homatch',
    });

    /* Official exchange rates for the budget gate, fetched here so the
       match writer never has to (best effort; null leaves FX unknown). */
    const fxRates = await fetchCurrentFx();
    const internal = await invoke(baseUrl, serviceKey, 'run-matching-v2', {
      propertyId,
      campaignId,
      fxRates,
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

    /*
     * SUPPLY COMPARABLES — the one discovery path that is actually live.
     *
     * This reads real listings from sources the registry has marked
     * LIVE_TESTED, over Homatch's own fetch path: no provider, no per-call
     * fee, no wallet reservation. It is not a replacement for the retired
     * external discovery below and it answers a different question — that one
     * looked for BUYERS, this looks at what this property is competing
     * against.
     *
     * OFF BY DEFAULT. A new step in a customer's campaign is enabled
     * deliberately, once, by an operator, and not by a deploy.
     *
     * A FAILURE HERE DOES NOT FAIL THE CAMPAIGN. The matching above is the
     * customer's result; comparables are intelligence around it. A source
     * that has started refusing us is recorded as a refusal against that
     * source and the campaign carries on, because the alternative is a
     * portal's bad afternoon deciding whether somebody's campaign ran.
     */
    let supplyResult: any = null;
    if (settings.supply_discovery_for_campaigns === true) {
      const perSource = Math.max(1, Math.min(10, Number(settings.supply_discovery_limit_per_source || 3)));
      await event(db, jobId, 'SUPPLY_SCAN_START', {
        message: 'Reading live comparable supply for this property',
        limitPerSource: perSource,
      });
      try {
        const supply = await invoke(baseUrl, serviceKey, 'supply-discovery', {
          /*
           * The campaign id and NOTHING ELSE that narrows. supply-discovery
           * builds the envelope from the campaign's own property and resolved
           * languages; a city or a price passed from here would be this
           * function's opinion of the campaign overriding the campaign.
           */
          campaignId,
          jobId,
          limitPerSource: perSource,
          /*
           * HOW THIS RUN WAS FUNDED, which is an authorisation rather than a
           * narrowing -- the note above forbids passing anything that narrows
           * the campaign's own envelope, and this widens it.
           *
           * Only the holder of the grant knows whether the customer spent
           * credits on this search or used the one their plan includes, and
           * supply-discovery needs it to decide whether the plan's tier is a
           * floor or a ceiling. Without it, a PAYG customer's paid search
           * would still be held to their subscription's depth.
           */
          funding: grant.funding,
          /*
           * AN EXPANSION BUYS NEW WORK ONLY. The sources this campaign has
           * already paid to read, so the sweep drops them after its own
           * entitlement gate. Absent on a first search, which is why this is
           * spread rather than passed as an empty array: an empty array and
           * "not an expansion" are different requests, and the sweep reports
           * the difference.
           */
          ...(expansion ? { excludeAdapterIds: expansion.plan.excludeSourceIds } : {}),
        }, 120_000);
        supplyResult = supply.data;

        /*
         * WHAT THIS SEARCH DID NOT REACH, remembered.
         *
         * The sweep gates sources by the customer's entitlement and reports
         * how many it therefore did not touch -- five of eight on FREE, two
         * on VIP. That existed only in this response, so nothing afterwards
         * knew a deeper search was possible without running one to find out.
         *
         * Stored in the customer's vocabulary and nothing else: how deep the
         * search went, how many sources it read, how many more exist, and
         * whether there is any point offering more. No tier numbers, no
         * adapter ids, no supplier names, no costs -- the same line the
         * progress panel had to be cleaned of. Admin reads the sweep's own
         * response for the detail.
         */
        const ent = supply.data?.entitlement;
        if (ent?.applied) {
          const deeper = Number(ent.sourcesOutsideEntitlement ?? 0);
          await updateJob(db, jobId, {
            discovery_headroom: {
              searchDepth: grant.qualityTier,
              sourcesSearched: Number(supply.data?.sourcesReached ?? 0),
              sourcesAvailableDeeper: deeper,
              resultCeiling: grant.resultCeiling,
              moreAvailable: deeper > 0,
            },
          }).catch(() => undefined);
        }

        /*
         * THE RECEIPT, in its own column and in internal vocabulary.
         *
         * Which sources this sweep actually read, so the next expansion can
         * exclude exactly them. Deliberately NOT folded into discovery_headroom:
         * that column's contract is the customer's vocabulary, and an adapter id
         * in it would be a supplier name one render away from a customer's
         * screen.
         *
         * Written whether or not an entitlement applied. An ungated sweep reads
         * sources too, and a campaign that started ungated and is later expanded
         * would otherwise re-buy every one of them.
         */
        const sourcesRead = Array.isArray(supply.data?.sourcesRead)
          ? supply.data.sourcesRead.map((id: unknown) => String(id)).filter(Boolean)
          : [];
        if (sourcesRead.length > 0) {
          /*
           * NON-FATAL, BUT NEVER SILENT.
           *
           * A bookkeeping write must not fail a search the customer has already
           * paid for, so this does not throw. The first version also did not
           * REPORT, and that cost an hour: `sources_read` shipped in the same
           * commit as the code writing to it, migrations in this repository only
           * run on a manual workflow_dispatch, so the column did not exist in
           * production and every write was swallowed by `.catch(() =>
           * undefined)`. Expand Search would have looked like it worked and
           * quietly re-bought every source on the second expansion.
           *
           * So a failure becomes an event. It is still not fatal; it is just no
           * longer invisible.
           */
          await updateJob(db, jobId, { sources_read: sourcesRead }).catch(async (error) => {
            await event(db, jobId!, 'RECEIPT_WRITE_FAILED', {
              message: 'the sources this sweep read could not be recorded',
              detail: message(error),
              /* Named so the consequence is in the log, not inferred from it. */
              consequence: 'a later Expand Search cannot exclude them and would re-read work '
                + 'this campaign has already paid for',
              sourcesRead,
            }).catch(() => undefined);
          });
        }

        const perSourceRows = Array.isArray(supply.data?.perSource) ? supply.data.perSource : [];
        await event(db, jobId, 'SUPPLY_SCAN_COMPLETE', {
          message: `Read ${Number(supply.data?.sourcesReached || 0)} live sources for comparable supply`,
          /* DISCOVERED vs REUSED: the second campaign in a market should be
             cheaper than the first, and this is where that shows or does
             not. */
          observationsNew: Number(supply.data?.observationsNew || 0),
          observationsReused: Number(supply.data?.observationsUpdated || 0),
          sourcesPermitted: Number(supply.data?.sourcesPermitted || 0),
          sourcesReached: Number(supply.data?.sourcesReached || 0),
          sourcesBlocked: Number(supply.data?.sourcesBlocked || 0),
          /* The scope this scan actually used, so the event is reproducible
             without re-deriving it from the property. */
          envelope: supply.data?.envelope ?? null,
          rejectedByEnvelope: perSourceRows.reduce(
            (total: number, row: any) => total + Number(row?.rejectedByEnvelope || 0), 0,
          ),
          networkRequests: Number(supply.data?.fetch?.networkRequests || 0),
          entitiesTouched: Number(supply.data?.resolution?.entitiesTouched || 0),
          /* No provider was called, so this is stated rather than left to be
             assumed from a missing number. */
          providerSpendUsd: 0,
        });
      } catch (error) {
        await event(db, jobId, 'SUPPLY_SCAN_FAILED', {
          message: 'Comparable supply could not be read; the campaign continued without it',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }

    /*
     * GAP DISCOVERY.
     *
     * Internal matching above only creates matches on demand inside the
     * active window. When that produced fewer than the target, the campaign
     * asks its sources -- public Telegram channels and groups through the
     * official worker, and the forum readers -- for current demand, and the
     * run continues asynchronously: the discovery driver executes the source
     * jobs, classifies what they collected, matches again and settles.
     *
     * DATAFORSEO and APIFY are retired and are never queued here. The old
     * paid-provider consumer this replaced could only ever claim them.
     */
    const freshFromInternal = Number(internal.data?.matchesCreated || 0);
    const sourcesAvailable = plan.tranches.some((t) => t.tranche > 0);

    if (freshFromInternal < target && sourcesAvailable) {
      const queued = await queuePlannedJobs(db, {
        plan,
        planId,
        runKey: jobId!,
        matchingJobId: jobId!,
        propertyId,
      });
      if (queued.length > 0) {
        const deadline = new Date(Date.now() + discovery.campaignDiscoveryMinutes * 60_000).toISOString();
        await updateJob(db, jobId!, {
          status: 'searching_sources',
          progress: 45,
          current_step: 'Searching Telegram and forums for current demand',
          discovery_deadline_at: deadline,
          query_packs_created: queued.length,
          provider_results: { internal_data: 'DONE', source_discovery: 'QUEUED' },
        });
        await event(db, jobId!, 'SOURCE_DISCOVERY_QUEUED', {
          message: `Queued ${queued.length} source searches for current demand`,
          sources: queued,
          freshFromInternal,
          target,
          deadline,
          providerCostUsd: 0,
        });
        return json({
          success: true,
          async: true,
          jobId,
          campaignId,
          status: 'searching_sources',
          billing: {
            funding: grant.funding,
            creditsAuthorized: grant.authorizedMaxCredits,
            partialBudget: grant.partialBudget,
          },
        }, 202);
      }
    }

    await event(db, jobId!, sourcesAvailable ? 'SOURCE_DISCOVERY_NOT_NEEDED' : 'SOURCE_DISCOVERY_OFF', {
      message: sourcesAvailable
        ? 'Current internal demand reached the target; no source search was needed'
        : 'Source discovery is switched off; the campaign used current Homatch demand only',
      freshFromInternal,
      target,
      telegramEnabled: discovery.telegramEnabled,
      forumDiscoveryEnabled: discovery.forumDiscoveryEnabled,
      campaignSourceDiscoveryEnabled: discovery.campaignSourceDiscoveryEnabled,
    });

    const mayFinish = await claimJobTransition(db, jobId!, ['classifying', 'analysing_property', 'queued'], {
      status: 'ranking',
      progress: 90,
      current_step: 'Finalising ranked matches',
    });
    if (!mayFinish) {
      return json({ success: true, jobId, campaignId, status: 'ranking', note: 'already being finalised' });
    }

    const result = await finalizeCampaignJob(db, {
      id: jobId!, property_id: propertyId, campaign_id: campaignId, started_at: startedAt,
    }, grant, discovery.freshness, {
      internal: {
        candidateSignals: Number(internal.data?.candidateSignals || 0),
        profilesConsidered: Number(internal.data?.profilesConsidered || 0),
        rejectedStaleDemand: Number(internal.data?.rejectedAncientDemand || 0),
        rejectedStaleEvidence: Number(internal.data?.rejectedStaleEvidence || 0),
      },
      noResultsReason: sourcesAvailable ? 'NO_CURRENT_DEMAND_FOUND' : 'NO_CURRENT_DEMAND_SOURCES_OFF',
    });

    return json({
      success: true,
      jobId,
      campaignId,
      status: result.status,
      billing: {
        funding: grant.funding,
        creditsCharged: result.creditsCharged,
        creditsAuthorized: grant.authorizedMaxCredits,
        partialBudget: grant.partialBudget,
        resultsIncluded: !!grant.reservationId,
      },
      matchesCreated: result.freshMatches,
      stillCurrentFromEarlier: result.stillCurrentFromEarlier,
      activeWindowDays: discovery.freshness.activeMaxDays,
      costUsd: result.costUsd,
      supplyComparables: settings.supply_discovery_for_campaigns === true
        ? (supplyResult || { failed: true })
        : { enabled: false },
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
