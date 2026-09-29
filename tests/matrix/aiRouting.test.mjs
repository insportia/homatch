// HOMATCH AI ROUTING CONTRACT — the failure class that caused the mandate:
// "immediately search the web, return one link, ignore HOMATCH context and
// services". The behavior lives in the model, but every wall that makes the
// old behavior impossible lives in source, and these tests pin each wall.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { routeForAction, SERVICE_ACTION_CATALOGUE, parseServiceActions } from '../../src/lib/ai/serviceActions.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

const edge = read('supabase/functions/homatch-ai/index.ts');
const hook = read('src/hooks/useAIChat.ts');
const aiPage = read('src/pages/AIPage.tsx');
const propertyPage = read('src/pages/property/PropertyDetailPage.tsx');
const migration = read('supabase/migrations/20260929210000_ai_routing_events.sql');

test('the prompt orders INTERNAL FIRST, before any web directive', () => {
  const order = edge.indexOf('THE ORDER OF EVERY ANSWER');
  const internalRule = edge.indexOf('Use what is ALREADY IN FRONT OF YOU');
  const webRule = edge.indexOf('Never call web_search before you have used what Homatch already knows');
  assert.ok(order !== -1 && internalRule !== -1 && webRule !== -1);
  assert.ok(order < internalRule && internalRule < webRule, 'ordering doctrine reads internal → web');
});

test('all four routing modes exist and web stays available', () => {
  for (const mode of ['NO_WEB', 'SUPPLEMENTAL_WEB', 'REQUIRED_LIVE_WEB', 'SPECIALIZED_HOMATCH_WORKFLOW']) {
    assert.ok(edge.includes(mode), mode);
  }
  // Web is never disabled: the tool is still offered on every call.
  assert.match(edge, /type: 'web_search'/);
  // A service existing must never mean refusing to answer.
  assert.ok(edge.includes('A service existing NEVER means refusing to answer'));
});

test('one link is not an answer: synthesis + stop conditions are in the contract', () => {
  assert.ok(edge.includes('RESEARCH IS SYNTHESIS, NOT A LINK'));
  assert.ok(edge.includes('A reply whose substance is one URL is a failure'));
  // Depth follows the question — the honest stop condition both ways.
  assert.ok(edge.includes('one authoritative source is enough'));
  assert.ok(edge.includes('one random listing is not'));
  // The one-search-one-link root cause: low effort stopped at first result.
  assert.match(edge, /reasoning: \{ effort: 'medium' \}/);
});

test('page context actually reaches the edge function (the silent-drop bug)', () => {
  // useAIChat sends the WHOLE context (type + data), not just `.data`.
  assert.ok(hook.includes("{ type: pageContext.type, ...(pageContext.data ?? {}) }"));
  // AIPage normalizes the legacy {type, id, title} sender shape.
  assert.ok(aiPage.includes('const { type, data, ...rest } = ctx.context'));
  // The property page sends structured data with a propertyId.
  assert.ok(propertyPage.includes("data: { propertyId: id"));
});

test('internal retrieval failure is visible, never silent', () => {
  assert.ok(edge.includes('internalRetrievalFailed = true'));
  assert.ok(edge.includes('internal data retrieval FAILED this turn'));
  assert.ok(edge.includes('internal_failed: internalRetrievalFailed'));
});

test('every turn writes routing telemetry, and it is admin-only in the DB', () => {
  assert.ok(edge.includes("from('ai_routing_events').insert"));
  for (const field of ['intent', 'web_mode', 'internal_used', 'web_calls', 'internal_counts', 'action_ids', 'latency_ms']) {
    assert.ok(edge.includes(field), `telemetry field ${field}`);
  }
  assert.match(migration, /FOR SELECT USING \(public\.is_admin\(\)\)/);
  assert.match(migration, /web_mode text NOT NULL DEFAULT 'NO_WEB' CHECK/);
});

test('Meta Ads is a routed native action with property context carried in code', () => {
  assert.equal(SERVICE_ACTION_CATALOGUE.META_ADS.route, '/outreach/meta/create');
  const [action] = parseServiceActions(['META_ADS']);
  assert.equal(routeForAction(action, { propertyId: '245310' }), '/outreach/meta/create?property=245310');
  assert.equal(routeForAction(action, {}), '/outreach/meta/create');
  // The prompt knows the product and forbids the Facebook-docs cop-out.
  assert.ok(edge.includes('Meta Ads (/outreach/meta)'));
  assert.ok(edge.includes('never send them to Facebook documentation'));
});

test('context params only where destinations actually parse them', () => {
  const [verify] = parseServiceActions(['VERIFY']);
  assert.equal(routeForAction(verify, { propertyId: '245310' }), '/verify', 'VERIFY takes no propertyId param');
  assert.equal(routeForAction(verify, { cadastralCode: '01.10.14.007.058' }), '/verify?code=01.10.14.007.058');
  const [mortgage] = parseServiceActions(['MORTGAGE']);
  assert.equal(routeForAction(mortgage, { propertyId: 'x' }), '/mortgage');
});

test('the model reports its routing in the same JSON contract, validated server-side', () => {
  assert.ok(edge.includes('"routing": {"intent": string, "web_mode"'));
  assert.ok(edge.includes('WEB_MODES.has(routingRaw.web_mode)'));
  // Fallback stays truthful: derived from the REAL search count.
  assert.ok(edge.includes("searchCount > 0 ? 'REQUIRED_LIVE_WEB' : 'NO_WEB'"));
});

test('reply chips and action chips stay two different species', () => {
  const actions = read('src/components/ai/ServiceActions.tsx');
  const replies = read('src/components/ai/SuggestedReplies.tsx');
  assert.ok(actions.includes('routeForAction'), 'actions navigate through the code-owned resolver');
  assert.ok(!replies.includes('navigate('), 'replies never navigate');
});
