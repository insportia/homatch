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
  checkElevenLabs, elevenLabsCredentialsPresent, mintRealtimeToken,
} from '../_shared/comm/elevenlabs.ts';
import {
  createMetaProvider, metaConfigFromEnv, metaCredentialsPresent,
  metaWebhookSecretsPresent, META_API_VERSION,
} from '../_shared/comm/meta.ts';
import { hasSecret } from '../_shared/comm/contracts.ts';
import { evaluateGoLive } from '../_shared/comm/generated/goLive.ts';

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

  if (wanted('ELEVENLABS')) reports.push(await checkElevenLabsProvider(probe, routes ?? []));
  if (wanted('CARTESIA')) reports.push(await checkCartesia(probe, routes ?? []));
  if (wanted('VAPI'))     reports.push(await checkVapi(probe, routes ?? []));
  if (wanted('META'))     reports.push(await checkMeta(probe, routes ?? [], sb));
  if (wanted('RESEND'))   reports.push(await checkResend(probe, routes ?? [], sb));

  if (probe) {
    for (const r of reports) {
      /*
       * DEGRADED IS A SUCCESSFUL CONNECTION.
       *
       * checkVapi returns DEGRADED when the provider answered perfectly and
       * VAPI_WEBHOOK_SECRET is missing — a real gap, but not a connection
       * failure. This wrote only last_error_at for it and never
       * last_success_at, so the stored state said the provider had failed and
       * never succeeded. The go-live checklist then read that back and told an
       * admin "the provider rejected our credentials or is down" about a
       * provider that had just answered in 219ms.
       *
       * Telling somebody their credentials are rejected when they are fine is
       * worse than saying nothing: it sends them to rotate a working key.
       *
       * Reachability and completeness are now recorded separately, which is
       * what they are. The missing webhook secret still blocks go-live — it
       * has its own check, and that one is accurate.
       */
      const reached = r.health === 'HEALTHY' || r.health === 'DEGRADED' || r.health === 'DISABLED';
      await sb.from('comm_provider_routes')
        .update({
          last_success_at: reached ? r.lastTestedAt : undefined,
          last_error_at: reached ? undefined : r.lastTestedAt,
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
        last_success_at: reached ? r.lastTestedAt : undefined,
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

  /*
   * GO-LIVE READINESS.
   *
   * Computed from the reports just gathered plus the tables that decide
   * whether a channel may spend money. It is the answer to "what is stopping
   * this?", which the routing panel above could not give: that panel shows
   * credentials and switches, and a channel can have every credential set, no
   * switch thrown, and still be unable to place a call because nobody has
   * priced it or registered a caller number.
   *
   * Admin-only, like everything else in this function.
   */
  const reportFor = (name: string) => reports.find((r) => r.provider === name) ?? null;

  /*
   * Reachability on a GET comes from what the last probe STORED.
   *
   * A GET does not contact anyone — that is the whole reason it exists, so
   * opening Admin does not fire three provider calls. But returning "not
   * probed" on every GET meant pressing "Recheck connection" turned a card
   * green for one render and then straight back to grey, because the panel
   * reloads over GET afterwards. The probe result was real and was being
   * thrown away.
   *
   * comm_provider_routes already carries last_success_at and last_error_at,
   * written by the probe below. A success more recent than the last error is
   * evidence, not a guess. Never probed at all is still null, and null still
   * blocks.
   */
  const storedReach = (name: string): boolean | null => {
    const rows = (routes ?? []).filter((r) => r.provider === name);
    if (!rows.length) return null;
    const newest = (key: 'last_success_at' | 'last_error_at') => rows
      .map((r) => (r[key] ? Date.parse(String(r[key])) : 0))
      .reduce((a, b) => Math.max(a, b), 0);
    const ok = newest('last_success_at');
    const bad = newest('last_error_at');
    if (!ok && !bad) return null;
    return ok >= bad;
  };

  const healthyish = (name: string): boolean | null => {
    const r = reportFor(name);
    if (!r) return null;
    if (!probe) return storedReach(name);
    return r.health === 'HEALTHY' || r.health === 'DEGRADED' || r.health === 'DISABLED';
  };

  const metaStatus = (): number | null => {
    const r = reportFor('META');
    if (!r) return null;
    if (!probe) {
      const reach = storedReach('META');
      // A stored failure cannot say WHICH status without inventing one, and
      // inventing a status is how "401" would appear on a screen where
      // nobody ever saw a 401. Non-200 is enough: the check fails either way.
      return reach === null ? null : reach ? 200 : 0;
    }
    // DEGRADED belongs here for the same reason it belongs in healthyish:
    // Meta accepted the token and answered. What is degraded is the webhook
    // configuration, which has its own two checks — VERIFY_TOKEN and
    // APP_SECRET — and those are the ones that should be red.
    //
    // Without DEGRADED in this list, a working token fell through to
    // facts.httpStatus, which is only ever written on the FAILURE path, and
    // TOKEN_ACCEPTED read "not probed" immediately after a successful probe.
    if (r.health === 'HEALTHY' || r.health === 'DEGRADED' || r.health === 'DISABLED') return 200;
    const s = (r.facts as { httpStatus?: number | null } | null)?.httpStatus;
    return typeof s === 'number' ? s : null;
  };

  const [{ data: products }, { data: accounts }, { data: baseAgent }, { data: wallets }] = await Promise.all([
    sb.from('billable_products')
      .select('code, enabled, pricing_active, standard_retail_cents, reference_landed_cogs_cents')
      .in('code', ['AI_CALL', 'AI_TALK', 'WHATSAPP']),
    sb.from('comm_channel_accounts').select('channel, phone_e164, status'),
    sb.from('admin_settings').select('value').eq('key', 'cartesia_base_agent_id').maybeSingle(),
    sb.from('credit_accounts').select('balance, reserved'),
  ]);

  const usableCredit = (wallets ?? []).reduce(
    (sum: number, w: { balance: number | null; reserved: number | null }) =>
      sum + Math.max(0, Number(w.balance ?? 0) - Number(w.reserved ?? 0)),
    0,
  );

  const readiness = evaluateGoLive({
    routes: (routes ?? []).map((r) => ({
      role: String(r.role), provider: String(r.provider),
      enabled: r.enabled === true, kill_switch: r.kill_switch === true,
    })),
    products: (products ?? []) as never,
    accounts: (accounts ?? []) as never,
    hasSecret,
    probes: {
      cartesiaOk: healthyish('CARTESIA'),
      vapiOk: healthyish('VAPI'),
      metaPhoneStatus: metaStatus(),
      metaWabaStatus: metaStatus(),
    },
    baseAgentReady: typeof baseAgent?.value === 'string' && baseAgent.value.length > 0,
    walletBalance: usableCredit,
  });

  return json({
    ok: true,
    probed: probe,
    readiness,
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

/**
 * ElevenLabs, in the vocabulary the Admin page already speaks.
 *
 * Every probe is a GET that generates nothing and costs nothing. There is
 * deliberately no "say something" button here — a synthesis test belongs in
 * the pronunciation preview, where a person asked for audio and is going to
 * listen to it.
 *
 * The realtime token probe is the exception worth making: minting one is free
 * and it is the only way to know whether the browser leg of AI TALK will
 * work, which no amount of voice-listing can tell you.
 */
async function checkElevenLabsProvider(probe: boolean, routes: Route[]): Promise<ProviderReport> {
  const present = elevenLabsCredentialsPresent();
  const base: ProviderReport = {
    provider: 'ELEVENLABS',
    roles: rolesFor(routes, 'ELEVENLABS'),
    health: !present ? 'NOT_CONFIGURED' : disabledByAdmin(routes, 'ELEVENLABS') ? 'DISABLED' : 'HEALTHY',
    credentials: [{ name: 'ELEVENLABS_API_KEY', present }],
    latencyMs: null,
    lastTestedAt: new Date().toISOString(),
    detail: null,
    errorCode: null,
    facts: null,
  };
  if (!probe || !present) return base;

  const health = await checkElevenLabs();
  const token = health.status === 'HEALTHY' ? await mintRealtimeToken() : null;

  return {
    ...base,
    health: health.status === 'HEALTHY'
      ? (base.health === 'DISABLED' ? 'DISABLED' : 'HEALTHY')
      : health.status === 'QUOTA_EXHAUSTED' || health.status === 'RATE_LIMITED' ? 'DEGRADED'
        : 'DOWN',
    latencyMs: health.latencyMs,
    detail: health.detail,
    errorCode: health.status === 'HEALTHY' ? null : health.status,
    facts: {
      voiceCount: health.voiceCount,
      modelCount: health.modelCount,
      tier: health.tier,
      charactersRemaining: health.charactersRemaining,
      charactersLimit: health.charactersLimit,
      canListVoices: health.canListVoices,
      canListModels: health.canListModels,
      canUsePronunciationDictionaries: health.canUsePronunciationDictionaries,
      // The one capability that cannot be inferred from any other call.
      canMintRealtimeToken: token?.ok === true,
      realtimeTokenPath: token?.ok ? token.data?.path ?? null : null,
      realtimeTokenError: token && !token.ok ? token.error?.code ?? null : null,
      providerStatus: health.providerStatus,
    },
  };
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

/**
 * EMAIL, IN BOTH DIRECTIONS.
 *
 * Sending has worked for months and was the only half this panel knew about —
 * which meant the half that was missing entirely was also the half nobody
 * could see was missing.
 *
 * Receiving needs three things, and each fails differently:
 *
 *   RESEND_API_KEY        sending. Absent, nothing goes out.
 *   RESEND_WEBHOOK_SECRET receiving. Absent, email-webhook answers 503 to
 *                         every delivery and writes nothing — correct, and
 *                         completely silent from the outside.
 *   a channel account     whose tenant a reply belongs to. With none, a
 *                         verified delivery is recorded as unroutable and
 *                         attached to nobody, which is also correct and also
 *                         invisible.
 *
 * Two of those are a working system with no inbound mail and no error
 * anywhere. So they are reported as separate facts rather than one boolean.
 */
async function checkResend(probe: boolean, routes: Route[], sb: SupabaseClient): Promise<ProviderReport> {
  const outbound = hasSecret('RESEND_API_KEY');
  const inboundSecret = hasSecret('RESEND_WEBHOOK_SECRET');

  const { data: addresses } = await sb.from('comm_channel_accounts')
    .select('provider_account_id, owner_id, status')
    .eq('channel', 'EMAIL')
    .eq('provider', 'RESEND');

  const claimed = (addresses ?? []).filter((a) => a.owner_id);

  const health = !outbound ? 'NOT_CONFIGURED'
    : disabledByAdmin(routes, 'RESEND') ? 'DISABLED'
      : (inboundSecret && claimed.length > 0) ? 'HEALTHY' : 'DEGRADED';

  /* Named in the order somebody has to fix them. "Not configured" without
     saying which of the three is not configured sends an admin to the wrong
     dashboard. */
  const detail = !outbound
    ? 'RESEND_API_KEY is unset: no email can be sent.'
    : !inboundSecret
      ? 'RESEND_WEBHOOK_SECRET is unset: email-webhook refuses every delivery, so replies never reach the inbox.'
      : claimed.length === 0
        ? 'No inbound address has an owner, so a verified reply is recorded as unroutable and attached to nobody.'
        : null;

  return {
    provider: 'RESEND',
    roles: rolesFor(routes, 'RESEND'),
    health,
    credentials: [
      /* hasSecret() inline, not the locals above. The gate in
         tests/matrix/metaTokenSurfacing.test.mjs requires it, and it is right
         to: `present` must be a presence TEST, so that no refactor can ever
         put a value where a boolean goes. */
      { name: 'RESEND_API_KEY', present: hasSecret('RESEND_API_KEY') },
      { name: 'RESEND_WEBHOOK_SECRET', present: hasSecret('RESEND_WEBHOOK_SECRET') },
    ],
    latencyMs: null,
    lastTestedAt: new Date().toISOString(),
    detail,
    errorCode: null,
    facts: {
      outboundReady: outbound,
      inboundReady: inboundSecret && claimed.length > 0,
      inboundAddresses: (addresses ?? []).length,
      /* How many are actually somebody's. An address with no owner is a
         configuration step that was started and not finished. */
      ownedAddresses: claimed.length,
    },
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
        // The HTTP status Meta actually returned. A number, not a body: the
        // body can quote a request containing a phone number, the status
        // cannot, and "401" is the single most useful fact for whoever has to
        // decide whether to reissue a token.
        httpStatus: account.error?.providerCode ?? null,
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
