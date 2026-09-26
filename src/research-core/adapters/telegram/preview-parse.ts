// READING A PUBLIC TELEGRAM CHANNEL PREVIEW PAGE.
//
// `t.me/s/<channel>` is an ordinary public web page. No credentials, no session,
// no API key — Telegram serves it to anybody, which is what makes it the one
// surface in the whole acquisition matrix marked AVAILABLE with nothing to
// provision.
//
// WHAT THIS FILE IS, AND IS NOT
//
// It is a parser. It takes HTML and returns messages, or a named reason why it
// could not. It opens no socket, so it is testable against saved markup and
// cannot be the thing that accidentally fetches something private.
//
// THE IDENTITY, AND WHY THIS SURFACE IS WORTH HAVING AT ALL
//
// Telegram puts the native identity in the markup:
//
//   <div class="tgme_widget_message" data-post="channelname/1234">
//
// `data-post` is `<channel>/<messageId>` — the platform's own identity for the
// message, exactly what signals/identity.ts requires and exactly what
// meta-platform.ts had to fall back to hashing text for. So a Telegram preview
// message can be stored with a stable id on the first read, and an edit to its
// text changes the text and nothing else.
//
// WHAT THE PREVIEW PAGE DOES NOT GIVE US, STATED SO NOBODY INVENTS IT
//
// The numeric chat id. The page identifies the channel by @username only.
// `TelegramChat.id` is documented as "Telegram's own numeric id", and in this
// mode we do not have it — so the username is returned as the chat identity and
// `numericIdAvailable: false` says why. A username is stable and unique, which
// makes it a legitimate identity; inventing a number would not.
//
// Comment threads. The preview renders channel posts, not the linked discussion
// group, so there are no replies here. The capability table already says
// readDiscussionReplies is false for this mode, and the acquisition matrix
// records Telegram COMMENT reading as NOT_PROGRAMMATICALLY_AVAILABLE over
// PUBLIC_WEB. That matters because comments are usually where the buying intent
// is, and a scan that silently returned none would read as "this channel has no
// discussion".
//
// Deletions. A deleted message simply stops appearing. Absence is not proof of
// deletion on a page that only shows a window of recent posts, so this parser
// never reports one.
//
// WHY EVERY FAILURE IS NAMED
//
// A private channel, a channel that does not exist, a channel with no public
// preview and a rate limit all return HTML with status 200 on this surface. A
// parser that returned "no messages" for those would be making four different
// false statements about the world. Each gets its own outcome.

import { collapseWhitespace, decodeEntities } from '../../normalize/text.ts';

export type PreviewOutcome =
  /** Messages were read. */
  | 'OK'
  /** The page exists and the channel has no public preview. */
  | 'PREVIEW_UNAVAILABLE'
  /** Telegram says this channel is private. */
  | 'CHANNEL_PRIVATE'
  /** No such channel. */
  | 'CHANNEL_NOT_FOUND'
  /** Telegram asked us to slow down. */
  | 'RATE_LIMITED'
  /** The page rendered, and nothing in it looked like the preview markup. */
  | 'MARKUP_UNRECOGNISED';

export interface PreviewMessage {
  /** Telegram's own per-channel message id, from data-post. */
  messageId: string;
  /** The channel username from data-post. Authoritative over the URL. */
  channel: string;
  /** Canonical permalink, as Telegram itself links it. */
  permalink: string | null;
  text: string;
  /** ISO 8601 from the <time datetime> attribute. Null when absent. */
  publishedAt: string | null;
  /** True when Telegram marks the post edited. The date itself is not shown. */
  edited: boolean;
  /** Public author handle where the channel signs posts. Never resolved. */
  authorName: string | null;
  /**
   * Telegram's own view count, ONLY when it published an exact integer.
   *
   * Null for "1.48M", which is what the preview page actually shows for a large
   * channel. Expanding that to 1,480,000 would invent five digits of precision
   * Telegram never gave — so the number stays null and `viewsLabel` carries what
   * was actually written.
   */
  views: number | null;
  /**
   * Telegram's own string, verbatim: "1.48M", "9.5K", "812".
   *
   * Exists because `views: null` alone would read as "Telegram published no view
   * count", and on this surface that is false for every popular channel. The
   * label records that a count WAS published and that it was rounded.
   */
  viewsLabel: string | null;
  /** The message this one visibly replies to, where the preview links it. */
  replyToMessageId: string | null;
  /** Whether the post carries media. Metadata only; nothing is downloaded. */
  hasMedia: boolean;
}

export interface PreviewChannel {
  /** The @username, without the @. The identity available in this mode. */
  username: string;
  title: string | null;
  /**
   * False, always, for this surface — and recorded rather than assumed so a
   * caller never stores a username where a numeric chat id is expected.
   */
  numericIdAvailable: false;
  /** Subscriber count ONLY when Telegram published an exact integer. */
  participants: number | null;
  /** Telegram's own string, verbatim: "9.47M subscribers". Rounded, and kept as written. */
  participantsLabel: string | null;
}

export interface PreviewPage {
  outcome: PreviewOutcome;
  channel: PreviewChannel | null;
  messages: PreviewMessage[];
  /**
   * The `before` token for the previous (older) page, from Telegram's own
   * "load more" link. Null when the page offers none — which is how this mode
   * reports the end of what it can reach.
   */
  nextCursor: string | null;
  /** True when Telegram offered more and we stopped. */
  truncated: boolean;
  /** Plain words, for the operator and the source registry. */
  detail: string;
}

/* Telegram's own wording on the pages that are not a preview. */
const PRIVATE_MARKERS = [
  'this channel is private',
  'if you have the invite link',
  'please open this link',
];
const NOT_FOUND_MARKERS = [
  "doesn't exist",
  'does not exist',
  'user not found',
  'channel not found',
];
const NO_PREVIEW_MARKERS = [
  'preview is not available',
  'no posts yet',
  "channel doesn't have any posts",
];
const RATE_LIMIT_MARKERS = ['too many requests', 'retry later'];

const has = (haystack: string, needles: readonly string[]): boolean =>
  needles.some((n) => haystack.includes(n));

/** Strip tags and normalise, preserving line structure from <br> and block ends. */
function visibleText(fragment: string): string {
  return collapseWhitespace(
    decodeEntities(
      fragment
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div)>/gi, '\n')
        .replace(/<[^>]*>/g, ' '),
    ).replace(/[ \t]+\n/g, '\n'),
  );
}

/**
 * Pull the inner HTML of the first element carrying `class="…marker…"`.
 *
 * Depth-aware: Telegram nests divs inside the message text, and a regex that
 * stopped at the first `</div>` would truncate any post containing a link
 * preview. Counts opening and closing tags of the same name instead.
 */
function firstByClass(html: string, marker: string, tag = 'div'): string | null {
  /*
   * WHOLE CLASS TOKEN, NOT A SUBSTRING.
   *
   * The first version matched `class="[^"]*marker[^"]*"`, and Telegram's class
   * names nest as prefixes: `tgme_channel_info_header_title` is a substring of
   * `tgme_channel_info_header_title_wrap`, and `tgme_channel_info_counter` of
   * `tgme_channel_info_counters`. So the wrapper matched first: the title came
   * back with the verified badge glued onto it, and the counter returned every
   * counter on the page concatenated.
   *
   * Same trap as matching `дом` inside `рядом`: a class attribute is a
   * space-separated token list and has to be matched as one token.
   */
  const open = new RegExp(
    `<${tag}[^>]*\\sclass="(?:[^"]*\\s)?${marker}(?:\\s[^"]*)?"[^>]*>`,
    'i',
  );
  const start = open.exec(html);
  if (!start) return null;

  const from = start.index + start[0].length;
  const opener = new RegExp(`<${tag}\\b`, 'gi');
  const closer = new RegExp(`</${tag}\\s*>`, 'gi');
  opener.lastIndex = from;
  closer.lastIndex = from;

  let depth = 1;
  let cursor = from;
  for (let guard = 0; guard < 5000 && depth > 0; guard += 1) {
    opener.lastIndex = cursor;
    closer.lastIndex = cursor;
    const nextOpen = opener.exec(html);
    const nextClose = closer.exec(html);
    if (!nextClose) return html.slice(from);
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1;
      cursor = nextOpen.index + nextOpen[0].length;
    } else {
      depth -= 1;
      cursor = nextClose.index + nextClose[0].length;
      if (depth === 0) return html.slice(from, nextClose.index);
    }
  }
  return html.slice(from, cursor);
}

/** Every `<div class="tgme_widget_message …" …>` block, with its own bounds. */
function messageBlocks(html: string): string[] {
  const blocks: string[] = [];
  const open = /<div[^>]*class="[^"]*tgme_widget_message(?![_a-z])[^"]*"[^>]*data-post="[^"]+"[^>]*>/gi;
  const found: number[] = [];
  for (const m of html.matchAll(open)) found.push(m.index ?? 0);

  for (let i = 0; i < found.length; i += 1) {
    const from = found[i] as number;
    const to = i + 1 < found.length ? (found[i + 1] as number) : html.length;
    blocks.push(html.slice(from, to));
  }
  return blocks;
}

function parseParticipants(raw: string | null): number | null {
  if (!raw) return null;
  /* "12.5K subscribers" / "1 234 subscribers". K/M are Telegram's own
     rounding, so an expanded value would be a fabricated precision; only an
     exact integer is accepted. */
  const cleaned = raw.replace(/[  \s,]/g, '');
  const exact = /^(\d+)subscribers?$/i.exec(cleaned);
  return exact ? Number(exact[1]) : null;
}

/**
 * Parse one preview page.
 *
 * `requestedChannel` is used only to report which channel was asked for. The
 * channel in `data-post` wins for identity, because that is what Telegram says
 * the message belongs to — a redirect or a renamed channel would otherwise file
 * evidence under the wrong community.
 */
export function parsePreviewPage(html: string, requestedChannel: string): PreviewPage {
  const lower = html.toLowerCase();

  const fail = (outcome: PreviewOutcome, detail: string): PreviewPage => ({
    outcome, channel: null, messages: [], nextCursor: null, truncated: false, detail,
  });

  if (has(lower, RATE_LIMIT_MARKERS)) {
    return fail('RATE_LIMITED', 'Telegram asked us to slow down; nothing was read');
  }
  if (has(lower, PRIVATE_MARKERS)) {
    return fail('CHANNEL_PRIVATE',
      'Telegram says this channel is private. Not attempted further: a private channel is an '
      + 'access control and joining one is not something this reader does');
  }
  if (has(lower, NOT_FOUND_MARKERS)) {
    return fail('CHANNEL_NOT_FOUND', `Telegram has no channel @${requestedChannel}`);
  }

  const blocks = messageBlocks(html);

  if (blocks.length === 0) {
    if (has(lower, NO_PREVIEW_MARKERS)) {
      return fail('PREVIEW_UNAVAILABLE',
        'the channel exists and serves no public preview. This is a property of the channel, not '
        + 'an empty channel and not a failed read');
    }

    /*
     * THE CONTACT PAGE, and it took a live read to find this.
     *
     * `t.me/s/<name>` 302-redirects to `t.me/<name>` whenever there is no public
     * channel preview to show, and that page is the generic "Contact @name /
     * Send Message" card carrying `tgme_page_*` classes. Measured 2026-09-26
     * against a name that does not exist: HTTP 200, 9,855 bytes, no
     * `tgme_widget_message` block anywhere, and none of Telegram's "doesn't
     * exist" wording.
     *
     * So this was previously reported as MARKUP_UNRECOGNISED, which blamed our
     * parser for somebody else's absent channel and would have sent an operator
     * looking for a parsing bug.
     *
     * It is reported as PREVIEW_UNAVAILABLE and NOT as CHANNEL_NOT_FOUND,
     * because Telegram serves this identical page for at least three different
     * situations — no such name, a name that belongs to a user rather than a
     * channel, and a real channel that publishes no preview. This surface cannot
     * tell them apart, so it says so instead of picking the most likely one.
     */
    if (/\btgme_page_(?:title|description|photo|context)\b/i.test(html)
      && !/\btgme_channel_history\b/i.test(html)) {
      return fail('PREVIEW_UNAVAILABLE',
        'Telegram redirected to its generic contact page, which it serves for a name that does '
        + 'not exist, a name belonging to a user rather than a channel, AND a real channel that '
        + 'publishes no public preview. This surface cannot distinguish those three, so none is '
        + 'claimed. Nothing was read and no channel is recorded as empty');
    }
    /*
     * Nothing recognisable. Deliberately NOT reported as an empty channel: if
     * Telegram changes its markup, the honest answer is "we no longer understand
     * this page", and the wrong answer is a silent zero that looks like a
     * channel nobody posts in.
     */
    return fail('MARKUP_UNRECOGNISED',
      'the page rendered and contained no tgme_widget_message blocks. Either the preview markup '
      + 'changed or this is not a preview page; it is NOT an empty channel');
  }

  const title = firstByClass(html, 'tgme_channel_info_header_title');
  const counter = firstByClass(html, 'tgme_channel_info_counter');

  const messages: PreviewMessage[] = [];
  for (const block of blocks) {
    const post = /data-post="([^"]+)"/i.exec(block)?.[1] ?? '';
    const slash = post.lastIndexOf('/');
    if (slash <= 0) continue;

    const channel = post.slice(0, slash);
    const messageId = post.slice(slash + 1);
    /* An id that is not an id is skipped rather than coerced: one unusable
       message must not cost the other nineteen. */
    if (!/^\d+$/.test(messageId)) continue;

    const textFragment = firstByClass(block, 'tgme_widget_message_text');
    const text = textFragment ? visibleText(textFragment) : '';

    const datetime = /<time[^>]*datetime="([^"]+)"/i.exec(block)?.[1] ?? null;
    const published = datetime ? new Date(datetime) : null;

    const viewsRaw = firstByClass(block, 'tgme_widget_message_views', 'span');
    const viewsExact = viewsRaw
      ? /^(\d+)$/.exec(viewsRaw.replace(/[  \s,]/g, ''))
      : null;

    const replyHref = /<a[^>]*class="[^"]*tgme_widget_message_reply[^"]*"[^>]*href="([^"]+)"/i
      .exec(block)?.[1] ?? null;
    const replyId = replyHref ? /\/(\d+)(?:\?|#|$)/.exec(replyHref)?.[1] ?? null : null;

    const meta = firstByClass(block, 'tgme_widget_message_meta', 'span') ?? '';

    messages.push({
      messageId,
      channel,
      permalink: `https://t.me/${channel}/${messageId}`,
      text,
      publishedAt: published && Number.isFinite(published.getTime())
        ? published.toISOString()
        : null,
      /* Telegram shows the word and not the timestamp, so `edited` is a boolean
         and sourceUpdatedAt stays null. Guessing a time would be worse than
         admitting we only know that it happened. */
      edited: /\bedited\b/i.test(visibleText(meta)),
      authorName: (() => {
        const signed = firstByClass(block, 'tgme_widget_message_from_author', 'span')
          ?? firstByClass(block, 'tgme_widget_message_author', 'span');
        const name = signed ? visibleText(signed) : '';
        return name || null;
      })(),
      views: viewsExact ? Number(viewsExact[1]) : null,
      viewsLabel: viewsRaw ? (visibleText(viewsRaw) || null) : null,
      replyToMessageId: replyId,
      hasMedia: /tgme_widget_message_(photo|video|document|voice|sticker|poll)/i.test(block),
    });
  }

  if (messages.length === 0) {
    return fail('MARKUP_UNRECOGNISED',
      `${blocks.length} message block(s) were present and none carried a usable channel/id pair`);
  }

  const moreBefore = /class="[^"]*tme_messages_more[^"]*"[^>]*data-before="(\d+)"/i.exec(html)?.[1]
    ?? /data-before="(\d+)"[^>]*class="[^"]*tme_messages_more/i.exec(html)?.[1]
    ?? null;

  /* data-post is authoritative for which community this is. */
  const channelFromPosts = messages[0]?.channel ?? requestedChannel;

  return {
    outcome: 'OK',
    channel: {
      username: channelFromPosts,
      title: title ? visibleText(title) || null : null,
      numericIdAvailable: false,
      participants: parseParticipants(counter ? visibleText(counter) : null),
      participantsLabel: counter ? (visibleText(counter) || null) : null,
    },
    messages,
    nextCursor: moreBefore,
    truncated: moreBefore !== null,
    detail: `${messages.length} public post(s) read from the channel preview`
      + (moreBefore ? '; Telegram offers older posts' : '; Telegram offered no older posts')
      + '. Comments are not on this surface and were not read.',
  };
}

/**
 * The preview URL for a channel, optionally continuing backwards.
 *
 * Username validated rather than interpolated: a channel name is user-supplied
 * data reaching a URL, and Telegram's own rule is 5-32 characters of
 * alphanumerics and underscores.
 */
export function previewUrl(username: string, before?: string | null): string {
  const clean = String(username).trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9_]{4,32}$/.test(clean)) {
    throw new Error(`not a Telegram channel username: ${JSON.stringify(username)}`);
  }
  const base = `https://t.me/s/${clean}`;
  if (!before) return base;
  if (!/^\d+$/.test(String(before))) {
    throw new Error(`not a Telegram preview cursor: ${JSON.stringify(before)}`);
  }
  return `${base}?before=${before}`;
}
