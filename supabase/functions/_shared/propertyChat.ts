// PROPERTY CONVERSATIONS — the send path's decisions, as pure functions.
//
// send-message/index.ts does the I/O (auth, reads, the insert, notify); every rule it
// applies to what a client sent lives here so it can be tested without a database:
//
//   parseSendRequest     what the body may contain, normalised; nothing else survives
//   validateMedia        sender-owned path, real size and type from storage, voice ≤ 60s
//   buildPropertyCard    the listing snapshot — from the DATABASE rows, never the client
//   isDuplicateBody      the same words to the same conversation within 30 seconds
//   offerCapDecision     an owner may send 3 messages before the member first replies
//   notificationPlan     NEW_MESSAGE or PROPERTY_OFFER, push priority, the one email
//   SEND_RATE_LIMIT      burst 8 / 10 s, 400 / day (consume_marketplace_rate_limit)
//
// No Deno, no network. Imported by the edge function and by node:test.

import {
  DM_AUDIO_MIME, DM_IMAGE_MIME, DM_MAX_BODY_CHARS, DM_MAX_MEDIA_BYTES, DM_VOICE_MAX_SECONDS,
  baseMime, isChatLanguage, isOwnMediaPath, isValidClientMessageId, type MessageKind,
} from '../../../src/chat/conversation.ts';

export const SEND_RATE_LIMIT = {
  operation: 'dm_send', burstLimit: 8, burstSeconds: 10, dailyLimit: 400, dailySeconds: 24 * 60 * 60,
} as const;
export const AI_RATE_LIMIT = {
  operation: 'dm_ai', burstLimit: 20, burstSeconds: 10 * 60, dailyLimit: 150, dailySeconds: 24 * 60 * 60,
} as const;
export const DUPLICATE_WINDOW_MS = 30_000;
export const OFFER_CAP_BEFORE_REPLY = 3;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

export interface SendRequest {
  conversationId: string | null;
  propertyId: string | null;
  recipientId: string;
  kind: MessageKind;
  body: string;
  mediaPath: string | null;
  mediaMeta: Record<string, unknown> | null;
  replyToId: string | null;
  cardPropertyId: string | null;
  originalBody: string | null;
  originalLang: string | null;
  translatedTo: string | null;
  clientMessageId: string | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const KINDS: readonly MessageKind[] = ['TEXT', 'PHOTO', 'VOICE', 'PROPERTY'];

/**
 * The request body, reduced to what a sender may decide. Listing fields a client might
 * send alongside a property card (title, price, …) are simply not read.
 */
export function parseSendRequest(raw: unknown): Parsed<SendRequest> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const kind = (typeof r.kind === 'string' ? r.kind.toUpperCase() : 'TEXT') as MessageKind;
  if (!KINDS.includes(kind)) return { ok: false, error: 'INVALID_KIND' };
  const body = typeof r.body === 'string' ? r.body.trim() : '';
  if (body.length > DM_MAX_BODY_CHARS) return { ok: false, error: 'MESSAGE_TOO_LONG' };
  if (kind === 'TEXT' && !body) return { ok: false, error: 'Message body required' };
  if (!isUuid(r.recipient_id)) return { ok: false, error: 'Valid recipient_id required' };
  const opt = (v: unknown) => (isUuid(v) ? v : null);
  if (r.conversation_id != null && !isUuid(r.conversation_id)) return { ok: false, error: 'INVALID_CONVERSATION' };
  if (r.reply_to_id != null && !isUuid(r.reply_to_id)) return { ok: false, error: 'INVALID_REPLY' };

  const mediaPath = typeof r.media_path === 'string' ? r.media_path : null;
  if ((kind === 'PHOTO' || kind === 'VOICE') !== !!mediaPath) return { ok: false, error: 'MEDIA_MISMATCH' };
  const mediaMeta = r.media_meta && typeof r.media_meta === 'object' && !Array.isArray(r.media_meta)
    ? r.media_meta as Record<string, unknown> : null;

  const cardPropertyId = opt(r.card_property_id);
  if ((kind === 'PROPERTY') !== !!cardPropertyId) return { ok: false, error: 'PROPERTY_CARD_MISMATCH' };

  /* A translation the sender approved: body is the translated text they reviewed,
     original_body what they actually wrote. Both or neither, and both languages known. */
  const originalBody = typeof r.original_body === 'string' && r.original_body.trim() ? r.original_body.trim() : null;
  const originalLang = typeof r.original_lang === 'string' ? r.original_lang.toLowerCase() : null;
  const translatedTo = typeof r.translated_to === 'string' ? r.translated_to.toLowerCase() : null;
  if (originalBody) {
    if (kind !== 'TEXT' || !body) return { ok: false, error: 'TRANSLATION_NEEDS_TEXT' };
    if (originalBody.length > DM_MAX_BODY_CHARS) return { ok: false, error: 'MESSAGE_TOO_LONG' };
    if (!isChatLanguage(originalLang) || !isChatLanguage(translatedTo) || originalLang === translatedTo) {
      return { ok: false, error: 'TRANSLATION_LANGUAGE_INVALID' };
    }
  }

  const clientMessageId = r.client_message_id == null ? null : r.client_message_id;
  if (clientMessageId !== null && !isValidClientMessageId(clientMessageId)) return { ok: false, error: 'INVALID_CLIENT_MESSAGE_ID' };

  return {
    ok: true,
    value: {
      conversationId: opt(r.conversation_id), propertyId: opt(r.property_id), recipientId: r.recipient_id as string,
      kind, body, mediaPath, mediaMeta, replyToId: opt(r.reply_to_id), cardPropertyId,
      originalBody, originalLang: originalBody ? originalLang : null, translatedTo: originalBody ? translatedTo : null,
      clientMessageId: clientMessageId as string | null,
    },
  };
}

/** What storage says about the uploaded object (list() metadata), when it exists. */
export interface StoredObject { size: number | null; mimetype: string | null }

/**
 * A media attachment, checked against the object actually stored — the client's own
 * claims about size and type are only used where storage reports nothing, and the voice
 * duration (which storage cannot know) is bounded to 60 seconds here and by the CHECK.
 */
export function validateMedia(
  kind: MessageKind, path: string | null, claimed: Record<string, unknown> | null,
  stored: StoredObject | null, senderId: string, conversationId: string,
): Parsed<Record<string, unknown> | null> {
  if (kind !== 'PHOTO' && kind !== 'VOICE') return { ok: true, value: null };
  if (!isOwnMediaPath(path, senderId, conversationId)) return { ok: false, error: 'MEDIA_PATH_INVALID' };
  if (!stored) return { ok: false, error: 'MEDIA_NOT_FOUND' };
  const size = stored.size ?? (typeof claimed?.size === 'number' ? claimed.size : null);
  if (size === null || !(size > 0)) return { ok: false, error: 'MEDIA_SIZE_UNKNOWN' };
  if (size > DM_MAX_MEDIA_BYTES) return { ok: false, error: 'MEDIA_TOO_LARGE' };
  const mime = baseMime(stored.mimetype ?? (typeof claimed?.mime === 'string' ? claimed.mime : ''));
  if (kind === 'PHOTO') {
    if (!(DM_IMAGE_MIME as readonly string[]).includes(mime)) return { ok: false, error: 'MEDIA_TYPE_INVALID' };
    const meta: Record<string, unknown> = { mime, size };
    for (const k of ['width', 'height'] as const) {
      const v = claimed?.[k];
      if (typeof v === 'number' && Number.isInteger(v) && v > 0 && v < 20000) meta[k] = v;
    }
    return { ok: true, value: meta };
  }
  if (!(DM_AUDIO_MIME as readonly string[]).includes(mime)) return { ok: false, error: 'MEDIA_TYPE_INVALID' };
  const d = typeof claimed?.duration_seconds === 'number' ? Math.round(claimed.duration_seconds * 10) / 10 : NaN;
  if (!(d > 0) || d > DM_VOICE_MAX_SECONDS) return { ok: false, error: 'VOICE_TOO_LONG' };
  return { ok: true, value: { mime, size, duration_seconds: d } };
}

/** The database rows a card is built from (properties + property_facts). */
export interface CardPropertyRow {
  id: string; user_id: string; homatch_id?: number | null; title?: string | null;
  is_deleted?: boolean | null; archived_at?: string | null; cover_photo_url?: string | null;
  transaction_type?: string | null; property_type?: string | null;
}
export interface CardFactsRow {
  city?: string | null; district?: string | null; total_price?: number | string | null; currency?: string | null;
  bedrooms?: number | null; area?: number | string | null; photo_visibility?: string | null;
}

export interface PropertyCard {
  id: string; homatch_id: number | null; title: string | null; price: number | null; currency: string | null;
  city: string | null; district: string | null; bedrooms: number | null; area: number | null;
  cover: string | null; transaction_type: string | null; property_type: string | null; snapshot_at: string;
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};
const str = (v: unknown, max = 200): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/**
 * May this sender attach this property? Only their own, and only a live listing.
 * Returns the refusal code, or null when allowed.
 */
export function cardRefusal(p: CardPropertyRow | null, senderId: string): string | null {
  if (!p) return 'PROPERTY_NOT_FOUND';
  if (p.user_id !== senderId) return 'PROPERTY_NOT_YOURS';
  if (p.is_deleted) return 'PROPERTY_NOT_FOUND';
  if (p.archived_at) return 'PROPERTY_ARCHIVED';
  return null;
}

/**
 * The verified listing snapshot. Every field is read from the listing's own rows; a
 * field the listing does not hold is null, never filled in. A cover is included only
 * when the listing's photos are public — the key itself, which the reader resolves.
 */
export function buildPropertyCard(p: CardPropertyRow, f: CardFactsRow | null, now = new Date()): PropertyCard {
  const photosPublic = (f?.photo_visibility ?? 'PUBLIC') === 'PUBLIC';
  const price = num(f?.total_price);
  const currency = str(f?.currency, 3)?.toUpperCase() ?? null;
  const beds = num(f?.bedrooms);
  return {
    id: p.id,
    homatch_id: typeof p.homatch_id === 'number' ? p.homatch_id : null,
    title: str(p.title),
    price: price !== null && currency && /^[A-Z]{3}$/.test(currency) ? price : null,
    currency: price !== null && currency && /^[A-Z]{3}$/.test(currency) ? currency : null,
    city: str(f?.city, 80),
    district: str(f?.district, 80),
    bedrooms: beds !== null && Number.isInteger(beds) ? beds : null,
    area: num(f?.area),
    cover: photosPublic ? str(p.cover_photo_url, 500) : null,
    transaction_type: str(p.transaction_type, 20),
    property_type: str(p.property_type, 30),
    snapshot_at: now.toISOString(),
  };
}

/** Whitespace- and case-insensitive equality of two message texts. */
export function normaliseBody(s: string): string {
  return s.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The same words to the same conversation within the window: a double tap, a stuck
 * retry, or a paste-flood. Only text bodies are compared; an empty caption is not text.
 */
export function isDuplicateBody(
  recent: ReadonlyArray<{ body: string; created_at: string; client_message_id?: string | null }>,
  body: string, now: Date, clientMessageId: string | null = null, windowMs = DUPLICATE_WINDOW_MS,
): boolean {
  const target = normaliseBody(body);
  if (!target) return false;
  return recent.some((m) => {
    if (clientMessageId && m.client_message_id === clientMessageId) return false;
    const age = now.getTime() - new Date(m.created_at).getTime();
    return age >= 0 && age < windowMs && normaliseBody(m.body) === target;
  });
}

/**
 * The anti-flood rule for an owner approaching a member: until the member replies once,
 * the owner may send at most three messages in that conversation.
 */
export function offerCapDecision(o: {
  senderOwnsProperty: boolean; counterpartMessages: number; senderMessages: number; cap?: number;
}): { allowed: boolean; remaining: number | null } {
  if (!o.senderOwnsProperty || o.counterpartMessages > 0) return { allowed: true, remaining: null };
  const cap = o.cap ?? OFFER_CAP_BEFORE_REPLY;
  return { allowed: o.senderMessages < cap, remaining: Math.max(0, cap - o.senderMessages) };
}

/**
 * Who is told what, and how loudly.
 *
 *   PROPERTY_OFFER  the first message of a conversation an owner opened with a lead
 *   NEW_MESSAGE     everything else, as before
 *
 * A muted conversation is still written in-app but never pushed (LOW priority is the
 * one push-send always skips). The transactional email goes once per conversation,
 * only for an offer, and only when the member has email notifications on.
 */
export function notificationPlan(o: {
  isLeadOffer: boolean; isFirstContact: boolean; recipientMuted: boolean; emailEnabled: boolean;
}): { kind: 'PROPERTY_OFFER' | 'NEW_MESSAGE'; priority: 'HIGH' | 'LOW'; sendEmail: boolean } {
  const offer = o.isLeadOffer && o.isFirstContact;
  return {
    kind: offer ? 'PROPERTY_OFFER' : 'NEW_MESSAGE',
    priority: o.recipientMuted ? 'LOW' : 'HIGH',
    sendEmail: offer && o.emailEnabled,
  };
}

/** Email is on unless the member turned it off — no row means the default (on). */
export function emailEnabledFrom(row: { email_enabled?: boolean | null; categories?: Record<string, unknown> | null } | null): boolean {
  if (!row) return true;
  if (row.email_enabled === false) return false;
  if (row.categories && row.categories.messages === false) return false;
  return true;
}

/** Plain-language refusal codes the client maps to i18n keys. */
export const SEND_ERRORS = {
  RATE_LIMITED: 'RATE_LIMITED',
  DUPLICATE_MESSAGE: 'DUPLICATE_MESSAGE',
  OFFER_CAP_REACHED: 'OFFER_CAP_REACHED',
  RECIPIENT_NOT_ACCEPTING_OFFERS: 'RECIPIENT_NOT_ACCEPTING_OFFERS',
} as const;

/* ── AI guards (pure) ──────────────────────────────────────────────────────── */

/** Every number written in a text, separators removed: "185,000" and "185 000" → "185000". */
export function numbersIn(text: string): string[] {
  return [...String(text ?? '').matchAll(/\d[\d\s.,'’]*\d|\d/g)]
    .map((m) => m[0].replace(/[\s.,'’]/g, ''))
    .filter(Boolean);
}

/**
 * Did a rewrite add a fact? "Improve" may change wording, never figures: any number,
 * percentage or currency sign that the original did not contain means the model
 * invented a price, a size, a date or a discount — and the rewrite is discarded.
 */
export function rewriteIntroducesFacts(original: string, rewritten: string): boolean {
  const had = new Set(numbersIn(original));
  if (numbersIn(rewritten).some((n) => !had.has(n))) return true;
  for (const sign of ['%', '$', '€', '₾', '£', '₺', '₽', '₪']) {
    if (rewritten.includes(sign) && !original.includes(sign)) return true;
  }
  return rewritten.length > original.length * 2 + 200;
}

export type AssistMode = 'introduction' | 'offer' | 'follow_up' | 'viewing' | 'improve' | 'translation_ready';
export const ASSIST_MODES: readonly AssistMode[] = ['introduction', 'offer', 'follow_up', 'viewing', 'improve', 'translation_ready'];

export const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  en: 'English', ka: 'Georgian', ru: 'Russian', tr: 'Turkish', ar: 'Arabic', he: 'Hebrew',
};

/** The strict instructions for the two model-backed assist modes. */
export function assistSystemPrompt(mode: 'improve' | 'translation_ready', langName: string): string {
  const shared = [
    'You edit a private message that a person wrote about real estate, before they send it.',
    'Rules you must never break:',
    '- Keep every fact exactly as written: names, places, numbers, prices, sizes, dates, conditions.',
    '- Never add facts, features, prices, discounts, deadlines, urgency, guarantees or promises.',
    '- Never remove a fact or a question the writer included.',
    '- Do not add greetings, signatures, emojis or marketing phrases that were not there.',
    `- Write in ${langName}, the language the message is written in.`,
    'Reply with JSON only: {"draft":"..."}',
  ];
  const task = mode === 'improve'
    ? 'Task: improve clarity, grammar and tone so it reads polite and professional. Change wording only.'
    : 'Task: rewrite it in short, clear, unambiguous sentences that will translate accurately. Change wording only.';
  return [task, ...shared].join('\n');
}

export function translateSystemPrompt(sourceName: string, targetName: string): string {
  return [
    `Translate the user's private real-estate message from ${sourceName} into ${targetName}.`,
    '- Preserve meaning, tone and politeness level.',
    '- Keep names, numbers, prices, currencies, addresses and property identifiers exactly.',
    '- Translate only. Do not add, remove, soften or explain anything.',
    'Reply with JSON only: {"translation":"..."}',
  ].join('\n');
}
