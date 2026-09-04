// community-recommend Edge Function
// Ranks internal community index for a given property.
// External discovery is DISABLED (community_discovery_enabled=false).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Inlined from ../_shared/community_adapter.ts rather than imported: multi-file
// deploys with a _shared/ import have repeatedly produced broken bundled
// entrypoints in this sandbox's deploy tool (same issue documented in
// outreach-unsubscribe/index.ts). Keep this in sync with
// _shared/community_adapter.ts's rankCommunities if either changes.
interface CommunityRecordForRanking {
  country?: string | null;
  city?: string | null;
  language?: string | null;
  tags?: string[] | null;
  topics?: string[] | null;
  member_count?: number | null;
  posting_policy?: string | null;
  housing_focus?: 'primary' | 'secondary' | null;
}
interface CommunityRanking {
  community_id: string;
  score: number;
  rationale: {
    location_match: number;
    type_match: number;
    language_match: number;
    audience_match: number;
    topic_match: number;
    activity_score: number;
    summary: string;
  };
}
function rankCommunities(
  communities: Array<{ id: string } & CommunityRecordForRanking>,
  property: {
    country?: string | null;
    city?: string | null;
    language?: string | null;
    transaction_type?: string | null;
    property_type?: string | null;
    price?: number | null;
    tags?: string[];
  }
): CommunityRanking[] {
  return communities.map((c) => {
    const locationMatch =
      (c.country && property.country && c.country.toLowerCase() === property.country.toLowerCase() ? 0.5 : 0) +
      (c.city && property.city && c.city.toLowerCase() === property.city.toLowerCase() ? 0.5 : 0);

    const langMatch = c.language && property.language && c.language.split('-')[0] === property.language.split('-')[0] ? 1 : 0.3;

    const propTopics = (property.tags ?? []).map((t) => t.toLowerCase());
    const commTopics = (c.topics ?? []).concat(c.tags ?? []).map((t) => t.toLowerCase());
    const topicMatch = propTopics.length && commTopics.length
      ? propTopics.filter((t) => commTopics.includes(t)).length / Math.max(propTopics.length, 1)
      : 0.2;

    // Dedicated real-estate communities score highest; general expat/classifieds
    // communities (housing_focus='secondary') are still surfaced — per user
    // request they should not be excluded — but rank lower than a dedicated
    // group when one exists for the same location/language.
    const audienceMatch = c.housing_focus === 'secondary'
      ? 0.35
      : (c.topics ?? []).some((t) => ['investor','investment','real estate','property'].some((k) => t.toLowerCase().includes(k))) ? 0.8 : 0.4;

    const activityScore = c.member_count
      ? Math.min(c.member_count / 50000, 1) * 0.7 + 0.3
      : 0.3;

    const typeMatch = c.posting_policy === 'OPEN' ? 1.0 : c.posting_policy === 'APPROVAL_REQUIRED' ? 0.6 : 0.2;

    const score = parseFloat((
      locationMatch * 0.30 +
      langMatch * 0.20 +
      topicMatch * 0.20 +
      audienceMatch * 0.15 +
      activityScore * 0.10 +
      typeMatch * 0.05
    ).toFixed(2));

    return {
      community_id: c.id,
      score: Math.min(score, 1.0),
      rationale: {
        location_match: parseFloat(locationMatch.toFixed(2)),
        type_match: parseFloat(typeMatch.toFixed(2)),
        language_match: parseFloat(langMatch.toFixed(2)),
        audience_match: parseFloat(audienceMatch.toFixed(2)),
        topic_match: parseFloat(topicMatch.toFixed(2)),
        activity_score: parseFloat(activityScore.toFixed(2)),
        summary: `loc=${(locationMatch * 100).toFixed(0)}% lang=${(langMatch * 100).toFixed(0)}% topic=${(topicMatch * 100).toFixed(0)}%`,
      },
    };
  }).sort((a, b) => b.score - a.score);
}

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
        // NOTE: owner_id references auth.users(id), not public.users(id) —
        // `ownerId` above is the public.users profile row id (a different
        // UUID for the same person). Using it here always violated the FK
        // and the upsert result was never checked, so every recommendation
        // silently failed to persist (0 rows ever landed in this table).
        // The real auth user id is `user.id` from the JWT.
        owner_id: user.id,
        score: r.score,
        rationale: r.rationale,
        status: 'PENDING',
        updated_at: new Date().toISOString(),
      }));
      const { error: upsertErr } = await supabase.from('property_community_recommendations')
        .upsert(upsertRows, { onConflict: 'property_id,community_id', ignoreDuplicates: false });
      if (upsertErr) console.error('[community-recommend] failed to persist recommendations:', upsertErr);
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
