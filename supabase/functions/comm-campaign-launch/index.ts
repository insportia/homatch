// HOMATCH — launching a communications campaign.
//
// §17 step 7: "Before launch, SERVER must revalidate… Never trust stale client
// validation." The browser has already shown the customer a preview, an
// estimate and a compliance summary. None of that is carried into this
// request. Everything is decided again, here, from the database.
//
// THE ORDER MONEY IS TOUCHED IN
//
//   decide -> materialise the queue -> reserve credits -> set RUNNING
//
// Reserving before the policy gate would hold a customer's credits and then
// refuse them. Setting RUNNING before reserving would let the dispatcher start
// spending against a reservation that does not exist. Materialising the queue
// before reserving is safe because a PENDING send costs nothing until a worker
// claims it, and the campaign is not RUNNING so no worker will.
//
// This function also supports action:'preview', which runs the identical gate
// and writes nothing but the assessment. That is deliberate: the preview a
// customer sees in step 5 is produced by the same code that will decide in
// step 7, so "it said it was fine and then refused" cannot happen.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { notify } from '../_shared/notify.ts';
import { authenticate, serviceClient, json, preflight, logEvent } from '../_shared/comm/auth.ts';
import { decideLaunch } from '../_shared/comm/policy.ts';
import { classifyDomainWithLlm } from '../_shared/comm/llm.ts';
import { beginExecution } from '../_shared/billing.ts';
import { evaluateGoLive } from '../_shared/comm/generated/goLive.ts';
import { parsePhone } from '../_shared/comm/generated/phone.ts';
import { hasSecret } from '../_shared/comm/contracts.ts';
import { createVapiProvider, vapiPing } from '../_shared/comm/vapi.ts';
import { buildAgentRuntime } from '../_shared/comm/agentPrompt.ts';

interface LaunchBody {
  campaignId?: string;
  action?: 'preview' | 'launch' | 'test_call' | 'test_call_preview';
  /** test_call only. */
  agentId?: string;
  toE164?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const caller = await authenticate(req);
  if (!caller) return json({ error: 'unauthorized' }, 401);

  let body: LaunchBody;
  try { body = await req.json() as LaunchBody; } catch { return json({ error: 'bad_request' }, 400); }
  const sb = serviceClient();

  // ONE call, to ONE number, through every gate a campaign would pass.
  if (body.action === 'test_call' || body.action === 'test_call_preview') {
    return await testCall(sb, caller.userId, body, body.action === 'test_call');
  }

  if (!body?.campaignId) return json({ error: 'campaign_id_required' }, 400);
  const isPreview = body.action !== 'launch';

  const decision = await decideLaunch({
    sb,
    userId: caller.userId,
    campaignId: body.campaignId,
    classifyWithLlm: classifyDomainWithLlm,
  });

  // The customer-facing shape. Internal weights and thresholds are stripped:
  // §131 lets them see "needs review", not the score that produced it.
  const publicDecision = {
    ok: decision.ok,
    code: decision.code,
    message: decision.message,
    audience: decision.audience ?? null,
    estimate: decision.estimate ?? null,
    compliance: decision.ok ? 'READY'
      : decision.code === 'NEEDS_REVIEW' ? 'NEEDS_REVIEW'
      : decision.code === 'DOMAIN_BLOCKED' || decision.code === 'ACCOUNT_FROZEN' ? 'PAUSED_FOR_SAFETY'
      : 'BLOCKED',
    throughputPerHour: decision.throughputPerHour ?? null,
  };

  if (isPreview) {
    return json({ ...publicDecision, preview: true });
  }

  if (!decision.ok) {
    // A campaign that needs review is moved into that state so it appears in
    // the Admin queue rather than sitting in DRAFT where nobody will look.
    if (decision.code === 'NEEDS_REVIEW') {
      await sb.from('outreach_campaigns').update({
        status: 'REVIEW_REQUIRED',
        risk_level: decision.risk?.level ?? null,
        compliance_state: decision.code,
        updated_at: new Date().toISOString(),
      }).eq('id', body.campaignId).eq('owner_id', caller.userId);

      await notify(sb, {
        userId: caller.userId,
        type: 'CAMPAIGN_NEEDS_REVIEW',
        title: 'A campaign needs review',
        body: 'One of your campaigns is waiting for a safety review before it can start.',
        priority: 'HIGH',
        deepLink: '/outreach/campaigns',
        entityType: 'campaign',
        entityId: body.campaignId,
        dedupeKey: `campaign-review:${body.campaignId}`,
      });
    }
    logEvent('campaign-launch', 'refused', { campaignId: body.campaignId, code: decision.code });
    return json(publicDecision, decision.code === 'ERROR' ? 500 : 409);
  }

  // ── Materialise the queue ────────────────────────────────────────────────
  const allowed = decision.risk?.allowedRecipients ?? 0;
  const { data: enqueued, error: enqueueErr } = await sb.rpc('comm_enqueue_campaign', {
    p_campaign_id: body.campaignId,
    p_owner_id: caller.userId,
    p_limit: allowed,
  });

  if (enqueueErr) {
    logEvent('campaign-launch', 'enqueue_failed', { campaignId: body.campaignId, error: enqueueErr.message });
    return json({ ...publicDecision, ok: false, code: 'ERROR', message: 'the campaign queue could not be built' }, 500);
  }

  // ── Reserve ──────────────────────────────────────────────────────────────
  // Wired through the platform's existing wallet and nothing else (§43). The
  // reservation covers the MAXIMUM, because a hold that only covers the
  // expected cost runs out mid-campaign (§46).
  const { data: campaignRow } = await sb.from('outreach_campaigns')
    .select('campaign_type').eq('id', body.campaignId).maybeSingle();
  const productCode = campaignRow?.campaign_type === 'WHATSAPP' ? 'WHATSAPP'
    : campaignRow?.campaign_type === 'EMAIL' ? 'EMAIL_CAMPAIGN'
    : 'AI_CALL';

  const reserve = await reserveForCampaign(sb, {
    userId: caller.userId,
    campaignId: body.campaignId,
    productCode,
    expectedUnits: Number(enqueued ?? 0) || allowed,
    maxCents: decision.estimate?.maxCents ?? 0,
  });

  if (!reserve.ok) {
    // Nothing has been sent, and the queue rows are harmless while the
    // campaign is not RUNNING. The campaign stays where it was.
    logEvent('campaign-launch', 'reservation_refused', { campaignId: body.campaignId, reason: reserve.reason });
    return json({
      ...publicDecision, ok: false, code: 'INSUFFICIENT_BALANCE',
      message: 'there is not enough balance to start this campaign',
      shortfall: reserve.shortfall ?? null,
    }, 402);
  }

  // ── Go ───────────────────────────────────────────────────────────────────
  const { error: statusErr } = await sb.from('outreach_campaigns').update({
    status: 'RUNNING',
    risk_level: decision.risk?.level ?? null,
    compliance_state: 'APPROVED',
    paused_reason: null,
    launched_at: new Date().toISOString(),
    cost_estimate_usd: (decision.estimate?.maxCents ?? 0) / 100,
    updated_at: new Date().toISOString(),
  }).eq('id', body.campaignId).eq('owner_id', caller.userId)
    // Only from a state that was launchable. If something else moved the
    // campaign while the gate was running, this changes nothing.
    .in('status', ['DRAFT', 'READY', 'APPROVED', 'SCHEDULED', 'PAUSED']);

  if (statusErr) {
    return json({ ...publicDecision, ok: false, code: 'ERROR', message: 'the campaign could not be started' }, 500);
  }

  // A row in background_jobs so communications work appears in the job centre
  // beside Verify and Find Clients, rather than being invisible (§68).
  await sb.from('background_jobs').insert({
    user_id: caller.userId,
    product_type: productCode === 'WHATSAPP' ? 'WHATSAPP_CAMPAIGN' : productCode,
    subject_type: 'CAMPAIGN',
    subject_id: body.campaignId,
    subject_label: 'campaign',
    state: 'QUEUED',
    stages: [],
    idempotency_key: `campaign:${body.campaignId}`,
    cancel_deadline_at: new Date(Date.now() + 15_000).toISOString(),
    metadata: { job: 'CAMPAIGN_DISPATCH', campaignId: body.campaignId, throughputPerHour: decision.throughputPerHour },
  }).select('id').maybeSingle();

  logEvent('campaign-launch', 'launched', {
    campaignId: body.campaignId, enqueued: Number(enqueued ?? 0), allowed,
  });

  return json({ ...publicDecision, enqueued: Number(enqueued ?? 0), reservationId: reserve.reservationId });
});

type Sb = ReturnType<typeof serviceClient>;

/**
 * Hold the money through the gateway every other paid product already uses.
 *
 * §43: "DO NOT create a new wallet." _shared/billing.ts is the gateway, and
 * its own header says a product worker should never touch credit_accounts,
 * credit_lots, usage_reservations or the ledger directly — because every
 * number lives in a SQL function, and a copy of the arithmetic in TypeScript
 * is a second answer waiting to disagree with the first. So this calls
 * beginExecution() and nothing else.
 *
 * The idempotency key is the campaign, so a retried launch finds the hold that
 * already exists rather than placing a second one (§129).
 *
 * A product whose pricing is not active reserves nothing and returns ok. That
 * is AI_CALL and WHATSAPP today, and beginExecution reports it as
 * PRODUCT_PRICING_INACTIVE rather than as a refusal — charging for something
 * with no configured price would be worse than not charging.
 */
async function reserveForCampaign(sb: Sb, params: {
  userId: string; campaignId: string; productCode: string; expectedUnits: number; maxCents: number;
}): Promise<{ ok: boolean; reservationId?: string; reason?: string; shortfall?: number }> {
  const grant = await beginExecution(sb, {
    userId: params.userId,
    productCode: params.productCode,
    idempotencyKey: `campaign:${params.campaignId}`,
    jobRef: params.campaignId,
    expectedUnits: Math.max(1, params.expectedUnits),
    // The customer was shown an estimate and pressed Launch on it. A campaign
    // that silently runs at a quarter of the audience because the balance was
    // short is not what they authorised — they are told the shortfall instead.
    requireFullBudget: true,
    metadata: { campaignId: params.campaignId, source: 'COMMUNICATIONS' },
  });

  if (grant.ok) {
    return { ok: true, reservationId: grant.reservationId ?? undefined, reason: grant.funding };
  }

  /*
   * PRICING THAT IS SWITCHED OFF IS A REFUSAL TO LAUNCH.
   *
   * This used to return ok. The reasoning was that charging for something with
   * no configured price would be worse than not charging — true about the
   * invoice, wrong about the action. The honest answer to "I cannot price
   * this" is not to do it for free; it is not to do it.
   *
   * What it actually produced: publish an agent, import contacts, press
   * Launch, and the dispatcher placed real PSTN calls at real provider rates,
   * held nothing, charged nobody and wrote a null cost. The only thing between
   * that and an unbounded bill was a per-tier daily cap.
   *
   * The dispatcher now refuses the same case per send, immediately before the
   * adapter (evaluateExecutionGate), so this is the outer of two gates rather
   * than the only one. It stays here because refusing at launch tells the
   * customer why in the moment they asked, rather than leaving them a campaign
   * that silently never sends.
   */
  if (grant.reason === 'PRODUCT_PRICING_INACTIVE' || grant.reason === 'PRODUCT_DISABLED') {
    logEvent('campaign-launch', 'refused_unpriced', { productCode: params.productCode, reason: grant.reason });
    return { ok: false, reason: grant.reason };
  }

  return {
    ok: false,
    reason: grant.reason ?? 'UNAVAILABLE',
    shortfall: grant.budget?.creditsShortOfViable,
  };
}

// ── One real test call ──────────────────────────────────────────────────────

/**
 * Place exactly one call, to one number, having passed every gate a campaign
 * would pass.
 *
 * WHY THIS IS NOT A CAMPAIGN OF SIZE ONE
 *
 * A campaign needs an audience, a schedule, a dispatcher and a throughput
 * decision. None of that is wanted when somebody simply needs to hear whether
 * their agent works on a real phone, and building a one-row campaign to get
 * there means the dispatcher must be enabled — which is the thing that then
 * starts dialling lists.
 *
 * WHAT IS NOT RELAXED
 *
 * Everything else. Provider reachable, webhook signing configured, channel
 * enabled, kill switch off, product priced and active, balance sufficient,
 * reservation actually held, caller number real. A test that skips a gate
 * tests a system nobody is going to run.
 *
 * `test_call_preview` answers "what is stopping this?" and contacts nobody.
 * `test_call` is the only path that reaches the provider, and only when the
 * preview would have returned nothing.
 */
async function testCall(
  sb: Sb, userId: string, body: LaunchBody, execute: boolean,
): Promise<Response> {
  const agentId = String(body.agentId ?? '').trim();
  if (!agentId) return json({ error: 'agent_required', code: 'AGENT_REQUIRED' }, 400);

  // The destination is parsed, not trusted. A string that is not a number must
  // never reach a dialler.
  const parsed = parsePhone(String(body.toE164 ?? ''), null);
  if (!parsed.e164) {
    return json({ ok: false, blockers: ['DESTINATION_INVALID'], code: 'DESTINATION_INVALID' }, 422);
  }

  // The agent must belong to the caller. A test call is a real call, and
  // borrowing somebody else's agent to make one is not a test.
  const { data: agent } = await sb.from('comm_agents')
    .select('*').eq('id', agentId).eq('owner_id', userId).maybeSingle();
  if (!agent) return json({ ok: false, blockers: ['AGENT_NOT_FOUND'], code: 'AGENT_NOT_FOUND' }, 404);

  const [{ data: routes }, { data: products }, { data: accounts }, { data: wallets }] = await Promise.all([
    sb.from('comm_provider_routes').select('role, provider, enabled, kill_switch'),
    sb.from('billable_products')
      .select('code, enabled, pricing_active, standard_retail_cents, reference_landed_cogs_cents')
      .in('code', ['AI_CALL']),
    sb.from('comm_channel_accounts').select('channel, phone_e164, status, provider_number_id'),
    sb.from('credit_accounts').select('balance, reserved').eq('user_id', userId),
  ]);

  const usableCredit = (wallets ?? []).reduce(
    (sum: number, w: { balance: number | null; reserved: number | null }) =>
      sum + Math.max(0, Number(w.balance ?? 0) - Number(w.reserved ?? 0)), 0,
  );

  // The channel gates, from the same evaluator the Admin checklist uses, so
  // the two cannot disagree about whether telephony may run.
  const ping = await vapiPing();
  const readiness = evaluateGoLive({
    routes: (routes ?? []).map((r) => ({
      role: String(r.role), provider: String(r.provider),
      enabled: r.enabled === true, kill_switch: r.kill_switch === true,
    })),
    products: (products ?? []) as never,
    accounts: (accounts ?? []) as never,
    hasSecret,
    probes: {
      cartesiaOk: null, vapiOk: ping.ok,
      metaPhoneStatus: null, metaWabaStatus: null,
    },
    baseAgentReady: true,
    walletBalance: usableCredit,
  });
  const telephony = readiness.find((r) => r.channel === 'TELEPHONY');
  const blockers = [...(telephony?.blockedBy ?? [])];

  const callerNumber = (accounts ?? []).find(
    (a: { channel: string; phone_e164: string | null; status: string }) =>
      a.channel === 'VOICE' && a.phone_e164 && a.status === 'ACTIVE',
  ) as { phone_e164: string; provider_number_id: string | null } | undefined;

  if (!execute || blockers.length) {
    return json({
      ok: blockers.length === 0,
      blockers,
      // Admin-facing detail, same vocabulary as the go-live checklist.
      checks: telephony?.checks ?? [],
      destination: parsed.e164,
      agentName: agent.name,
    }, blockers.length && execute ? 422 : 200);
  }

  /*
   * Past this line money can be spent, so the order is the same one the
   * campaign path uses: reserve first, and only call the provider if the
   * reservation is actually held.
   */
  const idempotencyKey = `test_call:${userId}:${parsed.e164}:${Math.floor(Date.now() / 60_000)}`;
  const reservation = await beginExecution(sb, {
    userId,
    productCode: 'AI_CALL',
    idempotencyKey,
    expectedUnits: 1,
  });

  if (!reservation.ok) {
    logEvent('campaign-launch', 'test_call_reservation_refused', { reason: reservation.reason ?? null });
    return json({ ok: false, blockers: ['RESERVATION_FAILED'], code: reservation.reason ?? 'RESERVATION_FAILED' }, 422);
  }

  // The PUBLISHED snapshot, not the draft. A test that runs the unsaved
  // version tests something that will never answer a real phone.
  const runtime = await buildAgentRuntime(sb, { agentId: String(agent.id) });
  if (!runtime) {
    return json({ ok: false, blockers: ['AGENT_NOT_PUBLISHED'], code: 'AGENT_NOT_PUBLISHED' }, 422);
  }

  const placed = await createVapiProvider().placeCall({
    toE164: parsed.e164,
    agent: runtime.config,
    // A test call is short by construction. Two minutes is enough to hear
    // whether the agent works and short enough that a forgotten call cannot
    // run up a bill.
    maxDurationSec: 120,
    webhookUrl: `${Deno.env.get('SUPABASE_URL')}/functions/v1/voice-webhook`,
    recordingEnabled: false,
    fromNumberId: callerNumber?.provider_number_id ?? undefined,
    idempotencyKey,
    metadata: { testCall: 'true', agentId: String(agent.id), ownerId: userId },
  });

  if (!placed.ok) {
    logEvent('campaign-launch', 'test_call_failed', {
      code: placed.error?.code ?? null, status: placed.error?.providerCode ?? null,
    });
    return json({ ok: false, blockers: ['PROVIDER_REFUSED'], code: placed.error?.code ?? 'PROVIDER_REFUSED' }, 502);
  }

  logEvent('campaign-launch', 'test_call_placed', { userId, agentId: agent.id });
  return json({
    ok: true,
    providerCallId: placed.data?.providerCallId ?? null,
    destination: parsed.e164,
  });
}
