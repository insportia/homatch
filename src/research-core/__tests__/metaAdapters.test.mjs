// Facebook and Instagram, as source adapters.
//
// The single most important assertion here is the login wall. Meta answers a
// blocked request with HTTP 200 and a login interstitial, so a scraper that
// does not recognise it reports "this group contained nothing" — a confident,
// plausible, false statement about the world. What it actually contains is
// plenty, and we could not see it.
//
// The rest is URL identity (so the same group is one source and not five),
// parent context (so a comment is a lead and not a fragment), and incremental
// re-scanning (so the second scan is cheap and produces no duplicates).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  FacebookAdapter,
  canonicalizeFacebookUrl,
  isFacebookSourceUrl,
  extractFacebookItems,
} from '../adapters/facebook.ts';
import {
  InstagramAdapter,
  canonicalizeInstagramUrl,
  isInstagramSourceUrl,
  extractInstagramItems,
} from '../adapters/instagram.ts';
import { detectWall, assessDocument } from '../adapters/meta-platform.ts';
import { AdapterRegistry, supports } from '../discovery/adapter.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const NOW = Date.parse('2026-09-18T12:00:00.000Z');

function context(pages, over = {}) {
  const fetched = [];
  return {
    fetched,
    ctx: {
      async fetchDocument(url) {
        fetched.push(url);
        const body = pages[url] ?? pages['*'] ?? '<html><body>Not found</body></html>';
        return {
          url,
          status: pages[url] === undefined && pages['*'] === undefined ? 404 : 200,
          body,
          contentType: 'text/html',
          retrievedAt: new Date(NOW).toISOString(),
          via: 'http',
        };
      },
      authenticatedSession: over.authenticatedSession ?? false,
      now: () => NOW,
      ...(over.renderDocument ? { renderDocument: over.renderDocument } : {}),
    },
  };
}

function groupSource(over = {}) {
  return {
    id: 'src1',
    platform: 'FACEBOOK',
    sourceType: 'FACEBOOK_GROUP',
    canonicalUrl: 'https://www.facebook.com/groups/tbilisi-housing/',
    externalId: null,
    name: 'Tbilisi Housing',
    countryCode: 'GE',
    city: 'Tbilisi',
    region: null,
    languages: ['ka', 'ru', 'en'],
    compatibleProfiles: [],
    propertyTerms: [],
    accessState: 'PUBLIC',
    active: true,
    discoveredAt: new Date(NOW - 86_400_000).toISOString(),
    lastScanAt: null,
    lastSuccessAt: null,
    cursor: null,
    chronological: false,
    failureCount: 0,
    lastFailureReason: null,
    productivity: [],
    ...over,
  };
}

const postPage = (posts) => `<html><head><title>Tbilisi Housing</title>
<script type="application/ld+json">${JSON.stringify(posts)}</script>
</head><body>content</body></html>`;

const POST = (over = {}) => ({
  '@type': 'SocialMediaPosting',
  url: over.url ?? 'https://www.facebook.com/groups/tbilisi-housing/posts/1',
  articleBody: over.text ?? 'Looking to buy a 2BR apartment in Vake, budget 150000 USD',
  datePublished: over.datePublished ?? '2026-09-17T10:00:00.000Z',
  author: { '@type': 'Person', name: over.author ?? 'A Person', url: 'https://www.facebook.com/someone/' },
  ...(over.comments ? { comment: over.comments } : {}),
});

/* ── Walls ────────────────────────────────────────────────────────────── */

test('a login interstitial is detected, not read as an empty group', () => {
  const html = '<html><body><h1>You must log in to continue</h1><a>Log into Facebook</a></body></html>';
  assert.equal(detectWall(html), 'LOGIN');
  assert.equal(assessDocument({ status: 200, body: html }).usable, false);
});

test('a private group is JOIN, which is a different answer from LOGIN', () => {
  // LOGIN means a session would help. JOIN means a human has to ask.
  assert.equal(detectWall('<html><body>This group is private. Ask to join.</body></html>'), 'JOIN');
  assert.equal(detectWall('<html><body>This account is private</body></html>'), 'JOIN');
});

test('walls are detected in Georgian and Russian too', () => {
  assert.equal(detectWall('<html><body>დახურული ჯგუფი</body></html>'), 'JOIN');
  assert.equal(detectWall('<html><body>закрытая группа</body></html>'), 'JOIN');
  assert.equal(detectWall('<html><body>войдите в facebook</body></html>'), 'LOGIN');
});

test('a scan behind a login wall FAILS with a reason rather than returning nothing', () => {
  const { ctx } = context({
    'https://www.facebook.com/groups/tbilisi-housing/':
      '<html><body>You must log in to continue</body></html>',
  });
  return new FacebookAdapter()
    .scan({ source: groupSource(), direction: 'DEMAND', cursor: null, limit: 20, includeComments: true }, ctx)
    .then((result) => {
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'LOGIN_WALL');
      assert.match(result.detail, /no authenticated research session/);
    });
});

test('a private group scan fails as JOIN_REQUIRED, which the access queue acts on', () => {
  const { ctx } = context({
    'https://www.facebook.com/groups/tbilisi-housing/':
      '<html><body>This group is private</body></html>',
  });
  return new FacebookAdapter()
    .scan({ source: groupSource(), direction: 'DEMAND', cursor: null, limit: 20, includeComments: true }, ctx)
    .then((result) => {
      assert.equal(result.ok, false);
      assert.equal(result.reason, 'JOIN_REQUIRED');
    });
});

test('with a connected session the failure detail says the session was refused', () => {
  const { ctx } = context(
    { 'https://www.facebook.com/groups/tbilisi-housing/': '<html><body>You must log in to continue</body></html>' },
    { authenticatedSession: true },
  );
  return new FacebookAdapter()
    .scan({ source: groupSource(), direction: 'DEMAND', cursor: null, limit: 20, includeComments: true }, ctx)
    .then((result) => {
      assert.match(result.detail, /connected session was not served/);
    });
});

/* ── URL identity ─────────────────────────────────────────────────────── */

test('the same Facebook group written five ways is one source', () => {
  const forms = [
    'https://www.facebook.com/groups/1234567890/',
    'https://facebook.com/groups/1234567890',
    'https://m.facebook.com/groups/1234567890/?ref=share',
    'https://www.facebook.com/groups/1234567890/?fbclid=abc123',
    'https://www.facebook.com/groups/1234567890/posts/999/',
  ];
  const canonical = new Set(forms.map((url) => canonicalizeFacebookUrl(url)));
  assert.equal(canonical.size, 1, [...canonical].join(' | '));
  assert.equal([...canonical][0], 'https://www.facebook.com/groups/1234567890/');
});

test('a reel and a post are the same Instagram object under two paths', () => {
  assert.equal(
    canonicalizeInstagramUrl('https://www.instagram.com/reel/ABC123/'),
    canonicalizeInstagramUrl('https://instagram.com/p/ABC123/?igshid=x'),
  );
});

test('a login page is not mistaken for a source', () => {
  assert.equal(canonicalizeFacebookUrl('https://www.facebook.com/login/'), null);
  assert.equal(canonicalizeInstagramUrl('https://www.instagram.com/accounts/login/'), null);
  assert.equal(isFacebookSourceUrl('https://example.com/groups/x'), false);
  assert.equal(isInstagramSourceUrl('https://example.com/p/x'), false);
});

test('the adapter registry routes a URL to the adapter that handles it', () => {
  const registry = new AdapterRegistry()
    .register(new FacebookAdapter())
    .register(new InstagramAdapter());

  assert.equal(registry.forUrl('https://www.facebook.com/groups/x123456/').id, 'facebook');
  assert.equal(registry.forUrl('https://www.instagram.com/p/ABC/').id, 'instagram');
  assert.equal(registry.forUrl('https://t.me/somechannel'), null);
  assert.equal(registry.forPlatform('INSTAGRAM').id, 'instagram');
});

test('adapters declare their capabilities rather than being assumed to have them', () => {
  const adapter = new FacebookAdapter();
  assert.equal(supports(adapter, 'scanIncremental'), true);
  assert.equal(supports(adapter, 'discover'), true);
});

/* ── Extraction and parent context ────────────────────────────────────── */

test('a post is extracted with its author, date and permalink', () => {
  const items = extractFacebookItems(postPage([POST()]), 'https://www.facebook.com/groups/tbilisi-housing/', false);
  assert.equal(items.length, 1);
  assert.equal(items[0].contentType, 'POST');
  assert.equal(items[0].publishedAt, '2026-09-17T10:00:00.000Z');
  assert.equal(items[0].authorName, 'A Person');
  assert.match(items[0].contentUrl, /posts\/1/);
});

test('a comment carries its parent URL and an excerpt of the parent', () => {
  // "Is this still available?" means nothing alone and a great deal under a
  // listing. The parent is the difference between a lead and a fragment.
  const page = postPage([
    POST({
      text: '2BR apartment for sale in Vake, 160000 USD, 80 sq.m',
      comments: [
        {
          '@type': 'Comment',
          text: 'Is this still available? Looking to buy',
          url: 'https://www.facebook.com/groups/tbilisi-housing/posts/1?comment_id=5',
          datePublished: '2026-09-17T11:00:00.000Z',
          author: { '@type': 'Person', name: 'Someone Else' },
        },
      ],
    }),
  ]);

  const items = extractFacebookItems(page, 'https://www.facebook.com/groups/tbilisi-housing/', true);
  const comment = items.find((item) => item.contentType === 'COMMENT');
  assert.ok(comment, 'the comment was not extracted');
  assert.match(comment.parentUrl, /posts\/1/);
  assert.match(comment.parentExcerpt, /for sale in Vake/);
});

test('comments are not extracted when the job did not ask for them', () => {
  const page = postPage([
    POST({ comments: [{ '@type': 'Comment', text: 'Interested', url: 'x' }] }),
  ]);
  const items = extractFacebookItems(page, 'https://www.facebook.com/groups/tbilisi-housing/', false);
  assert.equal(items.filter((item) => item.contentType === 'COMMENT').length, 0);
});

test('an Instagram caption is read from og:description when there is no JSON-LD', () => {
  const html = `<html><head>
    <meta property="og:description" content="Looking to buy a 2BR apartment in Vake, budget around 150000 USD, DM me">
  </head><body></body></html>`;
  const items = extractInstagramItems(html, 'https://www.instagram.com/p/ABC/', false);
  assert.equal(items.length, 1);
  assert.match(items[0].text, /Looking to buy/);
  // og tags carry no date, and inventing one from the crawl time would turn
  // "we found this today" into "this was posted today".
  assert.equal(items[0].publishedAt, null);
});

/* ── Incremental scanning and dedupe ──────────────────────────────────── */

test('a scan returns signals with the source, the direction and a cursor', () => {
  const url = 'https://www.facebook.com/groups/tbilisi-housing/';
  const { ctx } = context({ [url]: postPage([POST()]) });
  return new FacebookAdapter()
    .scan({ source: groupSource(), direction: 'DEMAND', cursor: null, limit: 20, includeComments: true }, ctx)
    .then((result) => {
      assert.equal(result.ok, true);
      assert.equal(result.value.signals.length, 1);
      assert.equal(result.value.signals[0].direction, 'DEMAND');
      assert.equal(result.value.signals[0].sourceUrl, url);
      assert.equal(result.value.cursor, '2026-09-17T10:00:00.000Z');
    });
});

test('a second scan with the cursor returns only what is new', () => {
  const url = 'https://www.facebook.com/groups/tbilisi-housing/';
  const page = postPage([
    POST({ url: `${url}posts/1`, datePublished: '2026-09-10T10:00:00.000Z' }),
    POST({ url: `${url}posts/2`, datePublished: '2026-09-17T10:00:00.000Z' }),
  ]);
  const { ctx } = context({ [url]: page });
  const adapter = new FacebookAdapter();

  return adapter
    .scan({ source: groupSource(), direction: 'DEMAND', cursor: null, limit: 20, includeComments: false }, ctx)
    .then((first) => {
      assert.equal(first.value.signals.length, 2);
      return adapter.scan(
        {
          source: groupSource({ cursor: first.value.cursor }),
          direction: 'DEMAND',
          cursor: first.value.cursor,
          limit: 20,
          includeComments: false,
        },
        ctx,
      );
    })
    .then((second) => {
      assert.equal(second.value.signals.length, 0, 'an incremental scan re-read old posts');
    });
});

test('the same post scanned twice produces the same signal id', () => {
  // Which is what makes a re-scan idempotent instead of duplicating: the
  // (platform, external_id) unique index then does the work at insert time.
  const url = 'https://www.facebook.com/groups/tbilisi-housing/';
  const { ctx } = context({ [url]: postPage([POST()]) });
  const adapter = new FacebookAdapter();
  const request = { source: groupSource(), direction: 'DEMAND', cursor: null, limit: 20, includeComments: false };

  return Promise.all([adapter.scan(request, ctx), adapter.scan(request, ctx)]).then(([a, b]) => {
    assert.equal(a.value.signals[0].id, b.value.signals[0].id);
    assert.equal(a.value.signals[0].contentFingerprint, b.value.signals[0].contentFingerprint);
  });
});

test('a scan stopped by the limit says so rather than looking complete', () => {
  const url = 'https://www.facebook.com/groups/tbilisi-housing/';
  const posts = Array.from({ length: 5 }, (_, i) =>
    POST({ url: `${url}posts/${i}`, datePublished: `2026-09-1${i}T10:00:00.000Z` }),
  );
  const { ctx } = context({ [url]: postPage(posts) });
  return new FacebookAdapter()
    .scan({ source: groupSource(), direction: 'DEMAND', cursor: null, limit: 2, includeComments: false }, ctx)
    .then((result) => {
      assert.equal(result.value.signals.length, 2);
      assert.equal(result.value.truncated, true, 'a truncated scan looked complete');
    });
});

/* ── Discovery from links already read ────────────────────────────────── */

test('links to other groups in readable content become discovered sources', () => {
  // The compounding half of discovery: every group we can see names others,
  // and each costs nothing beyond a request already made.
  const url = 'https://www.facebook.com/groups/tbilisi-housing/';
  const page = `<html><head><title>T</title>
    <script type="application/ld+json">${JSON.stringify([POST()])}</script></head>
    <body><a href="https://www.facebook.com/groups/tbilisi-rentals/">See also</a></body></html>`;
  const { ctx } = context({ [url]: page });

  return new FacebookAdapter()
    .scan({ source: groupSource(), direction: 'DEMAND', cursor: null, limit: 20, includeComments: false }, ctx)
    .then((result) => {
      const found = result.value.discovered.map((d) => d.canonicalUrl);
      assert.ok(found.includes('https://www.facebook.com/groups/tbilisi-rentals/'));
      assert.ok(!found.includes(url), 'the source discovered itself');
    });
});

test('discovery records a private group instead of discarding it', () => {
  const candidate = 'https://www.facebook.com/groups/private-group/';
  const { ctx } = context({ [candidate]: '<html><head><title>Private Group</title></head><body>This group is private</body></html>' });

  return new FacebookAdapter()
    .discover(
      { queries: [{ text: candidate, id: 'q1', language: 'en', direction: 'DEMAND', intent: 'WANT_TO_BUY', propertyTerm: 'apartment', locationTerm: 'Tbilisi', priority: 1 }], countryCode: 'GE', languages: ['en'], limit: 5 },
      ctx,
    )
    .then((result) => {
      assert.equal(result.ok, true);
      assert.equal(result.value.length, 1);
      assert.equal(result.value[0].accessState, 'JOIN_REQUIRED');
      assert.match(result.value[0].rationale, /not readable anonymously/);
    });
});

/* ── No brittle UI choreography ───────────────────────────────────────── */

test('the adapters navigate by URL and structured data, never by element position', () => {
  for (const file of ['facebook.ts', 'instagram.ts', 'meta-platform.ts']) {
    const src = readFileSync(join(process.cwd(), 'src/research-core/adapters', file), 'utf8');
    assert.ok(!/nth-child|nth-of-type|\.click\(|querySelectorAll\([^)]*\)\[\d+\]/.test(src), `${file} uses positional UI selectors`);
  }
});
