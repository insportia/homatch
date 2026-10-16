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
import { OPEN_RUN_STATES, runEvent, updateRun } from '../_shared/discoveryRun.ts';
import { draftFromStoredPlan } from '../../../src/research-core/discovery/discovery-plan.ts';
import { normalisePlan } from '../../../src/research-core/discovery/search-plan.ts';
import { allocateCampaign, minimumCampaignCredits } from '../../../src/research-core/billing/paidDiscoveryPolicy.ts';
import { OFFER_NETWORKS, type OfferNetwork, type OfferSearch } from '../../../src/research-core/findProperty/offerCampaign.ts';
import { loadOfferSettings, offerQueueRows, planOfferCampaign } from '../_shared/findProperty/socialOffers.ts';

async function walletRate(db: any): Promise<number> {
  const { data } = await db.from('admin_settings').select('value').eq('key', 'credits_per_usd').maybeSingle();
  const n = Number(typeof data?.value === 'string' ? JSON.parse(data.value) : data?.value);
  return Number.isFinite(n) && n > 0 ? n : 10;
}

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
    if (action !== 'start' && action !== 'preview') return json({ error: 'Unknown action' }, 400);

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
    const offerSettings = await loadOfferSettings(db);
    const rate = await walletRate(db);
    const minCredits = Math.max(minimumCampaignCredits(rate), settings.campaignMinCredits);
    const budget = Math.round(Number(body.authorizedMaxCredits ?? Math.max(minCredits, settings.campaignDefaultCredits)));
    const transaction = searchPlan.deal === 'RENT' ? 'RENT' : 'SALE';
    const offerSearch: OfferSearch = {
      transaction, city: searchPlan.city.value,
      districts: searchPlan.districts?.value ?? [],
      propertyType: searchPlan.propertyTypes?.value?.[0] ?? null,
      languages: ['ka', 'ru', 'en'],
    };
    const requested = (Array.isArray(body.networks) ? body.networks : offerSettings.networks)
      .map((n: unknown) => String(n).toUpperCase())
      .filter((n: string): n is OfferNetwork => (OFFER_NETWORKS as readonly string[]).includes(n));
    const networks = [...new Set(requested)] as OfferNetwork[];
    if (!Number.isFinite(budget) || budget < minCredits) {
      return json({ error: `A campaign starts at ${minCredits} Credits.`, reasonCode: 'BELOW_CAMPAIGN_MINIMUM', minBudgetCredits: minCredits }, 400);
    }
    if (settings.campaignMaxCredits != null && budget > settings.campaignMaxCredits) {
      return json({ error: 'Above the campaign maximum.', reasonCode: 'ABOVE_CAMPAIGN_MAXIMUM', maxBudgetCredits: settings.campaignMaxCredits }, 400);
    }
    if (!networks.length) return json({ error: 'Choose at least one network.', reasonCode: 'NO_NETWORKS' }, 400);
    const allocation = allocateCampaign(budget, rate);
    const plan = await planOfferCampaign(db, {
      search: offerSearch, networks, providerBudgetMicros: allocation.providerBudgetMicros,
      countryCode: String(searchPlan.countryCode || 'GE').toUpperCase(),
    });
    const available = settings.findPropertyDiscoveryEnabled && offerSettings.enabled;
    const preview = {
      available,
      unavailableReason: !offerSettings.apifyEnabled ? 'PROVIDER_OFF' : !available ? 'PAID_CAMPAIGNS_OFF' : plan.jobs.length === 0 ? 'NO_SEARCHABLE_SOURCES' : null,
      priceCredits: budget, creditsPerUsd: rate, minCredits, maxCredits: settings.campaignMaxCredits,
      priceUsd: allocation.priceCents / 100,
      providerBudgetUsd: allocation.providerBudgetCents / 100,
      homatchShareUsd: allocation.homatchMarginCents / 100,
      policy: allocation.policy,
      charging: 'CONSUMED_DIV_0_63_CAPPED',
      networks,
      plannedRuns: plan.jobs.length,
      plannedByNetwork: Object.fromEntries(OFFER_NETWORKS.map((n) => [n, plan.jobs.filter((j) => j.network === n).length])),
      estimatedProviderUsd: Math.ceil(plan.estimatedMicros / 10_000) / 100,
      unavailableNetworks: plan.unavailable,
      skippedForBudget: plan.skippedForBudget,
      search: { transaction, city: offerSearch.city, districts: offerSearch.districts, propertyType: offerSearch.propertyType },
    };
    if (action === 'preview') return json({ success: true, preview });

    if (!available) {
      return json({ error: 'Paid campaigns are not available right now.', reasonCode: 'DISCOVERY_OFF', preview }, 409);
    }
    /* Explicit confirmation of exactly this price and these terms; nothing is reserved without it. */
    const confirm = body.confirm ?? {};
    if (confirm.acceptedTerms !== true || Number(confirm.priceCredits) !== budget) {
      return json({ error: 'Confirm the price to start.', reasonCode: 'CONFIRMATION_REQUIRED', preview }, 409);
    }
    if (!plan.jobs.length) {
      return json({ error: 'No network can be searched for this market right now.', reasonCode: 'NO_LIVE_SOURCES', preview }, 409);
    }

    const idempotencyKey = String(body.idempotencyKey || '').slice(0, 120);
    if (!idempotencyKey) return json({ error: 'idempotencyKey required' }, 400);
    const { data: prior } = await db.from('discovery_runs').select('id,status')
      .eq('user_id', me.id).eq('idempotency_key', idempotencyKey).maybeSingle();
    if (prior) return json({ success: true, idempotent: true, runId: prior.id, status: prior.status });
    const { data: open } = await db.from('discovery_runs').select('id,status')
      .eq('subscription_id', subscription.id).in('status', OPEN_RUN_STATES).limit(1).maybeSingle();
    if (open) return json({ success: true, idempotent: true, alreadyRunning: true, runId: open.id, status: open.status });

    grant = await beginExecution(db, {
      userId: me.id,
      productCode: 'FIND_PROPERTY',
      idempotencyKey: `findproperty:${me.id}:${idempotencyKey}`,
      jobRef: subscription.id,
      authorizedMaxCredits: budget,
      allowIncluded: false,
      budgetIsCeiling: true,
      requireFullBudget: true,
      metadata: { subscriptionId: subscription.id, budgetCredits: budget, pricing: allocation.policy, networks },
    });
    if (!grant.ok) {
      return json({ error: 'This campaign needs Credits to continue.', reasonCode: grant.reason ?? 'BILLING_REQUIRED',
        minViableBudgetCredits: grant.minViableBudgetCredits }, 402);
    }

    const deadline = new Date(Date.now() + settings.campaignDiscoveryMinutes * 60_000).toISOString();
    const { data: run, error: runError } = await db.from('discovery_runs').insert({
      user_id: me.id,
      subscription_id: subscription.id,
      intent_profile_id: subscription.intent_id,
      idempotency_key: idempotencyKey,
      status: 'SEARCHING',
      stage: 'SEARCHING_SOURCES',
      progress: 10,
      billing_grant: grant,
      deadline_at: deadline,
      pricing_policy: allocation.policy,
      credits_per_usd: rate,
      customer_value_micros: allocation.priceMicros,
      provider_budget_micros: allocation.providerBudgetMicros,
      offer_networks: networks,
      offer_plan: { version: plan.version, estimatedMicros: plan.estimatedMicros, unavailable: plan.unavailable, skippedForBudget: plan.skippedForBudget, jobs: plan.jobs.length },
    }).select('id,started_at').single();
    if (runError) throw runError;
    runId = String(run.id);

    const rows = offerQueueRows(runId, null, plan, offerSearch);
    const { error: queueError } = await db.from('discovery_query_queue').insert(rows);
    if (queueError) throw queueError;
    await runEvent(db, runId, 'SOURCES_QUEUED', {
      count: rows.length, networks, providerBudgetMicros: allocation.providerBudgetMicros, deadline,
      unavailable: plan.unavailable, skippedForBudget: plan.skippedForBudget,
    });

    return json({ success: true, async: true, runId, status: 'SEARCHING',
      billing: { creditsAuthorized: grant.authorizedMaxCredits, providerBudgetUsd: preview.providerBudgetUsd } }, 202);
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
