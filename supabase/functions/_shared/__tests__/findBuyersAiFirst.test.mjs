// FIND BUYERS — code-first lead classification through the live pipeline, with a stubbed
// OpenAI endpoint (no network, no key, no cost). Owner, 2026-10-29: the rules decide; the model
// (fb-ai-2) is asked only when admin_settings.find_buyers_ai_ambiguous is on, only for the
// candidates the rules mark explicitly ambiguous, and for at most 20 distinct texts per run.
// Regression kept: the two brokers campaign 343cfc41 showed as buyers are no leads; a broker
// with a client is shown apart and never qualified; same words classified once.
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
/* No direction either way: the rules mark these explicitly ambiguous (needsModel, real estate). */
const AMBIG = 'ბინა მაინტერესებს კრწანისში';
const AMBIG_RU = 'Квартира в Крцаниси, 3 комнаты';

/** A stand-in for the model: decides by the words, like a reviewer would. */
function fakeModel(text) {
  if (/კლიენტები|ჩამიყარეთ/.test(text)) return { role: 'BROKER_COLLECTING_LISTINGS', confidence: 0.95, transaction: 'BUY', evidence: ['ჩამიყარეთ გასაყიდი ბინები'] };
  if (/خدمة|مهتمين/.test(text)) return { role: 'SERVICE_PROVIDER', confidence: 0.92, transaction: 'BUY', evidence: ['أقدم لكم خدمة متكاملة'] };
  if (/a client who wants/.test(text)) return { role: 'BROKER_WITH_CLIENT', confidence: 0.9, transaction: 'BUY', evidence: ['I have a client who wants to buy'] };
  if (/ვყიდულობ/.test(text)) return { role: 'DIRECT_BUYER', confidence: 0.9, transaction: 'BUY', compatibility: 'COMPATIBLE', evidence: ['ვყიდულობ 3 ოთახიან ბინას'] };
  if (/მაინტერესებს/.test(text)) return { role: 'DIRECT_BUYER', confidence: 0.9, transaction: 'BUY', compatibility: 'COMPATIBLE', evidence: ['ბინა მაინტერესებს'] };
  if (/Крцаниси/.test(text)) return { role: 'SELLER_OR_LANDLORD', confidence: 0.9, transaction: 'BUY', evidence: ['Квартира в Крцаниси'] };
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

const ctxFor = (db, extra = {}) => ({
  db, stage: 'FB_GROUP_POSTS', runId: 'run-ai', runLanguage: 'multi', datasetId: 'ds', providerRunId: 'pr',
  book: { model: 'gpt-4o-mini', inputPerMTokMicros: 150000, outputPerMTokMicros: 600000 },
  gate: { skipBelow: 55, eligibleFrom: 75 }, parent: null, sourceId: 'src-1', sourceYield: null, now: NOW,
  campaign: { matching_job_id: 'job-ai', campaign_id: 'c', property_id: 'p', user_id: 'u', transaction: 'SALE', dna },
  ...extra,
});
const ON = { aiAmbiguous: true };
const post = (n, text, author = `Person ${n}`) => ({
  kind: 'POST', network: 'FACEBOOK', externalId: `post:${n}`, url: `https://www.facebook.com/groups/1/permalink/${n}/`, parentExternalId: null, parentUrl: null,
  author: { id: `a${n}`, name: author, url: null, handle: null }, text, publishedAt: '2026-10-18T10:00:00Z',
  engagement: { comments: null, likes: null, shares: null }, group: null, inlineComments: [],
});
const freshDb = () => memDb({ find_buyers_campaigns: [{ matching_job_id: 'job-ai', metrics: {}, provider_budget_micros: 3_150_000 }], find_buyers_leads: [], find_buyers_assessments: [], find_buyers_persons: [], raw_signals: [], source_registry: [] });

test('code first (default): the 343cfc41 brokers are no leads, a broker with a client is shown apart — with no model call', async () => {
  mode = 'ok'; calls = 0; sentItems = 0;
  const m = freshDb(); const db = m.db;
  const out = await processItems(ctxFor(db), [post(1, BROKER_COLLECTING, 'ლიი ლიი'), post(2, BROKER_SERVICE, 'Giorgi Etsadeishvili'), post(3, BUYER), post(4, BROKER_CLIENT), post(5, AMBIG)]);
  assert.equal(calls, 0, 'no OpenAI request with the switch off');
  assert.equal(out.aiCalls, 0);
  assert.ok(!m.rpcs.some((r) => r.n === 'find_buyers_record_ai_cost'), 'no AI cost');
  const leads = m.tables.find_buyers_leads;
  const textOf = (l) => l.evidence?.[0]?.text ?? '';
  assert.ok(!leads.some((l) => textOf(l).includes('ჩამიყარეთ')), 'the listing-collecting broker is no lead');
  assert.ok(!leads.some((l) => textOf(l).includes('خدمة')), 'the service broker is no lead');
  const buyer = leads.find((l) => textOf(l).startsWith('ვყიდულობ'));
  assert.ok(buyer && ['STRONG', 'POTENTIAL', 'WEAK'].includes(buyer.match_category), 'the rule buyer is a lead');
  const viaBroker = leads.find((l) => textOf(l).includes('a client who wants'));
  assert.ok(viaBroker, 'a broker with a client is kept…');
  assert.equal(viaBroker.role, 'AGENT');
  assert.equal(viaBroker.match_category, 'WEAK', '…never above Weak');
  assert.ok(viaBroker.qualification.limitations.includes('BUYER_VIA_BROKER'));
  assert.ok(!leads.some((l) => textOf(l).includes('მაინტერესებს')), 'an ambiguous text is never promoted to a lead');
  assert.ok(out.qualified <= 1, 'only the direct buyer can count as qualified');
  const methods = m.tables.find_buyers_assessments.map((r) => r.intent_method);
  assert.ok(methods.every((x) => !String(x).startsWith('AI') && !String(x).startsWith('UNVERIFIED')), `rules decided every candidate: ${methods}`);
});

test('switch ON: only explicitly ambiguous candidates reach the model, in one batch', async () => {
  mode = 'ok'; calls = 0; sentItems = 0;
  const m = freshDb(); const db = m.db;
  const out = await processItems(ctxFor(db, ON), [post(61, BUYER), post(62, BROKER_COLLECTING), post(63, AMBIG), post(64, AMBIG_RU)]);
  assert.equal(calls, 1, 'one batched call');
  assert.equal(sentItems, 2, 'the buyer and the broker were decided by rules and never sent');
  assert.equal(out.aiCalls, 1);
  assert.ok(m.rpcs.some((r) => r.n === 'find_buyers_record_ai_cost' && r.a.p_operation === 'AI_CLASSIFY'), 'the AI cost is recorded');
  const a = m.tables.find_buyers_assessments.find((r) => r.intent_method === 'AI:DIRECT_BUYER');
  assert.ok(a, 'the assessment records the AI decision on the ambiguous text');
  assert.equal(a.qualification.ai.version, 'fb-ai-2');
  assert.equal(a.qualification.ai.model, 'gpt-4o-mini');
  assert.ok(m.tables.find_buyers_assessments.some((r) => r.intent_method === 'AI:SELLER_OR_LANDLORD'));
  assert.ok(m.tables.find_buyers_leads.some((l) => (l.evidence?.[0]?.text ?? '').startsWith('ვყიდულობ')), 'the rule buyer is still a lead');
});

test('switch ON: a hard cap of 20 distinct ambiguous texts per run', async () => {
  mode = 'ok'; calls = 0; sentItems = 0;
  const m = freshDb();
  const items = Array.from({ length: 25 }, (_, n) => post(100 + n, `${AMBIG}, სართული ${n + 1}`));
  await processItems(ctxFor(m.db, ON), items);
  assert.equal(sentItems, 20, 'never more than 20 items to the model in one run');
});

test('switch ON: an uncertain model answer is never shown', async () => {
  mode = 'ok';
  const m = freshDb(); const db = m.db;
  const prev = globalThis.fetch;
  globalThis.fetch = async (_u, init) => {
    const user = JSON.parse(JSON.parse(init.body).messages[1].content);
    const items = user.items.map((it) => ({ id: it.id, subject: 'REAL_ESTATE', offers_property: false, role: 'DIRECT_BUYER', confidence: 0.4, transaction: 'BUY', compatibility: 'UNKNOWN', budget: null, location: null, contradictions: [], evidence: [], reason: 'unsure' }));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ items }) } }], usage: { prompt_tokens: 10, completion_tokens: 10 } }), { status: 200 });
  };
  await processItems(ctxFor(db, ON), [post(11, AMBIG)]);
  globalThis.fetch = prev;
  assert.equal(m.tables.find_buyers_leads.length, 0);
});

test('switch ON: when the model fails, the ambiguous candidate keeps its rule reading — no lead', async () => {
  mode = 'fail'; calls = 0;
  const m = freshDb(); const db = m.db;
  await processItems(ctxFor(db, ON), [post(21, AMBIG), post(22, BROKER_COLLECTING)]);
  assert.equal(m.tables.find_buyers_leads.length, 0, 'no lead without a verdict');
  assert.equal(calls, 2, 'one retry, then the rule reading stands');
  const a = m.tables.find_buyers_assessments.find((r) => r.role === 'UNCLEAR');
  assert.ok(a, 'the ambiguous candidate stays UNCLEAR');
  mode = 'ok';
});

test('switch ON: the same ambiguous words in one read are classified once', async () => {
  mode = 'ok'; calls = 0; sentItems = 0;
  const m = freshDb(); const db = m.db;
  await processItems(ctxFor(db, ON), [post(31, AMBIG, 'A'), post(32, AMBIG, 'B'), post(33, AMBIG, 'C')]);
  assert.equal(sentItems, 1);
});

test('fb-ai-2: a listing or a USDT trade is decided by rules and never becomes a lead', async () => {
  mode = 'ok'; calls = 0;
  const m = freshDb();
  await processItems(ctxFor(m.db, ON), [
    post(41, '🏡 2-Bedroom Apartment For rent in Krtsanisi, Tbilisi · 900$ per month'),
    post(42, 'Куплю U.S.D.T за наличные'),
  ]);
  assert.equal(calls, 0, 'neither is ambiguous: no model call even with the switch on');
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
  await processItems(ctxFor(m.db, ON), [post(51, AMBIG_RU), post(52, AMBIG)]);
  globalThis.fetch = prev;
  assert.equal(n, 2, 'one batch call + one call for the skipped item');
  assert.ok(m.tables.find_buyers_assessments.some((r) => r.intent_method === 'AI:DIRECT_BUYER'), 'the skipped item was classified');
});

test('switch ON, execution budget: with the budget spent, no AI call is made and nobody is guessed into a lead', async () => {
  mode = 'ok'; calls = 0;
  /* $3.15 execution budget, all of it already committed to Actor runs. */
  const m = memDb({
    find_buyers_campaigns: [{ matching_job_id: 'job-ai', metrics: {}, provider_budget_micros: 3_150_000 }],
    find_buyers_actor_runs: [{ id: 'r-spent', matching_job_id: 'job-ai', status: 'SUCCEEDED', reserved_micros: 3_150_000, actual_micros: 3_150_000, requested_limit: 100, cost_booked_at: '2026-10-18T10:00:00Z' }],
    find_buyers_cost_ledger: [], find_buyers_leads: [], find_buyers_assessments: [], find_buyers_persons: [], raw_signals: [], source_registry: [],
  });
  const out = await processItems(ctxFor(m.db, ON), [post(41, AMBIG), post(42, AMBIG_RU)]);
  assert.equal(calls, 0, 'no OpenAI request past the ceiling');
  assert.equal(out.aiBudgetRefused, 2, 'the refused candidates are counted');
  assert.equal(m.tables.find_buyers_leads.length, 0, 'an ambiguous candidate is never guessed into a lead');
});

test('switch ON, execution budget: OpenAI already booked counts — the gate admits only what is left', async () => {
  mode = 'ok'; calls = 0;
  const m = memDb({
    find_buyers_campaigns: [{ matching_job_id: 'job-ai', metrics: {}, provider_budget_micros: 3_150_000 }],
    find_buyers_actor_runs: [{ id: 'r1', matching_job_id: 'job-ai', status: 'SUCCEEDED', reserved_micros: 3_000_000, actual_micros: 3_000_000, requested_limit: 20, cost_booked_at: '2026-10-18T10:00:00Z' }],
    /* $0.1498 of OpenAI already spent: $0.0002 left, below one call's ceiling (≈ $0.0005 for one item). */
    find_buyers_cost_ledger: [{ matching_job_id: 'job-ai', provider: 'OPENAI', after_settlement: false, estimated_micros: 149_800, actual_micros: 149_800 }],
    find_buyers_leads: [], find_buyers_assessments: [], find_buyers_persons: [], raw_signals: [], source_registry: [],
  });
  await processItems(ctxFor(m.db, ON), [post(51, AMBIG)]);
  assert.equal(calls, 0, 'a call that could pass the ceiling is not started');
});
