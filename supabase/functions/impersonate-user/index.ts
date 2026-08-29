// impersonate-user Edge Function
// SUPER_ADMIN / SUPPORT_ADMIN only. Creates a temporary impersonation session.
// Audit log created on start + end. Banner context returned to client.
// Session is server-authorized — never stored in client auth token.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    const { data: { user }, error: authErr } = await createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    ).auth.getUser();
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    // Check SUPER_ADMIN or SUPPORT_ADMIN role
    const { data: roleRows } = await serviceClient.from('admin_roles')
      .select('role').eq('user_id', user.id).is('revoked_at', null)
      .in('role', ['SUPER_ADMIN', 'SUPPORT_ADMIN']);
    if (!roleRows?.length) {
      return new Response(JSON.stringify({ error: 'Forbidden: SUPER_ADMIN or SUPPORT_ADMIN role required' }), { status: 403, headers: corsHeaders });
    }

    // Check impersonation enabled
    const { data: flagRow } = await serviceClient.from('admin_settings')
      .select('value').eq('key', 'admin_impersonation_enabled').maybeSingle();
    const enabled = flagRow?.value === true || flagRow?.value === 'true';
    if (!enabled) return new Response(JSON.stringify({ error: 'Impersonation is disabled' }), { status: 403, headers: corsHeaders });

    const { action, target_user_id, reason, session_id } = await req.json();

    if (action === 'start') {
      if (!target_user_id || !reason?.trim()) {
        return new Response(JSON.stringify({ error: 'target_user_id and reason required' }), { status: 400, headers: corsHeaders });
      }

      // Fetch target user
      const { data: targetUser } = await serviceClient.from('users')
        .select('id,email,full_name').eq('id', target_user_id).maybeSingle();
      if (!targetUser) return new Response(JSON.stringify({ error: 'Target user not found' }), { status: 404, headers: corsHeaders });

      // Create audit event
      const { data: auditRow } = await serviceClient.from('admin_audit_log').insert({
        admin_id: user.id,
        target_id: target_user_id,
        action: 'IMPERSONATION_START',
        entity_type: 'user',
        entity_id: target_user_id,
        metadata: { reason, admin_email: user.email, target_email: targetUser.email },
      }).select('id').maybeSingle();

      // Create impersonation session
      const { data: session } = await serviceClient.from('impersonation_sessions').insert({
        admin_id: user.id,
        target_user_id,
        reason,
        audit_log_id: auditRow?.id,
      }).select('id,started_at').maybeSingle();

      return new Response(JSON.stringify({
        session_id: session?.id,
        target_user: targetUser,
        started_at: session?.started_at,
        banner: {
          message: `ADMIN IMPERSONATION ACTIVE — viewing as ${targetUser.full_name ?? targetUser.email}`,
          admin_email: user.email,
          reason,
        },
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'end') {
      if (!session_id) return new Response(JSON.stringify({ error: 'session_id required' }), { status: 400, headers: corsHeaders });

      const { data: sessionRow } = await serviceClient.from('impersonation_sessions')
        .select('id,target_user_id,admin_id').eq('id', session_id).eq('admin_id', user.id).maybeSingle();
      if (!sessionRow) return new Response(JSON.stringify({ error: 'Session not found or not yours' }), { status: 404, headers: corsHeaders });

      await serviceClient.from('impersonation_sessions')
        .update({ ended_at: new Date().toISOString() }).eq('id', session_id);

      await serviceClient.from('admin_audit_log').insert({
        admin_id: user.id,
        target_id: sessionRow.target_user_id,
        action: 'IMPERSONATION_END',
        entity_type: 'user',
        entity_id: sessionRow.target_user_id,
        metadata: { session_id },
      });

      return new Response(JSON.stringify({ ended: true, session_id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'action must be "start" or "end"' }), { status: 400, headers: corsHeaders });
  } catch (err) {
    console.error('[impersonate-user] error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
