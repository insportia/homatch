// HOMATCH — provider health and connectivity, for Admin.
//
// §57: "Provide safe 'Test connection' action for admins. Never use a smoke
// test that creates expensive real outbound actions unless explicitly
// designed/safeguarded."
//
// Every probe below is authenticated, read-only and free:
//
//   Cartesia   GET /voices?limit=1   proves the key works. Synthesises nothing.
//   Vapi       GET /assistant?limit=1 proves the key works. Places no call.
//   Meta       GET the phone number and the WABA. Sends no message.
//
// There is deliberately no "send me a test message" button here. A test that
// costs money is a test an admin learns not to press, and a test that messages
// a real number is one that eventually messages the wrong one.
//
// §54 and §139: this returns whether a credential EXISTS. It never returns a
// credential, and it never returns a provider's raw error body, which can echo
// a request containing a phone number.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { requireAdmin, json, preflight, logEvent } from '../_shared/comm/auth.ts';
import { createCartesiaProvider, cartesiaCredentialsPresent, CARTESIA_VERSION } from '../_shared/comm/cartesia.ts';
import { vapiPing, vapiCredentialsPresent, listVapiPhoneNumbers } from '../_shared/comm/vapi.ts';
import {
  createMetaProvider, metaConfigFromEnv, metaCredentialsPresent,
  metaWebhookSecretsPresent, META_API_VERSION,
} from '../_shared/comm/meta.ts';
import { hasSecret } from '../_shared/comm/contracts.ts';

type Health = 'HEALTHY' | 'DEGRADED' | 'DOWN' | 'DISABLED' | 'NOT_CONFIGURED';

interface ProviderReport {
  provider: string;
  roles: string[];
  health: Health;
  /** Names only. Never values. */
  credentials: Array<{ name: string; present: boolean }>;
  latencyMs: number | null;
  lastTestedAt: string;
  detail: string | null;
  errorCode: string | null;
  facts: Record<string, unknown> | null;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflight();
  if (req.method !== 'GET' && req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const admin = await requireAdmin(req);
  if (!admin) return json({ error: 'forbidden' }, 403);
  const { sb, caller } = admin;

  const url = new URL(req.url);
  const only = url.searchParams.get('provider');
  // A GET reads what is already stored. A POST actually probes. Loading the
  // Admin page must not fire three live provider calls every time.
  const probe = req.method === 'POST';

  const { data: routes } = await sb.from('comm_provider_routes')
    .select('role, provider, enabled, kill_switch, priority, credential_env_names, config, last_success_at, last_error_at, last_error, last_latency_ms')
    .order('role').order('priority');

  const reports: ProviderReport[] = [];
  const wanted = (name: string) => !only || only.toUpperCase() === name;

  if (wanted('CARTESIA')) reports.push(await checkCartesia(probe, routes ?? []));
  if (wanted('VAPI'))     reports.push(await checkVapi(probe, routes ?? []));
  if (wanted('META'))     reports.push(await checkMeta(probe, routes ?? [], sb));

  if (probe) {
    for (const r of reports) {
      await sb.from('comm_provider_routes')
        .update({
          last_success_at: r.health === 'HEALTHY' ? r.lastTestedAt : undefined,
          last_error_at: r.health === 'DOWN' || r.health === 'DEGRADED' ? r.lastTestedAt : undefined,
          last_error: r.errorCode,
          last_latency_ms: r.latencyMs,
        })
        .eq('provider', r.provider);

      // provider_health is what the existing Admin diagnostics page reads.
      // Written here so communications providers appear beside the rest rather
      // than in a parallel screen (§105).
      await sb.from('provider_health').upsert({
        provider: r.provider,
        status: r.health,
        last_tested_at: r.lastTestedAt,
        last_success_at: r.health === 'HEALTHY' ? r.lastTestedAt : undefined,
        latency_ms: r.latencyMs,
        last_error: r.errorCode,
        updated_at: r.lastTestedAt,
      }, { onConflict: 'provider' });
    }

    // §87: a manual provider probe is an admin action and is audited.
    await sb.from('admin_audit_log').insert({
      admin_id: caller.userId,
      action: 'COMM_PROVIDER_TEST',
      entity_type: 'PROVIDER',
      entity_id: only ?? 'ALL',
      metadata: { results: reports.map((r) => ({ provider: r.provider, health: r.health })) },
    });

    logEvent('provider-status', 'probed', { count: reports.length, by: caller.userId });
  }

  return json({
    ok: true,
    probed: probe,
    providers: reports,
    routes: (routes ?? []).map((r) => ({
      role: r.role,
      provider: r.provider,
      enabled: r.enabled,
      killSwitch: r.kill_switch,
      priority: r.priority,
      // The BOOLEAN, never the value (§54).
      credentialsPresent: (r.credential_env_names ?? []).every((n: string) => hasSecret(n)),
      credentialNames: r.credential_env_names ?? [],
      config: r.config,
      lastSuccessAt: r.last_success_at,
      lastErrorAt: r.last_error_at,
      lastError: r.last_error,
      lastLatencyMs: r.last_latency_ms,
    })),
  });
});

type Route = Record<string, unknown>;

function rolesFor(routes: Route[], provider: string): string[] {
  return routes.filter((r) => r.provider === provider).map((r) => String(r.role));
}

function disabledByAdmin(routes: Route[], provider: string): boolean {
  const mine = routes.filter((r) => r.provider === provider);
  return mine.length > 0 && mine.every((r) => r.kill_switch === true || r.enabled === false);
}

async function checkCartesia(probe: boolean, routes: Route[]): Promise<ProviderReport> {
  const creds = cartesiaCredentialsPresent();
  const base: ProviderReport = {
    provider: 'CARTESIA',
    roles: rolesFor(routes, 'CARTESIA'),
    health: !creds.ok ? 'NOT_CONFIGURED' : disabledByAdmin(routes, 'CARTESIA') ? 'DISABLED' : 'HEALTHY',
    credentials: [{ name: 'CARTESIA_API_KEY', present: creds.ok }],
    latencyMs: null,
    lastTestedAt: new Date().toISOString(),
    detail: null,
    errorCode: null,
    facts: { apiVersion: CARTESIA_VERSION },
  };
  if (!probe || !creds.ok) return base;

  const ping = await createCartesiaProvider().ping();
  return {
    ...base,
    health: ping.ok ? (base.health === 'DISABLED' ? 'DISABLED' : 'HEALTHY') : 'DOWN',
    latencyMs: ping.latencyMs ?? null,
    detail: ping.ok ? ping.data?.detail ?? null : null,
    errorCode: ping.ok ? null : (ping.error?.code ?? 'UNKNOWN'),
  };
}

async function checkVapi(probe: boolean, routes: Route[]): Promise<ProviderReport> {
  const creds = vapiCredentialsPresent();
  const base: ProviderReport = {
    provider: 'VAPI',
    roles: rolesFor(routes, 'VAPI'),
    health: !creds.ok ? 'NOT_CONFIGURED' : disabledByAdmin(routes, 'VAPI') ? 'DISABLED' : 'HEALTHY',
    credentials: [
      { name: 'VAPI_PRIVATE_API_KEY', present: creds.ok },
      // Its absence is not a failure to connect; it is a gap in webhook
      // authentication, and §100-style honesty means saying so rather than
      // showing a green tick.
      { name: 'VAPI_WEBHOOK_SECRET', present: hasSecret('VAPI_WEBHOOK_SECRET') },
    ],
    latencyMs: null,
    lastTestedAt: new Date().toISOString(),
    detail: null,
    errorCode: null,
    facts: null,
  };
  if (!probe || !creds.ok) return base;

  const ping = await vapiPing();
  const numbers = ping.ok ? await listVapiPhoneNumbers() : null;

  return {
    ...base,
    health: ping.ok
      ? (base.health === 'DISABLED' ? 'DISABLED' : hasSecret('VAPI_WEBHOOK_SECRET') ? 'HEALTHY' : 'DEGRADED')
      : 'DOWN',
    latencyMs: ping.latencyMs ?? null,
    detail: ping.ok && !hasSecret('VAPI_WEBHOOK_SECRET')
      ? 'connected, but call events are not signature-verified until VAPI_WEBHOOK_SECRET is set'
      : null,
    errorCode: ping.ok ? null : (ping.error?.code ?? 'UNKNOWN'),
    facts: ping.ok ? {
      assistantCount: ping.data?.assistantCount ?? 0,
      // §40: no promise of +995 inventory or any other, only what Vapi says
      // this account actually holds.
      outboundNumbers: numbers?.ok ? (numbers.data ?? []).length : null,
    } : null,
  };
}

async function checkMeta(probe: boolean, routes: Route[], sb: SupabaseClient): Promise<ProviderReport> {
  const creds = metaCredentialsPresent();
  const webhook = metaWebhookSecretsPresent();

  const base: ProviderReport = {
    provider: 'META',
    roles: rolesFor(routes, 'META'),
    health: !creds.ok ? 'NOT_CONFIGURED' : disabledByAdmin(routes, 'META') ? 'DISABLED' : 'HEALTHY',
    credentials: [
      { name: 'META_WHATSAPP_ACCESS_TOKEN', present: hasSecret('META_WHATSAPP_ACCESS_TOKEN') },
      { name: 'META_WHATSAPP_PHONE_NUMBER_ID', present: hasSecret('META_WHATSAPP_PHONE_NUMBER_ID') },
      { name: 'META_WHATSAPP_BUSINESS_ACCOUNT_ID', present: hasSecret('META_WHATSAPP_BUSINESS_ACCOUNT_ID') },
      { name: 'META_WHATSAPP_APP_SECRET', present: hasSecret('META_WHATSAPP_APP_SECRET') },
      { name: 'META_WHATSAPP_VERIFY_TOKEN', present: hasSecret('META_WHATSAPP_VERIFY_TOKEN') },
    ],
    latencyMs: null,
    lastTestedAt: new Date().toISOString(),
    detail: webhook.ok ? null : 'inbound messages cannot be accepted until the webhook secrets are set',
    errorCode: null,
    facts: { apiVersion: META_API_VERSION, webhookReady: webhook.ok },
  };
  if (!probe || !creds.ok) return base;

  const provider = createMetaProvider(metaConfigFromEnv());
  const account = await provider.describeAccount();
  const templates = account.ok ? await provider.listTemplates() : null;

  // What the platform-owned number row says about itself. Read before the
  // branch, because a FAILED probe has to correct it just as much as a
  // successful one does.
  const { data: stored } = await sb.from('comm_channel_accounts')
    .select('id, environment, status').eq('provider', 'META').is('owner_id', null).maybeSingle();

  if (!account.ok) {
    /*
     * "DOWN" plus an error code is not enough for the person who has to fix it.
     *
     * There are two completely different failures behind a red Meta card, and
     * they need opposite actions:
     *
     *   the secrets are missing        -> set them (health is NOT_CONFIGURED,
     *                                    handled above, never reaches here)
     *   the secrets are set and Meta
     *   REJECTED them                  -> the token is expired or revoked;
     *                                    reissue it in Business Manager
     *
     * The second is the state this deployment is actually in, and an admin
     * reading "DOWN / AUTH" could reasonably spend an hour re-entering
     * credentials that were never missing. So the distinction is said in
     * words, and `credentialsRejected` is put in facts so the UI can act on
     * it without parsing English.
     *
     * §54 still holds: this says a token was rejected. It never says which
     * token, and it never echoes Meta's body, which can quote a request
     * containing a phone number.
     */
    const rejected = account.error?.code === 'AUTH';

    /*
     * A NUMBER THAT CANNOT SEND MUST STOP SAYING "CONNECTED".
     *
     * comm_channel_accounts.status is what the customer's WhatsApp screen
     * reads. It was only ever written on a SUCCESSFUL probe, so a token that
     * expired last week left the row saying CONNECTED — and a customer
     * looking at a green channel while every send failed. That is precisely
     * the dishonesty §100 forbids, and it is the state this deployment is in
     * right now.
     *
     * So a failed probe writes the truth back. ACTION_REQUIRED is the
     * existing vocabulary for "someone has to do something before this
     * works", and getChannelStatus() already maps it for the customer.
     */
    if (stored && stored.status !== 'ACTION_REQUIRED') {
      await sb.from('comm_channel_accounts')
        .update({ status: 'ACTION_REQUIRED' })
        .eq('id', stored.id);
    }

    return {
      ...base,
      health: 'DOWN',
      latencyMs: account.latencyMs ?? null,
      errorCode: account.error?.code ?? 'UNKNOWN',
      detail: rejected
        ? 'Every WhatsApp credential is configured, and Meta rejected them. The access token is expired or revoked — reissue it in Meta Business Manager and update the secret. Nothing in this repository can fix it.'
        : `Meta is configured but did not answer successfully (${account.error?.code ?? 'UNKNOWN'}). WhatsApp sending and syncing are unavailable until it does.`,
      facts: {
        apiVersion: META_API_VERSION,
        webhookReady: webhook.ok,
        // Booleans only, so the UI can distinguish the two failures without
        // being handed anything sensitive.
        credentialsPresent: true,
        credentialsRejected: rejected,
      },
    };
  }

  if (stored) {
    await sb.from('comm_channel_accounts').update({
      phone_e164: account.data?.phoneE164 ?? null,
      display_name: account.data?.displayName ?? null,
      quality_rating: account.data?.qualityRating ?? null,
      messaging_tier: account.data?.messagingTier ?? null,
      verification_state: account.data?.verificationState ?? null,
      provider_number_id: account.data?.providerNumberId ?? null,
      provider_account_id: account.data?.providerAccountId ?? null,
      // CONNECTED describes reachability. It says nothing about production
      // readiness, which `environment` carries separately (§100).
      status: 'CONNECTED',
    }).eq('id', stored.id);
  }

  return {
    ...base,
    // Reachable but unable to receive is DEGRADED, not HEALTHY. A green tick
    // on a number that cannot accept a reply would be the exact dishonesty
    // §100 warns about.
    health: webhook.ok ? (base.health === 'DISABLED' ? 'DISABLED' : 'HEALTHY') : 'DEGRADED',
    latencyMs: account.latencyMs ?? null,
    facts: {
      apiVersion: META_API_VERSION,
      webhookReady: webhook.ok,
      environment: stored?.environment ?? 'TEST',
      // Only what Meta reported (§33).
      displayName: account.data?.displayName ?? null,
      qualityRating: account.data?.qualityRating ?? null,
      messagingTier: account.data?.messagingTier ?? null,
      verificationState: account.data?.verificationState ?? null,
      templateCount: templates?.ok ? (templates.data ?? []).length : null,
      approvedTemplateCount: templates?.ok
        ? (templates.data ?? []).filter((t) => t.status === 'APPROVED').length
        : null,
    },
  };
}
