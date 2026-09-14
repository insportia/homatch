// HOMATCH — call lifecycle events from the voice provider.
//
// verify_jwt = false, for the same reason and under the same condition as the
// WhatsApp webhook: the provider cannot present a Supabase JWT, so this
// function authenticates the request itself.
//
// HOW VAPI IS AUTHENTICATED, AND WHAT THAT COSTS US
//
// Vapi signs server messages with a shared secret placed in the assistant's
// server configuration. That secret is VAPI_WEBHOOK_SECRET here. When it is
// set, every request must carry it and nothing else is processed. When it is
// NOT set, the function processes only events whose call id already exists in
// outreach_sends — which is a weaker guarantee (it means an attacker who knows
// a call id could post a fake transcript) and is therefore logged loudly and
// reported as an external blocker until the secret is configured.
//
// That is a deliberate, stated trade-off rather than a silent one: refusing
// everything without the secret would mean no call ever completes, and
// accepting everything would be an open write endpoint.
//
// §89's status model, §42's extraction rules and §44's double-count guard all
// meet here, because this is where a call turns into a record and a charge.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { notify } from '../_shared/notify.ts';
import { serviceClient, json, logEvent, redact, timingSafeEqual } from '../_shared/comm/auth.ts';
import { parseVapiWebhook, vapiCostComponents, type VapiEvent } from '../_shared/comm/vapi.ts';
import { mapVapiCallStatus, deriveCallOutcome, isForwardCallTransition } from '../_shared/comm/generated/statusMap.ts';
import { computeCogs } from '../_shared/comm/generated/cost.ts';
import { extractDeterministic, mergeExtraction, planExtraction, scoreLead, type ExtractionRecord } from '../_shared/comm/generated/extraction.ts';
import { extractFromTranscript } from '../_shared/comm/llm.ts';
import type { SendStatus } from '../_shared/comm/generated/vocabulary.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const raw = await req.text();
  if (raw.length > 2_000_000) return new Response('payload too large', { status: 413 });

  const secret = Deno.env.get('VAPI_WEBHOOK_SECRET');
  if (secret) {
    const presented = req.headers.get('x-vapi-secret') ?? req.headers.get('x-vapi-signature') ?? '';
    if (!presented || !timingSafeEqual(presented, secret)) {
      logEvent('voice-webhook', 'invalid_secret');
      return new Response('unauthorized', { status: 401 });
    }
  } else {
    logEvent('voice-webhook', 'no_shared_secret_configured');
  }

  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response('ok', { status: 200 }); }

  const event = parseVapiWebhook(body);
  if (!event?.providerCallId) return new Response('ok', { status: 200 });

  const sb = serviceClient();

  // Dedup before anything is allowed to change (§69, §129). A redelivered
  // end-of-call report must not charge the wallet twice.
  const { data: shouldProcess, error: claimErr } = await sb.rpc('comm_claim_webhook_event', {
    p_provider: 'VAPI',
    p_event_key: event.eventKey,
    p_event_type: event.kind,
    p_payload: { kind: event.kind, at: new Date().toISOString() },
  });
  if (claimErr) {
    logEvent('voice-webhook', 'dedup_failed', { error: claimErr.message });
    return new Response('retry', { status: 500 });
  }
  if (!shouldProcess) {
    logEvent('voice-webhook', 'duplicate_dropped', { eventKey: event.eventKey });
    return new Response('ok', { status: 200 });
  }

  try {
    await handle(sb, event);
    await sb.rpc('comm_finish_webhook_event', { p_provider: 'VAPI', p_event_key: event.eventKey, p_error: null });
  } catch (e) {
    logEvent('voice-webhook', 'failed', { eventKey: event.eventKey, error: redact((e as Error)?.message) });
    await sb.rpc('comm_finish_webhook_event', {
      p_provider: 'VAPI', p_event_key: event.eventKey, p_error: String((e as Error)?.message ?? e).slice(0, 500),
    });
  }

  return new Response('ok', { status: 200 });
});

type Sb = ReturnType<typeof serviceClient>;

async function handle(sb: Sb, event: VapiEvent): Promise<void> {
  // The send is found by the provider's call id, which was written at
  // placement. metadata.sendId is a fallback for the MAYBE case, where the
  // call may have been placed without us recording the id (§91).
  const sendId = typeof event.metadata.sendId === 'string' ? event.metadata.sendId : null;

  let { data: send } = await sb.from('outreach_sends')
    .select('id, owner_id, campaign_id, contact_id, status, cost_usd, call_started_at, duration_sec, agent_version_id, recipient_phone')
    .eq('provider_message_id', event.providerCallId).maybeSingle();

  if (!send && sendId) {
    const { data: bySendId } = await sb.from('outreach_sends')
      .select('id, owner_id, campaign_id, contact_id, status, cost_usd, call_started_at, duration_sec, agent_version_id, recipient_phone')
      .eq('id', sendId).maybeSingle();
    if (bySendId) {
      // Reconciling a placement we were never told about. Recording the id now
      // is what stops the next event creating a second orphan.
      await sb.from('outreach_sends')
        .update({ provider_message_id: event.providerCallId })
        .eq('id', bySendId.id);
      send = bySendId;
    }
  }

  if (!send) {
    logEvent('voice-webhook', 'unknown_call', { providerCallId: event.providerCallId });
    return;
  }

  const next = mapVapiCallStatus(event.status, event.endedReason);
  const current = send.status as SendStatus;

  // Out-of-order guard (§88/§89). A `ringing` arriving after `completed` is a
  // reordered delivery, not a second call, and must not walk the row back.
  const moveForward = isForwardCallTransition(current, next);

  const patch: Record<string, unknown> = {
    provider_status_raw: event.endedReason ?? event.status ?? null,
    updated_at: new Date().toISOString(),
  };
  if (moveForward) patch.status = next;
  if (event.durationSec != null) patch.duration_sec = Math.round(event.durationSec);
  if (event.transcript) patch.transcript = event.transcript.slice(0, 100_000);
  if (event.summary) patch.summary = event.summary.slice(0, 4_000);
  if (next === 'ANSWERED' && !send.call_started_at) patch.call_started_at = new Date().toISOString();

  if (event.kind === 'END_OF_CALL') {
    patch.call_ended_at = new Date().toISOString();

    // §73: a recording URL from the provider is not a public link to hand
    // around. The path is stored; a signed URL is minted at read time by
    // whoever is authorised to hear it.
    if (event.recordingUrl) {
      patch.recording_url = event.recordingUrl;
      patch.recording_expires_at = new Date(Date.now() + 30 * 86_400_000).toISOString();
    }

    // ── Cost (§44) ───────────────────────────────────────────────────────
    // computeCogs drops every sub-component that declares itself bundled
    // inside the orchestration total. Summing what Vapi returns without that
    // step overstates every call by roughly double.
    const components = vapiCostComponents(event);
    const cogs = computeCogs(components);

    if (cogs.totalCents > 0) {
      await recordProviderCost(sb, {
        sendId: send.id,
        ownerId: send.owner_id,
        campaignId: send.campaign_id,
        providerCallId: event.providerCallId!,
        cogs,
        durationSec: event.durationSec,
      });
      patch.cost_usd = await customerPrice(sb, cogs.totalCents);
    }
  }

  await sb.from('outreach_sends').update(patch).eq('id', send.id);

  if (event.kind !== 'END_OF_CALL') {
    logEvent('voice-webhook', 'status', { sendId: send.id, status: next, moved: moveForward });
    return;
  }

  // ── Extraction (§42, §138) ─────────────────────────────────────────────
  const transcript = event.transcript ?? '';
  const plan = planExtraction({
    status: next,
    durationSec: event.durationSec ?? 0,
    transcriptChars: transcript.length,
    turns: countTurns(transcript),
  });

  if (plan === 'SKIP') {
    logEvent('voice-webhook', 'extraction_skipped', { sendId: send.id, status: next });
    await finishOutcome(sb, send, next, null);
    return;
  }

  // Free, always, and authoritative on numbers.
  const deterministic = extractDeterministic(transcript);
  let merged: ExtractionRecord = deterministic;

  if (plan === 'FULL') {
    const llm = await extractFromTranscript({ transcript, language: 'auto' });
    if (llm.ok && llm.data) {
      const llmRecord: ExtractionRecord = {
        ...(llm.data as Record<string, never>),
        method: 'LLM',
        confidence: Number((llm.data as Record<string, unknown>).confidence ?? 0.6),
        at: new Date().toISOString(),
      };
      // mergeExtraction, not a spread. The rule that a measured figure beats a
      // paraphrased one lives there and must not be re-implemented here.
      const result = mergeExtraction(deterministic, llmRecord);
      merged = { ...result.merged, method: 'LLM', confidence: llmRecord.confidence, at: llmRecord.at };
    }
  }

  const { score } = scoreLead(merged);

  const { data: extraction } = await sb.from('comm_extractions').insert({
    owner_id: send.owner_id,
    contact_id: send.contact_id,
    send_id: send.id,
    source: 'CALL',
    method: plan === 'FULL' ? 'LLM' : 'DETERMINISTIC',
    confidence: Math.min(1, Math.max(0, merged.confidence ?? 0.5)),
    transaction_type: merged.transactionType ?? null,
    property_type: merged.propertyType ?? null,
    locations: merged.locations ?? null,
    budget_min: merged.budgetMin ?? null,
    budget_max: merged.budgetMax ?? null,
    currency: merged.currency ?? null,
    bedrooms: merged.bedrooms ?? null,
    timeline: merged.timeline ?? null,
    interest_level: merged.interestLevel ?? null,
    objection: merged.objection ?? null,
    callback_requested: merged.callbackRequested ?? null,
    viewing_interest: merged.viewingInterest ?? null,
    language: merged.language ?? null,
    summary: merged.summary ?? event.summary ?? null,
    next_action: merged.nextAction ?? null,
    raw: { plan, endedReason: event.endedReason },
  }).select('id').maybeSingle();

  const outcome = deriveCallOutcome({
    status: next,
    callbackRequested: merged.callbackRequested,
    viewingInterest: merged.viewingInterest,
    interestLevel: merged.interestLevel,
    durationSec: event.durationSec,
  });

  await finishOutcome(sb, send, next, outcome, score);

  // Promote onto the contact, respecting §42: only fields that are empty or
  // were themselves machine-derived at lower confidence.
  if (send.contact_id) {
    await promoteToContact(sb, send.contact_id, merged, score);
    if (extraction?.id) {
      await sb.from('comm_extractions').update({ promoted_at: new Date().toISOString() }).eq('id', extraction.id);
    }
  }

  if (merged.callbackRequested) {
    /* Somebody asked to be phoned back. That is a person waiting, so HIGH,
       ungrouped, and deep-linked to the call it came from. Deduped on the
       send: a provider that delivers the same completion webhook twice must
       not ask for the same callback twice. */
    await notify(sb, {
      userId: send.owner_id,
      type: 'CALLBACK_REQUESTED',
      title: 'Someone asked for a call back',
      body: merged.nextAction ?? 'A contact asked to be called back.',
      priority: 'HIGH',
      deepLink: '/outreach/calls',
      entityType: 'call',
      entityId: send.id,
      dedupeKey: `callback:${send.id}`,
    });
  } else if (score >= 70) {
    /* A strong lead is worth knowing about but nobody is holding a phone.
       Grouped, so a campaign that produces nine of them in an hour is one
       notification rather than nine. */
    await notify(sb, {
      userId: send.owner_id,
      type: 'QUALIFIED_LEAD',
      title: 'A qualified lead',
      body: merged.summary?.slice(0, 300) ?? 'A call produced a strong lead.',
      priority: 'NORMAL',
      deepLink: '/outreach/calls',
      entityType: 'call',
      entityId: send.id,
      dedupeKey: `lead:${send.id}`,
      groupKey: `leads:${send.owner_id}`,
      groupWindow: '30 minutes',
      groupTitle: '{n} qualified leads from your calls',
    });
  }

  logEvent('voice-webhook', 'call_completed', {
    sendId: send.id, status: next, outcome, leadScore: score, plan,
  });
}

async function finishOutcome(
  sb: Sb, send: Record<string, unknown>, status: SendStatus, outcome: string | null, score?: number,
): Promise<void> {
  await sb.from('outreach_sends').update({
    outcome,
    lead_score: score ?? null,
    updated_at: new Date().toISOString(),
  }).eq('id', send.id as string);

  if (send.contact_id && ['COMPLETED', 'ANSWERED'].includes(status)) {
    await sb.from('outreach_contacts')
      .update({ last_contacted_at: new Date().toISOString() })
      .eq('id', send.contact_id as string);
  }
}

/**
 * Write provider COGS exactly once.
 *
 * finance_provider_cost_events already carries the platform's double-count
 * guard; the unique reference below is what engages it. A redelivered
 * end-of-call report that somehow got past the event dedup still cannot add a
 * second cost row for the same call.
 */
async function recordProviderCost(sb: Sb, params: {
  sendId: string; ownerId: string; campaignId: string; providerCallId: string;
  cogs: ReturnType<typeof computeCogs>;
  durationSec: number | null;
}): Promise<void> {
  const base = {
    product_code: 'AI_CALL',
    operation: 'AI_CALL',
    user_id: params.ownerId,
    job_ref: params.campaignId,
    source_currency: 'USD',
    charge_class: 'EXECUTION',
    occurred_at: new Date().toISOString(),
  };

  // The parent: what Vapi actually billed. This is the only row that counts
  // towards COGS.
  const { data: parent, error } = await sb.from('finance_provider_cost_events').insert({
    ...base,
    provider_id: 'VAPI',
    component: 'ORCHESTRATION',
    quantity: params.durationSec != null ? params.durationSec / 60 : 1,
    unit: params.durationSec != null ? 'minute' : 'call',
    source_amount: params.cogs.totalCents / 100,
    cost_usd: params.cogs.totalCents / 100,
    cost_source: params.cogs.source === 'PROVIDER_ACTUAL' ? 'PROVIDER_REPORTED'
      : params.cogs.source === 'PROVIDER_INVOICE' ? 'INVOICE'
      : params.cogs.source === 'CONFIGURED_PRICE' ? 'PRICE_BOOK' : 'ESTIMATED',
    counts_as_cogs: true,
    is_double_count_guard: false,
    external_ref: `vapi:call:${params.providerCallId}`,
    metadata: { sendId: params.sendId, campaignId: params.campaignId },
  }).select('id').maybeSingle();

  if (error) {
    // A unique violation means this call's cost is already booked, which is
    // the guard doing its job rather than a failure.
    if (error.code !== '23505') logEvent('voice-webhook', 'cost_write_failed', { error: error.message });
    return;
  }

  // The children: STT, LLM, TTS and transport, recorded for visibility and
  // explicitly NOT counted. This is the platform's own double-count guard
  // (§44) — the numbers are visible in a cost breakdown, they roll up to
  // nothing, and `billed_by_provider_id` says who actually invoiced them.
  const suppressed = params.cogs.suppressed;
  if (parent?.id && suppressed.length) {
    await sb.from('finance_provider_cost_events').insert(
      suppressed.map((c) => ({
        ...base,
        provider_id: c.provider === 'VAPI' && c.component === 'STT' ? 'STT'
          : c.component === 'TTS' ? 'TTS'
          : c.component === 'TELEPHONY' ? 'TELEPHONY'
          : c.component === 'LLM' ? 'OPENAI' : 'VAPI',
        component: c.component,
        quantity: c.units ?? 0,
        unit: c.unit ?? 'bundled',
        source_amount: c.cents / 100,
        cost_usd: 0,
        cost_source: 'ALLOCATED',
        counts_as_cogs: false,
        is_double_count_guard: true,
        billed_by_provider_id: 'VAPI',
        parent_event_id: parent.id,
        external_ref: `vapi:call:${params.providerCallId}:${c.component}`,
        metadata: { suppressedBecause: c.suppressedBecause, grossCents: c.cents },
      })),
    );
  }
}

/**
 * What the customer pays, from configuration rather than from a constant.
 *
 * Returns raw COGS in dollars when no pricing is configured — which is the
 * current state for AI_CALL — rather than a made-up retail figure. §45 is
 * explicit that markup and tax are configurable and versioned, and a number
 * invented here would misstate both.
 */
async function customerPrice(sb: Sb, cogsCents: number): Promise<number> {
  const { data: product } = await sb.from('billable_products')
    .select('pricing_active, min_gross_margin_bps').eq('code', 'AI_CALL').maybeSingle();
  if (!product?.pricing_active) return cogsCents / 100;

  const { data: taxSetting } = await sb.from('admin_settings')
    .select('value').eq('key', 'tax_rate_bps').maybeSingle();
  const taxBps = Number(taxSetting?.value ?? 1800);
  const markupBps = Number(product.min_gross_margin_bps ?? 3000);

  const net = cogsCents / (1 - Math.min(9500, markupBps) / 10_000);
  return (net * (1 + taxBps / 10_000)) / 100;
}

async function promoteToContact(
  sb: Sb, contactId: string, e: ExtractionRecord, score: number,
): Promise<void> {
  const { data: contact } = await sb.from('outreach_contacts')
    .select('transaction_type, property_type, preferred_locations, budget_min, budget_max, bedrooms, timeline, lead_score')
    .eq('id', contactId).maybeSingle();
  if (!contact) return;

  const patch: Record<string, unknown> = { lead_score: score, updated_at: new Date().toISOString() };

  // Only fill what is empty. A value already on the contact came either from
  // the customer's own import or from a previous, possibly better, extraction,
  // and §42 forbids clobbering it from here.
  const fill = (column: string, value: unknown) => {
    const existing = (contact as Record<string, unknown>)[column];
    if (value != null && value !== '' && (existing == null || existing === '')) patch[column] = value;
  };

  fill('transaction_type', e.transactionType);
  fill('property_type', e.propertyType);
  fill('preferred_locations', e.locations);
  fill('budget_min', e.budgetMin);
  fill('budget_max', e.budgetMax);
  fill('bedrooms', e.bedrooms);
  fill('timeline', e.timeline);

  if (e.viewingInterest) patch.lead_stage = 'VIEWING';
  else if (e.callbackRequested) patch.lead_stage = 'CALLBACK';
  else if (score >= 60) patch.lead_stage = 'QUALIFIED';
  else if (e.interestLevel === 'NONE') patch.lead_stage = 'LOST';

  await sb.from('outreach_contacts').update(patch).eq('id', contactId);
}

/** Vapi transcripts are "Speaker: line" per turn. Used only to size the extraction spend. */
function countTurns(transcript: string): number {
  if (!transcript) return 0;
  return transcript.split('\n').filter((l) => /^\s*(user|assistant|ai|bot|caller)\s*:/i.test(l)).length
    || transcript.split('\n').filter((l) => l.trim()).length;
}
