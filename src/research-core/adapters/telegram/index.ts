// HOMATCH RESEARCH CORE — the Telegram source adapter.
//
// A new file implementing SourceAdapter, which is what discovery/adapter.ts
// said adding Telegram would be. There is no Telegram job engine, no Telegram
// queue and no Telegram worker: the ladder selects sources, the registry
// remembers which ones paid off, the freshness rules decide what to re-read,
// and this adapter is the only part that knows Telegram exists.
//
// THE ONE STRUCTURAL DIFFERENCE FROM THE WEB ADAPTERS
//
// Facebook and the portals are handed `context.fetchDocument` and read HTML.
// Telegram's real interfaces are not documents — MTProto and the Bot API are
// RPC — so this adapter is handed a TelegramClient instead. That boundary is
// what makes the integration finishable without credentials: the client is
// the only thing that has to change when they arrive, and today it is
// UnconfiguredTelegramClient, which refuses every call with NOT_CONFIGURED.
//
// The PUBLIC_PREVIEW mode is the exception that proves it useful: t.me/s/ IS
// an ordinary web page, so a preview client can be built on the shared
// fetcher and run with no credentials at all. It reads recent posts and no
// comments, and says so rather than implying it read everything.
//
// REFUSALS ARE RESULTS
//
// Every way this can fail to return signals is a named reason, because the
// difference between "this channel posted nothing this week" and "this mode
// cannot read history" is the difference between a market report and a lie.
// CAPABILITY_NOT_SUPPORTED is returned for the second, and the admin area
// shows which mode would fix it.

import type {
  AdapterContext,
  AdapterFailure,
  AdapterOutcome,
  DiscoveredSource,
  DiscoverRequest,
  ScanRequest,
  ScanResult,
  SourceAdapter,
} from '../../discovery/adapter.ts';
import type { ResearchLanguage } from '../../discovery/lexicon.ts';
import type { SourceAccessState } from '../../discovery/source-registry.ts';
import {
  capabilitiesFor,
  type TelegramChat,
  type TelegramClient,
  TelegramError,
  type TelegramMessage,
  UnconfiguredTelegramClient,
} from './client.ts';
import {
  canonicalizeTelegramUrl,
  classifySeen,
  isNewerThanCursor,
  isTelegramSourceUrl,
  type KnownSignal,
  type NormalizedTelegramSignal,
  nextCursor,
  normalizeMessages,
} from './normalize.ts';

export { canonicalizeTelegramUrl, isTelegramSourceUrl };

/** Telegram's own failure kinds, in the vocabulary the ladder understands. */
export function telegramFailureToAdapterFailure(error: TelegramError): AdapterFailure {
  switch (error.kind) {
    case 'NOT_CONFIGURED':
    case 'DISABLED':
    case 'CAPABILITY_NOT_SUPPORTED':
      return 'CAPABILITY_NOT_SUPPORTED';
    case 'AUTH_FAILED':
      return 'LOGIN_WALL';
    // A private chat is one a human must be asked about. It is never joined
    // automatically, and it is recorded rather than discarded.
    case 'CHAT_PRIVATE':
      return 'JOIN_REQUIRED';
    case 'RATE_LIMITED':
      return 'RATE_LIMITED';
    case 'CHAT_NOT_FOUND':
      return 'NOT_FOUND';
    case 'MALFORMED_RESPONSE':
      return 'PARSE_FAILED';
    case 'NETWORK_ERROR':
    default:
      return 'NETWORK_ERROR';
  }
}

export interface TelegramAdapterOptions {
  /** Defaults to the unconfigured client, which is the truthful default. */
  client?: TelegramClient;
  languages?: readonly ResearchLanguage[];
  /**
   * What is already stored, so a re-scan can tell a new message from an
   * edited one from the same listing cross-posted into a fifth group.
   * Absent means "we hold nothing", which is right for a first scan.
   */
  known?: {
    byId?: ReadonlyMap<string, KnownSignal>;
    byFingerprint?: ReadonlyMap<string, KnownSignal>;
  };
}

export class TelegramAdapter implements SourceAdapter {
  readonly id = 'telegram';
  readonly platform = 'TELEGRAM' as const;
  readonly capabilities = ['discover', 'fetch', 'extract', 'scanIncremental'] as const;

  private readonly client: TelegramClient;
  private readonly languages: readonly ResearchLanguage[];
  private readonly known: TelegramAdapterOptions['known'];

  constructor(options: TelegramAdapterOptions = {}) {
    this.client = options.client ?? new UnconfiguredTelegramClient();
    this.languages = options.languages ?? ['ka', 'en', 'ru', 'tr', 'ar', 'he'];
    this.known = options.known;
  }

  handles(url: string): boolean {
    return isTelegramSourceUrl(url);
  }

  canonicalize(url: string): string | null {
    return canonicalizeTelegramUrl(url);
  }

  /**
   * Find public Telegram chats worth remembering.
   *
   * Two routes, and which are available depends entirely on the mode:
   *
   *   A planned query that IS a t.me address — an operator seed, a link
   *   harvested from a page we could already read — is resolved and
   *   classified. Every mode can do some version of this.
   *
   *   A keyword search over public chats is MTPROTO only. Under any other
   *   mode it is refused by name rather than returning an empty list, because
   *   an empty list would be read as "Telegram has no Georgian housing
   *   channels", which is false.
   */
  async discover(
    request: DiscoverRequest,
    _context: AdapterContext,
  ): Promise<AdapterOutcome<DiscoveredSource[]>> {
    const seeds: string[] = [];
    const keywords: string[] = [];
    for (const query of request.queries) {
      const canonical = canonicalizeTelegramUrl(query.text);
      if (canonical) seeds.push(canonical);
      else keywords.push(query.text);
    }

    const found: DiscoveredSource[] = [];
    const seen = new Set<string>();
    const limit = Math.max(0, request.limit);

    for (const url of seeds) {
      if (found.length >= limit) break;
      const username = usernameOf(url);
      if (!username || seen.has(url)) continue;
      seen.add(url);
      try {
        const chat = await this.client.resolveChat(username);
        found.push(describeChat(chat, url, 'Resolved from a seeded or harvested Telegram address.'));
      } catch (error) {
        const failure = asTelegramError(error);
        if (failure.kind === 'CHAT_PRIVATE') {
          /*
           * Recorded, not discarded. Knowing a private housing group exists,
           * what it is called and where it is, is exactly what the access
           * queue needs to ask a human whether to request entry. Nothing here
           * joins it.
           */
          found.push({
            canonicalUrl: url,
            externalId: username,
            name: null,
            accessState: 'JOIN_REQUIRED',
            languages: [],
            rationale: 'Identified, but the chat is private. Queued for a human to decide about.',
          });
          continue;
        }
        if (failure.kind === 'CHAT_NOT_FOUND') continue;
        return { ok: false, reason: telegramFailureToAdapterFailure(failure), detail: failure.message };
      }
    }

    if (keywords.length > 0 && found.length < limit) {
      if (!this.client.capabilities.searchPublicChats) {
        /*
         * Only when we found nothing at all. A partial result from the seeds
         * is a real result and returning it beats refusing the whole call --
         * but a completely empty answer must not be mistaken for "there is
         * nothing there", so it is refused with the reason and the mode that
         * would fix it.
         */
        if (found.length === 0) {
          return {
            ok: false,
            reason: 'CAPABILITY_NOT_SUPPORTED',
            detail: `keyword search over public chats requires the MTPROTO_USER integration; this connection is ${this.client.mode}`,
          };
        }
        return { ok: true, value: found };
      }

      for (const keyword of keywords) {
        if (found.length >= limit) break;
        try {
          const chats = await this.client.searchPublicChats(keyword, limit - found.length);
          for (const chat of chats) {
            const url = chat.username ? `https://t.me/${chat.username.toLowerCase()}` : null;
            if (!url || seen.has(url)) continue;
            seen.add(url);
            found.push(describeChat(chat, url, `Matched the public-chat search for "${keyword}".`));
          }
        } catch (error) {
          const failure = asTelegramError(error);
          if (failure.kind === 'RATE_LIMITED') {
            // Stop asking. What we have is real; the rest can wait for the
            // next run rather than being bought with a flood wait.
            break;
          }
          return { ok: false, reason: telegramFailureToAdapterFailure(failure), detail: failure.message };
        }
      }
    }

    return { ok: true, value: found.slice(0, limit) };
  }

  /**
   * Read what is new in one chat, and the comments under it where the mode
   * allows.
   *
   * The cursor is the highest message id already processed, because Telegram
   * ids are monotonic inside a chat and timestamps are not unique. It advances
   * only over messages that were actually normalized — a batch that failed
   * halfway leaves the cursor where it was, so the window it covered is read
   * again rather than lost forever.
   */
  async scan(request: ScanRequest, context: AdapterContext): Promise<AdapterOutcome<ScanResult>> {
    if (!this.client.capabilities.readHistory) {
      return {
        ok: false,
        reason: 'CAPABILITY_NOT_SUPPORTED',
        detail: `reading chat history requires MTPROTO_USER or PUBLIC_PREVIEW; this connection is ${this.client.mode}`,
      };
    }

    const url = request.source.canonicalUrl;
    const username = usernameOf(url);
    if (!username) {
      return { ok: false, reason: 'NOT_FOUND', detail: 'the source URL is not an addressable Telegram chat' };
    }

    let chat: TelegramChat;
    try {
      chat = await this.client.resolveChat(username);
    } catch (error) {
      const failure = asTelegramError(error);
      return { ok: false, reason: telegramFailureToAdapterFailure(failure), detail: failure.message };
    }

    const discoveredAt = new Date(context.now()).toISOString();
    const accessClass = chat.publiclyReadable ? 'PUBLIC' as const : 'AUTHENTICATED' as const;

    let page;
    try {
      page = await this.client.readHistory(chat.id, { cursor: request.cursor, limit: request.limit });
    } catch (error) {
      const failure = asTelegramError(error);
      return { ok: false, reason: telegramFailureToAdapterFailure(failure), detail: failure.message };
    }

    const fresh = (page.items ?? []).filter((message) => isNewerThanCursor(message, request.cursor));

    /*
     * COMMENTS, WHERE THE MODE ACTUALLY HAS THEM.
     *
     * Only for demand jobs -- includeComments -- because it is one request
     * per post and a supply job does not need them. A mode that cannot read
     * replies produces posts alone and the result says so through
     * `commentsAvailable`, rather than the caller inferring that these
     * channels have no discussion.
     */
    const commentsWanted = request.includeComments;
    const commentsAvailable = this.client.capabilities.readDiscussionReplies && chat.linkedChatId !== null;

    const parents = new Map<string, TelegramMessage>();
    for (const message of fresh) parents.set(`${message.chatId}:${message.id}`, message);

    const comments: TelegramMessage[] = [];
    if (commentsWanted && commentsAvailable) {
      for (const post of fresh) {
        if (comments.length >= request.limit) break;
        try {
          const replies = await this.client.readDiscussionReplies(chat.id, post.id, {
            cursor: null,
            limit: Math.max(1, request.limit - comments.length),
          });
          comments.push(...(replies.items ?? []));
        } catch (error) {
          const failure = asTelegramError(error);
          // A post whose comments could not be read still yields the post.
          // Losing the whole scan over one thread would be a worse answer.
          if (failure.kind === 'RATE_LIMITED') break;
          continue;
        }
      }
    }

    const normalized = normalizeMessages([...fresh, ...comments], {
      chat,
      discoveredAt,
      languages: this.languages,
      accessClass,
      parents,
    });

    const kept: NormalizedTelegramSignal[] = [];
    for (const item of normalized) {
      const verdict = classifySeen(item, this.known ?? {});
      /*
       * UNCHANGED and DUPLICATE_TEXT are dropped from the RESULT and not from
       * the record: the caller still updates last_seen_at from the scan, and a
       * listing cross-posted into eight groups is one lead, not eight. EDITED
       * is kept deliberately -- the same message now says something different,
       * and a price change or a "SOLD" is exactly what a re-scan is for.
       */
      if (verdict === 'NEW' || verdict === 'EDITED') kept.push(item);
    }

    const limited = kept.slice(0, request.limit);

    return {
      ok: true,
      value: {
        signals: limited.map((item) => item.signal),
        cursor: nextCursor(limited, request.cursor),
        // Truncated when the source had more, or when our own limit cut it.
        truncated: page.hasMore || kept.length > limited.length,
        // Telegram chats are addressed, not linked: a scan discovers new
        // chats only through a keyword search, which is discover()'s job.
        discovered: [],
      },
    };
  }
}

/* ────────────────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────────────────── */

function usernameOf(canonicalUrl: string): string | null {
  const canonical = canonicalizeTelegramUrl(canonicalUrl);
  if (!canonical) return null;
  const name = canonical.split('/').pop();
  return name ? name.toLowerCase() : null;
}

function describeChat(chat: TelegramChat, url: string, rationale: string): DiscoveredSource {
  const accessState: SourceAccessState = chat.publiclyReadable ? 'PUBLIC' : 'JOIN_REQUIRED';
  const detail = chat.participants !== null
    // Telegram's own published figure, or nothing. Never an estimate.
    ? `${rationale} ${chat.participants} members.`
    : rationale;

  return {
    canonicalUrl: url,
    externalId: chat.username ?? chat.id,
    name: chat.title,
    accessState,
    // Left empty on purpose: a chat's languages are learned from the messages
    // it actually produces, not guessed from its title.
    languages: [],
    rationale: detail,
  };
}

function asTelegramError(error: unknown): TelegramError {
  if (error instanceof TelegramError) return error;
  return new TelegramError('NETWORK_ERROR', error instanceof Error ? error.message : String(error));
}

/**
 * Whether this adapter can do anything useful right now, and why not.
 *
 * Used by the admin area so a provider row can say CREDENTIALS_MISSING rather
 * than showing green because the fixture tests passed.
 */
export function telegramAdapterCapabilities(client: TelegramClient) {
  return {
    mode: client.mode,
    capabilities: client.capabilities,
    canDiscoverByKeyword: client.capabilities.searchPublicChats,
    canReadHistory: client.capabilities.readHistory,
    canReadComments: client.capabilities.readDiscussionReplies,
  };
}

export { capabilitiesFor };
