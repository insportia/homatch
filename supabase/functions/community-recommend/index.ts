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

    const { data: profileRow } = await supabase.from('users').select('id,plan').eq('auth_id', user.id).maybeSingle();
    if (!profileRow) return new Response(JSON.stringify({ error: 'User profile not found' }), { status: 404, headers: corsHeaders });
    const ownerId = profileRow.id;
    const plan = profileRow.plan ?? 'FREE';

    // Freemium gate: free plan sees a capped number of communities per
    // property; PLUS/PRO see the full ranked list. This is enforced here
    // (server-side) rather than trusting a client-supplied limit.
    const FREE_COMMUNITY_LIMIT = 7;
    const PAID_COMMUNITY_LIMIT = 100;
    const maxAllowed = plan === 'FREE' ? FREE_COMMUNITY_LIMIT : PAID_COMMUNITY_LIMIT;

    const { property_id } = await req.json();
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

    // Fetch property details. Location/price/language live on property_facts,
    // not on properties itself (properties only holds transaction_type/
    // property_type + status columns) — a prior version of this query
    // selected country/city/price directly off properties, which don't exist
    // there and would have made every call 404.
    const { data: propertyRow } = await supabase.from('properties')
      .select('id,transaction_type,property_type,property_facts(country,city,total_price,source_language,features)')
      .eq('id', property_id).maybeSingle();
    if (!propertyRow) return new Response(JSON.stringify({ error: 'Property not found' }), { status: 404, headers: corsHeaders });
    const facts = (propertyRow as { property_facts?: { country?: string | null; city?: string | null; total_price?: number | null; source_language?: string | null; features?: string[] | null } | null }).property_facts ?? null;
    const property = {
      id: propertyRow.id,
      transaction_type: propertyRow.transaction_type,
      property_type: propertyRow.property_type,
      country: facts?.country ?? null,
      city: facts?.city ?? null,
      price: facts?.total_price ?? null,
      language: facts?.source_language ?? null,
      tags: facts?.features ?? [],
    };

    // Verify ownership
    const { data: ownership } = await supabase.from('properties')
      .select('user_id').eq('id', property_id).eq('user_id', ownerId).maybeSingle();
    if (!ownership) return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: corsHeaders });

    // Load internal community index
    const { data: communities } = await supabase.from('community_directory')
      .select('id,platform,canonical_id,canonical_url,name,language,country,city,tags,topics,member_count,posting_policy,posting_allowed,allows_auto_post,housing_focus')
      .eq('is_active', true)
      .order('member_count', { ascending: false })
      .limit(500);

    const communityById = new Map((communities ?? []).map((c) => [c.id, c]));
    const rankedAll = rankCommunities(communities ?? [], property);
    const rankedTotal = rankedAll.length;
    const rankedSlice = rankedAll.slice(0, maxAllowed);
    const lockedCount = Math.max(0, rankedTotal - rankedSlice.length);

    // Upsert recommendations (only for the communities actually shown to this user)
    if (rankedSlice.length > 0) {
      const upsertRows = rankedSlice.map((r) => ({
        property_id,
        community_id: r.community_id,
        owner_id: ownerId,
        score: r.score,
        rationale: r.rationale,
        status: 'PENDING',
        updated_at: new Date().toISOString(),
      }));
      await supabase.from('property_community_recommendations')
        .upsert(upsertRows, { onConflict: 'property_id,community_id', ignoreDuplicates: false });
    }

    // Enrich each ranked result with the community's own details so the
    // frontend doesn't need a second round-trip.
    const ranked = rankedSlice.map((r) => ({
      ...r,
      community: communityById.get(r.community_id) ?? null,
    }));

    return new Response(JSON.stringify({
      ranked,
      total: ranked.length,
      ranked_total: rankedTotal,
      locked_count: lockedCount,
      plan,
      free_limit: FREE_COMMUNITY_LIMIT,
      source: 'internal_index',
      external_disabled: !discoveryEnabled,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[community-recommend] error:', err);
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: corsHeaders });
  }
});
