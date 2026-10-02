// PHASE 2 provenance — a Find Property result opens its EXACT source, names its
// channel and author as the source gave them, carries the post as written
// (public contacts included), and never offers a link that is not a real
// http(s) URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { forumProfileUrl, safeWebUrl, telegramChannelUrl } from '../discovery/source-link.ts';
import { ORIGINAL_TEXT_LIMIT, attributionFor, rawSignalIdOf } from '../discovery/attribution.ts';
import { observe, readTopic } from '../adapters/forum/board.ts';
import { FORUM_GE } from '../adapters/forum/sources.ts';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'adapters', 'forum', '__fixtures__');

test('URL safety: only absolute http(s) without credentials; every other scheme refused', () => {
  for (const ok of ['https://t.me/udzravi_qoneba/1234', 'http://forum.ge/?showtopic=1&view=findpost&p=2', 'https://home.ss.ge/ka/udzravi-qoneba/x-123456']) {
    assert.ok(safeWebUrl(ok), ok);
  }
  for (const bad of [
    "javascript:paste('kukurino')", 'JavaScript:alert(1)', ' javascript:alert(1)', 'data:text/html,<b>x</b>',
    'signal:6f1c', 'vbscript:x', 'file:///etc/passwd', 'ftp://host/x', 'mailto:a@b.ge', 'tel:+995599123456',
    'tg://resolve?domain=x', 'viber://chat?number=1', '//t.me/x', '/relative/path', 'https://user:pw@evil.example/',
    '', null, undefined, 42, `https://x.ge/${'a'.repeat(2100)}`,
  ]) {
    assert.equal(safeWebUrl(bad), null, String(bad).slice(0, 40));
  }
});

test('Telegram: the channel is read from the exact permalink, never invented', () => {
  assert.equal(telegramChannelUrl('https://t.me/moonlightbatumi2023/4521'), 'https://t.me/moonlightbatumi2023');
  assert.equal(telegramChannelUrl('https://t.me/s/udzravi_qoneba'), 'https://t.me/udzravi_qoneba');
  assert.equal(telegramChannelUrl('https://example.com/a/1'), null);
  assert.equal(telegramChannelUrl('javascript:x'), null);
});

/* Shaped like production raw_signals written by community-sync (2026-10-02). */
const TELEGRAM_SIGNAL = {
  platform: 'TELEGRAM',
  source_url: 'https://t.me/moonlightbatumi2023/4521',
  parent_url: null,
  author_public_name: '@konttin',
  author_public_url: 'https://t.me/konttin',
  profile_url: null,
  original_text: 'Сдается 2-комн. квартира в Батуми, 65 м², 700$/мес.\nЗвоните +995 599 12 34 56, WhatsApp wa.me/995599123456, @konttin',
};

test('Telegram result: exact post, channel, author and profile, and the post verbatim with its contacts', () => {
  const a = attributionFor({
    observation: { canonical_url: 'https://t.me/moonlightbatumi2023/4521', adapter_id: 'telegram-community' },
    signal: TELEGRAM_SIGNAL,
    source: { name: 'moonlightbatumi2023', url: 'https://t.me/' }, // a generic registry row must not win
  });
  assert.equal(a.platform, 'TELEGRAM');
  assert.equal(a.permalink, 'https://t.me/moonlightbatumi2023/4521', 'the exact message, not the channel');
  assert.equal(a.sourceUrl, 'https://t.me/moonlightbatumi2023');
  assert.equal(a.sourceName, 'moonlightbatumi2023');
  assert.equal(a.authorName, '@konttin');
  assert.equal(a.authorUrl, 'https://t.me/konttin');
  assert.equal(a.originalText, TELEGRAM_SIGNAL.original_text, 'public contacts are part of the source and are kept');
  assert.match(a.originalText, /\+995 599 12 34 56/);
  assert.match(a.originalText, /@konttin/);
  assert.equal(a.threadUrl, null);
});

test('Telegram channel post with no person behind it: no author is invented', () => {
  const a = attributionFor({
    observation: { canonical_url: 'https://t.me/udzravi_qoneba/77', adapter_id: 'telegram-community' },
    signal: { ...TELEGRAM_SIGNAL, source_url: 'https://t.me/udzravi_qoneba/77', author_public_name: null, author_public_url: null },
    source: null,
  });
  assert.equal(a.authorName, null);
  assert.equal(a.authorUrl, null);
  assert.equal(a.sourceUrl, 'https://t.me/udzravi_qoneba');
  assert.equal(a.sourceName, null, 'no registry name, so none is made up');
});

test('forum.ge: the board reader yields the exact post, its thread and the author profile (never javascript:)', () => {
  const html = readFileSync(join(DIR, 'forum.ge.topic.html'), 'utf8');
  const posts = readTopic(html, 'https://forum.ge/?showtopic=33976335', FORUM_GE);
  assert.equal(posts.length, 15);
  const byName = new Map();
  for (const post of posts) {
    const o = observe(post, FORUM_GE);
    assert.equal(o.contentUrl, `https://forum.ge/?showtopic=33976335&view=findpost&p=${post.postId}`, 'exact post anchor');
    assert.equal(o.sourceUrl, 'https://forum.ge/?showtopic=33976335');
    assert.match(o.authorUrl, /^https:\/\/forum\.ge\/\?showuser=\d+$/, 'canonical profile, no session id');
    assert.doesNotMatch(o.authorUrl, /javascript|[?&]s=/);
    if (byName.has(o.authorName)) assert.equal(byName.get(o.authorName), o.authorUrl, 'one author, one profile');
    byName.set(o.authorName, o.authorUrl);
  }
  assert.equal(byName.get('kukurino'), 'https://forum.ge/?showuser=90411');
  assert.equal(forumProfileUrl('https://forum.ge/?s=abc&showtopic=1', '90411'), 'https://forum.ge/?showuser=90411');
  assert.equal(forumProfileUrl('https://forum.ge/', 'x1'), null);
});

test('forum.ge result: exact post wins over the thread, which is kept as the thread link', () => {
  const a = attributionFor({
    observation: { canonical_url: 'https://forum.ge/?showtopic=33976335&view=findpost&p=14172410', adapter_id: 'forum-community' },
    signal: {
      platform: 'FORUM',
      source_url: 'https://forum.ge/?showtopic=33976335&view=findpost&p=14172410',
      parent_url: 'https://forum.ge/?showtopic=33976335',
      author_public_name: 'kukurino',
      author_public_url: 'https://forum.ge/?showuser=90411',
      original_text: 'ვყიდი ბინას ვაკეში, 85 მ², 120 000 $. ტელ: 599 12 34 56',
    },
    source: { name: 'forum.ge', url: 'https://forum.ge/' },
  });
  assert.equal(a.permalink, 'https://forum.ge/?showtopic=33976335&view=findpost&p=14172410');
  assert.equal(a.threadUrl, 'https://forum.ge/?showtopic=33976335');
  assert.equal(a.sourceUrl, 'https://forum.ge/');
  assert.equal(a.authorUrl, 'https://forum.ge/?showuser=90411');
  assert.match(a.originalText, /599 12 34 56/);
});

test('portal listing: exact listing URL, the site from the registry, no author or text invented', () => {
  const a = attributionFor({
    observation: { canonical_url: 'https://home.ss.ge/ka/udzravi-qoneba/iyideba-bina-36733497', adapter_id: 'ss-ge' },
    signal: null,
    source: { name: 'home.ss.ge', url: 'https://home.ss.ge' },
  });
  assert.equal(a.platform, 'PORTAL');
  assert.equal(a.permalink, 'https://home.ss.ge/ka/udzravi-qoneba/iyideba-bina-36733497');
  assert.equal(a.sourceUrl, 'https://home.ss.ge/');
  assert.equal(a.authorName, null);
  assert.equal(a.originalText, null);
});

test('unsafe links in stored provenance become no link; long text is capped, not dropped', () => {
  const a = attributionFor({
    observation: { canonical_url: 'signal:6f1c', adapter_id: 'telegram-community' },
    signal: { platform: 'TELEGRAM', source_url: 'javascript:alert(1)', author_public_url: "javascript:paste('x')", profile_url: 'data:text/html,x', original_text: 'x'.repeat(ORIGINAL_TEXT_LIMIT + 50) },
    source: { name: 'evil', url: 'javascript:void(0)' },
  });
  assert.equal(a.permalink, null);
  assert.equal(a.sourceUrl, null);
  assert.equal(a.authorUrl, null);
  assert.equal(a.originalText.length, ORIGINAL_TEXT_LIMIT);
  assert.equal(rawSignalIdOf({ rawSignalId: '7b0c3f7e-6c1d-4c7a-9f53-2a1d2b1e0f11' }), '7b0c3f7e-6c1d-4c7a-9f53-2a1d2b1e0f11');
  assert.equal(rawSignalIdOf({ rawSignalId: "1' or 1=1" }), null);
  assert.equal(rawSignalIdOf(null), null);
});
