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
import { handleStudioUnsubscribe, isStudioUnsubscribe } from '../_shared/emailStudioUnsubscribe.ts';
import { isAssetRequest, serveAsset } from '../_shared/emailMarketing/assetFiles.ts';
import { getReceivedEmail, mapDomainStatus, resolveResendKey, routeTokenFrom, senderAuthentication } from '../_shared/resend/client.ts';
import { loadEmailSettings, resolveReplyRoute } from '../_shared/emailMarketing/core.ts';

/** Bigger than any real reply; smaller than a denial of service. */
const MAX_BODY_BYTES = 2_000_000;

/*
 * THE RESEND EVENT CATALOGUE (37 types, verified 2026-10-22 against
 * resend.com/docs/dashboard/webhooks/event-types). Every type has an explicit
 * outcome: applied, recorded, or deliberately ignored — and every delivery is
 * claimed (deduplicated) and finished, so the event log is complete.
 */
const EMAIL_DELIVERY_EVENTS = new Set([
  'email.sent', 'email.delivered', 'email.delivery_delayed', 'email.bounced', 'email.complained',
  'email.opened', 'email.clicked', 'email.failed', 'email.suppressed', 'email.scheduled',
]);
const RECORDED_ONLY_PREFIXES = ['contact.', 'topic.', 'inbox.'];

Deno.serve(async (req: Request): Promise<Response> => {
  /*
   * EMAIL STUDIO ONE-CLICK UNSUBSCRIBE (?esu=<recipient>&t=<hmac>).
   *
   * A link in a campaign email, opened by a person with no session. It is
   * served here because this function is already public and production has no
   * room for another one. It does not bend rule 1: it is authenticated by OUR
   * HMAC over the recipient id instead of the provider's Svix signature, and a
   * provider delivery never carries this query parameter.
   */
  const reqUrl = new URL(req.url);
  /*
   * EMAIL DESIGN IMAGES (?ema=<asset id>). A mail client loading an image from a campaign: no
   * session, possibly days after sending. Served here for the same reason as the unsubscribe
   * link below, and it does not bend rule 1 either: it only READS one registered, ACTIVE image
   * by its unguessable id and writes nothing (_shared/emailMarketing/assets.ts).
   */
  if (isAssetRequest(reqUrl)) return await serveAsset(req, reqUrl, serviceClient());
  if ((req.method === 'GET' || req.method === 'POST') && isStudioUnsubscribe(reqUrl)) {
    return await handleStudioUnsubscribe(reqUrl, serviceClient());
  }

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

  /*
   * ── ONE ENDPOINT, BOTH DIRECTIONS ─────────────────────────────────
   *
   * A delivery receipt for mail WE sent arrives at the same URL, signed with
   * the same secret, as a reply somebody wrote. Splitting them into two
   * endpoints would mean two Resend webhooks, two signing secrets and two
   * chances for one of them to be configured and the other forgotten.
   *
   * They are different events about different things, so they are routed
   * apart here and share nothing but the signature check and the dedupe.
   */
  const eventType = String((body as { type?: unknown })?.type ?? '');
  /* Dedupe on the Svix message id: unique per delivery, identical across retries. */
  const eventKey = headers.id ? `svix:${headers.id}` : null;
  if (EMAIL_DELIVERY_EVENTS.has(eventType)) {
    const sb = serviceClient();
    try {
      await handleDeliveryEvent(sb, body, eventType, eventKey);
    } catch (e) {
      logEvent('email-webhook', 'delivery_event_failed', {
        type: eventType, error: redact((e as Error)?.message),
      });
      if (eventKey) await finishEvent(sb, eventKey, String((e as Error)?.message ?? e));
    }
    return new Response('ok', { status: 200 });
  }
  if (eventType.startsWith('domain.') || eventType.startsWith('suppression.') || RECORDED_ONLY_PREFIXES.some((x) => eventType.startsWith(x))) {
    const sb = serviceClient();
    try {
      await handleAccountEvent(sb, body, eventType, eventKey ?? `${eventType}:${Date.now()}`);
    } catch (e) {
      logEvent('email-webhook', 'account_event_failed', { type: eventType, error: redact((e as Error)?.message) });
      if (eventKey) await finishEvent(sb, eventKey, String((e as Error)?.message ?? e));
    }
    return new Response('ok', { status: 200 });
  }

  const email = normaliseInboundEmail(body, headers.id ?? '');
  if (!email) {
    /* A type outside the catalogue (added after 2026-10-22): recorded — not
       silently dropped — and acknowledged, so the provider does not retry it. */
    logEvent('email-webhook', 'unknown_event', { type: eventType || null });
    if (eventKey) {
      const sb = serviceClient();
      const claimed = await claimEvent(sb, eventKey, eventType || 'unknown');
      if (claimed) await finishEvent(sb, eventKey, null);
    }
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

/** The provider's vocabulary, in outreach_sends'. */
const DELIVERY_STATUS: Record<string, string> = {
  'email.delivered': 'DELIVERED',
  'email.bounced': 'BOUNCED',
  'email.complained': 'COMPLAINED',
};

/**
 * The provider's vocabulary, in email_studio_recipients'. Opens and clicks are
 * only delivered when the Resend webhook subscribes to email.opened /
 * email.clicked and the domain has open/click tracking on; opens are
 * approximate (image blocking hides some, privacy proxies invent others).
 */
const STUDIO_KIND: Record<string, string> = {
  'email.delivered': 'DELIVERED',
  'email.bounced': 'BOUNCED',
  'email.complained': 'COMPLAINED',
  'email.opened': 'OPENED',
  'email.clicked': 'CLICKED',
};

/**
 * What became of a message this product sent.
 *
 * Deduplicated through the SAME claim a reply goes through, keyed on the
 * provider's delivery id: a provider retries a webhook it did not get a 200
 * for, and applying the same bounce twice would bounce one recipient twice in
 * the counters.
 *
 * `email.delivery_delayed` is acknowledged and deliberately NOT applied. A
 * delay is not an outcome -- the message is still in flight, and writing a
 * status for it would replace a true SENT with a state the next event has to
 * undo.
 */
async function handleDeliveryEvent(
  sb: Sb, body: unknown, eventType: string, eventKey: string | null,
): Promise<void> {
  const data = ((body as { data?: unknown })?.data ?? {}) as Record<string, unknown>;
  const envelopeId = (body as { id?: unknown })?.id;
  /* Svix id first (one per delivery); without it, type + email id + event time, so an
     open and a later second open are two events while a retry of either is one. */
  const eventId = eventKey ?? (typeof envelopeId === 'string' && envelopeId
    ? envelopeId
    : `${eventType}:${typeof data.email_id === 'string' ? data.email_id : 'none'}:${String((body as { created_at?: unknown })?.created_at ?? '')}`);

  const { data: shouldProcess, error: claimError } = await sb.rpc('comm_claim_webhook_event', {
    p_provider: 'RESEND',
    p_event_key: eventId,
    p_event_type: eventType,
    p_payload: { kind: eventType, at: new Date().toISOString() },
  });
  if (claimError) throw new Error(`dedup claim failed: ${claimError.message}`);
  if (!shouldProcess) {
    logEvent('email-webhook', 'duplicate_dropped', { eventId });
    return;
  }

  /* email.failed / email.suppressed: the provider did not (and will not) deliver it. */
  if (eventType === 'email.failed' || eventType === 'email.suppressed') {
    await applyUndeliverable(sb, data, eventType);
    await sb.rpc('comm_finish_webhook_event', { p_provider: 'RESEND', p_event_key: eventId, p_error: null });
    return;
  }

  /* A CRM reply sent from the HOMATCH inbox carries its own message row. */
  if (typeof data.email_id === 'string' && ['email.delivered', 'email.bounced', 'email.complained'].includes(eventType)) {
    const { data: crm } = await sb.from('comm_messages')
      .update(eventType === 'email.delivered'
        ? { status: 'DELIVERED', delivered_at: new Date().toISOString() }
        : { status: 'FAILED', error_code: eventType === 'email.bounced' ? 'BOUNCED' : 'COMPLAINED' })
      .eq('provider_message_id', `resend:${data.email_id}`)
      .select('id');
    if (crm && crm.length) {
      await sb.rpc('comm_finish_webhook_event', { p_provider: 'RESEND', p_event_key: eventId, p_error: null });
      return;
    }
  }

  /* A Resend BROADCAST email: one broadcast id for the whole campaign, so the send row is
     found by broadcast id + recipient address (outreach_sends rows written by broadcast.ts). */
  if (typeof data.broadcast_id === 'string' && DELIVERY_STATUS[eventType]) {
    const to = Array.isArray(data.to) ? String(data.to[0] ?? '') : String(data.to ?? '');
    if (to.includes('@')) {
      const { data: rows } = await sb.from('outreach_sends')
        .update({ status: DELIVERY_STATUS[eventType], updated_at: new Date().toISOString(),
          ...(eventType === 'email.delivered' ? { delivered_at: new Date().toISOString() } : {}) })
        .eq('provider_message_id', data.broadcast_id).ilike('recipient_email', to.toLowerCase())
        .neq('status', DELIVERY_STATUS[eventType]).select('campaign_id');
      const campaignId = (rows ?? [])[0]?.campaign_id;
      if (campaignId) await sb.rpc('outreach_recompute_campaign_counters', { p_campaign_id: campaignId });
    }
    await sb.rpc('comm_finish_webhook_event', { p_provider: 'RESEND', p_event_key: eventId, p_error: null });
    return;
  }

  const status = DELIVERY_STATUS[eventType];
  if (!status && !STUDIO_KIND[eventType]) {
    // delivery_delayed, and anything added later. Claimed, so a retry of it
    // is quiet, and then left alone.
    await sb.rpc('comm_finish_webhook_event', {
      p_provider: 'RESEND', p_event_key: eventId, p_error: null,
    });
    return;
  }

  /* The id Resend gave us when we sent it, which is what outreach-send stored
     in provider_message_id. It is the only identifier both sides hold. */
  const providerMessageId = typeof data.email_id === 'string' ? data.email_id : null;

  /*
   * EMAIL STUDIO FIRST. A studio campaign email has its own recipient row keyed
   * on the same provider message id; when the id is one of those, the event is
   * applied there (status, opens, clicks, CRM timeline, suppression on bounce
   * and complaint) and the outreach path below is not involved. When it is not
   * a studio email the function returns null and outreach handling is exactly
   * what it was.
   */
  const studioKind = STUDIO_KIND[eventType];
  if (studioKind && providerMessageId) {
    const bounce = (data.bounce ?? {}) as Record<string, unknown>;
    const click = (data.click ?? {}) as Record<string, unknown>;
    const detail: Record<string, unknown> = {};
    if (studioKind === 'BOUNCED') detail.bounceType = typeof bounce.type === 'string' ? bounce.type : null;
    // The link only: never the clicker's IP address or user agent.
    if (studioKind === 'CLICKED' && typeof click.link === 'string') detail.link = click.link.slice(0, 500);
    const { data: studioCampaign, error: studioError } = await sb.rpc('email_studio_apply_event', {
      p_provider_message_id: providerMessageId,
      p_kind: studioKind,
      p_event_key: eventId,
      p_detail: detail,
    });
    /* A studio failure must not cost outreach its delivery event (for example
       this function deployed before the studio migration was applied): it is
       logged and the outreach path below runs as it always has. */
    if (studioError) {
      logEvent('email-webhook', 'studio_event_failed', { type: eventType, error: redact(studioError.message) });
    }
    if (!studioError && studioCampaign) {
      logEvent('email-webhook', 'studio_event_applied', { type: eventType });
      await sb.rpc('comm_finish_webhook_event', {
        p_provider: 'RESEND', p_event_key: eventId, p_error: null,
      });
      return;
    }
  }
  if (!status) {
    // An open or a click for mail that is not a studio campaign: outreach does
    // not track either, so it is acknowledged and left alone.
    await sb.rpc('comm_finish_webhook_event', {
      p_provider: 'RESEND', p_event_key: eventId, p_error: null,
    });
    return;
  }

  const { data: campaignId, error } = await sb.rpc('outreach_apply_delivery_event', {
    p_provider_message_id: providerMessageId,
    p_status: status,
    p_raw: eventType,
  });
  if (error) throw new Error(`apply delivery event failed: ${error.message}`);

  if (!campaignId) {
    /* A delivery receipt for mail this product did not send through a
       campaign -- a transactional email, or one sent before these rows
       existed. Not an error, and recorded so it is visible rather than
       silently dropped. */
    logEvent('email-webhook', 'delivery_event_unmatched', { type: eventType });
    await sb.rpc('comm_finish_webhook_event', {
      p_provider: 'RESEND', p_event_key: eventId, p_error: 'no matching send',
    });
    return;
  }

  await sb.rpc('outreach_recompute_campaign_counters', { p_campaign_id: campaignId });
  logEvent('email-webhook', 'delivery_event_applied', { type: eventType, status });
  await sb.rpc('comm_finish_webhook_event', {
    p_provider: 'RESEND', p_event_key: eventId, p_error: null,
  });
}

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

  /*
   * REPLY ROUTING. A reply to r-<token>@<reply domain> belongs to exactly the tenant
   * the token was issued for — the sender's address is never what decides the tenant.
   * Without a live token the older channel-account address match applies.
   */
  const settings = await loadEmailSettings(sb);
  const token = routeTokenFrom([...email.to], settings.replyDomain);
  const route = token ? await resolveReplyRoute(sb, token) : null;
  if (token && !route) logEvent('email-webhook', 'reply_route_unknown_or_revoked', {});
  const account = route
    ? { id: null as string | null, owner_id: route.ownerAuthId, status: 'CONNECTED', environment: null, provider_account_id: null }
    : await resolveAccount(sb, email.to);
  if (!account) {
    /* Unroutable. The delivery is acknowledged and the event row keeps the
       reason, so somebody can see that mail is arriving at an address no
       customer has claimed — which is a configuration problem, not a bug, and
       is invisible if the webhook silently drops it. */
    /* Recipient addresses are personal data: only their domains are logged and kept. */
    const domains = [...new Set(email.to.map((a) => a.split('@').pop()?.toLowerCase() ?? '?'))].join(', ').slice(0, 200);
    logEvent('email-webhook', 'unroutable_address', { domains });
    await sb.rpc('comm_finish_webhook_event', {
      p_provider: 'RESEND', p_event_key: email.eventId,
      p_error: `no channel account for an address at ${domains}`,
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

  /*
   * THE BODY IS A SECOND CALL.
   *
   * Resend's email.received carries metadata only -- "webhooks do not include
   * the email body, headers, or attachments, only their metadata" is their
   * own sentence. So a webhook that reads data.text records every genuine
   * reply as a message with nothing in it, and it does that silently: the
   * conversation opens, the notification fires, the inbox shows a blank line,
   * and nothing anywhere is an error.
   *
   * It is fetched here rather than in the pure module because it needs the
   * network and the API key, and the shape the module normalises stays a
   * function of its argument.
   */
  const full = await fetchReceivedEmail(email.providerEmailId);
  const fetched = (email.text || email.html) ? null : (full ? { text: full.text ?? null, html: full.html ?? null } : null);
  const body = email.text ?? fetched?.text ?? stripHtml(email.html ?? fetched?.html ?? null) ?? '';
  const sentAt = email.sentAt ?? new Date().toISOString();
  /*
   * WHO REALLY SENT IT. The From header is the sender's own claim, and a reply-route address is
   * visible to everyone who received the campaign. A message whose own domain's DMARC (or both
   * SPF and DKIM) FAILED is recorded and shown flagged, but it never acts on the contact book or
   * the conversation: a forged "STOP" cannot unsubscribe somebody else's contact. A sender with
   * no DMARC at all (UNKNOWN) is treated as genuine, so a real opt-out is never ignored.
   */
  const senderCheck = senderAuthentication(full?.authentication);

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

  /* The full message: HTML (rendered sanitised, sandboxed), threading headers and the
     provider's SPF/DKIM/DMARC verdicts. Attachments are listed by metadata only. */
  if (row?.message_id) {
    const meta = {
      subject: email.subject ?? full?.subject ?? null,
      message_id: email.messageId ?? full?.message_id ?? null,
      in_reply_to: email.inReplyTo,
      references: headerList(full?.headers, 'references'),
      to: full?.to ?? email.to, cc: full?.cc ?? [],
      authentication: full?.authentication ?? null,
      attachments: (full?.attachments ?? []).slice(0, 25).map((a) => ({ id: a.id, filename: a.filename ?? null, content_type: a.content_type ?? null, size: a.size ?? null })),
      route: route ? { kind: route.kind, campaign_id: route.campaignId } : null,
      sender_check: senderCheck,
      provider_email_id: email.providerEmailId ?? null,
    };
    await sb.from('comm_messages')
      .update({ email_meta: meta, html_body: (full?.html ?? email.html ?? null)?.slice(0, 500_000) ?? null })
      .eq('id', row.message_id);
  }
  if (conversationId && route) {
    await sb.from('comm_conversations')
      .update({ metadata: { reply_route_kind: route.kind, reply_campaign_id: route.campaignId }, updated_at: new Date().toISOString() })
      .eq('id', conversationId).eq('owner_id', route.ownerAuthId);
  }
  /* An Email Studio offer answered by the member it was sent to: their Leads CRM entry moves
     to REPLIED and links this thread. The database re-checks token, recipient, sender address
     and thread ownership, and records each message once. Never on a FAILED sender check. */
  if (route?.kind === 'STUDIO' && senderCheck !== 'FAIL' && row?.message_id) {
    const { data: crm, error: crmErr } = await sb.rpc('email_studio_reply_to_crm', {
      p_token: route.token, p_from: email.fromAddress, p_message_key: email.messageId ?? email.eventId,
      p_comm_message_id: row.message_id, p_conversation_id: conversationId ?? null,
    });
    logEvent('email-webhook', 'studio_reply_crm', { outcome: crmErr ? 'ERROR' : String(crm), error: crmErr ? redact(crmErr.message) : undefined });
  }

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

  if (account.id) {
    await sb.from('comm_channel_accounts')
      .update({ last_inbound_at: sentAt })
      .eq('id', account.id);
  }

  const written = stripQuotedReply(body);

  // ── Opt-out ──────────────────────────────────────────────────────────────
  // Checked deterministically and acted on before anything else, for the same
  // reason as on WhatsApp: a "STOP" only an LLM notices is a "STOP" answered
  // with a cheerful follow-up.
  if (senderCheck === 'FAIL') {
    logEvent('email-webhook', 'sender_authentication_failed', { conversationId });
  } else if (written && detectsOptOut(written)) {
    await applyOptOut(sb, account.owner_id, email.fromAddress, conversationId);
    logEvent('email-webhook', 'opt_out_recorded', { conversationId });
    await sb.rpc('comm_finish_webhook_event', {
      p_provider: 'RESEND', p_event_key: email.eventId, p_error: null,
    });
    return;
  }

  // ── "Give me a real person" (§113) ───────────────────────────────────────
  if (senderCheck !== 'FAIL' && written && detectsHumanRequest(written).requested && conversationId) {
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
    deepLink: conversationId ? `/inbox/email?conversation=${conversationId}` : '/inbox/email',
    entityType: 'conversation',
    entityId: conversationId ?? null,
    groupKey: conversationId ? `email:${conversationId}` : `email:${account.owner_id}`,
    groupTitle: '{n} new email replies',
    metadata: {
      conversation_id: conversationId ?? null,
      kind: 'NEW_MESSAGE',
      channel: 'EMAIL',
      subject: email.subject,
      sender_check: senderCheck,
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


/* ── event bookkeeping ───────────────────────────────────────────────────── */

async function claimEvent(sb: Sb, key: string, type: string): Promise<boolean> {
  const { data, error } = await sb.rpc('comm_claim_webhook_event', {
    p_provider: 'RESEND', p_event_key: key, p_event_type: type,
    p_payload: { kind: type, at: new Date().toISOString() },
  });
  if (error) throw new Error(`dedup claim failed: ${error.message}`);
  return Boolean(data);
}

async function finishEvent(sb: Sb, key: string, err: string | null): Promise<void> {
  await sb.rpc('comm_finish_webhook_event', { p_provider: 'RESEND', p_event_key: key, p_error: err ? err.slice(0, 500) : null });
}

/** A message the provider will not deliver: the send is marked failed, and a Resend
 *  suppression becomes a HOMATCH-wide suppression of that address. */
async function applyUndeliverable(sb: Sb, data: Record<string, unknown>, eventType: string): Promise<void> {
  const providerMessageId = typeof data.email_id === 'string' ? data.email_id : null;
  if (providerMessageId) {
    await sb.from('outreach_sends').update({ status: 'FAILED', error_message: eventType, updated_at: new Date().toISOString() })
      .eq('provider_message_id', providerMessageId).in('status', ['QUEUED', 'SENT']);
  }
  if (eventType === 'email.suppressed') {
    const to = Array.isArray(data.to) ? data.to : [];
    for (const addr of to.slice(0, 50)) {
      if (typeof addr === 'string' && addr.includes('@')) {
        await sb.from('email_studio_suppressions').insert({ email: addr.toLowerCase(), reason: 'MANUAL', source: 'RESEND_SUPPRESSED' });
      }
    }
  }
}

/** domain.*, suppression.*, contact.*, topic.*, inbox.*: claimed, applied where HOMATCH uses it, recorded. */
async function handleAccountEvent(sb: Sb, body: unknown, eventType: string, eventKey: string): Promise<void> {
  if (!(await claimEvent(sb, eventKey, eventType))) {
    logEvent('email-webhook', 'duplicate_dropped', { type: eventType });
    return;
  }
  const data = ((body as { data?: unknown })?.data ?? {}) as Record<string, unknown>;
  if (eventType.startsWith('domain.') && typeof data.id === 'string') {
    if (eventType === 'domain.deleted') {
      await sb.from('email_sending_domains').update({ status: 'DISCONNECTED', disconnected_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('resend_domain_id', data.id).neq('status', 'DISCONNECTED');
    } else {
      const status = mapDomainStatus(typeof data.status === 'string' ? data.status : null);
      const patch: Record<string, unknown> = {
        provider_status: typeof data.status === 'string' ? data.status : null, status,
        last_checked_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      };
      if (Array.isArray(data.records)) patch.records = data.records;
      if (status === 'VERIFIED') patch.verified_at = new Date().toISOString();
      await sb.from('email_sending_domains').update(patch).eq('resend_domain_id', data.id).neq('status', 'DISCONNECTED');
    }
  } else if (eventType === 'contact.updated' && data.unsubscribed === true && typeof data.email === 'string') {
    /* Somebody used Resend's broadcast unsubscribe link: HOMATCH stops emailing the address too. */
    await sb.from('email_studio_suppressions').insert({ email: String(data.email).toLowerCase(), reason: 'UNSUBSCRIBED', source: 'RESEND_BROADCAST_UNSUBSCRIBE' });
  } else if (eventType === 'suppression.added') {
    const addr = typeof data.email === 'string' ? data.email : null;
    if (addr && addr.includes('@')) {
      await sb.from('email_studio_suppressions').insert({ email: addr.toLowerCase(), reason: 'MANUAL', source: 'RESEND_SUPPRESSION' });
    }
  }
  /* suppression.removed is deliberately NOT applied: lifting a suppression is a
     human decision, never an automatic one. contact.*, topic.* and inbox.* belong
     to Resend features HOMATCH does not use; they are recorded and left alone. */
  await finishEvent(sb, eventKey, null);
}

/** The whole received email from Resend's Receiving API (the webhook carries metadata only). */
async function fetchReceivedEmail(providerEmailId: string | null) {
  if (!providerEmailId) return null;
  const sb = serviceClient();
  const settings = await loadEmailSettings(sb);
  const key = resolveResendKey('marketing', settings.keyEnvName).key;
  if (!key) {
    logEvent('email-webhook', 'body_unfetchable', { reason: 'NO_RESEND_KEY' });
    return null;
  }
  const res = await getReceivedEmail(key, providerEmailId);
  if (!res.ok || !res.json) {
    logEvent('email-webhook', 'body_unfetchable', { reason: res.error ?? `HTTP_${res.status}` });
    return null;
  }
  return res.json;
}

function headerList(headers: Record<string, unknown> | undefined, name: string): string[] {
  if (!headers) return [];
  const v = headers[name] ?? headers[name.toLowerCase()];
  const raw = Array.isArray(v) ? v.join(' ') : typeof v === 'string' ? v : '';
  return raw.split(/\s+/).map((x) => x.trim()).filter((x) => /^<[^<>\s]+>$/.test(x)).slice(0, 50);
}
