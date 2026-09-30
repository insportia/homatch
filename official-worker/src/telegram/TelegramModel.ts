// TelegramModel.ts — the worker's side of the Telegram contract.
//
// The edge functions speak to this worker in the vocabulary already declared
// in src/research-core/adapters/telegram/client.ts (TelegramChat,
// TelegramMessage, TelegramErrorKind). The worker image does not ship the
// research core, so the shapes are restated here and a contract test on the
// edge side (WorkerTelegramClient) keeps the two in step.
//
// Everything in this file is PURE: no GramJS import, no network, no env. It is
// what the unit tests drive, and it is where the two rules that matter most
// live — how a Telegram failure becomes a typed error, and what an error is
// allowed to say about itself.

export type TelegramErrorKind =
  | 'NOT_CONFIGURED'
  | 'DISABLED'
  | 'CAPABILITY_NOT_SUPPORTED'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'CHAT_NOT_FOUND'
  | 'CHAT_PRIVATE'
  | 'NETWORK_ERROR'
  | 'MALFORMED_RESPONSE';

export class WorkerTelegramError extends Error {
  readonly kind: TelegramErrorKind;
  readonly retryAfterSeconds: number | null;
  constructor(kind: TelegramErrorKind, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'WorkerTelegramError';
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** What the driver hands back for a chat — plain data, already off the wire. */
export interface RawChat {
  id: string;
  username: string | null;
  title: string | null;
  /** 'user' is returned by resolveUsername for people and bots; never read. */
  type: 'channel' | 'chat' | 'user';
  broadcast: boolean;
  megagroup: boolean;
  participantsCount: number | null;
  restricted: boolean;
}

export interface RawMessage {
  id: number;
  date: number;
  editDate: number | null;
  text: string;
  replyToMsgId: number | null;
  /** Signed by the channel rather than a person. */
  post: boolean;
  /** Public @username of the sender, when the sender has one. */
  fromUsername: string | null;
  views: number | null;
  service: boolean;
}

export interface TelegramChat {
  id: string;
  username: string | null;
  title: string | null;
  kind: 'CHANNEL' | 'GROUP' | 'SUPERGROUP' | 'UNKNOWN';
  participants: number | null;
  linkedChatId: string | null;
  publiclyReadable: boolean;
}

export interface TelegramMessage {
  id: string;
  chatId: string;
  date: number;
  editDate: number | null;
  text: string;
  replyToMessageId: string | null;
  discussionOriginChatId: string | null;
  discussionOriginMessageId: string | null;
  authorUsername: string | null;
  authorDisplayName: string | null;
  fromChannel: boolean;
  views: number | null;
}

/**
 * A public Telegram username, or null.
 *
 * Accepts `name`, `@name`, `t.me/name`, `https://t.me/s/name`. Anything else —
 * an invite link, a phone number, a numeric id — is refused here, because the
 * only chats this worker addresses are the ones a public username names. A
 * `+invite` link is exactly the private-group path we do not take.
 */
export function normalizeUsername(input: unknown): string | null {
  let s = String(input ?? '').trim();
  s = s.replace(/^https?:\/\//i, '').replace(/^(www\.)?(t|telegram)\.me\//i, '').replace(/^s\//i, '');
  s = s.replace(/^@/, '').split(/[/?#]/)[0] ?? '';
  return /^[A-Za-z][A-Za-z0-9_]{3,31}$/.test(s) ? s.toLowerCase() : null;
}

/**
 * The access boundary, stated once.
 *
 * Only a chat with a public username is readable by this integration. People
 * and bots are never read — this is a discovery source over public
 * communities, not an inbox. A chat Telegram marks restricted is refused
 * rather than read around.
 */
export function toPublicChat(raw: RawChat): TelegramChat {
  if (raw.type === 'user') {
    throw new WorkerTelegramError('CHAT_NOT_FOUND', 'the username belongs to a person or bot, not a public chat');
  }
  if (!raw.username) {
    throw new WorkerTelegramError('CHAT_PRIVATE', 'the chat has no public username');
  }
  if (raw.restricted) {
    throw new WorkerTelegramError('CHAT_PRIVATE', 'Telegram marks this chat as restricted');
  }
  return {
    id: raw.id,
    username: raw.username.toLowerCase(),
    title: raw.title,
    kind: raw.type === 'chat' ? 'GROUP' : raw.broadcast ? 'CHANNEL' : raw.megagroup ? 'SUPERGROUP' : 'UNKNOWN',
    participants: Number.isFinite(raw.participantsCount as number) ? raw.participantsCount : null,
    linkedChatId: null,
    publiclyReadable: true,
  };
}

/**
 * A message, or null for what carries no content (joins, pins, empty media).
 *
 * `date` is Telegram's own publication time and is passed through untouched:
 * it is THE freshness timestamp downstream, and nothing on this side may
 * substitute the time we happened to read it.
 */
export function toMessage(raw: RawMessage, chat: TelegramChat): TelegramMessage | null {
  if (raw.service) return null;
  const text = String(raw.text ?? '').trim();
  if (!text) return null;
  if (!Number.isFinite(raw.date) || raw.date <= 0) return null;
  return {
    id: String(raw.id),
    chatId: chat.id,
    date: raw.date,
    editDate: raw.editDate && raw.editDate > 0 ? raw.editDate : null,
    text: text.slice(0, 8000),
    replyToMessageId: raw.replyToMsgId ? String(raw.replyToMsgId) : null,
    discussionOriginChatId: null,
    discussionOriginMessageId: null,
    authorUsername: raw.post ? chat.username : raw.fromUsername ? raw.fromUsername.toLowerCase() : null,
    authorDisplayName: raw.post ? chat.title : null,
    fromChannel: raw.post,
    views: Number.isFinite(raw.views as number) ? raw.views : null,
  };
}

const AUTH_CODES = new Set([
  'AUTH_KEY_UNREGISTERED', 'AUTH_KEY_INVALID', 'AUTH_KEY_PERM_EMPTY', 'AUTH_KEY_DUPLICATED',
  'SESSION_REVOKED', 'SESSION_EXPIRED', 'SESSION_PASSWORD_NEEDED',
  'USER_DEACTIVATED', 'USER_DEACTIVATED_BAN', 'API_ID_INVALID', 'API_ID_PUBLISHED_FLOOD',
]);
const NOT_FOUND_CODES = new Set([
  'USERNAME_NOT_OCCUPIED', 'USERNAME_INVALID', 'CHANNEL_INVALID', 'PEER_ID_INVALID', 'MSG_ID_INVALID',
  'CHAT_ID_INVALID',
]);
const PRIVATE_CODES = new Set([
  'CHANNEL_PRIVATE', 'CHAT_ADMIN_REQUIRED', 'CHANNEL_PUBLIC_GROUP_NA', 'USER_BANNED_IN_CHANNEL',
  'CHAT_FORBIDDEN', 'CHAT_RESTRICTED',
]);

/**
 * Any thrown value → a typed error whose message is SAFE TO RETURN.
 *
 * The message is built from Telegram's error CODE only. GramJS error messages
 * carry a dump of the request that failed; that is never forwarded, because
 * this worker's responses end up in edge logs and database rows.
 */
export function classifyTelegramFailure(error: unknown): WorkerTelegramError {
  if (error instanceof WorkerTelegramError) return error;
  const e = (error ?? {}) as Record<string, unknown>;
  const code = String(e.errorMessage ?? '').toUpperCase();
  const name = String(e.name ?? e.constructor?.['name' as never] ?? '');
  const seconds = Number(e.seconds);

  if (/FLOOD|SLOWMODE/.test(code) || /Flood/i.test(name)) {
    const wait = Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null;
    return new WorkerTelegramError('RATE_LIMITED', code || 'FLOOD_WAIT', wait);
  }
  if (AUTH_CODES.has(code)) return new WorkerTelegramError('AUTH_FAILED', code);
  if (NOT_FOUND_CODES.has(code)) return new WorkerTelegramError('CHAT_NOT_FOUND', code);
  if (PRIVATE_CODES.has(code) || code.startsWith('INVITE_HASH')) return new WorkerTelegramError('CHAT_PRIVATE', code);
  if (code) return new WorkerTelegramError('NETWORK_ERROR', `TELEGRAM_${code}`.slice(0, 80));

  const sys = String(e.code ?? '');
  if (/^E[A-Z]+$/.test(sys)) return new WorkerTelegramError('NETWORK_ERROR', sys);
  const text = String((e as { message?: unknown }).message ?? '');
  if (/timeout|timed out/i.test(text)) return new WorkerTelegramError('NETWORK_ERROR', 'TIMEOUT');
  if (/not connected|disconnect|connection/i.test(text)) return new WorkerTelegramError('NETWORK_ERROR', 'CONNECTION_LOST');
  return new WorkerTelegramError('NETWORK_ERROR', 'UNCLASSIFIED_FAILURE');
}

/**
 * Last line of defence for anything that is about to leave the process.
 *
 * Removes the literal configured secrets wherever they appear, plus anything
 * shaped like a StringSession (a long base64url run), so that a future code
 * path that forgets the rule above still cannot print the session.
 */
export function redactTelegramSecrets(text: unknown, secrets: readonly (string | null | undefined)[]): string {
  let s = String(text ?? '');
  for (const secret of secrets) {
    if (secret && secret.length >= 6) s = s.split(secret).join('[REDACTED]');
  }
  return s.replace(/[A-Za-z0-9+/_=-]{120,}/g, '[REDACTED]').slice(0, 300);
}
