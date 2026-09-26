// READING A PUBLIC TELEGRAM CHANNEL PREVIEW.
//
// THE MARKUP IN THIS FILE IS NOT INVENTED. Every class name, attribute and
// nesting pattern below was taken from a live fetch of https://t.me/s/telegram on
// 2026-09-26, which returned 127,695 bytes containing 20 `data-post` blocks. The
// parser was then run against that real page and produced 20 messages with 20
// distinct native ids, no missing text and no missing timestamps.
//
// That matters because of a mistake this repository has made three times: a
// fixture that describes the shape the author imagined rather than the shape the
// source sends. So the fixtures here are minimal, and they are minimal COPIES of
// something real rather than sketches.
//
// Two live findings are pinned as tests below, because both were wrong first:
//
//   Telegram's class names nest as prefixes —
//   `tgme_channel_info_header_title_wrap` contains
//   `tgme_channel_info_header_title` — so substring matching returned the
//   wrapper and glued a verified badge onto the channel title.
//
//   The preview publishes view counts as "1.48M". Expanding that would invent
//   five digits Telegram never gave.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parsePreviewPage, previewUrl } from '../adapters/telegram/preview-parse.ts';

/** One message block, shaped as the live page shapes it. */
const message = ({
  channel = 'tbilisi_realty', id = '1234', text = 'Looking for a 2BR in Vake up to $180k',
  datetime = '2026-09-26T08:15:00+00:00', views = '1.48M', edited = false,
  reply = null, media = false,
} = {}) => `
<div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="${channel}/${id}">
  ${reply ? `<a class="tgme_widget_message_reply" href="https://t.me/${channel}/${reply}">
     <div class="tgme_widget_message_author_name">Someone</div></a>` : ''}
  ${media ? '<a class="tgme_widget_message_photo_wrap" style="background-image:url()"></a>' : ''}
  <div class="tgme_widget_message_text js-message_text" dir="auto">${text}</div>
  <div class="tgme_widget_message_footer compact js-message_footer">
    <span class="tgme_widget_message_meta">
      <span class="tgme_widget_message_views">${views}</span>
      ${edited ? '<span class="tgme_widget_message_meta_edited">edited</span>' : ''}
      <a class="tgme_widget_message_date" href="https://t.me/${channel}/${id}">
        <time datetime="${datetime}" class="time">08:15</time></a>
    </span>
  </div>
</div>`;

/** The channel header, with the prefix-nested wrapper the live page really has. */
const header = (title = 'Tbilisi Realty', counter = '9.47M subscribers') => `
<div class="tgme_channel_info">
  <div class="tgme_channel_info_header">
    <div class="tgme_channel_info_header_title_wrap">
      <div class="tgme_channel_info_header_title"><span dir="auto">${title}</span></div>
      <i class="verified-icon">✔</i>
    </div>
  </div>
  <div class="tgme_channel_info_counters">
    <div class="tgme_channel_info_counter"><span class="counter_value">${counter.split(' ')[0]}</span>
      <span class="counter_type">${counter.split(' ').slice(1).join(' ')}</span></div>
  </div>
</div>`;

const page = (body, more = null) => `<!DOCTYPE html><html><body>
  ${header()}
  <section class="tgme_channel_history js-message_history">${body}
    ${more ? `<a class="tme_messages_more js-messages_more" data-before="${more}"
       href="/s/tbilisi_realty?before=${more}">Load more</a>` : ''}
  </section></body></html>`;

test('native identity comes out of data-post', () => {
  /*
   * The reason this surface is worth having. data-post is `<channel>/<messageId>`
   * — Telegram's own identity — so a preview message is storable with a stable id
   * on the very first read. meta-platform.ts had to hash text for want of this.
   */
  const result = parsePreviewPage(page(message({ id: '9001' })), 'tbilisi_realty');

  assert.equal(result.outcome, 'OK');
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].messageId, '9001');
  assert.equal(result.messages[0].channel, 'tbilisi_realty');
  assert.equal(result.messages[0].permalink, 'https://t.me/tbilisi_realty/9001');
});

test('data-post wins over the channel we asked for', () => {
  /*
   * A redirect or a renamed channel would otherwise file evidence under the wrong
   * community. Telegram says which channel the message belongs to; the URL we
   * typed is only what we asked for.
   */
  const result = parsePreviewPage(page(message({ channel: 'actual_channel' })), 'what_we_asked_for');
  assert.equal(result.messages[0].channel, 'actual_channel');
  assert.equal(result.channel.username, 'actual_channel');
});

test('the channel title is not glued to the verified badge', () => {
  /*
   * THE LIVE BUG. `tgme_channel_info_header_title` is a substring of
   * `tgme_channel_info_header_title_wrap`, so substring matching returned the
   * wrapper and the title came back as "Telegram News ✔". Same trap as matching
   * `дом` inside `рядом`: a class attribute is a token list.
   */
  const result = parsePreviewPage(page(message()), 'tbilisi_realty');
  assert.equal(result.channel.title, 'Tbilisi Realty');
  assert.equal(result.channel.title.includes('✔'), false);
});

test('a rounded count is never expanded into precision Telegram did not give', () => {
  /* Measured live: the preview shows "1.48M" views and "9.47M subscribers". */
  const result = parsePreviewPage(page(message({ views: '1.48M' })), 'tbilisi_realty');

  assert.equal(result.messages[0].views, null, '1.48M was expanded into a fabricated integer');
  assert.equal(result.messages[0].viewsLabel, '1.48M',
    'the label is missing, so null would read as "Telegram published no view count"');
  assert.equal(result.channel.participants, null);
  assert.match(result.channel.participantsLabel, /9\.47M/);
});

test('an exact count IS taken as a number', () => {
  const result = parsePreviewPage(page(message({ views: '812' })), 'tbilisi_realty');
  assert.equal(result.messages[0].views, 812);
  assert.equal(result.messages[0].viewsLabel, '812');
});

test('published time comes from the datetime attribute, as UTC', () => {
  const result = parsePreviewPage(
    page(message({ datetime: '2026-09-26T08:15:00+04:00' })), 'tbilisi_realty',
  );
  assert.equal(result.messages[0].publishedAt, '2026-09-26T04:15:00.000Z');
});

test('edited is a boolean, because the preview shows the word and not the time', () => {
  const plain = parsePreviewPage(page(message({ edited: false })), 'tbilisi_realty');
  assert.equal(plain.messages[0].edited, false);

  const edited = parsePreviewPage(page(message({ edited: true })), 'tbilisi_realty');
  assert.equal(edited.messages[0].edited, true);
  /* And no timestamp is invented for it: sourceUpdatedAt stays null upstream,
     because "we know it happened" is all the page tells us. */
});

test('a reply links to its parent by native id', () => {
  const result = parsePreviewPage(page(message({ id: '500', reply: '499' })), 'tbilisi_realty');
  assert.equal(result.messages[0].replyToMessageId, '499');
});

test('media is recorded as metadata and nothing is downloaded', () => {
  const result = parsePreviewPage(page(message({ media: true })), 'tbilisi_realty');
  assert.equal(result.messages[0].hasMedia, true);
  assert.equal(parsePreviewPage(page(message({ media: false })), 'x').messages[0].hasMedia, false);
});

test('the cursor is Telegram\'s own load-more token', () => {
  const result = parsePreviewPage(page(message({ id: '1200' }), '1200'), 'tbilisi_realty');
  assert.equal(result.nextCursor, '1200');
  assert.equal(result.truncated, true);
  assert.match(result.detail, /offers older posts/);

  const end = parsePreviewPage(page(message()), 'tbilisi_realty');
  assert.equal(end.nextCursor, null);
  assert.equal(end.truncated, false);
  assert.match(end.detail, /offered no older posts/);
});

test('twenty blocks parse to twenty distinct messages', () => {
  /* The live page returned exactly this: 20 blocks, 20 distinct ids. */
  const body = Array.from({ length: 20 }, (_, i) => message({ id: String(400 + i) })).join('\n');
  const result = parsePreviewPage(page(body, '400'), 'tbilisi_realty');
  assert.equal(result.messages.length, 20);
  assert.equal(new Set(result.messages.map((m) => m.messageId)).size, 20);
  assert.equal(result.messages.filter((m) => !m.text).length, 0);
  assert.equal(result.messages.filter((m) => !m.publishedAt).length, 0);
});

/* ── every non-content outcome is named ──────────────────────────────────── */

test('a private channel is CHANNEL_PRIVATE, never an empty channel', () => {
  const html = '<html><body><div class="tgme_page_additional">'
    + 'This channel is private. If you have the invite link, please open this link.'
    + '</div></body></html>';
  const result = parsePreviewPage(html, 'secret_group');

  assert.equal(result.outcome, 'CHANNEL_PRIVATE');
  assert.deepEqual(result.messages, []);
  /* And it says plainly that we do not go further. */
  assert.match(result.detail, /access control/);
});

test('a missing channel is CHANNEL_NOT_FOUND', () => {
  const html = "<html><body><div>Sorry, this user doesn't exist.</div></body></html>";
  const result = parsePreviewPage(html, 'no_such_channel');
  assert.equal(result.outcome, 'CHANNEL_NOT_FOUND');
  assert.match(result.detail, /no channel @no_such_channel/);
});

test('a channel with no public preview is PREVIEW_UNAVAILABLE, not empty', () => {
  const html = '<html><body><div>Preview is not available for this channel.</div></body></html>';
  const result = parsePreviewPage(html, 'quiet_channel');
  assert.equal(result.outcome, 'PREVIEW_UNAVAILABLE');
  assert.match(result.detail, /property of the channel/);
});

test('THE CONTACT PAGE is PREVIEW_UNAVAILABLE and claims nothing more', () => {
  /*
   * FOUND BY A LIVE READ, 2026-09-26. `t.me/s/<name>` 302s to `t.me/<name>`
   * whenever there is no preview, and that page is the generic "Contact @name"
   * card: HTTP 200, 9,855 bytes, no message block, and none of Telegram's
   * "doesn't exist" wording. It was previously reported MARKUP_UNRECOGNISED,
   * which blamed our parser for somebody else's absent channel.
   *
   * It must NOT be CHANNEL_NOT_FOUND either: Telegram serves this same page for a
   * missing name, a user account, and a real channel with no preview. The surface
   * cannot tell them apart, so the outcome says so rather than guessing.
   */
  const html = '<html><head><meta property="og:title" content="Telegram: Contact @nobody"></head>'
    + '<body><div class="tgme_page"><div class="tgme_page_photo"></div>'
    + '<div class="tgme_page_title"><span dir="auto">@nobody</span></div>'
    + '<div class="tgme_page_description">If you have Telegram, you can contact @nobody right away.</div>'
    + '<a class="tgme_action_button_new">Send Message</a></div></body></html>';

  const result = parsePreviewPage(html, 'nobody');
  assert.equal(result.outcome, 'PREVIEW_UNAVAILABLE');
  assert.notEqual(result.outcome, 'MARKUP_UNRECOGNISED');
  assert.notEqual(result.outcome, 'CHANNEL_NOT_FOUND');
  assert.match(result.detail, /cannot distinguish those three/);
  assert.match(result.detail, /no channel is recorded as empty/);
});

test('a real preview page is still not mistaken for the contact page', () => {
  /* The contact-page rule must not fire on a page that has history. */
  const result = parsePreviewPage(page(message()), 'tbilisi_realty');
  assert.equal(result.outcome, 'OK');
});

test('a rate limit is RATE_LIMITED, not zero results', () => {
  const html = '<html><body><h1>Too Many Requests</h1><p>Retry later</p></body></html>';
  const result = parsePreviewPage(html, 'busy');
  assert.equal(result.outcome, 'RATE_LIMITED');
  assert.deepEqual(result.messages, []);
});

test('UNFAMILIAR MARKUP IS NOT AN EMPTY CHANNEL', () => {
  /*
   * The most important failure in the file. If Telegram changes its markup, the
   * honest answer is "we no longer understand this page". A silent zero would
   * look exactly like a channel nobody posts in, and the registry would quietly
   * record a productive source as dead.
   */
  const html = '<html><body><main><article>Some entirely different page</article></main></body></html>';
  const result = parsePreviewPage(html, 'tbilisi_realty');

  assert.equal(result.outcome, 'MARKUP_UNRECOGNISED');
  assert.match(result.detail, /NOT an empty channel/);
});

test('a block with an unusable id costs that block and no other', () => {
  const body = [
    message({ id: '100' }),
    '<div class="tgme_widget_message" data-post="tbilisi_realty/not-a-number"></div>',
    message({ id: '102' }),
  ].join('\n');
  const result = parsePreviewPage(page(body), 'tbilisi_realty');
  assert.equal(result.outcome, 'OK');
  assert.deepEqual(result.messages.map((m) => m.messageId), ['100', '102']);
});

/* ── the URL ─────────────────────────────────────────────────────────────── */

test('the preview URL validates the username instead of interpolating it', () => {
  assert.equal(previewUrl('tbilisi_realty'), 'https://t.me/s/tbilisi_realty');
  assert.equal(previewUrl('@tbilisi_realty'), 'https://t.me/s/tbilisi_realty');
  assert.equal(previewUrl('tbilisi_realty', '400'), 'https://t.me/s/tbilisi_realty?before=400');

  /* A channel name is data reaching a URL. Telegram's own rule is alphanumerics
     and underscores, so anything else is refused rather than escaped. */
  for (const bad of ['a/../b', 'chan?before=1', 'chan#x', 'has space', 'abc', '', 'x'.repeat(40)]) {
    assert.throws(() => previewUrl(bad), /not a Telegram channel username/,
      `${JSON.stringify(bad)} was accepted into a URL`);
  }
  assert.throws(() => previewUrl('tbilisi_realty', 'DROP TABLE'), /not a Telegram preview cursor/);
});

test('the parser opens no socket', () => {
  /* It takes HTML. That is what makes it testable against saved markup and what
     stops it being the thing that accidentally reaches something private. */
  const source = readFileSync('src/research-core/adapters/telegram/preview-parse.ts', 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'http.get', 'axios']) {
    assert.equal(code.includes(forbidden), false, `the parser reaches for ${forbidden}`);
  }
});
