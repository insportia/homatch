// HOMI cost round (owner, 2026-10-29): chat unlimited in every plan but much
// cheaper per turn, voice free, and no other person's data in the prompt.
//
// Pure logic is tested directly (contextPlan.ts, router.ts); the edge
// function's walls are pinned on its source, on code and not on comments.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { routeHomiTurn } from '../router.ts';
import { decideTurnPolicy } from '../webPolicy.ts';
import {
  abuseLimitsFrom, abuseVerdict, DEFAULT_ABUSE_LIMITS, internalDataForPrompt, isReasoningModel, planInternalSections,
  repeatedRun, SECTION_BUDGET, TIER_BUDGET, webBudget,
} from '../contextPlan.ts';

const root = new URL('../../../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const edgeRaw = read('supabase/functions/homatch-ai/index.ts');
const edge = stripComments(edgeRaw);

const det = (text, opts) => {
  const r = routeHomiTurn(text, opts);
  return r.kind === 'DETERMINISTIC' ? r.intent : `MODEL_${r.tier}`;
};

/* ── Privacy ─────────────────────────────────────────────────────────── */

test('PRIVACY: HOMI never reads other people\'s intents into a prompt (full audit: homiPrivacy.test.mjs)', () => {
  assert.doesNotMatch(edge, /intent_profiles/, 'intent_profiles is other people\'s data');
  assert.doesNotMatch(edge, /original_text\.ilike/, 'no free-text search across users');
  assert.match(edge, /loadOwnContext\(sb, uid, sections,/);
  assert.match(edge, /intents: 0/, 'old clients still get a count, always zero');
});

/* ── Routing ─────────────────────────────────────────────────────────── */

test('ordinary questions stay on the light tier; current facts and research go full', () => {
  for (const q of [
    'What taxes do I pay when I buy a flat?',
    'რა გადასახადს ვიხდი ბინის ყიდვისას?',
    'Какой налог на недвижимость в Грузии?',
    'Is the price of this flat fair?',
    'Is Vake good for families?',
  ]) assert.equal(det(q), 'MODEL_LIGHT', q);
  for (const q of [
    'What is the latest news about this developer?',
    'რა ხდება დღეს ბინების ფასებზე ვაკეში?',
    'Compare Vake and Saburtalo for a family',
    'შეადარე ვაკე და საბურთალო',
    'Check online who owns ABC Development LLC',
  ]) assert.equal(det(q), 'MODEL_FULL', q);
});

test('plans and "is HOMI free?" are written answers in ka, en and ru', () => {
  for (const q of ['What are HOMATCH plans?', 'Is there a free trial?', 'გამოწერა რა ღირს?', 'Какие есть подписки?', 'сколько стоит homatch']) {
    assert.equal(det(q), 'PLANS', q);
  }
  for (const q of ['Is HOMI free?', 'how many messages can I send', 'ჰომი უფასოა?', 'ლიმიტი აქვს ჩატს?', 'HOMI бесплатный?', 'есть лимит?']) {
    assert.equal(det(q), 'HOMI_FREE', q);
  }
  // Not hijacked: a moving plan, a utility tariff, a flat's price.
  assert.notEqual(det('what is the plan for my move'), 'PLANS');
  assert.notEqual(det('ბინის ფასები ვაკეში'), 'PLANS');
  // "Is HOMI free?" is the same answer inside a workspace.
  assert.equal(det('Is HOMI free?', { surface: 'mortgage-consultant' }), 'HOMI_FREE');
});

/* ── Bounded context ─────────────────────────────────────────────────── */

test('a generic turn carries no internal data at all', () => {
  assert.deepEqual(planInternalSections('Is Vake good for families?', { tier: 'LIGHT', service: null }), []);
  assert.deepEqual(planInternalSections('hello, what can you tell me about Batumi', { tier: 'FULL', service: null }), []);
});

test('a turn about their own things carries exactly that section', () => {
  assert.deepEqual(planInternalSections('what did my report say about the mortgage', { tier: 'LIGHT', service: null }), ['verifications']);
  assert.deepEqual(planInternalSections('ჩემი ბინის დამთხვევები მაჩვენე', { tier: 'LIGHT', service: null }).sort(), ['matches', 'properties']);
  assert.deepEqual(planInternalSections('who is interested in my flat', { tier: 'LIGHT', service: 'FIND_BUYERS_TENANTS' }).sort(), ['matches', 'properties']);
  assert.deepEqual(planInternalSections('what visa do I need', { tier: 'LIGHT', service: null }), ['myGeorgia']);
  assert.deepEqual(planInternalSections('anything', { tier: 'LIGHT', service: null, surface: 'my-georgia' }), ['myGeorgia']);
});

test('sections are trimmed by whole entries to the tier budget, and light is smaller', () => {
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: i, text: 'x'.repeat(200) }));
  const light = JSON.parse(internalDataForPrompt({ verifications: rows, properties: [] }, 'LIGHT'));
  const full = JSON.parse(internalDataForPrompt({ verifications: rows }, 'FULL'));
  assert.ok(JSON.stringify(light.verifications).length <= SECTION_BUDGET.LIGHT.verifications);
  assert.ok(full.verifications.length > light.verifications.length);
  assert.equal('properties' in light, false, 'empty sections are not sent');
  assert.equal(internalDataForPrompt({}, 'LIGHT'), '{}');
  assert.ok(TIER_BUDGET.LIGHT.pageContextChars < TIER_BUDGET.FULL.pageContextChars);
  assert.ok(TIER_BUDGET.LIGHT.historyChars < TIER_BUDGET.FULL.historyChars);
  assert.ok(TIER_BUDGET.FULL.pageContextChars < 15000 && TIER_BUDGET.FULL.historyChars < 24000, 'both tiers smaller than before');
});

test('the edge function fetches only the planned sections, with the tier budgets', () => {
  assert.match(edge, /planInternalSections\(last, \{ tier, service: decided\.service, surface: surfaceName \}\)/);
  assert.match(edge, /if \(uid && sections\.size\) \{/, 'a turn with no planned section reads nothing');
  const own = stripComments(read('supabase/functions/homatch-ai/ownContext.ts'));
  for (const s of ['verifications', 'myGeorgia']) assert.ok(own.includes(`if (sections.has('${s}')) {`), s);
  assert.match(own, /if \(sections\.has\('properties'\) \|\| sections\.has\('matches'\)\) \{/);
  assert.match(edge, /internalDataForPrompt\(internal, tier\)/);
  assert.match(edge, /JSON\.stringify\(context\)\.slice\(0, tierBudget\.pageContextChars\)/);
  assert.match(edge, /trimConversation\(\s*recentMsgs/);
  assert.match(edge, /tierBudget\.historyChars/);
});

test('the cache prefix is static: nothing per turn before THIS TURN', () => {
  const start = edge.indexOf('const staticInstructions = `');
  const end = edge.indexOf('${LEAD_EXTRACTION_INSTRUCTION}`;', start);
  assert.ok(start > 0 && end > start);
  const prefix = edge.slice(start, end);
  for (const v of ['languageDirective', 'lang', 'pitchedServices', 'droppedTurns', 'internalRetrievalFailed', 'internalJson',
    'JSON.stringify(context)', 'turnPolicyPrompt', 'webAllowed', 'marketplaceScope', 'tier', 'uid']) {
    assert.ok(!new RegExp(`\\$\\{[^}]*\\b${v.replace(/[.()]/g, (c) => `\\${c}`)}\\b`).test(prefix), `per-turn ${v} inside the cached prefix`);
  }
  assert.match(edge, /const instructions = `\$\{staticInstructions\}\\n\\n\$\{turnInstructions\}`/);
  assert.match(edge, /prompt_cache_key: `homi:\$\{model\}:\$\{surfaceName\.slice\(0, 40\)\}`/);
});

test('the lead block asks the model to omit empty keys, and keeps chips, cards and routing', () => {
  const at = edgeRaw.indexOf('const LEAD_EXTRACTION_INSTRUCTION');
  const block = edgeRaw.slice(at, edgeRaw.indexOf('`;', at));
  assert.match(block, /OMIT every key whose value would be null, false, 0 or empty/);
  for (const k of ['suggested_replies', 'suggested_actions', 'cards', 'blocks', 'pitch_service', '"routing": {"intent": string, "web_mode"']) {
    assert.ok(block.includes(k), k);
  }
  assert.ok(!block.includes('|null'), 'no null alternatives left to fill in');
});

/* ── Models and web ──────────────────────────────────────────────────── */

test('the light model defaults to a cheaper model that the price book prices', () => {
  const m = edge.match(/const LIGHT_MODEL = [^\n]*\|\| '([^']+)';/);
  assert.ok(m, 'LIGHT_MODEL has a code default');
  const lightDefault = m[1];
  assert.notEqual(lightDefault, edge.match(/const MODEL = [^\n]*\|\| '([^']+)';/)[1], 'the light tier is a different model');
  assert.match(edge, /Deno\.env\.get\('HOMI_LIGHT_MODEL'\)/, 'overridable by env');
  const priced = readdirSync(new URL('supabase/migrations/', root))
    .some((f) => f.endsWith('.sql') && new RegExp(`'OPENAI'[^\\n]*'${lightDefault}'[^\\n]*'(INPUT|OUTPUT)_TOKEN'|'${lightDefault}'[^\\n]*'OUTPUT_TOKEN'`).test(read(`supabase/migrations/${f}`)));
  assert.ok(priced, `${lightDefault} has a provider_price_book row in a migration`);
  // A chat model takes no reasoning setting; the web never runs on the light model.
  assert.equal(isReasoningModel('gpt-4o-mini'), false);
  assert.equal(isReasoningModel('gpt-5.6-luna'), true);
  assert.match(edge, /!isReasoningModel\(model\) \? \{\}/);
  assert.match(edge, /tier === 'LIGHT' && !webAllowed \? LIGHT_MODEL : MODEL/);
});

test('web: low context and two calls on full turns, deeper only for company checks or an explicit ask', () => {
  assert.deepEqual(webBudget('FULL', { reason: 'LIVE_DATA' }), { maxToolCalls: 2, contextSize: 'low' });
  assert.deepEqual(webBudget('FULL', { reason: 'LEGAL_OR_TAX' }), { maxToolCalls: 2, contextSize: 'low' });
  assert.deepEqual(webBudget('LIGHT', { reason: 'LIVE_DATA' }), { maxToolCalls: 1, contextSize: 'low' });
  assert.deepEqual(webBudget('FULL', { reason: 'COMPANY_CHECK' }), { maxToolCalls: 4, contextSize: 'medium' });
  assert.deepEqual(webBudget('FULL', { reason: 'EXPLICIT_WEB' }), { maxToolCalls: 4, contextSize: 'medium' });
  assert.equal(decideTurnPolicy('Is Vake good for families?').web, 'OFF');
  assert.match(edge, /search_context_size: web\.contextSize/);
  assert.match(edge, /max_tool_calls: web\.maxToolCalls/);
  assert.doesNotMatch(edge, /search_context_size: 'medium'/);
});

/* ── Unlimited, with an abuse safeguard ─────────────────────────────── */

test('the abuse safeguard is rates a person never reaches, plus a repeat heuristic', () => {
  assert.deepEqual({ ...DEFAULT_ABUSE_LIMITS }, { perMinute: 20, perHour: 300, perDay: 2000, repeatRun: 6 });
  assert.equal(abuseVerdict({ minute: 5, hour: 80, day: 400, repeat: 1 }), 'OK');
  assert.equal(abuseVerdict({ minute: 20, hour: 20, day: 20, repeat: 1 }), 'BURST');
  assert.equal(abuseVerdict({ minute: 1, hour: 300, day: 300, repeat: 1 }), 'SUSTAINED');
  assert.equal(abuseVerdict({ minute: 1, hour: 1, day: 2000, repeat: 1 }), 'SUSTAINED');
  assert.equal(abuseVerdict({ minute: 1, hour: 1, day: 1, repeat: 6 }), 'REPEATING');
  assert.equal(repeatedRun(['a', 'hi!', 'Hi', 'hi']), 3);
  assert.equal(repeatedRun(['a', 'b']), 1);
  assert.deepEqual(abuseLimitsFrom({ perMinute: '30', perHour: null, perDay: 'x' }), { perMinute: 30, perHour: 300, perDay: 2000, repeatRun: 6 });
});

test('no plan quota and no quota copy reach a HOMI user', () => {
  assert.doesNotMatch(edge, /ai_fair_use_daily|RATE_LIMIT_MESSAGES|resetAt|midnight UTC/);
  assert.doesNotMatch(edge, /plan_code[^\n]*limit|dailyLimit/);
  // The refusal carries a gentle sentence and no number.
  const refusal = edge.match(/return json\(\{ error: BURST_MESSAGES\[lang\] \?\? BURST_MESSAGES\.en, code: 'RATE_LIMIT_EXCEEDED'([^}]*)\}/);
  assert.ok(refusal, 'the slow-down refusal exists');
  assert.equal(refusal[1].trim(), '', 'no limit number goes back');
  for (const k of ['homi_abuse_burst_per_minute', 'homi_abuse_hourly_ceiling', 'homi_abuse_daily_ceiling']) assert.ok(edge.includes(`'${k}'`), k);
  const sql = read('supabase/migrations/20261207130000_homi_unlimited_cost_round.sql');
  for (const k of ['homi_abuse_burst_per_minute', 'homi_abuse_hourly_ceiling', 'homi_abuse_daily_ceiling', 'homi_voice_per_minute']) {
    assert.ok(sql.includes(`'${k}'`), `${k} is an admin setting`);
  }
});

/* ── Telemetry ───────────────────────────────────────────────────────── */

test('every model turn records model, tokens, cached tokens, web calls, cost and route', () => {
  for (const f of ['model,', 'input_tokens: inputTokens', 'cached_tokens: cachedTokens', 'output_tokens: outputTokens',
    'cost_cents: Number(aiCents ?? 0)', 'web_calls: searchCount', 'sections: [...sections]', 'promptChars: instructions.length']) {
    assert.ok(edge.includes(f), f);
  }
  assert.match(edge, /route: deterministic \? 'DETERMINISTIC' : `MODEL_\$\{\(route as any\)\.tier\}`/);
  assert.match(edge, /recordUnbilledUsage\(sb, \{/);
  const admin = read('src/pages/admin/AdminHomiServicesPage.tsx');
  const costs = admin.slice(admin.indexOf('{costs ? ('), admin.indexOf(') : (', admin.indexOf('{costs ? (')));
  assert.match(costs, /admin_hs_cache/, 'the AI costs view shows the cache-hit rate');
});

/* ── No paid third-party work from a chat turn ─────────────────────── */

test('HOMI never starts paid third-party work: only OpenAI is called, and chips only navigate', () => {
  const fetches = [...edge.matchAll(/fetch\(\s*'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual(fetches, ['https://api.openai.com/v1/responses']);
  assert.doesNotMatch(edge, /functions\.invoke|\/functions\/v1\//, 'no other edge function is called');
  assert.doesNotMatch(edge, /memo23|apify|meta-ads-api|find-buyers|campaignRun|startCampaign|gpu|runpod|design-studio-|replicate/i);
  // The only tool the model is ever given is web search.
  const tools = [...edge.matchAll(/type: '([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(tools)], ['web_search']);
  // Service chips are catalogue routes that navigate; they never start or spend anything.
  const actions = read('src/components/ai/ServiceActions.tsx');
  assert.ok(actions.includes('routeForAction'));
  assert.doesNotMatch(stripComments(actions), /supabase\.functions|fetch\(|beginExecution/);
  // The only charge path is the paid property analysis and the agent builder, never a HOMI chat turn.
  assert.match(edge, /const BILLED_SURFACES = new Set\(\['agent-builder'\]\)/);
});
