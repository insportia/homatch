// AUDITING A CANDIDATE SOURCE IN CODE RATHER THAN BY HAND.
//
// Every one of the 47 sources in the registry got there because a person ran
// scripts/audit-source-shape.mjs and read the output — the script says so
// itself: "This script decides nothing." The lifecycle ladder in
// source-lifecycle.ts models DISCOVERED -> AUDITED and nothing in production
// ever advanced a source along it, because the only thing that could was a
// script on a laptop.
//
// The cases below are the REAL findings from the hosts audited on 2026-09-26,
// so the module is checked against sites that were actually read rather than
// against shapes invented to suit it.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  auditSource,
  disallowsEverything,
  documentShape,
  parseRobots,
  pathShape,
  sitemapLocs,
} from '../discovery/source-audit.ts';

const doc = (status, body = '') => ({ url: 'https://example.invalid/x', status, body });

/* ── robots ──────────────────────────────────────────────────────────────── */

test('only the * group decides our permission', () => {
  /*
   * A site granting Googlebot everything says nothing about us. Obeying a
   * named agent's generous rules on our own behalf is how a crawler ends up
   * fetching what it was not allowed to.
   */
  const robots = parseRobots([
    'User-agent: Googlebot',
    'Disallow:',
    'Crawl-delay: 0',
    '',
    'User-agent: *',
    'Disallow: /admin',
    'Disallow: /api/',
    'Crawl-delay: 5',
  ].join('\n'));
  assert.deepEqual(robots.disallow, ['/admin', '/api/']);
  assert.equal(robots.crawlDelay, 5);
  assert.equal(robots.groups, 2);
});

test('comments and blank lines do not become rules', () => {
  const robots = parseRobots('# nothing here\nUser-agent: *\n\nDisallow: /x # trailing\n');
  assert.deepEqual(robots.disallow, ['/x']);
});

test('a blanket disallow is recognised as one', () => {
  /* house.ge, audited 2026-09-26: serves a 385-URL sitemap and forbids all
     of it. Reading its shape would be reading what we may not fetch. */
  assert.equal(disallowsEverything(parseRobots('User-agent: *\nDisallow: /').disallow), true);
  assert.equal(disallowsEverything(['/admin', '/api/']), false);
});

test('a site with no * group grants us nothing in particular', () => {
  /* realtor.ge: robots 200, no group for *. */
  const robots = parseRobots('User-agent: SomeBot\nDisallow: /x');
  assert.deepEqual(robots.disallow, []);
  assert.equal(robots.crawlDelay, null);
});

/* ── sitemaps ────────────────────────────────────────────────────────────── */

test('path shapes collapse ids and slugs so they can be counted', () => {
  assert.equal(
    pathShape('https://www.home.ge/binebi/iyideba-binebi/iyideba-bina-4-otakhiani-tbilisi-26565.html'),
    '/binebi/iyideba-binebi/<slug>',
  );
  assert.equal(pathShape('https://korter.ge/en/apartments-for-sale-tbilisi/197'), '/en/apartments-for-sale-tbilisi/<id>');
});

test('child sitemaps are counted as indexes, not as listings', () => {
  const xml = `<sitemapindex>
    <sitemap><loc>https://x.invalid/sitemap_listings1.xml</loc></sitemap>
    <sitemap><loc>https://x.invalid/sitemap_listings2.xml</loc></sitemap>
  </sitemapindex>`;
  assert.equal(sitemapLocs(xml).length, 2);
  const finding = auditSource({ host: 'x.invalid', robots: doc(200, 'User-agent: *\nDisallow:'), sitemap: doc(200, xml) });
  assert.equal(finding.childSitemaps.length, 2);
  assert.equal(finding.sitemapUrls, 0, 'an index of sitemaps was counted as inventory');
});

/* ── shape of a page ─────────────────────────────────────────────────────── */

test('a shell is told from a server-rendered page by text against bytes', () => {
  /* origencollection.com: 1,346 chars of visible text inside 1,085,385 bytes. */
  const shell = documentShape(`<html><body>${'<div class="x"></div>'.repeat(30000)}<p>${'a'.repeat(1346)}</p></body></html>`);
  assert.ok(shell.bytes > 40_000);
  assert.ok(shell.visibleText < 2000);

  /* home.ge listing 26565: 3,328 chars of real text. */
  const real = documentShape(`<html><body><p>${'word '.repeat(700)}</p></body></html>`);
  assert.ok(real.visibleText >= 2000);
});

test('script and style content is not counted as visible text', () => {
  const d = documentShape('<html><script>' + 'x'.repeat(5000) + '</script><style>' + 'y'.repeat(5000) + '</style><p>short</p></html>');
  assert.equal(d.visibleText, 'short'.length);
});

/* ── the verdict, against real hosts ────────────────────────────────────── */

test('home.ge: permitted, structured, and its sitemap is the inventory', () => {
  const finding = auditSource({
    host: 'www.home.ge',
    robots: doc(200, 'User-agent: *\nDisallow: /plugins/\nDisallow: /libs/\nDisallow: /print*'),
    sitemap: doc(200, `<urlset>
      <url><loc>https://www.home.ge/binebi/iyideba-binebi/iyideba-bina-4-otakhiani-tbilisi-26565.html</loc></url>
      <url><loc>https://www.home.ge/binebi/iyideba-binebi/iyideba-bina-7-otakhiani-tbilisi-13500.html</loc></url>
    </urlset>`),
    detail: doc(200, `<html><head>
      <script type="application/ld+json">{"@type":"Product","offers":{"@type":"Offer","priceCurrency":"GEL","price":"240300"}}</script>
      </head><body><p>${'word '.repeat(700)}</p></body></html>`),
  });
  assert.equal(finding.access, 'PUBLIC_HTML');
  assert.equal(finding.shape, 'STRUCTURED');
  assert.equal(finding.sitemapUrls, 2);
  assert.deepEqual(finding.pathShapes[0], { shape: '/binebi/iyideba-binebi/<slug>', count: 2 });
  assert.match(finding.evidence, /3 disallow for \*/);
});

test('house.ge: a blanket robots disallow outranks a large sitemap', () => {
  const finding = auditSource({
    host: 'house.ge',
    robots: doc(200, 'User-agent: *\nDisallow: /'),
    sitemap: doc(200, '<urlset><url><loc>https://house.ge/samsheneblo-kompaniebi/thom-tower-28</loc></url></urlset>'),
  });
  assert.equal(finding.access, 'ROBOTS_DISALLOWED');
  assert.deepEqual(finding.robotsDisallow, ['/']);
});

test('dazhomes.com: a 403 on robots.txt itself is anti-bot, not unreachable', () => {
  /* The distinction decides whether anybody should ever try again. */
  const finding = auditSource({ host: 'dazhomes.com', robots: doc(403), sitemap: doc(403) });
  assert.equal(finding.access, 'ANTI_BOT');
});

test('nothing answered at all is UNREACHABLE, which is not the same thing', () => {
  const finding = auditSource({ host: 'gone.invalid', robots: null, sitemap: null });
  assert.equal(finding.access, 'UNREACHABLE');
  assert.equal(finding.shape, 'UNKNOWN');
});

test('a client-rendered shell is permitted and still unreadable', () => {
  /* livo.ge: robots allows everything but /admin/login.php, and every route
     returns the same 48KB shell with ~65 characters of text. Permission and
     readability are different findings and both are reported. */
  const finding = auditSource({
    host: 'livo.ge',
    robots: doc(200, 'User-agent: *\nDisallow: /admin/login.php'),
    sitemap: doc(404),
    detail: doc(200, `<html><body>${'<div></div>'.repeat(6000)}<p>${'a'.repeat(65)}</p></body></html>`),
  });
  assert.equal(finding.access, 'PUBLIC_HTML');
  assert.equal(finding.shape, 'CLIENT_RENDERED');
});

test('a blog is server-rendered and carries no property type', () => {
  /* expathome.ge: 247 URLs of Article and FAQPage, 7,372 chars of real prose,
     zero inventory. Readable, and not supply. */
  const finding = auditSource({
    host: 'expathome.ge',
    robots: doc(200, 'User-agent: *\nDisallow: /api/'),
    sitemap: doc(200, '<urlset><url><loc>https://expathome.ge/en/blog/georgia-residency</loc></url></urlset>'),
    detail: doc(200, `<html><head><script type="application/ld+json">{"@type":"Article"}</script></head>`
      + `<body><p>${'word '.repeat(1500)}</p></body></html>`),
  });
  assert.equal(finding.access, 'PUBLIC_HTML');
  assert.equal(finding.shape, 'SERVER_RENDERED', 'a blog with Article json-ld was called STRUCTURED');
  assert.equal(finding.jsonLdTypes.includes('Article'), true);
});

test('nothing is guessed when nothing was read', () => {
  const finding = auditSource({ host: 'x.invalid', robots: doc(200, 'User-agent: *\nDisallow:'), sitemap: doc(404) });
  assert.equal(finding.detailBytes, null);
  assert.equal(finding.detailVisibleText, null);
  assert.deepEqual(finding.jsonLdTypes, []);
  assert.equal(finding.shape, 'UNKNOWN');
  assert.match(finding.evidence, /no detail page read/);
});

test('the worker refuses to record a finding it did not learn', () => {
  /*
   * THE MISTAKE THE AUDITOR ITSELF MADE, on its first production run.
   *
   * createPortalRuntime rejects a host with no SourcePolicy -- that boundary is
   * why this function is allowed to exist. The first version counted such a
   * rejection as a failed read and concluded UNREACHABLE, so it reached two
   * rows whose url is https://google.com (search-query placeholders, not
   * websites), made ZERO network requests, and wrote AUDITED / UNREACHABLE to
   * both. Our configuration gap, recorded as a fact about somebody's site.
   *
   * Asserted on the function rather than the pure module because the pure
   * module is right: given no documents it already answers UNREACHABLE, and
   * whether "no documents" means "nobody answered" or "we never asked" is
   * knowledge only the caller has.
   */
  const worker = readFileSync('supabase/functions/source-audit/index.ts', 'utf8');
  assert.match(worker, /refusedByPolicy/, 'a policy refusal is not distinguished from a dead host');
  assert.match(worker, /if \(attempted > 0 && refusedByPolicy === attempted\)/);
  assert.match(worker, /recorded: false/);
  assert.match(worker, /POLICY_MISSING/);
  /* And it only looks at rows that are plausibly websites. */
  assert.match(worker, /\.in\('source_family', \[/);
});

test('the evidence sentence carries only what was measured', () => {
  const finding = auditSource({
    host: 'x.invalid',
    robots: doc(200, 'User-agent: *\nDisallow: /a\nCrawl-delay: 5'),
    sitemap: doc(200, '<urlset><url><loc>https://x.invalid/p/1234</loc></url></urlset>'),
  });
  assert.match(finding.evidence, /crawl-delay 5/);
  assert.match(finding.evidence, /1 url\(s\)/);
  /* No verdict words: the sentence describes, the tier decides. */
  assert.equal(/recommend|should|worth|good|bad/i.test(finding.evidence), false);
});
