// HOMATCH — find-property-run: a FIND PROPERTY search outside HOMATCH.
//
// find-property-plan turns the customer's sentence into a confirmed SearchPlan
// and a standing subscription; HOMATCH's own intelligence (supply-matching
// over stored listings and HOMATCH properties) answers it continuously and for
// free. THIS function is the paid step beyond that: the customer authorises a
// budget and HOMATCH searches live sources for listings that fit.
//
//   start   PAYG (reserve the budget the customer set) -> a discovery_run ->
//           its SUPPLY DiscoveryPlan stored -> source jobs queued from the plan.
//           The discovery driver executes them (portals through the
//           SSRF-guarded runtime, Telegram through the official worker),
//           matches, and settles only what was delivered.
//   pause / resume / stop
//           discovery_control, owner-checked and atomic.
//
// Idempotent: the same idempotency key returns the same run, and one open run
// per search is enforced, so a double click never reserves twice.

import { createClient } from 'jsr:@supabase/supabase-js@2';
import { beginExecution, releaseExecution } from '../_shared/billing.ts';
import { loadDiscoverySettings } from '../_shared/discoverySettings.ts';
import { queuePlannedJobs, storePlan } from '../_shared/campaignSources.ts';
import { OPEN_RUN_STATES, runEvent, updateRun } from '../_shared/discoveryRun.ts';
import { compileSupplyPlan, draftFromStoredPlan, sourceGroupOf } from '../../../src/research-core/discovery/discovery-plan.ts';
import { normalisePlan, type SearchPlan } from '../../../src/research-core/discovery/search-plan.ts';
import { livePortalAdaptersFor } from '../../../src/research-core/discovery/portal-selection.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, 'Content-Type': 'application/json' },
});

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const baseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!baseUrl || !serviceKey) return json({ error: 'Server configuration missing' }, 500);
  const db = createClient(baseUrl, serviceKey);

  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const { data: auth, error: authError } = await db.auth.getUser(token);
  if (authError || !auth.user) return json({ error: 'Unauthorized' }, 401);
  const { data: me } = await db.from('users').select('id,suspended_at').eq('auth_id', auth.user.id).maybeSingle();
  if (!me) return json({ error: 'Homatch user not found' }, 403);
  if (me.suspended_at) return json({ error: 'This account is suspended.', reasonCode: 'ACCOUNT_SUSPENDED' }, 403);

  let grant: Awaited<ReturnType<typeof beginExecution>> | null = null;
  let runId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'start').toLowerCase();

    if (action === 'pause' || action === 'resume' || action === 'stop') {
      const { data: outcome, error } = await db.rpc('discovery_control', {
        p_kind: 'DISCOVERY_RUN', p_id: String(body.runId || ''), p_user_id: me.id, p_action: action,
      });
      if (error) throw error;
      if (!outcome?.ok) return json({ error: 'This search cannot do that now.', reasonCode: outcome?.error ?? 'REFUSED' }, 409);
      await runEvent(db, String(body.runId), { pause: 'RUN_PAUSED', resume: 'RUN_RESUMED', stop: 'RUN_STOPPED' }[action]!, outcome)
        .catch(() => undefined);
      return json({ success: true, runId: body.runId, ...outcome });
    }
    if (action !== 'start') return json({ error: 'Unknown action' }, 400);

    const subscriptionId = String(body.subscriptionId || '');
    const { data: subscription } = await db.from('active_search_subscriptions')
      .select('id,user_id,intent_id,side,is_active,search_criteria')
      .eq('id', subscriptionId).eq('user_id', me.id).eq('side', 'SUPPLY').eq('is_active', true)
      .maybeSingle();
    if (!subscription?.intent_id) return json({ error: 'Search not found.', reasonCode: 'UNKNOWN_SEARCH' }, 404);

    /* The stored plan is re-normalised, never trusted as-is. */
    const { plan: searchPlan } = normalisePlan(draftFromStoredPlan(subscription.search_criteria));
    if (!searchPlan?.city) return json({ error: 'This search needs a city first.', reasonCode: 'PLAN_INCOMPLETE' }, 409);

    const settings = await loadDiscoverySettings(db);
    if (!settings.findPropertyDiscoveryEnabled) {
      return json({ error: 'Searching outside HOMATCH is not available right now.', reasonCode: 'DISCOVERY_OFF' }, 409);
    }

    const idempotencyKey = String(body.idempotencyKey || '').slice(0, 120);
    if (!idempotencyKey) return json({ error: 'idempotencyKey required' }, 400);
    const { data: prior } = await db.from('discovery_runs').select('id,status')
      .eq('user_id', me.id).eq('idempotency_key', idempotencyKey).maybeSingle();
    if (prior) return json({ success: true, idempotent: true, runId: prior.id, status: prior.status });
    const { data: open } = await db.from('discovery_runs').select('id,status')
      .eq('subscription_id', subscription.id).in('status', OPEN_RUN_STATES).limit(1).maybeSingle();
    if (open) return json({ success: true, idempotent: true, alreadyRunning: true, runId: open.id, status: open.status });

    /* Which portals are live for this market: the registry decides. */
    const market = String(searchPlan.countryCode || 'GE').toUpperCase();
    const { data: liveRows } = await db.from('source_registry').select('adapter_id')
      .eq('active', true).in('lifecycle', ['LIVE_TESTED', 'PRODUCTIVE'])
      .eq('country_code', market).not('adapter_id', 'is', null)
      .order('priority_tier', { ascending: true, nullsFirst: false });
    /* Only adapters the portal runtime executes (the ids a portal-job looks up),
       so ss.ge is planned as `ss-ge`; forum and Telegram rows drop out. */
    const livePortalAdapters = livePortalAdaptersFor(((liveRows ?? []) as Array<{ adapter_id: string }>)
      .map((r) => r.adapter_id));

    const budget = body.authorizedMaxCredits != null ? Number(body.authorizedMaxCredits) : settings.campaignDefaultCredits;
    if (!Number.isFinite(budget) || budget < settings.campaignMinCredits) {
      return json({ error: `A search budget starts at ${settings.campaignMinCredits} Credits.`,
        reasonCode: 'BELOW_CAMPAIGN_MINIMUM', minBudgetCredits: settings.campaignMinCredits }, 400);
    }

    const plan = compileSupplyPlan({
      plan: searchPlan as SearchPlan,
      switches: {
        telegram: settings.telegramEnabled, forum: false, portals: true, livePortalAdapters,
        workerRoutedAdapters: settings.workerRouteEnabled ? settings.workerRoutedAdapters : [],
      },
      limits: {
        maxCredits: budget,
        deadlineMinutes: settings.campaignDiscoveryMinutes,
        targetResults: 5,
        activeDemandMaxDays: settings.freshness.activeMaxDays,
      },
    });
    if (!plan.tranches.some((t) => t.tranche > 0)) {
      return json({ error: 'No live source can be searched for this market right now.', reasonCode: 'NO_LIVE_SOURCES' }, 409);
    }

    grant = await beginExecution(db, {
      userId: me.id,
      productCode: 'FIND_PROPERTY',
      idempotencyKey: `findproperty:${me.id}:${idempotencyKey}`,
      jobRef: subscription.id,
      authorizedMaxCredits: budget,
      allowIncluded: false,
      budgetIsCeiling: true,
      requireFullBudget: true,
      metadata: { subscriptionId: subscription.id, budgetCredits: budget },
    });
    if (!grant.ok) {
      return json({ error: 'This search needs Credits to continue.', reasonCode: grant.reason ?? 'BILLING_REQUIRED',
        minViableBudgetCredits: grant.minViableBudgetCredits }, 402);
    }

    const deadline = new Date(Date.now() + settings.campaignDiscoveryMinutes * 60_000).toISOString();
    const { data: run, error: runError } = await db.from('discovery_runs').insert({
      user_id: me.id,
      subscription_id: subscription.id,
      intent_profile_id: subscription.intent_id,
      idempotency_key: idempotencyKey,
      status: 'SEARCHING',
      stage: 'UNDERSTANDING',
      progress: 5,
      billing_grant: grant,
      deadline_at: deadline,
    }).select('id,started_at').single();
    if (runError) throw runError;
    runId = String(run.id);

    const planId = await storePlan(db, { plan, userId: me.id, discoveryRunId: runId });
    await updateRun(db, runId, { search_plan_id: planId, stage: 'CHECKING_HOMATCH', progress: 10 });
    await runEvent(db, runId, 'SEARCH_PLAN_READY', {
      planId, direction: plan.direction, hardConstraints: plan.hardConstraints,
      sourceGroups: [...new Set(plan.tranches.flatMap((t) => t.providers).map(sourceGroupOf))],
    });

    const queued = await queuePlannedJobs(db, {
      plan, planId, runKey: runId, discoveryRunId: runId, propertyId: null,
    });
    await updateRun(db, runId, { stage: 'SEARCHING_SOURCES', progress: 20 });
    await runEvent(db, runId, 'SOURCES_QUEUED', {
      count: queued.length,
      sourceGroups: [...new Set(queued.map((q) => sourceGroupOf(q.provider)))],
      deadline,
    });

    return json({ success: true, async: true, runId, status: 'SEARCHING',
      billing: { creditsAuthorized: grant.authorizedMaxCredits } }, 202);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (grant?.ok) await releaseExecution(db, grant, 'find_property_start_failed').catch(() => undefined);
    if (runId) {
      await updateRun(db, runId, { status: 'FAILED', stage: 'STOPPED', failure_reason: 'START_FAILED',
        error_message: detail.slice(0, 1000), completed_at: new Date().toISOString() }).catch(() => undefined);
    }
    console.error('find-property-run failed:', detail);
    return json({ error: 'The search could not start.', reasonCode: 'START_FAILED' }, 500);
  }
});
