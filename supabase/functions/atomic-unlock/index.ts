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

    // The price is only used for the INSUFFICIENT_CREDITS response and the
    // activity record; the charge itself is decided inside the transaction
    // from the row it holds a lock on, not from this read.
    const price = Number(match.unlock_price_credits);

    // The "already unlocked?" check lives inside the transaction now. Doing it
    // here as well would be a second answer to the same question, and the one
    // it used to give was worse -- it returned newBalance: null, so the screen
    // showed no balance after a repeat unlock.

    // ── ONE TRANSACTION ──────────────────────────────────────
    // This used to be three PostgREST round trips with hand-written
    // compensation: debit, then ledger, then unlock row, each rolling the
    // previous ones back by hand on failure.
    //
    // The debit was `.update({balance: newBalance}).eq('user_id', userId)
    // .eq('balance', balance)` and only its ERROR was checked. When the
    // optimistic guard did its job -- a concurrent unlock or top-up had moved
    // the balance -- the statement matched zero rows, and PostgREST answers a
    // zero-row UPDATE with 204 and no error. So the code carried on and wrote
    // the ledger entry, the unlock row and the full seller reveal without
    // having charged anything.
    //
    // atomic_match_unlock does all of it in one transaction with
    // SELECT ... FOR UPDATE on the credit account, and returns the reveal
    // payload itself. There is nothing left to compensate.
    const { data: rpcRows, error: rpcErr } = await supabaseAdmin.rpc('atomic_match_unlock', {
      p_user_id: userId,
      p_match_id: matchId,
    });

    if (rpcErr) {
      const code = rpcErr.message ?? '';
      if (code.includes('INSUFFICIENT_CREDITS')) {
        const { data: acct } = await supabaseAdmin
          .from('credit_accounts').select('balance').eq('user_id', userId).maybeSingle();
        const balance = Number(acct?.balance ?? 0);
        return json({
          error: 'INSUFFICIENT_CREDITS',
          required: price, balance, shortfall: price - balance,
        }, 402);
      }
      if (code.includes('NOT_YOUR_PROPERTY')) return json({ error: 'You do not own this property' }, 403);
      if (code.includes('MATCH_NOT_FOUND')) return json({ error: 'Match not found' }, 404);
      if (code.includes('CREDIT_ACCOUNT_NOT_FOUND')) return json({ error: 'No credit account' }, 404);
      console.error('atomic-unlock rpc failed:', rpcErr.message);
      // Nothing was charged: the whole transaction rolled back.
      return json({ error: 'Unlock failed, no credits were charged' }, 500);
    }

    const row = Array.isArray(rpcRows) ? rpcRows[0] : rpcRows;
    if (!row) return json({ error: 'Unlock failed, no credits were charged' }, 500);

    const newBalance = Number(row.balance_after);
    const unlock = {
      id: row.unlock_id,
      credits_charged: Number(row.credits_charged),
      full_signal_text: row.full_signal_text,
      full_source_url: row.full_source_url,
      full_profile_url: row.full_profile_url,
      full_intent_json: row.full_intent_json,
    };

    // The RPC returns the existing unlock rather than charging twice; say so.
    if (row.already_unlocked) {
      return json({ success: true, alreadyUnlocked: true, unlock, newBalance });
    }

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
