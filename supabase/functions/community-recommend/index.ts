// community-recommend Edge Function
// Ranks internal community index for a given property.
// External discovery is DISABLED (community_discovery_enabled=false).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { rankCommunities } from '../_shared/community_adapter.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(
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

    const { property_id, limit = 20 } = await req.json();
    if (!property_id) return new Response(JSON.stringify({ error: 'property_id required' }), { status: 400, headers: corsHeaders });

    // Safety gate
    const { data: flags } = await supabase.from('admin_settings')
      .select('key,value')
      .in('key', ['community_discovery_enabled', 'provider_kill_switch']);
    const flagMap = Object.fromEntries((flags ?? []).map((f: { key: string; value: unknown }) => [f.key, f.value]));
    const discoveryEnabled = flagMap['community_discovery_enabled'] === true || flagMap['community_discovery_enabled'] === 'true';
    const killSwitch = flagMap['provider_kill_switch'] === true || flagMap['provider_kill_switch'] === 'true';
    if (killSwitch) console.log('[community-recommend] Kill switch active — internal index only');
    if (!discoveryEnabled) console.log('[community-recommend] External discovery disabled — internal index only');

    // Fetch property details
    const { data: property } = await supabase.from('properties')
      .select('id,country,city,transaction_type,property_type,price')
      .eq('id', property_id).maybeSingle();
    if (!property) return new Response(JSON.stringify({ error: 'Property not found' }), { status: 404, headers: corsHeaders });

    // Verify ownership
    const { data: ownership } = await supabase.from('properties')
      .select('owner_id').eq('id', property_id).eq('owner_id', user.id).maybeSingle();
    if (!ownership) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders });

    // Load internal community index
    const { data: communities } = await supabase.from('communities')
      .select('id,platform,canonical_id,canonical_url,name,language,country,city,tags,topics,member_count,posting_policy')
      .eq('is_active', true)
      .order('member_count', { ascending: false })
      .limit(500);

    const ranked = rankCommunities(communities ?? [], property).slice(0, limit);

    // Upsert recommendations
    if (ranked.length > 0) {
      const upsertRows = ranked.map((r) => ({
        property_id,
        community_id: r.community_id,
        owner_id: user.id,
        score: r.score,
        rationale: r.rationale,
        status: 'PENDING',
        updated_at: new Date().toISOString(),
      }));
      await supabase.from('community_recommendations')
        .upsert(upsertRows, { onConflict: 'property_id,community_id', ignoreDuplicates: false });
    }

    return new Response(JSON.stringify({ ranked, total: ranked.length, source: 'internal_index', external_disabled: !discoveryEnabled }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[community-recommend] error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
