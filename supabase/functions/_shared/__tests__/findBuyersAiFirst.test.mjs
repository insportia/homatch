// FIND BUYERS — AI-first lead classification (v11) through the live pipeline, with a stubbed
// OpenAI endpoint (no network, no key, no cost). Regression: the two brokers campaign 343cfc41
// showed as buyers; brokers with a client shown separately and never qualified; an AI failure
// leaves candidates UNVERIFIED, never a confident rule-based buyer; same words classified once.
import test from 'node:test';
import assert from 'node:assert/strict';
import { memDb } from './memDb.mjs';

const env = { OPENAI_API_KEY: 'test-key' };
globalThis.Deno ??= { env: { get: (k) => env[k] ?? '' } };
const realGet = globalThis.Deno.env.get;
globalThis.Deno.env.get = (k) => (k in env ? env[k] : realGet(k));
const { processItems } = await import('../findBuyers/pipeline.ts');
const { buildPropertyDna } = await import('../../../../src/research-core/findBuyers/propertyDna.ts');

const dna = buildPropertyDna({ transactionType: 'SALE', propertyType: 'APARTMENT', city: 'Tbilisi', district: 'Krtsanisi', totalPrice: 213840, currency: 'USD', area: 97.2, rooms: 3, bedrooms: 2 });
const NOW = Date.parse('2026-10-18T16:40:00Z');

/* The two leads campaign 343cfc41 displayed (production texts, 2026-10-18). */
const BROKER_COLLECTING = 'ჩამიყარეთ გასაყიდი ბინები მყავს ბათუმელი კლიენტები❤️❤️მომწერეთ პირადში❤️❤️';
const BROKER_SERVICE = 'مرحباً! إذا كنتم مهتمين بشراء شقة في جورجيا، يمكنكم مراسلتي على الخاص. أقدم لكم خدمة متكاملة بنسبة 100%! 🆘';
const BUYER = 'ვყიდულობ 3 ოთახიან ბინას კრწანისში, ბიუჯეტი 210 000$';
const BROKER_CLIENT = 'Hi, I have a client who wants to buy a 3-room apartment in Krtsanisi, budget around $200k. Owners please message me.';
const TRANSLIT_BUYER = 'vyidulob 3 otaxian binas krwanisshi, biujeti 200 000$';

/** A stand-in for the model: decides by the words, like a reviewer would. */
function fakeModel(text) {
  if (/კლიენტები|ჩამიყარეთ/.test(text)) return { role: 'BROKER_COLLECTING_LISTINGS', confidence: 0.95, transaction: 'BUY', evidence: ['ჩამიყარეთ გასაყიდი ბინები'] };
  if (/خدمة|مهتمين/.test(text)) return { role: 'SERVICE_PROVIDER', confidence: 0.92, transaction: 'BUY', evidence: ['أقدم لكم خدمة متكاملة'] };
  if (/a client who wants/.test(text)) return { role: 'BROKER_WITH_CLIENT', confidence: 0.9, transaction: 'BUY', evidence: ['I have a client who wants to buy'] };
  if (/ვყიდულობ/.test(text)) return { role: 'DIRECT_BUYER', confidence: 0.9, transaction: 'BUY', compatibility: 'COMPATIBLE', evidence: ['ვყიდულობ 3 ოთახიან ბინას'] };
  if (/vyidulob/.test(text)) return { role: 'DIRECT_BUYER', confidence: 0.9, transaction: 'BUY', compatibility: 'COMPATIBLE', evidence: ['vyidulob 3 otaxian binas'] };
  if (/For rent|USDT|U\.S\.D\.T/i.test(text)) return { role: 'DIRECT_TENANT', confidence: 0.9, transaction: 'RENT', evidence: [] }; /* fb-ai-1's real mistakes */
  return { role: 'IRRELEVANT', confidence: 0.9, transaction: 'UNKNOWN' };
}
let calls = 0; let sentItems = 0; let mode = 'ok';
globalThis.fetch = async (_url, init) => {
  calls++;
  if (mode === 'fail') return new Response('{}', { status: 500 });
  const body = JSON.parse(init.body);
  const user = JSON.parse(body.messages[1].content);
  assert.ok(user.property && user.property.family === 'APARTMENT', 'the Property DNA goes with every call');
  sentItems += user.items.length;
  const items = user.items.map((it) => ({ id: it.id, subject: 'REAL_ESTATE', offers_property: false, compatibility: 'UNKNOWN', budget: null, location: null, contradictions: [], evidence: [], reason: 'test', ...fakeModel(it.text) }));
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items }) } }], usage: { prompt_tokens: 900, completion_tokens: 300 } }), { status: 200 });
};

const ctxFor = (db) => ({
  db, stage: 'FB_GROUP_POSTS', runId: 'run-ai', runLanguage: 'multi', datasetId: 'ds', providerRunId: 'pr',
  book: { model: 'gpt-4o-mini', inputPerMTokMicros: 150000, outputPerMTokMicros: 600000 },
  gate: { skipBelow: 55, eligibleFrom: 75 }, parent: null, sourceId: 'src-1', sourceYield: null, now: NOW,
  campaign: { matching_job_id: 'job-ai', campaign_id: 'c', property_id: 'p', user_id: 'u', transaction: 'SALE', dna },
});
const post = (n, text, author = `Person ${n}`) => ({
  kind: 'POST', network: 'FACEBOOK', externalId: `post:${n}`, url: `https://www.facebook.com/groups/1/permalink/${n}/`, parentExternalId: null, parentUrl: null,
  author: { id: `a${n}`, name: author, url: null, handle: null }, text, publishedAt: '2026-10-18T10:00:00Z',
  engagement: { comments: null, likes: null, shares: null }, group: null, inlineComments: [],
});
const freshDb = () => memDb({ find_buyers_campaigns: [{ matching_job_id: 'job-ai', metrics: {}, provider_budget_micros: 3_150_000 }], find_buyers_leads: [], find_buyers_assessments: [], find_buyers_persons: [], raw_signals: [], source_registry: [] });

test('AI-first: the two 343cfc41 brokers are no leads; a broker with a client is shown apart, never qualified', async () => {
  mode = 'ok'; calls = 0; sentItems = 0;
  const m = freshDb(); const db = m.db;
  const out = await processItems(ctxFor(db), [post(1, BROKER_COLLECTING, 'ლიი ლიი'), post(2, BROKER_SERVICE, 'Giorgi Etsadeishvili'), post(3, BUYER), post(4, BROKER_CLIENT), post(5, TRANSLIT_BUYER)]);
  const leads = m.tables.find_buyers_leads;
  const textOf = (l) => l.evidence?.[0]?.text ?? '';
  assert.ok(!leads.some((l) => textOf(l).includes('ჩამიყარეთ')), 'the listing-collecting broker is no lead');
  assert.ok(!leads.some((l) => textOf(l).includes('خدمة')), 'the service broker is no lead');
  const buyer = leads.find((l) => textOf(l).startsWith('ვყიდულობ'));
  assert.ok(buyer && ['STRONG', 'POTENTIAL', 'WEAK'].includes(buyer.match_category));
  const viaBroker = leads.find((l) => textOf(l).includes('a client who wants'));
  assert.ok(viaBroker, 'a broker with a client is kept…');
  assert.equal(viaBroker.role, 'AGENT');
  assert.equal(viaBroker.match_category, 'WEAK', '…never above Weak');
  assert.ok(viaBroker.qualification.limitations.includes('BUYER_VIA_BROKER'));
  assert.ok(leads.some((l) => textOf(l).startsWith('vyidulob')), 'Georgian in Latin letters is read by the model');
  assert.ok(out.qualified <= 2, 'only direct buyers can count as qualified');
  const a = m.tables.find_buyers_assessments.find((r) => r.intent_method === 'AI:BROKER_COLLECTING_LISTINGS');
  assert.ok(a, 'the assessment records the AI decision');
  assert.equal(a.qualification.ai.version, 'fb-ai-2');
  assert.equal(a.qualification.ai.model, 'gpt-4o-mini');
  assert.ok(Array.isArray(a.qualification.ai.evidence) && a.qualification.ai.evidence.length > 0);
  assert.equal(calls, 1, 'five candidates, one batched call');
  assert.ok(m.rpcs.some((r) => r.n === 'find_buyers_record_ai_cost' && r.a.p_operation === 'AI_CLASSIFY'), 'the AI cost is recorded');
});

test('AI-first: an uncertain model answer is never shown', async () => {
  mode = 'ok';
  const m = freshDb(); const db = m.db;
  const prev = globalThis.fetch;
  globalThis.fetch = async (_u, init) => {
    const user = JSON.parse(JSON.parse(init.body).messages[1].content);
    const items = user.items.map((it) => ({ id: it.id, subject: 'REAL_ESTATE', offers_property: false, role: 'DIRECT_BUYER', confidence: 0.4, transaction: 'BUY', compatibility: 'UNKNOWN', budget: null, location: null, contradictions: [], evidence: [], reason: 'unsure' }));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), { status: 200 });
  };
  await processItems(ctxFor(db), [post(11, BUYER)]);
  globalThis.fetch = prev;
  assert.equal(m.tables.find_buyers_leads.length, 0);
});

test('AI-first: when the model fails, a rule buyer is UNVERIFIED — never a confident rule-based lead', async () => {
  mode = 'fail'; calls = 0;
  const m = freshDb(); const db = m.db;
  await processItems(ctxFor(db), [post(21, BUYER), post(22, BROKER_COLLECTING)]);
  assert.equal(m.tables.find_buyers_leads.length, 0, 'no lead without an AI verdict');
  assert.equal(calls, 2, 'one retry, then UNVERIFIED');
  const a = m.tables.find_buyers_assessments.find((r) => r.intent_method === 'UNVERIFIED' || r.intent_method?.startsWith('UNVERIFIED'));
  assert.ok(a, 'the assessment says UNVERIFIED');
  assert.equal(a.qualification.ai.status, 'UNVERIFIED');
  mode = 'ok';
});

test('AI-first: the same words in one read are classified once', async () => {
  mode = 'ok'; calls = 0; sentItems = 0;
  const m = freshDb(); const db = m.db;
  await processItems(ctxFor(db), [post(31, BUYER, 'A'), post(32, BUYER, 'B'), post(33, BUYER, 'C')]);
  assert.equal(sentItems, 1);
});

test('fb-ai-2: a model mistake on a listing or a USDT trade never becomes a lead', async () => {
  mode = 'ok';
  const m = freshDb();
  await processItems(ctxFor(m.db), [
    post(41, '🏡 2-Bedroom Apartment For rent in Krtsanisi, Tbilisi · 900$ per month'),
    post(42, 'Куплю U.S.D.T за наличные'),
  ]);
  assert.equal(m.tables.find_buyers_leads.length, 0);
});

test('fb-ai-2: items the model leaves out of its answer get one more call', async () => {
  const m = freshDb();
  const prev = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (_u, init) => {
    n++;
    const user = JSON.parse(JSON.parse(init.body).messages[1].content);
    const answer = n === 1 ? user.items.slice(0, 1) : user.items; /* the first answer skips an item */
    const items = answer.map((it) => ({ id: it.id, subject: 'REAL_ESTATE', offers_property: false, compatibility: 'UNKNOWN', budget: null, location: null, contradictions: [], reason: 't', ...fakeModel(it.text) }));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), { status: 200 });
  };
  await processItems(ctxFor(m.db), [post(51, BROKER_COLLECTING), post(52, BUYER)]);
  globalThis.fetch = prev;
  assert.equal(n, 2, 'one batch call + one call for the skipped item');
  assert.ok(m.tables.find_buyers_leads.some((l) => (l.evidence?.[0]?.text ?? '').startsWith('ვყიდულობ')), 'the skipped buyer was classified');
});

test('execution budget: with the budget spent, no AI call is made and nobody is guessed into a lead', async () => {
  mode = 'ok'; calls = 0;
  /* $3.15 execution budget, all of it already committed to Actor runs. */
  const m = memDb({
    find_buyers_campaigns: [{ matching_job_id: 'job-ai', metrics: {}, provider_budget_micros: 3_150_000 }],
    find_buyers_actor_runs: [{ id: 'r-spent', matching_job_id: 'job-ai', status: 'SUCCEEDED', reserved_micros: 3_150_000, actual_micros: 3_150_000, requested_limit: 100, cost_booked_at: '2026-10-18T10:00:00Z' }],
    find_buyers_cost_ledger: [], find_buyers_leads: [], find_buyers_assessments: [], find_buyers_persons: [], raw_signals: [], source_registry: [],
  });
  const out = await processItems(ctxFor(m.db), [post(41, BUYER), post(42, TRANSLIT_BUYER)]);
  assert.equal(calls, 0, 'no OpenAI request past the ceiling');
  assert.equal(out.aiBudgetRefused, 2, 'the refused candidates are counted');
  assert.equal(m.tables.find_buyers_leads.length, 0, 'no lead without an AI verdict');
  const a = m.tables.find_buyers_assessments.find((r) => r.qualification?.ai?.status === 'UNVERIFIED');
  assert.ok(a, 'they stay UNVERIFIED');
});

test('execution budget: OpenAI already booked counts — the gate admits only what is left', async () => {
  mode = 'ok'; calls = 0;
  const m = memDb({
    find_buyers_campaigns: [{ matching_job_id: 'job-ai', metrics: {}, provider_budget_micros: 3_150_000 }],
    find_buyers_actor_runs: [{ id: 'r1', matching_job_id: 'job-ai', status: 'SUCCEEDED', reserved_micros: 3_000_000, actual_micros: 3_000_000, requested_limit: 20, cost_booked_at: '2026-10-18T10:00:00Z' }],
    /* $0.1498 of OpenAI already spent: $0.0002 left, below one call's ceiling (≈ $0.0005 for one item). */
    find_buyers_cost_ledger: [{ matching_job_id: 'job-ai', provider: 'OPENAI', after_settlement: false, estimated_micros: 149_800, actual_micros: 149_800 }],
    find_buyers_leads: [], find_buyers_assessments: [], find_buyers_persons: [], raw_signals: [], source_registry: [],
  });
  await processItems(ctxFor(m.db), [post(51, BUYER)]);
  assert.equal(calls, 0, 'a call that could pass the ceiling is not started');
});
