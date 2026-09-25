// HOMATCH RESEARCH CORE — the Telegram provider boundary.
//
// WHAT IS TRUE TODAY
//
// Homatch has no Telegram credentials. Nothing here can reach Telegram, and
// nothing here pretends to. What this file does is make the remaining work
// CONFIGURATION rather than product development: when a real api_id, bot
// token or session arrives, a client implementing this interface is wired in
// and the adapter, the normalizer, the registry integration, the dedup, the
// freshness hooks and the tests above them are already built and already
// tested against fixtures.
//
// So the honest production state is not BLOCKED and not NOT_IMPLEMENTED. It
// is IMPLEMENTED + CONFIGURATION_READY + CREDENTIALS_MISSING, and
// readiness() below is what produces exactly that, field by field, so the
// admin area can show the five separate facts instead of one green dot.
//
// THREE INTEGRATION MODES, AND WHAT EACH ONE CAN ACTUALLY DO
//
// This is the part that must not be wishful, because a capability claimed
// here becomes a feature promised in the admin area and a job that fails in
// production. Telegram offers genuinely different things depending on how you
// connect, and the differences are not small:
//
//   BOT_API          A bot token. A bot reads messages only in chats it has
//                    been ADDED to, and in a channel only as an administrator.
//                    There is NO global search and NO arbitrary history: a bot
//                    is told about new messages, it cannot go and look for old
//                    ones. Good for monitoring channels an operator has
//                    deliberately connected; useless for finding them.
//
//   MTPROTO_USER     An api_id/api_hash and an authorised user session. This
//                    is the mode discovery actually needs: resolve a public
//                    @username, search public chats, page back through a
//                    public channel's history, and read the discussion-group
//                    replies that sit under a channel post. It is also the
//                    mode with the heaviest obligations, which is why the
//                    limits below are not optional extras.
//
//   PUBLIC_PREVIEW   No credentials at all. t.me/s/<username> serves a public
//                    channel's recent posts as an ordinary web page. Recent
//                    posts ONLY, no comments, no search, no deep history. It
//                    is a real capability and a narrow one, and it is the only
//                    mode that works today.
//
// The capability matrix is the mechanism that keeps this honest: the adapter
// asks what the configured mode supports and refuses what it does not, with a
// reason. It never tries an operation hoping it works, and it never reports
// "this channel had no posts" when what happened is "this mode cannot read
// history".
//
// WHAT IS DELIBERATELY ABSENT, AND STAYS ABSENT
//
// No phone-number scraping, no member-list harvesting, no joining private
// groups, no account rotation, no reading anything a logged-out person could
// not see in a mode that claims to be public. A private group is recorded as
// JOIN_REQUIRED and queued for a human, exactly as on every other platform.

import type { ResearchLanguage } from '../../discovery/lexicon.ts';

/* ────────────────────────────────────────────────────────────────────────
 * Configuration
 * ──────────────────────────────────────────────────────────────────────── */

export type TelegramIntegrationMode = 'BOT_API' | 'MTPROTO_USER' | 'PUBLIC_PREVIEW';

export const TELEGRAM_INTEGRATION_MODES: readonly TelegramIntegrationMode[] = [
  'BOT_API',
  'MTPROTO_USER',
  'PUBLIC_PREVIEW',
];

/**
 * What each mode can do. Declared once, here, and consulted everywhere.
 *
 * Read this as a description of Telegram, not of Homatch: these are the
 * limits of the platform's own interfaces. Anything the adapter wants that is
 * false in this table is refused with CAPABILITY_NOT_SUPPORTED rather than
 * attempted.
 */
export interface TelegramCapabilities {
  /** Turn a public @username into a chat we can address. */
  resolveUsername: boolean;
  /** Find public chats we did not already know about, by keyword. */
  searchPublicChats: boolean;
  /** Page backwards through a chat's existing messages. */
  readHistory: boolean;
  /** Be told about new messages as they arrive, without asking. */
  receiveUpdates: boolean;
  /**
   * Read the replies under a channel post.
   *
   * On Telegram these live in a linked DISCUSSION GROUP, not on the post, and
   * they are frequently where the buying intent is: the post is a listing and
   * the reply is "is this still available, and does it have parking?".
   */
  readDiscussionReplies: boolean;
  /** Learn that a message was edited after we stored it. */
  observeEdits: boolean;
  /** Learn that a message was deleted after we stored it. */
  observeDeletions: boolean;
}

const CAPABILITIES: Record<TelegramIntegrationMode, TelegramCapabilities> = {
  BOT_API: {
    // A bot can resolve a chat it is already in, and only that.
    resolveUsername: false,
    searchPublicChats: false,
    // The Bot API has no history call. This is the single most consequential
    // limitation of the mode and the reason it cannot carry discovery alone.
    readHistory: false,
    receiveUpdates: true,
    // Only where the bot is also a member of the linked discussion group.
    readDiscussionReplies: true,
    observeEdits: true,
    observeDeletions: true,
  },
  MTPROTO_USER: {
    resolveUsername: true,
    searchPublicChats: true,
    readHistory: true,
    receiveUpdates: true,
    readDiscussionReplies: true,
    observeEdits: true,
    observeDeletions: true,
  },
  PUBLIC_PREVIEW: {
    // The preview page exists at a predictable URL, so a username resolves in
    // the weak sense of "we can construct the address and see if it answers".
    resolveUsername: true,
    searchPublicChats: false,
    // Recent posts only. The preview pages back a limited distance and then
    // stop; `truncated` on the scan result is how that is reported.
    readHistory: true,
    receiveUpdates: false,
    readDiscussionReplies: false,
    observeEdits: false,
    observeDeletions: false,
  },
};

export function capabilitiesFor(mode: TelegramIntegrationMode): TelegramCapabilities {
  return { ...CAPABILITIES[mode] };
}

/**
 * The configuration, as it would arrive from the environment.
 *
 * Values are NEVER logged, never returned by readiness(), and never stored in
 * the registry. Only their presence is ever reported.
 */
export interface TelegramConfig {
  mode: TelegramIntegrationMode;
  /** BOT_API. */
  botToken?: string | null;
  /** MTPROTO_USER. */
  apiId?: string | number | null;
  apiHash?: string | null;
  /** MTPROTO_USER: an already-authorised session, created out of band. */
  sessionString?: string | null;
  /** Operator kill switch. Independent of whether credentials exist. */
  enabled?: boolean;
  /** Languages this connection is expected to encounter. Informational. */
  languages?: readonly ResearchLanguage[];
}

export type TelegramConfigProblem =
  | 'MODE_MISSING'
  | 'MODE_UNKNOWN'
  | 'BOT_TOKEN_MISSING'
  | 'BOT_TOKEN_MALFORMED'
  | 'API_ID_MISSING'
  | 'API_HASH_MISSING'
  | 'SESSION_MISSING';

/**
 * Is this configuration internally coherent?
 *
 * Shape only. It cannot tell whether a token is valid — that needs Telegram,
 * and Telegram is exactly what is unavailable — so it answers the question it
 * can answer honestly and leaves the other one to the health check. A
 * malformed bot token is worth catching here because it is a typo, and a typo
 * discovered at the first discovery run is a typo discovered in production.
 */
export function validateTelegramConfig(config: Partial<TelegramConfig> | null | undefined): {
  valid: boolean;
  problems: TelegramConfigProblem[];
} {
  const problems: TelegramConfigProblem[] = [];
  if (!config || !config.mode) return { valid: false, problems: ['MODE_MISSING'] };
  if (!TELEGRAM_INTEGRATION_MODES.includes(config.mode)) {
    return { valid: false, problems: ['MODE_UNKNOWN'] };
  }

  if (config.mode === 'BOT_API') {
    const token = String(config.botToken ?? '').trim();
    if (!token) problems.push('BOT_TOKEN_MISSING');
    // <numeric id>:<35-char secret>. Checked as a shape, never sent anywhere.
    else if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) problems.push('BOT_TOKEN_MALFORMED');
  }

  if (config.mode === 'MTPROTO_USER') {
    if (!String(config.apiId ?? '').trim()) problems.push('API_ID_MISSING');
    if (!String(config.apiHash ?? '').trim()) problems.push('API_HASH_MISSING');
    /*
     * A session, not a phone number and not a login code. Homatch never
     * performs an interactive Telegram login: the session is created out of
     * band by a person and supplied through secret management, so no
     * credential prompt ever lives in this codebase.
     */
    if (!String(config.sessionString ?? '').trim()) problems.push('SESSION_MISSING');
  }

  return { valid: problems.length === 0, problems };
}

/* ────────────────────────────────────────────────────────────────────────
 * Readiness — five separate facts, never one green dot
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Whether the integration has ever been proven against the real Telegram.
 *
 * FIXTURE_TESTED is a statement about this repository. LIVE_TESTED is a
 * statement about the world, and only a run against real credentials may set
 * it. Passing fixtures must never colour a provider green: that is the
 * difference between "our code works" and "the integration works", and
 * conflating them is how a dashboard lies.
 */
export type TelegramVerification = 'UNVERIFIED' | 'FIXTURE_TESTED' | 'LIVE_TESTED';

export interface TelegramReadiness {
  /** The adapter, normalizer and pipeline exist. True in this repository. */
  implemented: boolean;
  /** A coherent configuration is present. */
  configured: boolean;
  /** Credentials for the configured mode are present. */
  credentialsPresent: boolean;
  /** The operator switch. Off by default; never implied by credentials. */
  enabled: boolean;
  /** A successful call has been made recently. Only a health check sets this. */
  healthy: boolean;
  verification: TelegramVerification;

  mode: TelegramIntegrationMode | null;
  capabilities: TelegramCapabilities | null;
  problems: TelegramConfigProblem[];
  /**
   * The single state to show when there is only room for one, derived from
   * the fields above rather than stored beside them — so it can never
   * disagree with them.
   */
  summary: TelegramReadinessSummary;
}

export type TelegramReadinessSummary =
  | 'CREDENTIALS_MISSING'
  | 'CONFIGURATION_INVALID'
  | 'LIVE_CONNECTION_DISABLED'
  | 'CONFIGURED_NOT_VERIFIED'
  | 'HEALTHY'
  | 'DEGRADED';

export interface ReadinessInput {
  config: Partial<TelegramConfig> | null | undefined;
  /** From the provider health check. Null when it has never run. */
  lastHealthyAt?: string | null;
  lastFailureReason?: string | null;
  verification?: TelegramVerification;
  now?: number;
}

/** A health result older than this is not evidence that it is healthy now. */
const HEALTH_TTL_MS = 6 * 3_600_000;

export function readiness(input: ReadinessInput): TelegramReadiness {
  const { valid, problems } = validateTelegramConfig(input.config);
  const mode = input.config?.mode && TELEGRAM_INTEGRATION_MODES.includes(input.config.mode)
    ? input.config.mode
    : null;

  /*
   * PUBLIC_PREVIEW needs no credentials, which is a real distinction and not
   * a loophole: reading a public channel's public preview page is the same
   * act as opening it in a browser. Credentials being "present" for that mode
   * means there is nothing to be missing.
   */
  const credentialsPresent = mode === 'PUBLIC_PREVIEW' ? true : valid;
  const enabled = input.config?.enabled === true;

  const healthyAt = input.lastHealthyAt ? Date.parse(input.lastHealthyAt) : Number.NaN;
  const healthy = Number.isFinite(healthyAt)
    && (input.now ?? Date.now()) - healthyAt < HEALTH_TTL_MS
    && !input.lastFailureReason;

  const verification = input.verification ?? 'UNVERIFIED';

  return {
    // The code exists. That is a fact about this repository, and it is the
    // one thing that is unambiguously true today.
    implemented: true,
    configured: valid,
    credentialsPresent,
    enabled,
    healthy,
    verification,
    mode,
    capabilities: mode ? capabilitiesFor(mode) : null,
    problems,
    summary: summarise({ valid, credentialsPresent, enabled, healthy, failure: input.lastFailureReason ?? null }),
  };
}

function summarise(state: {
  valid: boolean;
  credentialsPresent: boolean;
  enabled: boolean;
  healthy: boolean;
  failure: string | null;
}): TelegramReadinessSummary {
  /*
   * Order matters, and it is ordered by what the operator would have to do
   * next. Missing credentials outranks a disabled switch because enabling a
   * provider with no credentials achieves nothing.
   */
  if (!state.credentialsPresent) return 'CREDENTIALS_MISSING';
  if (!state.valid) return 'CONFIGURATION_INVALID';
  if (!state.enabled) return 'LIVE_CONNECTION_DISABLED';
  if (state.failure) return 'DEGRADED';
  if (!state.healthy) return 'CONFIGURED_NOT_VERIFIED';
  return 'HEALTHY';
}

/* ────────────────────────────────────────────────────────────────────────
 * The client port
 * ──────────────────────────────────────────────────────────────────────── */

/** A Telegram chat as this layer understands it. Public attributes only. */
export interface TelegramChat {
  /** Telegram's own numeric id, as a string. Stable identity. */
  id: string;
  /** The public @username, without the @. Null for chats that have none. */
  username: string | null;
  title: string | null;
  kind: 'CHANNEL' | 'GROUP' | 'SUPERGROUP' | 'UNKNOWN';
  /** Member count where the platform publishes it. Never estimated. */
  participants: number | null;
  /**
   * The discussion group linked to a channel, where its comments live.
   * Null when the channel has none, which is common and is not a failure.
   */
  linkedChatId: string | null;
  /** True when a logged-out person can read it. */
  publiclyReadable: boolean;
}

/** One message or comment, as Telegram returns it, before normalization. */
export interface TelegramMessage {
  /** Per-chat message id. Unique only WITH the chat id. */
  id: string;
  chatId: string;
  /** Unix seconds, as Telegram sends it. */
  date: number;
  /** Unix seconds of the last edit, when the mode can observe edits. */
  editDate: number | null;
  text: string;
  /**
   * The message this one replies to, within the same chat.
   *
   * Comments under a channel post arrive as replies inside the linked
   * discussion group, so this is how a comment finds its parent.
   */
  replyToMessageId: string | null;
  /** For a comment: the channel post it discusses, when Telegram links them. */
  discussionOriginChatId: string | null;
  discussionOriginMessageId: string | null;
  /** The public author handle, when the chat shows one. Never resolved. */
  authorUsername: string | null;
  authorDisplayName: string | null;
  /** True for channel posts signed by the channel rather than a person. */
  fromChannel: boolean;
  /** Telegram's own view count, where published. */
  views: number | null;
}

export interface TelegramPage<T> {
  items: T[];
  /**
   * Opaque, and opaque on purpose: for MTPROTO it is a message offset, for
   * the preview pages it is the "before" token in the URL. Nothing outside
   * the client interprets it.
   */
  nextCursor: string | null;
  /** True when the source has more and we stopped, not when it ran out. */
  hasMore: boolean;
}

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

export class TelegramError extends Error {
  readonly kind: TelegramErrorKind;
  /**
   * Seconds Telegram asked us to wait. Telegram's FLOOD_WAIT is an
   * instruction with a number in it, not a suggestion, and honouring it
   * exactly is the difference between a rate limit and a ban.
   */
  readonly retryAfterSeconds: number | null;

  constructor(kind: TelegramErrorKind, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'TelegramError';
    this.kind = kind;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * Everything Telegram-specific that touches the network.
 *
 * One interface, three eventual implementations, and a fixture implementation
 * that the tests drive. The adapter above it never knows which it has — which
 * is what makes "add credentials" the whole of the remaining work.
 */
export interface TelegramClient {
  readonly mode: TelegramIntegrationMode;
  readonly capabilities: TelegramCapabilities;

  /** Prove the credentials work. The only thing that may set healthy. */
  healthCheck(): Promise<{ ok: true; account: string | null } | { ok: false; error: TelegramError }>;

  resolveChat(username: string): Promise<TelegramChat>;
  searchPublicChats(query: string, limit: number): Promise<TelegramChat[]>;
  /** Newest first. `cursor` continues a previous page. */
  readHistory(chatId: string, options: { cursor: string | null; limit: number }): Promise<TelegramPage<TelegramMessage>>;
  /** The replies under one channel post, from its linked discussion group. */
  readDiscussionReplies(
    chatId: string,
    messageId: string,
    options: { cursor: string | null; limit: number },
  ): Promise<TelegramPage<TelegramMessage>>;
}

/**
 * The client used when there are no credentials.
 *
 * It exists so that "Telegram is not configured" is an ORDINARY, typed answer
 * that flows through the same code path as a rate limit or a private chat,
 * rather than a null the adapter has to remember to check. Every method
 * refuses with NOT_CONFIGURED, and refusing is all it does.
 *
 * This is why the production state can honestly be CONFIGURATION_READY: the
 * pipeline runs today, end to end, and stops at exactly one place with
 * exactly one reason.
 */
export class UnconfiguredTelegramClient implements TelegramClient {
  readonly mode: TelegramIntegrationMode;
  readonly capabilities: TelegramCapabilities;
  private readonly reason: string;

  constructor(mode: TelegramIntegrationMode = 'PUBLIC_PREVIEW', reason = 'no Telegram credentials are configured') {
    this.mode = mode;
    this.capabilities = capabilitiesFor(mode);
    this.reason = reason;
  }

  private refuse(): never {
    throw new TelegramError('NOT_CONFIGURED', this.reason);
  }

  async healthCheck() {
    return { ok: false as const, error: new TelegramError('NOT_CONFIGURED', this.reason) };
  }

  async resolveChat(): Promise<TelegramChat> { this.refuse(); }
  async searchPublicChats(): Promise<TelegramChat[]> { this.refuse(); }
  async readHistory(): Promise<TelegramPage<TelegramMessage>> { this.refuse(); }
  async readDiscussionReplies(): Promise<TelegramPage<TelegramMessage>> { this.refuse(); }
}

/* ────────────────────────────────────────────────────────────────────────
 * Rate limiting and retry
 * ──────────────────────────────────────────────────────────────────────── */

export interface RetryPlan {
  /** Try again at all? */
  retry: boolean;
  /** Milliseconds to wait first. */
  delayMs: number;
  reason: string;
}

/**
 * What to do after a failed Telegram call.
 *
 * Telegram's rate limiting is not advisory. FLOOD_WAIT carries a number of
 * seconds, and an integration that retries sooner — or that backs off on its
 * own schedule because that felt safer — gets the account limited harder. So
 * when Telegram states a delay it is honoured exactly, and the local back-off
 * applies only to failures Telegram did not put a number on.
 *
 * AUTH_FAILED and CAPABILITY_NOT_SUPPORTED are never retried: repeating a
 * call that cannot succeed is how a bad credential becomes a lockout.
 */
export function planRetry(
  error: TelegramError,
  attempt: number,
  options: { maxAttempts?: number; baseDelayMs?: number } = {},
): RetryPlan {
  const maxAttempts = options.maxAttempts ?? 3;
  const base = options.baseDelayMs ?? 1_000;

  if (attempt >= maxAttempts) {
    return { retry: false, delayMs: 0, reason: `giving up after ${attempt} attempts` };
  }

  switch (error.kind) {
    case 'RATE_LIMITED': {
      const stated = error.retryAfterSeconds;
      if (stated !== null && Number.isFinite(stated) && stated > 0) {
        return { retry: true, delayMs: Math.ceil(stated * 1000), reason: `Telegram asked for ${stated}s` };
      }
      return { retry: true, delayMs: base * 2 ** attempt, reason: 'rate limited with no stated delay' };
    }
    case 'NETWORK_ERROR':
      return { retry: true, delayMs: base * 2 ** attempt, reason: 'transient network failure' };
    case 'MALFORMED_RESPONSE':
      // Once. A second identical response is a change at their end, not luck.
      return attempt < 1
        ? { retry: true, delayMs: base, reason: 'one retry in case of a truncated response' }
        : { retry: false, delayMs: 0, reason: 'the response shape is wrong, not flaky' };

    case 'NOT_CONFIGURED':
    case 'DISABLED':
    case 'CAPABILITY_NOT_SUPPORTED':
    case 'AUTH_FAILED':
    case 'CHAT_NOT_FOUND':
    case 'CHAT_PRIVATE':
      return { retry: false, delayMs: 0, reason: `${error.kind} does not improve by being asked again` };

    default:
      return { retry: false, delayMs: 0, reason: 'unrecognised failure' };
  }
}
