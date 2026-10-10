// FIND BUYERS — the live pipeline end to end on the VILLION baseline: the
// production texts arrive as Facebook group posts, and only genuine buyers
// become leads, each rejection is recorded with its reason, the repost is a
// duplicate, a comparable sale listing earns a comments follow-up even when
// the Actor reported no comment count, and job boards are never followed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { memDb } from './memDb.mjs';

globalThis.Deno ??= { env: { get: () => '' } };
const { processItems } = await import('../findBuyers/pipeline.ts');
const { buildPropertyDna } = await import('../../../../src/research-core/findBuyers/propertyDna.ts');

const fixture = JSON.parse(readFileSync(new URL('../../../../src/research-core/__tests__/fixtures/villionCampaignLeads.json', import.meta.url), 'utf8'));
const dna = buildPropertyDna(fixture.property);
const NOW = Date.parse(fixture.campaign.evaluatedAt);

function campaignDb() {
  return memDb({
    find_buyers_campaigns: [{ matching_job_id: 'job-v', metrics: {} }],
    find_buyers_leads: [], find_buyers_assessments: [], find_buyers_persons: [], raw_signals: [], source_registry: [],
  });
}
const ctxFor = (db, stage = 'FB_GROUP_POSTS') => ({
  db, stage, runId: 'run-1', runLanguage: 'multi', datasetId: 'ds', providerRunId: 'pr', book: { model: 'gpt-4o-mini', inputPerMTokMicros: 150000, outputPerMTokMicros: 600000 },
  gate: { skipBelow: 55, eligibleFrom: 75 }, parent: null, sourceId: 'src-1', sourceYield: null, now: NOW,
  campaign: { matching_job_id: 'job-v', campaign_id: 'c', property_id: 'p-244486', user_id: 'u', transaction: 'SALE', dna },
});
const post = (l) => ({
  kind: 'POST', network: 'FACEBOOK', externalId: `post:${l.n}`, url: l.url, parentExternalId: null, parentUrl: null,
  author: { id: null, name: l.author ?? `author-${l.n}`, url: null, handle: null }, text: l.text, publishedAt: l.at,
  engagement: { comments: null, likes: null, shares: null }, group: null, inlineComments: [],
});

test('VILLION posts through the live pipeline: 2 leads (1 Potential, 1 Weak), 0 Strong, every rejection explained', async () => {
  const { db, tables } = campaignDb();
  const out = await processItems(ctxFor(db), fixture.leads.map(post));
  const leads = tables.find_buyers_leads;
  assert.equal(leads.length, 2, JSON.stringify(leads.map((l) => [l.match_category, l.evidence?.[0]?.text?.slice(0, 40)])));
  assert.deepEqual(leads.map((l) => l.match_category).sort(), ['POTENTIAL', 'WEAK']);
  assert.equal(out.strong, 0);
  assert.equal(out.qualified, 1);
  assert.equal(out.weak, 1);
  const assess = tables.find_buyers_assessments;
  assert.equal(assess.length, 37);
  for (const a of assess) {
    assert.ok(a.match_category, 'every assessment has a category');
    if (a.match_category === 'REJECTED') assert.ok(a.rejection_reasons.length > 0);
  }
  assert.ok(out.rejected.JOB_SEARCH >= 13);
  assert.ok(out.rejected.WRONG_TRANSACTION >= 7);
  assert.equal(out.rejected.DUPLICATE, 1);
  /* Unknown budget stays unknown on the customer-facing row. */
  const potential = leads.find((l) => l.match_category === 'POTENTIAL');
  assert.equal(potential.budget_fit, 'UNKNOWN');
  assert.equal(potential.location_fit, 'CITY');
  assert.ok(Array.isArray(potential.qualification.dupKeys));
  /* Time to first visible / qualified result recorded once. */
  const m = tables.find_buyers_campaigns[0].metrics;
  assert.ok(m.firstVisibleAt && m.firstQualifiedAt);
  assert.equal(m.firstStrongAt, undefined);
});

test('re-running the same posts adds nothing (campaign-level dedupe)', async () => {
  const { db, tables } = campaignDb();
  await processItems(ctxFor(db), fixture.leads.map(post));
  const again = await processItems(ctxFor(db), fixture.leads.map((l) => ({ ...post(l), externalId: `post:again-${l.n}` })));
  assert.equal(tables.find_buyers_leads.length, 2);
  assert.equal(again.qualified + again.weak, 0);
});

test('a comparable SALE listing earns a comments follow-up when the comment count is unknown; requests and job posts never do', async () => {
  const { db, tables } = campaignDb();
  const listing = { ...post({ n: 900, url: 'https://www.facebook.com/groups/1/permalink/900/', at: '2026-10-08T10:00:00Z', text: 'იყიდება 3 ოთახიანი ბინა კრწანისში, 2 საძინებელი, 98 კვ.მ, ფასი 209 000$, ახალი რემონტით' }) };
  const out = await processItems(ctxFor(db), [listing, post(fixture.leads[13]), post(fixture.leads[5])]);
  const follow = out.followUps.filter((f) => f.stage === 'FB_COMMENTS');
  assert.equal(follow.length, 1, JSON.stringify(tables.find_buyers_assessments.map((a) => [a.role, a.similarity, a.comments_decision])));
  assert.equal(follow[0].targetUrl, listing.url);
  assert.equal(follow[0].parent.role, 'SALE_OFFER');
  const decisions = Object.fromEntries(tables.find_buyers_assessments.map((a) => [a.role, a.comments_decision]));
  assert.equal(decisions.JOB, 'SKIP_NOT_A_LISTING');
  assert.equal(decisions.BUY_SEEKER, 'SKIP_REQUEST');
});

test('comments under that listing: specific interest is a buyer lead, a bare "PM" is not', async () => {
  const { db, tables } = campaignDb();
  const parent = { externalId: 'post:900', url: 'https://www.facebook.com/groups/1/permalink/900/', signalId: 's900', similarity: 80, stance: 'OFFER', role: 'SALE_OFFER', excerpt: 'იყიდება 3 ოთახიანი ბინა კრწანისში', facts: null, ageDays: 1, publishedAt: '2026-10-08T10:00:00Z' };
  const c = (id, text) => ({ kind: 'COMMENT', network: 'FACEBOOK', externalId: `comment:${id}`, url: `${parent.url}?comment_id=${id}`, parentExternalId: parent.externalId, parentUrl: parent.url,
    author: { id: `fb-${id}`, name: `c${id}`, url: null, handle: null }, text, publishedAt: '2026-10-08T12:00:00Z', engagement: { comments: null, likes: null, shares: null }, group: null, inlineComments: [] });
  await processItems({ ...ctxFor(db, 'FB_COMMENTS'), parent }, [c(1, 'აქტუალურია? რა ფასად დათმობთ? შეიძლება ნახვა ხვალ?'), c(2, 'PM'), c(3, 'ვყიდი მსგავს ბინას, დამირეკეთ')]);
  const leads = tables.find_buyers_leads;
  assert.equal(leads.length, 1);
  assert.equal(leads[0].role, 'BUY_SEEKER');
  assert.equal(leads[0].evidence[0].parentUrl, parent.url, 'the comment keeps its link to the post');
});

test('group discovery: job boards and rental-only groups are not followed for a SALE search', async () => {
  const { db, tables } = campaignDb();
  const g = (id, name, members = 20000) => ({ kind: 'GROUP', network: 'FACEBOOK', externalId: `group:${id}`, url: `https://www.facebook.com/groups/${id}/`, parentExternalId: null, parentUrl: null,
    author: { id: null, name: null, url: null, handle: null }, text: name, publishedAt: null, engagement: { comments: null, likes: null, shares: null },
    group: { id, name, url: `https://www.facebook.com/groups/${id}/`, members, isPublic: true, description: null }, inlineComments: [] });
  const out = await processItems(ctxFor(db, 'FB_GROUP_SEARCH'), [
    g('jobingeorgia', 'Работа в Грузии | Jobs in Georgia'),
    g('rentapartmentintbilisi', 'Rent apartment in Tbilisi'),
    g('tbilisirealestate', 'Tbilisi Real Estate — buy & sell apartments | უძრავი ქონება თბილისში'),
  ]);
  const followed = out.followUps.map((f) => f.targetUrl);
  assert.deepEqual(followed, ['https://www.facebook.com/groups/tbilisirealestate/']);
  assert.ok(tables.source_registry.every((r) => r.relevance && Array.isArray(r.relevance.reasons)));
});
