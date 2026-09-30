// THE MTPROTO_USER CLIENT — Telegram read through HOMATCH's official worker.
//
// client.ts declared MTPROTO_USER and its capabilities; this is the
// implementation. It does not speak MTProto itself. The authorised session
// lives in exactly one process — homatch-official-worker on Railway — because
// one session used by many concurrent isolates is what Telegram answers with
// AUTH_KEY_DUPLICATED. So this client is a thin, typed HTTP port onto that
// worker's /telegram/* endpoints, authenticated with the same WORKER_TOKEN the
// Verify path already uses.
//
// Nothing secret passes through here. The worker holds api_id, api_hash and
// the session; this side holds a URL and a token, and the worker's answers
// contain Telegram error CODES and public chat data only.
//
// Runtime-neutral (fetch only), like everything in research-core: the edge
// functions and the tests both run it.

import {
  capabilitiesFor,
  TelegramError,
  type TelegramCapabilities,
  type TelegramChat,
  type TelegramClient,
  type TelegramErrorKind,
  type TelegramIntegrationMode,
  type TelegramMessage,
  type TelegramPage,
} from './client.ts';

export interface WorkerTelegramClientOptions {
  /** Base URL of the official worker, e.g. https://…railway.app */
  baseUrl: string;
  token: string;
  /** Correlates a worker log line with the edge run that caused it. */
  trace?: string | null;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** What the worker's /health/telegram reports. Facts only, never credentials. */
export interface WorkerTelegramStatus {
  configured: boolean;
  enabled: boolean;
  problems: string[];
  mode: 'MTPROTO_USER';
  connected: boolean;
  authorized: boolean | null;
  lastConnectedAt: string | null;
  lastSuccessAt: string | null;
  lastErrorKind: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  rateLimitedUntil: string | null;
  queueDepth: number;
  callsSinceStart: number;
}

const ERROR_KINDS: readonly TelegramErrorKind[] = [
  'NOT_CONFIGURED', 'DISABLED', 'CAPABILITY_NOT_SUPPORTED', 'AUTH_FAILED', 'RATE_LIMITED',
  'CHAT_NOT_FOUND', 'CHAT_PRIVATE', 'NETWORK_ERROR', 'MALFORMED_RESPONSE',
];

export class WorkerTelegramClient implements TelegramClient {
  readonly mode: TelegramIntegrationMode = 'MTPROTO_USER';
  readonly capabilities: TelegramCapabilities = capabilitiesFor('MTPROTO_USER');
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly trace: string | null;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: WorkerTelegramClientOptions) {
    this.baseUrl = String(options.baseUrl || '').replace(/\/+$/, '');
    this.token = String(options.token || '');
    this.trace = options.trace ?? null;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 40_000;
  }

  get configured(): boolean {
    return Boolean(this.baseUrl && this.token);
  }

  async status(probe = false): Promise<WorkerTelegramStatus> {
    const body = await this.call('GET', `/health/telegram${probe ? '?probe=1' : ''}`, null);
    return (body as { status: WorkerTelegramStatus }).status;
  }

  async healthCheck() {
    try {
      const status = await this.status(true);
      if (status.authorized && !status.lastErrorKind) return { ok: true as const, account: null };
      const kind = !status.configured ? 'NOT_CONFIGURED'
        : !status.enabled ? 'DISABLED'
        : status.rateLimitedUntil ? 'RATE_LIMITED'
        : status.authorized === false ? 'AUTH_FAILED'
        : 'NETWORK_ERROR';
      return { ok: false as const, error: new TelegramError(kind, status.lastErrorCode ?? kind) };
    } catch (error) {
      return { ok: false as const, error: toTelegramError(error) };
    }
  }

  async resolveChat(username: string): Promise<TelegramChat> {
    return asChat(await this.op('/telegram/resolve', { username }));
  }

  async searchPublicChats(query: string, limit: number): Promise<TelegramChat[]> {
    const result = await this.op('/telegram/search', { query, limit });
    if (!Array.isArray(result)) throw new TelegramError('MALFORMED_RESPONSE', 'search did not return a list');
    return result.map(asChat);
  }

  async readHistory(chatId: string, options: { cursor: string | null; limit: number }): Promise<TelegramPage<TelegramMessage>> {
    return asPage(await this.op('/telegram/history', { username: chatId, cursor: options.cursor, limit: options.limit }));
  }

  async readDiscussionReplies(
    chatId: string,
    messageId: string,
    options: { cursor: string | null; limit: number },
  ): Promise<TelegramPage<TelegramMessage>> {
    return asPage(await this.op('/telegram/replies', {
      username: chatId, messageId, cursor: options.cursor, limit: options.limit,
    }));
  }

  private async op(path: string, payload: Record<string, unknown>): Promise<unknown> {
    const body = await this.call('POST', path, payload) as { ok?: boolean; result?: unknown; error?: Record<string, unknown> };
    if (body.ok === true) return body.result;
    const error = body.error ?? {};
    const kind = ERROR_KINDS.includes(error.kind as TelegramErrorKind) ? error.kind as TelegramErrorKind : 'MALFORMED_RESPONSE';
    const retry = Number(error.retryAfterSeconds);
    throw new TelegramError(kind, String(error.message ?? kind).slice(0, 200), Number.isFinite(retry) && retry > 0 ? retry : null);
  }

  private async call(method: 'GET' | 'POST', path: string, payload: unknown): Promise<unknown> {
    if (!this.configured) throw new TelegramError('NOT_CONFIGURED', 'WORKER_URL or WORKER_TOKEN is not configured');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          ...(this.trace ? { 'x-homatch-trace': this.trace } : {}),
        },
        body: method === 'POST' ? JSON.stringify(payload ?? {}) : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      throw new TelegramError('NETWORK_ERROR', controller.signal.aborted ? 'WORKER_TIMEOUT' : 'WORKER_UNREACHABLE');
    } finally {
      clearTimeout(timer);
    }
    if (response.status === 401) throw new TelegramError('AUTH_FAILED', 'WORKER_TOKEN_REJECTED');
    if (response.status === 404) throw new TelegramError('CAPABILITY_NOT_SUPPORTED', 'WORKER_HAS_NO_TELEGRAM_ROUTES');
    if (!response.ok) throw new TelegramError('NETWORK_ERROR', `WORKER_HTTP_${response.status}`);
    try {
      return await response.json();
    } catch {
      throw new TelegramError('MALFORMED_RESPONSE', 'worker answered with non-JSON');
    }
  }
}

function toTelegramError(error: unknown): TelegramError {
  return error instanceof TelegramError ? error : new TelegramError('NETWORK_ERROR', 'WORKER_CALL_FAILED');
}

function asChat(value: unknown): TelegramChat {
  const v = (value ?? {}) as Record<string, unknown>;
  if (typeof v.id !== 'string' || !v.id) throw new TelegramError('MALFORMED_RESPONSE', 'chat without id');
  const kind = ['CHANNEL', 'GROUP', 'SUPERGROUP'].includes(String(v.kind)) ? v.kind as TelegramChat['kind'] : 'UNKNOWN';
  return {
    id: v.id,
    username: typeof v.username === 'string' ? v.username : null,
    title: typeof v.title === 'string' ? v.title : null,
    kind,
    participants: Number.isFinite(v.participants as number) ? v.participants as number : null,
    linkedChatId: typeof v.linkedChatId === 'string' ? v.linkedChatId : null,
    publiclyReadable: v.publiclyReadable === true,
  };
}

function asMessage(value: unknown): TelegramMessage {
  const v = (value ?? {}) as Record<string, unknown>;
  const date = Number(v.date);
  if (typeof v.id !== 'string' || !Number.isFinite(date) || date <= 0) {
    throw new TelegramError('MALFORMED_RESPONSE', 'message without id or publication date');
  }
  const str = (x: unknown) => (typeof x === 'string' && x ? x : null);
  const edit = Number(v.editDate);
  return {
    id: v.id,
    chatId: String(v.chatId ?? ''),
    date,
    editDate: Number.isFinite(edit) && edit > 0 ? edit : null,
    text: String(v.text ?? ''),
    replyToMessageId: str(v.replyToMessageId),
    discussionOriginChatId: str(v.discussionOriginChatId),
    discussionOriginMessageId: str(v.discussionOriginMessageId),
    authorUsername: str(v.authorUsername),
    authorDisplayName: str(v.authorDisplayName),
    fromChannel: v.fromChannel === true,
    views: Number.isFinite(v.views as number) ? v.views as number : null,
  };
}

function asPage(value: unknown): TelegramPage<TelegramMessage> {
  const v = (value ?? {}) as Record<string, unknown>;
  if (!Array.isArray(v.items)) throw new TelegramError('MALFORMED_RESPONSE', 'history without items');
  return {
    items: v.items.map(asMessage),
    nextCursor: typeof v.nextCursor === 'string' ? v.nextCursor : null,
    hasMore: v.hasMore === true,
  };
}
