// send-message Edge Function
// POST { conversation_id?, property_id?, recipient_id, body }
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { notify } from '../_shared/notify.ts';
import { recordIntent } from '../_shared/intent.ts';
import {
  attributionOf, readingsOf,
} from '../../../src/research-core/intent/interpret.ts';

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

    const { conversation_id, property_id, recipient_id, body } = await req.json();
    if (!body?.trim()) return new Response(JSON.stringify({ error: 'Message body required' }), { status: 400, headers: corsHeaders });
    if (!recipient_id || recipient_id === sender.id) return new Response(JSON.stringify({ error: 'Valid recipient_id required' }), { status: 400, headers: corsHeaders });

    const { data: recipient } = await supabase.from('users').select('id').eq('id', recipient_id).maybeSingle();
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
      let query = supabase.from('conversations').select('id,first_contact_email_sent')
        .or(`and(initiator_id.eq.${sender.id},recipient_id.eq.${recipient_id}),and(initiator_id.eq.${recipient_id},recipient_id.eq.${sender.id})`);
      query = property_id ? query.eq('property_id', property_id) : query.is('property_id', null);
      const { data: existing } = await query.limit(1).maybeSingle();
      if (existing) {
        convId = existing.id;
        isFirstContact = !existing.first_contact_email_sent;
      } else {
        const { data: newConv, error: convErr } = await supabase.from('conversations').insert({
          initiator_id: sender.id, recipient_id, property_id: property_id || null, status: 'ACTIVE',
        }).select('id').single();
        if (convErr) throw convErr;
        convId = newConv.id;
        isFirstContact = true;
      }
    }

    /*
     * WHICH PROPERTY THIS CONVERSATION IS ABOUT, read once.
     *
     * From the conversation rather than from the request: a caller supplying a
     * property_id for a conversation that is about a different property would otherwise
     * be attaching somebody's words to a listing they never mentioned.
     */
    const { data: conversationRow } = await supabase
      .from('conversations').select('property_id').eq('id', convId).maybeSingle();
    const propertyContext = (conversationRow?.property_id as string | null) ?? null;

    const now = new Date().toISOString();
    const { data: message, error: msgErr } = await supabase.from('messages').insert({
      conversation_id: convId, sender_id: sender.id, body: body.trim(), status: 'SENT',
    }).select('*').single();
    if (msgErr) throw msgErr;

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
    if (propertyContext) {
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
    }

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
    await notify(supabase, {
      userId: recipient_id,
      type: 'NEW_MESSAGE',
      title: 'New message',
      body: 'You have a new message from a Homatch user.',
      priority: 'HIGH',
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
        property_id: property_id || null,
        kind: 'NEW_MESSAGE',
      },
    });

    return new Response(JSON.stringify({ message: { ...message, status: 'DELIVERED', delivered_at: now }, conversation_id: convId, first_contact: isFirstContact }), { headers: corsHeaders });
  } catch (err) {
    console.error('send-message error', err);
    return new Response(JSON.stringify({ error: 'Unable to send message' }), { status: 500, headers: corsHeaders });
  }
});
