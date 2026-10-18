// FIND BUYERS — the three tabs (owner, 2026-10-16): Buyers/Tenants are DIRECT
// leads that match review rated STRONG or POTENTIAL; Interested people are
// INTEREST results plus WEAK / unreviewed direct requests ("needs
// verification"); Research opportunities are post-level. Sellers, brokers,
// services and rejected readings never appear, and every tab count is the
// number of cards the tab lists.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyLead, listableLeads, mergeOpportunities, normalizeUrl, parseResearchRows, placeLead, tabCounts, buildOpportunities,
} from '../externalResults.ts';

const lead = (id, over = {}) => ({
  id, matching_job_id: 'j', source: 'FACEBOOK', overall_score: 50, created_at: '2026-10-15T10:00:00Z', signal_at: '2026-10-15T09:00:00Z',
  author_name: id, evidence: [{ kind: 'POST', text: 'x', url: `https://facebook.com/p/${id}` }], ...over,
});
const q = (resultType, extra = {}) => ({ qualification: { resultType, intent: 'ACTIVE_BUYER', signals: [] }, ...extra });

test('STRONG and POTENTIAL direct requests are Buyers; WEAK and unreviewed ones are interested people needing verification', () => {
  assert.deepEqual(placeLead(classifyLead(lead('a', q('DIRECT', { match_category: 'STRONG' })))), { tab: 'direct', needsVerification: false });
  assert.deepEqual(placeLead(classifyLead(lead('b', q('DIRECT', { match_category: 'POTENTIAL' })))), { tab: 'direct', needsVerification: false });
  assert.deepEqual(placeLead(classifyLead(lead('c', q('DIRECT', { match_category: 'WEAK' })))), { tab: 'interest', needsVerification: true });
  assert.deepEqual(placeLead(classifyLead(lead('d', q('DIRECT', { match_category: null })))), { tab: 'interest', needsVerification: true });
  assert.deepEqual(placeLead(classifyLead(lead('e', q('INTEREST', { match_category: 'WEAK' })))), { tab: 'interest', needsVerification: false });
});

test('sellers, brokers, services, jobs and rejected readings are never listed', () => {
  for (const role of ['SALE_OFFER', 'RENT_OFFER', 'AGENT', 'SERVICE', 'JOB', 'agent']) {
    assert.equal(placeLead(classifyLead(lead(role, q('DIRECT', { match_category: 'STRONG', role })))), null, role);
  }
  assert.equal(placeLead(classifyLead(lead('r', q('DIRECT', { match_category: 'REJECTED' })))), null);
  assert.equal(placeLead(classifyLead(lead('x', q('EXCLUDED')))), null);
  assert.notEqual(placeLead(classifyLead(lead('buyer', q('DIRECT', { match_category: 'STRONG', role: 'BUY_REQUEST' })))), null, 'a demand role stays');
});

test('the wrong market is excluded (a tenant is never a buyer for a sale)', () => {
  const tenant = { ...lead('t'), qualification: { resultType: 'DIRECT', intent: 'ACTIVE_TENANT', signals: [] }, match_category: 'STRONG' };
  assert.equal(placeLead(classifyLead(tenant, 'SALE')), null);
});

test('tab counts are the real number of cards per tab', () => {
  const leads = [
    lead('s', q('DIRECT', { match_category: 'STRONG' })), lead('p', q('DIRECT', { match_category: 'POTENTIAL' })),
    lead('w', q('DIRECT', { match_category: 'WEAK' })), lead('i', q('INTEREST')), lead('rej', q('DIRECT', { match_category: 'REJECTED' })),
    lead('ag', q('DIRECT', { match_category: 'STRONG', role: 'AGENT' })), lead('ex', q('EXCLUDED')),
  ].map((l) => classifyLead(l));
  assert.deepEqual(tabCounts(leads, []), { direct: 2, interest: 2, opportunities: 0 });
  assert.equal(listableLeads(leads).length, 4);
});

const POST = 'https://www.facebook.com/groups/1/permalink/9/';
const interest = (n) => lead(`i${n}`, {
  ...q('INTEREST'), qualification: { resultType: 'INTEREST', intent: 'PRICE_INQUIRY', signals: ['PRICE'] }, language: 'ka',
  evidence: [{ kind: 'COMMENT', source: 'FACEBOOK', similarity: 80, text: 'ფასი?', url: `${POST}?c=${n}`, parentUrl: POST, parentExcerpt: 'იყიდება ბინა', parentCommentCount: 30, parentAnalyzed: 10, signals: ['PRICE'] }],
});

test('research rows merge with lead-derived opportunities, one card per post (deduped by url)', () => {
  const ops = buildOpportunities([interest(1), interest(2)].map((l) => classifyLead(l)), null);
  const rows = parseResearchRows([
    { signal_id: 'a', url: 'https://facebook.com/groups/1/permalink/9', comments_state: 'NOT_INSPECTED', interested_count: 0, competitor: true, source: 'FACEBOOK' },
    { signal_id: 'b', url: 'https://www.facebook.com/groups/2/posts/5', comments_state: 'NOT_INSPECTED', interested_count: 7, source: 'facebook', source_kind: 'GROUP', similarity: 71, reported_comments: 40 },
    { signal_id: 'c', url: 'https://vk.com/wall-1_2', comments_state: 'INSPECTED', interested_count: 3, source: 'VK' },
    { signal_id: 'bad', url: 'javascript:alert(1)', comments_state: 'INSPECTED' },
  ]);
  assert.equal(rows.length, 3, 'a non-web url is dropped');
  const merged = mergeOpportunities(ops, rows);
  assert.equal(merged.length, 3, 'the same post known both ways is one card');
  const lead1 = merged.find((m) => m.post);
  assert.equal(lead1.interestedCount, 2, 'lead-derived: the people found in the comments read');
  assert.equal(lead1.competitor, true, 'the research row adds the competitor flag');
  const notInspected = merged.find((m) => m.url.includes('/groups/2/'));
  assert.equal(notInspected.interestedCount, null, 'never a count for comments nobody read');
  assert.equal(notInspected.commentsState, 'NOT_INSPECTED');
  assert.equal(merged.find((m) => m.url.includes('vk.com')).interestedCount, 3, 'inspected comments: the real count');
});

test('a failed or missing RPC answer reads as no research rows', () => {
  for (const v of [null, undefined, {}, 'x', [null, 1, 'y']]) assert.deepEqual(parseResearchRows(v), []);
  assert.deepEqual(mergeOpportunities([], []), []);
});

test('url normalisation: host case, www, trailing slash and fragment', () => {
  assert.equal(normalizeUrl('https://WWW.Facebook.com/groups/1/#x'), normalizeUrl('https://facebook.com/groups/1'));
  assert.notEqual(normalizeUrl('https://facebook.com/groups/1?id=2'), normalizeUrl('https://facebook.com/groups/1?id=3'));
});

test('a seeker who never said buy or rent is an interested person needing verification, never a qualified buyer', () => {
  const l = lead('tu', { match_category: 'STRONG', qualification: { resultType: 'DIRECT', intent: 'ACTIVE_BUYER', signals: [], limitations: ['TRANSACTION_UNCONFIRMED'] } });
  assert.deepEqual(placeLead(classifyLead(l)), { tab: 'interest', needsVerification: true, reason: 'TRANSACTION_UNCONFIRMED' });
});

test('a broker searching for a named client is listed to verify, labelled — any other broker never is (v10)', () => {
  const viaBroker = { role: 'AGENT', resultType: 'INTEREST', match_category: 'WEAK', qualification: { limitations: ['BUYER_VIA_BROKER'] } };
  assert.deepEqual(placeLead(viaBroker), { tab: 'interest', needsVerification: true, reason: 'BUYER_VIA_BROKER' });
  assert.equal(placeLead({ ...viaBroker, qualification: { limitations: [] } }), null);
  assert.equal(placeLead({ ...viaBroker, match_category: 'REJECTED' }), null);
  assert.equal(placeLead({ ...viaBroker, resultType: 'EXCLUDED' }), null);
});
