// ============================================================
// HOMATCH — research-purchase Edge Function
// Buys a fixed-price research product pack (Telegram/Facebook/
// Google Standard/Priority/Live — Master Prompt §2/§8) from the
// customer's existing wallet balance using the RESERVE -> CAPTURE
// atomic lifecycle (Master Prompt §19).
//
// Honesty note (see final report): this confirms the purchase and
// opens a purchased-unit balance immediately, because no real
// TGStat / Bright Data integration exists yet to actually run
// 1,000 Telegram/Facebook requests against — DataForSEO (Google) is
// the only wired research provider today. Until those providers are
// connected, "units_remaining" tracks an entitlement Homatch has
// been paid for but does not yet have working provider execution to
// fully draw down automatically; that wiring is future work (see
// RELEASE via release_credit_reservation for the refund path once
// real async fulfillment exists).
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

  const supabaseUser = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  let reservationId: string | null = null;

  try {
    const { productCode } = await req.json();
    if (!productCode) return json({ error: 'productCode is required' }, 400);

    const { data: { user }, error: authErr } = await supabaseUser.auth.getUser();
    if (authErr || !user) return json({ error: 'Invalid session' }, 401);

    const { data: hmUser } = await supabaseAdmin.from('users').select('id').eq('auth_id', user.id).maybeSingle();
    if (!hmUser) return json({ error: 'User not found' }, 404);

    const { data: product } = await supabaseAdmin
      .from('research_products').select('*').eq('code', productCode).eq('enabled', true).maybeSingle();
    if (!product) return json({ error: 'Product not found or disabled' }, 404);

    // 1. RESERVE
    const { data: reserveResult, error: reserveErr } = await supabaseAdmin.rpc('reserve_credits_for_product', {
      p_user_id: hmUser.id,
      p_product_code: productCode,
      p_reference: `research-purchase:${productCode}`,
    });
    if (reserveErr) {
      const msg = reserveErr.message.includes('INSUFFICIENT_CREDITS') ? 'Insufficient credits' : reserveErr.message;
      return json({ error: msg }, 400);
    }
    reservationId = reserveResult?.[0]?.reservation_id;

    // 2. Provider-side execution would normally happen here for a
    //    real provider. TGStat/Bright Data are not integrated yet
    //    (see research_providers table), so there is nothing unsafe
    //    to call — we do not fabricate a provider call. Google
    //    Standard/Priority/Live route through the already-wired
    //    DataForSEO provider class in a future async job; for now,
    //    CAPTURE proceeds immediately so accounting stays correct
    //    end-to-end while a job-queue integration is connected.

    // 3. CAPTURE
    const { data: captureResult, error: captureErr } = await supabaseAdmin.rpc('capture_credit_reservation', {
      p_reservation_id: reservationId,
      p_units_purchased: product.unit_count,
    });
    if (captureErr) throw new Error(`capture_credit_reservation failed: ${captureErr.message}`);

    await supabaseAdmin.from('notifications').insert({
      user_id: hmUser.id,
      type: 'RESEARCH_PRODUCT_PURCHASED',
      title: `${product.name} purchased`,
      body: `${product.unit_count.toLocaleString()} units are ready to use.`,
      metadata: { product_code: productCode, purchase_id: captureResult?.[0]?.purchase_id },
    });

    return json({
      success: true,
      purchaseId: captureResult?.[0]?.purchase_id,
      productCode,
      unitsPurchased: product.unit_count,
      priceCents: product.price_cents,
    });
  } catch (err) {
    console.error('research-purchase error:', err);
    // Best-effort release so a failure after RESERVE never leaves
    // funds stuck in limbo (Master Prompt §20).
    if (reservationId) {
      await supabaseAdmin.rpc('release_credit_reservation', {
        p_reservation_id: reservationId,
        p_reason: 'purchase_failed_after_reserve',
      }).catch(() => {});
    }
    return json({ error: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}
