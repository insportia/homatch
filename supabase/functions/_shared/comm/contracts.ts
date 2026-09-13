// HOMATCH Communications — the provider contracts.
//
// §127 asks for clean internal contracts and, in the same breath, says not to
// over-engineer with abstract class ceremony when interfaces and functions are
// enough. So these are interfaces and plain factory functions. There is no
// base class, no registry singleton and no dependency container.
//
// WHAT AN ADAPTER OWES THE CALLER
//
// Every adapter returns a NORMALISED result and never throws for an ordinary
// provider refusal. A 400 from Meta because the recipient has no WhatsApp
// account is not an exception, it is an answer, and the difference matters:
// the dispatcher retries exceptions and does not retry answers. An adapter
// that throws on "this number is not on WhatsApp" produces a campaign that
// dials the same dead number five times.
//
// THE TWO FIELDS THAT MAKE FALLBACK SAFE (§91)
//
//   providerRef   whatever the provider calls this operation, persisted
//                 immediately so a webhook can be matched to it
//   sideEffect    'NONE' | 'MAYBE' | 'COMMITTED'
//
// sideEffect is the one that prevents the expensive bug. When a request times
// out, Homatch does not know whether the provider placed the call. Falling
// back to a second provider on a MAYBE would dial the same person twice. So a
// MAYBE never falls back; it is reconciled instead.

export type SideEffect = 'NONE' | 'MAYBE' | 'COMMITTED';

export interface ProviderResult<T> {
  ok: boolean;
  data?: T;
  providerRef?: string | null;
  sideEffect: SideEffect;
  /** Homatch's own code. Never the provider's raw string. */
  error?: {
    code: 'AUTH' | 'RATE_LIMIT' | 'INVALID_RECIPIENT' | 'POLICY' | 'NOT_SUPPORTED'
        | 'TRANSIENT' | 'TIMEOUT' | 'UNKNOWN';
    message: string;
    retryable: boolean;
    /** The provider's own code, kept for support and reconciliation. */
    providerCode?: string | number | null;
  };
  latencyMs?: number;
  /** What this cost, when the provider says so in the response. */
  costCents?: number | null;
}

// ── Messaging ───────────────────────────────────────────────────────────────

export interface SendMessageParams {
  toE164: string;
  /** Free text. Only legal inside the 24h service window. */
  text?: string;
  template?: {
    name: string;
    language: string;
    /** Positional {{1}}..{{n}} values, already resolved and escaped. */
    variables: string[];
    headerMediaUrl?: string | null;
  };
  media?: { url: string; mime: string; caption?: string | null; filename?: string | null };
  /** Deterministic per (campaign, contact, attempt). Sent to providers that honour one. */
  idempotencyKey: string;
}

export interface SentMessage {
  providerMessageId: string;
  /** Meta returns this on send; it identifies the billable conversation. */
  conversationId?: string | null;
  status: string;
}

export interface MessagingProvider {
  readonly name: string;
  send(params: SendMessageParams): Promise<ProviderResult<SentMessage>>;
  /** Resolve a media id the webhook gave us into bytes we may store. */
  fetchMedia(mediaId: string): Promise<ProviderResult<{ bytes: Uint8Array; mime: string }>>;
  /** Ask the provider what it knows about our own number. Cheap, read-only. */
  describeAccount(): Promise<ProviderResult<ChannelAccountFacts>>;
  listTemplates(): Promise<ProviderResult<RemoteTemplate[]>>;
  markRead(providerMessageId: string): Promise<ProviderResult<void>>;
}

export interface ChannelAccountFacts {
  phoneE164: string | null;
  displayName: string | null;
  /** Only what the provider actually reports. Never inferred (§33). */
  qualityRating: string | null;
  messagingTier: string | null;
  verificationState: string | null;
  providerNumberId: string | null;
  providerAccountId: string | null;
}

export interface RemoteTemplate {
  providerTemplateId: string;
  name: string;
  language: string;
  category: string;
  status: string;
  rejectionReason: string | null;
  bodyText: string | null;
  headerKind: string | null;
  headerText: string | null;
  footerText: string | null;
  buttons: unknown[];
}

// ── Voice ───────────────────────────────────────────────────────────────────

export interface PlaceCallParams {
  toE164: string;
  fromNumberId?: string | null;
  /** The frozen agent snapshot. The adapter translates; it never invents behaviour. */
  agent: AgentRuntimeConfig;
  maxDurationSec: number;
  recordingEnabled: boolean;
  idempotencyKey: string;
  /** Where the provider should post lifecycle events. */
  webhookUrl: string;
  metadata: Record<string, string>;
}

export interface PlacedCall {
  providerCallId: string;
  status: string;
}

export interface TelephonyProvider {
  readonly name: string;
  placeCall(params: PlaceCallParams): Promise<ProviderResult<PlacedCall>>;
  endCall(providerCallId: string): Promise<ProviderResult<void>>;
  getCall(providerCallId: string): Promise<ProviderResult<Record<string, unknown>>>;
  /** True only when the provider is known to support live human takeover. */
  readonly supportsTransfer: boolean;
  readonly supportsListen: boolean;
}

/**
 * What a voice runtime needs to BE an agent. Derived from a frozen
 * comm_agent_versions snapshot, never from the mutable agent row, so a call
 * can always be explained by exactly the instructions it ran under.
 */
export interface AgentRuntimeConfig {
  agentVersionId: string;
  name: string;
  /** The assembled system instruction. Built once, in agentPrompt.ts. */
  systemPrompt: string;
  firstMessage: string;
  languages: string[];
  primaryLanguage: string;
  voiceId: string | null;
  /** §114. When true the agent states it is an AI assistant in its opening. */
  aiDisclosure: boolean;
  /** Admin voice tuning (§55). Only settings the chosen provider supports. */
  endpointing: {
    minSilenceMs: number;
    maxSilenceMs: number;
    completeSilenceMs: number;
    continuationGraceMs: number;
    semantic: boolean;
  };
  interruption: { enabled: boolean; thresholdMs: number };
  maxDurationSec: number;
}

// ── Realtime, browser-side ──────────────────────────────────────────────────

export interface RealtimeGrant {
  /** Short-lived and scoped. Never a root key (§139). */
  token: string;
  expiresAt: string;
  provider: string;
  /** Model ids the browser needs to open the socket. Not secrets. */
  sttModel?: string | null;
  ttsModel?: string | null;
  voiceId?: string | null;
}

export interface RealtimeProvider {
  readonly name: string;
  /** Mint a browser-usable grant with the narrowest scope the provider allows. */
  mintGrant(params: { ttlSeconds: number; scopes: string[] }): Promise<ProviderResult<RealtimeGrant>>;
  /** A cheap authenticated read, for provider health (§57). Must not cost money. */
  ping(): Promise<ProviderResult<{ detail: string }>>;
}

export interface WhatsAppCallProvider {
  readonly name: string;
  /**
   * §39. Availability is a FACT about the business account, discovered by
   * asking, not a capability Homatch assumes. Everything here returns
   * NOT_SUPPORTED until an account is observed to have it.
   */
  isAvailable(): Promise<ProviderResult<{ available: boolean; reason?: string }>>;
  placeCall(params: { toE164: string; agent: AgentRuntimeConfig }): Promise<ProviderResult<PlacedCall>>;
}

// ── Shared HTTP plumbing ────────────────────────────────────────────────────

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array;
  timeoutMs?: number;
}

/**
 * One HTTP call with a timeout, returning a normalised result.
 *
 * The timeout branch is why this exists. `fetch` without an AbortController
 * hangs for as long as the platform allows, and an edge function that hangs on
 * a provider is an edge function that has already been killed by the time the
 * provider answers — with the call placed and nothing recorded. A timeout that
 * returns sideEffect 'MAYBE' is the difference between a reconcilable gap and
 * a double charge.
 */
export async function providerFetch(
  url: string,
  opts: FetchOptions = {},
  classify: (status: number, body: string) => ProviderResult<never>['error'] = defaultClassify,
): Promise<{ ok: boolean; status: number; text: string; json: unknown; latencyMs: number; error?: ProviderResult<never>['error']; timedOut: boolean }> {
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();

  try {
    const res = await fetch(url, {
      method: opts.method ?? 'GET',
      headers: opts.headers,
      body: opts.body as BodyInit | undefined,
      signal: controller.signal,
    });
    const text = await res.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }

    return {
      ok: res.ok,
      status: res.status,
      text,
      json,
      latencyMs: Date.now() - started,
      error: res.ok ? undefined : classify(res.status, text),
      timedOut: false,
    };
  } catch (e) {
    const aborted = (e as Error)?.name === 'AbortError';
    return {
      ok: false,
      status: 0,
      text: '',
      json: null,
      latencyMs: Date.now() - started,
      timedOut: aborted,
      error: {
        code: aborted ? 'TIMEOUT' : 'TRANSIENT',
        message: aborted ? `no response within ${timeoutMs}ms` : String((e as Error)?.message ?? e),
        retryable: true,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}

function defaultClassify(status: number, body: string): ProviderResult<never>['error'] {
  if (status === 401 || status === 403) {
    return { code: 'AUTH', message: 'the provider rejected our credentials', retryable: false };
  }
  if (status === 429) {
    return { code: 'RATE_LIMIT', message: 'the provider is rate limiting us', retryable: true };
  }
  if (status >= 500) {
    return { code: 'TRANSIENT', message: `provider returned ${status}`, retryable: true };
  }
  return {
    code: 'UNKNOWN',
    // The body is NOT forwarded: provider error bodies echo the request, and
    // the request contains a phone number (§74). The status is carried
    // instead — it is the one fact that identifies the failure without
    // repeating anything we sent, and without it an admin sees only
    // "UNKNOWN", which is what made the AI Talk outage undiagnosable.
    message: `provider returned ${status}`,
    retryable: false,
    providerCode: status,
  };
}

/** Is a required secret present? Presence only — the value never leaves the server (§139). */
export function hasSecret(name: string): boolean {
  const v = Deno.env.get(name);
  return typeof v === 'string' && v.trim().length > 0;
}

export function requireSecret(name: string): string {
  const v = Deno.env.get(name);
  if (!v || !v.trim()) throw new Error(`missing required secret: ${name}`);
  return v;
}
