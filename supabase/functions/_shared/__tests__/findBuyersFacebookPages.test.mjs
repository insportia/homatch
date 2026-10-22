// FIND BUYERS — Facebook beyond groups (2026-10-16). A keyword search of public
// posts finds a competitor/agency listing comparable to the owner's flat: its
// comments are fetched (FB_COMMENTS) and the Page that published it is read next
// (FB_PAGE_POSTS), registered as a Page (SOCIAL_PROFILE), never as a group. A Page
// post that arrives with its comments attached is analysed without a second paid
// comments run, and every lead says whether it came from a group, a Page or a search.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memDb } from './memDb.mjs';

globalThis.Deno ??= { env: { get: () => '' } };
const { processItems, pageUrlOf, commentsStageFor, sourceKindOf } = await import('../findBuyers/pipeline.ts');
const { buildPropertyDna } = await import('../../../../src/research-core/findBuyers/propertyDna.ts');

const fixture = JSON.parse(readFileSync(new URL('../../../../src/research-core/__tests__/fixtures/villionCampaignLeads.json', import.meta.url), 'utf8'));
const dna = buildPropertyDna(fixture.property);
const NOW = Date.parse(fixture.campaign.evaluatedAt);

function campaignDb() {
  return memDb({
    find_buyers_campaigns: [{ matching_job_id: 'job-p', metrics: {} }],
    find_buyers_leads: [], find_buyers_assessments: [], find_buyers_persons: [], raw_signals: [], source_registry: [],
  });
}
const ctxFor = (db, stage) => ({
  db, stage, runId: 'run-p', runLanguage: 'ka', datasetId: 'ds', providerRunId: 'pr', book: { model: 'gpt-4o-mini', inputPerMTokMicros: 150000, outputPerMTokMicros: 600000 }, aiFirst: false,
  gate: { skipBelow: 55, eligibleFrom: 75 }, parent: null, sourceId: null, sourceYield: null, now: NOW,
  campaign: { matching_job_id: 'job-p', campaign_id: 'c', property_id: 'p-244486', user_id: 'u', transaction: 'SALE', dna },
});
const LISTING = 'იყიდება 3 ოთახიანი ბინა კრწანისში, 2 საძინებელი, 98 კვ.მ, ფასი 209 000$, ახალი რემონტით';
const post = (n, { url, author, text = LISTING, comments = null, inline = [] }) => ({
  kind: 'POST', network: 'FACEBOOK', externalId: `post:${n}`, url, parentExternalId: null, parentUrl: null,
  author: { id: null, name: author?.name ?? `author-${n}`, url: author?.url ?? null, handle: null }, text, publishedAt: '2026-10-07T10:00:00Z',
  engagement: { comments, likes: null, shares: null }, group: null, inlineComments: inline,
});
const comment = (n, parent, text, name) => ({
  kind: 'COMMENT', network: 'FACEBOOK', externalId: `comment:${n}`, url: `${parent.url}?comment_id=${n}`, parentExternalId: parent.externalId, parentUrl: parent.url,
  author: { id: null, name, url: null, handle: null }, text, publishedAt: '2026-10-08T09:00:00Z',
  engagement: { comments: null, likes: null, shares: null }, group: null, inlineComments: [],
});

test('a comparable listing found by keyword search: its comments are fetched and its Page is read next, as a Page', async () => {
  const { db, tables } = campaignDb();
  const agency = post(1, { url: 'https://www.facebook.com/tbilisihomes/posts/111', author: { name: 'Tbilisi Homes', url: 'https://www.facebook.com/tbilisihomes?ref=post' } });
  const sameAgency = post(2, { url: 'https://www.facebook.com/tbilisihomes/posts/112', author: { name: 'Tbilisi Homes', url: 'https://www.facebook.com/tbilisihomes' } });
  const inGroup = post(3, { url: 'https://www.facebook.com/groups/99/permalink/3/', author: { name: 'x', url: 'https://www.facebook.com/groups/99/user/5' } });
  const out = await processItems(ctxFor(db, 'FB_POST_SEARCH'), [agency, sameAgency, inGroup]);

  const comments = out.followUps.filter((f) => f.stage === 'FB_COMMENTS');
  assert.ok(comments.length >= 1, JSON.stringify(tables.find_buyers_assessments.map((a) => [a.role, a.similarity, a.comments_decision])));
  assert.equal(comments[0].parent.sourceKind, 'SEARCH', 'the comments will be shown as found on a public post');

  const pages = out.followUps.filter((f) => f.stage === 'FB_PAGE_POSTS');
  assert.deepEqual(pages.map((f) => f.targetUrl), ['https://www.facebook.com/tbilisihomes'], 'one Page read per author; never a group link');
  const src = tables.source_registry;
  assert.equal(src.length, 1);
  assert.equal(src[0].source_type, 'SOCIAL_PROFILE', 'a Page is never stored as a FACEBOOK_GROUP');
  assert.equal(src[0].platform, 'FACEBOOK');
  assert.equal(src[0].active, false, 'discovery registers; it never switches a source on');
  assert.equal(pages[0].sourceId, src[0].id);

  /* The platform reported no count (logged-out search): kept as unknown, never 0. */
  const listing = tables.find_buyers_assessments.find((a) => a.role === 'SALE_OFFER');
  assert.equal(listing.qualification.reportedComments, null);
  assert.equal(listing.qualification.sourceKind, 'SEARCH');
});

test('a Page post with its comments attached is analysed in place: no second comments run, leads marked PAGE', async () => {
  const { db, tables } = campaignDb();
  const p = post(10, { url: 'https://www.facebook.com/tbilisihomes/posts/210', author: { name: 'Tbilisi Homes', url: 'https://www.facebook.com/tbilisihomes' }, comments: 14 });
  p.inlineComments = [
    comment(11, p, 'მინდა ვიყიდო ასეთი ბინა კრწანისში, ნახვა შეიძლება ხვალ?', 'Nino'),
    comment(12, p, 'რა ღირს?', 'Giorgi'),
    comment(13, p, 'ლამაზია 😍', 'Ana'),
  ];
  const out = await processItems(ctxFor(db, 'FB_PAGE_POSTS'), [p]);
  assert.equal(out.followUps.filter((f) => f.stage === 'FB_COMMENTS').length, 0, 'the visible comments were already read');
  const leads = tables.find_buyers_leads;
  assert.ok(leads.length >= 1, JSON.stringify(tables.find_buyers_assessments.map((a) => [a.content_kind, a.role, a.match_category])));
  for (const l of leads) assert.equal(l.evidence[0].sourceKind, 'PAGE');
  assert.ok(!leads.some((l) => /ლამაზია/.test(l.evidence[0].text)), 'praise is not a lead');
  const listing = tables.find_buyers_assessments.find((a) => a.content_kind === 'POST');
  assert.equal(listing.qualification.reportedComments, 14);
  assert.equal(listing.qualification.inlineComments, 3);
});

test('a group post keeps its own label and its reported count, so a 0-comment skip can be audited', async () => {
  const { db, tables } = campaignDb();
  const g = post(20, { url: 'https://www.facebook.com/groups/1/permalink/20/', comments: 0 });
  const out = await processItems(ctxFor(db, 'FB_GROUP_POSTS'), [g]);
  assert.equal(out.followUps.filter((f) => f.stage === 'FB_COMMENTS').length, 0, 'an explicit 0 is still trusted for groups');
  const a = tables.find_buyers_assessments[0];
  assert.equal(a.comments_decision, 'SKIP_NO_COMMENTS');
  assert.equal(a.qualification.reportedComments, 0);
  assert.equal(a.qualification.sourceKind, 'GROUP');
});

test('pageUrlOf: public Pages only, canonical, never groups, posts or other sites', () => {
  assert.equal(pageUrlOf('https://www.facebook.com/tbilisihomes?ref=post'), 'https://www.facebook.com/tbilisihomes');
  assert.equal(pageUrlOf('https://m.facebook.com/tbilisihomes/'), 'https://www.facebook.com/tbilisihomes');
  assert.equal(pageUrlOf('https://www.facebook.com/profile.php?id=1000123&sk=about'), 'https://www.facebook.com/profile.php?id=1000123');
  for (const bad of ['https://www.facebook.com/groups/99/', 'https://www.facebook.com/permalink/1', 'https://www.facebook.com/marketplace/item/1',
    'https://www.facebook.com/profile.php', 'https://www.instagram.com/tbilisihomes', 'not a url', null]) assert.equal(pageUrlOf(bad), null, String(bad));
});

test('stage routing: every Facebook post stage reads comments through FB_COMMENTS and carries its source kind', () => {
  for (const s of ['FB_GROUP_POSTS', 'FB_POST_SEARCH', 'FB_PAGE_POSTS']) assert.equal(commentsStageFor(s), 'FB_COMMENTS', s);
  assert.equal(commentsStageFor('FB_COMMENTS'), null);
  assert.deepEqual(['FB_GROUP_POSTS', 'FB_PAGE_POSTS', 'FB_POST_SEARCH', 'TIKTOK_SEARCH'].map(sourceKindOf), ['GROUP', 'PAGE', 'SEARCH', null]);
});
