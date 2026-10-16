// send-message Edge Function — Property Conversations.
//
// POST { conversation_id?, property_id?, recipient_id, body, kind?, media_path?, media_meta?,
//        reply_to_id?, card_property_id?, original_body?, original_lang?, translated_to?,
//        client_message_id? }                                   → send (the default)
// POST { action: 'translate_draft' | 'translate_message' | 'assist' | 'transcribe', ... }
//                                                              → AI help (_shared/propertyChatAi.ts)
//
// The AI actions live behind this function rather than a new one: production sits at the
// plan's edge-function cap. The send path stays here because it is what the notification,
// intent and impersonation guards (src/lib/notifications, tests/matrix) read; its rules
// are the pure functions in _shared/propertyChat.ts.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { refuseIfImpersonating } from '../_shared/impersonation.ts';
import { notify } from '../_shared/notify.ts';
import { sendNotificationEmail, renderNotificationEmail } from '../_shared/notifyEmail.ts';
import {
  SEND_RATE_LIMIT, buildPropertyCard, cardRefusal, emailEnabledFrom, isDuplicateBody, notificationPlan,
  offerCapDecision, parseSendRequest, validateMedia, type StoredObject,
} from '../_shared/propertyChat.ts';
import { handleChatAi, isChatAiAction } from '../_shared/propertyChatAi.ts';
import { chatLang, chatString } from '../../../src/chat/templates.ts';
import { DM_MEDIA_BUCKET } from '../../../src/chat/conversation.ts';
import { recordIntent } from '../_shared/intent.ts';
import {
  projectActor,
  projectPropertyInterest,
  recordDemandFrom,
  requestNativeMatching,
} from '../_shared/nativeDemand.ts';
import {
  attributionOf, readingsOf,
} from '../../../src/research-core/intent/interpret.ts';

const APP_URL = 'https://www.homatch.live';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Content-Type': 'application/json',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    /* An administrator viewing as this account is read-only here: this path
       writes with the service role, so Postgres never sees the caller's
       impersonation token and cannot refuse it itself. */
    const impersonating = await refuseIfImpersonating(supabase, authHeader, corsHeaders);
    if (impersonating) return impersonating;

    /*
     * BOTH COLUMNS, BECAUSE PRODUCTION HAS ALWAYS CHECKED BOTH.
     *
     * The version running in production since August resolves the sender on
     * `id` OR `auth_id`; this file checks only auth_id. Every account today
     * has auth_id set and distinct from id, so the two agree — but this file
     * is about to replace that one, and narrowing a lookup on the way past is
     * how a deploy that was meant to fix notifications turns into "I cannot
     * send messages any more" for whoever the narrower query misses.
     */
    const { data: sender } = await supabase.from('users').select('id')
      .or(`id.eq.${user.id},auth_id.eq.${user.id}`).maybeSingle();
    if (!sender) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: corsHeaders });

    const raw = await req.json().catch(() => ({}));
    const reply = (status: number, payload: Record<string, unknown>) =>
      new Response(JSON.stringify(payload), { status, headers: corsHeaders });

    /* AI help: translate, assist, transcribe. Never sends anything. */
    if (raw?.action && raw.action !== 'send') {
      if (!isChatAiAction(raw.action)) return reply(400, { error: 'Unknown action' });
      const result = await handleChatAi(supabase, sender.id, raw.action, raw as Record<string, unknown>);
      return reply(result.status, result.body);
    }

    const parsed = parseSendRequest(raw);
    if (!parsed.ok) return reply(400, { error: parsed.error });
    const request = parsed.value;
    const { conversationId: conversation_id, propertyId: property_id, body } = request;
    const recipient_id = request.recipientId;
    if (!recipient_id || recipient_id === sender.id) return new Response(JSON.stringify({ error: 'Valid recipient_id required' }), { status: 400, headers: corsHeaders });

    /* A retried send (dropped response, double tap) returns the first row, not a second message. */
    if (request.clientMessageId) {
      const { data: existing } = await supabase.from('messages').select('*')
        .eq('sender_id', sender.id).eq('client_message_id', request.clientMessageId).maybeSingle();
      if (existing) return reply(200, { message: existing, conversation_id: existing.conversation_id, first_contact: false, duplicate: true });
    }

    /* Per-sender burst and daily ceilings, atomically in Postgres. An unreachable limiter
       does not stop people talking (logged); a reached one does. */
    try {
      const { data: rate, error: rateErr } = await supabase.rpc('consume_marketplace_rate_limit', {
        p_user_id: sender.id, p_operation: SEND_RATE_LIMIT.operation,
        p_burst_limit: SEND_RATE_LIMIT.burstLimit, p_burst_seconds: SEND_RATE_LIMIT.burstSeconds,
        p_daily_limit: SEND_RATE_LIMIT.dailyLimit, p_daily_seconds: SEND_RATE_LIMIT.dailySeconds,
      });
      if (rateErr) console.error('send-message rate limiter unavailable', rateErr);
      else if (rate && rate.allowed === false) {
        return reply(429, { error: 'RATE_LIMITED', retry_after_seconds: Math.max(1, Math.trunc(Number(rate.retry_after_seconds)) || 10) });
      }
    } catch (rateThrow) {
      console.error('send-message rate limiter threw', rateThrow);
    }

    const { data: recipient } = await supabase.from('users').select('id,preferred_language').eq('id', recipient_id).maybeSingle();
    if (!recipient) return new Response(JSON.stringify({ error: 'Recipient not found' }), { status: 404, headers: corsHeaders });

    const { data: block } = await supabase.from('conversation_blocks').select('id')
      .or(`and(blocker_id.eq.${recipient_id},blocked_id.eq.${sender.id}),and(blocker_id.eq.${sender.id},blocked_id.eq.${recipient_id})`).limit(1).maybeSingle();
    if (block) return new Response(JSON.stringify({ error: 'Cannot send message' }), { status: 403, headers: corsHeaders });

    let convId = conversation_id as string | undefined;
    let isFirstContact = false;

    if (convId) {
      const { data: supplied } = await supabase.from('conversations')
        .select('id,initiator_id,recipient_id,first_contact_email_sent,status').eq('id', convId).maybeSingle();
      if (!supplied || (supplied.initiator_id !== sender.id && supplied.recipient_id !== sender.id)) {
        return new Response(JSON.stringify({ error: 'Conversation not found' }), { status: 404, headers: corsHeaders });
      }
      const actualRecipient = supplied.initiator_id === sender.id ? supplied.recipient_id : supplied.initiator_id;
      if (actualRecipient !== recipient_id || supplied.status === 'BLOCKED') {
        return new Response(JSON.stringify({ error: 'Conversation recipient mismatch' }), { status: 403, headers: corsHeaders });
      }
      isFirstContact = !supplied.first_contact_email_sent;
    } else {
      /*
       * ONE CONVERSATION PER PAIR AND PROPERTY, decided by the database. This was a
       * select followed by an insert, so two taps at once made two conversations — and
       * A→B and B→A about the same flat were two conversations as well. ensure_conversation()
       * is insert-or-return on the unordered pair.
       */
      const { data: ensured, error: convErr } = await supabase.rpc('ensure_conversation', {
        p_initiator: sender.id, p_recipient: recipient_id, p_property: property_id || null,
      });
      if (convErr || !ensured) throw convErr ?? new Error('conversation not created');
      convId = String(ensured);
      const { data: current } = await supabase.from('conversations')
        .select('first_contact_email_sent,status').eq('id', convId).maybeSingle();
      if (current?.status === 'BLOCKED') {
        return new Response(JSON.stringify({ error: 'Cannot send message' }), { status: 403, headers: corsHeaders });
      }
      isFirstContact = !current?.first_contact_email_sent;
    }

    /*
     * WHICH PROPERTY THIS CONVERSATION IS ABOUT, read once.
     *
     * From the conversation rather than from the request: a caller supplying a
     * property_id for a conversation that is about a different property would otherwise
     * be attaching somebody's words to a listing they never mentioned.
     */
    const { data: conversationRow } = await supabase
      .from('conversations').select('property_id,initiator_id,initiator_muted,recipient_muted,property:properties!property_id(user_id)')
      .eq('id', convId).maybeSingle();
    const propertyContext = (conversationRow?.property_id as string | null) ?? null;
    const propertyJoin = conversationRow?.property as { user_id?: string } | Array<{ user_id?: string }> | null;
    const propertyOwner = (Array.isArray(propertyJoin) ? propertyJoin[0] : propertyJoin)?.user_id ?? null;
    const recipientMuted = conversationRow?.initiator_id === recipient_id
      ? !!conversationRow?.initiator_muted : !!conversationRow?.recipient_muted;

    /*
     * THE ANTI-FLOOD RULES, from the conversation's own history.
     *
     * An owner writing to a member about their own listing is an OFFER until the member
     * answers. Until then: the member's "receive property offers" choice is honoured
     * (internal leads), and the owner may send three messages, not thirty.
     */
    const senderOwnsProperty = !!propertyOwner && propertyOwner === sender.id;
    const [{ count: theirCount }, { count: myCount }, { data: recentMine }] = await Promise.all([
      supabase.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', convId).eq('sender_id', recipient_id),
      supabase.from('messages').select('id', { count: 'exact', head: true }).eq('conversation_id', convId).eq('sender_id', sender.id),
      supabase.from('messages').select('body,created_at,client_message_id').eq('conversation_id', convId).eq('sender_id', sender.id)
        .gte('created_at', new Date(Date.now() - 60_000).toISOString()).order('created_at', { ascending: false }).limit(20),
    ]);
    const counterpartReplies = Number(theirCount ?? 0);
    let isLeadOffer = false;
    if (senderOwnsProperty) {
      const [{ data: unlock }, { data: crm }] = await Promise.all([
        supabase.from('internal_lead_unlocks').select('id').eq('account_user_id', sender.id).eq('lead_user_id', recipient_id).limit(1).maybeSingle(),
        supabase.from('lead_crm_entries').select('id').eq('owner_user_id', sender.id).eq('lead_user_id', recipient_id).limit(1).maybeSingle(),
      ]);
      isLeadOffer = !!(unlock || crm);
    }
    if (isLeadOffer && counterpartReplies === 0) {
      const { data: prefs } = await supabase.rpc('lead_contact_prefs_of', { p_user_id: recipient_id });
      const pref = Array.isArray(prefs) ? prefs[0] : prefs;
      if (pref && pref.accept_property_offers === false) {
        return reply(403, { error: 'RECIPIENT_NOT_ACCEPTING_OFFERS' });
      }
    }
    const cap = offerCapDecision({ senderOwnsProperty, counterpartMessages: counterpartReplies, senderMessages: Number(myCount ?? 0) });
    if (!cap.allowed) return reply(429, { error: 'OFFER_CAP_REACHED' });
    if (request.kind === 'TEXT' && isDuplicateBody((recentMine ?? []) as never, body, new Date(), request.clientMessageId)) {
      return reply(409, { error: 'DUPLICATE_MESSAGE' });
    }

    if (request.replyToId) {
      const { data: quoted } = await supabase.from('messages').select('id')
        .eq('id', request.replyToId).eq('conversation_id', convId).maybeSingle();
      if (!quoted) return reply(400, { error: 'INVALID_REPLY' });
    }

    /* Media: checked against the object storage actually holds, not the client's claims. */
    let mediaMeta: Record<string, unknown> | null = null;
    if (request.kind === 'PHOTO' || request.kind === 'VOICE') {
      let stored: StoredObject | null = null;
      const path = request.mediaPath ?? '';
      const slash = path.lastIndexOf('/');
      if (slash > 0) {
        const { data: listed } = await supabase.storage.from(DM_MEDIA_BUCKET)
          .list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 5 });
        const hit = (listed ?? []).find((o: { name: string }) => o.name === path.slice(slash + 1)) as
          { metadata?: { size?: number; mimetype?: string } } | undefined;
        if (hit) stored = { size: hit.metadata?.size ?? null, mimetype: hit.metadata?.mimetype ?? null };
      }
      const media = validateMedia(request.kind, request.mediaPath, request.mediaMeta, stored, sender.id, convId);
      if (!media.ok) return reply(400, { error: media.error });
      mediaMeta = media.value;
    }

    /* A property card is the SENDER's own live listing, snapshotted from its rows here.
       Whatever listing fields a client sent are never read. */
    let propertyCard: Record<string, unknown> | null = null;
    if (request.kind === 'PROPERTY' && request.cardPropertyId) {
      const { data: cardProperty } = await supabase.from('properties')
        .select('id,user_id,homatch_id,title,is_deleted,archived_at,cover_photo_url,transaction_type,property_type')
        .eq('id', request.cardPropertyId).maybeSingle();
      const refusal = cardRefusal(cardProperty, sender.id);
      if (refusal) return reply(403, { error: refusal });
      const { data: cardFacts } = await supabase.from('property_facts')
        .select('city,district,total_price,currency,bedrooms,area,photo_visibility')
        .eq('property_id', request.cardPropertyId).limit(1).maybeSingle();
      propertyCard = buildPropertyCard(cardProperty, cardFacts) as unknown as Record<string, unknown>;
    }

    const now = new Date().toISOString();
    const { data: message, error: msgErr } = await supabase.from('messages').insert({
      conversation_id: convId, sender_id: sender.id, body, status: 'SENT',
      kind: request.kind, media_path: request.mediaPath, media_meta: mediaMeta, reply_to_id: request.replyToId,
      property_card: propertyCard, original_body: request.originalBody, original_lang: request.originalLang,
      translated_to: request.translatedTo, client_message_id: request.clientMessageId,
    }).select('*').single();
    if (msgErr) {
      /* Two concurrent retries of one send: the loser returns the winner's row. */
      if ((msgErr as { code?: string }).code === '23505' && request.clientMessageId) {
        const { data: winner } = await supabase.from('messages').select('*')
          .eq('sender_id', sender.id).eq('client_message_id', request.clientMessageId).maybeSingle();
        if (winner) return reply(200, { message: winner, conversation_id: convId, first_contact: false, duplicate: true });
      }
      throw msgErr;
    }

    await supabase.from('conversations').update({ last_message_at: now, ...(isFirstContact ? { first_contact_email_sent: true } : {}) }).eq('id', convId);
    await supabase.from('message_receipts').upsert({ message_id: message.id, user_id: recipient_id, status: 'DELIVERED' }, { onConflict: 'message_id,user_id' });
    await supabase.from('messages').update({ status: 'DELIVERED', delivered_at: now }).eq('id', message.id);

    /*
     * WHAT THIS MESSAGE MEANT, WHERE THE CONVERSATION KNOWS WHAT IT IS ABOUT.
     *
     * conversations.property_id is a column. Which property somebody means when they
     * write "is this still available" is therefore not a question for a language model,
     * and asking one would be slower, dearer and less certain than reading the row.
     *
     * So the split is: the COLUMN decides what the message is about, and the
     * deterministic reader decides what was said about it — interest, a withdrawal, a
     * complaint about a dimension, a question. One message can say several of those and
     * each becomes its own signal, which is why readingsOf returns a list.
     *
     * Attribution is read from the text rather than assumed: somebody writing "my sister
     * is interested" in a property conversation has not expressed their own interest,
     * and validate() refuses to let that become one.
     */
    /* The owner writing about their own property is answering, not expressing interest. */
    const intentWork: Promise<unknown>[] = [];
    if (!body) {
      /* A photo, voice note or card with no caption says nothing to read. */
    } else if (propertyContext && propertyOwner !== sender.id) {
      const readings = readingsOf(body);
      const attribution = attributionOf(body);
      for (const reading of readings) {
        await recordIntent(supabase, {
          actorUserId: sender.id,
          sourceSurface: 'PRIVATE_MESSAGE',
          sourceEventId: message.id,
          sourceAt: message.created_at ?? now,
          side: 'PROPERTY_INTEREST',
          act: reading.act,
          dimension: reading.dimension,
          polarity: reading.polarity,
          attribution,
          /* Said, not deduced: these readings come from the words themselves. */
          explicit: true,
          /*
           * NOT 1. The property is certain because a column says so; what the sentence
           * MEANT is a reading of a person's words and carries the uncertainty that
           * comes with that. Writing 1 here would claim the same certainty for both.
           */
          confidence: 0.8,
          scope: 'PROPERTY',
          propertyId: propertyContext,
          conversationId: convId,
          constraints: {},
          strength: {},
        });
      }
      /* How this person now stands towards the property, as a native relationship. */
      intentWork.push(projectPropertyInterest(supabase, sender.id, propertyContext, convId ?? null));
    } else if (!propertyContext) {
      /*
       * A PRIVATE CONVERSATION ABOUT NO PROPERTY can still carry the author's own search —
       * "I'm looking for a 2-bedroom in Vake, up to 180k" said to an agent. The same
       * reader, the same gate, the same projection as the common room: the author's own
       * words only, matched against the Homatch network only, charged nothing.
       */
      intentWork.push((async () => {
        const outcome = await recordDemandFrom(supabase, {
          surface: 'PRIVATE_MESSAGE',
          eventId: message.id,
          revision: '',
          actorUserId: sender.id,
          sourceAt: message.created_at ?? now,
          text: body,
          conversationId: convId ?? null,
        });
        if (outcome.demand === 'RECORDED' || outcome.demand === 'WITHDRAWN_SEARCH') {
          const projection = await projectActor(supabase, sender.id);
          await requestNativeMatching(projection.active);
        }
      })());
    }
    /* After the response where the runtime allows it: a message is never slowed down by
       the reading of it. */
    const settle = Promise.allSettled(intentWork);
    const runtime = (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime;
    if (runtime?.waitUntil) runtime.waitUntil(settle); else await settle;

    /*
     * EVERY MESSAGE, NOT ONLY THE FIRST.
     *
     * This used to sit inside `if (isFirstContact)`, and isFirstContact is
     * `!first_contact_email_sent` — a flag about an EMAIL, set the first time anybody
     * writes in a conversation. So the second message and every message after it told
     * nobody: a customer who replied, then followed up, then asked again was silent from
     * the bell's point of view. The email flag keeps its meaning; this is a different
     * decision and now makes it separately.
     *
     * No group key. Collapsing human messages into "4 new messages" hides the four
     * people who wrote. The dedupe key is the MESSAGE, so a retried request — a dropped
     * response, a double tap — cannot tell somebody twice. The deep link is the
     * conversation itself rather than a list to search.
     *
     * The sender is never told about their own message: notify() is called with
     * recipient_id and nothing else.
     */
    /*
     * WHICH NOTICE, AND HOW LOUD.
     *
     * The first message of a conversation an owner opened with an internal lead is a
     * PROPERTY OFFER: the approved copy, in the member's own language. Everything else is
     * NEW_MESSAGE as before. Neither ever carries the message text — a push lands on a
     * lock screen. A conversation the recipient muted is still written in-app but at LOW
     * priority, which push-send never pushes.
     */
    let emailRow: { email_enabled?: boolean | null; categories?: Record<string, unknown> | null } | null = null;
    if (isLeadOffer && isFirstContact) {
      const { data: prefRow } = await supabase.from('notification_preferences')
        .select('email_enabled,categories').eq('user_id', recipient_id).maybeSingle();
      emailRow = prefRow ?? null;
    }
    const plan = notificationPlan({ isLeadOffer, isFirstContact, recipientMuted, emailEnabled: emailEnabledFrom(emailRow) });
    const recipientLang = chatLang(recipient.preferred_language);
    const notice = plan.kind === 'PROPERTY_OFFER'
      ? { title: chatString('pc_notif_offer_title', recipientLang), body: chatString('pc_notif_offer_body', recipientLang) }
      : { title: 'New message', body: 'You have a new message from a Homatch user.' };

    const notificationId = await notify(supabase, {
      userId: recipient_id,
      type: 'NEW_MESSAGE',
      title: notice.title,
      body: notice.body,
      priority: recipientMuted ? 'LOW' : 'HIGH',
      deepLink: `/chat?conversation=${convId}`,
      entityType: 'conversation',
      entityId: convId,
      dedupeKey: `message:${message.id}`,
      /*
       * WHAT THE INTERFACE RENDERS FROM. `kind` picks the translation, and the sender
       * and the property let the notification say who wrote and about what. No message
       * BODY here: a notification row is readable by its recipient, but it also travels
       * into a push payload and a preview of somebody's words does not need to live in
       * two places to be delivered once.
       */
      metadata: {
        conversation_id: convId,
        sender_id: sender.id,
        property_id: property_id || propertyContext || null,
        kind: plan.kind === 'PROPERTY_OFFER' ? 'PROPERTY_OFFER' : 'NEW_MESSAGE',
        message_kind: request.kind,
      },
    });

    /* The one transactional email for a property offer: first message only (the
       first_contact flag was set above, so never twice), and only when the member has
       email notifications on. Logged in notification_deliveries either way. */
    if (plan.sendEmail) {
      const rtl = recipientLang === 'ar' || recipientLang === 'he';
      const content = renderNotificationEmail({
        rtl, lang: recipientLang,
        title: chatString('pc_email_offer_heading', recipientLang),
        body: chatString('pc_email_offer_body', recipientLang),
        whyLabel: '', why: '', analysisLabel: '', analysis: null, nextLabel: '', next: null,
        ctaLabel: chatString('pc_email_offer_cta', recipientLang),
        ctaUrl: `${APP_URL}/chat?conversation=${convId}`,
        footer: chatString('pc_email_offer_footer', recipientLang),
      });
      await sendNotificationEmail(supabase, {
        userId: recipient_id, notificationId, eventKey: `property_offer:${convId}`, source: 'property_chat',
        content: { ...content, subject: chatString('pc_email_offer_subject', recipientLang) },
      }).catch((err) => console.error('send-message offer email failed', err));
    }

    return new Response(JSON.stringify({ message: { ...message, status: 'DELIVERED', delivered_at: now }, conversation_id: convId, first_contact: isFirstContact }), { headers: corsHeaders });
  } catch (err) {
    console.error('send-message error', err);
    return new Response(JSON.stringify({ error: 'Unable to send message' }), { status: 500, headers: corsHeaders });
  }
});
