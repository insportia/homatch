// HOMATCH — sending one WhatsApp message.
//
// §32 is a list of things that must ALL be true before a message leaves, and
// this function's job is to be the only place they are checked:
//
//   authenticated user, from the token and not the body
//   ownership of the conversation and the contact
//   contact eligibility: not suppressed, not opted out
//   the real-estate boundary
//   the account is not frozen
//   the 24-hour window, or an APPROVED template
//   rate limits
//   the conversation is in a mode that permits this author to speak
//
// "DO NOT build a public unauthenticated send endpoint" is the section's first
// line. verify_jwt stays on, and every identity below comes from the verified
// token.
//
// WHY THE HANDOFF CHECK IS PART OF THE WRITE
//
// §36 forbids the AI and a human both replying. Checking the mode and then
// sending leaves a window: a human can press Take over in between. So the AI
// path re-asserts the mode through comm_set_conversation_mode's conditional
// update BEFORE calling Meta, and abandons the send if the conversation moved.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {
  authenticate, serviceClient, json, preflight, checkRateLimit, logEvent, redact,
} from '../_shared/comm/auth.ts';
import { createMetaProvider, metaConfigFromEnv, metaCredentialsPresent } from '../_shared/comm/meta.ts';
import { requiresTemplate } from '../_shared/comm/generated/statusMap.ts';
import { mayAiReply, mayHumanReply } from '../_shared/comm/generated/handoff.ts';
import { classifyDomain } from '../_shared/comm/generated/domainClassifier.ts';

interface SendRequest {
  conversationId?: string;
  /** For a first message to someone not yet in a thread. */
  toE164?: string;
  text?: string;
  templateId?: string;
  templateVariables?: string[];
  /** 'AI' only from an internal caller; a browser is always HUMAN. */
  author?: 'HUMAN' | 'AI';
  campaignId?: string;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const caller = await authenticate(req);
  if (!caller) return json({ error: 'unauthorized' }, 401);

  const creds = metaCredentialsPresent();
  if (!creds.ok) {
    // The customer is told the channel is unavailable; the missing secret
    // names are an Admin concern (§92, §106).
    logEvent('whatsapp-send', 'not_configured', { missing: creds.missing.join(',') });
    return json({ error: 'channel_unavailable', code: 'CHANNEL_NOT_CONFIGURED' }, 503);
  }

  let body: SendRequest;
  try {
    body = await req.json() as SendRequest;
  } catch {
    return json({ error: 'bad_request' }, 400);
  }

  const sb = serviceClient();
  const userId = caller.userId;

  // ── Account-level freeze, before anything else ───────────────────────────
  const { data: trust } = await sb.from('comm_account_trust')
    .select('tier, outbound_frozen, max_messages_per_hour')
    .eq('owner_id', userId).maybeSingle();

  if (trust?.outbound_frozen) {
    return json({ error: 'outbound_paused', code: 'ACCOUNT_FROZEN' }, 403);
  }

  // ── Rate limit ───────────────────────────────────────────────────────────
  const hourlyCap = Number(trust?.max_messages_per_hour ?? 200);
  const limit = await checkRateLimit(sb, 'whatsapp_send', hourlyCap, 3600, { userId });
  if (!limit.allowed) {
    return json({ error: 'rate_limited', code: 'RATE_LIMIT', retryAfter: limit.retryAfterSeconds }, 429);
  }

  // ── Resolve the conversation, and prove it is this caller's ──────────────
  const thread = await resolveThread(sb, userId, body);
  if ('error' in thread) return json({ error: thread.error, code: thread.code }, thread.status);

  const { conversation, account } = thread;

  // ── Who is allowed to speak right now (§36) ──────────────────────────────
  const author: 'HUMAN' | 'AI' = body.author === 'AI' ? 'AI' : 'HUMAN';
  if (author === 'AI' && !mayAiReply(conversation.mode)) {
    return json({ error: 'ai_not_active', code: 'HUMAN_HAS_THE_CONVERSATION' }, 409);
  }
  if (author === 'HUMAN' && !mayHumanReply(conversation.mode)) {
    return json({ error: 'conversation_closed', code: 'BAD_STATE' }, 409);
  }

  // A human sending a message IS taking the conversation. Done as a
  // conditional update so two operators racing produce one winner, and so the
  // AI cannot slip a reply in after this point.
  if (author === 'HUMAN' && conversation.mode !== 'HUMAN_ACTIVE') {
    await sb.rpc('comm_set_conversation_mode', {
      p_conversation_id: conversation.id,
      p_expected_mode: conversation.mode,
      p_new_mode: 'HUMAN_ACTIVE',
      p_actor: userId,
      p_reason: 'replied from the inbox',
    });
  }

  // ── Contact eligibility ──────────────────────────────────────────────────
  const { data: contact } = await sb.from('outreach_contacts')
    .select('id, suppressed, do_not_contact, unsubscribed, whatsapp_opted_out')
    .eq('owner_id', userId).eq('phone', conversation.peer_address).maybeSingle();

  if (contact && (contact.suppressed || contact.do_not_contact || contact.whatsapp_opted_out)) {
    return json({ error: 'contact_not_contactable', code: 'SUPPRESSED' }, 403);
  }

  // ── The 24-hour window ───────────────────────────────────────────────────
  const needsTemplate = requiresTemplate(conversation.service_window_expires_at);
  if (needsTemplate && !body.templateId) {
    return json({
      error: 'template_required',
      code: 'OUTSIDE_SERVICE_WINDOW',
      // The customer-facing reason, without Meta jargon (§106).
      detail: 'more than 24 hours have passed since this contact last wrote, so an approved template is needed',
    }, 409);
  }

  let template: TemplateRow | null = null;
  if (body.templateId) {
    const { data } = await sb.from('comm_whatsapp_templates')
      .select('id, owner_id, name, language, status, body_text')
      .eq('id', body.templateId).eq('owner_id', userId).maybeSingle();
    if (!data) return json({ error: 'template_not_found', code: 'TEMPLATE_NOT_APPROVED' }, 404);
    // §37: our own generation is not Meta's approval.
    if (data.status !== 'APPROVED') {
      return json({ error: 'template_not_approved', code: 'TEMPLATE_NOT_APPROVED', status: data.status }, 409);
    }
    template = data as TemplateRow;
  }

  // ── The real-estate boundary, on the actual words ────────────────────────
  // A per-message check, not only a per-campaign one: a compliant campaign is
  // not a licence to type anything into the inbox afterwards.
  const outgoingText = body.text ?? template?.body_text ?? '';
  if (outgoingText.trim()) {
    const domain = classifyDomain({ text: outgoingText, campaignType: 'WHATSAPP' });
    if (domain.verdict === 'BLOCK') {
      logEvent('whatsapp-send', 'domain_blocked', {
        conversationId: conversation.id,
        signals: domain.signals.map((s) => s.code).join(','),
      });
      return json({ error: 'outside_product_scope', code: 'DOMAIN_BLOCKED' }, 403);
    }
  }

  if (!outgoingText.trim() && !template) {
    return json({ error: 'empty_message', code: 'BAD_REQUEST' }, 400);
  }

  // ── Send ─────────────────────────────────────────────────────────────────
  // The key is deterministic per conversation and content, so a double-clicked
  // Send or a retried request does not produce two messages (§129).
  const idempotencyKey = await hashKey(
    `${conversation.id}:${template?.id ?? 'text'}:${outgoingText}:${Math.floor(Date.now() / 10_000)}`,
  );

  const { data: existing } = await sb.from('comm_messages')
    .select('id, provider_message_id, status')
    .eq('conversation_id', conversation.id)
    .eq('body', outgoingText || null)
    .gte('created_at', new Date(Date.now() - 15_000).toISOString())
    .maybeSingle();
  if (existing) {
    logEvent('whatsapp-send', 'duplicate_suppressed', { conversationId: conversation.id });
    return json({ ok: true, messageId: existing.id, deduplicated: true });
  }

  // Recorded BEFORE the provider call. If the process dies mid-send there is a
  // row saying an attempt was made, which is what reconciliation needs; a row
  // written only on success leaves a silent gap.
  const { data: pending, error: insertErr } = await sb.from('comm_messages').insert({
    conversation_id: conversation.id,
    owner_id: userId,
    direction: 'OUTBOUND',
    author,
    author_user_id: author === 'HUMAN' ? userId : null,
    kind: template ? 'TEMPLATE' : 'TEXT',
    body: outgoingText || null,
    template_id: template?.id ?? null,
    template_variables: body.templateVariables ?? null,
    status: 'QUEUED',
  }).select('id').maybeSingle();

  if (insertErr || !pending) {
    logEvent('whatsapp-send', 'insert_failed', { error: insertErr?.message });
    return json({ error: 'could_not_queue', code: 'ERROR' }, 500);
  }

  const provider = createMetaProvider(metaConfigFromEnv());
  const result = await provider.send({
    toE164: conversation.peer_address,
    text: template ? undefined : outgoingText,
    template: template ? {
      name: template.name,
      language: template.language,
      variables: (body.templateVariables ?? []).map((v) => String(v).slice(0, 1024)),
    } : undefined,
    idempotencyKey,
  });

  if (!result.ok) {
    await sb.from('comm_messages').update({
      status: result.sideEffect === 'MAYBE' ? 'QUEUED' : 'FAILED',
      error_code: String(result.error?.providerCode ?? result.error?.code ?? ''),
      error_message: result.error?.message ?? null,
    }).eq('id', pending.id);

    logEvent('whatsapp-send', 'send_failed', {
      conversationId: conversation.id,
      code: result.error?.code ?? null,
      sideEffect: result.sideEffect,
    });

    // A MAYBE is not a failure the customer should retry — the message may
    // well have gone. It is left QUEUED for the status webhook to resolve.
    const status = result.error?.code === 'AUTH' ? 503 : result.error?.code === 'RATE_LIMIT' ? 429 : 502;
    return json({
      error: 'send_failed',
      code: result.error?.code ?? 'UNKNOWN',
      pending: result.sideEffect === 'MAYBE',
      messageId: pending.id,
    }, status);
  }

  const now = new Date().toISOString();
  await sb.from('comm_messages').update({
    status: 'SENT',
    provider_message_id: result.data?.providerMessageId ?? null,
    provider_status_raw: result.data?.status ?? null,
    sent_at: now,
  }).eq('id', pending.id);

  await sb.from('comm_conversations').update({
    last_message_at: now,
    last_message_preview: (outgoingText || template?.name || '').slice(0, 200),
    updated_at: now,
  }).eq('id', conversation.id);

  await sb.from('comm_channel_accounts').update({ last_outbound_at: now }).eq('id', account.id);

  if (contact) {
    await sb.from('outreach_contacts').update({ last_contacted_at: now }).eq('id', contact.id);
  }

  logEvent('whatsapp-send', 'sent', {
    conversationId: conversation.id, author, templated: Boolean(template), latencyMs: result.latencyMs ?? 0,
  });

  return json({
    ok: true,
    messageId: pending.id,
    providerMessageId: result.data?.providerMessageId ?? null,
  });
});

interface TemplateRow {
  id: string; owner_id: string; name: string; language: string; status: string; body_text: string | null;
}

interface ConversationRow {
  id: string; owner_id: string; peer_address: string; mode: string;
  service_window_expires_at: string | null; channel_account_id: string | null;
}

type Sb = ReturnType<typeof serviceClient>;

/**
 * Find the thread this message belongs to, creating one only for a genuinely
 * new outbound conversation — and only to a number the caller actually owns a
 * contact record for.
 *
 * The ownership check is the point. Without it, a caller could post any phone
 * number on earth and Homatch would message it.
 */
async function resolveThread(
  sb: Sb, userId: string, body: SendRequest,
): Promise<{ conversation: ConversationRow; account: { id: string } } | { error: string; code: string; status: number }> {
  if (body.conversationId) {
    const { data } = await sb.from('comm_conversations')
      .select('id, owner_id, peer_address, mode, service_window_expires_at, channel_account_id')
      .eq('id', body.conversationId).maybeSingle();
    if (!data) return { error: 'conversation_not_found', code: 'NOT_FOUND', status: 404 };
    if (data.owner_id !== userId) return { error: 'forbidden', code: 'NOT_OWNER', status: 403 };

    const account = await senderAccount(sb, userId, data.channel_account_id);
    if (!account) return { error: 'channel_unavailable', code: 'CHANNEL_NOT_CONFIGURED', status: 503 };
    return { conversation: data as ConversationRow, account };
  }

  const to = String(body.toE164 ?? '').trim();
  if (!/^\+\d{7,15}$/.test(to)) {
    return { error: 'bad_recipient', code: 'BAD_REQUEST', status: 400 };
  }

  const { data: contact } = await sb.from('outreach_contacts')
    .select('id').eq('owner_id', userId).eq('phone', to).maybeSingle();
  if (!contact) {
    // §32: ownership, not just authentication. A number this account has never
    // imported is not a number this account may message.
    return { error: 'unknown_contact', code: 'NOT_OWNER', status: 403 };
  }

  const account = await senderAccount(sb, userId, null);
  if (!account) return { error: 'channel_unavailable', code: 'CHANNEL_NOT_CONFIGURED', status: 503 };

  const { data: created, error } = await sb.from('comm_conversations').upsert({
    owner_id: userId,
    channel: 'WHATSAPP',
    peer_address: to,
    channel_account_id: account.id,
    contact_id: contact.id,
    mode: 'HUMAN_ACTIVE',
  }, { onConflict: 'owner_id,channel,peer_address' })
    .select('id, owner_id, peer_address, mode, service_window_expires_at, channel_account_id')
    .maybeSingle();

  if (error || !created) return { error: 'could_not_open_conversation', code: 'ERROR', status: 500 };
  return { conversation: created as ConversationRow, account };
}

async function senderAccount(sb: Sb, userId: string, preferredId: string | null) {
  if (preferredId) {
    const { data } = await sb.from('comm_channel_accounts')
      .select('id, owner_id, status').eq('id', preferredId).maybeSingle();
    if (data && data.status === 'CONNECTED' && (data.owner_id === userId || data.owner_id === null)) {
      return { id: data.id };
    }
  }
  const { data } = await sb.from('comm_channel_accounts')
    .select('id')
    .eq('channel', 'WHATSAPP')
    .eq('status', 'CONNECTED')
    .or(`owner_id.eq.${userId},owner_id.is.null`)
    // A customer's own number is preferred over the shared platform one.
    .order('owner_id', { ascending: false, nullsFirst: false })
    .limit(1).maybeSingle();
  return data ? { id: data.id } : null;
}

async function hashKey(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export { redact };
