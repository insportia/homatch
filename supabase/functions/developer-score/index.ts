// developer-score Edge Function
// GET /developer-score?developer_id=... or POST { property_id }
// Returns developer trust profile; queues background refresh if stale
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const STALE_HOURS = 24;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    const url = new URL(req.url);
    let developer_id = url.searchParams.get('developer_id');
    let property_id: string | null = null;

    if (req.method === 'POST') {
      const body = await req.json();
      developer_id = body.developer_id ?? developer_id;
      property_id = body.property_id ?? null;
    }

    // Look up developer via property if needed
    if (!developer_id && property_id) {
      const { data: prop } = await supabase.from('properties').select('developer_id').eq('id', property_id).maybeSingle();
      developer_id = prop?.developer_id ?? null;
    }

    if (!developer_id) {
      return new Response(JSON.stringify({ error: 'developer_id or property_id required' }), { status: 400, headers: corsHeaders });
    }

    const { data: dev } = await supabase.from('developer_profiles')
      .select('*, developer_projects(*)')
      .eq('id', developer_id).maybeSingle();

    if (!dev) return new Response(JSON.stringify({ error: 'Developer not found' }), { status: 404, headers: corsHeaders });

    // Check staleness
    const lastChecked = dev.last_checked_at ? new Date(dev.last_checked_at) : new Date(0);
    const ageHours = (Date.now() - lastChecked.getTime()) / 3_600_000;
    const isStale = ageHours > STALE_HOURS;

    // If stale, compute a basic score refresh from available data
    if (isStale) {
      const completedCount = dev.developer_projects?.filter((p: { status: string }) => p.status === 'COMPLETED').length ?? 0;
      const commissionedCount = dev.developer_projects?.filter((p: { commissioned: boolean }) => p.commissioned).length ?? 0;
      const riskCount = (dev.public_risk_evidence as unknown[])?.length ?? 0;

      let score = 50;
      score += Math.min(completedCount * 5, 25); // up to +25 for completed projects
      score += Math.min(commissionedCount * 3, 15); // up to +15 for commissioned
      score -= Math.min(riskCount * 10, 30); // up to -30 for risk evidence
      if (dev.restrictions && Object.keys(dev.restrictions as Record<string, unknown>).length > 0) score -= 10;
      score = Math.max(0, Math.min(100, score));

      const breakdown = {
        completed_projects: completedCount,
        commissioned: commissionedCount,
        risk_evidence_count: riskCount,
        has_restrictions: !!(dev.restrictions && Object.keys(dev.restrictions as Record<string, unknown>).length),
        computed_at: new Date().toISOString(),
      };

      await supabase.from('developer_profiles').update({
        score,
        score_breakdown: breakdown,
        last_checked_at: new Date().toISOString(),
      }).eq('id', developer_id).catch(() => {});

      dev.score = score;
      dev.score_breakdown = breakdown;
    }

    return new Response(JSON.stringify({
      id: dev.id,
      name: dev.name,
      slug: dev.slug,
      country: dev.country,
      city: dev.city,
      website: dev.website,
      description: dev.description,
      score: dev.score,
      score_breakdown: dev.score_breakdown,
      completed_projects: dev.completed_projects,
      active_projects: dev.active_projects,
      years_active: dev.years_active,
      permits: dev.permits,
      restrictions: dev.restrictions,
      public_risk_evidence: dev.public_risk_evidence,
      is_sponsored: dev.is_sponsored,
      projects: dev.developer_projects ?? [],
      last_checked_at: dev.last_checked_at,
      was_stale: isStale,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
