// THE DISCOVER STEP, AND THE CLASSIFICATION THAT FEEDS IT.
//
// Two properties are load-bearing and both are asserted against real production
// data rather than invented rows:
//
//   1. the 314 legacy rows are classified as what they ARE, not as what their
//      platform column claims — 297 of them say FORUM and are subreddits
//   2. a discovered candidate is a link that existed in a document we were
//      permitted to read, with that document's URL attached; nothing is invented

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyRegistryRow,
  summariseClassifications,
} from '../discovery/candidate-classification.ts';
import {
  harvestCandidates,
  extractLinks,
  registrable,
  score,
  summariseHarvest,
} from '../discovery/candidate-discovery.ts';

// ---------------------------------------------------------------------------
// CLASSIFICATION — every case below is a real row shape from production.
// ---------------------------------------------------------------------------

test('a subreddit is a community identifier, whatever the platform column says', () => {
  const result = classifyRegistryRow({
    url: 'https://www.reddit.com/r/Batumi/',
    platform: 'FORUM',
    sourceType: 'FORUM',
    name: 'r/Batumi',
  });

  assert.equal(result.kind, 'COMMUNITY_IDENTIFIER');
  assert.equal(result.family, 'PUBLIC_COMMUNITY');
  assert.equal(result.identifier, 'r/Batumi');
  assert.equal(result.auditable, false,
    'the website auditor would only ever report facts about reddit.com');
  assert.equal(result.retire, false, 'a real subreddit is not an artefact');
  assert.match(result.declaredPlatformMismatch, /declares platform FORUM/);
});

test('Reddit is NOT filed in the same family as forum.ge', () => {
  // The independence bug this prevents: 296 subreddits on one platform counted
  // as 296 independent FORUM sources, outvoting the one real forum.
  const reddit = classifyRegistryRow({ url: 'https://www.reddit.com/r/Sakartvelo/', platform: 'FORUM' });
  assert.notEqual(reddit.family, 'FORUM');
  assert.equal(reddit.family, 'PUBLIC_COMMUNITY');
});

test('a platform root with no identifier is not a source', () => {
  const cases = [
    ['https://t.me/', 'TELEGRAM'],
    ['https://www.facebook.com/groups/', 'FACEBOOK'],
    ['https://reddit.com/', 'FORUM'],
    ['https://threads.net/', 'OTHER'],
  ];
  for (const [url, platform] of cases) {
    const result = classifyRegistryRow({ url, platform });
    assert.equal(result.kind, 'PLATFORM_ROOT', `${url} was classified ${result.kind}`);
    assert.equal(result.family, null, `${url} was given a family it has not earned`);
    assert.equal(result.auditable, false);
    assert.equal(result.retire, true, `${url} would stay in active planning`);
    assert.match(result.rationale, /no identifier/);
  }
});

test('facebook.com/groups/ is a root but facebook.com/groups/123 is not', () => {
  // The distinction the minimumSegments rule exists for. One is a lobby, the
  // other names a specific group.
  assert.equal(classifyRegistryRow({ url: 'https://www.facebook.com/groups/' }).kind, 'PLATFORM_ROOT');
  const named = classifyRegistryRow({ url: 'https://www.facebook.com/groups/tbilisirent/' });
  assert.equal(named.kind, 'COMMUNITY_IDENTIFIER');
  assert.equal(named.identifier, 'groups/tbilisirent');
});

test('reddit.com/r alone does not count as a subreddit', () => {
  assert.equal(classifyRegistryRow({ url: 'https://www.reddit.com/r/' }).kind, 'PLATFORM_ROOT');
});

test('a search engine URL is a record of a query, not a source', () => {
  for (const url of ['https://google.com', 'https://www.google.com/search?q=binebi',
    'https://bing.com/search?q=x']) {
    const result = classifyRegistryRow({ url, platform: 'GOOGLE' });
    assert.equal(result.kind, 'SEARCH_PLACEHOLDER', `${url} -> ${result.kind}`);
    assert.equal(result.retire, true);
    assert.equal(result.auditable, false);
    assert.equal(result.family, null);
  }
});

test('an Instagram hashtag page is a community identifier', () => {
  const result = classifyRegistryRow({
    url: 'https://www.instagram.com/explore/tags/tbilisihousing/',
    platform: 'INSTAGRAM',
  });
  assert.equal(result.kind, 'COMMUNITY_IDENTIFIER');
  assert.equal(result.auditable, false);
  assert.equal(result.retire, false);
});

test('an ordinary website is the one auditable kind, and gets NO family yet', () => {
  const result = classifyRegistryRow({ url: 'https://geplace.com/', platform: 'WEBSITE' });
  assert.equal(result.kind, 'CANDIDATE_WEBSITE');
  assert.equal(result.auditable, true);
  assert.equal(result.retire, false);
  assert.equal(result.family, null,
    'a family guessed from a hostname is exactly the invented metadata being cleaned up');
});

test('a site that already has a portal policy is not a candidate', () => {
  const result = classifyRegistryRow({
    url: 'https://ss.ge/en/real-estate',
    platform: 'WEBSITE',
    implementedDomains: ['ss.ge', 'myhome.ge', 'home.ge'],
  });
  assert.equal(result.kind, 'IMPLEMENTED_SOURCE');
  assert.equal(result.auditable, false);
  assert.equal(result.retire, false, 'an implemented source must not be retired by a cleanup');
});

test('a subdomain of an implemented source is still that source', () => {
  const result = classifyRegistryRow({
    url: 'https://www.ss.ge/ka/udzravi-qoneba',
    implementedDomains: ['ss.ge'],
  });
  assert.equal(result.kind, 'IMPLEMENTED_SOURCE');
});

test('a non-web URL is unusable and says so', () => {
  for (const url of ['tg://join?invite=x', 'mailto:a@b.c', 'not a url', '', 'ftp://x.ge/']) {
    const result = classifyRegistryRow({ url });
    assert.equal(result.kind, 'UNUSABLE', `${url} -> ${result.kind}`);
    assert.equal(result.retire, true);
  }
});

test('a classification always carries a rationale a person can read', () => {
  const urls = ['https://www.reddit.com/r/tbilisi/', 'https://google.com', 'https://t.me/',
    'https://geplace.com/', 'nonsense'];
  for (const url of urls) {
    const { rationale } = classifyRegistryRow({ url });
    assert.ok(rationale.length > 40, `${url} has a stub rationale: ${rationale}`);
    assert.equal(/\b(TODO|N\/A|unknown)\b/i.test(rationale), false,
      `${url} rationale is a placeholder`);
  }
});

test('the batch summary matches the measured production mix, all 314 rows', () => {
  /*
   * NOT AN INVENTED FIXTURE. This is the shape of source_registry's DISCOVERED
   * rows as measured on 2026-09-26 — and the first version of this test guessed
   * it wrong in a way worth keeping a note of. It assumed every t.me and
   * Facebook row was a bare root; running the classifier over the actual 314
   * rows said three of each carry a real identifier
   * (`t.me/tbilisi_real_estate`), so the true split is 304 community
   * identifiers and 4 roots, not 298 and 10.
   *
   * The number that mattered was right either way, which is the only reason the
   * guess was survivable: see the last assertion.
   */
  const rows = [
    // 296 subreddits, every one of them declaring platform FORUM.
    ...Array.from({ length: 296 }, (_, i) => ({ url: `https://www.reddit.com/r/sub${i}/`, platform: 'FORUM' })),
    { url: 'https://reddit.com/', platform: 'FORUM' },
    // Six rows all pointing at the same bare search engine URL.
    ...Array.from({ length: 6 }, () => ({ url: 'https://google.com', platform: 'GOOGLE' })),
    // Telegram: three real channels and one lobby.
    { url: 'https://t.me/tbilisi_real_estate', platform: 'TELEGRAM' },
    { url: 'https://t.me/batumi_flats', platform: 'TELEGRAM' },
    { url: 'https://t.me/georgia_property', platform: 'TELEGRAM' },
    { url: 'https://t.me/', platform: 'TELEGRAM' },
    // Facebook: three named groups and one lobby.
    { url: 'https://www.facebook.com/groups/tbilisirent', platform: 'FACEBOOK' },
    { url: 'https://www.facebook.com/groups/expatstbilisi', platform: 'FACEBOOK' },
    { url: 'https://www.facebook.com/groups/batumiproperty', platform: 'FACEBOOK' },
    { url: 'https://www.facebook.com/groups/', platform: 'FACEBOOK' },
    { url: 'https://vk.com/tbilisi_community', platform: 'VK' },
    { url: 'https://threads.net/', platform: 'OTHER' },
    { url: 'https://www.instagram.com/explore/tags/tbilisihousing/', platform: 'INSTAGRAM' },
  ];
  assert.equal(rows.length, 314, 'the fixture no longer matches the production count');

  const summary = summariseClassifications(rows.map((row) => classifyRegistryRow(row)));

  assert.equal(summary.total, 314);
  assert.equal(summary.byKind.COMMUNITY_IDENTIFIER, 304, '296 subreddits + 3 tg + 3 fb + vk + instagram');
  assert.equal(summary.byKind.SEARCH_PLACEHOLDER, 6);
  assert.equal(summary.byKind.PLATFORM_ROOT, 4, 'reddit.com/, t.me/, facebook.com/groups/, threads.net/');
  assert.equal(summary.retire, 10, '6 search placeholders + 4 platform roots');
  assert.equal(summary.platformMismatches, 297, 'the 296 subreddits plus the reddit root');

  /*
   * THE LOAD-BEARING ASSERTION, and the answer to "why did the auditor say
   * there was nothing to do". Not one of the 314 rows is a candidate website.
   * The audit step was not misconfigured and its family filter was not too
   * narrow: its input set was genuinely empty, because every row in it is a
   * community identifier or an artefact of a retired provider.
   */
  assert.equal(summary.auditable, 0);
});

// ---------------------------------------------------------------------------
// DISCOVERY — a candidate is a link that was really there.
// ---------------------------------------------------------------------------

const PARTNERS_PAGE = `
<html><body>
  <h1>პარტნიორები</h1>
  <a href="https://agency-tbilisi.ge/">უძრავი ქონების სააგენტო Tbilisi</a>
  <a href="/about">About us</a>
  <a href="https://batumi-development.ge/projects">Batumi Development — construction</a>
  <a href="https://example-blog.net/post/1">Someone's blog</a>
  <a href="https://www.facebook.com/ourpage">Follow us on Facebook</a>
  <a href="https://google-analytics.com/x.js">tracker</a>
  <a href="https://portal.ge/privacy">Privacy policy</a>
  <a href="mailto:info@portal.ge">Email</a>
  <a href="javascript:void(0)">Menu</a>
  <a href="#top">Back to top</a>
</body></html>`;

const DIRECTORY_PAGE = `
<html><body>
  <a href="https://agency-tbilisi.ge/contact">Agency Tbilisi</a>
  <a href="https://invest-georgia.com/">Invest in Georgia — rental yield</a>
</body></html>`;

function permitted(url, domain, html) {
  return { url, domain, html, lifecycle: 'PERMITTED' };
}

test('candidates come from links that were in the document, with provenance', () => {
  const candidates = harvestCandidates(
    [permitted('https://portal.ge/partners', 'portal.ge', PARTNERS_PAGE)],
    { market: 'GE', languages: ['ka', 'en'], intent: 'BOTH' },
  );

  const domains = candidates.map((candidate) => candidate.domain);
  assert.ok(domains.includes('agency-tbilisi.ge'));
  assert.ok(domains.includes('batumi-development.ge'));

  for (const candidate of candidates) {
    assert.ok(candidate.discoveredFrom.length > 0, `${candidate.domain} has no provenance`);
    assert.equal(candidate.discoveredFrom[0], 'https://portal.ge/partners');
  }
});

test('the harvester never invents a domain that was not in the HTML', () => {
  const candidates = harvestCandidates(
    [permitted('https://portal.ge/partners', 'portal.ge', PARTNERS_PAGE)],
    { market: 'GE', languages: ['ka'], intent: 'SUPPLY' },
  );
  for (const candidate of candidates) {
    assert.ok(PARTNERS_PAGE.includes(candidate.host),
      `${candidate.host} does not appear in the source document`);
  }
});

test('infrastructure, social and legal links are not candidates', () => {
  const candidates = harvestCandidates(
    [permitted('https://portal.ge/partners', 'portal.ge', PARTNERS_PAGE)],
    { market: 'GE', languages: ['ka'], intent: 'BOTH' },
  );
  const domains = candidates.map((candidate) => candidate.domain);

  for (const unwanted of ['facebook.com', 'google-analytics.com', 'portal.ge']) {
    assert.equal(domains.includes(unwanted), false, `${unwanted} was offered as a candidate`);
  }
});

test('a source that has not reached PERMITTED is not harvested from', () => {
  // The rule that stops one unaudited site nominating a thousand others.
  for (const lifecycle of ['DISCOVERED', 'AUDITED', 'BLOCKED', 'RETIRED', 'DEGRADED']) {
    const candidates = harvestCandidates(
      [{ url: 'https://unknown.ge/links', domain: 'unknown.ge', html: PARTNERS_PAGE, lifecycle }],
      { market: 'GE', languages: ['ka'], intent: 'BOTH' },
    );
    assert.equal(candidates.length, 0, `${lifecycle} was harvested`);
  }
  for (const lifecycle of ['PERMITTED', 'IMPLEMENTED', 'LIVE_TESTED', 'PRODUCTIVE']) {
    const candidates = harvestCandidates(
      [{ url: 'https://known.ge/links', domain: 'known.ge', html: PARTNERS_PAGE, lifecycle }],
      { market: 'GE', languages: ['ka'], intent: 'BOTH' },
    );
    assert.ok(candidates.length > 0, `${lifecycle} produced nothing`);
  }
});

test('two independent documents linking one host is a stronger signal than one linking it twice', () => {
  const twoSources = harvestCandidates(
    [
      permitted('https://portal.ge/partners', 'portal.ge', PARTNERS_PAGE),
      permitted('https://directory.ge/members', 'directory.ge', DIRECTORY_PAGE),
    ],
    { market: 'GE', languages: ['ka', 'en'], intent: 'BOTH' },
  );

  const agency = twoSources.find((candidate) => candidate.domain === 'agency-tbilisi.ge');
  assert.equal(agency.discoveredFrom.length, 2);
  assert.match(agency.rationale, /linked from 2 permitted sources/);

  const oneSource = harvestCandidates(
    [permitted('https://portal.ge/partners', 'portal.ge', PARTNERS_PAGE)],
    { market: 'GE', languages: ['ka', 'en'], intent: 'BOTH' },
  );
  const alone = oneSource.find((candidate) => candidate.domain === 'agency-tbilisi.ge');
  assert.ok(agency.relevance > alone.relevance,
    'independent endorsement did not raise relevance');
});

test('a candidate with no signal is reported with zero, not discarded', () => {
  const candidates = harvestCandidates(
    [permitted('https://portal.ge/partners', 'portal.ge', PARTNERS_PAGE)],
    { market: 'GE', languages: ['ka'], intent: 'BOTH' },
  );
  const blog = candidates.find((candidate) => candidate.domain === 'example-blog.net');
  assert.ok(blog, 'the unpromising link was silently dropped');
  assert.equal(blog.relevance, 0);
  assert.match(blog.rationale, /zero relevance rather than/);
  // And it sorts last, which is the actual mechanism for not wasting an audit.
  assert.equal(candidates[candidates.length - 1].domain, 'example-blog.net');
});

test('relevance is explained in words every time, never as a bare number', () => {
  const candidates = harvestCandidates(
    [permitted('https://portal.ge/partners', 'portal.ge', PARTNERS_PAGE)],
    { market: 'GE', languages: ['ka'], intent: 'DEMAND' },
  );
  for (const candidate of candidates) {
    assert.ok(candidate.rationale.length > 30, `${candidate.domain}: ${candidate.rationale}`);
  }
  const agency = candidates.find((candidate) => candidate.domain === 'agency-tbilisi.ge');
  assert.match(agency.rationale, /estate agency/);
  assert.match(agency.rationale, /\.ge domain/);
});

test('Georgian anchor text is scored, not skipped', () => {
  // ASCII word boundaries never match Georgian; a scorer built on \b would
  // silently ignore every Georgian partner list, which is most of them.
  const georgianOnly = `<html><body>
    <a href="https://saagento.ge/">უძრავი ქონების სააგენტო თბილისი</a></body></html>`;
  const candidates = harvestCandidates(
    [permitted('https://portal.ge/p', 'portal.ge', georgianOnly)],
    { market: 'GE', languages: ['ka'], intent: 'SUPPLY' },
  );
  assert.equal(candidates.length, 1);
  assert.ok(candidates[0].relevance > 0.3, `scored only ${candidates[0].relevance}`);
  assert.match(candidates[0].rationale, /estate agency/);
});

test('extractLinks collapses nested markup into readable anchor text', () => {
  const links = extractLinks(
    '<a href="/x"><span>Estate </span>&nbsp; <b>Agency</b></a>',
    'https://portal.ge/page',
  );
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'https://portal.ge/x');
  assert.equal(links[0].text, 'Estate Agency');
});

test('extractLinks handles single quotes, bare hrefs and relative paths', () => {
  const html = `<a href='https://a.ge/'>A</a><a href=https://b.ge/ >B</a><a href="../c">C</a>`;
  const links = extractLinks(html, 'https://portal.ge/dir/page');
  const hrefs = links.map((link) => link.href);
  assert.ok(hrefs.includes('https://a.ge/'));
  assert.ok(hrefs.includes('https://b.ge/'));
  assert.ok(hrefs.includes('https://portal.ge/c'));
});

test('extractLinks refuses schemes that are not web pages', () => {
  const html = `<a href="javascript:alert(1)">x</a><a href="data:text/html,x">y</a>
    <a href="mailto:a@b.c">z</a><a href="file:///etc/passwd">w</a>`;
  assert.deepEqual(extractLinks(html, 'https://portal.ge/'), []);
});

test('registrable domain keeps com.ge intact', () => {
  assert.equal(registrable('www.example.com.ge'), 'example.com.ge');
  assert.equal(registrable('example.com.ge'), 'example.com.ge');
  assert.equal(registrable('shop.agency.ge'), 'agency.ge');
  assert.equal(registrable('agency.ge'), 'agency.ge');
  assert.equal(registrable('a.b.c.co.uk'), 'c.co.uk');
});

test('an IP literal is never offered as a discovered source', () => {
  const html = '<a href="http://93.184.216.34/listings">Listings</a>';
  const candidates = harvestCandidates(
    [permitted('https://portal.ge/p', 'portal.ge', html)],
    { market: 'GE', languages: ['ka'], intent: 'BOTH' },
  );
  assert.equal(candidates.length, 0, 'a bare address was offered as a candidate source');
});

test('the harvest summary separates what was read from what was refused', () => {
  const sources = [
    permitted('https://portal.ge/partners', 'portal.ge', PARTNERS_PAGE),
    { url: 'https://unknown.ge/x', domain: 'unknown.ge', html: PARTNERS_PAGE, lifecycle: 'DISCOVERED' },
  ];
  const candidates = harvestCandidates(sources, { market: 'GE', languages: ['ka'], intent: 'BOTH' });
  const summary = summariseHarvest(sources, candidates);

  assert.equal(summary.documentsRead, 1);
  assert.equal(summary.documentsSkippedUnpermitted, 1);
  assert.equal(summary.candidates, candidates.length);
  assert.equal(summary.withRelevance + summary.zeroRelevance, candidates.length);
});

test('the objective is used for ranking and never as a filter', () => {
  const withHints = harvestCandidates(
    [permitted('https://portal.ge/p', 'portal.ge', PARTNERS_PAGE)],
    { market: 'GE', languages: ['ka'], intent: 'DEMAND', familyHints: ['EXPAT_COMMUNITY'] },
  );
  const without = harvestCandidates(
    [permitted('https://portal.ge/p', 'portal.ge', PARTNERS_PAGE)],
    { market: 'GE', languages: ['ka'], intent: 'SUPPLY' },
  );
  assert.equal(withHints.length, without.length,
    'the objective removed candidates instead of reordering them');
});

test('A GEORGIAN SUPERMARKET IS NOT A PROPERTY SOURCE', () => {
  /*
   * MEASURED IN PRODUCTION 2026-09-26, and the reason the scorer has a gate.
   *
   * The first version added 0.15 for a `.ge` domain unconditionally. Run against
   * the home pages of seven Georgian portals, its top candidates were auto.ge,
   * shop.aversi.ge (a pharmacy), caparol.ge (paint), epay.ge (a payments
   * gateway), nikorasupermarket.ge and sab.fast.ge — every one scoring exactly
   * 0.15, every one on the TLD alone, not one of them a property source.
   *
   * A ccTLD is LOCALITY. It is a reason to prefer this property source over an
   * equivalent one elsewhere, never a reason to read a site.
   */
  const supermarket = {
    url: 'https://nikorasupermarket.ge/', host: 'nikorasupermarket.ge',
    domain: 'nikorasupermarket.ge', anchors: ['Nikora'], linkCount: 1,
    discoveredFrom: ['https://portal.ge/'], relevance: 0, rationale: '',
  };
  const scored = score(supermarket, { market: 'GE', languages: ['ka'], intent: 'BOTH' });
  assert.equal(scored.relevance, 0, `a supermarket scored ${scored.relevance}`);
  assert.equal(/\.ge domain/.test(scored.rationale), false,
    'the locality bonus fired with nothing to modify');
});

test('being linked from every portal in the country does not make a gateway a source', () => {
  // The same gate, for the endorsement modifier. A payments provider linked from
  // four portals is a well-linked payments provider.
  const gateway = {
    url: 'https://epay.ge/', host: 'epay.ge', domain: 'epay.ge',
    anchors: ['epay'], linkCount: 4,
    discoveredFrom: ['https://a.ge/', 'https://b.ge/', 'https://c.ge/', 'https://d.ge/'],
    relevance: 0, rationale: '',
  };
  const scored = score(gateway, { market: 'GE', languages: ['ka'], intent: 'BOTH' });
  assert.equal(scored.relevance, 0, `a payments gateway scored ${scored.relevance}`);
  assert.equal(/linked from 4/.test(scored.rationale), false);
});

test('both modifiers still apply once the market signal is there', () => {
  // The gate must not have turned into a wall: a real agency on a .ge domain
  // linked from two portals should score well above one hit alone.
  const agency = {
    url: 'https://agency-tbilisi.ge/', host: 'agency-tbilisi.ge', domain: 'agency-tbilisi.ge',
    anchors: ['უძრავი ქონების სააგენტო'], linkCount: 2,
    discoveredFrom: ['https://a.ge/', 'https://b.ge/'], relevance: 0, rationale: '',
  };
  const scored = score(agency, { market: 'GE', languages: ['ka'], intent: 'BOTH' });
  assert.ok(scored.relevance >= 0.6, `a well-endorsed agency scored only ${scored.relevance}`);
  assert.match(scored.rationale, /estate agency/);
  assert.match(scored.rationale, /\.ge domain/);
  assert.match(scored.rationale, /linked from 2 permitted sources/);
});

test('a market other than GE does not get a Georgian .ge bonus', () => {
  const candidate = {
    url: 'https://agency-tbilisi.ge/', host: 'agency-tbilisi.ge', domain: 'agency-tbilisi.ge',
    anchors: ['Some Agency'], linkCount: 1, discoveredFrom: ['https://x.tr/p'],
    relevance: 0, rationale: '',
  };
  const ge = score(candidate, { market: 'GE', languages: ['ka'], intent: 'BOTH' });
  const tr = score(candidate, { market: 'TR', languages: ['tr'], intent: 'BOTH' });
  assert.ok(ge.relevance > tr.relevance);
  assert.match(ge.rationale, /\.ge domain/);
  assert.equal(/\.ge domain/.test(tr.rationale), false);
});
