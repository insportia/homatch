// ============================================================
// HOMATCH — atomic-unlock Edge Function
// Server-side unlock with full redaction before payment,
// full reveal after. Uses RPC for atomic credit debit.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  // User-scoped client for ownership verification
  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  // Service-role client for atomic ops
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const { matchId } = await req.json();
    if (!matchId) return json({ error: 'matchId required' }, 400);

    // Verify session
    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) return json({ error: 'Invalid session' }, 401);

    // Get homatch user
    const { data: hmUser } = await supabaseAdmin
      .from('users')
      .select('id')
      .eq('auth_id', user.id)
      .maybeSingle();
    if (!hmUser) return json({ error: 'User not found' }, 404);

    const userId = hmUser.id;

    // Load match — verify it belongs to user's property
    const { data: match } = await supabaseAdmin
      .from('matches')
      .select(`
        id, property_id, signal_id, intent_profile_id,
        unlock_price_credits, status,
        properties!property_id(user_id)
      `)
      .eq('id', matchId)
      .maybeSingle();

    if (!match) return json({ error: 'Match not found' }, 404);

    const propOwner = (match.properties as { user_id?: string })?.user_id;
    if (propOwner !== userId) {
      return json({ error: 'You do not own this property' }, 403);
    }

    // Check already unlocked
    const { data: existingUnlock } = await supabaseAdmin
      .from('match_unlocks')
      .select(`
        id, credits_charged,
        full_signal_text, full_source_url, full_profile_url, full_intent_json
      `)
      .eq('match_id', matchId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existingUnlock) {
      // Already unlocked — return full data without charging again
      return json({
        success: true,
        alreadyUnlocked: true,
        unlock: existingUnlock,
        newBalance: null,
      });
    }

    const price = Number(match.unlock_price_credits);

    // Check credit balance
    const { data: creditAccount } = await supabaseAdmin
      .from('credit_accounts')
      .select('balance')
      .eq('user_id', userId)
      .maybeSingle();

    const balance = Number(creditAccount?.balance ?? 0);
    if (balance < price) {
      return json({
        error: 'INSUFFICIENT_CREDITS',
        required: price,
        balance,
        shortfall: price - balance,
      }, 402);
    }

    // For mock matches, fetch pre-populated reveal data from match_unlocks_pending
    const isMock = !!(match as any).mock_mode;
    let pendingReveal: {
      full_signal_text: string | null;
      full_source_url: string | null;
      full_profile_url: string | null;
      full_intent_json: Record<string, unknown> | null;
    } | null = null;

    if (isMock) {
      const { data: pending } = await supabaseAdmin
        .from('match_unlocks_pending')
        .select('full_signal_text, full_source_url, full_profile_url, full_intent_json')
        .eq('match_id', matchId)
        .maybeSingle();
      pendingReveal = pending ?? null;
    }

    // Load full signal data for reveal (real mode, or mock fallback via raw_signals)
    const [signalRes, intentRes] = await Promise.all([
      match.signal_id
        ? supabaseAdmin
            .from('raw_signals')
            .select('original_text, source_url, author_public_name, author_public_url, platform, intent_json, profile_url')
            .eq('id', match.signal_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      match.intent_profile_id
        ? supabaseAdmin
            .from('intent_profiles')
            .select('*')
            .eq('id', match.intent_profile_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const signal = signalRes.data;
    const intentProfile = intentRes.data;

    // ── ATOMIC DEBIT ─────────────────────────────────────────
    const newBalance = balance - price;

    // 1. Debit credit account
    const { error: debitErr } = await supabaseAdmin
      .from('credit_accounts')
      .update({ balance: newBalance })
      .eq('user_id', userId)
      .eq('balance', balance); // Optimistic lock

    if (debitErr) {
      return json({ error: 'Credit debit failed, please retry' }, 409);
    }

    // 2. Write ledger entry
    const { data: ledgerEntry, error: ledgerErr } = await supabaseAdmin
      .from('credit_ledger')
      .insert({
        user_id: userId,
        amount: -price,
        balance_before: balance,
        balance_after: newBalance,
        type: 'MATCH_UNLOCK',
        reference: `match:${matchId}`,
      })
      .select('id')
      .maybeSingle();

    if (ledgerErr) {
      // Rollback debit
      await supabaseAdmin
        .from('credit_accounts')
        .update({ balance })
        .eq('user_id', userId);
      return json({ error: 'Ledger write failed' }, 500);
    }

    // 3. Create unlock record with FULL data
    // Priority: mock pending table > raw_signals > intent_profiles
    const fullSignalText = pendingReveal?.full_signal_text
      ?? signal?.original_text
      ?? null;
    const fullSourceUrl = pendingReveal?.full_source_url
      ?? signal?.source_url
      ?? null;
    const fullProfileUrl = pendingReveal?.full_profile_url
      ?? signal?.author_public_url
      ?? (signal as any)?.profile_url
      ?? null;
    const fullIntentJson = pendingReveal?.full_intent_json
      ?? intentProfile
      ?? (signal as any)?.intent_json
      ?? null;

    const { data: unlock, error: unlockErr } = await supabaseAdmin
      .from('match_unlocks')
      .insert({
        match_id: matchId,
        user_id: userId,
        credits_charged: price,
        ledger_entry_id: ledgerEntry?.id ?? null,
        // Full reveal — only ever stored/returned here
        full_signal_text: fullSignalText,
        full_source_url: fullSourceUrl,
        full_profile_url: fullProfileUrl,
        full_intent_json: fullIntentJson,
      })
      .select('id, credits_charged, full_signal_text, full_source_url, full_profile_url, full_intent_json')
      .maybeSingle();

    if (unlockErr) {
      // Rollback: restore balance and remove ledger entry
      await supabaseAdmin.from('credit_accounts').update({ balance }).eq('user_id', userId);
      await supabaseAdmin.from('credit_ledger').delete().eq('id', ledgerEntry?.id);
      return json({ error: 'Unlock record creation failed' }, 500);
    }

    // 4. Update match status + consume pending row
    await Promise.all([
      supabaseAdmin
        .from('matches')
        .update({ status: 'UNLOCKED' })
        .eq('id', matchId),
      // Delete the pending reveal row — it's been consumed
      isMock
        ? supabaseAdmin
            .from('match_unlocks_pending')
            .delete()
            .eq('match_id', matchId)
        : Promise.resolve(),
    ]);

    // 5. Activity + Notification
    await supabaseAdmin.from('activity_events').insert({
      user_id: userId,
      property_id: match.property_id,
      event_type: 'MATCH_UNLOCKED',
      metadata: { match_id: matchId, credits_charged: price },
    });

    await supabaseAdmin.from('cost_events').insert({
      provider: 'OTHER',
      operation_type: 'MATCH_UNLOCK',
      units: 1,
      cost_usd: 0, // Revenue tracked separately
      success: true,
      cache_hit: false,
      property_id: match.property_id,
      signal_id: match.signal_id ?? null,
    });

    return json({
      success: true,
      alreadyUnlocked: false,
      unlock,
      newBalance,
    });
  } catch (err) {
    console.error('atomic-unlock error:', err);
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
