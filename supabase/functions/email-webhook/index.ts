// HOMATCH — the inbound email webhook.
//
// Homatch could send email and could not receive it. A campaign went out, a
// person replied, and the reply went to a mailbox nobody reads — so the one
// moment the outreach actually worked was the moment the product stopped
// knowing about it.
//
// verify_jwt = false, and that is not a shortcut. The provider cannot present
// a Supabase user JWT; it presents a Svix signature over the raw body computed
// with RESEND_WEBHOOK_SECRET, which only the provider and this server know. So
// the platform's own auth is disabled and the function does its own — §31
// permits that ONLY on that condition.
//
// THE RULES THIS FILE WILL NOT BEND ON
//
//   1. No signature, no processing. With RESEND_WEBHOOK_SECRET unset the
//      function answers 503 and writes nothing. A webhook that falls back to
//      "well, it is probably the provider" is an unauthenticated write
//      endpoint that anyone who guesses the URL can post invented
//      conversations to.
//   2. The signature is over the RAW bytes, read once, before any parsing.
//   3. Every delivery is deduplicated through comm_claim_webhook_event before
//      it is allowed to change anything. A retried delivery adds nothing.
//   4. An inbound address Homatch does not recognise is recorded as
//      unroutable. It is NOT attached to a guessed tenant: that is the one
//      mistake a multi-tenant webhook cannot make, because the customer whose
//      inbox it lands in is the one who reads it.
//   5. Nothing here inserts a notification. It calls notify(), like every
//      other producer, and the delivery decision stays in one place.
//
// WHAT IT IS NOT
//
// Not a second inbox. comm_conversations.channel has allowed 'EMAIL' since the
// communications hub was written, so this records through comm_record_inbound
// and the message appears in the thread list the product already has.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { notify } from '../_shared/notify.ts';
import { serviceClient, logEvent, redact } from '../_shared/comm/auth.ts';
import {
  normaliseInboundEmail, previewOf, stripQuotedReply, svixHeaders,
  verifyInboundSignature, type InboundEmail,
} from '../_shared/comm/generated/inboundEmail.ts';
import { detectsOptOut, detectsHumanRequest } from '../_shared/comm/generated/handoff.ts';

/** Bigger than any real reply; smaller than a denial of service. */
const MAX_BODY_BYTES = 2_000_000;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405 });
  }

  const secret = Deno.env.get('RESEND_WEBHOOK_SECRET');
  if (!secret) {
    // Deliberately a refusal rather than a degraded mode. See rule 1 above.
    logEvent('email-webhook', 'rejected_no_secret');
    return new Response('not configured', { status: 503 });
  }

  // Read the body EXACTLY once, as text. Any re-serialisation changes the
  // bytes and the signature is over bytes.
  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) {
    logEvent('email-webhook', 'payload_too_large', { bytes: rawBody.length });
    return new Response('payload too large', { status: 413 });
  }

  const headers = svixHeaders((name) => req.headers.get(name));
  const verdict = await verifyInboundSignature({
    rawBody,
    id: headers.id,
    timestamp: headers.timestamp,
    signature: headers.signature,
    secret,
  });

  if (!verdict.ok) {
    /* The REASON is logged, the signature is not. Which of the four ways it
       failed is what a person debugging a webhook needs; the bytes somebody
       sent are not ours to write down. */
    logEvent('email-webhook', 'invalid_signature', { reason: verdict.reason });
    return new Response('invalid signature', { status: 401 });
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    /* A signed body that is not JSON means the provider changed something.
       Answering 200 stops the retries; the log is what a human needs. */
    logEvent('email-webhook', 'unparseable_body');
    return new Response('ok', { status: 200 });
  }

  const email = normaliseInboundEmail(body, headers.id ?? '');
  if (!email) {
    /* Not an inbound email: a delivery receipt, a bounce, an event type added
       next year. Acknowledged and ignored — an unknown event is not an error,
       and a 4xx here would make the provider retry it forever. */
    logEvent('email-webhook', 'ignored_event', {
      type: (body as { type?: unknown })?.type ?? null,
    });
    return new Response('ok', { status: 200 });
  }

  const sb = serviceClient();

  try {
    await handleInbound(sb, email);
  } catch (e) {
    /*
     * Recorded as unprocessed, and answered 200.
     *
     * The event row carries the error, so a sweep or a later delivery can pick
     * it up alone and a human can see it. Answering 5xx would make the
     * provider retry the same failing delivery on a schedule we do not
     * control, which turns one broken message into a queue of them.
     */
    logEvent('email-webhook', 'event_failed', {
      eventId: email.eventId, error: redact((e as Error)?.message),
    });
    await sb.rpc('comm_finish_webhook_event', {
      p_provider: 'RESEND',
      p_event_key: email.eventId,
      p_error: String((e as Error)?.message ?? e).slice(0, 500),
    });
  }

  return new Response('ok', { status: 200 });
});

type Sb = ReturnType<typeof serviceClient>;

async function handleInbound(sb: Sb, email: InboundEmail): Promise<void> {
  // THE dedup gate. Everything below runs at most once per delivery, ever.
  const { data: shouldProcess, error: claimError } = await sb.rpc('comm_claim_webhook_event', {
    p_provider: 'RESEND',
    p_event_key: email.eventId,
    p_event_type: email.eventType,
    /* The raw payload is NOT stored. An email body is the customer's
       correspondence, and a webhook audit row is the wrong place for it — the
       message itself is recorded, once, where the tenant's RLS protects it. */
    p_payload: { kind: email.eventType, at: new Date().toISOString() },
  });

  if (claimError) throw new Error(`dedup claim failed: ${claimError.message}`);
  if (!shouldProcess) {
    logEvent('email-webhook', 'duplicate_dropped', { eventId: email.eventId });
    return;
  }

  const account = await resolveAccount(sb, email.to);
  if (!account) {
    /* Unroutable. The delivery is acknowledged and the event row keeps the
       reason, so somebody can see that mail is arriving at an address no
       customer has claimed — which is a configuration problem, not a bug, and
       is invisible if the webhook silently drops it. */
    logEvent('email-webhook', 'unroutable_address', { to: email.to });
    await sb.rpc('comm_finish_webhook_event', {
      p_provider: 'RESEND', p_event_key: email.eventId,
      p_error: `no channel account for ${email.to.join(', ').slice(0, 200)}`,
    });
    return;
  }
  if (!account.owner_id) {
    logEvent('email-webhook', 'inbound_to_unowned_address', { accountId: account.id });
    await sb.rpc('comm_finish_webhook_event', {
      p_provider: 'RESEND', p_event_key: email.eventId,
      p_error: 'channel account has no owner',
    });
    return;
  }

  const body = email.text ?? stripHtml(email.html) ?? '';
  const sentAt = email.sentAt ?? new Date().toISOString();

  const { data, error } = await sb.rpc('comm_record_inbound', {
    p_owner_id: account.owner_id,
    p_channel: 'EMAIL',
    /* The SENDER is the peer. Two threads with the same person on the same
       address are one conversation, which is what an email client does and
       what somebody reading the inbox expects. */
    p_peer: email.fromAddress,
    p_peer_name: email.fromName,
    p_channel_account_id: account.id,
    /* The RFC message id, not the provider's delivery id: it is what a later
       reply will name in In-Reply-To, and it is what makes the same message
       delivered twice one row. */
    p_provider_message_id: email.messageId ?? email.eventId,
    p_kind: email.attachmentCount > 0 ? 'DOCUMENT' : 'TEXT',
    p_body: body || null,
    p_media_provider_id: null,
    p_media_mime: null,
    p_sent_at: sentAt,
  });
  if (error) throw new Error(`record inbound failed: ${error.message}`);

  const row = Array.isArray(data) ? data[0] : data;
  const conversationId: string | undefined = row?.conversation_id;
  const isNew = Boolean(row?.is_new_conversation);

  /*
   * WHICH THREAD, WHEN THE REPLY SAYS SO.
   *
   * comm_record_inbound keys a conversation on (owner, channel, peer), which
   * is right for a first contact and slightly wrong for somebody who has two
   * separate threads with the same customer. When the reply names the message
   * it answers, the answer is exact — so it is recorded on the message rather
   * than used to re-route it, which would mean two conversations for one
   * person and an inbox that splits mid-thread.
   */
  if (email.inReplyTo.length && conversationId) {
    const { data: threadId } = await sb.rpc('comm_conversation_for_reply', {
      p_owner_id: account.owner_id,
      p_message_ids: email.inReplyTo,
    });
    if (threadId && threadId !== conversationId) {
      logEvent('email-webhook', 'reply_to_other_thread', {
        recorded: conversationId, referenced: threadId,
      });
    }
  }

  await sb.from('comm_channel_accounts')
    .update({ last_inbound_at: sentAt })
    .eq('id', account.id);

  const written = stripQuotedReply(body);

  // ── Opt-out ──────────────────────────────────────────────────────────────
  // Checked deterministically and acted on before anything else, for the same
  // reason as on WhatsApp: a "STOP" only an LLM notices is a "STOP" answered
  // with a cheerful follow-up.
  if (written && detectsOptOut(written)) {
    await applyOptOut(sb, account.owner_id, email.fromAddress, conversationId);
    logEvent('email-webhook', 'opt_out_recorded', { conversationId });
    await sb.rpc('comm_finish_webhook_event', {
      p_provider: 'RESEND', p_event_key: email.eventId, p_error: null,
    });
    return;
  }

  // ── "Give me a real person" (§113) ───────────────────────────────────────
  if (written && detectsHumanRequest(written).requested && conversationId) {
    await sb.rpc('comm_set_conversation_mode', {
      p_conversation_id: conversationId,
      p_expected_mode: 'AI_ACTIVE',
      p_new_mode: 'PENDING_HANDOFF',
      p_actor: null,
      p_reason: 'the contact asked to speak to a person',
    });
  }

  /*
   * The owner is told, through the one door.
   *
   * Grouped per conversation, so a thread that arrives as four replies in a
   * minute is one interruption; the subject is the body, because in an inbox
   * the subject is what tells you whether to open it.
   */
  await notify(sb as never, {
    userId: account.owner_id,
    type: 'MATCH_FOUND',
    title: 'New email reply',
    body: previewOf(body, email.subject),
    priority: 'HIGH',
    deepLink: '/outreach/email',
    entityType: 'conversation',
    entityId: conversationId ?? null,
    groupKey: conversationId ? `email:${conversationId}` : `email:${account.owner_id}`,
    groupTitle: '{n} new email replies',
    metadata: {
      conversation_id: conversationId ?? null,
      kind: 'NEW_MESSAGE',
      channel: 'EMAIL',
      subject: email.subject,
    },
  });

  await sb.rpc('comm_finish_webhook_event', {
    p_provider: 'RESEND', p_event_key: email.eventId, p_error: null,
  });

  logEvent('email-webhook', 'inbound_recorded', {
    conversationId, isNew, attachments: email.attachmentCount,
  });
}

/**
 * Which Homatch account owns the address this arrived at.
 *
 * Without this there is no tenant, and §29's "do not leak one tenant's context
 * to another" has nothing to enforce. A message to an address Homatch does not
 * recognise is recorded as unroutable rather than attached to a guess.
 *
 * `to` may hold several addresses — a reply-all, a cc. The first that belongs
 * to somebody wins, which is the only stable answer; picking "the most
 * specific" would make delivery depend on the order a mail client happened to
 * write the header.
 */
async function resolveAccount(sb: Sb, to: string[]) {
  if (!to.length) return null;
  const { data } = await sb.from('comm_channel_accounts')
    .select('id, owner_id, status, environment, provider_account_id')
    .eq('channel', 'EMAIL')
    .eq('provider', 'RESEND')
    .in('provider_account_id', to)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

/**
 * Everything opting out means, in the order it has to happen.
 *
 * The same columns the WhatsApp webhook writes — `unsubscribed` is the
 * suppression the sending path actually reads, and a per-channel flag alone
 * would stop the WhatsApps and keep sending the email.
 */
async function applyOptOut(
  sb: Sb, ownerId: string, address: string, conversationId: string | undefined,
): Promise<void> {
  const now = new Date().toISOString();

  await sb.from('outreach_contacts')
    .update({ unsubscribed: true, unsubscribed_at: now })
    .eq('owner_id', ownerId)
    .eq('email', address);

  if (conversationId) {
    await sb.from('comm_conversations')
      .update({ mode: 'CLOSED', status: 'ARCHIVED', lead_stage: 'LOST', updated_at: now })
      .eq('id', conversationId);
  }
}

/**
 * A plain-text body from an HTML-only reply.
 *
 * Deliberately crude, and deliberately not a parser: this is a PREVIEW and a
 * search body, the original html is kept by the provider, and a full HTML
 * parser in a webhook is an attack surface for the sake of nicer whitespace.
 */
function stripHtml(html: string | null): string | null {
  if (!html) return null;
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim() || null;
}
