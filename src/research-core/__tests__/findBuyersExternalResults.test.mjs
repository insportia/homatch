// FIND BUYERS 3.0 — external results on read: three result types, post opportunities
// built only from what was read, and legacy leads classified by the same gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildOpportunities, classifyLead, comparePrice, countResults, daysAgo, freshnessOf, postKey } from '../../findBuyers/externalResults.ts';

const NOW = Date.parse('2026-10-15T12:00:00Z');
const POST = 'https://www.facebook.com/groups/1/permalink/9';
const facts = { price: 185000, currency: 'USD', areaSqm: 100, bedrooms: 2, district: 'krtsanisi' };
const interest = (n, signals, at = '2026-10-13T09:00:00Z', extra = {}) => ({
  id: `l${n}`, matching_job_id: 'job-new', source: 'FACEBOOK', overall_score: 40, created_at: '2026-10-14T10:00:00Z', signal_at: at, author_name: `A${n}`,
  qualification: { resultType: 'INTEREST', intent: signals.includes('VIEWING') ? 'VIEWING_INQUIRY' : 'PRICE_INQUIRY', signals },
  evidence: [{ kind: 'COMMENT', source: 'FACEBOOK', similarity: 82, text: 'x', url: `${POST}?c=${n}`, parentUrl: POST, parentExcerpt: 'იყიდება ბინა კრწანისში',
    publishedAt: at, parentCommentCount: 240, parentAnalyzed: 40, parentPublishedAt: '2026-10-10T08:00:00Z', parentFacts: facts, signals, ...extra }],
});

test('240 comments, 40 analyzed, 16 signals: counts are kept as read, never extrapolated', () => {
  const leads = [];
  for (let i = 0; i < 8; i += 1) leads.push(interest(i, ['PRICE']));
  for (let i = 8; i < 13; i += 1) leads.push(interest(i, ['VIEWING']));
  for (let i = 13; i < 16; i += 1) leads.push(interest(i, ['FINANCING']));
  const ops = buildOpportunities(leads.map(classifyLead), { price: 160000, currency: 'USD', areaSqm: 97.2, bedrooms: 2, district: 'krtsanisi' });
  assert.equal(ops.length, 1, 'one post is one opportunity');
  const op = ops[0];
  assert.deepEqual({ total: op.totalComments, analyzed: op.analyzedComments, people: op.interestedPeople, signals: op.signalTotal },
    { total: 240, analyzed: 40, people: 16, signals: 16 });
  assert.deepEqual(op.breakdown, { PRICE: 8, VIEWING: 5, FINANCING: 3 });
  assert.equal(op.comparison.difference, -25000, 'the owner is $25,000 below');
  assert.equal(op.comparison.ownerPerSqm, 1646);
  assert.equal(op.comparison.comparablePerSqm, 1850);
  assert.equal(op.latestCommentAt, '2026-10-13T09:00:00Z');
  assert.ok(op.opportunityScore > 0 && op.opportunityScore <= 100);
  const counts = countResults(leads.map(classifyLead), ops);
  assert.deepEqual(counts, { direct: 0, interest: 16, opportunities: 1, excluded: 0 }, 'opportunities are not people');
});

test('one comment with two signals counts one person and two signals', () => {
  const op = buildOpportunities([classifyLead(interest(1, ['PRICE', 'VIEWING']))], null)[0];
  assert.equal(op.interestedPeople, 1);
  assert.equal(op.signalTotal, 2);
});

test('an unreported total stays unknown, and analyzed is never above the total', () => {
  const op = buildOpportunities([classifyLead(interest(1, ['PRICE'], undefined, { parentCommentCount: null, parentAnalyzed: 12 }))], null)[0];
  assert.equal(op.totalComments, null);
  assert.equal(op.analyzedComments, 12);
  const capped = buildOpportunities([classifyLead(interest(2, ['PRICE'], undefined, { parentCommentCount: 5, parentAnalyzed: 9 }))], null)[0];
  assert.equal(capped.analyzedComments, 5);
});

test('price comparison only in the same currency, with the facts it has', () => {
  assert.equal(comparePrice({ price: 160000, currency: 'USD', areaSqm: null, bedrooms: null, district: null }, { ...facts, currency: 'GEL' }), null);
  assert.equal(comparePrice(null, facts), null);
  assert.equal(comparePrice({ price: 160000, currency: 'usd', areaSqm: null, bedrooms: null, district: null }, facts).ownerPerSqm, null);
});

test('legacy leads (no stored gate) are classified on read from their own evidence', () => {
  const legacy = (text, extra = {}) => ({ id: 'x', matching_job_id: 'job-old', source: 'FACEBOOK', overall_score: 55, created_at: '2026-10-13T10:00:00Z', signal_at: null, author_name: null,
    evidence: [{ kind: 'POST', text, ...extra }] });
  /* the production ad that scored 55 */
  assert.equal(classifyLead(legacy('ბინის შეძენა გსურთ და ვერ გადაგიწყვეტიათ რომელ კომპანიას მიმართოთ? გთავაზობთ ბინებს მწვანე კარკასის კონდიციით, გადახდის მოქნილი პირობებით 591 099 171')).resultType, 'EXCLUDED');
  /* the production "price?" comment under a listing */
  const c = classifyLead(legacy('საძინებელი რამდენი?\nფასი?', { kind: 'COMMENT', similarity: 60, parentExcerpt: 'იყიდება სულ ახალი უცხოვრებელი ბინა ჭყონდიდელის ქუჩაზე, 2 საძინებელი, 75კვ, ტელ 593367734 whatsapp', parentUrl: POST }));
  assert.equal(c.resultType, 'INTEREST');
  assert.equal(classifyLead(legacy('ვიყიდი 2 საძინებლიან ბინას კრწანისში, ბიუჯეტი 160 000$')).resultType, 'DIRECT');
});

test('freshness never assumes fresh without a timestamp', () => {
  assert.equal(freshnessOf(null, NOW), 'UNKNOWN');
  assert.equal(freshnessOf('not a date', NOW), 'UNKNOWN');
  assert.equal(freshnessOf('2026-10-15T06:00:00Z', NOW), 'TODAY');
  assert.equal(freshnessOf('2026-10-10T06:00:00Z', NOW), 'WEEK');
  assert.equal(freshnessOf('2026-09-25T06:00:00Z', NOW), 'MONTH');
  assert.equal(freshnessOf('2026-08-01T06:00:00Z', NOW), 'OLDER');
  assert.equal(daysAgo('2026-10-13T09:00:00Z', NOW), 2);
  assert.equal(daysAgo(null, NOW), null);
  assert.equal(postKey(POST), postKey(POST));
  assert.notEqual(postKey(POST), postKey(`${POST}0`));
});
