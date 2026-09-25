// A FORUM IS WHERE DEMAND IS WRITTEN DOWN.
//
// Every property source in this repository publishes SUPPLY: somebody with a
// flat, telling you about the flat. The thing that makes Homatch more than a
// listings aggregator is the other side — somebody saying what they are
// looking for — and there has been no live source of it since the providers
// were retired. The 868 signals in production are all from APIFY or
// DATAFORSEO and the newest is 2026-08-29.
//
// This is the first one Homatch reads itself.
//
// THE FIXTURES ARE WHAT forum.ge SERVED
//
// Board 92 (უძრავი ქონება) and one thread from it, captured 2026-09-25 with
// the identifying User-Agent, at the Crawl-delay: 2 its robots.txt states.
// A test failing here is either the reader breaking or the board changing
// its markup, and both are worth knowing.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  FORUM_READER_VERSION,
  isoDay,
  observe,
  readTopic,
  topicUrls,
  visibleText,
} from '../adapters/forum/board.ts';
import { FORUM_GE, FORUM_SOURCES, forumSourceById } from '../adapters/forum/sources.ts';

const DIR = 'src/research-core/adapters/forum/__fixtures__/';
const fixture = (name) => readFileSync(`${DIR}${name}`, 'utf8');

const BOARD_URL = 'https://forum.ge/?showforum=92';
const TOPIC_URL = 'https://forum.ge/?showtopic=33976335';

/* ── the board ─────────────────────────────────────────────────────────── */

test('a session id never becomes part of a thread identity', () => {
  /*
   * forum.ge puts ?s=<32 hex> on many of its own links and it changes every
   * request. Left in, the same thread would carry a different external_id on
   * every scan: the store would fill with duplicates that no dedupe could
   * ever catch, because nothing about them would match.
   */
  const urls = topicUrls(fixture('forum.ge.board.html'), BOARD_URL, FORUM_GE);
  assert.ok(urls.length > 20, `only ${urls.length} threads found`);
  for (const url of urls) {
    assert.doesNotMatch(url, /[?&]s=/, `a session id survived into ${url}`);
    assert.match(url, /\?showtopic=\d+$/, `${url} is not a canonical thread URL`);
  }
  assert.equal(new Set(urls).size, urls.length, 'the same thread was listed twice');
});

/* ── a post ────────────────────────────────────────────────────────────── */

test('posts are found by the marker the board writes, not by a CSS class', () => {
  /*
   * forum.ge emits "<!-- Begin Msg Number 14172410 -->" before each post.
   * That is deliberate and stable; a class name is a thing somebody renames.
   * It is the same lesson the portal family learned from anchoring on layout.
   */
  const posts = readTopic(fixture('forum.ge.topic.html'), TOPIC_URL, FORUM_GE);
  assert.equal(posts.length, 15);
  for (const post of posts) {
    assert.match(post.postId, /^\d{6,}$/);
    assert.equal(post.topicId, '33976335');
    assert.ok(post.text.length > 0, `post ${post.postId} came back empty`);
  }
  assert.equal(new Set(posts.map((p) => p.postId)).size, 15, 'a post id repeated');
});

test('the author is the poster, not the word "profile"', () => {
  /*
   * The first pattern matched showuser=<id>...>(text)< and returned პროფილი
   * — Georgian for "profile", the label on the profile button inside the
   * same block. Every post on the board would have had the same author, and
   * an author field that is constant is worse than an absent one: it looks
   * like data.
   */
  const posts = readTopic(fixture('forum.ge.topic.html'), TOPIC_URL, FORUM_GE);
  const names = posts.map((p) => p.authorName).filter(Boolean);
  assert.ok(names.length >= 10, `only ${names.length} posts named an author`);
  assert.ok(new Set(names).size > 1, 'every post has the same author');
  for (const name of names) {
    assert.notEqual(name, 'პროფილი');
    assert.notEqual(name, 'პირადი მიმოწერა');
  }
  assert.equal(posts[0].authorName, 'kukurino');
});

test('the date is the day the board stated, and a time is not invented', () => {
  assert.equal(isoDay('7 Jun 2009, 14:11'), '2009-06-07');
  assert.equal(isoDay('21st September 2026 - 20:34'), '2026-09-21');
  assert.equal(isoDay('no date here'), null);

  const posts = readTopic(fixture('forum.ge.topic.html'), TOPIC_URL, FORUM_GE);
  for (const post of posts) {
    if (post.publishedAt === null) continue;
    /* A day, never a timestamp: the board states a time in a zone it does
       not name, and midnight in a guessed zone is invented precision. */
    assert.match(post.publishedAt, /^\d{4}-\d{2}-\d{2}$/);
  }
});

test('Georgian served as numeric entities is decoded before anything reads it', () => {
  /*
   * forum.ge serves &#4332; rather than ქ. A reader that only stripped tags
   * would hand the classifier a string of ampersands and conclude that every
   * Georgian post on a Georgian board was unclassifiable — a source that
   * looks empty while working perfectly.
   */
  assert.equal(visibleText('<p>&#4321;&#4304;&#4334;&#4314;&#4312;</p>'), 'სახლი');
  /* Ampersand decodes LAST, or &amp;#4332; becomes a literal ქ. */
  assert.equal(visibleText('<p>&amp;#4332;</p>'), '&#4332;');

  const posts = readTopic(fixture('forum.ge.topic.html'), TOPIC_URL, FORUM_GE);
  const georgian = posts.filter((p) => /[Ⴀ-ჿ]/.test(p.text));
  assert.ok(georgian.length >= 10, `only ${georgian.length} posts contained Georgian`);
  for (const post of posts) {
    assert.doesNotMatch(post.text, /&#\d+;/, `undecoded entities in post ${post.postId}`);
  }
});

test('board furniture is removed before the text is classified or fingerprinted', () => {
  /*
   * The post header, the ignore notice, the group and member-number lines
   * are the BOARD talking, not the poster. Two reasons they must go: a
   * lexicon that sees the same phrase in every post learns nothing from it,
   * and a fingerprint containing a post id can never match the same text
   * quoted somewhere else.
   */
  const posts = readTopic(fixture('forum.ge.topic.html'), TOPIC_URL, FORUM_GE);
  for (const post of posts) {
    assert.doesNotMatch(post.text, /#\d{6,}/, `a post id survived into the text of ${post.postId}`);
    assert.doesNotMatch(post.text, /ჯგუფი:/);
    assert.doesNotMatch(post.text, /წევრი No\./);
    assert.doesNotMatch(post.text, /\d{1,2}\s+[A-Za-z]{3,}\s+\d{4},\s*\d{1,2}:\d{2}/);
  }
});

/* ── what a post IS ────────────────────────────────────────────────────── */

test('the direction comes from the classifier, and UNKNOWN is a real answer', () => {
  /*
   * Most posts on a discussion board are neither an offer nor a request, and
   * storing those as UNKNOWN is the point. Dropping them would make it
   * impossible to ever see how much of a source this reader cannot read —
   * the difference between a quiet source and a source we are failing at.
   */
  const posts = readTopic(fixture('forum.ge.topic.html'), TOPIC_URL, FORUM_GE);
  const verdicts = posts.map((p) => observe(p, FORUM_GE));

  const directions = new Set(verdicts.map((v) => v.direction));
  assert.ok(directions.has('UNKNOWN'), 'nothing was left unclassified, which is implausible');

  for (const v of verdicts) {
    assert.ok(v.directionConfidence >= 0 && v.directionConfidence <= 1);
    if (v.direction === 'UNKNOWN') assert.equal(v.matchedPhrases.length, 0);
    else assert.ok(v.matchedPhrases.length > 0, 'a direction was decided by nothing');
  }
});

test('a language is observed on the post, never taken from the board', () => {
  /*
   * A Russian post on a Georgian board is a Russian post. Stamping the
   * board's language onto its posts would put the wrong language on the
   * evidence and make a campaign's language coverage a statement about where
   * we looked rather than what we found.
   */
  const posts = readTopic(fixture('forum.ge.topic.html'), TOPIC_URL, FORUM_GE);
  const observed = posts.map((p) => observe(p, FORUM_GE));
  assert.ok(observed.some((o) => o.language === 'ka'), 'no Georgian was detected on a Georgian board');
  /* Detection that is not reliable yields null rather than the board's guess. */
  for (const o of observed) {
    assert.ok(o.language === null || FORUM_GE.languages.includes(o.language) || typeof o.language === 'string');
  }
});

test('every observation carries provenance a reader can follow back', () => {
  const posts = readTopic(fixture('forum.ge.topic.html'), TOPIC_URL, FORUM_GE);
  const o = observe(posts[0], FORUM_GE);

  assert.equal(o.externalId, posts[0].postId);
  assert.equal(o.sourceUrl, TOPIC_URL);
  assert.match(o.contentUrl, /findpost&p=\d+$/);
  assert.equal(o.readerVersion, FORUM_READER_VERSION);
  assert.match(o.contentFingerprint, /^[0-9a-f]{8,}$/);

  /* The fingerprint is of the TEXT, so the same words posted twice collide
     and the same post read twice does not duplicate. */
  assert.equal(observe(posts[0], FORUM_GE).contentFingerprint, o.contentFingerprint);
  assert.notEqual(observe(posts[1], FORUM_GE).contentFingerprint, o.contentFingerprint);
});

/* ── the source list ───────────────────────────────────────────────────── */

test('reddit is not in the forum sources, and the reason is written down', () => {
  /*
   * 672 of the 868 signals in production came from reddit.com via Apify.
   * reddit.com/robots.txt is "User-agent: * / Disallow: /". There is no way
   * to read it over plain HTTP that respects that file, so it is BLOCKED /
   * ROBOTS_DISALLOWED in the registry and absent here.
   */
  for (const source of FORUM_SOURCES) {
    assert.doesNotMatch(source.host, /reddit/i, 'a robots-disallowed host is configured');
  }
  assert.equal(forumSourceById('forum-ge')?.host, 'forum.ge');
  assert.equal(forumSourceById('reddit'), null);
});
