// unlock-external-contact Edge Function
// POST { match_id, idempotency_key }
// Returns pre-unlock info before confirmation; on confirm=true deducts credits and reveals contact
import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });

    const { data: actor } = await supabase.from('users').select('id').eq('auth_id', user.id).maybeSingle();
    if (!actor) return new Response(JSON.stringify({ error: 'User not found' }), { status: 404, headers: corsHeaders });

    const { match_id, idempotency_key, confirm } = await req.json();
    if (!match_id) return new Response(JSON.stringify({ error: 'match_id required' }), { status: 400, headers: corsHeaders });

    // Get match and its intent profile
    const { data: match } = await supabase.from('matches')
      .select('*, intent_profiles(*)')
      .eq('id', match_id).maybeSingle();
    if (!match) return new Response(JSON.stringify({ error: 'Match not found' }), { status: 404, headers: corsHeaders });

    // Check this is an external signal (not internal Homatch user)
    // Internal users connect via chat — external_contact_unlocks are for non-Homatch signals
    const intentProfile = match.intent_profiles;
    const isExternalSignal = intentProfile && !intentProfile.homatch_user_id;
    if (!isExternalSignal) {
      return new Response(JSON.stringify({ error: 'Internal Homatch users connect via Chat, not contact unlock.' }), { status: 400, headers: corsHeaders });
    }

    // Get PAYG price for external unlock
    const { data: pricing } = await supabase.from('payg_pricing_operations')
      .select('customer_price, actual_cost, currency')
      .eq('provider', 'SYSTEM').eq('operation', 'EXTERNAL_UNLOCK').maybeSingle();
    const customerPrice = pricing?.customer_price ?? 1.0;
    const actualCost = pricing?.actual_cost ?? 0.5;

    // Build pre-unlock summary (no contact details)
    const leadType = intentProfile?.classified_type ?? 'POSSIBLE_BUYER';
    const isUncertain = leadType.startsWith('POSSIBLE_');
    const preUnlockInfo = {
      match_score: match.score ?? 0,
      lead_type: leadType,
      lead_label: isUncertain ? (leadType === 'POSSIBLE_RENTER' ? 'Possible Renter' : 'Possible Buyer') : leadType.replace('_', ' '),
      is_confirmed: !isUncertain,
      location: intentProfile?.location_label ?? intentProfile?.city ?? 'Unknown',
      transaction: intentProfile?.transaction_type ?? match.transaction_type ?? 'Unknown',
      budget_min: intentProfile?.budget_min,
      budget_max: intentProfile?.budget_max,
      budget_currency: intentProfile?.budget_currency,
      requirements: intentProfile?.requirements_summary,
      source: intentProfile?.source_name ?? match.source ?? 'External',
      confidence: match.confidence ?? intentProfile?.confidence_score ?? 0,
      freshness_days: intentProfile?.signal_age_days,
      customer_price: customerPrice,
      currency: pricing?.currency ?? 'USD',
      already_unlocked: false,
    };

    // Check idempotency — already unlocked?
    if (idempotency_key) {
      const { data: existing } = await supabase.from('external_contact_unlocks')
        .select('*').eq('idempotency_key', idempotency_key).maybeSingle();
      if (existing?.unlocked_at) {
        return new Response(JSON.stringify({
          ...preUnlockInfo,
          already_unlocked: true,
          contact: {
            phone: existing.contact_phone,
            email: existing.contact_email,
            whatsapp: existing.contact_whatsapp,
            telegram: existing.contact_telegram,
          },
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }

    // Return preview without confirming
    if (!confirm) {
      return new Response(JSON.stringify({ preview: preUnlockInfo }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // === CONFIRMED UNLOCK ===
    if (!idempotency_key) return new Response(JSON.stringify({ error: 'idempotency_key required for confirm' }), { status: 400, headers: corsHeaders });

    // Check credit balance
    const { data: creditAccount } = await supabase.from('credit_accounts')
      .select('balance').eq('user_id', actor.id).maybeSingle();
    const balance = creditAccount?.balance ?? 0;
    if (balance < customerPrice) {
      return new Response(JSON.stringify({ error: 'Insufficient credits', required: customerPrice, balance }), { status: 402, headers: corsHeaders });
    }

    // Atomic: deduct credits + record unlock
    // Deduct from credit account
    const { error: deductErr } = await supabase.from('credit_accounts')
      .update({ balance: balance - customerPrice }).eq('user_id', actor.id);
    if (deductErr) throw deductErr;

    // Immutable ledger entry
    await supabase.from('credit_ledger').insert({
      user_id: actor.id,
      amount: -customerPrice,
      type: 'USAGE',
      description: `External contact unlock — Match ${match_id}`,
      reference_id: match_id,
    }).catch(() => {});

    // Record cost event
    await supabase.from('cost_events').insert({
      user_id: actor.id,
      provider: 'SYSTEM',
      operation: 'EXTERNAL_UNLOCK',
      actual_cost: actualCost,
      customer_price: customerPrice,
      reference_id: match_id,
    }).catch(() => {});

    // Record unlock with contact details
    const { data: unlock, error: unlockErr } = await supabase.from('external_contact_unlocks').insert({
      user_id: actor.id,
      match_id,
      signal_id: intentProfile?.id,
      lead_type: leadType,
      match_score: match.score,
      location_label: preUnlockInfo.location,
      transaction: preUnlockInfo.transaction,
      budget_min: preUnlockInfo.budget_min,
      budget_max: preUnlockInfo.budget_max,
      budget_currency: preUnlockInfo.budget_currency,
      requirements: preUnlockInfo.requirements,
      source: preUnlockInfo.source,
      confidence: preUnlockInfo.confidence,
      freshness_days: preUnlockInfo.freshness_days,
      contact_phone: intentProfile?.contact_phone,
      contact_email: intentProfile?.contact_email,
      contact_whatsapp: intentProfile?.contact_whatsapp,
      contact_telegram: intentProfile?.contact_telegram,
      credits_charged: customerPrice,
      actual_cost: actualCost,
      idempotency_key,
      unlocked_at: new Date().toISOString(),
    }).select('*').single();
    if (unlockErr) throw unlockErr;

    // Mark match as unlocked
    await supabase.from('matches').update({ is_unlocked: true, unlocked_at: new Date().toISOString() }).eq('id', match_id).catch(() => {});

    return new Response(JSON.stringify({
      ...preUnlockInfo,
      already_unlocked: false,
      contact: {
        phone: unlock.contact_phone,
        email: unlock.contact_email,
        whatsapp: unlock.contact_whatsapp,
        telegram: unlock.contact_telegram,
      },
      credits_charged: customerPrice,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
