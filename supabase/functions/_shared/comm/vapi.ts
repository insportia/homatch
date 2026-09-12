// HOMATCH Communications — Vapi, for outbound telephony.
//
// WHY VAPI AND NOT CARTESIA FOR PHONE CALLS
//
// §23: "Use Vapi only when it materially improves orchestration, telephony,
// provider interoperability or call handling. Do not add Vapi cost where a
// direct Cartesia browser demo does not need it."
//
// A phone call needs a carrier leg, a PSTN number, DTMF, voicemail detection
// and a transfer path. A browser demo needs none of those and must not pay for
// them. So the homepage demo goes straight to Cartesia over WebRTC, and only
// campaigns that actually dial a telephone reach this file.
//
// WHAT IS DELIBERATELY NOT IMPLEMENTED
//
// endCall is implemented against the call's control URL, which is the
// documented mechanism and is only present when Vapi returns one. When it is
// absent this returns NOT_SUPPORTED rather than pretending. §18: "Do not fake
// controls when provider cannot support them" — a stop button that silently
// does nothing is worse than a stop button that is disabled with a reason.

import {
  providerFetch, requireSecret, hasSecret,
  type ProviderResult, type TelephonyProvider, type PlaceCallParams,
  type PlacedCall, type AgentRuntimeConfig,
} from './contracts.ts';

const VAPI_API = 'https://api.vapi.ai';

export function vapiCredentialsPresent(): { ok: boolean; missing: string[] } {
  const missing = hasSecret('VAPI_PRIVATE_API_KEY') ? [] : ['VAPI_PRIVATE_API_KEY'];
  return { ok: missing.length === 0, missing };
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${requireSecret('VAPI_PRIVATE_API_KEY')}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Translate a frozen Homatch agent version into a transient Vapi assistant.
 *
 * TRANSIENT, not a stored assistant id, and that is the important decision.
 * A stored assistant is mutable state living at the provider, which means the
 * agent that made Tuesday's call can be silently edited on Thursday and the
 * transcript can no longer be explained. Sending the whole configuration with
 * every call keeps comm_agent_versions the single source of truth (§11).
 */
export function agentToVapiAssistant(agent: AgentRuntimeConfig, webhookUrl: string, recordingEnabled: boolean) {
  return {
    name: agent.name.slice(0, 64),
    firstMessage: agent.firstMessage,
    // §114. The disclosure is part of the opening, not a footnote, and it is
    // in the prompt as well so the model cannot be talked out of it.
    model: {
      provider: 'openai',
      model: 'gpt-4o',
      temperature: 0.4,
      messages: [{ role: 'system', content: agent.systemPrompt }],
    },
    voice: agent.voiceId
      ? { provider: 'cartesia', voiceId: agent.voiceId, model: 'sonic-2' }
      : { provider: 'cartesia', model: 'sonic-2' },
    transcriber: {
      provider: 'deepgram',
      // The primary language leads, and the alternates keep a code-switching
      // caller intelligible instead of forcing their Russian sentence through
      // a Georgian model (§135).
      language: mapToTranscriberLanguage(agent.primaryLanguage),
      model: 'nova-2',
      smartFormat: true,
    },
    // Endpointing, from admin voice tuning (§55). These are the numbers
    // transcript.ts reasons about, handed to the provider that will actually
    // enforce them.
    startSpeakingPlan: {
      waitSeconds: agent.endpointing.minSilenceMs / 1000,
      smartEndpointingEnabled: agent.endpointing.semantic,
      transcriptionEndpointingPlan: {
        onPunctuationSeconds: agent.endpointing.completeSilenceMs / 1000,
        onNoPunctuationSeconds: agent.endpointing.continuationGraceMs / 1000,
        onNumberSeconds: agent.endpointing.continuationGraceMs / 1000,
      },
    },
    stopSpeakingPlan: {
      numWords: agent.interruption.enabled ? 2 : 0,
      voiceSeconds: agent.interruption.thresholdMs / 1000,
      backoffSeconds: 1,
    },
    maxDurationSeconds: agent.maxDurationSec,
    recordingEnabled,
    serverUrl: webhookUrl,
    serverMessages: ['status-update', 'end-of-call-report', 'hang', 'transfer-destination-request'],
  };
}

/**
 * Deepgram's language codes are not BCP-47 and not Homatch's locale list.
 *
 * Georgian is the case that matters and the honest one: Deepgram's nova-2 does
 * not list ka as a supported language, so a Georgian call configured this way
 * would silently transcribe as something else. `multi` is the closest honest
 * answer, and the admin route for STT is what should carry a Georgian-capable
 * provider when one is configured — which is why the STT role exists in
 * comm_provider_routes separately from TELEPHONY.
 */
function mapToTranscriberLanguage(locale: string): string {
  const map: Record<string, string> = {
    en: 'en', ru: 'ru', tr: 'tr', ar: 'ar', he: 'he',
    ka: 'multi',
  };
  return map[locale] ?? 'multi';
}

export function createVapiProvider(): TelephonyProvider {
  return {
    name: 'VAPI',
    // Vapi supports both, but only when the assistant is configured with a
    // destination and a monitor. Homatch reports the capability as present
    // and the CALL-level availability is checked from what the API returned.
    supportsTransfer: true,
    supportsListen: true,

    async placeCall(params: PlaceCallParams): Promise<ProviderResult<PlacedCall>> {
      const body: Record<string, unknown> = {
        assistant: agentToVapiAssistant(params.agent, params.webhookUrl, params.recordingEnabled),
        customer: { number: params.toE164 },
        // Carried through so the webhook can find the send row without a
        // lookup table, and so reconciliation can match a provider invoice
        // line back to a campaign (§128, §130).
        metadata: { ...params.metadata, idempotencyKey: params.idempotencyKey },
      };
      if (params.fromNumberId) body.phoneNumberId = params.fromNumberId;

      const res = await providerFetch(`${VAPI_API}/call`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
        timeoutMs: 25_000,
      });

      if (res.timedOut) {
        // The single most expensive ambiguity in this subsystem. Vapi may have
        // placed the call. Retrying, or falling back to another provider,
        // would ring a stranger twice. MAYBE means: record it, do not retry,
        // reconcile it against the webhook and against GET /call.
        return {
          ok: false, sideEffect: 'MAYBE', latencyMs: res.latencyMs,
          error: { code: 'TIMEOUT', message: 'no response from Vapi; the call may have been placed', retryable: false },
        };
      }
      if (!res.ok) {
        return { ok: false, sideEffect: 'NONE', latencyMs: res.latencyMs, error: res.error };
      }

      const call = res.json as { id?: string; status?: string; monitor?: { controlUrl?: string; listenUrl?: string } };
      if (!call?.id) {
        return {
          ok: false, sideEffect: 'MAYBE', latencyMs: res.latencyMs,
          error: { code: 'UNKNOWN', message: 'Vapi accepted the request without returning a call id', retryable: false },
        };
      }

      return {
        ok: true,
        sideEffect: 'COMMITTED',
        providerRef: call.id,
        latencyMs: res.latencyMs,
        data: { providerCallId: call.id, status: call.status ?? 'queued' },
      };
    },

    async endCall(providerCallId: string): Promise<ProviderResult<void>> {
      // The control URL is per-call and only exists while the call is live, so
      // it has to be fetched rather than remembered.
      const info = await providerFetch(`${VAPI_API}/call/${encodeURIComponent(providerCallId)}`, {
        headers: headers(), timeoutMs: 8_000,
      });
      if (!info.ok) return { ok: false, sideEffect: 'NONE', error: info.error };

      const controlUrl = (info.json as { monitor?: { controlUrl?: string } })?.monitor?.controlUrl;
      if (!controlUrl) {
        return {
          ok: false, sideEffect: 'NONE',
          error: { code: 'NOT_SUPPORTED', message: 'this call exposes no control channel; it cannot be ended remotely', retryable: false },
        };
      }

      const res = await providerFetch(controlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'end-call' }),
        timeoutMs: 8_000,
      });
      return res.ok
        ? { ok: true, sideEffect: 'COMMITTED', latencyMs: res.latencyMs }
        : { ok: false, sideEffect: 'MAYBE', latencyMs: res.latencyMs, error: res.error };
    },

    async getCall(providerCallId: string): Promise<ProviderResult<Record<string, unknown>>> {
      const res = await providerFetch(`${VAPI_API}/call/${encodeURIComponent(providerCallId)}`, {
        headers: headers(), timeoutMs: 10_000,
      });
      return res.ok
        ? { ok: true, sideEffect: 'NONE', latencyMs: res.latencyMs, data: (res.json ?? {}) as Record<string, unknown> }
        : { ok: false, sideEffect: 'NONE', latencyMs: res.latencyMs, error: res.error };
    },
  };
}

/** Authenticated, read-only, free. Same rule as Cartesia's ping (§57). */
export async function vapiPing(): Promise<ProviderResult<{ assistantCount: number }>> {
  const res = await providerFetch(`${VAPI_API}/assistant?limit=1`, { headers: headers(), timeoutMs: 8_000 });
  if (!res.ok) return { ok: false, sideEffect: 'NONE', latencyMs: res.latencyMs, error: res.error };
  const arr = Array.isArray(res.json) ? res.json : [];
  return { ok: true, sideEffect: 'NONE', latencyMs: res.latencyMs, data: { assistantCount: arr.length } };
}

/** The numbers this account can actually dial FROM. Read-only. */
export async function listVapiPhoneNumbers(): Promise<ProviderResult<Array<{ id: string; number: string | null; provider: string | null }>>> {
  const res = await providerFetch(`${VAPI_API}/phone-number`, { headers: headers(), timeoutMs: 10_000 });
  if (!res.ok) return { ok: false, sideEffect: 'NONE', latencyMs: res.latencyMs, error: res.error };
  const rows = Array.isArray(res.json) ? res.json : [];
  return {
    ok: true, sideEffect: 'NONE', latencyMs: res.latencyMs,
    data: rows.map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return {
        id: String(o.id ?? ''),
        number: typeof o.number === 'string' ? o.number : null,
        provider: typeof o.provider === 'string' ? o.provider : null,
      };
    }).filter((r) => r.id),
  };
}

// ── Webhook payloads ────────────────────────────────────────────────────────

export interface VapiEvent {
  kind: 'STATUS' | 'END_OF_CALL' | 'HANG' | 'OTHER';
  eventKey: string;
  providerCallId: string | null;
  status: string | null;
  endedReason: string | null;
  durationSec: number | null;
  /** Vapi's own cost for the call, in dollars, when it reports one. */
  costUsd: number | null;
  costBreakdown: Record<string, number> | null;
  transcript: string | null;
  summary: string | null;
  recordingUrl: string | null;
  /** Whatever Homatch put in metadata at placeCall time. */
  metadata: Record<string, unknown>;
  structured: Record<string, unknown> | null;
}

export function parseVapiWebhook(body: unknown): VapiEvent | null {
  if (!body || typeof body !== 'object') return null;
  const message = ((body as Record<string, unknown>).message ?? body) as Record<string, unknown>;
  const type = String(message.type ?? '');
  const call = (message.call ?? {}) as Record<string, unknown>;
  const providerCallId = typeof call.id === 'string' ? call.id : (typeof message.callId === 'string' ? message.callId : null);

  const kind: VapiEvent['kind'] =
    type === 'status-update' ? 'STATUS'
    : type === 'end-of-call-report' ? 'END_OF_CALL'
    : type === 'hang' ? 'HANG'
    : 'OTHER';

  const artifact = (message.artifact ?? {}) as Record<string, unknown>;
  const analysis = (message.analysis ?? {}) as Record<string, unknown>;
  const breakdown = (message.costBreakdown ?? {}) as Record<string, unknown>;

  return {
    kind,
    // Vapi does not send an event id, so one is derived from the facts that
    // make this delivery unique. A redelivery of the same transition carries
    // the same key and is dropped by the unique index.
    eventKey: `vapi:${providerCallId ?? 'unknown'}:${type}:${String(message.status ?? message.endedReason ?? '')}`,
    providerCallId,
    status: typeof message.status === 'string' ? message.status : (typeof call.status === 'string' ? call.status : null),
    endedReason: typeof message.endedReason === 'string' ? message.endedReason
      : (typeof call.endedReason === 'string' ? call.endedReason : null),
    durationSec: numberOrNull(message.durationSeconds) ?? numberOrNull(message.duration),
    costUsd: numberOrNull(message.cost),
    costBreakdown: Object.keys(breakdown).length
      ? Object.fromEntries(Object.entries(breakdown)
          .filter(([, v]) => typeof v === 'number')
          .map(([k, v]) => [k, v as number]))
      : null,
    transcript: typeof artifact.transcript === 'string' ? artifact.transcript
      : (typeof message.transcript === 'string' ? message.transcript : null),
    summary: typeof analysis.summary === 'string' ? analysis.summary
      : (typeof message.summary === 'string' ? message.summary : null),
    recordingUrl: typeof artifact.recordingUrl === 'string' ? artifact.recordingUrl
      : (typeof message.recordingUrl === 'string' ? message.recordingUrl : null),
    metadata: (call.metadata ?? message.metadata ?? {}) as Record<string, unknown>,
    structured: (analysis.structuredData ?? null) as Record<string, unknown> | null,
  };
}

function numberOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Vapi's cost breakdown, mapped onto Homatch's components with the bundle
 * relationship made explicit.
 *
 * This is where §44's double-count guard earns its place. Vapi reports `stt`,
 * `llm`, `tts` AND `total`, and `total` already contains the other three. A
 * naive sum of every key it returns overstates the cost of every call by
 * roughly a factor of two, and a margin report built on it would be wrong in
 * the direction that looks fine.
 */
export function vapiCostComponents(event: VapiEvent): Array<{
  component: 'ORCHESTRATION' | 'TELEPHONY' | 'STT' | 'LLM' | 'TTS';
  provider: string;
  cents: number;
  source: 'PROVIDER_ACTUAL';
  bundledWith?: 'ORCHESTRATION';
  providerRequestId?: string;
}> {
  const out: ReturnType<typeof vapiCostComponents> = [];
  const id = event.providerCallId ?? undefined;
  const b = event.costBreakdown ?? {};

  if (event.costUsd != null) {
    out.push({ component: 'ORCHESTRATION', provider: 'VAPI', cents: event.costUsd * 100, source: 'PROVIDER_ACTUAL', providerRequestId: id });
  }
  // Each sub-component declares that it is already inside ORCHESTRATION.
  // computeCogs() drops them whenever the orchestration line is present, and
  // keeps them when it is not — which is the case where the total is missing
  // and the parts are all we have.
  const subs: Array<[keyof typeof b, 'STT' | 'LLM' | 'TTS' | 'TELEPHONY', string]> = [
    ['stt', 'STT', 'VAPI'],
    ['llm', 'LLM', 'VAPI'],
    ['tts', 'TTS', 'VAPI'],
    ['transport', 'TELEPHONY', 'VAPI'],
  ];
  for (const [key, component, provider] of subs) {
    const v = b[key as string];
    if (typeof v === 'number' && v > 0) {
      out.push({ component, provider, cents: v * 100, source: 'PROVIDER_ACTUAL', bundledWith: 'ORCHESTRATION', providerRequestId: id });
    }
  }
  return out;
}
