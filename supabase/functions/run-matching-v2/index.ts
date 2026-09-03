import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-token',
};
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { ...CORS, 'Content-Type': 'application/json' },
});
const DEMAND = new Set(['BUY', 'RENT', 'INVEST', 'RELOCATE_BUY', 'RELOCATE_RENT']);
// Demand intent_type -> the set of properties.transaction_type values ('sale'|'rent'|'investment',
// normalized) it can legitimately be satisfied by, used ONLY as a fallback when the signal's own
// classified transaction_type is missing. Sourced from live intent_profiles data: INVEST demand has
// been recorded against both SALE and INVESTMENT properties (investors buying to hold), never RENT —
// so INVEST is never compatible with a rental property.
const INTENT_TRANSACTION_FALLBACK: Record<string, string[]> = {
  BUY: ['sale'],
  RELOCATE_BUY: ['sale'],
  RENT: ['rent'],
  RELOCATE_RENT: ['rent'],
  INVEST: ['sale', 'investment'],
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const bearer = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const db = createClient(Deno.env.get('SUPABASE_URL')!, serviceKey);
  let authorized = !!serviceKey && bearer === serviceKey;
  if (!authorized) {
    const { data: tokenRow } = await db.from('admin_settings').select('value').eq('key', 'continuous_worker_token').maybeSingle();
    const expected = typeof tokenRow?.value === 'string' ? tokenRow.value : String(tokenRow?.value || '').replace(/^\"|\"$/g, '');
    authorized = !!expected && req.headers.get('x-cron-token') === expected;
  }
  if (!authorized) return json({ error: 'Internal only' }, 403);
  try {
    const { propertyId, campaignId, intentProfileBatchSize = 1500 } = await req.json();
    if (!propertyId) return json({ error: 'propertyId required' }, 400);

    const { data: property, error: propertyError } = await db
      .from('properties')
      .select(`id,user_id,title,transaction_type,property_type,matching_status,facts:property_facts!property_id(country,country_code,city,district,neighborhood,total_price,currency,area,rooms,bedrooms,description,original_description,features)`)
      .eq('id', propertyId)
      .maybeSingle();
    if (propertyError) throw propertyError;
    if (!property) return json({ error: 'Property not found' }, 404);
    const facts = Array.isArray(property.facts) ? property.facts[0] : property.facts;

    // property_signal_candidates is the canonical many-to-many acquisition link.
    // raw_signals.property_id is legacy and is intentionally not required.
    const { data: candidateRows, error: candidateError } = await db
      .from('property_signal_candidates')
      .select('signal_id, acquisition_cost_usd')
      .eq('property_id', propertyId)
      .order('last_seen_at', { ascending: false })
      .limit(10000);
    if (candidateError) throw candidateError;
    const acquisitionCostBySignal = new Map<string, number>();
    for (const row of candidateRows || []) {
      if (row.signal_id) acquisitionCostBySignal.set(row.signal_id, Number(row.acquisition_cost_usd || 0));
    }

    // PricingEngine (docs/ARCHITECTURE.md "PricingEngine" section): base price per
    // signal_strength tier, times up to three admin-configurable multipliers. This
    // config already exists and is editable from Admin → Pricing — but nothing ever
    // read it: this function priced every match with an unrelated, undocumented
    // hardcoded formula (COGS-floor × a 10/3/1 score-tier multiplier), making the
    // admin Pricing Config page completely decorative. Defaults below match the
    // documented defaults exactly, so an untouched admin_settings table reproduces
    // today's documented intent, not today's actual (undocumented) behavior.
    const PRICING_DEFAULTS: Record<string, number> = {
      pricing_min_credits: 0.10,
      pricing_max_credits: 10.0,
      pricing_base_potential: 0.50,
      pricing_base_good: 1.00,
      pricing_base_strong: 2.00,
      pricing_base_very_strong: 3.50,
      pricing_base_exceptional: 5.00,
      pricing_multiplier_recency: 1.3,
      pricing_multiplier_source_quality: 1.2,
      pricing_multiplier_cogs: 1.15,
    };
    const { data: pricingRows } = await db.from('admin_settings').select('key,value').like('key', 'pricing_%');
    const pricing = { ...PRICING_DEFAULTS };
    for (const row of pricingRows || []) {
      const num = Number(row.value);
      if (row.key in pricing && Number.isFinite(num)) pricing[row.key] = num;
    }
    const STRENGTH_BASE_KEY: Record<string, string> = {
      POTENTIAL: 'pricing_base_potential',
      GOOD: 'pricing_base_good',
      STRONG: 'pricing_base_strong',
      VERY_STRONG: 'pricing_base_very_strong',
      EXCEPTIONAL: 'pricing_base_exceptional',
    };
    // The docs name three multipliers but don't specify their trigger conditions.
    // Interpretation used here (disclosed so an admin can retune it):
    //  - recency: signal published within the last 48h — a lead still fresh enough
    //    to plausibly act on, vs. one that's gone stale.
    //  - source quality: source_registry.quality_score (observed live range 4–8)
    //    at or above 7 — the top of the observed range, not just "above average".
    //  - COGS: the REAL measured cost to acquire+classify this specific signal
    //    (property_signal_candidates.acquisition_cost_usd + intent_profiles.
    //    ai_cost_usd) is at or above $0.02 — i.e. it came from an actual paid
    //    discovery call, not a near-zero-cost cached/reused one (live data: median
    //    non-zero acquisition cost is ~$0.034; classification alone is ~$0.0001).
    const RECENCY_WINDOW_MS = 48 * 3600 * 1000;
    const HIGH_SOURCE_QUALITY_THRESHOLD = 7;
    const REAL_COGS_HIGH_THRESHOLD_USD = 0.02;

    const { data: legacyRows, error: legacyError } = await db
      .from('raw_signals')
      .select('id')
      .eq('property_id', propertyId)
      .limit(10000);
    if (legacyError) throw legacyError;

    const signalIds = [...new Set([
      ...(candidateRows || []).map((row: any) => row.signal_id),
      ...(legacyRows || []).map((row: any) => row.id),
    ].filter(Boolean))];
    if (!signalIds.length) {
      return json({ success: true, matchesCreated: 0, matchesSkipped: 0, candidateSignals: 0, bestScore: 0, buckets: { '20-49': 0, '50-79': 0, '80-100': 0 } });
    }

    const requested = Math.min(5000, Math.max(1, Number(intentProfileBatchSize) || 1500));
    const profiles: any[] = [];
    for (let offset = 0; offset < signalIds.length && profiles.length < requested; offset += 200) {
      const chunk = signalIds.slice(offset, offset + 200);
      const { data, error } = await db
        .from('intent_profiles')
        .select(`id,signal_id,intent_type,country,city,district,neighborhoods,transaction_type,property_types,bedrooms_min,bedrooms_max,area_min,area_max,budget_min,budget_max,currency,language,intent_confidence,specificity_score,actionability_score,original_text,translated_text,ai_cost_usd,created_at,signal:raw_signals!signal_id(id,platform,property_id,published_at,source_url,classification_status,intent_type,original_text,source:source_registry!source_id(quality_score))`)
        .in('signal_id', chunk)
        .order('created_at', { ascending: false });
      if (error) throw error;
      profiles.push(...(data || []));
    }
    profiles.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

    let created = 0;
    let skipped = 0;
    let rejectedSupply = 0;
    let rejectedTransaction = 0;
    let rejectedPropertyType = 0;
    let rejectedDistrict = 0;
    let rejectedSelfSourced = 0;
    let insertErrors = 0;
    let best = 0;
    const errors: string[] = [];
    const buckets: Record<string, number> = { '20-49': 0, '50-79': 0, '80-100': 0 };

    for (const profile of profiles.slice(0, requested)) {
      const signal = Array.isArray(profile.signal) ? profile.signal[0] : profile.signal;
      if (!signal) { skipped++; continue; }
      const profileIntent = String(profile.intent_type || '').toUpperCase();
      const signalIntent = String(signal.intent_type || profile.intent_type || '').toUpperCase();
      const text = String(signal.original_text || profile.original_text || profile.translated_text || '');
      if (
        signal.classification_status !== 'CLASSIFIED' ||
        Number(profile.intent_confidence || 0) < 0.65 ||
        !DEMAND.has(profileIntent) ||
        !DEMAND.has(signalIntent) ||
        isSupplyAd(text)
      ) {
        skipped++;
        if (isSupplyAd(text)) rejectedSupply++;
        continue;
      }

      // Self-sourced guard: raw_signals.property_id is the legacy link recording which
      // signal a property was originally imported/created FROM. If that signal is the one
      // under consideration, it is the property's own ad re-appearing as a "demand" row via
      // re-classification drift, not a third party wanting it — hard reject, never score it.
      if (signal.property_id && String(signal.property_id) === String(property.id)) {
        skipped++;
        rejectedSelfSourced++;
        continue;
      }

      // ── Hard gates ──────────────────────────────────────────────────────
      // Below this point, a KNOWN incompatibility on transaction type, property
      // type, or district is a hard reject — never just a lower score. Previously
      // these only capped the score at 49 (still >= the 20 floor), so e.g. a
      // FOR_SALE property could "match" a RENT-seeking signal, or a Vake property
      // could match someone who explicitly wants Saburtalo. Unknown/missing data on
      // either side still falls through to soft scoring in score() below, since we
      // cannot penalize what was never actually claimed.
      const propertyTransaction = norm(property.transaction_type);
      // INVEST is special-cased ahead of the explicit field: live data shows the
      // classifier records intent_profiles.transaction_type as either 'SALE' or
      // 'INVESTMENT' for the exact same kind of buy-to-invest demand (classifier
      // granularity noise, not two different demands) — always both compatible.
      // Every other demand type trusts its own explicit transaction_type first,
      // since that's specific per-signal data rather than a static keyword map.
      const explicitIntentTransaction = norm(profile.transaction_type);
      const compatTransactions = profileIntent === 'INVEST'
        ? INTENT_TRANSACTION_FALLBACK.INVEST
        : explicitIntentTransaction
        ? [explicitIntentTransaction]
        : INTENT_TRANSACTION_FALLBACK[profileIntent] || null;
      if (propertyTransaction && compatTransactions && !compatTransactions.includes(propertyTransaction)) {
        skipped++;
        rejectedTransaction++;
        continue;
      }

      const propertyTypeNorm = norm(property.property_type);
      // Only values that resolve into a recognized TYPE_GROUPS family count as a
      // specific, confident claim worth gating on — a generic "real estate" or an
      // unmapped free-text phrase is a data gap, not a stated incompatibility.
      const intentPropertyTypesKnown = (profile.property_types || []).map(norm).filter((v: string) => typeGroupOf(v) !== -1);
      if (
        propertyTypeNorm &&
        typeGroupOf(propertyTypeNorm) !== -1 &&
        intentPropertyTypesKnown.length &&
        !intentPropertyTypesKnown.some((value: string) => typeCompatible(propertyTypeNorm, value))
      ) {
        skipped++;
        rejectedPropertyType++;
        continue;
      }

      const propertyDistrictNorm = norm(facts?.district || facts?.neighborhood);
      const intentDistricts = [profile.district, ...(profile.neighborhoods || [])].filter(Boolean);
      // Only enforce the district gate when the city itself isn't already a known
      // mismatch (a city-level mismatch is reported separately by score()) — a
      // district gate on top of an already-wrong city would double-penalize and
      // obscure which signal actually caused the rejection.
      const cityKnownMismatch = !!facts?.city && !!profile.city && similar(facts.city, profile.city) === 0;
      if (
        propertyDistrictNorm &&
        intentDistricts.length &&
        !cityKnownMismatch &&
        !intentDistricts.some((value: string) => similar(propertyDistrictNorm, value) >= 0.5)
      ) {
        skipped++;
        rejectedDistrict++;
        continue;
      }

      const { data: existing, error: existingError } = await db
        .from('matches')
        .select('id')
        .eq('property_id', property.id)
        .eq('intent_profile_id', profile.id)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) { skipped++; continue; }

      const scored = score(property, facts, profile);
      if (scored.score < 20) { skipped++; continue; }
      const strength = scored.score >= 90 ? 'EXCEPTIONAL' : scored.score >= 80 ? 'VERY_STRONG' : scored.score >= 65 ? 'STRONG' : scored.score >= 50 ? 'GOOD' : 'POTENTIAL';
      const published = signal.published_at ? new Date(signal.published_at) : null;
      const publishedMs = published && !Number.isNaN(published.getTime()) ? published.getTime() : null;
      const recency = publishedMs !== null ? formatRecency((Date.now() - publishedMs) / 3600000) : null;

      // Real measured COGS for THIS signal — replaces the old fake "cogs" that was
      // always the $0.05 fallback floor (live data: real ai_cost_usd averages
      // $0.000131, always far below that floor, so it never once actually applied).
      const realCogs = Number(profile.ai_cost_usd || 0) + (acquisitionCostBySignal.get(profile.signal_id) || 0);
      const sourceRow = Array.isArray(signal.source) ? signal.source[0] : signal.source;
      const isFresh = publishedMs !== null && (Date.now() - publishedMs) <= RECENCY_WINDOW_MS;
      const isHighQualitySource = Number(sourceRow?.quality_score || 0) >= HIGH_SOURCE_QUALITY_THRESHOLD;
      const isCogsHigh = realCogs >= REAL_COGS_HIGH_THRESHOLD_USD;

      const base = pricing[STRENGTH_BASE_KEY[strength]] ?? pricing.pricing_base_potential;
      let rawPrice = base;
      if (isFresh) rawPrice *= pricing.pricing_multiplier_recency;
      if (isHighQualitySource) rawPrice *= pricing.pricing_multiplier_source_quality;
      if (isCogsHigh) rawPrice *= pricing.pricing_multiplier_cogs;
      const price = Math.min(pricing.pricing_max_credits, Math.max(pricing.pricing_min_credits, Math.round(rawPrice * 100) / 100));
      // Stored as the actual combined multiplier applied (price ÷ base), for
      // observability — replaces the old, unrelated 10/3/1 score-tier magic number.
      const appliedMultiplier = base > 0 ? Math.round((price / base) * 100) / 100 : 1;

      const { error: insertError } = await db.from('matches').insert({
        property_id: property.id,
        user_id: property.user_id,
        campaign_id: campaignId || null,
        signal_id: profile.signal_id,
        intent_profile_id: profile.id,
        match_score: scored.score,
        intent_confidence: Number(profile.intent_confidence || 0),
        signal_strength: strength,
        match_reasons: scored.reasons,
        mismatch_reasons: scored.mismatches,
        unlock_price_credits: price,
        estimated_cogs_usd: realCogs,
        pricing_multiplier: appliedMultiplier,
        status: 'NEW',
        mock_mode: false,
        preview_platform: signal.platform || null,
        preview_language: profile.language || null,
        preview_city: profile.city || null,
        preview_budget_min: profile.budget_min || null,
        preview_budget_max: profile.budget_max || null,
        preview_currency: profile.currency || null,
        preview_bedrooms: profile.bedrooms_min || null,
        preview_excerpt: redact(text),
        preview_recency: recency,
      });
      if (insertError) {
        insertErrors++;
        if (errors.length < 5) errors.push(insertError.message);
        continue;
      }
      created++;
      best = Math.max(best, scored.score);
      buckets[scored.score >= 80 ? '80-100' : scored.score >= 50 ? '50-79' : '20-49']++;
    }

    await db.from('properties').update({ matchability_score: best || null }).eq('id', property.id);
    return json({
      success: true,
      mode: 'PROPERTY_SIGNAL_CANDIDATES',
      candidateSignals: signalIds.length,
      profilesConsidered: Math.min(profiles.length, requested),
      matchesCreated: created,
      matchesSkipped: skipped,
      rejectedSupply,
      rejectedTransaction,
      rejectedPropertyType,
      rejectedDistrict,
      rejectedSelfSourced,
      insertErrors,
      errors,
      bestScore: best,
      buckets,
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});

function isSupplyAd(text: string) {
  const value = text.toLowerCase();
  const supplyPhrases = [/\b(apartment|house|villa|land|office|commercial|studio|penthouse)\s+for\s+(rent|sale)\b/i,/\bfor\s+(rent|sale)\b/i,/\bavailable\s+for\s+(rent|sale)\b/i,/\bიყიდება\b/i,/\bქირავდება\b/i,/\bсда[её]тся\b/i,/\bпрода[её]тся\b/i,/\bkiralık\b/i,/\bsatılık\b/i,/للإيجار|للبيع/i,/להשכרה|למכירה/i];
  const listingSignals = (/\b\d{2,5}\s*(usd|\$|gel|₾|eur|€|try|₺)\b/i.test(value) || /\b\d+(?:\.\d+)?\s*(sq\.?\s*m|m²|sqm|კვ\.?\s?მ)/i.test(value)) && (/@\w+|\+?\d[\d\s()-]{7,}/.test(text) || /deposit|commission|floor|bed|bath|parking|balcony/i.test(value));
  const demandWords = /looking for|seeking|need to (buy|rent)|want to (buy|rent)|interested in buying|ищу|куплю|хочу купить|сниму|ვეძებ|ვიყიდი|ვიქირავებ|arıyorum|satın almak istiyorum|kiralamak istiyorum|أبحث عن|أريد شراء|أريد استئجار|מחפש|רוצה לקנות|רוצה לשכור/i.test(value);
  return !demandWords && (supplyPhrases.some((rule) => rule.test(value)) || listingSignals);
}

function score(property: any, facts: any, profile: any) {
  let total = 0;
  const reasons: string[] = [];
  const mismatches: string[] = [];
  const propertyTransaction = norm(property.transaction_type);
  const intentTransaction = norm(profile.transaction_type);
  const transactionKnown = !!propertyTransaction && !!intentTransaction;
  const transactionMatches = !transactionKnown || propertyTransaction === intentTransaction;
  if (!transactionKnown) { total += 12; reasons.push('Transaction intent partially known'); }
  else if (transactionMatches) { total += 25; reasons.push('Transaction intent matches'); }
  else mismatches.push('Transaction differs');
  const propertyCountry = norm(facts?.country_code || facts?.country);
  const intentCountry = norm(profile.country);
  if (!propertyCountry || !intentCountry) total += 5;
  else if (propertyCountry === intentCountry || aliasCountry(propertyCountry) === aliasCountry(intentCountry)) { total += 10; reasons.push('Country matches'); }
  else mismatches.push('Country differs');
  const city = similar(facts?.city, profile.city);
  if (city === 1) { total += 10; reasons.push('City matches'); }
  else if (city === 0.5) { total += 5; reasons.push('Location broadly compatible'); }
  else if (profile.city && facts?.city) mismatches.push('City differs');
  else total += 4;
  const districts = [profile.district, ...(profile.neighborhoods || [])].filter(Boolean);
  const districtMatches = districts.some((value: string) => similar(facts?.district || facts?.neighborhood, value) >= 0.5);
  if (districtMatches) { total += 5; reasons.push('District/neighborhood matches'); }
  else if (!districts.length) total += 2;
  const propertyType = norm(property.property_type);
  // Mirrors the hard-gate filtering in the caller: only intent property-type
  // values that resolve into a recognized family count as a specific claim.
  const intentTypes = (profile.property_types || []).map(norm).filter((v: string) => typeGroupOf(v) !== -1);
  const typeKnown = typeGroupOf(propertyType) !== -1 && intentTypes.length > 0;
  const typeMatches = !typeKnown || intentTypes.some((value: string) => typeCompatible(propertyType, value));
  if (!typeKnown) total += 8;
  else if (typeMatches) { total += 20; reasons.push('Property type matches'); }
  else mismatches.push('Property type differs');
  const price = Number(facts?.total_price || 0);
  const budgetMin = Number(profile.budget_min || 0);
  const budgetMax = Number(profile.budget_max || 0);
  if (!price || (!budgetMin && !budgetMax)) total += 7;
  else if ((!budgetMin || price >= budgetMin * 0.8) && (!budgetMax || price <= budgetMax * 1.2)) { total += 15; reasons.push('Budget compatible'); }
  else if (budgetMax && price <= budgetMax * 1.5) { total += 7; reasons.push('Budget near range'); }
  else mismatches.push('Budget differs');
  const area = Number(facts?.area || 0);
  const areaMin = Number(profile.area_min || 0);
  const areaMax = Number(profile.area_max || 0);
  if (!area || (!areaMin && !areaMax)) total += 2;
  else if ((!areaMin || area >= areaMin * 0.75) && (!areaMax || area <= areaMax * 1.25)) { total += 5; reasons.push('Area compatible'); }
  const propertyText = [property.title, facts?.description, facts?.original_description, ...(facts?.features || [])].filter(Boolean).join(' ');
  const intentText = [profile.original_text, profile.translated_text].filter(Boolean).join(' ');
  const overlap = semanticOverlap(propertyText, intentText);
  total += Math.round(overlap * 10);
  if (overlap >= 0.3) reasons.push('Description/needs overlap');
  total += Math.round(Math.min(1, Number(profile.intent_confidence || 0)) * 5);
  // NOTE: a known transaction or property-type mismatch used to cap `final` at 49 here.
  // Both are now hard-rejected in the caller before score() is ever invoked, so a
  // known mismatch on either can no longer reach this function — the cap is gone
  // because it's now unreachable, not because the rule was relaxed.
  const final = Math.max(0, Math.min(100, Math.round(total)));
  return { score: final, reasons, mismatches };
}

function norm(value: any) { return String(value || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_'); }
function similar(left: any, right: any) { const a = norm(left), b = norm(right); if (!a || !b) return 0; return a === b || a.includes(b) || b.includes(a) ? 1 : 0; }
function aliasCountry(value: string) { const aliases: Record<string, string> = { georgia: 'ge', საქართველო: 'ge', грузия: 'ge', turkey: 'tr', türkiye: 'tr' }; return aliases[value] || value; }
// Canonical property-type families. Grouped (rather than exact-match) because
// intent_property_types is free text from the LLM classifier ("2-bedroom
// apartment", "studio apartment", "shared accommodation") — after norm() that
// becomes e.g. "2_bedroom_apartment", which will never exactly equal or be a
// full array member of "apartment". Matching is substring-based against each
// group's keywords so "2_bedroom_apartment" still resolves into the apartment
// family instead of silently falling through as "no group" (which would make
// the type hard-gate reject a large share of real, correctly-typed demand —
// worse than the false negatives it exists to fix).
const TYPE_GROUPS = [
  ['commercial', 'office', 'retail', 'warehouse', 'hotel'],
  ['house', 'villa', 'townhouse'],
  ['apartment', 'studio', 'penthouse'],
  ['land', 'plot'],
];
function typeGroupOf(value: string): number {
  if (!value) return -1;
  return TYPE_GROUPS.findIndex((group) => group.some((keyword) => value === keyword || value.includes(keyword) || keyword.includes(value)));
}
// Two type strings are "compatible" if they resolve into the SAME recognized
// family. A value that matches no family at all (a generic "real estate", or
// the property_type enum's own "OTHER" catch-all) is treated as unrecognized,
// not as a specific claim — callers must check typeGroupOf(...) !== -1
// themselves before treating a mismatch here as a confident, gate-worthy one.
function typeCompatible(left: string, right: string) { if (left === right) return true; const lg = typeGroupOf(left); const rg = typeGroupOf(right); return lg !== -1 && lg === rg; }
function semanticOverlap(left: string, right: string) { const stop = new Set(['property', 'real', 'estate', 'for', 'the', 'and', 'with', 'this', 'that', 'იყიდება', 'ქირავდება', 'продажа', 'аренда']); const a = new Set(norm(left).split('_').filter((value) => value.length > 3 && !stop.has(value))); const b = new Set(norm(right).split('_').filter((value) => value.length > 3 && !stop.has(value))); if (!a.size || !b.size) return 0; let count = 0; for (const value of a) if (b.has(value)) count++; return Math.min(1, count / Math.max(3, Math.min(a.size, b.size))); }
function redact(text: string) { const clean = text.replace(/https?:\/\/\S+/g, '[link]').replace(/@[\w.-]+/g, '[profile]').replace(/\+?\d[\d\s()-]{6,}/g, '[contact]'); return clean.slice(0, 120) + (clean.length > 120 ? '…' : ''); }
function formatRecency(hours: number) { if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m ago`; if (hours < 24) return `${Math.round(hours)}h ago`; return `${Math.round(hours / 24)}d ago`; }
