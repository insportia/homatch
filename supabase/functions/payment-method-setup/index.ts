// ============================================================
// HOMATCH — payment-method-setup
//
// Stores a reusable payment method with no money captured, and grants the
// one-time activation bonus once the PROVIDER confirms the method exists.
//
// THE ONE RULE THIS FUNCTION EXISTS TO ENFORCE
//
// The bonus is paid for a card that is actually stored, and the only thing
// that knows whether a card is actually stored is the provider. So the client
// never reports success. It hands back a setup id, and this function asks the
// provider directly what happened. A browser that lies about completing the
// flow gets the same answer as a browser that never started it.
//
// WHY IT CAN REFUSE TO START AT ALL
//
// The offer says "$0 charged now". That promise is only keepable where the
// provider can store a card without capturing money, so the capability is
// checked BEFORE the customer is sent anywhere. Where it cannot be kept, this
// returns SETUP_UNSUPPORTED with the provider's own capability report and the
// customer is shown nothing. Faking the flow against a provider that would
// actually charge them is the failure this guard exists to prevent.
//
// PRODUCTION TODAY: no provider is configured, so getPaymentProvider() returns
// the mock, whose zeroAmountSetup is 'unknown' and whose stored-method read is
// always null. Both gates below therefore refuse, on purpose. This is the
// architecture being honest rather than the feature being broken.
// ============================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { getPaymentProvider } from '../_shared/payment_provider.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Unauthorized' }, 401);

  const url = Deno.env.get('SUPABASE_URL')!;
  const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

  try {
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: 'Invalid session' }, 401);

    const { data: hmUser } = await admin
      .from('users').select('id, email').eq('auth_id', user.id).maybeSingle();
    if (!hmUser) return json({ error: 'User not found' }, 404);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? 'start');
    const provider = getPaymentProvider();
    const caps = provider.capabilities();

    // ── capabilities: what Admin reads, and what the client may check ──
    if (action === 'capabilities') {
      return json({ provider: provider.name, capabilities: caps });
    }

    // ── start ─────────────────────────────────────────────────────────
    if (action === 'start') {
      if (caps.zeroAmountSetup !== true) {
        /* Not an error in the code -- an honest answer about the provider.
           The client must not render a "$0 charged now" promise on top of
           this, and the shape says so plainly rather than returning 500. */
        return json({
          ok: false,
          code: 'SETUP_UNSUPPORTED',
          provider: provider.name,
          simulated: caps.simulated,
          capabilities: caps,
          message: caps.simulated
            ? 'No payment provider is configured, so a card cannot be stored.'
            : 'The configured payment provider cannot store a card without charging it.',
        }, 200);
      }

      const { data: enabled } = await admin
        .from('admin_settings').select('value').eq('key', 'card_activation_bonus_enabled').maybeSingle();
      if (enabled && enabled.value === false) {
        return json({ ok: false, code: 'PROMOTION_DISABLED' }, 200);
      }

      const setup = await provider.createSetup({
        userId: hmUser.id,
        customerEmail: hmUser.email ?? undefined,
        returnUrl: String(body?.returnUrl ?? ''),
        cancelUrl: String(body?.cancelUrl ?? ''),
        metadata: { homatch_user_id: hmUser.id, purpose: 'CARD_ACTIVATION' },
      });

      /* Recorded as PENDING. A pending row is not a payment method and is
         never eligible for the bonus -- billing_grant_card_activation
         refuses anything that is not ACTIVE. */
      await admin.from('payment_methods').insert({
        user_id: hmUser.id,
        provider: provider.name,
        provider_method_ref: setup.providerSetupId,
        status: 'PENDING',
        setup_mode: setup.setupMode,
        metadata: { stage: 'SETUP_STARTED' },
      });
      await admin.from('promotion_funnel_events').insert({
        user_id: hmUser.id, promo_code: 'CARD_ACTIVATION', step: 'SETUP_STARTED',
        metadata: { provider: provider.name, setup_id: setup.providerSetupId },
      });

      return json({ ok: true, setupUrl: setup.setupUrl, setupId: setup.providerSetupId, mock: setup.mock });
    }

    // ── confirm ───────────────────────────────────────────────────────
    //
    // Called when the customer returns, and safe to call again: every write
    // below is keyed, and the grant is idempotent three ways over.
    if (action === 'confirm') {
      const setupId = String(body?.setupId ?? '');
      if (!setupId) return json({ error: 'setupId required' }, 400);

      /* The pending row must belong to THIS user. Otherwise a customer could
         confirm somebody else's setup and claim a bonus against it. */
      const { data: pending } = await admin
        .from('payment_methods')
        .select('id, user_id, status')
        .eq('provider_method_ref', setupId)
        .eq('user_id', hmUser.id)
        .maybeSingle();
      if (!pending) return json({ ok: false, code: 'UNKNOWN_SETUP' }, 404);

      const stored = await provider.getStoredPaymentMethod(setupId);
      if (!stored) {
        await admin.from('payment_methods')
          .update({ status: 'FAILED', failure_reason: 'PROVIDER_REPORTED_NO_STORED_METHOD' })
          .eq('id', pending.id).eq('status', 'PENDING');
        await admin.from('promotion_funnel_events').insert({
          user_id: hmUser.id, promo_code: 'CARD_ACTIVATION', step: 'SETUP_FAILED',
          metadata: { setup_id: setupId, reason: 'NO_STORED_METHOD' },
        });
        return json({ ok: false, code: 'NOT_STORED', granted: false }, 200);
      }

      /* The row now carries the provider's real method reference rather than
         the setup-session id it was created with. */
      const { error: upErr } = await admin.from('payment_methods').update({
        provider_method_ref: stored.providerMethodRef,
        provider_customer_ref: stored.providerCustomerRef,
        instrument_fingerprint: stored.instrumentFingerprint,
        brand: stored.brand,
        last4: stored.last4,
        exp_month: stored.expMonth,
        exp_year: stored.expYear,
        status: 'ACTIVE',
        is_default: true,
        activated_at: new Date().toISOString(),
        metadata: { stage: 'SETUP_SUCCEEDED', setup_session: setupId },
      }).eq('id', pending.id);
      if (upErr) throw upErr;

      await admin.from('promotion_funnel_events').insert({
        user_id: hmUser.id, promo_code: 'CARD_ACTIVATION', step: 'SETUP_SUCCEEDED',
        metadata: { setup_id: setupId, brand: stored.brand, last4: stored.last4 },
      });

      const { data: grant, error: grantErr } = await admin.rpc('billing_grant_card_activation', {
        p_user_id: hmUser.id,
        p_payment_method_id: pending.id,
      });
      if (grantErr) throw grantErr;

      return json({
        ok: true,
        card: { brand: stored.brand, last4: stored.last4 },
        granted: !!grant?.granted,
        credits: grant?.credits ?? 0,
        balanceAfter: grant?.balance_after ?? null,
        reason: grant?.reason ?? null,
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
