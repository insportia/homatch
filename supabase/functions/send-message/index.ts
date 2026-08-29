// send-message Edge Function
// POST { conversation_id?, property_id?, recipient_id, body }
import { createClient } from 'jsr:@supabase/supabase-js@2';

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

    const { data: sender } = await supabase.from('users').select('id').eq('auth_id', user.id).maybeSingle();
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

    const now = new Date().toISOString();
    const { data: message, error: msgErr } = await supabase.from('messages').insert({
      conversation_id: convId, sender_id: sender.id, body: body.trim(), status: 'SENT',
    }).select('*').single();
    if (msgErr) throw msgErr;

    await supabase.from('conversations').update({ last_message_at: now, ...(isFirstContact ? { first_contact_email_sent: true } : {}) }).eq('id', convId);
    await supabase.from('message_receipts').upsert({ message_id: message.id, user_id: recipient_id, status: 'DELIVERED' }, { onConflict: 'message_id,user_id' });
    await supabase.from('messages').update({ status: 'DELIVERED', delivered_at: now }).eq('id', message.id);

    if (isFirstContact) {
      await supabase.from('notifications').insert({
        user_id: recipient_id, type: 'MATCH_FOUND', title: 'New message', body: 'You have a new message from a Homatch user.', read: false,
        property_id: property_id || null, metadata: { conversation_id: convId, sender_id: sender.id, kind: 'NEW_MESSAGE' },
      });
    }

    return new Response(JSON.stringify({ message: { ...message, status: 'DELIVERED', delivered_at: now }, conversation_id: convId, first_contact: isFirstContact }), { headers: corsHeaders });
  } catch (err) {
    console.error('send-message error', err);
    return new Response(JSON.stringify({ error: 'Unable to send message' }), { status: 500, headers: corsHeaders });
  }
});
