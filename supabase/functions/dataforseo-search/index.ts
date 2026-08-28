// ============================================================
// HOMATCH — dataforseo-search Edge Function
// Accepts a QueryPack, runs batch search via DataForSEO,
// stores RawSignals (search results as text snippets).
// One QueryPack → one search run → many RawSignals.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { DataForSEOProvider } from '../_shared/providers.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const { queryPackId, dryRun = false } = await req.json();

    // Load query pack
    const { data: pack, error: packErr } = await supabase
      .from('query_packs')
      .select('*')
      .eq('id', queryPackId)
      .maybeSingle();

    if (packErr || !pack) {
      return json({ error: 'QueryPack not found', queryPackId }, 404);
    }
    if (!pack.active) {
      return json({ error: 'QueryPack is not active', queryPackId }, 400);
    }

    const queries: string[] = Array.isArray(pack.queries) ? pack.queries : [];
    if (!queries.length) {
      return json({ error: 'QueryPack has no queries', queryPackId }, 400);
    }

    const provider = new DataForSEOProvider();
    const status = provider.isConfigured() ? 'CONFIGURED' : 'MOCK';

    if (dryRun) {
      return json({ status, queryPackId, queryCount: queries.length, dryRun: true });
    }

    // Run search
    const searchResponse = await provider.search(
      queries.map(q => ({
        q,
        language: pack.language ?? 'en',
        country: pack.country,
      }))
    );

    // Ensure source registry entry exists for search
    const sourceKey = `GOOGLE_SEARCH_${pack.country}_${pack.language}`;
    const { data: existingSource } = await supabase
      .from('source_registry')
      .select('id')
      .eq('external_id', sourceKey)
      .maybeSingle();

    let sourceId: string | null = existingSource?.id ?? null;
    if (!sourceId) {
      const { data: newSource } = await supabase
        .from('source_registry')
        .insert({
          platform: 'GOOGLE',
          source_type: 'SEARCH_RESULT',
          external_id: sourceKey,
          name: `Google Search: ${pack.country}/${pack.language}`,
          url: 'https://google.com',
          country_code: pack.country,
          language: pack.language,
          provider: 'DATAFORSEO',
        })
        .select('id')
        .maybeSingle();
      sourceId = newSource?.id ?? null;
    }

    // Insert raw signals (deduplicated by URL)
    let inserted = 0;
    let skipped = 0;

    for (const result of searchResponse.results) {
      if (!result.snippet && !result.title) { skipped++; continue; }

      const text = `${result.title}\n${result.snippet}`.trim();
      const fingerprint = await contentFingerprint(text);

      const { error: insertErr } = await supabase
        .from('raw_signals')
        .insert({
          source_id: sourceId,
          platform: 'GOOGLE',
          external_id: result.url,
          source_url: result.url,
          original_text: text,
          language: pack.language,
          published_at: result.publishedAt ?? null,
          content_fingerprint: fingerprint,
          provider: searchResponse.provider,
          classification_status: 'PENDING',
        })
        .select('id');

      if (insertErr?.code === '23505') {
        skipped++; // duplicate by unique(platform, external_id)
      } else if (!insertErr) {
        inserted++;
      }
    }

    // Track COGS
    await supabase.from('cost_events').insert({
      provider: 'DATAFORSEO',
      operation_type: 'SERP_SEARCH',
      source: `query_pack:${queryPackId}`,
      market: pack.country,
      units: queries.length,
      cost_usd: searchResponse.costUsd,
      success: true,
      cache_hit: searchResponse.cacheHit,
    });

    // Update query pack last_run_at
    await supabase
      .from('query_packs')
      .update({ last_run_at: new Date().toISOString() })
      .eq('id', queryPackId);

    return json({
      success: true,
      status,
      queryPackId,
      resultsFound: searchResponse.results.length,
      signalsInserted: inserted,
      signalsSkipped: skipped,
      costUsd: searchResponse.costUsd,
      provider: searchResponse.provider,
    });
  } catch (err) {
    console.error('dataforseo-search error:', err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

async function contentFingerprint(text: string): Promise<string> {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim().substring(0, 200);
  const data = new TextEncoder().encode(normalized);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .slice(0, 8)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
