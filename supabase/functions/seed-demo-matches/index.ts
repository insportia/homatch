import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ============================================================
// HOMATCH — seed-demo-matches Edge Function
//
// Creates 6 realistic DEMO/MOCK match signals for a given
// property_id so the full lock/unlock flow is testable
// without real provider keys.
//
// Security:
//  - Caller must own the property (or be admin)
//  - Each signal is marked  mock_mode = true in DB
//  - Before unlock: locked redaction identical to real flow
//  - After unlock: full mock content returned from match_unlocks
//  - Credits are deducted via the same atomic-unlock function
// ============================================================

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── 6 Realistic mock fixtures ────────────────────────────────
// Each fixture mirrors the production Match row structure.
// full_signal_text, full_source_url, full_profile_url and
// full_intent_json are stored in match_unlocks (server-side only)
// and are NEVER included in the matches table before unlock.

const MOCK_SIGNALS = [
  {
    // 1. Russian Telegram Group buyer
    preview_platform: 'TELEGRAM',
    preview_language: 'ru',
    preview_city: 'Tbilisi',
    preview_budget_min: 110000,
    preview_budget_max: 160000,
    preview_currency: '$',
    preview_bedrooms: 3,
    preview_recency: '2d ago',
    preview_excerpt: 'Ищем 3-комнатную квартиру в Тбилиси, желательно Ваке или Сабуртало. Бюджет до $160 000. Готовы к просмотру…',
    match_score: 91.4,
    intent_confidence: 0.89,
    signal_strength: 'VERY_STRONG' as const,
    unlock_price_credits: 3.5,
    match_reasons: ['Budget match', 'Bedroom count match', 'City match', 'Recent signal'],
    // Locked (stored in match_unlocks only after unlock)
    _unlock: {
      full_signal_text: 'Ищем 3-комнатную квартиру в Тбилиси, желательно Ваке или Сабуртало. Бюджет до $160 000. Готовы к просмотру в любое время. Контакт: @tbilisi_buyer_elena',
      full_source_url: 'https://t.me/tbilisi_property_chat/189234',
      full_profile_url: 'https://t.me/tbilisi_buyer_elena',
      full_intent_json: {
        intent_type: 'BUY',
        transaction_type: 'SALE',
        city: 'Tbilisi',
        district: 'Vake or Saburtalo',
        property_types: ['APARTMENT'],
        budget_min: 110000,
        budget_max: 160000,
        currency: 'USD',
        bedrooms_min: 3,
        language: 'ru',
        translated_text: 'Looking for a 3-bedroom apartment in Tbilisi, preferably Vake or Saburtalo. Budget up to $160,000. Ready to view at any time. Contact: @tbilisi_buyer_elena',
      },
    },
  },
  {
    // 2. Georgian Facebook Group buyer
    preview_platform: 'FACEBOOK',
    preview_language: 'ka',
    preview_city: 'Tbilisi',
    preview_budget_min: 80000,
    preview_budget_max: 130000,
    preview_currency: '$',
    preview_bedrooms: 2,
    preview_recency: '5d ago',
    preview_excerpt: 'ვეძებ 2-ოთახიან ბინას თბილისში, ვაკე-საბურთალო. ფასი $80,000–$130,000. ახალი ან კარგ მდგომარეობაში…',
    match_score: 84.7,
    intent_confidence: 0.82,
    signal_strength: 'STRONG' as const,
    unlock_price_credits: 2.5,
    match_reasons: ['Budget match', 'District match', 'Property type match'],
    _unlock: {
      full_signal_text: 'ვეძებ 2-ოთახიან ბინას თბილისში, ვაკე-საბურთალო რაიონში. ფასი $80,000-$130,000. ახალი ან კარგ მდგომარეობაში. დამიკავშირდით: 599 12 34 56',
      full_source_url: 'https://www.facebook.com/groups/tbilisi.real.estate/posts/7123456789',
      full_profile_url: 'https://www.facebook.com/profile.php?id=100098765432',
      full_intent_json: {
        intent_type: 'BUY',
        transaction_type: 'SALE',
        city: 'Tbilisi',
        district: 'Vake-Saburtalo',
        property_types: ['APARTMENT'],
        budget_min: 80000,
        budget_max: 130000,
        currency: 'USD',
        bedrooms_min: 2,
        language: 'ka',
        translated_text: 'Looking for a 2-room apartment in Tbilisi, Vake-Saburtalo area. Price $80,000–$130,000. New or in good condition. Contact: 599 12 34 56',
      },
    },
  },
  {
    // 3. English investor
    preview_platform: 'WEBSITE',
    preview_language: 'en',
    preview_city: 'Tbilisi',
    preview_budget_min: 120000,
    preview_budget_max: 200000,
    preview_currency: '$',
    preview_bedrooms: 2,
    preview_recency: '1w ago',
    preview_excerpt: 'Looking for investment apartment in Tbilisi. Must have rental history or strong rental potential. Vake, Old Town or Didube preferred…',
    match_score: 78.2,
    intent_confidence: 0.75,
    signal_strength: 'STRONG' as const,
    unlock_price_credits: 2.0,
    match_reasons: ['Budget match', 'City match', 'Investment intent detected'],
    _unlock: {
      full_signal_text: 'Looking for investment apartment in Tbilisi. Must have rental history or strong rental potential. Vake, Old Town or Didube preferred. Budget $120k–$200k. Direct owner contact preferred. Posted on property-forum.ge.',
      full_source_url: 'https://property-forum.ge/threads/looking-for-investment-apartment-tbilisi.18423',
      full_profile_url: null,
      full_intent_json: {
        intent_type: 'INVEST',
        transaction_type: 'SALE',
        city: 'Tbilisi',
        district: 'Vake or Old Town or Didube',
        property_types: ['APARTMENT'],
        budget_min: 120000,
        budget_max: 200000,
        currency: 'USD',
        bedrooms_min: 2,
        language: 'en',
        translated_text: null,
      },
    },
  },
  {
    // 4. Turkish relocation buyer (exceptional strength)
    preview_platform: 'TELEGRAM',
    preview_language: 'tr',
    preview_city: 'Tbilisi',
    preview_budget_min: 150000,
    preview_budget_max: 250000,
    preview_currency: '$',
    preview_bedrooms: 3,
    preview_recency: '3d ago',
    preview_excerpt: 'Tbilisi\'de aile için 3+1 daire arıyoruz. Bütçemiz $150k–$250k. Okul yakınında olursa iyi olur…',
    match_score: 94.8,
    intent_confidence: 0.93,
    signal_strength: 'EXCEPTIONAL' as const,
    unlock_price_credits: 5.0,
    match_reasons: ['Budget match', 'Bedroom count match', 'Relocation intent', 'Recent signal', 'High confidence'],
    _unlock: {
      full_signal_text: 'Tbilisi\'de aile için 3+1 daire arıyoruz. Bütçemiz $150.000-$250.000 arasında. Okul yakınında olursa iyi olur, toplu ulaşım önemli. Mayıs 2024\'te taşınmayı planlıyoruz. İletişim: +90 532 XXX XXXX',
      full_source_url: 'https://t.me/tbilisi_turkler/45821',
      full_profile_url: 'https://t.me/tbilisi_relocation_tr',
      full_intent_json: {
        intent_type: 'RELOCATE_BUY',
        transaction_type: 'SALE',
        city: 'Tbilisi',
        district: null,
        property_types: ['APARTMENT'],
        budget_min: 150000,
        budget_max: 250000,
        currency: 'USD',
        bedrooms_min: 3,
        language: 'tr',
        translated_text: 'Looking for a 3+1 apartment in Tbilisi for a family. Budget $150,000–$250,000. Proximity to schools preferred, public transport important. Planning to move in May 2024.',
      },
    },
  },
  {
    // 5. Arabic investor (good strength)
    preview_platform: 'INSTAGRAM',
    preview_language: 'ar',
    preview_city: 'Tbilisi',
    preview_budget_min: 100000,
    preview_budget_max: 180000,
    preview_currency: '$',
    preview_bedrooms: 2,
    preview_recency: '10d ago',
    preview_excerpt: 'أبحث عن شقة في تبليسي للاستثمار. ميزانيتي بين 100 و 180 ألف دولار…',
    match_score: 72.1,
    intent_confidence: 0.68,
    signal_strength: 'GOOD' as const,
    unlock_price_credits: 1.5,
    match_reasons: ['Budget match', 'City match', 'Investor intent'],
    _unlock: {
      full_signal_text: 'أبحث عن شقة في تبليسي للاستثمار. ميزانيتي بين 100,000 و 180,000 دولار أمريكي. أفضل غرفتين أو ثلاثة. أرجو التواصل عبر الإنستغرام.',
      full_source_url: 'https://www.instagram.com/p/CxyzABC123456/',
      full_profile_url: 'https://www.instagram.com/arabic_invest_tbilisi/',
      full_intent_json: {
        intent_type: 'INVEST',
        transaction_type: 'SALE',
        city: 'Tbilisi',
        district: null,
        property_types: ['APARTMENT'],
        budget_min: 100000,
        budget_max: 180000,
        currency: 'USD',
        bedrooms_min: 2,
        language: 'ar',
        translated_text: 'Looking for an apartment in Tbilisi for investment. Budget between $100,000 and $180,000. Prefer 2 or 3 bedrooms. Please contact via Instagram.',
      },
    },
  },
  {
    // 6. Hebrew buyer (potential strength)
    preview_platform: 'FACEBOOK',
    preview_language: 'he',
    preview_city: 'Tbilisi',
    preview_budget_min: 90000,
    preview_budget_max: 140000,
    preview_currency: '$',
    preview_bedrooms: 2,
    preview_recency: '2w ago',
    preview_excerpt: 'מחפש דירה בטביליסי לרכישה. תקציב עד 140 אלף דולר. שני חדרים לפחות…',
    match_score: 63.5,
    intent_confidence: 0.59,
    signal_strength: 'POTENTIAL' as const,
    unlock_price_credits: 1.0,
    match_reasons: ['Budget overlap', 'City match'],
    _unlock: {
      full_signal_text: 'מחפש דירה בטביליסי לרכישה. תקציב עד 140,000 דולר. שני חדרים לפחות, בניין טוב. מוזמנים לפנות.',
      full_source_url: 'https://www.facebook.com/groups/israelis.in.georgia/posts/4321098765',
      full_profile_url: 'https://www.facebook.com/profile.php?id=100012345678',
      full_intent_json: {
        intent_type: 'BUY',
        transaction_type: 'SALE',
        city: 'Tbilisi',
        district: null,
        property_types: ['APARTMENT'],
        budget_min: 90000,
        budget_max: 140000,
        currency: 'USD',
        bedrooms_min: 2,
        language: 'he',
        translated_text: 'Looking for an apartment in Tbilisi to purchase. Budget up to $140,000. At least two bedrooms, good building. Feel free to contact.',
      },
    },
  },
];

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS });
  }

  // ── Auth check ───────────────────────────────────────────
  const authHeader = req.headers.get('authorization') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  if (!authHeader || authHeader === `Bearer ${anonKey}`) {
    return Response.json(
      { success: false, error: 'Authentication required', error_code: 'UNAUTHORIZED' },
      { status: 401, headers: CORS },
    );
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // Verify caller
  const userClient = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    anonKey,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user: authUser } } = await userClient.auth.getUser();
  if (!authUser) {
    return Response.json(
      { success: false, error: 'Invalid session', error_code: 'UNAUTHORIZED' },
      { status: 401, headers: CORS },
    );
  }

  // ── Parse body ───────────────────────────────────────────
  let body: { propertyId?: string } = {};
  try { body = await req.json(); } catch { /* ignore */ }

  const propertyId = body.propertyId;
  if (!propertyId) {
    return Response.json(
      { success: false, error: 'propertyId required', error_code: 'INVALID_REQUEST' },
      { status: 400, headers: CORS },
    );
  }

  // ── Ownership check ──────────────────────────────────────
  const { data: property } = await supabase
    .from('properties')
    .select('id, user_id')
    .eq('id', propertyId)
    .maybeSingle();

  if (!property) {
    return Response.json(
      { success: false, error: 'Property not found', error_code: 'NOT_FOUND' },
      { status: 404, headers: CORS },
    );
  }

  // Resolve homatch user_id from auth_id
  const { data: homatchUser } = await supabase
    .from('users')
    .select('id, role')
    .eq('auth_id', authUser.id)
    .maybeSingle();

  const isOwner = homatchUser && property.user_id === homatchUser.id;
  const isAdmin = homatchUser?.role === 'ADMIN';

  if (!isOwner && !isAdmin) {
    return Response.json(
      { success: false, error: 'Forbidden', error_code: 'FORBIDDEN' },
      { status: 403, headers: CORS },
    );
  }

  // ── Check for existing demo matches ─────────────────────
  const { count: existing } = await supabase
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .eq('property_id', propertyId)
    .eq('mock_mode', true);

  if ((existing ?? 0) > 0) {
    return Response.json(
      { success: true, seeded: 0, message: 'Demo matches already exist for this property.' },
      { headers: CORS },
    );
  }

  // ── Ensure a signal row exists to satisfy FK ─────────────
  // We insert a placeholder signal for each mock match.
  // In production, signals come from real provider pipelines.

  let seeded = 0;
  const errors: string[] = [];

  for (const fixture of MOCK_SIGNALS) {
    const { _unlock, ...matchFields } = fixture;

    // 1. Create a mock signal in raw_signals (production table name)
    const { data: signal, error: sigError } = await supabase
      .from('raw_signals')
      .insert({
        platform: matchFields.preview_platform,
        language: matchFields.preview_language,
        original_text: matchFields.preview_excerpt,  // raw_signals uses original_text
        classification_status: 'CLASSIFIED',
        mock_mode: true,
        intent_type: _unlock.full_intent_json?.intent_type ?? 'BUY',
        intent_json: _unlock.full_intent_json,
        source_url: _unlock.full_source_url,
        profile_url: _unlock.full_profile_url,
        discovered_at: new Date().toISOString(),
        last_seen_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (sigError || !signal) {
      errors.push(`Signal insert error: ${sigError?.message ?? 'unknown'}`);
      continue;
    }

    // 2. Create the match row (LOCKED — no full content)
    const { data: match, error: matchError } = await supabase
      .from('matches')
      .insert({
        property_id: propertyId,
        signal_id: signal.id,
        user_id: property.user_id,
        status: 'NEW',
        mock_mode: true,
        match_score: matchFields.match_score,
        intent_confidence: matchFields.intent_confidence,
        signal_strength: matchFields.signal_strength,
        unlock_price_credits: matchFields.unlock_price_credits,
        match_reasons: matchFields.match_reasons,
        // Preview fields (safe to expose before unlock)
        preview_platform: matchFields.preview_platform,
        preview_language: matchFields.preview_language,
        preview_city: matchFields.preview_city,
        preview_budget_min: matchFields.preview_budget_min,
        preview_budget_max: matchFields.preview_budget_max,
        preview_currency: matchFields.preview_currency,
        preview_bedrooms: matchFields.preview_bedrooms,
        preview_recency: matchFields.preview_recency,
        preview_excerpt: matchFields.preview_excerpt,
        // NEVER include full_signal_text, full_source_url, full_profile_url here
      })
      .select('id')
      .single();

    if (matchError || !match) {
      errors.push(`Match insert error: ${matchError?.message ?? 'unknown'}`);
      continue;
    }

    // 3. Pre-populate match_unlocks row (locked until atomic-unlock is called)
    // This row is only returned by atomic-unlock after credits are deducted.
    // It is NOT accessible via RLS before unlocking.
    const { error: unlockError } = await supabase
      .from('match_unlocks_pending')
      .insert({
        match_id: match.id,
        property_id: propertyId,
        full_signal_text: _unlock.full_signal_text,
        full_source_url: _unlock.full_source_url,
        full_profile_url: _unlock.full_profile_url,
        full_intent_json: _unlock.full_intent_json,
        mock_mode: true,
      });

    // If the pending table doesn't exist, skip gracefully — atomic-unlock will
    // fall back to generating content from the signal row for mock mode.
    if (unlockError) {
      // Non-fatal: log but continue
      console.warn(`match_unlocks_pending insert skipped (${unlockError.message})`);
    }

    seeded++;
  }

  // Log activity
  if (homatchUser && seeded > 0) {
    await supabase.from('activity_events').insert({
      user_id: homatchUser.id,
      event_type: 'MATCHING_STARTED',
      metadata: { demo_mode: true, seeded_matches: seeded, property_id: propertyId },
    }).then(() => {}); // fire and forget
  }

  return Response.json(
    {
      success: true,
      seeded,
      errors: errors.length > 0 ? errors : undefined,
      message: `Seeded ${seeded} demo matches for property ${propertyId}.`,
    },
    { headers: CORS },
  );
});
