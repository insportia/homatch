/*
 * HOMATCH — an email reply, turned into something the inbox already understands.
 *
 * WHAT THIS IS FOR
 *
 * Homatch could send email and could not receive it. A campaign went out, a
 * person replied, and the reply went to a mailbox nobody reads — so the one
 * moment the outreach actually worked was the moment the product stopped
 * knowing about it.
 *
 * This is the pure half of fixing that: is the request really from the
 * provider, and what does its payload actually say. Everything it decides is a
 * function of its arguments, so all of it can be checked without a webhook, a
 * network, or a provider account. The edge function beside it does the parts
 * that need a database.
 *
 * WHY THERE IS NO SECOND INBOX
 *
 * `comm_conversations.channel` has allowed 'EMAIL' since the communications
 * hub was written. An inbound email is the same shape of event as an inbound
 * WhatsApp message — a peer, a body, a provider message id, a time — so it
 * goes through comm_record_inbound like everything else and lands in the
 * thread list the product already has. Nothing here builds a mailbox.
 *
 * THE SIGNATURE
 *
 * Resend signs webhooks with the Svix scheme, which is a good scheme and an
 * easy one to implement badly:
 *
 *   The signed content is `id.timestamp.body` — all three, in that order. An
 *   implementation that signs only the body accepts any old delivery replayed
 *   under a new id.
 *   The secret is base64 AFTER the `whsec_` prefix. Using the prefixed string
 *   as the key produces a verifier that rejects every genuine request, which
 *   is the failure everybody debugs for an hour.
 *   The header carries a LIST of `v1,<sig>` pairs, because a secret being
 *   rotated means two are valid at once. Taking the first and comparing it
 *   is a webhook that breaks on the day the secret is rotated.
 *   The timestamp is checked against a window, or a captured request is valid
 *   forever.
 *
 * All four are here, and each has a test that fails if it is undone.
 */

/** How far out of date a delivery may be before it is refused. Svix's own. */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export type SignatureFailure =
  | 'NO_SECRET'
  | 'MISSING_HEADERS'
  | 'BAD_TIMESTAMP'
  | 'STALE'
  | 'NO_V1_SIGNATURE'
  | 'MISMATCH';

export type SignatureVerdict =
  | { ok: true }
  | { ok: false; reason: SignatureFailure };

/** The three headers Svix sends, under either of the two names it uses. */
export function svixHeaders(get: (name: string) => string | null): {
  id: string | null; timestamp: string | null; signature: string | null;
} {
  return {
    id: get('svix-id') ?? get('webhook-id'),
    timestamp: get('svix-timestamp') ?? get('webhook-timestamp'),
    signature: get('svix-signature') ?? get('webhook-signature'),
  };
}

/**
 * The v1 signatures in the header, in order.
 *
 * `v1,abc v1,def` is two valid signatures, which is what a secret rotation
 * looks like from the outside. Versions other than v1 are ignored rather than
 * guessed at.
 */
export function v1Signatures(header: string | null): string[] {
  if (!header) return [];
  return header.split(' ')
    .map(part => part.trim())
    .filter(part => part.startsWith('v1,'))
    .map(part => part.slice(3))
    .filter(Boolean);
}

/**
 * `whsec_` + base64. The bytes are what signs; the prefix is packaging.
 *
 * Returns an ArrayBuffer rather than a view. `Uint8Array` is generic over its
 * backing buffer in current lib.dom, and a view that MIGHT sit on a
 * SharedArrayBuffer is not a BufferSource — so importKey refuses it, and the
 * usual fix of casting hides the question rather than answering it.
 */
function secretBytes(secret: string): ArrayBuffer {
  const raw = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  let bytes: Uint8Array;
  try {
    const binary = atob(raw);
    bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  } catch {
    /* Not base64. Some deployments configure a raw string; using its bytes is
       better than refusing every request, and a wrong key still fails the
       comparison below rather than passing anything. */
    bytes = new TextEncoder().encode(raw);
  }
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

/** Constant time, so a wrong signature cannot be narrowed down by timing. */
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Is this delivery really from the provider, and recent?
 *
 * Takes the RAW body as text. Re-serialising a parsed body changes the bytes —
 * key order, whitespace, unicode escapes — and the signature is over bytes.
 */
export async function verifyInboundSignature(input: {
  rawBody: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  secret: string | null | undefined;
  nowMs?: number;
  toleranceSeconds?: number;
}): Promise<SignatureVerdict> {
  const { rawBody, id, timestamp, signature, secret } = input;
  if (!secret) return { ok: false, reason: 'NO_SECRET' };
  if (!id || !timestamp || !signature) return { ok: false, reason: 'MISSING_HEADERS' };

  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds)) return { ok: false, reason: 'BAD_TIMESTAMP' };

  const now = input.nowMs ?? Date.now();
  const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;
  /* Both directions. A timestamp from the future is as much a sign of a
     forged or replayed request as one from last week. */
  if (Math.abs(now / 1000 - seconds) > tolerance) return { ok: false, reason: 'STALE' };

  const provided = v1Signatures(signature);
  if (!provided.length) return { ok: false, reason: 'NO_V1_SIGNATURE' };

  const key = await crypto.subtle.importKey(
    'raw', secretBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signed = `${id}.${timestamp}.${rawBody}`;
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
  const expected = btoa(String.fromCharCode(...new Uint8Array(mac)));

  for (const candidate of provided) {
    if (timingSafeEqual(expected, candidate)) return { ok: true };
  }
  return { ok: false, reason: 'MISMATCH' };
}

/* ------------------------------------------------------------------ *
 * What the payload says                                               *
 * ------------------------------------------------------------------ */

export interface InboundEmail {
  /** The provider's own id for this delivery. The idempotency key. */
  eventId: string;
  eventType: string;
  /** The message id, for threading and for message-level dedupe. */
  messageId: string | null;
  /*
   * The provider's id for the RECEIVED email, which is neither the delivery
   * id nor the RFC message id.
   *
   * Resend's email.received carries metadata ONLY -- its own documentation
   * says so in as many words: no body, no headers, no attachment contents.
   * The body is a second call against this id, and without it a real reply is
   * recorded as a message with nothing in it.
   */
  providerEmailId: string | null;
  fromAddress: string;
  fromName: string | null;
  /** Every address it was addressed to, lowercased. */
  to: string[];
  subject: string | null;
  text: string | null;
  html: string | null;
  /** RFC message ids this is a reply to, newest first. */
  inReplyTo: string[];
  sentAt: string | null;
  attachmentCount: number;
}

/** `"Nino Beridze" <nino@example.ge>` → the two halves. */
export function parseAddress(value: unknown): { address: string | null; name: string | null } {
  if (typeof value !== 'string' || !value.trim()) return { address: null, name: null };
  const angled = value.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
  if (angled) {
    const name = angled[1].replace(/^["']|["']$/g, '').trim();
    return { address: normaliseAddress(angled[2]), name: name || null };
  }
  return { address: normaliseAddress(value), name: null };
}

/** Lowercased and trimmed. Addresses are compared, so they are compared alike. */
export function normaliseAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@.]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) return value.split(',');
  return [];
}

/** Header lookup across the two shapes providers use: a list, or an object. */
function header(payload: Record<string, unknown>, name: string): string | null {
  const wanted = name.toLowerCase();
  const raw = payload.headers;
  if (Array.isArray(raw)) {
    for (const h of raw) {
      const entry = h as Record<string, unknown>;
      if (String(entry?.name ?? '').toLowerCase() === wanted) {
        const value = entry?.value;
        return typeof value === 'string' ? value : null;
      }
    }
    return null;
  }
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (k.toLowerCase() === wanted) return typeof v === 'string' ? v : null;
    }
  }
  return null;
}

/** `<a@b> <c@d>` → ['<a@b>', '<c@d>']. Kept angle-bracketed, as sent. */
export function messageIds(value: string | null): string[] {
  if (!value) return [];
  return [...value.matchAll(/<[^>\s]+>/g)].map(m => m[0]);
}

/**
 * The provider's delivery, as the one shape the rest of the code uses.
 *
 * Returns null for anything that is not an inbound email — a delivery
 * receipt, a bounce, an event type added next year. Returning null rather
 * than throwing is deliberate: an unknown event is not an error, it is
 * something to acknowledge and ignore, and throwing would make the provider
 * retry it forever.
 */
export function normaliseInboundEmail(body: unknown, eventIdFallback: string): InboundEmail | null {
  if (!body || typeof body !== 'object') return null;
  const envelope = body as Record<string, unknown>;

  const eventType = typeof envelope.type === 'string' ? envelope.type : '';
  /* The inbound event, under either the documented name or the one the
     dashboard shows. Anything else — delivered, bounced, complained — belongs
     to the outbound side and is not this function's business. */
  if (!/^email\.(received|inbound)$/.test(eventType)) return null;

  const data = (envelope.data && typeof envelope.data === 'object')
    ? envelope.data as Record<string, unknown>
    : envelope;

  const from = parseAddress(data.from);
  if (!from.address) return null;

  /*
   * Every address this arrived AT, because that is what picks the tenant.
   *
   * `to` is the To header the sender wrote. `received_for` is the address the
   * provider actually delivered to, and the two differ whenever a message was
   * forwarded -- exactly the case where trusting the header alone resolves to
   * nobody and a genuine reply is filed as unroutable.
   */
  const to = [...asArray(data.to), ...asArray(data.received_for)]
    .map(v => (typeof v === 'string' ? parseAddress(v).address : null))
    .filter((v): v is string => Boolean(v))
    .filter((v, i, all) => all.indexOf(v) === i);

  const providerEmailId = typeof data.email_id === 'string' && data.email_id
    ? data.email_id
    : (typeof data.id === 'string' && data.id ? data.id : null);

  const messageId = header(data, 'message-id')
    ?? (typeof data.message_id === 'string' ? data.message_id : null)
    ?? (typeof data.email_id === 'string' ? data.email_id : null);

  const inReplyTo = [
    ...messageIds(header(data, 'in-reply-to')),
    ...messageIds(header(data, 'references')).reverse(),
  ];

  const eventId = typeof envelope.id === 'string' && envelope.id
    ? envelope.id
    : (typeof data.email_id === 'string' && data.email_id ? data.email_id : eventIdFallback);

  return {
    eventId,
    eventType,
    messageId,
    providerEmailId,
    fromAddress: from.address,
    fromName: from.name,
    to,
    subject: typeof data.subject === 'string' ? data.subject : null,
    text: typeof data.text === 'string' ? data.text : null,
    html: typeof data.html === 'string' ? data.html : null,
    inReplyTo,
    sentAt: typeof envelope.created_at === 'string' ? envelope.created_at
      : (typeof data.created_at === 'string' ? data.created_at : null),
    attachmentCount: asArray(data.attachments).length,
  };
}

/*
 * ── What the person actually wrote ────────────────────────────────────────
 *
 * A reply arrives with the whole thread under it. Stored whole — the full
 * body is the record, and trimming what is stored would lose the only copy —
 * but the CONVERSATION PREVIEW is one line in a list, and "On Tuesday, Homatch
 * wrote:" as the preview of every reply makes the list useless.
 *
 * Deliberately conservative. Every pattern below is an unambiguous quote
 * marker, and anything it is not sure about is kept: showing slightly too much
 * costs a long preview, and cutting too much hides what somebody said.
 */
const QUOTE_MARKERS: RegExp[] = [
  /^\s*On .+ wrote:\s*$/im,                 // Gmail, Apple Mail, most clients
  /^\s*-{2,}\s*Original Message\s*-{2,}\s*$/im,
  /^\s*_{10,}\s*$/m,                        // Outlook's rule
  /^\s*From:\s.+\n\s*Sent:\s/im,            // Outlook's forwarded header block
  /^\s*>{1,}\s?.*(\n\s*>{1,}\s?.*){2,}/m,   // three or more quoted lines
];

export function stripQuotedReply(text: string | null): string {
  if (!text) return '';
  let cut = text.length;
  for (const marker of QUOTE_MARKERS) {
    const match = marker.exec(text);
    if (match && match.index < cut) cut = match.index;
  }
  const head = text.slice(0, cut).trimEnd();
  /* If trimming leaves nothing, the reply was quote-only — a bare forward, or
     somebody who wrote above nothing. The whole body is better than a blank. */
  return head.trim() ? head : text.trim();
}

/** One line for the thread list. Never the quoted history. */
export function previewOf(text: string | null, subject: string | null): string {
  const body = stripQuotedReply(text).replace(/\s+/g, ' ').trim();
  if (body) return body.slice(0, 200);
  return (subject ?? '').trim().slice(0, 200);
}
