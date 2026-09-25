// HOMATCH RESEARCH CORE — a Telegram message becomes evidence.
//
// One message in, one PublicSignal out, with enough provenance that somebody
// asking "where did this lead come from?" gets a t.me link they can open
// rather than a claim they have to trust.
//
// WHY A COMMENT IS NOT A LESSER POST
//
// On Telegram the replies under a channel post do not live on the post. They
// live in a separate DISCUSSION GROUP that the channel is linked to, and they
// are frequently where the buying intent is: the post is a listing, and the
// reply is "is this still available, and does it have parking?". A collector
// that reads channel posts and stops has read the supply side of the market
// and missed the demand side entirely.
//
// So a comment carries its parent's URL and an excerpt of its text, the
// direction classifier is given that parent as context, and a comment whose
// parent could not be retrieved is recorded as weaker rather than as equal.
//
// WHAT IS NOT DONE HERE
//
// No translation is written over the original. No phone number is mined out
// of the text. No identity is resolved and nothing is merged across
// platforms: a Telegram display name is a display name. The original text
// survives exactly as written, because it is the evidence, and everything
// else is an interpretation of it that can be recomputed.
//
// EDITS AND THE DIFFERENCE BETWEEN NEW AND CHANGED
//
// Telegram messages are editable, and a listing edited from "for sale" to
// "sold" is not a new signal — it is the same signal, changed. The identity
// is (chat, message), which is stable across edits; the fingerprint is of the
// text, which is not. Holding both is what lets a re-scan say "we have seen
// this, and it now says something different" instead of producing a duplicate
// lead with a new price.

import { deterministicId } from '../../core/ids.ts';
import { isResearchLanguage, type ResearchLanguage } from '../../discovery/lexicon.ts';
import { contentHash } from '../../normalize/hash.ts';
import { detectLanguage } from '../../normalize/language.ts';
import { classifyDirection } from '../../signals/direction.ts';
import type { AccessClass, ContentType, PublicSignal } from '../../signals/types.ts';
import type { TelegramChat, TelegramMessage } from './client.ts';

/* ────────────────────────────────────────────────────────────────────────
 * Addresses
 * ──────────────────────────────────────────────────────────────────────── */

const USERNAME = /^[A-Za-z][A-Za-z0-9_]{3,31}$/;

/**
 * The canonical URL of a Telegram chat: https://t.me/<username>.
 *
 * Every other form people paste — telegram.me, tg://resolve, a /s/ preview
 * link, a link to one message, a joinchat invite — is reduced to it, so the
 * registry holds one row per chat instead of five.
 *
 * A private invite link (t.me/+hash or /joinchat/) canonicalises to NULL on
 * purpose. It identifies a chat we have not been admitted to and cannot
 * address, and storing it as a source would create a registry row nothing can
 * ever scan.
 */
export function canonicalizeTelegramUrl(raw: string): string | null {
  const value = String(raw ?? '').trim();
  if (!value) return null;

  if (USERNAME.test(value.replace(/^@/, '')) && !value.includes('/')) {
    return `https://t.me/${value.replace(/^@/, '').toLowerCase()}`;
  }

  let url: URL;
  try {
    url = new URL(value.startsWith('http') ? value : `https://${value}`);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 't.me' && host !== 'telegram.me' && host !== 'telegram.dog') return null;

  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length === 0) return null;

  // /s/<username> is the public preview of the same channel, not another one.
  const first = segments[0] === 's' && segments.length > 1 ? segments[1] : segments[0];
  if (!first) return null;

  // An invite to somewhere we have not been admitted. Not an address.
  if (first.startsWith('+') || first.toLowerCase() === 'joinchat') return null;

  if (!USERNAME.test(first)) return null;
  return `https://t.me/${first.toLowerCase()}`;
}

export function isTelegramSourceUrl(raw: string): boolean {
  return canonicalizeTelegramUrl(raw) !== null;
}

/**
 * A link to one message, when the chat has a public username.
 *
 * A chat with no username has no public per-message URL, and inventing one
 * would put a dead link on a piece of evidence. Null is the honest answer and
 * the signal carries the source URL alone.
 */
export function messageUrl(chat: TelegramChat, messageId: string): string | null {
  if (!chat.username) return null;
  const id = String(messageId).trim();
  if (!/^\d+$/.test(id)) return null;
  return `https://t.me/${chat.username.toLowerCase()}/${id}`;
}

/* ────────────────────────────────────────────────────────────────────────
 * Messages become signals
 * ──────────────────────────────────────────────────────────────────────── */

export interface NormalizeContext {
  chat: TelegramChat;
  /** When this scan happened. One value for the whole batch. */
  discoveredAt: string;
  /** Which lexicons the classifier may consider. The campaign's set. */
  languages: readonly ResearchLanguage[];
  /**
   * How we read it. PUBLIC for a public channel read without credentials;
   * AUTHENTICATED when a connected session was required.
   */
  accessClass: AccessClass;
  /**
   * Parent posts, by `${chatId}:${messageId}`, so a comment can carry the
   * listing it sits under. Missing is normal and is handled as missing.
   */
  parents?: ReadonlyMap<string, TelegramMessage>;
}

export interface NormalizedTelegramSignal {
  signal: PublicSignal;
  /** Telegram's own ids, kept so a later scan can address the same message. */
  chatId: string;
  messageId: string;
  /** Unix seconds of the last edit we know about. Null when never edited. */
  editedAt: number | null;
}

/** Messages Telegram returns that carry nothing to classify. */
export function isEmptyMessage(message: TelegramMessage): boolean {
  return String(message?.text ?? '').trim().length === 0;
}

/**
 * One Telegram message, normalized.
 *
 * Returns null for a message with no text — a photo with no caption, a
 * service message announcing that somebody joined. Those are real messages
 * and they are not evidence of anything, and keeping them would inflate every
 * "signals found" count with things nobody could act on.
 */
export function normalizeMessage(
  message: TelegramMessage,
  context: NormalizeContext,
): NormalizedTelegramSignal | null {
  if (!message || isEmptyMessage(message)) return null;

  const text = String(message.text).trim();
  const isComment = message.replyToMessageId !== null
    || message.discussionOriginMessageId !== null;

  const parentKey = message.discussionOriginMessageId
    ? `${message.discussionOriginChatId ?? context.chat.id}:${message.discussionOriginMessageId}`
    : message.replyToMessageId
      ? `${message.chatId}:${message.replyToMessageId}`
      : null;
  const parent = parentKey ? context.parents?.get(parentKey) ?? null : null;

  const sourceUrl = context.chat.username
    ? `https://t.me/${context.chat.username.toLowerCase()}`
    : `https://t.me/c/${context.chat.id}`;

  const contentType: ContentType = isComment ? 'COMMENT' : 'POST';

  /*
   * The parent's text, trimmed to context rather than copied whole. It is
   * shown beside the comment so a human can read "is this still available?"
   * and see what "this" was, and it is fed to the classifier for the same
   * reason -- a comment inherits its parent's SUBJECT and none of its
   * direction.
   */
  const parentExcerpt = parent ? excerpt(parent.text) : null;

  const verdict = classifyDirection(text, {
    languages: context.languages,
    parentContext: parentExcerpt,
  });

  /*
   * SOURCE LANGUAGE IS OBSERVED, NOT ASSUMED.
   *
   * It is not the campaign's search language and not the customer's interface
   * language: a Russian-language post found by a Hebrew query is a Russian
   * post, and recording it as Hebrew would make every later "which language
   * produced this lead" answer wrong.
   *
   * Script detection is used only when it says it is reliable -- a two-word
   * message in Latin script could be five languages -- and otherwise the
   * lexicon match that classified the direction is the better witness,
   * because it matched actual phrases in an actual language.
   */
  const detected = detectLanguage(text);
  const language: ResearchLanguage | null =
    detected.reliable && detected.language && isResearchLanguage(detected.language)
      ? detected.language
      : (verdict.languages[0] ?? null);

  const contentUrl = messageUrl(context.chat, message.id);

  return {
    chatId: message.chatId,
    messageId: message.id,
    editedAt: message.editDate ?? null,
    signal: {
      /*
       * Identity is (chat, message) -- NOT the text. A message edited from
       * "for sale" to "sold" is the same message saying something new, and
       * hashing the text would file it as a second lead at a second price.
       */
      id: deterministicId('sig', 'TELEGRAM', message.chatId, message.id),
      platform: 'TELEGRAM',
      contentType,
      sourceUrl,
      contentUrl,
      parentUrl: parent ? messageUrl(context.chat, parent.id) : null,
      parentExcerpt,
      author: {
        /*
         * A channel post is signed by the channel, not by a person, and
         * recording the channel title as an author would invent an individual
         * who does not exist.
         */
        publicName: message.fromChannel
          ? context.chat.title
          : (message.authorDisplayName ?? message.authorUsername ?? null),
        publicUrl: message.authorUsername && !message.fromChannel
          ? `https://t.me/${message.authorUsername.toLowerCase()}`
          : null,
      },
      originalText: text,
      translatedText: null,
      language,
      // Telegram states the post time, so it is never the crawl time.
      publishedAt: unixToIso(message.date),
      discoveredAt: context.discoveredAt,
      lastSeenAt: context.discoveredAt,
      // Of the TEXT, so an edit changes it while the id stays put.
      contentFingerprint: contentHash(text),
      direction: verdict.direction,
      directionConfidence: parent || !isComment
        ? verdict.confidence
        // A comment read without its parent is genuinely weaker evidence: the
        // thing it refers to is missing. Recorded as less certain rather than
        // as equal, because a match built on it is built on less.
        : round2(verdict.confidence * 0.8),
      locationHints: { countryCode: null, city: null, district: null, mentions: [] },
      requirementHints: { bedrooms: null, areaSqm: null, budgetAmount: null, budgetCurrency: null },
      accessClass: context.accessClass,
    },
  };
}

export function normalizeMessages(
  messages: readonly TelegramMessage[],
  context: NormalizeContext,
): NormalizedTelegramSignal[] {
  const out: NormalizedTelegramSignal[] = [];
  for (const message of messages ?? []) {
    const normalized = normalizeMessage(message, context);
    if (normalized) out.push(normalized);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────────────────
 * Seen before?
 * ──────────────────────────────────────────────────────────────────────── */

export type SeenVerdict = 'NEW' | 'UNCHANGED' | 'EDITED' | 'DUPLICATE_TEXT';

export interface KnownSignal {
  id: string;
  contentFingerprint: string;
}

/**
 * Whether we already hold this, and in what sense.
 *
 * Three different kinds of "already have it", and collapsing them loses real
 * information:
 *
 *   UNCHANGED       same message, same text. Update last_seen_at, nothing else.
 *   EDITED          same message, different text. The lead may have changed
 *                   materially -- a price, a "SOLD" -- and something has to
 *                   look at it.
 *   DUPLICATE_TEXT  a DIFFERENT message with identical text. Cross-posting
 *                   the same listing into eight groups is normal on Telegram,
 *                   and eight identical leads in a customer's results is not.
 *
 * Dedup by text alone would hide edits; dedup by id alone would deliver the
 * same listing eight times. Both are needed, which is why both are here.
 */
export function classifySeen(
  candidate: NormalizedTelegramSignal,
  known: {
    byId?: ReadonlyMap<string, KnownSignal>;
    byFingerprint?: ReadonlyMap<string, KnownSignal>;
  },
): SeenVerdict {
  const existing = known.byId?.get(candidate.signal.id);
  if (existing) {
    return existing.contentFingerprint === candidate.signal.contentFingerprint ? 'UNCHANGED' : 'EDITED';
  }
  const sameText = known.byFingerprint?.get(candidate.signal.contentFingerprint);
  if (sameText && sameText.id !== candidate.signal.id) return 'DUPLICATE_TEXT';
  return 'NEW';
}

/* ────────────────────────────────────────────────────────────────────────
 * Cursors
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * Where an incremental scan should stop next time.
 *
 * Telegram message ids inside one chat are monotonic, which makes them a far
 * better cursor than a timestamp: two messages can share a second, ids cannot
 * collide, and a message posted with a backdated timestamp still has a higher
 * id. So the cursor is the highest id SUCCESSFULLY processed.
 *
 * The cursor never advances past something that was not processed. Advancing
 * it on a failed batch would skip that window permanently, and the messages
 * in it would never be read by anything, ever.
 */
export function nextCursor(
  processed: readonly NormalizedTelegramSignal[],
  previous: string | null,
): string | null {
  let highest = toId(previous);
  for (const item of processed) {
    const id = toId(item.messageId);
    if (id !== null && (highest === null || id > highest)) highest = id;
  }
  return highest === null ? previous : String(highest);
}

/** Is this message newer than the cursor? */
export function isNewerThanCursor(message: TelegramMessage, cursor: string | null): boolean {
  if (!cursor) return true;
  const bound = toId(cursor);
  const id = toId(message?.id);
  if (bound === null || id === null) return true;
  return id > bound;
}

function toId(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(String(value).trim());
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function unixToIso(seconds: number | null | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return null;
  const ms = seconds * 1000;
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function excerpt(text: string, limit = 280): string {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim();
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
