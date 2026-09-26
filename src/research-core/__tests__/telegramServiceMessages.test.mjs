// TELEGRAM'S OWN BOOKKEEPING IS NOT EVIDENCE.
//
// "Channel created". "Channel photo updated". "The owner of this channel has been
// inactive for the last 5 months." Telegram renders each of these as a message
// block carrying a real `data-post` id, so every identity check in the reader
// passes and every one of them persisted into raw_signals as Community Evidence.
//
// MEASURED ON THE FIRST LIVE PRODUCTION RUN, 2026-09-26: eighteen rows written,
// NINE of them these. @tbilisiapartments contributed four and nothing else -- a
// channel that has published no posts at all reported four pieces of evidence, and
// the sync counted it as a READABLE, productive target.
//
// The markup below is real. It was fetched from https://t.me/s/tbilisiapartments
// and the class attribute is verbatim:
//
//   class="tgme_widget_message text_not_supported_wrap service_message js-widget_message"
//
// Two things that matters for:
//
//   Telegram LABELS them, so the filter reads the label rather than guessing from
//   the wording. A text heuristic would drop a genuine listing that mentioned a
//   channel photo, and would miss the identical notice rendered in Russian.
//
//   `service_message` shares one attribute with `text_not_supported_wrap` and
//   `js-widget_message`, so the match must be on the whole class TOKEN. A
//   substring match is the trap that once let `_header_title` match
//   `_header_title_wrap`.

import test from 'node:test';
import assert from 'node:assert/strict';

import { parsePreviewPage } from '../adapters/telegram/preview-parse.ts';

/** A real service block, class attribute exactly as Telegram served it. */
const serviceBlock = (id) => `
<div class="tgme_widget_message text_not_supported_wrap service_message js-widget_message" data-post="tbilisiapartments/${id}" data-view="eyJjIjotMTM4MjU0NzA5MH0">
  <div class="tgme_widget_message_user"><a href="https://t.me/tbilisiapartments"></a></div>
  <div class="tgme_widget_message_bubble">
    <div class="tgme_widget_message_text js-message_text">Channel created</div>
    <div class="tgme_widget_message_footer">
      <span class="tgme_widget_message_meta"><time datetime="2026-09-24T10:00:00+00:00"></time></span>
    </div>
  </div>
</div>`;

/** An ordinary post. No service_message token. */
const postBlock = (id, text) => `
<div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="tbilisikvartiri/${id}">
  <div class="tgme_widget_message_bubble">
    <div class="tgme_widget_message_text js-message_text">${text}</div>
    <div class="tgme_widget_message_footer">
      <span class="tgme_widget_message_meta">
        <time datetime="2026-09-25T08:30:00+00:00"></time>
        <span class="tgme_widget_message_views">1.2K</span>
      </span>
    </div>
  </div>
</div>`;

const page = (blocks, channel = 'tbilisiapartments') => `
<html><body>
  <div class="tgme_channel_info">
    <div class="tgme_channel_info_header_title"><span>${channel}</span></div>
    <div class="tgme_channel_info_counter"><span class="counter_value">1 234</span> subscribers</div>
  </div>
  <section class="tgme_channel_history">${blocks.join('\n')}</section>
</body></html>`;

/* ────────────────────────────────────────────────────────────────────────
 * The nine junk rows
 * ──────────────────────────────────────────────────────────────────────── */

test('a service notice is never returned as a message', () => {
  const result = parsePreviewPage(
    page([serviceBlock(1), postBlock(5, 'Продается 32-комнатный отель в Авлабари')]),
    'tbilisiapartments',
  );

  assert.equal(result.outcome, 'OK');
  assert.equal(result.messages.length, 1, 'only the real post is evidence');
  assert.equal(result.messages[0].messageId, '5');
  assert.equal(result.serviceMessages, 1, 'and the notice is counted, not silently dropped');
});

test('the count reaches the detail line, so an operator can see the ratio', () => {
  const result = parsePreviewPage(
    page([serviceBlock(1), serviceBlock(2), postBlock(5, 'Сдается двухкомнатная квартира')]),
    'tbilisiapartments',
  );
  assert.equal(result.serviceMessages, 2);
  assert.match(result.detail, /2 Telegram service notice\(s\) were skipped rather than stored/);
});

test('a page with no notices says nothing about them', () => {
  const result = parsePreviewPage(page([postBlock(5, 'Saburtalo / Marshal Gelovani')]), 'tbilisikvartiri');
  assert.equal(result.serviceMessages, 0);
  assert.doesNotMatch(result.detail, /service notice/);
});

/* ────────────────────────────────────────────────────────────────────────
 * A channel of nothing but notices is EMPTY, not unreadable
 * ──────────────────────────────────────────────────────────────────────── */

test('four notices and nothing else is PREVIEW_UNAVAILABLE, not MARKUP_UNRECOGNISED', () => {
  // This is literally @tbilisiapartments on 2026-09-26. Blaming the parser would
  // put a healthy public channel on the DEGRADED path; the channel is simply empty.
  const result = parsePreviewPage(
    page([serviceBlock(1), serviceBlock(2), serviceBlock(3), serviceBlock(4)]),
    'tbilisiapartments',
  );

  assert.equal(result.outcome, 'PREVIEW_UNAVAILABLE');
  assert.equal(result.messages.length, 0);
  assert.equal(result.serviceMessages, 4);
  assert.match(result.detail, /published nothing readable/);
  assert.match(
    result.detail,
    /not a failed read and not a parser problem/,
    'the reason must say whose problem it is not',
  );
});

test('an empty channel still reports the channel it read', () => {
  // Unlike every other non-OK outcome: the read SUCCEEDED, and the title and
  // subscriber count are real facts about a real channel.
  const result = parsePreviewPage(
    page([serviceBlock(1), serviceBlock(2)]),
    'tbilisiapartments',
  );

  assert.ok(result.channel, 'the channel is known and must not be thrown away');
  assert.equal(result.channel.username, 'tbilisiapartments');
  assert.equal(result.channel.participants, 1234);
  assert.equal(result.channel.numericIdAvailable, false);
});

test('unrecognised markup is still MARKUP_UNRECOGNISED when notices are only part of it', () => {
  // A page with a notice AND a block whose id is unusable is a parser problem
  // about that second block. The service filter must not swallow the distinction.
  const broken = '<div class="tgme_widget_message js-widget_message" data-post="chan/notanumber">'
    + '<div class="tgme_widget_message_text">text</div></div>';
  const result = parsePreviewPage(page([serviceBlock(1), broken]), 'tbilisiapartments');

  assert.equal(result.outcome, 'MARKUP_UNRECOGNISED');
  assert.match(result.detail, /1 were service notices/);
  assert.match(result.detail, /none of the rest carried a usable channel\/id pair/);
});

/* ────────────────────────────────────────────────────────────────────────
 * The class token, not a substring
 * ──────────────────────────────────────────────────────────────────────── */

test('a class merely CONTAINING the word is not a service message', () => {
  // `not_service_message` and `service_message_wrap` both contain the marker as a
  // substring and neither is Telegram's service flag. A substring match would
  // silently discard real posts -- the expensive direction of this mistake.
  for (const cls of ['not_service_message', 'service_message_wrap', 'xservice_message']) {
    const block = `<div class="tgme_widget_message ${cls} js-widget_message" data-post="tbilisikvartiri/9">`
      + '<div class="tgme_widget_message_text">Продается квартира</div>'
      + '<span class="tgme_widget_message_meta"><time datetime="2026-09-25T08:00:00+00:00"></time></span>'
      + '</div>';
    const result = parsePreviewPage(page([block]), 'tbilisikvartiri');
    assert.equal(result.outcome, 'OK', `${cls} must not be read as a service message`);
    assert.equal(result.messages.length, 1, `${cls} must not discard a real post`);
    assert.equal(result.serviceMessages, 0);
  }
});

test('the token is matched wherever it sits in the attribute', () => {
  // Telegram writes it third of four. It must also be caught first and last, or
  // the filter depends on Telegram never reordering its own class list.
  const positions = [
    'service_message tgme_widget_message js-widget_message',
    'tgme_widget_message js-widget_message service_message',
    'tgme_widget_message service_message',
  ];
  for (const cls of positions) {
    const block = `<div class="${cls}" data-post="tbilisiapartments/1">`
      + '<div class="tgme_widget_message_text">Channel created</div></div>';
    const result = parsePreviewPage(page([block, postBlock(7, 'real listing')]), 'tbilisiapartments');
    assert.equal(result.serviceMessages, 1, `not caught in position: ${cls}`);
    assert.equal(result.messages.length, 1);
  }
});

/* ────────────────────────────────────────────────────────────────────────
 * The real thing still gets through
 * ──────────────────────────────────────────────────────────────────────── */

test('the three real listings from production are still read', () => {
  // The posts that actually matter, verbatim from tbilisikvartiri on 2026-09-26.
  const real = [
    postBlock(5, 'Продается активный 32-х комнатный отель в Авлабари'),
    postBlock(16, '🌇 РАЙОН # Saburtalo/ Marshal Gelovani'),
    postBlock(20, 'Сдается двухкомнатная квартира в великолепном состоянии'),
  ];
  const result = parsePreviewPage(page([serviceBlock(1), ...real], 'tbilisikvartiri'), 'tbilisikvartiri');

  assert.equal(result.outcome, 'OK');
  assert.deepEqual(result.messages.map((m) => m.messageId), ['5', '16', '20']);
  assert.equal(result.serviceMessages, 1);
  assert.equal(
    new Set(result.messages.map((m) => m.messageId)).size,
    3,
    'three distinct native identities, which is what stops an edit becoming a second lead',
  );
});
