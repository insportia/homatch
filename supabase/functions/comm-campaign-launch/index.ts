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
import { authenticate, serviceClient, json, preflight, logEvent } from '../_shared/comm/auth.ts';
import { decideLaunch } from '../_shared/comm/policy.ts';
import { classifyDomainWithLlm } from '../_shared/comm/llm.ts';
import { beginExecution } from '../_shared/billing.ts';

interface LaunchBody {
  campaignId: string;
  action?: 'preview' | 'launch';
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const caller = await authenticate(req);
  if (!caller) return json({ error: 'unauthorized' }, 401);

  let body: LaunchBody;
  try { body = await req.json() as LaunchBody; } catch { return json({ error: 'bad_request' }, 400); }
  if (!body?.campaignId) return json({ error: 'campaign_id_required' }, 400);

  const sb = serviceClient();
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

      await sb.from('notifications').insert({
        user_id: caller.userId,
        type: 'CAMPAIGN_NEEDS_REVIEW',
        title: 'A campaign needs review',
        body: 'One of your campaigns is waiting for a safety review before it can start.',
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

  // Pricing that is switched off is not a refusal to launch. The campaign runs
  // and its usage is recorded; there is simply nothing to hold.
  if (grant.reason === 'PRODUCT_PRICING_INACTIVE' || grant.reason === 'PRODUCT_DISABLED') {
    logEvent('campaign-launch', 'unpriced_product', { productCode: params.productCode, reason: grant.reason });
    return { ok: true, reason: grant.reason };
  }

  return {
    ok: false,
    reason: grant.reason ?? 'UNAVAILABLE',
    shortfall: grant.budget?.creditsShortOfViable,
  };
}
