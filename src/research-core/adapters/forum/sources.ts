// HOMATCH RESEARCH CORE — the forum boards this repository knows how to read.
//
// One entry so far, and it is here because its robots.txt says we may.
//
// WHY NOT REDDIT, WHICH IS WHERE THE OLD SIGNALS CAME FROM
//
// 672 of the 868 raw_signals in production came from reddit.com, collected
// through Apify before the providers were retired. reddit.com/robots.txt is:
//
//   User-agent: *
//   Disallow: /
//
// with a note pointing at their Public Content Policy. There is no way to
// read it over plain HTTP that respects that file. The permitted route is
// Reddit's own API under credentials Homatch does not have, which puts it
// exactly where Telegram is — architecture ready, access absent — and it is
// recorded BLOCKED / ROBOTS_DISALLOWED in the registry rather than quietly
// dropped.
//
// The historical rows stay. They are the record of what was collected and
// when; deleting them would destroy that rather than correct it.

import type { ForumSourceConfig } from './board.ts';

/**
 * forum.ge — უძრავი ქონება, board 92.
 *
 * A Georgian discussion board, and the first live Demand surface in the
 * system. Its robots.txt states Crawl-delay: 2 — an explicit rate, given to
 * everyone, which is a good deal more than most of the property portals
 * offered. It disallows act=Print, act=Search, act=Online and act=Msg;
 * private messages are behind the last of those and nothing here goes near
 * them.
 *
 * WHAT IS ON IT
 *
 * Both sides. Threads titled "იყიდება ბინა ვაზისუბანში" (a flat for sale)
 * sit next to people asking what to watch out for when buying. That mixture
 * is the point: a board where only sellers post is a worse listing portal,
 * and a board where only buyers post does not exist. classifyDirection()
 * decides which each post is, and an UNKNOWN verdict is stored as UNKNOWN.
 *
 * POSTS ARE DELIMITED BY HTML COMMENTS
 *
 * The page writes "<!-- Begin Msg Number 14172410 -->" before each one. That
 * is deliberate and stable, and a better anchor than a CSS class someone will
 * rename — the lesson the portal family learned from anchoring on layout.
 *
 * AND THE GEORGIAN IS NUMERIC ENTITIES
 *
 * It serves &#4332; rather than ქ. A reader that only stripped tags would
 * hand the classifier a string of ampersands and conclude that every Georgian
 * post on a Georgian board was unclassifiable.
 */
export const FORUM_GE: ForumSourceConfig = {
  id: 'forum-ge',
  host: 'forum.ge',
  countryCode: 'GE',
  /*
   * The languages the board is written in, not the languages Homatch
   * supports. Georgian and Russian are both common here; the language of a
   * given post is DETECTED, never taken from this list.
   */
  languages: ['ka', 'ru', 'en'],
  boardUrl: { pattern: /forum\.ge\/\?(?:.*&)?showforum=(\d+)/i },
  topicUrl: { pattern: /forum\.ge\/\?(?:.*&)?showtopic=(\d+)/i, idGroup: 1 },
  postDelimiter: { pattern: /<!--\s*Begin Msg Number (\d+)\s*-->/i, idGroup: 1 },
  /*
   * THE POSTER'S NAME, not the word "profile".
   *
   * The first version matched showuser=<id>...>(text)< and got პროფილი for
   * every post on the board -- Georgian for "profile", the link label on the
   * profile button, which sits inside the same block and matched first.
   * Every author would have been the same person.
   *
   * The name is in its own span, which is what the board uses it for.
   */
  authorPattern: /class=['"]normalname['"][^>]*>\s*<a[^>]*>([^<]{2,40})</i,
  datePattern: /#\d+\s*·\s*([^·]{6,40})·/,
  boilerplate: [
    /*
     * The ignore notice appears in every post block belonging to a member
     * the reader has muted, and it is the board talking, not the poster.
     * Left in, the lexicon would see it in a large fraction of posts and the
     * phrase would look like a property term.
     */
    /ამ ფორუმელის პოსტინგები გაქვთ იგნორირებული[^·]*/g,
    /*
     * The post's own header line -- "#14172410 · 7 Jun 2009, 14:11 ·" -- which
     * the reader has already turned into publishedAt. Left in the text it
     * would reach the classifier and the fingerprint, and a fingerprint that
     * includes a post id can never match the same text quoted elsewhere.
     */
    /#\d+\s*·?\s*/g,
    /·?\s*\d{1,2}\s+[A-Za-z]{3,}\s+\d{4},\s*\d{1,2}:\d{2}\s*·?/g,
    /* Post chrome: profile, private message, chat, quote, group, member no. */
    /·\s*(პროფილი|პირადი მიმოწერა|ჩატი|ციტირება|\^)\s*/g,
    /ჯგუფი:\s*\S+/g,
    /წერილები:\s*\d+/g,
    /წევრი No\.:\s*\d+/g,
    /რეგისტრ\.:\s*[\d-]+\w*\s*\d*/g,
  ],
};

export const FORUM_SOURCES: readonly ForumSourceConfig[] = [FORUM_GE];

export function forumSourceById(id: string): ForumSourceConfig | null {
  return FORUM_SOURCES.find((source) => source.id === id) ?? null;
}
