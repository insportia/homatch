// PROPERTY CONVERSATIONS — pure helpers shared by the page, the service and the edge.
//
// No imports beyond the template table: Deno and Vite both load this file.

import { CHAT_LANGS, type ChatLang } from './templates.ts';

export const DM_MEDIA_BUCKET = 'dm-media';
export const DM_MAX_MEDIA_BYTES = 8 * 1024 * 1024;
export const DM_VOICE_MAX_SECONDS = 60;
export const DM_MAX_BODY_CHARS = 4000;
export const DM_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export const DM_AUDIO_MIME = ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'] as const;

export type MessageKind = 'TEXT' | 'PHOTO' | 'VOICE' | 'PROPERTY';
/** The server's four states plus the client's own "still in flight". */
export type DeliveryState = 'SENDING' | 'SENT' | 'DELIVERED' | 'SEEN' | 'FAILED';

/** The i18n key for a delivery state — "Read" is what SEEN means to a person. */
export function deliveryLabelKey(state: DeliveryState | string): string {
  switch (state) {
    case 'SENDING': return 'pc_status_sending';
    case 'SENT': return 'pc_status_sent';
    case 'DELIVERED': return 'pc_status_delivered';
    case 'SEEN': return 'pc_status_read';
    case 'FAILED': return 'pc_status_failed';
    default: return 'pc_status_sent';
  }
}

/** The MIME type without codec parameters: "audio/webm;codecs=opus" → "audio/webm". */
export function baseMime(mime: string | null | undefined): string {
  return String(mime ?? '').split(';')[0].trim().toLowerCase();
}

export function mediaExtension(mime: string): string {
  switch (baseMime(mime)) {
    case 'image/jpeg': return 'jpg';
    case 'image/png': return 'png';
    case 'image/webp': return 'webp';
    case 'audio/webm': return 'webm';
    case 'audio/ogg': return 'ogg';
    case 'audio/mp4': return 'm4a';
    case 'audio/mpeg': return 'mp3';
    default: return 'bin';
  }
}

/** `{sender}/{conversation}/{uuid}.{ext}` — the one path shape the bucket and the CHECK accept. */
export function dmMediaPath(senderId: string, conversationId: string, uuid: string, mime: string): string {
  return `${senderId}/${conversationId}/${uuid}.${mediaExtension(mime)}`;
}

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PATH_RE = new RegExp(`^(${UUID})/(${UUID})/(${UUID})\\.(jpg|png|webp|webm|ogg|m4a|mp3)$`);

/** Is `path` an upload by `senderId` for `conversationId`, in the canonical shape? */
export function isOwnMediaPath(path: unknown, senderId: string, conversationId: string): boolean {
  if (typeof path !== 'string') return false;
  const m = PATH_RE.exec(path.toLowerCase());
  return !!m && m[1] === senderId.toLowerCase() && m[2] === conversationId.toLowerCase() && path === path.toLowerCase();
}

/** A fresh idempotency key for one send attempt; a retry reuses it. */
export function newClientMessageId(random: () => string = () => crypto.randomUUID()): string {
  return `c_${random()}`;
}

export function isValidClientMessageId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(value);
}

/** Minimal message shape the list helpers need. */
export interface ThreadMessage {
  id: string;
  sender_id: string;
  status: string;
  created_at: string;
  client_message_id?: string | null;
}

/**
 * Fold a server (or realtime) message into the thread: replace the optimistic copy
 * carrying the same client_message_id, update an existing row by id, or append.
 * Order stays by created_at; nothing is ever duplicated.
 */
export function mergeMessage<T extends ThreadMessage>(list: readonly T[], incoming: T): T[] {
  const byId = list.findIndex((m) => m.id === incoming.id);
  const byClient = incoming.client_message_id
    ? list.findIndex((m) => m.client_message_id === incoming.client_message_id && m.sender_id === incoming.sender_id)
    : -1;
  const at = byId >= 0 ? byId : byClient;
  const next = list.slice();
  if (at >= 0) {
    const prev = next[at];
    /* A late realtime INSERT must not roll a SEEN message back to SENT. */
    const keepStatus = statusRank(prev.status) > statusRank(incoming.status) && prev.id === incoming.id;
    next[at] = keepStatus ? { ...incoming, status: prev.status } : incoming;
    if (byId >= 0 && byClient >= 0 && byClient !== byId) next.splice(byClient, 1);
  } else {
    next.push(incoming);
  }
  return next.sort((a, b) => a.created_at.localeCompare(b.created_at));
}

function statusRank(s: string): number {
  return ['FAILED', 'SENDING', 'SENT', 'DELIVERED', 'SEEN'].indexOf(s);
}

/** Messages from the other person that this reader has not yet seen. */
export function unreadCount(list: readonly ThreadMessage[], myId: string): number {
  return list.filter((m) => m.sender_id !== myId && m.status !== 'SEEN').length;
}

/** Typing indicators expire: a dropped "stopped typing" must not leave one lit forever. */
export const TYPING_TTL_MS = 6000;
export function typingActive(lastTypingAt: number | null, now: number): boolean {
  return lastTypingAt !== null && now - lastTypingAt < TYPING_TTL_MS;
}

/** Throttle: broadcast "typing" at most once per interval while the person types. */
export function shouldBroadcastTyping(lastSentAt: number | null, now: number, intervalMs = 2500): boolean {
  return lastSentAt === null || now - lastSentAt >= intervalMs;
}

/** "0:42" — voice length and recorder clock. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/* ── language ─────────────────────────────────────────────────────────────── */

const TURKISH_MARKERS = /[ğışçöüĞİŞÇÖÜ]|\b(daire|kiralık|satılık|arıyorum|ev|oda|metrekare|fiyat|merhaba|lütfen)\b/i;

/**
 * Script-first language guess for a chat message (the same rule Find Buyers uses):
 * Georgian, Arabic, Hebrew and Cyrillic by script; Latin is Turkish when it carries
 * Turkish letters or words, else English. Null when there are no letters at all.
 */
export function detectChatLanguage(text: string | null | undefined): ChatLang | null {
  const s = String(text ?? '');
  const counts: Array<[string, number]> = [
    ['ka', (s.match(/[Ⴀ-ჿ]/g) ?? []).length],
    ['ar', (s.match(/[؀-ۿ]/g) ?? []).length],
    ['he', (s.match(/[֐-׿]/g) ?? []).length],
    ['ru', (s.match(/[Ѐ-ӿ]/g) ?? []).length],
    ['latin', (s.match(/[A-Za-zğışçöüĞİŞÇÖÜ]/g) ?? []).length],
  ];
  const best = counts.sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] === 0) return null;
  if (best[0] !== 'latin') return best[0] as ChatLang;
  return TURKISH_MARKERS.test(s) ? 'tr' : 'en';
}

export function isChatLanguage(value: unknown): value is ChatLang {
  return typeof value === 'string' && (CHAT_LANGS as readonly string[]).includes(value);
}
