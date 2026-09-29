// TelegramGateway.ts — ONE authorised MTProto session, used one call at a time.
//
// WHY THIS LIVES IN THE OFFICIAL WORKER
//
// An MTProto user session is a single authorisation key. Two processes using
// it at once is what Telegram reports as AUTH_KEY_DUPLICATED, and it can end
// with the session revoked. Edge functions are many short-lived isolates;
// this worker is one long-lived process with one replica. So the session lives
// here, behind a queue, and every Telegram call in HOMATCH passes through it.
//
// THE RULES THIS CLASS ENFORCES
//
//   · Serial. One request in flight at a time, a minimum gap between calls.
//   · FLOOD_WAIT is obeyed exactly and SHARED: once Telegram says wait N
//     seconds, every call is refused until then, with the remaining time.
//     Nothing sleeps inside a request — the caller reschedules.
//   · An authorisation failure is sticky. Retrying a revoked session is how a
//     bad credential becomes a banned account, so after AUTH_FAILED nothing is
//     attempted until the process restarts with new configuration.
//   · Lazy connection, idle disconnect. The session is only open while there
//     is work, which keeps the overlap of an old and a new container during a
//     deploy as small as it can be.
//   · Backpressure. A bounded queue; beyond it the answer is RATE_LIMITED.
//   · Nothing secret leaves. status() reports facts about the session, never
//     the session.

import {
  classifyTelegramFailure,
  normalizeUsername,
  toMessage,
  toPublicChat,
  WorkerTelegramError,
  type RawChat,
  type RawMessage,
  type TelegramChat,
  type TelegramMessage,
} from './TelegramModel.js';

export interface TelegramEnv {
  apiId: number | null;
  apiHash: string | null;
  session: string | null;
  enabled: boolean;
}

export function telegramEnvFromProcess(env: Record<string, string | undefined> = process.env): TelegramEnv {
  const apiId = Number(String(env.TELEGRAM_API_ID ?? '').trim());
  return {
    apiId: Number.isInteger(apiId) && apiId > 0 ? apiId : null,
    apiHash: String(env.TELEGRAM_API_HASH ?? '').trim() || null,
    session: String(env.TELEGRAM_SESSION ?? '').trim() || null,
    enabled: /^(1|true|yes|on)$/i.test(String(env.TELEGRAM_ENABLED ?? '').trim()),
  };
}

export type TelegramConfigProblem = 'API_ID_MISSING' | 'API_HASH_MISSING' | 'SESSION_MISSING';

export function configProblems(env: TelegramEnv): TelegramConfigProblem[] {
  const out: TelegramConfigProblem[] = [];
  if (!env.apiId) out.push('API_ID_MISSING');
  if (!env.apiHash) out.push('API_HASH_MISSING');
  if (!env.session) out.push('SESSION_MISSING');
  return out;
}

/** The only thing that touches the network. GramJsDriver in production. */
export interface TelegramDriver {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Proves the session is authorised. Returns nothing identifying. */
  checkAuthorized(): Promise<boolean>;
  resolveUsername(username: string): Promise<{ chat: RawChat; handle: unknown }>;
  getHistory(handle: unknown, options: { offsetId: number; limit: number }): Promise<RawMessage[]>;
  getReplies(handle: unknown, messageId: number, options: { offsetId: number; limit: number }): Promise<RawMessage[]>;
  searchChats(query: string, limit: number): Promise<RawChat[]>;
}

export interface GatewayOptions {
  env: TelegramEnv;
  driverFactory: (env: TelegramEnv) => TelegramDriver;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Minimum spacing between two Telegram calls. */
  minGapMs?: number;
  /** Close the session after this long without work. */
  idleDisconnectMs?: number;
  maxQueue?: number;
  /** How long a resolved username is trusted before it is resolved again. */
  resolveTtlMs?: number;
}

export interface TelegramStatus {
  configured: boolean;
  enabled: boolean;
  problems: TelegramConfigProblem[];
  mode: 'MTPROTO_USER';
  connected: boolean;
  /** null until a health check or a call has proven it either way. */
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

export interface HistoryPage {
  chat: TelegramChat;
  items: TelegramMessage[];
  nextCursor: string | null;
  hasMore: boolean;
}

const iso = (ms: number | null) => (ms ? new Date(ms).toISOString() : null);

export class TelegramGateway {
  private readonly env: TelegramEnv;
  private readonly factory: (env: TelegramEnv) => TelegramDriver;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly minGapMs: number;
  private readonly idleMs: number;
  private readonly maxQueue: number;
  private readonly resolveTtlMs: number;

  private driver: TelegramDriver | null = null;
  private connected = false;
  private chain: Promise<unknown> = Promise.resolve();
  private depth = 0;
  private lastCallAt = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly resolved = new Map<string, { chat: TelegramChat; handle: unknown; at: number }>();
  private readonly resolving = new Map<string, Promise<{ chat: TelegramChat; handle: unknown; at: number }>>();

  private authorized: boolean | null = null;
  private authFailedCode: string | null = null;
  private floodUntil = 0;
  private lastConnectedAt: number | null = null;
  private lastSuccessAt: number | null = null;
  private lastErrorKind: string | null = null;
  private lastErrorCode: string | null = null;
  private lastErrorAt: number | null = null;
  private calls = 0;

  constructor(options: GatewayOptions) {
    this.env = options.env;
    this.factory = options.driverFactory;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.minGapMs = options.minGapMs ?? 1500;
    this.idleMs = options.idleDisconnectMs ?? 5 * 60_000;
    this.maxQueue = options.maxQueue ?? 16;
    this.resolveTtlMs = options.resolveTtlMs ?? 6 * 3_600_000;
  }

  status(): TelegramStatus {
    const problems = configProblems(this.env);
    return {
      configured: problems.length === 0,
      enabled: this.env.enabled,
      problems,
      mode: 'MTPROTO_USER',
      connected: this.connected,
      authorized: this.authFailedCode ? false : this.authorized,
      lastConnectedAt: iso(this.lastConnectedAt),
      lastSuccessAt: iso(this.lastSuccessAt),
      lastErrorKind: this.lastErrorKind,
      lastErrorCode: this.lastErrorCode,
      lastErrorAt: iso(this.lastErrorAt),
      rateLimitedUntil: this.floodUntil > this.now() ? iso(this.floodUntil) : null,
      queueDepth: this.depth,
      callsSinceStart: this.calls,
    };
  }

  /** Connects if needed and proves authorisation. Never logs in. */
  async health(): Promise<TelegramStatus> {
    try {
      await this.run(async (driver) => {
        const ok = await driver.checkAuthorized();
        if (!ok) throw new WorkerTelegramError('AUTH_FAILED', 'SESSION_NOT_AUTHORIZED');
        this.authorized = true;
      });
    } catch {
      /* recorded by run(); status carries it */
    }
    return this.status();
  }

  async resolve(usernameInput: unknown): Promise<TelegramChat> {
    const username = normalizeUsername(usernameInput);
    if (!username) throw new WorkerTelegramError('CHAT_NOT_FOUND', 'not a public Telegram username');
    return (await this.resolveEntry(username)).chat;
  }

  async history(usernameInput: unknown, options: { cursor?: unknown; limit?: unknown }): Promise<HistoryPage> {
    const username = normalizeUsername(usernameInput);
    if (!username) throw new WorkerTelegramError('CHAT_NOT_FOUND', 'not a public Telegram username');
    const limit = clampInt(options.limit, 1, 100, 50);
    const offsetId = clampInt(options.cursor, 0, Number.MAX_SAFE_INTEGER, 0);
    const entry = await this.resolveEntry(username);
    const raw = await this.run((driver) => driver.getHistory(entry.handle, { offsetId, limit }));
    return this.page(entry.chat, raw, limit);
  }

  async replies(usernameInput: unknown, messageId: unknown, options: { cursor?: unknown; limit?: unknown }): Promise<HistoryPage> {
    const username = normalizeUsername(usernameInput);
    if (!username) throw new WorkerTelegramError('CHAT_NOT_FOUND', 'not a public Telegram username');
    const msgId = clampInt(messageId, 1, Number.MAX_SAFE_INTEGER, 0);
    if (!msgId) throw new WorkerTelegramError('CHAT_NOT_FOUND', 'MSG_ID_INVALID');
    const limit = clampInt(options.limit, 1, 100, 50);
    const offsetId = clampInt(options.cursor, 0, Number.MAX_SAFE_INTEGER, 0);
    const entry = await this.resolveEntry(username);
    const raw = await this.run((driver) => driver.getReplies(entry.handle, msgId, { offsetId, limit }));
    return this.page(entry.chat, raw, limit);
  }

  async search(queryInput: unknown, limitInput: unknown): Promise<TelegramChat[]> {
    const query = String(queryInput ?? '').trim().slice(0, 64);
    if (query.length < 2) return [];
    const limit = clampInt(limitInput, 1, 20, 10);
    const raw = await this.run((driver) => driver.searchChats(query, limit));
    const out: TelegramChat[] = [];
    for (const chat of raw) {
      try {
        out.push(toPublicChat(chat));
      } catch {
        /* private, restricted or a person: never offered as a source */
      }
    }
    return out;
  }

  async shutdown(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
    const driver = this.driver;
    this.driver = null;
    this.connected = false;
    if (driver) await driver.disconnect().catch(() => undefined);
  }

  private page(chat: TelegramChat, raw: RawMessage[], limit: number): HistoryPage {
    const items: TelegramMessage[] = [];
    let lowest: number | null = null;
    for (const message of raw) {
      if (Number.isFinite(message.id) && (lowest === null || message.id < lowest)) lowest = message.id;
      const mapped = toMessage(message, chat);
      if (mapped) items.push(mapped);
    }
    items.sort((a, b) => Number(b.id) - Number(a.id));
    const hasMore = raw.length >= limit && lowest !== null && lowest > 1;
    return { chat, items, nextCursor: hasMore ? String(lowest) : null, hasMore };
  }

  private resolveEntry(username: string): Promise<{ chat: TelegramChat; handle: unknown; at: number }> {
    const cached = this.resolved.get(username);
    if (cached && this.now() - cached.at < this.resolveTtlMs) return Promise.resolve(cached);
    /*
     * ResolveUsername is the most tightly limited call Telegram has. Callers
     * arriving together share ONE in-flight resolution rather than each
     * spending a request on the same name.
     */
    const pending = this.resolving.get(username);
    if (pending) return pending;
    const task = this.run((driver) => driver.resolveUsername(username)).then(({ chat: raw, handle }) => {
      const entry = { chat: toPublicChat(raw), handle, at: this.now() };
      this.resolved.set(username, entry);
      return entry;
    }).finally(() => this.resolving.delete(username));
    this.resolving.set(username, task);
    return task;
  }

  /** The queue. Every Telegram call goes through here and nowhere else. */
  private run<T>(work: (driver: TelegramDriver) => Promise<T>): Promise<T> {
    const gate = this.gate();
    if (gate) return Promise.reject(gate);
    if (this.depth >= this.maxQueue) {
      return Promise.reject(new WorkerTelegramError('RATE_LIMITED', 'WORKER_QUEUE_FULL', 5));
    }
    this.depth += 1;
    const task = this.chain.then(async () => {
      const blocked = this.gate();
      if (blocked) throw blocked;
      const wait = this.lastCallAt + this.minGapMs - this.now();
      if (wait > 0) await this.sleep(wait);
      const driver = await this.ensureConnected();
      this.lastCallAt = this.now();
      this.calls += 1;
      try {
        const result = await work(driver);
        this.lastSuccessAt = this.now();
        this.authorized = this.authorized ?? true;
        return result;
      } catch (error) {
        throw this.record(error);
      }
    });
    this.chain = task.catch(() => undefined).finally(() => {
      this.depth -= 1;
      this.armIdle();
    });
    return task;
  }

  private gate(): WorkerTelegramError | null {
    const problems = configProblems(this.env);
    if (problems.length) return new WorkerTelegramError('NOT_CONFIGURED', problems.join(','));
    if (!this.env.enabled) return new WorkerTelegramError('DISABLED', 'TELEGRAM_ENABLED is off');
    if (this.authFailedCode) return new WorkerTelegramError('AUTH_FAILED', this.authFailedCode);
    const remaining = Math.ceil((this.floodUntil - this.now()) / 1000);
    if (remaining > 0) return new WorkerTelegramError('RATE_LIMITED', 'FLOOD_WAIT_ACTIVE', remaining);
    return null;
  }

  private async ensureConnected(): Promise<TelegramDriver> {
    if (this.driver && this.connected) return this.driver;
    try {
      this.driver = this.driver ?? this.factory(this.env);
      await this.driver.connect();
      this.connected = true;
      this.lastConnectedAt = this.now();
      return this.driver;
    } catch (error) {
      this.connected = false;
      throw this.record(error);
    }
  }

  private record(error: unknown): WorkerTelegramError {
    const typed = classifyTelegramFailure(error);
    this.lastErrorKind = typed.kind;
    this.lastErrorCode = typed.message;
    this.lastErrorAt = this.now();
    if (typed.kind === 'RATE_LIMITED' && typed.retryAfterSeconds) {
      this.floodUntil = Math.max(this.floodUntil, this.now() + typed.retryAfterSeconds * 1000);
    }
    if (typed.kind === 'AUTH_FAILED') {
      this.authFailedCode = typed.message;
      this.authorized = false;
      void this.shutdown();
    }
    if (typed.kind === 'NETWORK_ERROR') {
      /* Reconnect on the next call rather than trusting a half-open socket. */
      this.connected = false;
    }
    return typed;
  }

  private armIdle() {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.depth > 0 || !this.connected) return;
    this.idleTimer = setTimeout(() => {
      if (this.depth === 0) void this.shutdown();
    }, this.idleMs);
    (this.idleTimer as { unref?: () => void }).unref?.();
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
