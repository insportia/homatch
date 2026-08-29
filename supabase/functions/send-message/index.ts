// send-message Edge Function
// POST { conversation_id?, property_id, recipient_id, body }
// Creates conversation if needed, inserts message, handles first-contact email flag
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Verify JWT and get user
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    // Get Homatch user
    const { data: sender } = await supabase.from('users').select('id').eq('auth_id', user.id).maybeSingle();
    if (!sender) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: corsHeaders });

    const { conversation_id, property_id, recipient_id, body } = await req.json();
    if (!body?.trim()) return new Response(JSON.stringify({ error: 'Message body required' }), { status: 400, headers: corsHeaders });
    if (!recipient_id) return new Response(JSON.stringify({ error: 'recipient_id required' }), { status: 400, headers: corsHeaders });

    // Ensure recipient is not blocking sender
    const { data: block } = await supabase.from('conversation_blocks')
      .select('id').eq('blocker_id', recipient_id).eq('blocked_id', sender.id).maybeSingle();
    if (block) return new Response(JSON.stringify({ error: 'Cannot send message' }), { status: 403, headers: corsHeaders });

    // Get or create conversation
    let convId = conversation_id;
    let isFirstContact = false;

    if (!convId) {
      // Look for existing conversation between these users for this property
      const query = supabase.from('conversations')
        .select('id, first_contact_email_sent')
        .or(`and(initiator_id.eq.${sender.id},recipient_id.eq.${recipient_id}),and(initiator_id.eq.${recipient_id},recipient_id.eq.${sender.id})`);

      if (property_id) query.eq('property_id', property_id);

      const { data: existing } = await query.maybeSingle();

      if (existing) {
        convId = existing.id;
        isFirstContact = !existing.first_contact_email_sent;
      } else {
        const { data: newConv, error: convErr } = await supabase.from('conversations').insert({
          initiator_id: sender.id,
          recipient_id,
          property_id: property_id || null,
          status: 'ACTIVE',
        }).select('id').single();
        if (convErr) throw convErr;
        convId = newConv.id;
        isFirstContact = true;
      }
    }

    // Insert message
    const { data: message, error: msgErr } = await supabase.from('messages').insert({
      conversation_id: convId,
      sender_id: sender.id,
      body: body.trim(),
      status: 'SENT',
    }).select('*').single();
    if (msgErr) throw msgErr;

    // Update conversation last_message_at
    await supabase.from('conversations').update({
      last_message_at: new Date().toISOString(),
      ...(isFirstContact ? { first_contact_email_sent: true } : {}),
    }).eq('id', convId);

    // Insert message receipt for recipient
    await supabase.from('message_receipts').upsert({
      message_id: message.id,
      user_id: recipient_id,
      status: 'DELIVERED',
    }, { onConflict: 'message_id,user_id' });

    // Update message status to DELIVERED
    await supabase.from('messages').update({ status: 'DELIVERED', delivered_at: new Date().toISOString() }).eq('id', message.id);

    // First contact: create in-app notification
    if (isFirstContact) {
      await supabase.from('notifications').insert({
        user_id: recipient_id,
        type: 'MATCH_AVAILABLE',
        title: 'New message',
        body: 'You have a new message from a Homatch user.',
        is_read: false,
      }).catch(() => {}); // non-fatal
    }

    return new Response(JSON.stringify({ message, conversation_id: convId, first_contact: isFirstContact }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
