// FIVE QUESTIONS, NOT ONE.
//
// The mistake this file guards is the one I made: reading "Meta removed the
// Groups API" and concluding "Facebook groups are out". Those are different
// claims. The API is gone AND some public group content is still served to an
// anonymous reader AND a member can see all of it in the app AND none of that
// makes a supported programmatic mechanism exist.
//
// Each of those facts implies a different next action, so each gets a different
// word. The tests below are mostly about keeping them apart — and about refusing
// to let an honest "we have not checked" quietly become a claim.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  ACQUISITION_MATRIX,
  ACQUISITION_VERIFIED_ON,
  modesFor,
  bestRoute,
  attemptableNow,
  platformSummary,
  permanentlyClosed,
} from '../social/acquisition.ts';

test('a surface can be UNAVAILABLE in one mode and reachable in another', () => {
  /*
   * The correction, as an assertion. Facebook group posts: the Graph API route
   * is gone, the public-web route sometimes works. A matrix that stored one
   * verdict per surface could not express this, and the product would have
   * written off a surface it can partly read.
   */
  const modes = modesFor('FACEBOOK', 'COMMUNITY_POSTS');
  const byMode = new Map(modes.map((m) => [m.mode, m.availability]));

  assert.equal(byMode.get('OFFICIAL_API'), 'UNAVAILABLE');
  assert.equal(byMode.get('PUBLIC_WEB'), 'RESTRICTED');
  assert.equal(byMode.get('AUTHORIZED_ACCOUNT'), 'NOT_PROGRAMMATICALLY_AVAILABLE');

  /* And the best route is the public one, not the removed one. */
  assert.equal(bestRoute('FACEBOOK', 'COMMUNITY_POSTS').mode, 'PUBLIC_WEB');
  assert.equal(permanentlyClosed('FACEBOOK').includes('COMMUNITY_POSTS'), false,
    'group posts were written off entirely, which is the error this matrix exists to prevent');
});

test('NOT_PROGRAMMATICALLY_AVAILABLE is not the same as UNAVAILABLE', () => {
  /*
   * UNAVAILABLE means the API was removed: nothing will change it, stop looking.
   * NOT_PROGRAMMATICALLY_AVAILABLE means a human can see this and no supported
   * mechanism exists: if the platform publishes one, the row changes and the
   * product does not. Collapsing them buries a real opportunity under a
   * permanent-sounding label.
   */
  const authorized = modesFor('FACEBOOK', 'COMMUNITY_POSTS')
    .find((m) => m.mode === 'AUTHORIZED_ACCOUNT');
  assert.equal(authorized.availability, 'NOT_PROGRAMMATICALLY_AVAILABLE');
  assert.notEqual(authorized.availability, 'UNAVAILABLE');
  /* And it must say WHY, including that we decline the only remaining route. */
  assert.match(authorized.evidence, /browser|web UI/i);
  assert.match(authorized.evidence, /prohibit|does not do/i);
});

test('no row proposes automating a login, a join or an anti-bot control', () => {
  /*
   * The compliance boundary, asserted over the whole matrix rather than trusted
   * to each row's author. "A member can see it" must never have become "so we
   * log in as them".
   */
  for (const row of ACQUISITION_MATRIX) {
    const text = `${row.evidence} ${row.requires.join(' ')}`;
    for (const forbidden of [/stored credential/i, /store.{0,12}password/i, /solve.{0,12}captcha/i,
      /bypass/i, /evade/i, /impersonat/i, /scrape around/i]) {
      assert.equal(forbidden.test(text), false,
        `${row.platform}/${row.surface}/${row.mode} proposes something out of bounds: ${text.slice(0, 120)}`);
    }
  }
});

test('automated group JOINING is never claimed, and joining is not read access', () => {
  const membership = modesFor('FACEBOOK', 'COMMUNITY_MEMBERSHIP');
  assert.ok(membership.length > 0, 'membership is not modelled at all');
  for (const row of membership) {
    assert.notEqual(row.availability, 'AVAILABLE',
      'a programmatic Facebook group join is claimed to be available');
  }
  /* The human-action workflow is representable, and its limit is stated. */
  const authorized = membership.find((m) => m.mode === 'AUTHORIZED_ACCOUNT');
  assert.ok(authorized.requires.some((r) => /person to join/i.test(r)));
  assert.match(authorized.evidence, /joining does not create a read mechanism/i);
});

test('UNVERIFIED is an admission and is never attemptable', () => {
  /*
   * Reddit and VK are UNVERIFIED: both publish real APIs, and I could not read
   * their current terms this session — reddit.com blocks our user agent, which
   * is itself informative. A matrix that guessed AVAILABLE would have a planner
   * scheduling jobs against credentials nobody provisioned.
   */
  assert.equal(attemptableNow('FORUM', 'COMMUNITY_POSTS'), false);
  assert.equal(attemptableNow('VK', 'COMMUNITY_POSTS'), false);

  const reddit = bestRoute('FORUM', 'COMMUNITY_POSTS');
  assert.equal(reddit.availability, 'UNVERIFIED');
  assert.match(reddit.evidence, /blocks our user agent/i,
    'the reason Reddit could not be verified is not recorded');
  assert.match(reddit.evidence, /not implemented/i,
    'the matrix does not say that anonymous scraping was declined');
  assert.ok(reddit.requires.length > 0, 'nothing is named that would move Reddit forward');
});

test('the only AVAILABLE surface is one we actually implemented', () => {
  /*
   * AVAILABLE means "works with configuration alone". Exactly one row qualifies
   * today — Telegram's public channel preview, which is an ordinary web page and
   * is already implemented. Everything else needs something provisioned,
   * approved or verified, and says so.
   */
  const available = ACQUISITION_MATRIX.filter((r) => r.availability === 'AVAILABLE');
  assert.deepEqual(
    available.map((r) => `${r.platform}/${r.surface}/${r.mode}`),
    ['TELEGRAM/COMMUNITY_POSTS/PUBLIC_WEB'],
    'the set of unconditionally-available surfaces changed; check it is really true',
  );
  assert.equal(attemptableNow('TELEGRAM', 'COMMUNITY_POSTS'), true);
});

test('liveVerified is separate from availability, and mostly false', () => {
  /*
   * Two different claims: the platform permitting something, and us having
   * proven we can do it. Only the second is ours to make, and today we have
   * proven very little — the public-web Meta reads and nothing else.
   */
  const verified = ACQUISITION_MATRIX.filter((r) => r.liveVerified);
  for (const row of verified) {
    assert.equal(row.mode, 'PUBLIC_WEB',
      `${row.platform}/${row.surface} claims live verification through ${row.mode}, which has no credentials`);
  }
  /* Nothing behind a credential or a review may claim live verification. */
  for (const row of ACQUISITION_MATRIX) {
    if (row.requires.some((r) => /App Review|credentials|token|Professional/i.test(r))) {
      assert.equal(row.liveVerified, false,
        `${row.platform}/${row.surface}/${row.mode} claims live verification while still needing ${row.requires.join(', ')}`);
    }
  }
});

test('Telegram comments are explicitly unreadable rather than silently empty', () => {
  /*
   * The preview page renders no discussion threads. Unstated, "the preview
   * returned no comments" would be recorded as "this channel has no discussion",
   * which is a false statement about the world.
   */
  const comments = modesFor('TELEGRAM', 'COMMUNITY_COMMENTS')
    .find((m) => m.mode === 'PUBLIC_WEB');
  assert.equal(comments.availability, 'NOT_PROGRAMMATICALLY_AVAILABLE');
  assert.match(comments.evidence, /must not be read as/i);
});

test('every row carries dated, checkable evidence', () => {
  assert.match(ACQUISITION_VERIFIED_ON, /^\d{4}-\d{2}-\d{2}$/);
  for (const row of ACQUISITION_MATRIX) {
    assert.ok(row.evidence.length > 60,
      `${row.platform}/${row.surface}/${row.mode} has stub evidence`);
    assert.equal(/TODO|TBD|probably|I think/i.test(row.evidence), false,
      `${row.platform}/${row.surface}/${row.mode} hedges`);
    /* A row that needs nothing must be AVAILABLE or closed — never RESTRICTED
       with no named requirement, which would be a gate nobody can pass. */
    if (row.availability === 'RESTRICTED') {
      assert.ok(row.requires.length > 0,
        `${row.platform}/${row.surface}/${row.mode} is RESTRICTED but names no requirement`);
    }
    if (row.availability === 'UNAVAILABLE') {
      assert.deepEqual(row.requires, [],
        `${row.platform}/${row.surface}/${row.mode} is UNAVAILABLE but asks for something`);
    }
  }
});

test('the platform summary is what an admin screen can render without lying', () => {
  const facebook = platformSummary('FACEBOOK');
  const posts = facebook.find((s) => s.surface === 'COMMUNITY_POSTS');
  assert.equal(posts.best, 'RESTRICTED');
  assert.equal(posts.modes.length, 3, 'the three Facebook group-post routes are not all shown');
  /* The requirements shown are the BEST route's, so an operator is told what to
     do about the route they could actually open. */
  assert.ok(posts.requires.length > 0);

  const search = facebook.find((s) => s.surface === 'KEYWORD_SEARCH');
  assert.equal(search.best, 'UNAVAILABLE');
  assert.deepEqual(search.requires, []);
});

test('the module declines the unsanctioned route in writing', () => {
  const source = readFileSync('src/research-core/social/acquisition.ts', 'utf8');
  /*
   * Comment markers stripped and whitespace collapsed before matching. The first
   * version of this test used a plain regex and failed on its own target: the
   * sentence it was looking for wraps across two comment lines, so `NOT a
   * supported mechanism` never appears contiguously in the file. The rule was
   * satisfied; the test could not see it.
   */
  const prose = source
    .replace(/^\s*\/\/ ?/gm, '')
    .replace(/[*/]/g, ' ')
    .replace(/\s+/g, ' ');

  assert.match(prose, /NOT a supported mechanism/);
  assert.match(prose, /do not automate the normal web UI/i);
  /* And the code itself contains no such mechanism. */
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const forbidden of ['puppeteer', 'playwright', 'cookie', 'setCookie', 'sessionid']) {
    assert.equal(code.toLowerCase().includes(forbidden.toLowerCase()), false,
      `the acquisition matrix reaches for ${forbidden}`);
  }
});
