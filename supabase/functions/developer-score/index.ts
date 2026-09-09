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

    // Counts derived from the project rows we actually hold. developer_profiles
    // also carries completed_projects/active_projects columns, but nothing
    // maintains them, so they sit at their default of 0 — the response used to
    // score a developer off these derived counts while displaying the stale
    // columns, which is how a profile could show "75 / 100" beside
    // "0 completed projects".
    const projects = (dev.developer_projects ?? []) as Array<{ status: string; commissioned: boolean }>;
    const completedCount = projects.filter((p) => p.status === 'COMPLETED').length;
    const activeCount = projects.filter((p) => p.status === 'ACTIVE' || p.status === 'UNDER_CONSTRUCTION').length;
    const commissionedCount = projects.filter((p) => p.commissioned).length;
    const riskCount = (dev.public_risk_evidence as unknown[])?.length ?? 0;
    const hasRestrictions = !!(dev.restrictions && Object.keys(dev.restrictions as Record<string, unknown>).length);
    const hasPermits = !!(dev.permits && Object.keys(dev.permits as Record<string, unknown>).length);

    // NO EVIDENCE = NO SCORE.
    //
    // The old formula started every developer at 50 and adjusted from there, so
    // a company we hold nothing at all about scored 50/100 — which a buyer
    // reads as "averagely trustworthy" when the truth is "we have not assessed
    // this developer". That is a fabricated signal about a real company, and
    // it is the one thing this table must never produce. developer_profiles.score
    // is nullable precisely so that "unassessed" can be said out loud.
    const hasAnyEvidence = projects.length > 0 || riskCount > 0 || hasRestrictions || hasPermits;

    let score: number | null = dev.score ?? null;
    let breakdown = dev.score_breakdown ?? {};

    if (isStale) {
      if (!hasAnyEvidence) {
        score = null;
        breakdown = { assessed: false, reason: 'NO_EVIDENCE', computed_at: new Date().toISOString() };
      } else {
        let s = 50;
        s += Math.min(completedCount * 5, 25); // up to +25 for completed projects
        s += Math.min(commissionedCount * 3, 15); // up to +15 for commissioned
        s -= Math.min(riskCount * 10, 30); // up to -30 for risk evidence
        if (hasRestrictions) s -= 10;
        score = Math.max(0, Math.min(100, s));
        breakdown = {
          assessed: true,
          completed_projects: completedCount,
          active_projects: activeCount,
          commissioned: commissionedCount,
          risk_evidence_count: riskCount,
          has_restrictions: hasRestrictions,
          computed_at: new Date().toISOString(),
        };
      }

      // The refresh failing used to be swallowed, and the freshly computed
      // score returned anyway — so the customer saw a number that was not in
      // the database, and last_checked_at never moved, making every subsequent
      // request recompute and report stale forever.
      const { error: refreshErr } = await supabase.from('developer_profiles').update({
        score,
        score_breakdown: breakdown,
        last_checked_at: new Date().toISOString(),
      }).eq('id', developer_id);

      if (refreshErr) {
        console.error('[developer-score] score refresh failed:', refreshErr.message);
        // Fall back to what is actually stored rather than inventing freshness.
        score = dev.score ?? null;
        breakdown = dev.score_breakdown ?? {};
      }
    }

    return new Response(JSON.stringify({
      id: dev.id,
      name: dev.name,
      slug: dev.slug,
      country: dev.country,
      city: dev.city,
      website: dev.website,
      description: dev.description,
      score,
      score_breakdown: breakdown,
      // null, not 0 — "we have not assessed this developer" is a different
      // statement from "this developer scored zero", and the UI must be able
      // to tell them apart.
      assessed: score !== null,
      completed_projects: completedCount,
      active_projects: activeCount,
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
