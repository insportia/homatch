// admin-user360 Edge Function
// SUPER_ADMIN: search users, inspect full profile, properties, campaigns,
// contact lists, AI usage, wallet, cost events.
// Server-authorized RBAC — no RLS bypass on client.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

type AdminRole = 'SUPER_ADMIN' | 'SUPPORT_ADMIN' | 'BILLING_ADMIN' | 'READ_ONLY';
const ALLOWED_ROLES: AdminRole[] = ['SUPER_ADMIN', 'SUPPORT_ADMIN', 'BILLING_ADMIN', 'READ_ONLY'];
const SENSITIVE_OPS = ['export_contacts', 'delete_list', 'export_campaign', 'impersonate'];

async function verifyAdminRole(supabase: ReturnType<typeof createClient>, userId: string, minRole?: AdminRole[]): Promise<{ ok: boolean; roles: AdminRole[] }> {
  const { data } = await supabase.from('admin_roles')
    .select('role').eq('user_id', userId).is('revoked_at', null);
  const roles = (data ?? []).map((r: { role: AdminRole }) => r.role).filter((r: AdminRole) => ALLOWED_ROLES.includes(r));
  const ok = minRole ? minRole.some((r) => roles.includes(r)) : roles.length > 0;
  return { ok, roles };
}

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

    const { ok: isAdmin, roles } = await verifyAdminRole(serviceClient, user.id);
    if (!isAdmin) return new Response(JSON.stringify({ error: 'Forbidden: admin role required' }), { status: 403, headers: corsHeaders });

    const url = new URL(req.url);
    const action = url.searchParams.get('action') ?? (req.method === 'POST' ? (await req.clone().json().then((b: { action?: string }) => b.action).catch(() => '')) : '');
    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};

    // Audit sensitive ops
    if (SENSITIVE_OPS.includes(action)) {
      const isSuperOrSupport = roles.includes('SUPER_ADMIN') || roles.includes('SUPPORT_ADMIN');
      if (!isSuperOrSupport) return new Response(JSON.stringify({ error: 'Forbidden: SUPER_ADMIN or SUPPORT_ADMIN required for this action' }), { status: 403, headers: corsHeaders });

      await serviceClient.rpc('log_admin_audit', {
        p_admin_id: user.id,
        p_target_id: body.target_user_id ?? null,
        p_action: action,
        p_entity_type: body.entity_type ?? null,
        p_entity_id: body.entity_id ?? null,
        p_metadata: { roles, action, ...body },
      });
    }

    // ── search_users ──────────────────────────────────────────
    if (action === 'search_users') {
      const q = String(body.query ?? '').trim();
      const { data: users } = await serviceClient.from('users')
        .select('id,auth_id,email,full_name,avatar_url,is_admin,created_at')
        .or(`email.ilike.%${q}%,full_name.ilike.%${q}%`)
        .order('created_at', { ascending: false }).limit(50);
      return new Response(JSON.stringify({ users: users ?? [] }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── user360 ───────────────────────────────────────────────
    if (action === 'user360') {
      const { target_user_id } = body;
      if (!target_user_id) return new Response(JSON.stringify({ error: 'target_user_id required' }), { status: 400, headers: corsHeaders });

      const [userRes, propertiesRes, campaignsRes, listsRes, creditRes, aiRes, costRes] = await Promise.all([
        serviceClient.from('users').select('*').eq('id', target_user_id).maybeSingle(),
        serviceClient.from('properties').select('id,title,property_type,transaction_type,status,created_at').eq('owner_id', target_user_id).order('created_at', { ascending: false }).limit(20),
        serviceClient.from('outreach_campaigns').select('id,name,campaign_type,status,created_at,audience_count,cost_estimate_usd').eq('owner_id', target_user_id).order('created_at', { ascending: false }).limit(20),
        serviceClient.from('contact_lists').select('id,name,import_status,total_rows,valid_rows,created_at').eq('owner_id', target_user_id).order('created_at', { ascending: false }).limit(20),
        serviceClient.from('credit_accounts').select('balance,lifetime_purchased,lifetime_spent').eq('user_id', target_user_id).maybeSingle(),
        serviceClient.from('ai_conversations').select('id,created_at').eq('user_id', target_user_id).order('created_at', { ascending: false }).limit(5),
        serviceClient.from('cost_events').select('event_type,amount_usd,created_at').eq('user_id', target_user_id).order('created_at', { ascending: false }).limit(20),
      ]);

      return new Response(JSON.stringify({
        user: userRes.data,
        properties: propertiesRes.data ?? [],
        campaigns: campaignsRes.data ?? [],
        contact_lists: listsRes.data ?? [],
        credits: creditRes.data,
        ai_conversations: aiRes.data ?? [],
        recent_cost_events: costRes.data ?? [],
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: 'Unknown action', available_actions: ['search_users','user360','export_contacts','delete_list','export_campaign'] }), {
      status: 400, headers: corsHeaders,
    });
  } catch (err) {
    console.error('[admin-user360] error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
