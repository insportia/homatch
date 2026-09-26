// THE TELEGRAM CLIENT THAT NEEDS NO CREDENTIALS.
//
// client.ts declared PUBLIC_PREVIEW as a mode, gave it a capability row, and
// shipped only UnconfiguredTelegramClient — so the mode existed on paper and
// nothing could read. This is the missing implementation, and it is the whole of
// what was missing: the adapter above it already selects sources, honours the
// freshness rules and normalises messages, and never knew which client it had.
//
// A THIRD NETWORK PATH, AND WHY IT IS NOT ONE OF THE TWO THAT EXIST
//
// createPortalRuntime() is allowlist-only over eight PROPERTY PORTALS. t.me is
// not a property portal, and adding it there would widen the portal allowlist to
// make Telegram work — which the brief forbids and which would also file Telegram
// under a catalogue it does not belong to.
//
// createCandidateAuditPath() is for hosts that arrived in a database row: it
// resolves DNS and classifies every address because the host is unknown. t.me is
// not unknown. It is one fixed, public, operator-chosen hostname.
//
// So this builds its own runtime with an allowlist of exactly one host. The
// security posture is identical to the portal path and for the identical reason:
// `hostAllowlistOnly` is checked before any DNS work, so nothing outside that
// single entry is contacted whatever it resolves to, and `skipDnsResolution` is
// then safe because no URL on this path comes from a user — a channel username is
// validated against Telegram's own character rule before it reaches a URL.
//
// Three allowlists, three trust models, none widened to accommodate another.
//
// WHAT THIS CLIENT REFUSES TO DO
//
// searchPublicChats and readDiscussionReplies both throw
// CAPABILITY_NOT_SUPPORTED, because the preview page offers neither. That is not
// a stub — it is the honest answer, and the difference matters most for comments:
// they are where the buying intent usually is, and a client that returned an
// empty list would have the registry record "this channel has no discussion".
//
// It reads only `t.me/s/<channel>`, which Telegram serves to anybody. It sends no
// cookie, carries no session, and attempts no private channel: a private channel
// is an access control, and the parser reports CHANNEL_PRIVATE rather than trying
// anything else.

import { CircuitBreakerRegistry } from '../../flow/circuit-breaker.ts';
import { RateLimiter } from '../../flow/rate-limiter.ts';
import { HttpClient } from '../../fetch/http-client.ts';
import { FetchTransport } from '../../fetch/fetch-transport.ts';
import type { Transport } from '../../fetch/transport.ts';
import { NetworkPolicy } from '../../net/network-policy.ts';
import { RobotsChecker, type RobotsFetcher } from '../../net/robots.ts';
import {
  DEFAULT_SOURCE_POLICY,
  SourceAccessPolicyRegistry,
  type SourcePolicy,
} from '../../net/source-policy.ts';
import {
  capabilitiesFor,
  TelegramError,
  type TelegramCapabilities,
  type TelegramChat,
  type TelegramClient,
  type TelegramIntegrationMode,
  type TelegramMessage,
  type TelegramPage,
} from './client.ts';
import { parsePreviewPage, previewUrl, type PreviewPage } from './preview-parse.ts';

export const TELEGRAM_PREVIEW_HOST = 't.me';

/**
 * Identified, and gentle.
 *
 * One request per second and one at a time. The preview page is a courtesy
 * Telegram extends to anonymous readers and the correct way to treat a courtesy
 * is not to lean on it.
 */
export const TELEGRAM_PREVIEW_USER_AGENT =
  'HomatchResearch/1.0 (+https://homatch.ge/research-bot; reads public channel previews; respects robots.txt and rate limits)';

export const TELEGRAM_PREVIEW_POLICY: SourcePolicy = {
  ...DEFAULT_SOURCE_POLICY,
  id: 'telegram:preview',
  domains: ['t.me'],
  hosts: [TELEGRAM_PREVIEW_HOST],
  sourceFamily: 'telegram',
  kind: 'OTHER',
  enabled: true,
  allowedMethods: ['GET'],
  rate: { concurrency: 1, requestsPerSecond: 1, burst: 1 },
  robots: 'RESPECT',
  browserRenderingAllowed: false,
  /* A preview page measured 127KB live. 1MB is room for a busy channel and still
     a bound. */
  maxResponseBytes: 1_200_000,
  timeoutMs: 10_000,
  /* t.me redirects http→https and sometimes /channel→/s/channel. Two hops is
     enough, and each is re-validated against the one-host allowlist. */
  redirects: { follow: true, max: 2, allowCrossDomain: false },
  /* No document cache. Incremental sync decides what to re-read, and a cache here
     would silently answer a fresh sync from a stale page. */
  cacheTtlMs: 0,
  cacheStaleMs: 0,
  visibility: 'PUBLIC',
  authority: 0.3,
  canonicalization: { stripWww: true, stripTracking: true },
  notes:
    'Public channel preview at t.me/s/<channel>. No credentials, no session, no cookie. Reads '
    + 'channel posts only: comments live in a linked discussion group that this surface does not '
    + 'render, and private channels are refused rather than attempted.',
};

export interface PreviewClientOptions {
  /** Injected by tests. Production uses the platform's own fetch. */
  transport?: Transport;
  now?: () => number;
}

/** A tiny runtime whose allowlist is exactly one public host. */
function buildClient(options: PreviewClientOptions): HttpClient {
  const now = options.now ?? (() => Date.now());
  const transport = options.transport
    ?? new FetchTransport({ maxBytes: 1_200_000, userAgent: TELEGRAM_PREVIEW_USER_AGENT });

  const networkPolicy = new NetworkPolicy({
    /*
     * Exactly one host, and the portal allowlist is untouched. Checked before any
     * DNS work, so nothing else is contacted whatever it resolves to — which is
     * what makes skipDnsResolution safe here for the same reason it is safe on
     * the portal path: no URL on this path comes from a user.
     */
    hostAllowlistOnly: [TELEGRAM_PREVIEW_HOST],
    skipDnsResolution: true,
    allowedPorts: [80, 443],
    allowedSchemes: ['http:', 'https:'],
    allowCredentials: false,
  });

  const robotsFetcher: RobotsFetcher = {
    async fetch(robotsUrl: string) {
      try {
        const response = await transport.send({
          url: robotsUrl, method: 'GET', headers: {}, timeoutMs: 8_000, maxBytes: 128_000,
        });
        return { status: response.status, body: response.body };
      } catch {
        return null;
      }
    },
  };

  return new HttpClient({
    transport,
    robots: new RobotsChecker({
      userAgent: TELEGRAM_PREVIEW_USER_AGENT, fetcher: robotsFetcher, now,
    }),
    rateLimiter: new RateLimiter({ defaultPolicy: { concurrency: 1, requestsPerSecond: 1 } }),
    breakers: new CircuitBreakerRegistry(),
    networkPolicy,
    sourcePolicies: new SourceAccessPolicyRegistry([TELEGRAM_PREVIEW_POLICY]),
    /* See the header: the one-host allowlist is what makes this safe, exactly as
       on the portal path. */
    requirePinningTransport: false,
    /* No header carries identity, a session or a token. There is nothing to send:
       this surface is served to anybody. */
    headers: {},
    defaultTimeoutMs: 10_000,
    maxAttempts: 2,
    limitKeyMode: 'hostname',
  });
}

/** Turn a parser outcome into the error kinds the adapter already understands. */
function refuse(page: PreviewPage, username: string): never {
  switch (page.outcome) {
    case 'CHANNEL_PRIVATE':
      throw new TelegramError('CHAT_PRIVATE', `@${username}: ${page.detail}`);
    case 'CHANNEL_NOT_FOUND':
      throw new TelegramError('CHAT_NOT_FOUND', `@${username}: ${page.detail}`);
    case 'PREVIEW_UNAVAILABLE':
      /*
       * Not CHAT_NOT_FOUND: the channel exists. Not an empty result either —
       * CAPABILITY_NOT_SUPPORTED is exactly right, because this MODE cannot read
       * a channel that publishes no preview, and another mode could.
       */
      throw new TelegramError('CAPABILITY_NOT_SUPPORTED', `@${username}: ${page.detail}`);
    case 'RATE_LIMITED':
      throw new TelegramError('RATE_LIMITED', `@${username}: ${page.detail}`, 60);
    case 'MARKUP_UNRECOGNISED':
      throw new TelegramError('MALFORMED_RESPONSE', `@${username}: ${page.detail}`);
    default:
      throw new TelegramError('MALFORMED_RESPONSE', `@${username}: unexpected outcome`);
  }
}

/**
 * Reads public Telegram channel previews.
 *
 * `chatId` is the channel USERNAME throughout, not Telegram's numeric id. The
 * preview page never publishes the numeric id, and `PreviewChannel` records
 * `numericIdAvailable: false` so nothing downstream mistakes one for the other. A
 * username is unique and stable, which makes it a legitimate identity; a
 * fabricated number would not be.
 */
export class PublicPreviewTelegramClient implements TelegramClient {
  readonly mode: TelegramIntegrationMode = 'PUBLIC_PREVIEW';
  readonly capabilities: TelegramCapabilities = capabilitiesFor('PUBLIC_PREVIEW');

  private readonly http: HttpClient;

  constructor(options: PreviewClientOptions = {}) {
    this.http = buildClient(options);
  }

  private async read(username: string, before: string | null): Promise<PreviewPage> {
    const url = previewUrl(username, before);
    try {
      const result = await this.http.fetch(url, { method: 'GET' });
      return parsePreviewPage(result.body, username.replace(/^@/, ''));
    } catch (error) {
      if (error instanceof TelegramError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      /*
       * A 404 from t.me is a missing channel, which is a fact about the world; a
       * timeout is a fact about the network. Collapsing them would let an outage
       * retire a working source.
       */
      if (/\b404\b/.test(message)) {
        throw new TelegramError('CHAT_NOT_FOUND', `@${username}: Telegram returned 404`);
      }
      if (/\b429\b/.test(message)) {
        throw new TelegramError('RATE_LIMITED', `@${username}: Telegram returned 429`, 60);
      }
      throw new TelegramError('NETWORK_ERROR', `@${username}: ${message}`);
    }
  }

  /**
   * There are no credentials to prove, so this proves the SURFACE instead.
   *
   * It reads Telegram's own channel — a page that has existed for years — and
   * reports ok only if the markup still parses. That makes healthCheck a genuine
   * signal for this mode: it fails when Telegram changes the preview markup,
   * which is the one thing that can silently break the reader.
   */
  async healthCheck(): Promise<{ ok: true; account: string | null } | { ok: false; error: TelegramError }> {
    try {
      const page = await this.read('telegram', null);
      if (page.outcome !== 'OK') {
        return { ok: false, error: new TelegramError('MALFORMED_RESPONSE', page.detail) };
      }
      return { ok: true, account: null };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof TelegramError
          ? error
          : new TelegramError('NETWORK_ERROR', error instanceof Error ? error.message : String(error)),
      };
    }
  }

  async resolveChat(username: string): Promise<TelegramChat> {
    const clean = String(username).trim().replace(/^@/, '');
    const page = await this.read(clean, null);
    if (page.outcome !== 'OK' || !page.channel) refuse(page, clean);

    return {
      /* The USERNAME, deliberately. See the class comment. */
      id: page.channel.username,
      username: page.channel.username,
      title: page.channel.title,
      /* The preview page does not say whether it is a channel, a group or a
         supergroup. UNKNOWN is the honest value; guessing CHANNEL would be a
         claim about somebody else's configuration. */
      kind: 'UNKNOWN',
      participants: page.channel.participants,
      /* A linked discussion group is not exposed on this surface, and null here
         means "not visible", which is why readDiscussionReplies refuses rather
         than returning nothing. */
      linkedChatId: null,
      publiclyReadable: true,
    };
  }

  async searchPublicChats(): Promise<TelegramChat[]> {
    throw new TelegramError(
      'CAPABILITY_NOT_SUPPORTED',
      'the public preview surface has no search. A channel must be named before it can be read, '
        + 'so discovery for this mode is a human or a link, never a keyword query.',
    );
  }

  /**
   * The preview page as it came back, WITHOUT refusing on a bad outcome.
   *
   * readHistory() throws for anything but OK, which is right for a reader -- a
   * caller asking for messages must not receive an empty list when the truth is
   * "this channel is private". But an AUDITOR needs exactly the outcome it would
   * have thrown: CHANNEL_PRIVATE is the finding, not an error to handle.
   *
   * So this returns the PreviewPage untouched and refuses nothing. It performs the
   * same single robots-respecting request; it simply does not convert the answer
   * into an exception.
   */
  async inspectPreview(username: string): Promise<PreviewPage> {
    return await this.read(String(username).trim().replace(/^@/, ''), null);
  }

  async readHistory(
    chatId: string,
    options: { cursor: string | null; limit: number },
  ): Promise<TelegramPage<TelegramMessage>> {
    const username = String(chatId).trim().replace(/^@/, '');
    const page = await this.read(username, options.cursor);
    if (page.outcome !== 'OK') refuse(page, username);

    /* Telegram serves newest last on the preview page; the interface promises
       newest first, so the order is reversed here rather than in the adapter. */
    const ordered = [...page.messages].reverse();
    const limited = ordered.slice(0, Math.max(1, options.limit));

    const items: TelegramMessage[] = limited.map((message) => ({
      id: message.messageId,
      /* The channel Telegram said, not the one we asked for. */
      chatId: message.channel,
      date: message.publishedAt ? Math.floor(Date.parse(message.publishedAt) / 1000) : 0,
      /*
       * Null, always. The preview shows the WORD "edited" and never the time, and
       * this field is documented as "Unix seconds of the last edit". Putting the
       * crawl time here would record our polling interval as the author's edit.
       * The boolean survives on the parser's own shape.
       */
      editDate: null,
      text: message.text,
      replyToMessageId: message.replyToMessageId,
      /* This surface renders channel posts, never the linked discussion group, so
         nothing here is a comment on another post. */
      discussionOriginChatId: null,
      discussionOriginMessageId: null,
      authorUsername: null,
      authorDisplayName: message.authorName,
      fromChannel: message.authorName === null,
      views: message.views,
    }));

    return {
      items,
      /* Telegram's own load-more token, or null at the end of what this mode
         reaches. Truncation is reported, never silently absorbed — either
         Telegram offered older posts, or our own limit cut the page short. */
      nextCursor: page.nextCursor,
      hasMore: page.truncated || ordered.length > limited.length,
    };
  }

  async readDiscussionReplies(): Promise<TelegramPage<TelegramMessage>> {
    throw new TelegramError(
      'CAPABILITY_NOT_SUPPORTED',
      'comments live in a channel\'s linked discussion group, which t.me/s/ does not render. '
        + 'Refused rather than returned empty: an empty list here would be recorded as "this '
        + 'channel has no discussion", and comments are usually where the buying intent is.',
    );
  }
}
