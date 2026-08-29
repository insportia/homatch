// viewing-request Edge Function
// POST { action, ...payload }
// actions: create | accept | decline | propose_reschedule | cancel | complete
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

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const { data: actor } = await supabase.from('users').select('id').eq('auth_id', user.id).maybeSingle();
    if (!actor) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: corsHeaders });

    const body = await req.json();
    const { action } = body;

    // ── CREATE ─────────────────────────────────────────────────
    if (action === 'create') {
      const { property_id, preferred_date, preferred_time, note } = body;
      if (!property_id || !preferred_date) return new Response(JSON.stringify({ error: 'property_id and preferred_date required' }), { status: 400, headers: corsHeaders });

      // Get property owner
      const { data: prop } = await supabase.from('properties').select('user_id').eq('id', property_id).maybeSingle();
      if (!prop) return new Response(JSON.stringify({ error: 'Property not found' }), { status: 404, headers: corsHeaders });
      if (prop.user_id === actor.id) return new Response(JSON.stringify({ error: 'Cannot request viewing of own property' }), { status: 400, headers: corsHeaders });

      const { data: vr, error: vrErr } = await supabase.from('viewing_requests').insert({
        property_id,
        requester_id: actor.id,
        owner_id: prop.user_id,
        preferred_date,
        preferred_time: preferred_time || null,
        note: note || null,
        status: 'PENDING',
      }).select('*').single();
      if (vrErr) throw vrErr;

      // Notify owner with correct type and durable nav link
      await supabase.from('notifications').insert({
        user_id:     prop.user_id,
        type:        'VIEWING_REQUEST',
        title:       'Viewing request',
        body:        'A buyer/renter has requested a viewing of your property.',
        read:        false,
        entity_type: 'viewing_request',
        entity_id:   vr.id,
        nav_path:    `/viewings`,
        metadata:    { viewing_request_id: vr.id, property_id },
      }).catch(() => {});

      return new Response(JSON.stringify({ viewing_request: vr }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── STATE TRANSITIONS ──────────────────────────────────────
    const { viewing_request_id } = body;
    if (!viewing_request_id) return new Response(JSON.stringify({ error: 'viewing_request_id required' }), { status: 400, headers: corsHeaders });

    const { data: vr } = await supabase.from('viewing_requests').select('*').eq('id', viewing_request_id).maybeSingle();
    if (!vr) return new Response(JSON.stringify({ error: 'Viewing request not found' }), { status: 404, headers: corsHeaders });

    const isRequester = vr.requester_id === actor.id;
    const isOwner = vr.owner_id === actor.id;
    if (!isRequester && !isOwner) return new Response(JSON.stringify({ error: 'Not authorized' }), { status: 403, headers: corsHeaders });

    const transitions: Record<string, { allowed_from: string[]; new_status: string; actor_check: 'owner' | 'requester' | 'both' }> = {
      accept:             { allowed_from: ['PENDING', 'RESCHEDULE_PROPOSED'], new_status: 'ACCEPTED',            actor_check: 'owner' },
      decline:            { allowed_from: ['PENDING', 'RESCHEDULE_PROPOSED'], new_status: 'DECLINED',            actor_check: 'owner' },
      propose_reschedule: { allowed_from: ['PENDING'],                        new_status: 'RESCHEDULE_PROPOSED', actor_check: 'owner' },
      cancel:             { allowed_from: ['PENDING','ACCEPTED','RESCHEDULE_PROPOSED'], new_status: 'CANCELLED', actor_check: 'both' },
      complete:           { allowed_from: ['ACCEPTED'],                       new_status: 'COMPLETED',           actor_check: 'both' },
    };

    const t = transitions[action];
    if (!t) return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: corsHeaders });
    if (!t.allowed_from.includes(vr.status)) return new Response(JSON.stringify({ error: `Cannot ${action} from status ${vr.status}` }), { status: 400, headers: corsHeaders });
    if (t.actor_check === 'owner' && !isOwner) return new Response(JSON.stringify({ error: 'Only property owner can perform this action' }), { status: 403, headers: corsHeaders });
    if (t.actor_check === 'requester' && !isRequester) return new Response(JSON.stringify({ error: 'Only requester can perform this action' }), { status: 403, headers: corsHeaders });

    const updates: Record<string, unknown> = { status: t.new_status };
    if (action === 'propose_reschedule') {
      updates.proposed_date = body.proposed_date;
      updates.proposed_time = body.proposed_time || null;
      updates.propose_note = body.propose_note || null;
    }
    if (action === 'complete') {
      updates.completed_by = actor.id;
      updates.completed_at = new Date().toISOString();
    }

    const { data: updated, error: updErr } = await supabase.from('viewing_requests')
      .update(updates).eq('id', viewing_request_id).select('*').single();
    if (updErr) throw updErr;

    // Notify the other party with correct type and durable nav link
    const notifyUserId = isOwner ? vr.requester_id : vr.owner_id;
    const notifTypeMap: Record<string, string> = {
      accept:             'VIEWING_ACCEPTED',
      decline:            'VIEWING_DECLINED',
      propose_reschedule: 'VIEWING_REQUEST',
      cancel:             'VIEWING_CANCELLED',
      complete:           'VIEWING_COMPLETED',
    };
    const actionLabels: Record<string, string> = {
      accept:             'Viewing accepted',
      decline:            'Viewing declined',
      propose_reschedule: 'Reschedule proposed',
      cancel:             'Viewing cancelled',
      complete:           'Viewing completed',
    };
    await supabase.from('notifications').insert({
      user_id:     notifyUserId,
      type:        notifTypeMap[action] ?? 'VIEWING_REQUEST',
      title:       actionLabels[action] ?? 'Viewing update',
      body:        `Your viewing request status changed to ${t.new_status}.`,
      read:        false,
      entity_type: 'viewing_request',
      entity_id:   viewing_request_id,
      nav_path:    `/viewings`,
      metadata:    { viewing_request_id, new_status: t.new_status },
    }).catch(() => {});

    return new Response(JSON.stringify({ viewing_request: updated }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
