// A TelegramClient that answers from fixtures.
//
// It implements the same interface the real MTProto, Bot API and preview
// clients will, which is the whole point of the boundary: the adapter, the
// normalizer, the dedup and everything above them are exercised end to end
// today, and the only thing that changes when credentials arrive is which
// object is passed to the constructor.
//
// It can also be told to FAIL — rate limits with a stated wait, private
// chats, malformed payloads — because the interesting half of an integration
// is what it does when the provider says no, and that half is impossible to
// test against a happy path.

import { capabilitiesFor, TelegramError } from '../client.ts';
import {
  CHANNEL,
  COMMENTS_ON_101,
  COMMENTS_ON_102,
  NO_DISCUSSION_CHANNEL,
  PAGE_ONE,
  PAGE_TWO,
  PRIVATE_CHANNEL,
} from './messages.mjs';

const CHATS = new Map([
  [CHANNEL.username, CHANNEL],
  [PRIVATE_CHANNEL.username, PRIVATE_CHANNEL],
  [NO_DISCUSSION_CHANNEL.username, NO_DISCUSSION_CHANNEL],
]);

const HISTORY = new Map([
  [CHANNEL.id, [PAGE_ONE, PAGE_TWO]],
  [NO_DISCUSSION_CHANNEL.id, [PAGE_ONE]],
]);

const REPLIES = new Map([
  ['101', COMMENTS_ON_101],
  ['102', COMMENTS_ON_102],
]);

export class FixtureTelegramClient {
  /**
   * @param {object} options
   * @param {'BOT_API'|'MTPROTO_USER'|'PUBLIC_PREVIEW'} [options.mode]
   * @param {Record<string, TelegramError>} [options.failures] keyed by method
   * @param {number} [options.failTimes] how many calls fail before succeeding
   */
  constructor(options = {}) {
    this.mode = options.mode ?? 'MTPROTO_USER';
    this.capabilities = capabilitiesFor(this.mode);
    this.failures = options.failures ?? {};
    this.failTimes = options.failTimes ?? Infinity;
    /** Every call made, so a test can assert what was and was not asked for. */
    this.calls = [];
  }

  #record(method, args) {
    this.calls.push({ method, args });
  }

  #maybeFail(method) {
    const failure = this.failures[method];
    if (!failure) return;
    const already = this.calls.filter((call) => call.method === method).length;
    if (already > this.failTimes) return;
    throw failure;
  }

  async healthCheck() {
    this.#record('healthCheck', {});
    try {
      this.#maybeFail('healthCheck');
    } catch (error) {
      return { ok: false, error };
    }
    return { ok: true, account: 'fixture' };
  }

  async resolveChat(username) {
    this.#record('resolveChat', { username });
    this.#maybeFail('resolveChat');
    const chat = CHATS.get(String(username).toLowerCase());
    if (!chat) throw new TelegramError('CHAT_NOT_FOUND', `no fixture chat @${username}`);
    if (!chat.publiclyReadable) {
      throw new TelegramError('CHAT_PRIVATE', `@${username} is private`);
    }
    return chat;
  }

  async searchPublicChats(query, limit) {
    this.#record('searchPublicChats', { query, limit });
    if (!this.capabilities.searchPublicChats) {
      throw new TelegramError('CAPABILITY_NOT_SUPPORTED', `${this.mode} cannot search public chats`);
    }
    this.#maybeFail('searchPublicChats');
    return [CHANNEL].slice(0, Math.max(0, limit));
  }

  async readHistory(chatId, { cursor, limit }) {
    this.#record('readHistory', { chatId, cursor, limit });
    if (!this.capabilities.readHistory) {
      throw new TelegramError('CAPABILITY_NOT_SUPPORTED', `${this.mode} cannot read history`);
    }
    this.#maybeFail('readHistory');

    const pages = HISTORY.get(chatId) ?? [];
    // The cursor here is a page index: opaque to everything above, which is
    // the contract. A real MTProto client would send a message offset and the
    // preview client a "before" token, and neither would look like this.
    const index = cursor === null || cursor === undefined ? 0 : Number(cursor);
    const page = pages[index] ?? [];
    const hasMore = index + 1 < pages.length;

    return {
      items: page.slice(0, Math.max(0, limit)),
      nextCursor: hasMore ? String(index + 1) : null,
      hasMore,
    };
  }

  async readDiscussionReplies(chatId, messageId, { cursor, limit }) {
    this.#record('readDiscussionReplies', { chatId, messageId, cursor, limit });
    if (!this.capabilities.readDiscussionReplies) {
      throw new TelegramError('CAPABILITY_NOT_SUPPORTED', `${this.mode} cannot read replies`);
    }
    this.#maybeFail('readDiscussionReplies');
    const items = (REPLIES.get(String(messageId)) ?? []).slice(0, Math.max(0, limit));
    return { items, nextCursor: null, hasMore: false };
  }
}

/** Shorthand for the failure cases the tests drive. */
export const FAILURES = {
  rateLimited: new TelegramError('RATE_LIMITED', 'FLOOD_WAIT_37', 37),
  rateLimitedNoDelay: new TelegramError('RATE_LIMITED', 'too many requests'),
  authFailed: new TelegramError('AUTH_FAILED', 'the session is no longer valid'),
  network: new TelegramError('NETWORK_ERROR', 'connection reset'),
  malformed: new TelegramError('MALFORMED_RESPONSE', 'unexpected payload'),
};
