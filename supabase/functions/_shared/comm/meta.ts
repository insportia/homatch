// HOMATCH Communications — Meta WhatsApp Cloud API, directly.
//
// §30: Meta Cloud API is the primary WhatsApp integration and Twilio is NOT
// required for it. This file is the whole of Homatch's knowledge of Meta's
// wire format; everything above it speaks the vocabulary in statusMap.ts.
//
// SECRETS
//
//   META_WHATSAPP_ACCESS_TOKEN        bearer for every call
//   META_WHATSAPP_PHONE_NUMBER_ID     the sender
//   META_WHATSAPP_BUSINESS_ACCOUNT_ID the WABA, for template listing
//   META_WHATSAPP_APP_SECRET          webhook signature verification
//   META_WHATSAPP_VERIFY_TOKEN        webhook handshake
//
// The first three exist today against a TEST number. The last two are needed
// before the webhook can be trusted, and their absence is reported as an
// external blocker rather than worked around — a webhook that skips signature
// verification because a secret is missing is worse than one that refuses.

import {
  providerFetch, requireSecret, hasSecret,
  type MessagingProvider, type ProviderResult, type SendMessageParams,
  type SentMessage, type ChannelAccountFacts, type RemoteTemplate,
} from './contracts.ts';

/**
 * Pinned, not floating.
 *
 * Meta deprecates versions on a schedule and changes payload shapes between
 * them. A floating version means the webhook parser breaks on a day nobody
 * deployed anything, which is the worst possible day for it to break. Upgrades
 * are a deliberate edit here plus a re-test, and the version is also stored on
 * the comm_provider_routes row so Admin can see which one is live.
 */
export const META_API_VERSION = 'v21.0';
const GRAPH = `https://graph.facebook.com/${META_API_VERSION}`;

/**
 * Meta error codes worth naming. Everything else falls through to UNKNOWN,
 * which is honest — inventing a meaning for a code we have not seen is how a
 * permanent failure gets retried forever.
 */
function classifyMetaError(status: number, body: string): ProviderResult<never>['error'] {
  let code: number | null = null;
  let subcode: number | null = null;
  let message = `Meta returned ${status}`;
  try {
    const parsed = JSON.parse(body) as { error?: { code?: number; error_subcode?: number; message?: string } };
    code = parsed?.error?.code ?? null;
    subcode = parsed?.error?.error_subcode ?? null;
    // Meta's message can echo the recipient's number. It is kept out of the
    // normalised message and only ever stored in the raw event row (§74).
    if (parsed?.error?.message && !/\+?\d{7,}/.test(parsed.error.message)) {
      message = parsed.error.message;
    }
  } catch { /* a non-JSON body from Meta is itself the anomaly; status is enough */ }

  if (status === 401 || code === 190) {
    return { code: 'AUTH', message: 'the WhatsApp access token is invalid or expired', retryable: false, providerCode: code };
  }
  if (status === 429 || code === 4 || code === 80007 || code === 130429) {
    return { code: 'RATE_LIMIT', message: 'Meta is throttling this number', retryable: true, providerCode: code };
  }
  if (code === 131026 || code === 131031) {
    return { code: 'INVALID_RECIPIENT', message: 'this number cannot receive WhatsApp messages', retryable: false, providerCode: code };
  }
  if (code === 131047 || code === 131051) {
    return { code: 'POLICY', message: 'outside the 24-hour window; an approved template is required', retryable: false, providerCode: code };
  }
  if (code === 131049 || code === 131050 || code === 368) {
    return { code: 'POLICY', message: 'Meta declined to deliver this message', retryable: false, providerCode: code };
  }
  if (code === 132000 || code === 132001 || code === 132005 || code === 132007 || code === 132012 || code === 132015) {
    return { code: 'POLICY', message: 'the template is not usable as sent', retryable: false, providerCode: code };
  }
  if (status >= 500 || code === 1 || code === 2) {
    return { code: 'TRANSIENT', message: 'Meta is temporarily unavailable', retryable: true, providerCode: code };
  }
  return { code: 'UNKNOWN', message, retryable: false, providerCode: subcode ?? code };
}

export interface MetaConfig {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
}

export function metaConfigFromEnv(): MetaConfig {
  return {
    accessToken: requireSecret('META_WHATSAPP_ACCESS_TOKEN'),
    phoneNumberId: requireSecret('META_WHATSAPP_PHONE_NUMBER_ID'),
    businessAccountId: requireSecret('META_WHATSAPP_BUSINESS_ACCOUNT_ID'),
  };
}

export function metaCredentialsPresent(): { ok: boolean; missing: string[] } {
  const required = [
    'META_WHATSAPP_ACCESS_TOKEN',
    'META_WHATSAPP_PHONE_NUMBER_ID',
    'META_WHATSAPP_BUSINESS_ACCOUNT_ID',
  ];
  const missing = required.filter((n) => !hasSecret(n));
  return { ok: missing.length === 0, missing };
}

/** The two the WEBHOOK needs. Separate, because sending works without them and receiving must not. */
export function metaWebhookSecretsPresent(): { ok: boolean; missing: string[] } {
  const missing = ['META_WHATSAPP_APP_SECRET', 'META_WHATSAPP_VERIFY_TOKEN'].filter((n) => !hasSecret(n));
  return { ok: missing.length === 0, missing };
}

export function createMetaProvider(cfg: MetaConfig): MessagingProvider {
  const authHeaders = {
    Authorization: `Bearer ${cfg.accessToken}`,
    'Content-Type': 'application/json',
  };

  return {
    name: 'META',

    async send(params: SendMessageParams): Promise<ProviderResult<SentMessage>> {
      const body = buildSendBody(params);
      if (!body) {
        return {
          ok: false, sideEffect: 'NONE',
          error: { code: 'NOT_SUPPORTED', message: 'nothing to send', retryable: false },
        };
      }

      const res = await providerFetch(
        `${GRAPH}/${cfg.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify(body),
          timeoutMs: 20_000,
        },
        classifyMetaError,
      );

      if (res.timedOut) {
        // Meta may well have accepted it. Falling back or retrying blind would
        // send the same message twice, so this is reconciled against the
        // status webhook rather than retried (§91).
        return {
          ok: false, sideEffect: 'MAYBE', latencyMs: res.latencyMs,
          error: { code: 'TIMEOUT', message: 'no response from Meta; delivery is unknown', retryable: false },
        };
      }
      if (!res.ok) {
        return { ok: false, sideEffect: 'NONE', latencyMs: res.latencyMs, error: res.error };
      }

      const payload = res.json as {
        messages?: Array<{ id?: string; message_status?: string }>;
        contacts?: Array<{ wa_id?: string }>;
      };
      const id = payload?.messages?.[0]?.id;
      if (!id) {
        return {
          ok: false, sideEffect: 'MAYBE', latencyMs: res.latencyMs,
          error: { code: 'UNKNOWN', message: 'Meta accepted the request without returning a message id', retryable: false },
        };
      }

      return {
        ok: true,
        sideEffect: 'COMMITTED',
        providerRef: id,
        latencyMs: res.latencyMs,
        data: { providerMessageId: id, status: payload.messages?.[0]?.message_status ?? 'accepted' },
      };
    },

    async fetchMedia(mediaId: string) {
      // Two steps: Meta returns a short-lived, authenticated URL, then the
      // bytes. The URL requires the same bearer token, so it can never be
      // handed to a browser (§119).
      const meta = await providerFetch(`${GRAPH}/${mediaId}`, { headers: authHeaders, timeoutMs: 10_000 }, classifyMetaError);
      if (!meta.ok) return { ok: false, sideEffect: 'NONE', error: meta.error };

      const info = meta.json as { url?: string; mime_type?: string; file_size?: number };
      if (!info?.url) {
        return { ok: false, sideEffect: 'NONE', error: { code: 'UNKNOWN', message: 'Meta returned no media URL', retryable: false } };
      }
      // A 16MB inbound file should not be pulled into an edge function's
      // memory. Meta's own cap is 100MB for documents; anything above this is
      // recorded as received and left unfetched.
      if ((info.file_size ?? 0) > 16 * 1024 * 1024) {
        return { ok: false, sideEffect: 'NONE', error: { code: 'NOT_SUPPORTED', message: 'media is too large to retrieve', retryable: false } };
      }

      const res = await fetch(info.url, { headers: { Authorization: `Bearer ${cfg.accessToken}` } });
      if (!res.ok) {
        return { ok: false, sideEffect: 'NONE', error: { code: 'TRANSIENT', message: `media download returned ${res.status}`, retryable: true } };
      }
      return {
        ok: true, sideEffect: 'NONE',
        data: { bytes: new Uint8Array(await res.arrayBuffer()), mime: info.mime_type ?? 'application/octet-stream' },
      };
    },

    async describeAccount(): Promise<ProviderResult<ChannelAccountFacts>> {
      const fields = 'id,display_phone_number,verified_name,quality_rating,code_verification_status,platform_type,throughput';
      const res = await providerFetch(
        `${GRAPH}/${cfg.phoneNumberId}?fields=${encodeURIComponent(fields)}`,
        { headers: authHeaders, timeoutMs: 10_000 },
        classifyMetaError,
      );
      if (!res.ok) return { ok: false, sideEffect: 'NONE', latencyMs: res.latencyMs, error: res.error };

      const d = res.json as Record<string, unknown>;
      return {
        ok: true, sideEffect: 'NONE', latencyMs: res.latencyMs,
        data: {
          phoneE164: typeof d.display_phone_number === 'string' ? d.display_phone_number : null,
          displayName: typeof d.verified_name === 'string' ? d.verified_name : null,
          // §33: only what Meta reports. When it reports nothing, the UI shows
          // nothing rather than a plausible-looking default.
          qualityRating: typeof d.quality_rating === 'string' ? d.quality_rating : null,
          messagingTier: readThroughputLevel(d.throughput),
          verificationState: typeof d.code_verification_status === 'string' ? d.code_verification_status : null,
          providerNumberId: cfg.phoneNumberId,
          providerAccountId: cfg.businessAccountId,
        },
      };
    },

    async listTemplates(): Promise<ProviderResult<RemoteTemplate[]>> {
      const fields = 'id,name,language,category,status,rejected_reason,components';
      const res = await providerFetch(
        `${GRAPH}/${cfg.businessAccountId}/message_templates?limit=200&fields=${encodeURIComponent(fields)}`,
        { headers: authHeaders, timeoutMs: 15_000 },
        classifyMetaError,
      );
      if (!res.ok) return { ok: false, sideEffect: 'NONE', latencyMs: res.latencyMs, error: res.error };

      const data = (res.json as { data?: unknown[] })?.data ?? [];
      return {
        ok: true, sideEffect: 'NONE', latencyMs: res.latencyMs,
        data: data.map(parseRemoteTemplate).filter((t): t is RemoteTemplate => t !== null),
      };
    },

    async markRead(providerMessageId: string): Promise<ProviderResult<void>> {
      const res = await providerFetch(
        `${GRAPH}/${cfg.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: providerMessageId }),
          timeoutMs: 8_000,
        },
        classifyMetaError,
      );
      return res.ok
        ? { ok: true, sideEffect: 'COMMITTED', latencyMs: res.latencyMs }
        : { ok: false, sideEffect: 'NONE', latencyMs: res.latencyMs, error: res.error };
    },
  };
}

function readThroughputLevel(v: unknown): string | null {
  if (v && typeof v === 'object' && 'level' in (v as Record<string, unknown>)) {
    const level = (v as Record<string, unknown>).level;
    return typeof level === 'string' ? level : null;
  }
  return null;
}

function buildSendBody(p: SendMessageParams): Record<string, unknown> | null {
  const base = { messaging_product: 'whatsapp', recipient_type: 'individual', to: p.toE164 };

  if (p.template) {
    const components: unknown[] = [];
    if (p.template.headerMediaUrl) {
      components.push({
        type: 'header',
        parameters: [{ type: 'image', image: { link: p.template.headerMediaUrl } }],
      });
    }
    if (p.template.variables.length) {
      components.push({
        type: 'body',
        parameters: p.template.variables.map((text) => ({ type: 'text', text })),
      });
    }
    return {
      ...base,
      type: 'template',
      template: {
        name: p.template.name,
        language: { code: p.template.language },
        ...(components.length ? { components } : {}),
      },
    };
  }

  if (p.media) {
    const kind = p.media.mime.startsWith('image/') ? 'image'
      : p.media.mime.startsWith('video/') ? 'video'
      : p.media.mime.startsWith('audio/') ? 'audio'
      : 'document';
    return {
      ...base,
      type: kind,
      [kind]: {
        link: p.media.url,
        ...(p.media.caption ? { caption: p.media.caption } : {}),
        ...(kind === 'document' && p.media.filename ? { filename: p.media.filename } : {}),
      },
    };
  }

  if (p.text && p.text.trim()) {
    return { ...base, type: 'text', text: { preview_url: false, body: p.text.slice(0, 4096) } };
  }

  return null;
}

function parseRemoteTemplate(raw: unknown): RemoteTemplate | null {
  if (!raw || typeof raw !== 'object') return null;
  const t = raw as Record<string, unknown>;
  if (typeof t.name !== 'string') return null;

  const components = Array.isArray(t.components) ? (t.components as Array<Record<string, unknown>>) : [];
  const header = components.find((c) => String(c.type).toUpperCase() === 'HEADER');
  const body = components.find((c) => String(c.type).toUpperCase() === 'BODY');
  const footer = components.find((c) => String(c.type).toUpperCase() === 'FOOTER');
  const buttons = components.find((c) => String(c.type).toUpperCase() === 'BUTTONS');

  return {
    providerTemplateId: String(t.id ?? ''),
    name: t.name,
    language: String(t.language ?? 'en'),
    category: String(t.category ?? 'MARKETING').toUpperCase(),
    status: String(t.status ?? 'PENDING').toUpperCase(),
    rejectionReason: typeof t.rejected_reason === 'string' && t.rejected_reason !== 'NONE' ? t.rejected_reason : null,
    bodyText: typeof body?.text === 'string' ? body.text : null,
    headerKind: header ? String(header.format ?? 'TEXT').toUpperCase() : 'NONE',
    headerText: typeof header?.text === 'string' ? header.text : null,
    footerText: typeof footer?.text === 'string' ? footer.text : null,
    buttons: Array.isArray(buttons?.buttons) ? (buttons!.buttons as unknown[]) : [],
  };
}

// ── Webhook verification ────────────────────────────────────────────────────

/**
 * X-Hub-Signature-256 (§31).
 *
 * Two things are load-bearing and both are easy to get wrong:
 *
 *   The HMAC is over the RAW body bytes. Parsing the JSON and re-serialising
 *   it changes whitespace and key order, and the digest will never match.
 *   Every caller must hand this the exact string it read off the request.
 *
 *   The comparison is constant time. A byte-by-byte early return leaks, one
 *   request at a time, how much of a guessed prefix was correct.
 */
export async function verifyMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string,
): Promise<boolean> {
  if (!signatureHeader || !appSecret) return false;

  const prefix = 'sha256=';
  if (!signatureHeader.startsWith(prefix)) return false;
  const provided = signatureHeader.slice(prefix.length).trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(provided)) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(appSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');

  return timingSafeEqual(expected, provided);
}

/** Lengths are already known-equal by the regex above; this still avoids early exit. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** The GET handshake. Compared in constant time for the same reason. */
export function verifyHandshake(
  mode: string | null,
  token: string | null,
  expectedToken: string,
): boolean {
  if (mode !== 'subscribe' || !token || !expectedToken) return false;
  return timingSafeEqual(token, expectedToken);
}

// ── Inbound payload parsing ─────────────────────────────────────────────────

export interface NormalisedInbound {
  kind: 'MESSAGE' | 'STATUS' | 'TEMPLATE_UPDATE' | 'ACCOUNT_UPDATE' | 'UNKNOWN';
  /** The dedup key. Meta's own message/event id where one exists. */
  eventKey: string;
  phoneNumberId: string | null;
  wabaId: string | null;

  // MESSAGE
  from?: string;
  profileName?: string | null;
  messageId?: string;
  messageType?: string;
  text?: string | null;
  mediaId?: string | null;
  mediaMime?: string | null;
  caption?: string | null;
  timestamp?: string | null;
  /** Set when the contact tapped a quick-reply or list option. */
  buttonPayload?: string | null;

  // STATUS
  statusFor?: string;
  status?: string;
  errorCode?: number | null;
  errorTitle?: string | null;
  conversationId?: string | null;
  /** Meta's own billing category for the conversation, when it supplies one. */
  pricingCategory?: string | null;
  billable?: boolean | null;

  // TEMPLATE_UPDATE
  templateName?: string | null;
  templateLanguage?: string | null;
  templateStatus?: string | null;
  templateReason?: string | null;
}

/**
 * Flatten one Meta webhook body into zero or more events Homatch can act on.
 *
 * Meta nests four levels deep and packs unrelated things into one POST: a
 * body can carry an inbound message, three status updates for older messages
 * and a template approval, all at once. Each becomes its own event with its
 * own dedup key, because they must each succeed or fail independently.
 */
export function parseMetaWebhook(body: unknown): NormalisedInbound[] {
  const out: NormalisedInbound[] = [];
  if (!body || typeof body !== 'object') return out;

  const entries = (body as { entry?: unknown[] }).entry;
  if (!Array.isArray(entries)) return out;

  for (const entry of entries) {
    const e = entry as Record<string, unknown>;
    const wabaId = typeof e.id === 'string' ? e.id : null;
    const changes = Array.isArray(e.changes) ? (e.changes as Array<Record<string, unknown>>) : [];

    for (const change of changes) {
      const field = String(change.field ?? '');
      const value = (change.value ?? {}) as Record<string, unknown>;
      const meta = (value.metadata ?? {}) as Record<string, unknown>;
      const phoneNumberId = typeof meta.phone_number_id === 'string' ? meta.phone_number_id : null;

      if (field === 'message_template_status_update') {
        out.push({
          kind: 'TEMPLATE_UPDATE',
          // Meta supplies no event id here, so one is derived from the facts
          // that identify the change. A repeat of the same transition is the
          // same event and must dedupe.
          eventKey: `tpl:${value.message_template_id ?? value.message_template_name}:${value.event ?? ''}:${value.message_template_language ?? ''}`,
          phoneNumberId, wabaId,
          templateName: str(value.message_template_name),
          templateLanguage: str(value.message_template_language),
          templateStatus: String(value.event ?? '').toUpperCase() || null,
          templateReason: str(value.reason),
        });
        continue;
      }

      if (field !== 'messages') {
        out.push({ kind: 'UNKNOWN', eventKey: `other:${field}:${JSON.stringify(value).length}`, phoneNumberId, wabaId });
        continue;
      }

      const contacts = Array.isArray(value.contacts) ? (value.contacts as Array<Record<string, unknown>>) : [];
      const profileByWaId = new Map<string, string | null>();
      for (const c of contacts) {
        const waId = str(c.wa_id);
        const profile = (c.profile ?? {}) as Record<string, unknown>;
        if (waId) profileByWaId.set(waId, str(profile.name));
      }

      for (const raw of asArray(value.messages)) {
        const m = raw as Record<string, unknown>;
        const id = str(m.id);
        if (!id) continue;
        const type = String(m.type ?? 'unknown');
        const from = str(m.from) ?? '';

        out.push({
          kind: 'MESSAGE',
          eventKey: `msg:${id}`,
          phoneNumberId, wabaId,
          from,
          profileName: profileByWaId.get(from) ?? null,
          messageId: id,
          messageType: type,
          timestamp: str(m.timestamp),
          ...extractContent(m, type),
        });
      }

      for (const raw of asArray(value.statuses)) {
        const s = raw as Record<string, unknown>;
        const id = str(s.id);
        const status = String(s.status ?? '');
        if (!id || !status) continue;
        const errors = asArray(s.errors)[0] as Record<string, unknown> | undefined;
        const conversation = (s.conversation ?? {}) as Record<string, unknown>;
        const pricing = (s.pricing ?? {}) as Record<string, unknown>;

        out.push({
          kind: 'STATUS',
          // A status event's identity is the message AND the status: `sent`
          // and `delivered` for one message are two events, and keying on the
          // message id alone would drop every update after the first.
          eventKey: `st:${id}:${status}`,
          phoneNumberId, wabaId,
          statusFor: id,
          status,
          timestamp: str(s.timestamp),
          errorCode: errors?.code != null ? Number(errors.code) : null,
          errorTitle: str(errors?.title),
          conversationId: str(conversation.id),
          pricingCategory: str(pricing.category),
          billable: typeof pricing.billable === 'boolean' ? pricing.billable : null,
        });
      }
    }
  }

  return out;
}

function extractContent(m: Record<string, unknown>, type: string): Partial<NormalisedInbound> {
  switch (type) {
    case 'text':
      return { text: str((m.text as Record<string, unknown>)?.text) ?? str((m.text as Record<string, unknown>)?.body) };
    case 'button':
      return {
        text: str((m.button as Record<string, unknown>)?.text),
        buttonPayload: str((m.button as Record<string, unknown>)?.payload),
      };
    case 'interactive': {
      const i = (m.interactive ?? {}) as Record<string, unknown>;
      const reply = (i.button_reply ?? i.list_reply ?? {}) as Record<string, unknown>;
      return { text: str(reply.title), buttonPayload: str(reply.id) };
    }
    case 'image':
    case 'video':
    case 'audio':
    case 'voice':
    case 'document':
    case 'sticker': {
      const media = (m[type] ?? {}) as Record<string, unknown>;
      return {
        mediaId: str(media.id),
        mediaMime: str(media.mime_type),
        caption: str(media.caption),
        text: str(media.caption),
      };
    }
    case 'location': {
      const loc = (m.location ?? {}) as Record<string, unknown>;
      return { text: [loc.name, loc.address, `${loc.latitude},${loc.longitude}`].filter(Boolean).join(' · ') };
    }
    default:
      return { text: null };
  }
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length ? v : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
