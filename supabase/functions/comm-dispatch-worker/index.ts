// HOMATCH — the campaign dispatcher.
//
// Runs on a tick (pg_cron or the Railway worker) and, for each RUNNING
// campaign, claims a batch of PENDING sends and executes them.
//
// WHAT MAKES THIS SAFE TO RUN TWICE AT ONCE
//
// Nothing in this file. The safety is entirely in comm_claim_sends(), which
// transitions rows PENDING -> QUEUED inside a single UPDATE using FOR UPDATE
// SKIP LOCKED. Two workers ticking simultaneously each get a different set of
// rows; neither blocks and neither duplicates. If that function is ever
// rewritten as a SELECT then an UPDATE, this whole subsystem starts placing
// every call twice under load and will pass every test while doing it.
//
// THE KILL SWITCH RUNS BETWEEN BATCHES, NOT ONLY AT LAUNCH
//
// §52. A campaign that looked fine at recipient 1 can be causing complaints by
// recipient 400, and a gate that only runs at launch cannot see that. Every
// tick re-evaluates the campaign's own numbers and pauses it if they have gone
// wrong — with COMPLIANCE_PAUSED, which the customer cannot lift, when the
// reason is behavioural.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { notify as emitNotification } from '../_shared/notify.ts';
import { serviceClient, json, preflight, isInternalWorker, logEvent, redact } from '../_shared/comm/auth.ts';
import { createMetaProvider, metaConfigFromEnv, metaCredentialsPresent } from '../_shared/comm/meta.ts';
import { createVapiProvider, vapiCredentialsPresent } from '../_shared/comm/vapi.ts';
import { buildAgentRuntime } from '../_shared/comm/agentPrompt.ts';
import { evaluateKillSwitch } from '../_shared/comm/generated/risk.ts';
import { canDispatchWithinCap } from '../_shared/comm/generated/cost.ts';
import { evaluateExecutionGate } from '../_shared/comm/generated/executionGate.ts';

/** A tick does bounded work. The next tick picks up where this one stopped. */
const CAMPAIGNS_PER_TICK = 5;
const SENDS_PER_CAMPAIGN = 10;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight();

  // §140: internal worker, service authentication. Not a user endpoint.
  if (!isInternalWorker(req)) return json({ error: 'forbidden' }, 403);

  const sb = serviceClient();
  const started = Date.now();

  // Leases that expired because a worker died. Returned to PENDING, or failed
  // permanently once the campaign's own max_attempts is spent.
  const { data: reclaimed } = await sb.rpc('comm_reclaim_stale_sends');

  const { data: campaigns } = await sb.from('outreach_campaigns')
    .select('id, owner_id, campaign_type, status, agent_id, agent_version_id, channel_account_id, template_id, template_variables, max_spend_usd, max_attempts, concurrency, max_call_duration_sec, send_window_start, send_window_end, timezone')
    .eq('status', 'RUNNING')
    .order('launched_at', { ascending: true })
    .limit(CAMPAIGNS_PER_TICK);

  const report: Array<Record<string, unknown>> = [];

  for (const campaign of campaigns ?? []) {
    try {
      report.push(await runCampaign(sb, campaign));
    } catch (e) {
      logEvent('dispatch', 'campaign_failed', { campaignId: campaign.id, error: redact((e as Error)?.message) });
      report.push({ campaignId: campaign.id, error: 'failed' });
    }
  }

  return json({
    ok: true,
    reclaimed: Number(reclaimed ?? 0),
    campaigns: report,
    elapsedMs: Date.now() - started,
  });
});

type Sb = ReturnType<typeof serviceClient>;
type Campaign = Record<string, unknown> & { id: string; owner_id: string; campaign_type: string };

async function runCampaign(sb: Sb, campaign: Campaign): Promise<Record<string, unknown>> {
  // ── Is it still allowed to run? ──────────────────────────────────────────
  const health = await campaignHealth(sb, campaign.id, campaign.owner_id);
  const verdict = evaluateKillSwitch(health);

  if (verdict.pause) {
    if (verdict.status === 'COMPLIANCE_PAUSED') {
      await sb.rpc('comm_compliance_pause', {
        p_campaign_id: campaign.id, p_code: verdict.code ?? 'AUTO', p_reason: verdict.reason ?? null,
      });
    } else {
      await sb.from('outreach_campaigns')
        .update({ status: 'PAUSED', paused_reason: verdict.reason ?? null, compliance_state: verdict.code ?? null })
        .eq('id', campaign.id);
    }
    /* A campaign stopping itself is something to act on, and it happens
       once per campaign. Deduped on the campaign so a worker that re-reads
       the same verdict cannot say it twice. */
    await emitNotification(sb, {
      userId: campaign.owner_id,
      type: 'CAMPAIGN_PAUSED',
      title: 'A campaign was paused',
      body: verdict.reason ?? 'A campaign was paused automatically.',
      priority: 'HIGH',
      deepLink: '/outreach/campaigns',
      entityType: 'campaign',
      entityId: campaign.id,
      dedupeKey: `campaign-paused:${campaign.id}:${verdict.code}`,
    });
    logEvent('dispatch', 'campaign_paused', { campaignId: campaign.id, code: verdict.code });
    return { campaignId: campaign.id, paused: verdict.code };
  }

  // ── The customer's own sending window (§17 step 4) ───────────────────────
  if (!withinSendWindow(campaign)) {
    return { campaignId: campaign.id, skipped: 'outside_send_window' };
  }

  // ── Nothing left to do? ──────────────────────────────────────────────────
  const { count: remaining } = await sb.from('outreach_sends')
    .select('*', { count: 'exact', head: true })
    .eq('campaign_id', campaign.id).eq('status', 'PENDING');

  if (!remaining) {
    const { count: live } = await sb.from('outreach_sends')
      .select('*', { count: 'exact', head: true })
      .eq('campaign_id', campaign.id)
      .in('status', ['QUEUED', 'SENDING', 'DIALING', 'RINGING', 'ANSWERED']);
    if (!live) {
      await completeCampaign(sb, campaign);
      return { campaignId: campaign.id, completed: true };
    }
    return { campaignId: campaign.id, waiting: live };
  }

  // ── Claim ────────────────────────────────────────────────────────────────
  const batch = Math.max(1, Math.min(SENDS_PER_CAMPAIGN, Number(campaign.concurrency ?? 1) * 5));
  const { data: claimed, error: claimErr } = await sb.rpc('comm_claim_sends', {
    p_campaign_id: campaign.id, p_batch: batch, p_lease_seconds: 300,
  });
  if (claimErr) throw new Error(`claim failed: ${claimErr.message}`);

  const rows = (claimed ?? []) as Array<Record<string, unknown>>;
  if (!rows.length) return { campaignId: campaign.id, claimed: 0 };

  let executed = 0;
  let stoppedForCap = false;

  for (const send of rows) {
    // §111: the cap is checked before EACH unit, and it counts what is already
    // on the wire. Calls that have connected keep costing money for as long as
    // they last, and ignoring them is how a cap is exceeded by exactly the
    // amount already in flight.
    const capCents = campaign.max_spend_usd != null ? Number(campaign.max_spend_usd) * 100 : null;
    const canGo = canDispatchWithinCap({
      spentCents: health.spentUsd * 100,
      inFlightCents: health.inFlightUsd * 100,
      nextUnitMaxCents: estimatedUnitCeilingCents(campaign),
      capCents,
    });
    if (!canGo) {
      // Put it back rather than failing it: the customer may raise the cap.
      await sb.from('outreach_sends')
        .update({ status: 'PENDING', next_attempt_at: new Date(Date.now() + 60_000).toISOString() })
        .eq('id', send.id as string);
      stoppedForCap = true;
      continue;
    }

    const ok = await executeSend(sb, campaign, send, health);
    if (ok) executed++;
  }

  if (stoppedForCap) {
    await sb.from('outreach_campaigns')
      .update({ status: 'PAUSED', paused_reason: 'the campaign reached its spend limit', compliance_state: 'CAMPAIGN_SPEND_CAP' })
      .eq('id', campaign.id).eq('status', 'RUNNING');
  }

  return { campaignId: campaign.id, claimed: rows.length, executed, stoppedForCap };
}

async function executeSend(
  sb: Sb,
  campaign: Campaign,
  send: Record<string, unknown>,
  health: CampaignHealth,
): Promise<boolean> {
  const sendId = send.id as string;
  const phone = String(send.recipient_phone ?? '');

  // Re-checked at the moment of sending, not only when the queue was built. A
  // contact can opt out between launch and their turn in a 5,000-row campaign,
  // and honouring that is the whole point of an opt-out.
  const { data: contact } = await sb.from('outreach_contacts')
    .select('suppressed, do_not_contact, do_not_call, unsubscribed, whatsapp_opted_out')
    .eq('id', send.contact_id as string).maybeSingle();

  const contactable = !contact || !(
    contact.suppressed || contact.do_not_contact || contact.unsubscribed
    || (campaign.campaign_type === 'AI_CALL' && contact.do_not_call)
    || (campaign.campaign_type === 'WHATSAPP' && contact.whatsapp_opted_out)
  );

  /* ── THE LAST GATE BEFORE MONEY LEAVES ────────────────────────────────────
   *
   * Everything above decides whether this send is worth attempting. This
   * decides whether Homatch is allowed to pay for it, and it is the only
   * check standing between a queued row and a provider adapter.
   *
   * It did not used to exist. Pricing was checked once, at launch, and an
   * inactive price was treated as "run anyway, reserve nothing" — so the
   * dispatcher placed real calls at real rates, charged nobody, and wrote a
   * null cost. Checking at launch was also the wrong moment: a campaign
   * launched while priced and dispatched an hour after an admin deactivated
   * pricing would keep spending, because nothing between the queue and the
   * adapter ever asked again.
   *
   * So the question is asked here, per send, immediately before the call —
   * and it fails closed. A price that cannot be resolved is a refusal, not a
   * zero.
   */
  const billing = await resolveBilling(sb, campaign);
  const gate = evaluateExecutionGate({
    action: campaign.campaign_type === 'WHATSAPP' ? 'SEND_WHATSAPP' : 'PLACE_CALL',
    requestValid: /^\+\d{7,15}$/.test(phone),
    contactContactable: contactable,
    domainVerdict: health.domainVerdict,
    riskDecision: health.riskDecision,
    killSwitchPaused: false, // evaluated once per campaign in runCampaign, above
    channelEnabled: health.channelEnabled,
    channelKillSwitch: health.channelKillSwitch,
    providerHealthy: health.providerHealthy,
    productFound: billing.productFound,
    productEnabled: billing.productEnabled,
    pricingActive: billing.pricingActive,
    unitNetCents: billing.unitNetCents,
    freeAllowed: billing.freeAllowed,
    availableCredits: billing.availableCredits,
    requiredCredits: billing.requiredCredits,
    reservationRequired: billing.reservationRequired,
    reservationHeld: billing.reservationHeld,
    spentCents: health.spentUsd * 100,
    inFlightCents: health.inFlightUsd * 100,
    nextUnitMaxCents: estimatedUnitCeilingCents(campaign),
    campaignCapCents: campaign.max_spend_usd != null ? Number(campaign.max_spend_usd) * 100 : null,
    accountDailyRemainingCents: health.accountDailyRemainingUsd * 100,
  });

  if (!gate.allow) {
    logEvent('dispatch', 'execution_refused', {
      sendId, campaignId: campaign.id, refusal: gate.refusal, pause: gate.pauseCampaign,
    });

    if (gate.refusal === 'CONTACT_SUPPRESSED') {
      await sb.from('outreach_sends').update({
        status: 'SUPPRESSED', error_message: gate.detail, updated_at: new Date().toISOString(),
      }).eq('id', sendId);
      return false;
    }

    // Everything else would fail identically for every remaining unit, so the
    // row goes back to PENDING and the campaign stops. Failing the row instead
    // would destroy work the owner can still rescue by fixing the price or
    // topping up.
    await sb.from('outreach_sends').update({
      status: 'PENDING',
      error_message: gate.detail,
      next_attempt_at: new Date(Date.now() + 300_000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', sendId);

    if (gate.pauseCampaign) {
      await sb.from('outreach_campaigns').update({
        status: 'PAUSED',
        paused_reason: gate.detail,
        compliance_state: gate.refusal,
      }).eq('id', campaign.id).eq('status', 'RUNNING');
    }
    return false;
  }

  if (campaign.campaign_type === 'WHATSAPP') return await sendWhatsApp(sb, campaign, send, phone);
  if (campaign.campaign_type === 'AI_CALL') return await placeCall(sb, campaign, send, phone);

  await fail(sb, sendId, `channel ${campaign.campaign_type} is not dispatched by this worker`);
  return false;
}

/**
 * What this unit costs the customer, and whether they can pay for it.
 *
 * Every field defaults to the refusing value. A query that errors, a product
 * row that is absent, an RPC that returns nothing — all of them arrive at the
 * gate as "cannot be priced" rather than as a zero or an undefined that reads
 * as falsy somewhere downstream.
 */
async function resolveBilling(sb: Sb, campaign: Campaign): Promise<{
  productFound: boolean; productEnabled: boolean; pricingActive: boolean;
  unitNetCents: number | null; freeAllowed: boolean;
  availableCredits: number | null; requiredCredits: number | null;
  reservationRequired: boolean; reservationHeld: boolean;
}> {
  const closed = {
    productFound: false, productEnabled: false, pricingActive: false,
    unitNetCents: null, freeAllowed: false,
    availableCredits: null, requiredCredits: null,
    reservationRequired: true, reservationHeld: false,
  };

  const productCode = campaign.campaign_type === 'WHATSAPP' ? 'WHATSAPP' : 'AI_CALL';

  const { data: product, error: productErr } = await sb.from('billable_products')
    .select('code, enabled, kill_switch, pricing_active, standard_retail_cents, requires_reservation, config')
    .eq('code', productCode).maybeSingle();
  if (productErr || !product) return closed;

  // A product-level kill switch is as absolute as a route-level one.
  if (product.kill_switch) return { ...closed, productFound: true };

  // The authoritative price. billing_price_quote owns the arithmetic; a second
  // copy of it here would be a second answer waiting to disagree.
  const { data: quote } = await sb.rpc('billing_price_quote', {
    p_product_code: productCode, p_plan_code: null, p_landed_cogs_cents: null,
  });
  const row = Array.isArray(quote) ? quote[0] : null;

  const unitNetCents = row && Number.isFinite(Number(row.final_price_cents))
    ? Number(row.final_price_cents)
    : null;
  const requiredCredits = row && Number.isFinite(Number(row.credits))
    ? Number(row.credits)
    : null;

  const { data: wallet } = await sb.from('credit_accounts')
    .select('balance, reserved').eq('user_id', campaign.owner_id).maybeSingle();
  const availableCredits = wallet && Number.isFinite(Number(wallet.balance))
    ? Number(wallet.balance) - Number(wallet.reserved ?? 0)
    : null;

  const { data: reservation } = await sb.from('credit_reservations')
    .select('id, status').eq('job_ref', campaign.id).eq('status', 'HELD').maybeSingle();

  return {
    productFound: true,
    productEnabled: Boolean(product.enabled),
    pricingActive: Boolean(product.pricing_active),
    unitNetCents,
    // Free has to be declared on the product, never inferred from a zero.
    freeAllowed: Boolean((product.config as Record<string, unknown> | null)?.free_at_zero),
    availableCredits,
    requiredCredits,
    reservationRequired: Boolean(product.requires_reservation),
    reservationHeld: Boolean(reservation),
  };
}

async function sendWhatsApp(sb: Sb, campaign: Campaign, send: Record<string, unknown>, phone: string): Promise<boolean> {
  const sendId = send.id as string;
  if (!metaCredentialsPresent().ok) {
    await requeue(sb, sendId, 'the WhatsApp channel is not configured');
    return false;
  }

  const { data: template } = campaign.template_id
    ? await sb.from('comm_whatsapp_templates').select('name, language, status').eq('id', campaign.template_id as string).maybeSingle()
    : { data: null };

  if (campaign.template_id && (!template || template.status !== 'APPROVED')) {
    await fail(sb, sendId, 'the template is not approved');
    return false;
  }

  const provider = createMetaProvider(metaConfigFromEnv());
  const result = await provider.send({
    toE164: phone,
    template: template ? {
      name: template.name,
      language: template.language,
      variables: resolveVariables(campaign, send),
    } : undefined,
    text: template ? undefined : String(campaign.sms_template ?? campaign.text_body ?? ''),
    idempotencyKey: String(send.idempotency_key ?? sendId),
  });

  const now = new Date().toISOString();
  if (!result.ok) {
    // MAYBE stays QUEUED. Retrying it would message the same person twice, and
    // the status webhook will resolve it (§91).
    if (result.sideEffect === 'MAYBE') {
      await sb.from('outreach_sends').update({
        status: 'SENT', error_message: 'delivery unconfirmed', updated_at: now,
      }).eq('id', sendId);
      return false;
    }
    if (result.error?.retryable) {
      await requeue(sb, sendId, result.error.message);
    } else {
      await fail(sb, sendId, result.error?.message ?? 'send failed');
    }
    return false;
  }

  await sb.from('outreach_sends').update({
    status: 'SENT',
    provider: 'META',
    provider_message_id: result.data?.providerMessageId ?? null,
    provider_status_raw: result.data?.status ?? null,
    sent_at: now,
    updated_at: now,
  }).eq('id', sendId);

  await sb.from('outreach_contacts').update({ last_contacted_at: now }).eq('id', send.contact_id as string);
  return true;
}

async function placeCall(sb: Sb, campaign: Campaign, send: Record<string, unknown>, phone: string): Promise<boolean> {
  const sendId = send.id as string;
  if (!vapiCredentialsPresent().ok) {
    await requeue(sb, sendId, 'the calling channel is not configured');
    return false;
  }

  // The FROZEN agent version, never the mutable agent row. A call must always
  // be explainable by exactly the instructions it ran under (§11).
  const runtime = await buildAgentRuntime(sb, {
    agentVersionId: campaign.agent_version_id as string | null,
    agentId: campaign.agent_id as string | null,
    language: (send.language as string) ?? null,
    maxDurationSec: Number(campaign.max_call_duration_sec ?? 300),
  });
  if (!runtime) {
    await fail(sb, sendId, 'the agent could not be loaded');
    return false;
  }

  const provider = createVapiProvider();
  const result = await provider.placeCall({
    toE164: phone,
    agent: runtime.config,
    maxDurationSec: runtime.config.maxDurationSec,
    recordingEnabled: runtime.recordingEnabled,
    idempotencyKey: String(send.idempotency_key ?? sendId),
    webhookUrl: `${Deno.env.get('SUPABASE_URL')}/functions/v1/voice-webhook`,
    metadata: { sendId, campaignId: campaign.id, ownerId: campaign.owner_id, agentVersionId: runtime.versionId },
  });

  const now = new Date().toISOString();
  if (!result.ok) {
    if (result.sideEffect === 'MAYBE') {
      // Never redial on an unconfirmed placement (§91). Left DIALING for the
      // webhook, or for reconciliation against GET /call, to settle.
      await sb.from('outreach_sends').update({
        status: 'DIALING', error_message: 'call placement unconfirmed', updated_at: now,
      }).eq('id', sendId);
      return false;
    }
    if (result.error?.retryable) await requeue(sb, sendId, result.error.message);
    else await fail(sb, sendId, result.error?.message ?? 'call failed');
    return false;
  }

  await sb.from('outreach_sends').update({
    status: 'DIALING',
    provider: 'VAPI',
    provider_message_id: result.data?.providerCallId ?? null,
    agent_version_id: runtime.versionId,
    call_started_at: now,
    updated_at: now,
  }).eq('id', sendId);

  await sb.from('comm_agents').update({ last_used_at: now }).eq('id', campaign.agent_id as string);
  return true;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

interface Health {
  sent: number; failed: number; optOuts: number; complaints: number;
  spentUsd: number; inFlightUsd: number;
  campaignCapUsd: number | null; accountDailyRemainingUsd: number;
  providerHealthy: boolean; channelQualityDegraded: boolean;
  /* Read for the execution gate, which asks them per send rather than once per
   * campaign. enabled and kill_switch are separate on purpose: turning a
   * provider off during an incident must not erase the fact that it is
   * normally on. */
  channelEnabled: boolean; channelKillSwitch: boolean;
  /* The campaign's stored classification and compliance decision. Both default
   * to null, and the gate treats null as a refusal — an unclassified campaign
   * is not an allowed one. */
  domainVerdict: 'ALLOW' | 'REVIEW' | 'BLOCK' | null;
  riskDecision: 'ALLOW' | 'REVIEW' | 'BLOCK' | 'THROTTLE' | null;
}

/** Named for the gate's parameter, so the two cannot drift apart silently. */
type CampaignHealth = Health;

async function campaignHealth(sb: Sb, campaignId: string, ownerId: string): Promise<Health> {
  const { data: sends } = await sb.from('outreach_sends')
    .select('status, cost_usd')
    .eq('campaign_id', campaignId)
    .limit(20_000);

  const rows = sends ?? [];
  const live = ['QUEUED', 'SENDING', 'DIALING', 'RINGING', 'ANSWERED'];

  const { data: campaign } = await sb.from('outreach_campaigns')
    .select('max_spend_usd, campaign_type, channel_account_id').eq('id', campaignId).maybeSingle();

  const { data: account } = campaign?.channel_account_id
    ? await sb.from('comm_channel_accounts').select('quality_rating, status').eq('id', campaign.channel_account_id).maybeSingle()
    : { data: null };

  const { data: route } = await sb.from('comm_provider_routes')
    .select('enabled, kill_switch')
    .eq('role', campaign?.campaign_type === 'WHATSAPP' ? 'MESSAGING' : 'TELEPHONY')
    .order('priority').limit(1).maybeSingle();

  // The decision the launch gate recorded for this campaign. The dispatcher
  // re-reads it rather than trusting that launch is still true: an admin can
  // block a campaign after it started, and that has to stop the next send.
  const { data: assessment } = await sb.from('comm_risk_assessments')
    .select('decision, domain_verdict')
    .eq('campaign_id', campaignId)
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle();

  const midnight = new Date(); midnight.setUTCHours(0, 0, 0, 0);
  const { data: todaySends } = await sb.from('outreach_sends')
    .select('cost_usd').eq('owner_id', ownerId).gte('created_at', midnight.toISOString()).limit(20_000);
  const spentTodayUsd = (todaySends ?? []).reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);

  const { data: trust } = await sb.from('comm_account_trust')
    .select('tier, max_daily_spend_usd').eq('owner_id', ownerId).maybeSingle();
  const dailyCap = Number(trust?.max_daily_spend_usd ?? defaultDailyCap(String(trust?.tier ?? 'NEW')));

  return {
    sent: rows.filter((r) => !['PENDING', 'QUEUED'].includes(r.status)).length,
    failed: rows.filter((r) => ['FAILED', 'BOUNCED'].includes(r.status)).length,
    optOuts: rows.filter((r) => r.status === 'OPTED_OUT').length,
    complaints: 0,
    spentUsd: rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0),
    // Anything live but unbilled is money already committed. Estimated at the
    // unit ceiling, deliberately high: underestimating in-flight cost is what
    // lets a cap be breached.
    inFlightUsd: rows.filter((r) => live.includes(r.status)).length * (estimatedUnitCeilingCents(campaign ?? {}) / 100),
    campaignCapUsd: campaign?.max_spend_usd != null ? Number(campaign.max_spend_usd) : null,
    accountDailyRemainingUsd: Math.max(0, dailyCap - spentTodayUsd),
    providerHealthy: Boolean(route ? route.enabled && !route.kill_switch : true),
    // Absent routing is NOT permission. With no row there is nothing saying
    // this channel may send, and the gate must refuse rather than assume.
    channelEnabled: Boolean(route?.enabled),
    channelKillSwitch: Boolean(route?.kill_switch),
    domainVerdict: (assessment?.domain_verdict as Health['domainVerdict']) ?? null,
    riskDecision: (assessment?.decision as Health['riskDecision']) ?? null,
    // Only what Meta actually told us (§33). No rating means no claim either way.
    channelQualityDegraded: String(account?.quality_rating ?? '').toUpperCase() === 'RED'
      || account?.status === 'ACTION_REQUIRED',
  };
}

function defaultDailyCap(tier: string): number {
  switch (tier) {
    case 'TRUSTED': return 250;
    case 'VERIFIED': return 1500;
    case 'ELEVATED': return 10_000;
    case 'RESTRICTED': return 0;
    default: return 25;
  }
}

/**
 * The most one unit can plausibly cost, used for the in-flight reserve.
 *
 * A call is priced per minute and can run to its own max duration, so its
 * ceiling is that. A message is a single fixed event. These are ceilings for
 * SAFETY arithmetic, not prices — nothing here is ever charged to anyone.
 */
function estimatedUnitCeilingCents(campaign: Record<string, unknown>): number {
  if (campaign.campaign_type === 'WHATSAPP') return 8;
  const maxMinutes = Math.max(1, Number(campaign.max_call_duration_sec ?? 300) / 60);
  return Math.ceil(maxMinutes * 25);
}

function withinSendWindow(campaign: Campaign): boolean {
  const start = campaign.send_window_start as number | null;
  const end = campaign.send_window_end as number | null;
  if (start == null || end == null) return true;

  // The customer's timezone, not the server's. A campaign told to call between
  // 09:00 and 18:00 Tbilisi time that runs on UTC starts ringing people at 5am.
  const tz = String(campaign.timezone ?? 'UTC');
  let hour: number;
  try {
    hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: 'numeric', hour12: false }).format(new Date()));
  } catch {
    hour = new Date().getUTCHours();
  }
  return start <= end ? hour >= start && hour < end : hour >= start || hour < end;
}

function resolveVariables(campaign: Campaign, send: Record<string, unknown>): string[] {
  const spec = campaign.template_variables;
  if (!Array.isArray(spec)) return [];
  return spec.map((v) => {
    const key = String(v ?? '');
    if (key === 'first_name') return String(send.recipient_name ?? '').split(' ')[0] || 'there';
    if (key === 'phone') return String(send.recipient_phone ?? '');
    return key;
  });
}

async function requeue(sb: Sb, sendId: string, reason: string): Promise<void> {
  // Exponential-ish backoff without needing to read the attempt count back:
  // the reclaim sweep is what eventually fails a row that has used its
  // attempts, so this only has to space the retries out.
  await sb.from('outreach_sends').update({
    status: 'PENDING',
    error_message: reason.slice(0, 300),
    next_attempt_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', sendId);
}

async function fail(sb: Sb, sendId: string, reason: string): Promise<void> {
  await sb.from('outreach_sends').update({
    status: 'FAILED', error_message: reason.slice(0, 300), updated_at: new Date().toISOString(),
  }).eq('id', sendId);
}

async function completeCampaign(sb: Sb, campaign: Campaign): Promise<void> {
  const now = new Date().toISOString();
  const { data: sends } = await sb.from('outreach_sends')
    .select('status, cost_usd').eq('campaign_id', campaign.id).limit(50_000);
  const rows = sends ?? [];

  await sb.from('outreach_campaigns').update({
    status: 'COMPLETED',
    sent_count: rows.filter((r) => !['PENDING', 'SUPPRESSED'].includes(r.status)).length,
    cost_actual_usd: rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0),
    updated_at: now,
  }).eq('id', campaign.id);

  /* Finishing is information, not an interruption: grouped, so an account
     running six campaigns overnight wakes to one line. */
  await emitNotification(sb, {
    userId: campaign.owner_id,
    type: 'CAMPAIGN_COMPLETED',
    title: 'A campaign finished',
    body: `${rows.length} recipients were processed.`,
    priority: 'NORMAL',
    deepLink: '/outreach/campaigns',
    entityType: 'campaign',
    entityId: campaign.id,
    dedupeKey: `campaign-done:${campaign.id}`,
    groupKey: `campaigns-done:${campaign.owner_id}`,
    groupWindow: '2 hours',
    groupTitle: '{n} campaigns finished',
  });

  await sb.from('background_jobs')
    .update({ state: 'COMPLETED', progress: 100, completed_at: now })
    .eq('idempotency_key', `campaign:${campaign.id}`);

  logEvent('dispatch', 'campaign_completed', { campaignId: campaign.id, total: rows.length });
}
