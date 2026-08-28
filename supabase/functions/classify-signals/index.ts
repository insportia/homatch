// ============================================================
// HOMATCH — classify-signals Edge Function
// Picks PENDING raw signals → runs cheap filter → AI classify
// → writes IntentProfile → marks signal CLASSIFIED / FILTERED_OUT
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { OpenAIProvider } from '../_shared/providers.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BUYER_INTENT_TYPES = new Set([
  'BUY', 'RENT', 'INVEST', 'RELOCATE_BUY', 'RELOCATE_RENT',
]);

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const { batchSize = 20, market = 'GE', dryRun = false } = await req.json().catch(() => ({}));

    // Fetch pending signals for this market
    const { data: signals, error: fetchErr } = await supabase
      .from('raw_signals')
      .select(`
        id, original_text, language, platform,
        source:source_registry!source_id(country_code, language)
      `)
      .eq('classification_status', 'PENDING')
      .order('discovered_at', { ascending: true })
      .limit(batchSize);

    if (fetchErr) throw fetchErr;
    if (!signals?.length) {
      return json({ success: true, message: 'No pending signals', processed: 0 });
    }

    const provider = new OpenAIProvider();
    const aiStatus = provider.isConfigured() ? 'CONFIGURED' : 'MOCK';

    if (dryRun) {
      return json({ aiStatus, pendingSignals: signals.length, batchSize, dryRun: true });
    }

    let classified = 0;
    let filteredOut = 0;
    let errors = 0;
    let totalCostUsd = 0;

    for (const signal of signals) {
      try {
        const langHint = signal.language ??
          (signal.source as { language?: string })?.language ?? 'unknown';

        const result = await provider.classify({
          text: signal.original_text,
          language: langHint,
        });

        totalCostUsd += result.costUsd;

        const isBuyer = BUYER_INTENT_TYPES.has(result.intentType);

        if (!isBuyer || result.intentConfidence < 0.3) {
          // Mark as filtered out — not a buyer signal
          await supabase
            .from('raw_signals')
            .update({ classification_status: 'FILTERED_OUT' })
            .eq('id', signal.id);
          filteredOut++;
          continue;
        }

        // Insert intent profile
        await supabase.from('intent_profiles').insert({
          signal_id: signal.id,
          intent_type: result.intentType,
          country: result.country ?? market,
          region: result.region ?? null,
          city: result.city ?? null,
          district: result.district ?? null,
          neighborhoods: result.neighborhoods ?? null,
          transaction_type: result.transactionType ?? null,
          property_types: result.propertyTypes ?? null,
          bedrooms_min: result.bedroomsMin ?? null,
          bedrooms_max: result.bedroomsMax ?? null,
          area_min: result.areaMin ?? null,
          area_max: result.areaMax ?? null,
          budget_min: result.budgetMin ?? null,
          budget_max: result.budgetMax ?? null,
          currency: result.currency ?? null,
          timeline: result.timeline ?? null,
          relocation_intent: result.relocationIntent,
          investment_intent: result.investmentIntent,
          language: result.language ?? langHint,
          intent_confidence: result.intentConfidence,
          specificity_score: result.specificityScore,
          actionability_score: result.actionabilityScore,
          original_text: signal.original_text,
          translated_text: result.translatedText ?? null,
          ai_model: result.model,
          ai_cost_usd: result.costUsd,
        });

        // Mark signal as classified
        await supabase
          .from('raw_signals')
          .update({ classification_status: 'CLASSIFIED' })
          .eq('id', signal.id);

        classified++;
      } catch (err) {
        console.error(`Error classifying signal ${signal.id}:`, err);
        await supabase
          .from('raw_signals')
          .update({ classification_status: 'ERROR' })
          .eq('id', signal.id);
        errors++;
      }
    }

    // Track COGS
    if (totalCostUsd > 0) {
      await supabase.from('cost_events').insert({
        provider: 'OPENAI',
        operation_type: 'CLASSIFY_SIGNALS',
        market,
        units: classified + filteredOut,
        cost_usd: totalCostUsd,
        success: true,
        cache_hit: false,
      });
    }

    return json({
      success: true,
      aiStatus,
      processed: signals.length,
      classified,
      filteredOut,
      errors,
      totalCostUsd,
    });
  } catch (err) {
    console.error('classify-signals error:', err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
