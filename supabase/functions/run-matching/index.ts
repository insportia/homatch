// ============================================================
// HOMATCH — run-matching Edge Function
// Runs MatchingEngine for ACTIVE campaigns:
//   classified IntentProfiles × active property snapshots
//   → creates Match records with locked previews
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── MATCHING ENGINE (inlined — shared imports not supported in bundler) ──

type SignalStrength = 'POTENTIAL' | 'GOOD' | 'STRONG' | 'VERY_STRONG' | 'EXCEPTIONAL';

interface PropertySnapshot {
  id: string;
  country?: string;
  city?: string;
  district?: string;
  transaction_type?: string;
  property_type?: string;
  total_price?: number;
  currency?: string;
  area?: number;
  bedrooms?: number;
  condition?: string;
  new_build?: boolean;
  parking?: boolean;
  balcony?: boolean;
  elevator?: boolean;
  furnished?: boolean;
  campaign_id?: string;
}

interface MatchEngineResult {
  propertyId: string;
  intentProfileId: string;
  matchScore: number;
  intentConfidence: number;
  signalStrength: SignalStrength;
  matchReasons: string[];
  mismatchReasons: string[];
  unlockPriceCredits: number;
  previewExcerpt: string;
}

const W = {
  country: 30, transaction: 20, city: 15, district: 10,
  budget: 15, propertyType: 5, bedrooms: 5,
  area: 3, condition: 2, newBuild: 1, parking: 1, amenities: 1,
};
const TOTAL_MAX = Object.values(W).reduce((s, v) => s + v, 0);
const HARD_MAX = W.country + W.transaction + W.city + W.district + W.budget + W.propertyType + W.bedrooms;

function computeSignalStrength(p: {
  matchScore: number; intentConfidence: number; specificity: number;
  actionability: number; recencyHours: number; sourceQuality: number;
}): SignalStrength {
  const composite =
    0.35 * p.matchScore / 100 + 0.25 * p.intentConfidence +
    0.15 * p.specificity + 0.15 * p.actionability +
    0.10 * Math.min(1, (168 - Math.min(168, p.recencyHours)) / 168) * p.sourceQuality;
  if (composite >= 0.85) return 'EXCEPTIONAL';
  if (composite >= 0.70) return 'VERY_STRONG';
  if (composite >= 0.55) return 'STRONG';
  if (composite >= 0.35) return 'GOOD';
  return 'POTENTIAL';
}

function calculateUnlockPrice(p: {
  signalStrength: SignalStrength; matchScore: number; intentConfidence: number;
  specificity: number; actionability: number; recencyHours: number; sourceQuality: number;
}): number {
  const base: Record<SignalStrength, number> = {
    POTENTIAL: 0.5, GOOD: 1.0, STRONG: 1.8, VERY_STRONG: 3.0, EXCEPTIONAL: 5.0,
  };
  let price = base[p.signalStrength];
  price *= 0.7 + 0.3 * (p.matchScore / 100);
  price *= 0.7 + 0.3 * p.intentConfidence;
  price *= 0.8 + 0.2 * p.specificity;
  price *= 0.8 + 0.2 * p.actionability;
  price *= 0.9 + 0.1 * p.sourceQuality;
  if (p.recencyHours < 1) price *= 1.3;
  else if (p.recencyHours < 6) price *= 1.15;
  else if (p.recencyHours < 24) price *= 1.05;
  else if (p.recencyHours > 168) price *= 0.8;
  return Math.max(0.5, Math.round(price * 100) / 100);
}

// deno-lint-ignore no-explicit-any
function matchPropertyToIntent(property: PropertySnapshot, intent: any, intentProfileId: string, recencyHours: number, sourceQuality: number): MatchEngineResult | null {
  const reasons: string[] = [];
  const mismatches: string[] = [];
  let score = 0;

  const propCountry = (property.country ?? 'GE').toUpperCase();
  const intCountry = (intent.country ?? '').toUpperCase();
  if (!intCountry || intCountry === propCountry) { score += W.country; reasons.push('Country match'); }
  else { mismatches.push(`Country mismatch`); return null; }

  const propTxn = property.transaction_type?.toUpperCase();
  const intTxn = intent.transactionType?.toUpperCase();
  if (!propTxn || !intTxn) { score += W.transaction * 0.5; }
  else if (propTxn === intTxn) { score += W.transaction; reasons.push('Transaction type matches'); }
  else { mismatches.push(`Transaction mismatch`); }

  const propCity = property.city?.toLowerCase();
  const intCity = intent.city?.toLowerCase();
  if (!propCity || !intCity) { score += W.city * 0.4; }
  else if (propCity === intCity) { score += W.city; reasons.push(`City: ${property.city}`); }
  else { mismatches.push(`City mismatch`); }

  const propDistrict = property.district?.toLowerCase();
  const intDistrict = intent.district?.toLowerCase();
  if (propDistrict && intDistrict) {
    if (propDistrict === intDistrict) { score += W.district; reasons.push(`District: ${property.district}`); }
    else {
      const inN = (intent.neighborhoods ?? []).map((n: string) => n.toLowerCase()).includes(propDistrict);
      if (inN) { score += W.district * 0.7; reasons.push('In requested neighborhood'); }
      else { mismatches.push('District mismatch'); }
    }
  } else { score += W.district * 0.5; }

  const price = property.total_price;
  const bMin = intent.budgetMin; const bMax = intent.budgetMax;
  if (!price || (!bMin && !bMax)) { score += W.budget * 0.5; }
  else {
    const inRange = (!bMin || price >= bMin * 0.9) && (!bMax || price <= bMax * 1.1);
    if (inRange) { score += W.budget; reasons.push('Price within budget range'); }
    else if (bMax && price <= bMax * 1.25) { score += W.budget * 0.5; reasons.push('Price slightly above budget'); }
    else { mismatches.push(`Price outside budget`); }
  }

  const propType = property.property_type?.toUpperCase();
  const intTypes = (intent.propertyTypes ?? []).map((t: string) => t.toUpperCase());
  if (!propType || !intTypes.length) { score += W.propertyType * 0.5; }
  else if (intTypes.includes(propType)) { score += W.propertyType; reasons.push(`Property type: ${propType}`); }
  else { mismatches.push(`Type mismatch`); }

  const beds = property.bedrooms;
  const bedsMin = intent.bedroomsMin; const bedsMax = intent.bedroomsMax;
  if (!beds || (!bedsMin && !bedsMax)) { score += W.bedrooms * 0.5; }
  else if ((!bedsMin || beds >= bedsMin) && (!bedsMax || beds <= bedsMax)) { score += W.bedrooms; reasons.push(`Bedrooms: ${beds}`); }
  else { mismatches.push(`Bedrooms mismatch`); }

  if (score < HARD_MAX * 0.4) return null;

  if (property.area && (intent.areaMin || intent.areaMax)) {
    const okA = (!intent.areaMin || property.area >= intent.areaMin * 0.85) && (!intent.areaMax || property.area <= intent.areaMax * 1.15);
    if (okA) { score += W.area; reasons.push(`Area ${property.area}m²`); }
  } else { score += W.area * 0.5; }
  if (intent.investmentIntent && property.new_build) { score += W.newBuild; reasons.push('New build'); }
  if (property.parking) { score += W.parking * 0.5; }
  if (property.balcony || property.elevator) { score += W.amenities * 0.5; }

  const matchScore = Math.round((score / TOTAL_MAX) * 100);
  const signalStrength = computeSignalStrength({ matchScore, intentConfidence: intent.intentConfidence, specificity: intent.specificityScore, actionability: intent.actionabilityScore, recencyHours, sourceQuality });
  const unlockPriceCredits = calculateUnlockPrice({ signalStrength, matchScore, intentConfidence: intent.intentConfidence, specificity: intent.specificityScore, actionability: intent.actionabilityScore, recencyHours, sourceQuality });
  const previewExcerpt = (intent.originalText ?? intent.translatedText ?? '').substring(0, 80).trim() + '…';

  return { propertyId: property.id, intentProfileId, matchScore, intentConfidence: intent.intentConfidence, signalStrength, matchReasons: reasons, mismatchReasons: mismatches, unlockPriceCredits, previewExcerpt };
}

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
    const {
      propertyId,
      campaignId,
      intentProfileBatchSize = 50,
      dryRun = false,
    } = await req.json().catch(() => ({}));

    // Load active properties with facts
    let propQuery = supabase
      .from('properties')
      .select(`
        id, user_id, transaction_type, property_type, matching_status,
        facts:property_facts!property_id(
          city, district, country, total_price, currency, area, bedrooms,
          condition, new_build, parking, balcony, elevator, furnished
        ),
        campaigns:matching_campaigns!property_id(id, status_v2)
      `)
      .eq('is_deleted', false)
      .eq('matching_status', 'ACTIVE');

    if (propertyId) {
      propQuery = propQuery.eq('id', propertyId);
    }

    const { data: properties, error: propErr } = await propQuery.limit(100);
    if (propErr) throw propErr;

    if (!properties?.length) {
      return json({ success: true, message: 'No active properties to match', matchesCreated: 0 });
    }

    // Load recent classified intent profiles not yet matched to these properties
    const { data: intentProfiles, error: ipErr } = await supabase
      .from('intent_profiles')
      .select(`
        id, intent_type, country, city, district, neighborhoods,
        transaction_type, property_types, bedrooms_min, bedrooms_max,
        area_min, area_max, budget_min, budget_max, currency,
        relocation_intent, investment_intent, language,
        intent_confidence, specificity_score, actionability_score,
        original_text, translated_text,
        signal:raw_signals!signal_id(
          id, platform, language, published_at, source_url,
          author_public_name, author_public_url,
          source:source_registry!source_id(quality_score)
        )
      `)
      .order('created_at', { ascending: false })
      .limit(intentProfileBatchSize);

    if (ipErr) throw ipErr;
    if (!intentProfiles?.length) {
      return json({ success: true, message: 'No intent profiles to match', matchesCreated: 0 });
    }

    if (dryRun) {
      return json({
        dryRun: true,
        activeProperties: properties.length,
        intentProfiles: intentProfiles.length,
        maxPossibleMatches: properties.length * intentProfiles.length,
      });
    }

    let matchesCreated = 0;
    let matchesSkipped = 0;

    for (const prop of properties) {
      const facts = Array.isArray(prop.facts) ? prop.facts[0] : prop.facts;
      const activeCampaign = Array.isArray(prop.campaigns)
        ? prop.campaigns.find((c: { status_v2: string }) => c.status_v2 === 'ACTIVE')
        : null;

      const snapshot: PropertySnapshot = {
        id: prop.id,
        country: facts?.country ?? 'GE',
        city: facts?.city,
        district: facts?.district,
        transaction_type: prop.transaction_type,
        property_type: prop.property_type,
        total_price: facts?.total_price,
        currency: facts?.currency,
        area: facts?.area,
        bedrooms: facts?.bedrooms,
        condition: facts?.condition,
        new_build: facts?.new_build ?? false,
        parking: facts?.parking ?? false,
        balcony: facts?.balcony ?? false,
        elevator: facts?.elevator ?? false,
        furnished: facts?.furnished ?? false,
        campaign_id: activeCampaign?.id ?? campaignId,
      };

      for (const profile of intentProfiles) {
        // Skip if match already exists
        const { data: existing } = await supabase
          .from('matches')
          .select('id')
          .eq('property_id', prop.id)
          .eq('intent_profile_id', profile.id)
          .maybeSingle();

        if (existing) { matchesSkipped++; continue; }

        // Compute recency
        const signal = Array.isArray(profile.signal) ? profile.signal[0] : profile.signal;
        const publishedAt = signal?.published_at ? new Date(signal.published_at) : null;
        const recencyHours = publishedAt
          ? (Date.now() - publishedAt.getTime()) / 3_600_000
          : 72;

        const sourceQuality =
          (signal?.source as { quality_score?: number } | null)?.quality_score ?? 5;

        // Build AIIntentResult-compatible object
        const intentData = {
          intentType: profile.intent_type,
          country: profile.country,
          city: profile.city,
          district: profile.district,
          neighborhoods: profile.neighborhoods,
          transactionType: profile.transaction_type,
          propertyTypes: profile.property_types,
          bedroomsMin: profile.bedrooms_min,
          bedroomsMax: profile.bedrooms_max,
          areaMin: profile.area_min,
          areaMax: profile.area_max,
          budgetMin: profile.budget_min,
          budgetMax: profile.budget_max,
          currency: profile.currency,
          relocationIntent: profile.relocation_intent,
          investmentIntent: profile.investment_intent,
          intentConfidence: profile.intent_confidence ?? 0.5,
          specificityScore: profile.specificity_score ?? 0.5,
          actionabilityScore: profile.actionability_score ?? 0.5,
          originalText: profile.original_text,
          translatedText: profile.translated_text,
          model: 'stored',
          costUsd: 0,
        };

        const result = matchPropertyToIntent(
          snapshot,
          intentData,
          profile.id,
          recencyHours,
          sourceQuality
        );

        if (!result) { matchesSkipped++; continue; }

        // Build safe locked preview
        const budgetStr = profile.budget_min || profile.budget_max
          ? `${profile.currency ?? '$'}${Number(profile.budget_min ?? 0).toLocaleString()}–${Number(profile.budget_max ?? 0).toLocaleString()}`
          : null;

        const bedsStr = profile.bedrooms_min
          ? `${profile.bedrooms_min}${profile.bedrooms_max ? `–${profile.bedrooms_max}` : '+'}`
          : null;

        const recencyLabel = formatRecency(recencyHours);

        // Insert match
        const { error: matchErr } = await supabase.from('matches').insert({
          property_id: prop.id,
          campaign_id: snapshot.campaign_id ?? null,
          signal_id: signal?.id ?? null,
          intent_profile_id: profile.id,
          match_score: result.matchScore,
          intent_confidence: result.intentConfidence,
          signal_strength: result.signalStrength,
          match_reasons: result.matchReasons,
          mismatch_reasons: result.mismatchReasons,
          unlock_price_credits: result.unlockPriceCredits,
          status: 'NEW',
          // Locked preview — safe to always return
          preview_platform: signal?.platform ?? null,
          preview_language: profile.language ?? null,
          preview_city: profile.city ?? null,
          preview_budget_min: profile.budget_min ?? null,
          preview_budget_max: profile.budget_max ?? null,
          preview_currency: profile.currency ?? null,
          preview_bedrooms: bedsStr ?? null,
          preview_excerpt: result.previewExcerpt,
          preview_recency: recencyLabel,
        });

        if (!matchErr) {
          matchesCreated++;
        }
      }
    }

    // Notify users of new strong matches
    if (matchesCreated > 0) {
      await notifyNewMatches(supabase, properties.map(p => p.id));
    }

    return json({
      success: true,
      activeProperties: properties.length,
      intentProfilesEvaluated: intentProfiles.length,
      matchesCreated,
      matchesSkipped,
    });
  } catch (err) {
    console.error('run-matching error:', err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

async function notifyNewMatches(
  supabase: ReturnType<typeof createClient>,
  propertyIds: string[]
) {
  // Load new STRONG+ matches for these properties
  const { data: strongMatches } = await supabase
    .from('matches')
    .select('id, property_id, signal_strength, properties!property_id(user_id)')
    .in('property_id', propertyIds)
    .in('signal_strength', ['STRONG', 'VERY_STRONG', 'EXCEPTIONAL'])
    .eq('status', 'NEW')
    .order('created_at', { ascending: false })
    .limit(10);

  if (!strongMatches?.length) return;

  for (const m of strongMatches) {
    const userId = (m.properties as { user_id?: string })?.user_id;
    if (!userId) continue;

    await supabase.from('notifications').insert({
      user_id: userId,
      type: 'MATCH_AVAILABLE',
      title: `New ${m.signal_strength} match found`,
      body: `A strong buyer intent matched your property.`,
      property_id: m.property_id,
      metadata: { match_id: m.id, signal_strength: m.signal_strength },
    });

    await supabase.from('activity_events').insert({
      user_id: userId,
      property_id: m.property_id,
      event_type: 'MATCH_AVAILABLE',
      metadata: { match_id: m.id, signal_strength: m.signal_strength },
    });
  }
}

function formatRecency(hours: number): string {
  if (hours < 1) return `${Math.round(hours * 60)} min ago`;
  if (hours < 24) return `${Math.round(hours)}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
