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
      .select('signal_id')
      .eq('property_id', propertyId)
      .order('last_seen_at', { ascending: false })
      .limit(10000);
    if (candidateError) throw candidateError;

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
        .select(`id,signal_id,intent_type,country,city,district,neighborhoods,transaction_type,property_types,bedrooms_min,bedrooms_max,area_min,area_max,budget_min,budget_max,currency,language,intent_confidence,specificity_score,actionability_score,original_text,translated_text,ai_cost_usd,created_at,signal:raw_signals!signal_id(id,platform,published_at,source_url,classification_status,intent_type,original_text,source:source_registry!source_id(quality_score))`)
        .in('signal_id', chunk)
        .order('created_at', { ascending: false });
      if (error) throw error;
      profiles.push(...(data || []));
    }
    profiles.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));

    let created = 0;
    let skipped = 0;
    let rejectedSupply = 0;
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
      const cogs = Math.max(0.05, Number(profile.ai_cost_usd || 0.05));
      const multiplier = scored.score >= 80 ? 10 : scored.score >= 50 ? 3 : 1;
      const price = Math.max(0.1, Math.ceil(cogs * multiplier * 100) / 100);
      const strength = scored.score >= 90 ? 'EXCEPTIONAL' : scored.score >= 80 ? 'VERY_STRONG' : scored.score >= 65 ? 'STRONG' : scored.score >= 50 ? 'GOOD' : 'POTENTIAL';
      const published = signal.published_at ? new Date(signal.published_at) : null;
      const recency = published && !Number.isNaN(published.getTime()) ? formatRecency((Date.now() - published.getTime()) / 3600000) : null;

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
        estimated_cogs_usd: cogs,
        pricing_multiplier: multiplier,
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
  const intentTypes = (profile.property_types || []).map(norm);
  const typeKnown = propertyType && intentTypes.length;
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
  let final = Math.max(0, Math.min(100, Math.round(total)));
  if (transactionKnown && !transactionMatches) final = Math.min(final, 49);
  if (typeKnown && !typeMatches) final = Math.min(final, 49);
  return { score: final, reasons, mismatches };
}

function norm(value: any) { return String(value || '').trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '_'); }
function similar(left: any, right: any) { const a = norm(left), b = norm(right); if (!a || !b) return 0; return a === b || a.includes(b) || b.includes(a) ? 1 : 0; }
function aliasCountry(value: string) { const aliases: Record<string, string> = { georgia: 'ge', საქართველო: 'ge', грузия: 'ge', turkey: 'tr', türkiye: 'tr' }; return aliases[value] || value; }
function typeCompatible(left: string, right: string) { if (left === right) return true; const groups = [['commercial', 'office', 'retail', 'warehouse', 'hotel'], ['house', 'villa', 'townhouse'], ['apartment', 'studio', 'penthouse']]; return groups.some((group) => group.includes(left) && group.includes(right)); }
function semanticOverlap(left: string, right: string) { const stop = new Set(['property', 'real', 'estate', 'for', 'the', 'and', 'with', 'this', 'that', 'იყიდება', 'ქირავდება', 'продажа', 'аренда']); const a = new Set(norm(left).split('_').filter((value) => value.length > 3 && !stop.has(value))); const b = new Set(norm(right).split('_').filter((value) => value.length > 3 && !stop.has(value))); if (!a.size || !b.size) return 0; let count = 0; for (const value of a) if (b.has(value)) count++; return Math.min(1, count / Math.max(3, Math.min(a.size, b.size))); }
function redact(text: string) { const clean = text.replace(/https?:\/\/\S+/g, '[link]').replace(/@[\w.-]+/g, '[profile]').replace(/\+?\d[\d\s()-]{6,}/g, '[contact]'); return clean.slice(0, 120) + (clean.length > 120 ? '…' : ''); }
function formatRecency(hours: number) { if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m ago`; if (hours < 24) return `${Math.round(hours)}h ago`; return `${Math.round(hours / 24)}d ago`; }
