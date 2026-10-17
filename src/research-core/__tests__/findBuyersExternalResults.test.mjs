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

test('a tenant is never a buyer for a sale listing (and vice versa), on read', () => {
  const post = (text) => ({ id: 'm', matching_job_id: 'j', source: 'FACEBOOK', overall_score: 75, created_at: '2026-10-01T00:00:00Z', signal_at: null, author_name: null, evidence: [{ kind: 'POST', text }] });
  const tenant = post('Ищу квартиру в Тбилиси, бюджет 300-400$ в месяц, на длительный срок');
  const buyer = post('ვიყიდი 2 საძინებლიან ბინას კრწანისში, ბიუჯეტი 160 000$');
  assert.equal(classifyLead(tenant, 'SALE').resultType, 'EXCLUDED');
  assert.equal(classifyLead(tenant, 'RENT').resultType, 'DIRECT');
  assert.equal(classifyLead(buyer, 'RENT').resultType, 'EXCLUDED');
  assert.equal(classifyLead(buyer, 'SALE').resultType, 'DIRECT');
  assert.equal(classifyLead(tenant, null).resultType, 'DIRECT', 'an unknown market keeps the reading');
});

test('a stored, already-qualified lead keeps its decision unless the rules find a definite exclusion', () => {
  const stored = (text, cat) => ({ id: 'q', matching_job_id: 'j', source: 'FACEBOOK', overall_score: 80, created_at: '', signal_at: null, author_name: null,
    counterpart: 'BUYER', match_category: cat, evidence: [{ kind: 'POST', text }] });
  /* the rules alone read this as unknown; the pipeline (with the model) qualified it */
  assert.equal(classifyLead(stored('Ищу 2-комнатную квартиру в Крцаниси, рассмотрю варианты.', 'STRONG'), 'SALE').resultType, 'DIRECT');
  /* never-qualified legacy: no pass to DIRECT. Since v5 a seeker who never said buy or
     rent is an interested person to verify (people-first), not excluded and not a buyer. */
  assert.equal(classifyLead(stored('Ищу 2-комнатную квартиру в Крцаниси, рассмотрю варианты.', null), 'SALE').resultType, 'INTEREST', 'never-qualified legacy: no pass');
  /* a definite exclusion still wins: the production developer ad was stored as WEAK */
  assert.equal(classifyLead(stored('ბინის შეძენა გსურთ? გთავაზობთ ბინებს მწვანე კარკასის კონდიციით, გადახდის მოქნილი პირობებით', 'WEAK'), 'SALE').resultType, 'EXCLUDED');
});

test('the same commenter stored twice under one post is one person; their signals still count', () => {
  const a = { ...interest(1, ['PRICE']), author_profile_url: 'https://facebook.com/u/77' };
  const b = { ...interest(2, ['VIEWING']), author_profile_url: 'https://FACEBOOK.com/u/77' };
  const c = { ...interest(3, ['PRICE']), author_name: 'A1' }; // same name as `a`, no profile: a different key
  const op = buildOpportunities([a, b, c].map(classifyLead), null)[0];
  assert.equal(op.interestedPeople, 2, 'profile 77 once, plus A1 by name');
  assert.equal(op.signalTotal, 3);
  const noName = { ...interest(4, ['PRICE']), author_name: null };
  const op2 = buildOpportunities([noName, { ...noName, id: 'l5' }].map(classifyLead), null)[0];
  assert.equal(op2.interestedPeople, 2, 'without a profile or a name, nobody is merged');
  const hidden = { ...interest(6, ['PRICE']), author_name: 'Facebook user' };
  assert.equal(buildOpportunities([hidden, { ...hidden, id: 'l7' }].map(classifyLead), null)[0].interestedPeople, 2, 'a placeholder name merges nobody');
});

test('why the audience is relevant: only the dimensions the pipeline found in agreement', () => {
  const lead = { ...interest(1, ['PRICE']), score_components: { why: { agreed: ['location', 'area'] } } };
  const other = { ...interest(2, ['VIEWING']), score_components: { why: { agreed: ['area', 'price'] } } };
  assert.deepEqual(buildOpportunities([lead, other].map(classifyLead), null)[0].agreed.sort(), ['area', 'location', 'price']);
  assert.deepEqual(buildOpportunities([classifyLead(interest(3, ['PRICE']))], null)[0].agreed, [], 'nothing stored, nothing claimed');
});
