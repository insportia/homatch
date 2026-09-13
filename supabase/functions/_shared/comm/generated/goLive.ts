// GENERATED FILE — DO NOT EDIT.
//
// Copied from src/lib/comm/goLive.ts by scripts/sync-comm-domain.mjs so that the
// server enforces exactly what the browser previews. Edit the source file and
// re-run `node scripts/sync-comm-domain.mjs`; scripts/check-comm-sync.mjs
// fails the build if these drift.

// HOMATCH Communications — what is actually stopping each channel going live.
//
// WHY THIS EXISTS
//
// "Setup required" is the right thing to show a customer and the wrong thing
// to show the person who has to fix it. Every blocker below was previously
// discoverable only by reading source, querying the database by hand, or
// calling a provider with curl — which is how a dead Meta token and a missing
// caller number sat behind a generic message for weeks.
//
// Everything here is COMPUTED from live state: provider credentials, provider
// reachability, the routes table, the billable products table, the channel
// accounts table and the wallet. Nothing is hardcoded, and no check reports
// ready because it could not be evaluated — an unknown is a blocker, not a
// pass.
//
// WHY IT LIVES HERE AND NOT IN _shared
//
// It is pure: it takes state in and returns verdicts. Keeping it beside the
// other domain logic means node can test it directly, and sync-comm-domain
// mirrors it to the edge runtime, so Admin and the server cannot drift into
// two different opinions about whether a channel is ready.
//
// WHAT NEVER APPEARS HERE
//
// A credential VALUE. Presence arrives as a predicate and is reported by name
// only (§54, §139). The names are admin-only and never reach a customer.

/** A single go-live condition. `key` is stable; the UI translates it. */
export interface ReadinessCheck {
  key: string;
  ok: boolean;
  /** Admin-only technical detail. May name a credential, never its value. */
  detail: string | null;
  /** True when only someone with credentials or commercial authority can fix it. */
  ownerAction: boolean;
}

export type ReadinessChannel = 'TELEPHONY' | 'AI_TALK' | 'WHATSAPP' | 'NUMBERS';

export interface ChannelReadiness {
  channel: ReadinessChannel;
  ready: boolean;
  /** Keys of failing checks, in the order they should be resolved. */
  blockedBy: string[];
  checks: ReadinessCheck[];
}

export interface GoLiveRoute {
  role: string; provider: string; enabled: boolean; kill_switch: boolean;
}
export interface GoLiveProduct {
  code: string; enabled: boolean; pricing_active: boolean;
  standard_retail_cents: number | null;
  reference_landed_cogs_cents: string | number | null;
}
export interface GoLiveAccount {
  channel: string; phone_e164: string | null; status: string;
}

export interface GoLiveInput {
  routes: GoLiveRoute[];
  products: GoLiveProduct[];
  accounts: GoLiveAccount[];
  /** Presence of a named secret. Never its value. */
  hasSecret: (name: string) => boolean;
  /** Live provider probes. null means "not probed", which is not a pass. */
  probes: {
    cartesiaOk: boolean | null;
    vapiOk: boolean | null;
    metaPhoneStatus: number | null;
    metaWabaStatus: number | null;
  };
  /** Whether a base realtime agent has been created and cached. */
  baseAgentReady: boolean;
  /** Usable credit available to reserve against, in credits. */
  walletBalance: number | null;
}

const check = (
  key: string, ok: boolean, detail: string | null = null, ownerAction = false,
): ReadinessCheck => ({ key, ok, detail, ownerAction });

function routeFor(routes: GoLiveRoute[], role: string): GoLiveRoute | null {
  return routes.find((r) => r.role === role) ?? null;
}
function productFor(products: GoLiveProduct[], code: string): GoLiveProduct | null {
  return products.find((p) => p.code === code) ?? null;
}

/** A product is sellable when it is enabled, priced, and the price is real. */
function pricingChecks(p: GoLiveProduct | null, code: string): ReadinessCheck[] {
  if (!p) return [check(`${code}_PRODUCT`, false, `no billable product row for ${code}`, false)];

  const retail = Number(p.standard_retail_cents ?? 0);
  const cogs = Number(p.reference_landed_cogs_cents ?? 0);
  return [
    check(`${code}_ENABLED`, p.enabled === true,
      p.enabled ? null : `billable_products.${code}.enabled is false`, true),
    check(`${code}_PRICING_ACTIVE`, p.pricing_active === true,
      p.pricing_active ? null : `billable_products.${code}.pricing_active is false`, true),
    // Zero retail is not a free product, it is an unset price. The difference
    // between "we chose not to charge" and "nobody has decided yet" is the
    // whole point of this check.
    check(`${code}_RETAIL_SET`, Number.isFinite(retail) && retail > 0,
      retail > 0 ? null : `standard_retail_cents is ${retail}; an owner must set the retail price`, true),
    check(`${code}_COGS_SET`, Number.isFinite(cogs) && cogs > 0,
      cogs > 0 ? null : `reference_landed_cogs_cents is ${cogs}; provider cost is unknown, so margin cannot be checked`, true),
  ];
}

export function evaluateGoLive(input: GoLiveInput): ChannelReadiness[] {
  const { routes, products, accounts, hasSecret, probes, baseAgentReady, walletBalance } = input;

  // ── TELEPHONY ─────────────────────────────────────────────────────────────
  const tel = routeFor(routes, 'TELEPHONY');
  const callerNumbers = accounts.filter(
    (a) => a.channel === 'VOICE' && a.phone_e164 && a.status === 'ACTIVE',
  );
  const telChecks: ReadinessCheck[] = [
    check('PROVIDER_CREDENTIAL', hasSecret('VAPI_PRIVATE_API_KEY'),
      hasSecret('VAPI_PRIVATE_API_KEY') ? null : 'VAPI_PRIVATE_API_KEY is not set', true),
    check('PROVIDER_REACHABLE', probes.vapiOk === true,
      probes.vapiOk === null ? 'not probed'
        : probes.vapiOk ? null : 'the provider rejected our credentials or is down',
      probes.vapiOk === false),
    check('WEBHOOK_SECRET', hasSecret('VAPI_WEBHOOK_SECRET'),
      hasSecret('VAPI_WEBHOOK_SECRET') ? null
        : 'VAPI_WEBHOOK_SECRET is not set; call events cannot be signature-verified', true),
    check('CALLER_NUMBER', callerNumbers.length > 0,
      callerNumbers.length ? null : 'no ACTIVE voice channel account with a phone number exists', true),
    ...pricingChecks(productFor(products, 'AI_CALL'), 'AI_CALL'),
    check('WALLET_FUNDED', (walletBalance ?? 0) > 0,
      (walletBalance ?? 0) > 0 ? null : 'no credit balance is available to reserve against', true),
    check('ROUTE_ENABLED', tel?.enabled === true,
      tel?.enabled ? null : 'comm_provider_routes TELEPHONY is disabled', true),
    // The kill switch is LAST on purpose: it is the switch an owner throws
    // once everything above is green, and listing it first invites turning it
    // off to "see what happens".
    check('KILL_SWITCH_OFF', tel?.kill_switch === false,
      tel?.kill_switch ? 'the TELEPHONY kill switch is on' : null, true),
  ];

  // ── AI TALK ───────────────────────────────────────────────────────────────
  const orch = routeFor(routes, 'ORCHESTRATOR');
  const talkChecks: ReadinessCheck[] = [
    check('PROVIDER_CREDENTIAL', hasSecret('CARTESIA_API_KEY'),
      hasSecret('CARTESIA_API_KEY') ? null : 'CARTESIA_API_KEY is not set', true),
    check('PROVIDER_REACHABLE', probes.cartesiaOk === true,
      probes.cartesiaOk === null ? 'not probed'
        : probes.cartesiaOk ? null : 'the provider rejected our credentials or is down',
      probes.cartesiaOk === false),
    check('BASE_AGENT', baseAgentReady,
      baseAgentReady ? null : 'no base realtime agent is cached yet; it is created on first use', false),
    check('ROUTE_ENABLED', orch?.enabled === true,
      orch?.enabled ? null : 'comm_provider_routes ORCHESTRATOR is disabled', true),
    check('KILL_SWITCH_OFF', orch?.kill_switch === false,
      orch?.kill_switch ? 'the ORCHESTRATOR kill switch is on' : null, true),
  ];

  // ── WHATSAPP ──────────────────────────────────────────────────────────────
  const msg = routeFor(routes, 'MESSAGING');
  const waAccounts = accounts.filter((a) => a.channel === 'WHATSAPP');
  const metaSecrets: Array<[string, string]> = [
    ['META_WHATSAPP_ACCESS_TOKEN', 'ACCESS_TOKEN'],
    ['META_WHATSAPP_PHONE_NUMBER_ID', 'PHONE_NUMBER_ID'],
    ['META_WHATSAPP_BUSINESS_ACCOUNT_ID', 'WABA_ID'],
    ['META_WHATSAPP_VERIFY_TOKEN', 'VERIFY_TOKEN'],
    ['META_WHATSAPP_APP_SECRET', 'APP_SECRET'],
  ];
  const waChecks: ReadinessCheck[] = [
    ...metaSecrets.map(([env, key]) =>
      check(key, hasSecret(env), hasSecret(env) ? null : `${env} is not set`, true)),
    // Presence is not validity. A token that exists and is rejected is exactly
    // the state this deployment is in, and it must not read as green.
    check('TOKEN_ACCEPTED', probes.metaPhoneStatus === 200,
      probes.metaPhoneStatus === null ? 'not probed'
        : probes.metaPhoneStatus === 200 ? null
        : `Meta returned ${probes.metaPhoneStatus} for the phone number; the access token is present but not accepted`,
      true),
    check('WABA_ACCEPTED', probes.metaWabaStatus === 200,
      probes.metaWabaStatus === null ? 'not probed'
        : probes.metaWabaStatus === 200 ? null
        : `Meta returned ${probes.metaWabaStatus} for the business account`,
      true),
    check('SENDER_ACCOUNT', waAccounts.length > 0,
      waAccounts.length ? null : 'no WhatsApp channel account is registered', true),
    ...pricingChecks(productFor(products, 'WHATSAPP'), 'WHATSAPP'),
    check('ROUTE_ENABLED', msg?.enabled === true,
      msg?.enabled ? null : 'comm_provider_routes MESSAGING is disabled', true),
    check('KILL_SWITCH_OFF', msg?.kill_switch === false,
      msg?.kill_switch ? 'the MESSAGING kill switch is on' : null, true),
  ];

  // ── NUMBERS ───────────────────────────────────────────────────────────────
  //
  // Procurement needs a provider that can SEARCH purchasable inventory and
  // quote a real cost. Nothing configured can: the telephony provider lists
  // only numbers the account already owns and has no search endpoint. So this
  // reports one honest blocker, naming the credentials that would clear it,
  // rather than green ticks around a feature that cannot run.
  const numberChecks: ReadinessCheck[] = [
    check('PROCUREMENT_PROVIDER',
      hasSecret('TWILIO_ACCOUNT_SID') || hasSecret('TELNYX_API_KEY'),
      'no number-provisioning credential is set (TWILIO_ACCOUNT_SID with TWILIO_AUTH_TOKEN, or TELNYX_API_KEY)',
      true),
    check('OWNED_NUMBERS_VISIBLE', true,
      'numbers the account already owns are listed from the telephony provider', false),
  ];

  const build = (channel: ReadinessChannel, checks: ReadinessCheck[]): ChannelReadiness => ({
    channel,
    ready: checks.every((c) => c.ok),
    blockedBy: checks.filter((c) => !c.ok).map((c) => c.key),
    checks,
  });

  return [
    build('TELEPHONY', telChecks),
    build('AI_TALK', talkChecks),
    build('WHATSAPP', waChecks),
    build('NUMBERS', numberChecks),
  ];
}
