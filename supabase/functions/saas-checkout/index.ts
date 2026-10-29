// ============================================================
// HOMATCH — saas-checkout: subscription checkout (owner decision 2026-10-29)
//
//   plans             public: the three plans (prices from saas_plans) + which providers work
//   create            choose a plan -> saas_checkout_create (price from the DB, never the request)
//                     -> provider.createSession -> redirect URL
//   status            the "confirming payment" page polls this. It NEVER trusts the redirect:
//                     access exists only once a verified provider event was applied
//                     (saas-payments-webhook). Providers with lookup are asked here too, and their
//                     answer goes through the same normalised apply.
//   sandbox-complete  TEST provider only, admins only: signs a sandbox event and runs it through
//                     the same webhook path a bank's callback takes.
//
// OWNER RULE (2026-10-29): no mock or sandbox provider ever stands in for a real bank. Customers are
// sent only to the LIVE provider named in admin_settings.saas_default_payment_provider (NONE until a
// bank is contracted); with none configured, checkout answers PAYMENTS_NOT_CONNECTED and the page
// says so. SANDBOX is admin-only, labelled everywhere, and its events cannot grant a subscription in
// production (saas_payment_event_apply). Until a bank is live, the audited admin support grant is
// the only way to activate a plan.
// ============================================================

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { refuseIfImpersonating } from '../_shared/impersonation.ts';
import {
  adapterFor, applyPaymentEvent, callbackUrlFor, isProviderId, processWebhook, PROVIDERS, SANDBOX_SIGNATURE_HEADER, signSandboxEvent,
  type ProviderId,
} from '../_shared/saasPayments/index.ts';

const APP_URL_DEFAULT = 'https://www.homatch.live';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}

// deno-lint-ignore no-explicit-any
async function setting(sb: any, key: string): Promise<unknown> {
  const { data } = await sb.from('admin_settings').select('value').eq('key', key).maybeSingle();
  return data?.value;
}

// deno-lint-ignore no-explicit-any
async function adapterContext(sb: any) {
  const v = await setting(sb, 'saas_sandbox_payments_enabled');
  return { sandboxEnabled: v === true || v === 'true', appUrl: Deno.env.get('APP_URL') ?? APP_URL_DEFAULT };
}

/** The provider customers pay with: the configured, non-test provider the owner selected, or null. */
// deno-lint-ignore no-explicit-any
async function liveProvider(sb: any, ctx: { sandboxEnabled: boolean; appUrl: string }): Promise<ProviderId | null> {
  const def = await setting(sb, 'saas_default_payment_provider');
  if (!isProviderId(def) || def === 'SANDBOX') return null;
  const caps = adapterFor(def, ctx).capabilities();
  return caps.configured && !caps.test ? def : null;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const url = Deno.env.get('SUPABASE_URL')!;
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action ?? '');
    const ctx = await adapterContext(admin);

    if (action === 'plans') {
      const { data, error } = await admin.rpc('saas_public_plans');
      if (error) return json({ error: 'PLANS_UNAVAILABLE' }, 503);
      // Customers learn only whether online payment works and whether auto-renew is offered; the
      // admin view (admin-providers) shows which secrets are missing.
      const live = await liveProvider(admin, ctx);
      return json({
        ...(data as Record<string, unknown>),
        paymentsConnected: live !== null,
        liveProvider: live,
        autoRenewAvailable: live !== null && adapterFor(live, ctx).capabilities().recurring,
      });
    }

    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: 'UNAUTHORIZED' }, 401);
    const { data: hmUser } = await admin.from('users').select('id, email, is_admin, suspended_at').eq('auth_id', user.id).maybeSingle();
    if (!hmUser) return json({ error: 'USER_NOT_FOUND' }, 404);

    if (action === 'create') {
      const impersonating = await refuseIfImpersonating(admin, authHeader, CORS);
      if (impersonating) return impersonating;
      const planCode = String(body?.planCode ?? '');
      let provider: ProviderId;
      if (body?.provider === 'SANDBOX') {
        // Test checkouts: admins only, never a customer's way to a plan.
        if (!hmUser.is_admin) return json({ error: 'SANDBOX_ADMIN_ONLY' }, 403);
        provider = 'SANDBOX';
      } else {
        const live = await liveProvider(admin, ctx);
        if (!live) return json({ error: 'PAYMENTS_NOT_CONNECTED' }, 503);
        provider = live;
      }
      const adapter = adapterFor(provider, ctx);
      if (!adapter.capabilities().configured) return json({ error: provider === 'SANDBOX' ? 'PROVIDER_NOT_CONFIGURED' : 'PAYMENTS_NOT_CONNECTED', provider }, 503);

      const autoRenew = body?.autoRenew === true && adapter.capabilities().recurring;
      const { data: co, error } = await admin.rpc('saas_checkout_create', { p_user_id: hmUser.id, p_plan_code: planCode, p_provider: provider, p_auto_renew: autoRenew });
      if (error) return json({ error: 'CHECKOUT_FAILED' }, 500);
      if (!co?.ok) return json({ error: co?.reason ?? 'CHECKOUT_REFUSED', ...co }, 409);

      const appUrl = ctx.appUrl.replace(/\/$/, '');
      const session = await adapter.createSession({
        checkoutId: co.checkoutId, amountTetri: co.amountTetri, currency: 'GEL', planCode: co.planCode,
        description: `HOMATCH ${co.planCode}`, customerEmail: hmUser.email ?? null,
        // Both land on the confirming page, which asks the server; neither grants anything.
        returnUrl: `${appUrl}/subscription/confirm?checkout=${co.checkoutId}`,
        cancelUrl: `${appUrl}/subscription/confirm?checkout=${co.checkoutId}&result=fail`,
        saveCard: autoRenew,
      });
      if (!session.ok) {
        await admin.from('saas_checkouts').update({ status: 'CANCELLED', failure_reason: session.reason, updated_at: new Date().toISOString() })
          .eq('id', co.checkoutId);
        return json({ error: session.reason === 'NOT_CONFIGURED' || session.reason === 'DISABLED' ? 'PROVIDER_NOT_CONFIGURED' : 'PROVIDER_ERROR' }, 503);
      }
      await admin.rpc('saas_checkout_attach', { p_checkout_id: co.checkoutId, p_provider_ref: session.sessionRef, p_redirect_url: session.redirectUrl });
      return json({
        checkoutId: co.checkoutId, kind: co.kind, planCode: co.planCode, amountTetri: co.amountTetri, currency: 'GEL',
        redirectUrl: session.redirectUrl, provider, sandbox: provider === 'SANDBOX',
      });
    }

    /* ── Admin: provider status, connectivity test (no charge), refunds ── */
    if (action === 'admin-providers' || action === 'admin-connectivity' || action === 'admin-refund') {
      if (!hmUser.is_admin) return json({ error: 'FORBIDDEN' }, 403);
      if (action === 'admin-providers') {
        const live = await liveProvider(admin, ctx);
        return json({
          liveProvider: live,
          sandboxGrantsAccess: false,
          appUrl: ctx.appUrl,
          providers: PROVIDERS.map((id) => ({
            id, ...adapterFor(id, ctx).capabilities(),
            callbackUrl: callbackUrlFor(id),
            successUrl: `${ctx.appUrl}/subscription/confirm?checkout={checkoutId}`,
            failUrl: `${ctx.appUrl}/subscription/confirm?checkout={checkoutId}&result=fail`,
          })),
        });
      }
      if (action === 'admin-connectivity') {
        if (!isProviderId(body?.provider)) return json({ error: 'UNKNOWN_PROVIDER' }, 400);
        const r = await adapterFor(body.provider, ctx).testConnectivity();
        await admin.from('admin_audit_log').insert({
          admin_id: hmUser.id, action: 'SAAS_PROVIDER_CONNECTIVITY_TEST', entity_type: 'payment_provider', entity_id: body.provider,
          metadata: { ok: r.ok, reason: r.ok ? null : r.reason, detail: r.detail ?? null },
        });
        return json(r);
      }
      // admin-refund
      const reason = String(body?.reason ?? '').trim();
      const target = String(body?.checkoutId ?? '');
      if (reason.length < 3) return json({ error: 'REASON_REQUIRED' }, 400);
      const { data: rc } = await admin.from('saas_checkouts').select('*').eq('id', target).maybeSingle();
      if (!rc || rc.status !== 'PAID' || !isProviderId(rc.provider) || !rc.provider_session_ref) return json({ error: 'NOT_REFUNDABLE' }, 409);
      const amount = Number.isInteger(body?.amountTetri) && body.amountTetri > 0 && body.amountTetri <= rc.amount_tetri ? body.amountTetri : rc.amount_tetri;
      const r = await adapterFor(rc.provider, ctx).refund(rc.provider_session_ref, amount);
      await admin.rpc('admin_saas_record_refund', {
        p_checkout_id: rc.id, p_amount_tetri: amount, p_ok: r.ok, p_refund_ref: r.ok ? r.refundRef : r.reason, p_reason: reason, p_admin: hmUser.id,
      });
      return json(r, r.ok ? 200 : 502);
    }

    const checkoutId = String(body?.checkoutId ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(checkoutId)) return json({ error: 'INVALID_CHECKOUT' }, 400);
    const { data: co } = await admin.from('saas_checkouts').select('*').eq('id', checkoutId).maybeSingle();
    if (!co || co.user_id !== hmUser.id) return json({ error: 'NOT_FOUND' }, 404);

    if (action === 'status') {
      let status = co.status as string;
      if (status === 'PENDING' && isProviderId(co.provider)) {
        const adapter = adapterFor(co.provider, ctx);
        if (adapter.capabilities().lookup && co.provider_session_ref) {
          const r = await adapter.lookupTransaction(co.provider_session_ref, co.id);
          if (r.ok && r.event) {
            await applyPaymentEvent(admin, r.event);
            const { data: again } = await admin.from('saas_checkouts').select('status').eq('id', co.id).maybeSingle();
            status = again?.status ?? status;
          }
        }
      }
      return json({ checkoutId: co.id, status, planCode: co.plan_code, kind: co.kind, amountTetri: co.amount_tetri, provider: co.provider, sandbox: co.provider === 'SANDBOX' });
    }

    if (action === 'sandbox-complete') {
      if (co.provider !== 'SANDBOX') return json({ error: 'NOT_SANDBOX' }, 400);
      // A test provider must never become a free subscription for a customer.
      if (!hmUser.is_admin) return json({ error: 'SANDBOX_ADMIN_ONLY' }, 403);
      const secret = Deno.env.get('SAAS_SANDBOX_SECRET');
      const adapter = adapterFor('SANDBOX', ctx);
      if (!secret || !adapter.capabilities().configured) return json({ error: 'PROVIDER_NOT_CONFIGURED' }, 503);
      const outcome = body?.outcome === 'fail' ? 'PAYMENT_FAILED' : 'PAYMENT_SUCCEEDED';
      const signed = await signSandboxEvent(secret, {
        eventId: `sbx_evt_${co.id}_${outcome}`, type: outcome, amountTetri: co.amount_tetri, currency: 'GEL', reference: co.id, test: true,
      });
      const r = await processWebhook(admin, adapter, signed.raw, new Headers({ [SANDBOX_SIGNATURE_HEADER]: signed.signature }));
      return json(r.body, r.status);
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    console.error('saas-checkout failed', e instanceof Error ? e.message : String(e));
    return json({ error: 'internal_error' }, 500);
  }
});
