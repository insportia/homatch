// ============================================================
// HOMATCH — saas-payments-webhook: the ONE door subscription payments enter by.
//
// POST /saas-payments-webhook?provider=SANDBOX|BOG|TBC
//
// No user JWT (a bank is not a user): the adapter verifies the provider's own signature, and an
// unverified request changes nothing (401). A verified event is normalised and applied by
// saas_payment_event_apply(), idempotent on (provider, eventId): a redelivered callback answers
// with what the first delivery decided and grants nothing twice. Amount and currency must equal
// the checkout's, or the checkout is marked AMOUNT_MISMATCH and no access is granted.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { adapterFor, isProviderId, processWebhook } from '../_shared/saasPayments/index.ts';

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}

serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  const provider = new URL(req.url).searchParams.get('provider')?.toUpperCase();
  if (!isProviderId(provider)) return json({ error: 'UNKNOWN_PROVIDER' }, 404);
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const raw = await req.text();
    if (raw.length > 64_000) return json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
    const { data: flag } = await admin.from('admin_settings').select('value').eq('key', 'saas_sandbox_payments_enabled').maybeSingle();
    const adapter = adapterFor(provider, {
      sandboxEnabled: flag?.value === true || flag?.value === 'true',
      appUrl: Deno.env.get('APP_URL') ?? 'https://www.homatch.live',
    });
    const r = await processWebhook(admin, adapter, raw, req.headers);
    return json(r.body, r.status);
  } catch (e) {
    console.error('saas-payments-webhook failed', e instanceof Error ? e.message : String(e));
    return json({ error: 'internal_error' }, 500);
  }
});
