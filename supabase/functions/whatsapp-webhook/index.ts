// HOMATCH — the Meta WhatsApp webhook.
//
// verify_jwt = false, and that is not a shortcut.
//
// Meta cannot present a Supabase user JWT. It presents an HMAC of the request
// body computed with META_WHATSAPP_APP_SECRET, which only Meta and this server
// know. So the platform's own auth is disabled and the function does its own,
// which §31 permits ONLY on that condition: "verify_jwt = false ONLY because
// the body itself must implement strong provider verification."
//
// The rules this file will not bend on:
//
//   1. No signature, no processing. If META_WHATSAPP_APP_SECRET is unset the
//      function returns 503 and processes nothing. A webhook that falls back
//      to "well, it is probably Meta" is an unauthenticated write endpoint
//      that anyone who guesses the URL can post invented conversations to.
//   2. The HMAC is over the RAW bytes, read once, before any parsing.
//   3. Every event is deduplicated through a unique index before it is
//      allowed to change anything (§69, §129).
//   4. Meta gets its 200 quickly. A webhook that does slow work inline gets
//      retried by Meta while the first attempt is still running, which is how
//      one inbound message becomes four.
//
// §140's matrix, for this row: provider webhook, JWT disabled, provider
// signature verified in the body.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { notify } from '../_shared/notify.ts';
import { serviceClient, logEvent, redact } from '../_shared/comm/auth.ts';
import {
  verifyMetaSignature, verifyHandshake, parseMetaWebhook, createMetaProvider,
  metaConfigFromEnv, type NormalisedInbound,
} from '../_shared/comm/meta.ts';
import {
  mapMetaMessageStatus, mapMetaMessageKind, isMetaOptOutSignal, isPermanentMetaFailure,
} from '../_shared/comm/generated/statusMap.ts';
import { detectsOptOut, detectsHumanRequest } from '../_shared/comm/generated/handoff.ts';

Deno.serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url);

  // ── GET: Meta's subscription handshake ───────────────────────────────────
  if (req.method === 'GET') {
    const verifyToken = Deno.env.get('META_WHATSAPP_VERIFY_TOKEN');
    if (!verifyToken) {
      logEvent('whatsapp-webhook', 'handshake_no_token');
      return new Response('not configured', { status: 503 });
    }

    const ok = verifyHandshake(
      url.searchParams.get('hub.mode'),
      url.searchParams.get('hub.verify_token'),
      verifyToken,
    );
    if (!ok) {
      logEvent('whatsapp-webhook', 'handshake_rejected');
      return new Response('forbidden', { status: 403 });
    }

    // Meta requires the challenge echoed back as plain text, unquoted.
    const challenge = url.searchParams.get('hub.challenge') ?? '';
    logEvent('whatsapp-webhook', 'handshake_ok');
    return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } });
  }

  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  // ── POST: signature first, always ────────────────────────────────────────
  const appSecret = Deno.env.get('META_WHATSAPP_APP_SECRET');
  if (!appSecret) {
    // Deliberately a refusal rather than a degraded mode. See rule 1 above.
    logEvent('whatsapp-webhook', 'rejected_no_app_secret');
    return new Response('not configured', { status: 503 });
  }

  // Read the body EXACTLY once, as text. Any re-serialisation changes the
  // bytes and the HMAC will not match.
  const rawBody = await req.text();
  const signature = req.headers.get('x-hub-signature-256');

  const verified = await verifyMetaSignature(rawBody, signature, appSecret);
  if (!verified) {
    logEvent('whatsapp-webhook', 'invalid_signature', { hasHeader: Boolean(signature), bytes: rawBody.length });
    return new Response('invalid signature', { status: 401 });
  }

  if (rawBody.length > 1_000_000) {
    logEvent('whatsapp-webhook', 'payload_too_large', { bytes: rawBody.length });
    return new Response('payload too large', { status: 413 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    // A signed body that is not JSON means Meta changed something. Answering
    // 200 stops the retries; the log is what a human needs to see.
    logEvent('whatsapp-webhook', 'unparseable_body');
    return new Response('ok', { status: 200 });
  }

  const events = parseMetaWebhook(body);
  if (!events.length) {
    return new Response('ok', { status: 200 });
  }

  const sb = serviceClient();

  // Meta's retry timer is short. Each event is small, and processing them
  // inline keeps the code honest about ordering; what protects the response
  // time is the cap below, not a queue we would then have to build.
  const MAX_INLINE = 40;
  const batch = events.slice(0, MAX_INLINE);
  if (events.length > MAX_INLINE) {
    logEvent('whatsapp-webhook', 'batch_truncated', { received: events.length, processed: MAX_INLINE });
  }

  for (const event of batch) {
    try {
      await handleEvent(sb, event);
    } catch (e) {
      // One bad event must not lose the other thirty-nine, and must not make
      // Meta retry the whole batch. It is recorded as unprocessed so the
      // retry — or a sweep — can pick it up alone.
      logEvent('whatsapp-webhook', 'event_failed', {
        eventKey: event.eventKey, kind: event.kind, error: redact((e as Error)?.message),
      });
      await sb.rpc('comm_finish_webhook_event', {
        p_provider: 'META', p_event_key: event.eventKey, p_error: String((e as Error)?.message ?? e).slice(0, 500),
      });
    }
  }

  return new Response('ok', { status: 200 });
});

type Sb = ReturnType<typeof serviceClient>;

async function handleEvent(sb: Sb, event: NormalisedInbound): Promise<void> {
  // THE dedup gate. Everything below runs at most once per event, ever.
  const { data: shouldProcess, error } = await sb.rpc('comm_claim_webhook_event', {
    p_provider: 'META',
    p_event_key: event.eventKey,
    p_event_type: event.kind,
    // The raw payload is kept for a bounded window for support (§120), and the
    // retention sweep nulls it later.
    p_payload: { kind: event.kind, at: new Date().toISOString() },
  });

  if (error) throw new Error(`dedup claim failed: ${error.message}`);
  if (!shouldProcess) {
    logEvent('whatsapp-webhook', 'duplicate_dropped', { eventKey: event.eventKey, kind: event.kind });
    return;
  }

  switch (event.kind) {
    case 'MESSAGE':        await handleInboundMessage(sb, event); break;
    case 'STATUS':         await handleStatus(sb, event); break;
    case 'TEMPLATE_UPDATE': await handleTemplateUpdate(sb, event); break;
    default:
      logEvent('whatsapp-webhook', 'ignored_event', { kind: event.kind });
  }

  await sb.rpc('comm_finish_webhook_event', {
    p_provider: 'META', p_event_key: event.eventKey, p_error: null,
  });
}

/**
 * Which Homatch account owns the number this arrived at.
 *
 * Without this there is no tenant, and §29's "do not leak one tenant's context
 * to another" has nothing to enforce. An inbound to a number Homatch does not
 * recognise is recorded as unroutable rather than attached to a guess.
 */
async function resolveAccount(sb: Sb, phoneNumberId: string | null) {
  if (!phoneNumberId) return null;
  const { data } = await sb.from('comm_channel_accounts')
    .select('id, owner_id, environment, status')
    .eq('provider', 'META')
    .eq('provider_number_id', phoneNumberId)
    .maybeSingle();
  return data ?? null;
}

async function handleInboundMessage(sb: Sb, event: NormalisedInbound): Promise<void> {
  const account = await resolveAccount(sb, event.phoneNumberId);
  if (!account) {
    logEvent('whatsapp-webhook', 'unroutable_number', { phoneNumberId: event.phoneNumberId });
    return;
  }
  // A platform-owned test number has no customer. The message is still
  // recorded against the account's own owner when one exists; otherwise there
  // is nothing to attach it to and inventing a tenant would be worse.
  if (!account.owner_id) {
    logEvent('whatsapp-webhook', 'inbound_to_platform_number', { accountId: account.id });
    return;
  }

  const peer = normaliseWaId(event.from ?? '');
  const kind = mapMetaMessageKind(event.messageType);
  const sentAt = event.timestamp ? new Date(Number(event.timestamp) * 1000).toISOString() : new Date().toISOString();

  const { data, error } = await sb.rpc('comm_record_inbound', {
    p_owner_id: account.owner_id,
    p_channel: 'WHATSAPP',
    p_peer: peer,
    p_peer_name: event.profileName ?? null,
    p_channel_account_id: account.id,
    p_provider_message_id: event.messageId ?? null,
    p_kind: kind,
    p_body: event.text ?? null,
    p_media_provider_id: event.mediaId ?? null,
    p_media_mime: event.mediaMime ?? null,
    p_sent_at: sentAt,
  });
  if (error) throw new Error(`record inbound failed: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  const conversationId: string | undefined = row?.conversation_id;

  await sb.from('comm_channel_accounts')
    .update({ last_inbound_at: sentAt })
    .eq('id', account.id);

  const text = event.text ?? '';

  // ── Opt-out ──────────────────────────────────────────────────────────────
  // Checked deterministically and acted on before anything else, because a
  // "STOP" that is only noticed by an LLM is a "STOP" that gets answered with
  // a cheerful follow-up question.
  if (text && detectsOptOut(text)) {
    await applyOptOut(sb, account.owner_id, peer, conversationId);
    logEvent('whatsapp-webhook', 'opt_out_recorded', { conversationId });
    return;
  }

  // ── "Give me a real person" (§113) ───────────────────────────────────────
  if (text && detectsHumanRequest(text).requested && conversationId) {
    await sb.rpc('comm_set_conversation_mode', {
      p_conversation_id: conversationId,
      p_expected_mode: 'AI_ACTIVE',
      p_new_mode: 'PENDING_HANDOFF',
      p_actor: null,
      p_reason: 'the contact asked to speak to a person',
    });
    await notifyOwner(sb, account.owner_id, 'CALLBACK_REQUESTED',
      'Someone asked for a person',
      'A WhatsApp conversation is waiting for a human reply.');
    logEvent('whatsapp-webhook', 'handoff_requested', { conversationId });
    return;
  }

  // ── Voice notes (§118) ───────────────────────────────────────────────────
  // Queued, not transcribed inline: STT takes seconds and Meta will retry the
  // whole delivery if this response is slow.
  if (kind === 'AUDIO' && event.mediaId && conversationId) {
    await sb.from('background_jobs').insert({
      user_id: account.owner_id,
      product_type: 'WHATSAPP_CAMPAIGN',
      subject_type: 'CAMPAIGN',
      subject_label: 'voice note transcription',
      state: 'QUEUED',
      stages: [],
      idempotency_key: `wa-voice:${event.messageId}`,
      cancel_deadline_at: new Date().toISOString(),
      metadata: { job: 'TRANSCRIBE_VOICE_NOTE', conversationId, mediaId: event.mediaId, mime: event.mediaMime },
    }).select('id').maybeSingle();
  }

  logEvent('whatsapp-webhook', 'inbound_recorded', {
    conversationId, kind, isNew: Boolean(row?.is_new_conversation),
  });
}

async function handleStatus(sb: Sb, event: NormalisedInbound): Promise<void> {
  if (!event.statusFor) return;

  const status = mapMetaMessageStatus(event.status);
  const at = event.timestamp ? new Date(Number(event.timestamp) * 1000).toISOString() : new Date().toISOString();

  const { data: applied } = await sb.rpc('comm_apply_message_status', {
    p_provider_message_id: event.statusFor,
    p_status: status,
    p_raw: event.status ?? null,
    p_error_code: event.errorCode != null ? String(event.errorCode) : null,
    p_error_message: event.errorTitle ?? null,
    p_at: at,
  });

  // outreach_sends carries the same message for campaign reporting. Kept in
  // step so the campaign's counters and the inbox never disagree.
  await sb.from('outreach_sends')
    .update({
      status: status === 'READ' ? 'READ' : status === 'DELIVERED' ? 'DELIVERED'
        : status === 'FAILED' ? 'FAILED' : status === 'SENT' ? 'SENT' : undefined,
      provider_status_raw: event.status ?? null,
      delivered_at: status === 'DELIVERED' ? at : undefined,
      error_message: event.errorTitle ?? undefined,
      updated_at: new Date().toISOString(),
    })
    .eq('provider_message_id', event.statusFor);

  // A recipient who blocked business messages has opted out, and Meta says so
  // through an error code rather than a message (§88).
  if (isMetaOptOutSignal(event.errorCode)) {
    const { data: msg } = await sb.from('comm_messages')
      .select('owner_id, conversation_id, comm_conversations(peer_address)')
      .eq('provider_message_id', event.statusFor)
      .maybeSingle();
    const peer = (msg as { comm_conversations?: { peer_address?: string } } | null)?.comm_conversations?.peer_address;
    if (msg?.owner_id && peer) {
      await applyOptOut(sb, msg.owner_id, peer, msg.conversation_id as string);
    }
  }

  if (event.errorCode && isPermanentMetaFailure(event.errorCode)) {
    // Never dial or message this number again for this account: it is not a
    // WhatsApp number. Retrying it costs money and achieves nothing.
    const { data: msg } = await sb.from('comm_messages')
      .select('owner_id, comm_conversations(peer_address)')
      .eq('provider_message_id', event.statusFor)
      .maybeSingle();
    const peer = (msg as { comm_conversations?: { peer_address?: string } } | null)?.comm_conversations?.peer_address;
    if (msg?.owner_id && peer) {
      await sb.from('outreach_contacts')
        .update({ whatsapp_opted_out: true, whatsapp_opted_out_at: new Date().toISOString() })
        .eq('owner_id', msg.owner_id).eq('phone', peer);
    }
  }

  logEvent('whatsapp-webhook', 'status_applied', {
    status, applied: Boolean(applied), errorCode: event.errorCode ?? null,
  });
}

async function handleTemplateUpdate(sb: Sb, event: NormalisedInbound): Promise<void> {
  if (!event.templateName) return;

  // Meta's vocabulary here is APPROVED / REJECTED / PENDING / PAUSED /
  // DISABLED, which happens to match the column's CHECK. Anything else is
  // stored as PENDING rather than rejected outright — an unknown state is not
  // a reason to stop tracking a template.
  const known = ['APPROVED', 'REJECTED', 'PENDING', 'PAUSED', 'DISABLED'];
  const status = known.includes(String(event.templateStatus)) ? String(event.templateStatus) : 'PENDING';

  const { data: updated } = await sb.from('comm_whatsapp_templates')
    .update({
      status,
      rejection_reason: event.templateReason ?? null,
      last_synced_at: new Date().toISOString(),
    })
    .eq('name', event.templateName)
    .eq('language', event.templateLanguage ?? 'en')
    .select('id, owner_id, name')
    .maybeSingle();

  if (updated && status === 'REJECTED') {
    await notifyOwner(sb, updated.owner_id, 'WHATSAPP_TEMPLATE_REJECTED',
      'A WhatsApp template was rejected',
      `Meta rejected "${updated.name}"${event.templateReason ? `: ${event.templateReason}` : '.'}`);
  }

  logEvent('whatsapp-webhook', 'template_status', { name: event.templateName, status, matched: Boolean(updated) });
}

/**
 * Opt-out, applied everywhere it has to be applied.
 *
 * The contact row is what the campaign gate reads, so that is the one that
 * actually stops future sends. The conversation is closed so no operator
 * cheerfully carries on. The trust counter moves because a rising opt-out rate
 * is one of §52's kill-switch signals.
 */
async function applyOptOut(sb: Sb, ownerId: string, peer: string, conversationId?: string): Promise<void> {
  const now = new Date().toISOString();

  await sb.from('outreach_contacts')
    .update({ whatsapp_opted_out: true, whatsapp_opted_out_at: now, unsubscribed: true, unsubscribed_at: now })
    .eq('owner_id', ownerId)
    .eq('phone', peer);

  if (conversationId) {
    await sb.from('comm_conversations')
      .update({ mode: 'CLOSED', status: 'ARCHIVED', lead_stage: 'LOST', updated_at: now })
      .eq('id', conversationId);
  }

  const { data: trust } = await sb.from('comm_account_trust')
    .select('optout_count').eq('owner_id', ownerId).maybeSingle();
  await sb.from('comm_account_trust').upsert({
    owner_id: ownerId,
    optout_count: Number(trust?.optout_count ?? 0) + 1,
    updated_at: now,
  }, { onConflict: 'owner_id' });
}

/*
 * This file had its own `notify`, which inserted a row and nothing else. It
 * now delegates to the canonical path so inbound WhatsApp gets the same
 * dedupe, aggregation, preferences and quiet hours as everything else. The
 * name stays local so the four call sites below read unchanged.
 *
 * Grouped per owner: a burst of messages from a conversation is one
 * interruption, and the link goes to the inbox where the thread is.
 */
async function notifyOwner(sb: Sb, userId: string, type: string, title: string, body: string): Promise<void> {
  // Best effort. A notification that cannot be written must not roll back a
  // message that was genuinely received.
  const id = await notify(sb as never, {
    userId, type, title, body,
    priority: 'HIGH',
    deepLink: '/outreach/whatsapp/inbox',
    groupKey: `whatsapp:${userId}`,
    groupTitle: '{n} new WhatsApp messages',
  });
  if (!id) logEvent('whatsapp-webhook', 'notify_failed', { type });
}

/**
 * Meta gives a wa_id with no leading plus. Homatch stores E.164 with one, and
 * a mismatch here means every inbound creates a new conversation instead of
 * finding the existing one.
 */
function normaliseWaId(waId: string): string {
  const digits = String(waId ?? '').replace(/\D/g, '');
  return digits ? `+${digits}` : '';
}

// Exported only so the smoke path can confirm the Meta client constructs from
// the environment the same way the send path does.
export { createMetaProvider, metaConfigFromEnv };
