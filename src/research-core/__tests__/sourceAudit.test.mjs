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
import { classifyRegistryRow } from '../discovery/candidate-classification.ts';

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

  /*
   * THE DEFECT CLASS, not the first mechanism that caused it.
   *
   * The original guard grepped for `refusedByPolicy` and for a `source_family`
   * IN-list, both of which were how the FIRST version happened to be written.
   * Both are gone: the family filter was itself a bug (it excluded all 314
   * legacy rows, and would equally have excluded a genuine candidate website,
   * which also has a null family until it is audited), and refusals are now
   * returned as data by the candidate path rather than sniffed out of an error
   * message.
   *
   * What must stay true is the CLASS: when the auditor learned nothing about a
   * host, it records nothing about that host. So the assertion is on the
   * decision, not on the variable that feeds it.
   */
  assert.match(worker, /policyRefusedAll/,
    'the worker no longer separates "nobody answered" from "we never asked"');
  assert.match(worker, /if \(policyRefusedAll\)/);
  assert.match(worker, /recorded: false/);
  assert.match(worker, /NETWORK_REFUSED/);
  /* And the row must be left alone: no update may run on that branch. */
  const branch = worker.slice(worker.indexOf('if (policyRefusedAll)'));
  const untilContinue = branch.slice(0, branch.indexOf('continue;'));
  assert.equal(/\.update\(/.test(untilContinue), false,
    'the worker writes to the row on the branch where it learned nothing');
});

test('a row that is not a candidate website is never eligible for the audit', () => {
  /*
   * The behavioural half of the same defect class, and the half a source-string
   * test could never cover. The first production run of this worker audited two
   * rows whose url is `https://google.com` and recorded both as
   * AUDITED / UNREACHABLE. Eligibility now comes from classifying the URL, so
   * the question "would that row have been fetched?" has a real answer here.
   */
  const notWebsites = [
    'https://google.com',
    'https://www.google.com/search?q=binebi',
    'https://www.reddit.com/r/Sakartvelo/',
    'https://t.me/',
    'https://t.me/tbilisi_real_estate',
    'https://www.facebook.com/groups/',
    'https://www.instagram.com/explore/tags/tbilisihousing/',
    'https://vk.com/tbilisi_community',
    'tg://join?invite=abc',
  ];
  for (const url of notWebsites) {
    const { auditable, kind } = classifyRegistryRow({ url });
    assert.equal(auditable, false, `${url} would be fetched by the website auditor (${kind})`);
  }

  /* And a real candidate website still is eligible, or the guard is vacuous. */
  assert.equal(classifyRegistryRow({ url: 'https://geplace.com/' }).auditable, true);
});

test('an empty queue is not reported as a healthy one', () => {
  /*
   * 314 rows sat in DISCOVERED and not one was a candidate website, so the
   * audit had no input at all: they are the Reddit subreddits, the social group
   * rows and the "Google Search: GE/xx" placeholders left by the retired
   * provider discovery.
   *
   * Reporting "no source is waiting" would read as a healthy queue and hide the
   * actual state. What the worker must report is the COUNT that is waiting and
   * the classification of what it examined, so the difference between "the
   * queue is empty" and "the queue is full of things I cannot use" survives.
   */
  const worker = readFileSync('supabase/functions/source-audit/index.ts', 'utf8');
  assert.match(worker, /discoveredRowsUnaudited/);
  assert.match(worker, /skippedByClassification/,
    'the worker does not say WHY the rows it examined were unusable');
  assert.match(worker, /nothing is waiting in DISCOVERED/,
    'the genuinely-empty case is no longer distinguished from the unusable-rows case');
  assert.match(worker, /mode "discover"/,
    'the worker does not name the thing that would fix an empty queue');
});

test('the portal path keeps its allowlist and its skipped DNS as ONE decision', () => {
  /*
   * This test used to say the auditor COULD NOT reach a new candidate host, and
   * that the fix was not to widen the allowlist. The first half is no longer
   * true — src/research-core/net/candidate-host.ts is the second path, and it
   * resolves DNS and classifies every address. The second half is still the
   * whole point, and it is what is pinned here.
   *
   * createPortalRuntime sets `skipDnsResolution: true`, which disables the rule
   * "every resolved address must be public". That is only defensible BECAUSE
   * `hostAllowlistOnly` closes the path to a fixed set of public portals first.
   * The two properties hold each other up. Removing the allowlist while leaving
   * DNS skipped would leave the portal path with no SSRF boundary at all, and it
   * would look like a cleanup.
   *
   * So: both together, or a deliberate edit that has to come here and say why.
   */
  const runtime = readFileSync('src/research-core/market/runtime.ts', 'utf8');
  assert.match(runtime, /hostAllowlistOnly: allowlist/);
  assert.match(runtime, /skipDnsResolution: true/);

  /* And the candidate path must be the opposite of that, in both halves. */
  const candidate = readFileSync('src/research-core/net/candidate-host.ts', 'utf8');
  assert.equal(/hostAllowlistOnly:/.test(candidate), false,
    'the candidate path grew an allowlist, which it cannot have: a candidate is not on a list');
  assert.match(candidate, /skipDnsResolution: false/,
    'the candidate path no longer resolves DNS, which removes its only boundary');
  assert.match(candidate, /allowPrivateNetworks: false/);
});

test('the auditor reaches an unvetted host over the candidate path, never the portal one', () => {
  /*
   * The separation, asserted where it would actually be broken: in the worker.
   * Auditing through createPortalRuntime was the old behaviour and it is what
   * made the allowlist the audit's ceiling. Auditing through it now would mean
   * either that ceiling is back, or that somebody widened the allowlist with
   * database rows — which is the one change this whole layer exists to prevent.
   */
  const worker = readFileSync('supabase/functions/source-audit/index.ts', 'utf8');

  const auditFn = worker.slice(worker.indexOf('async function audit('));
  assert.match(auditFn, /createCandidateAuditPath\(\{ resolver: new DohResolver\(\) \}\)/,
    'the audit mode does not use the candidate-host path');
  assert.equal(/createPortalRuntime\(/.test(auditFn), false,
    'the audit mode fetches unvetted hosts through the fixed-portal allowlist');

  /* Discovery is the mirror image: it reads only hosts that DO have policies. */
  const discoverFn = worker.slice(worker.indexOf('async function discover('), worker.indexOf('async function audit('));
  assert.match(discoverFn, /createPortalRuntime\(\)/);
  assert.equal(/createCandidateAuditPath/.test(discoverFn), false,
    'discovery reads implemented portals under the candidate policy, which is the wrong posture');
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
