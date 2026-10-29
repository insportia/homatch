// FIND PROPERTY MAKES ZERO AI CALLS (owner, 2026-10-29, binding).
//
// The whole search execution path — query interpretation, ranking, Results Intelligence and
// every fallback and error path — is code. This proves it from source:
//
//   1. It walks the STATIC import graph (relative imports, re-exports, literal dynamic
//      imports, transitively) from every edge function on the path, and follows every edge
//      function those modules call (functions/v1/<name>, functions.invoke('<name>')) into
//      that function's own graph. No reachable module may talk to a model: no OpenAI /
//      Anthropic / Gemini / Mistral endpoint, no SDK, no model API key read, none of the
//      repository's model helpers.
//   2. Each path function installs the runtime no-model guard, which refuses (and counts)
//      any request to a model provider while it runs; the guard itself is unit-tested.
//   3. The customer client of the search only talks to the search functions.
//
// Before this change a Find Property search made 2 model calls (understand + Results
// Intelligence) on the marketplace path and 1 (find-property-plan draft) on the legacy path.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');

/** The functions a Find Property search executes in. */
export const SEARCH_PATH_FUNCTIONS = ['marketplace-search', 'marketplace-worker-ingest', 'find-property-plan', 'find-property'];

const MODEL_CALL = [
  /api\.openai\.com/, /api\.anthropic\.com/, /generativelanguage\.googleapis\.com/, /api\.mistral\.ai/, /api\.groq\.com/, /openrouter\.ai/,
  /OPENAI_API_KEY/, /ANTHROPIC_API_KEY/, /GEMINI_API_KEY/, /OPENAI_[A-Z_]*MODEL/,
  /\/v1\/chat\/completions/, /\/v1\/responses/,
  /\bopenaiStructured\s*\(/, /\bopenAiJson\s*\(/, /\bclassifyCandidates\s*\(/,
];
const MODEL_MODULES = [
  /(^|[/:@])openai(@[^/]*)?($|\/)/, /@anthropic-ai\//, /@google\/generative-ai/,
  /_shared\/findBuyers\/(openai|aiClassify|aiReplay|translate)\.ts$/,
  /_shared\/(providers|propertyChatAi|emailStudio|jobs)\.ts$/,
];
/** Functions that are themselves AI products; reaching one from search is a failure. */
const AI_FUNCTIONS = /^(homatch-ai|research-agent|classify-signals(-v2)?|ai-|investment-consultant|contract-analysis)/;

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

function importsOf(src) {
  const specs = new Set();
  for (const m of src.matchAll(/\b(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g)) specs.add(m[1]);
  for (const m of src.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) specs.add(m[1]);
  for (const m of src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.add(m[1]);
  return [...specs];
}

const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };
function resolveSpec(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const cand of [base, `${base}.ts`, `${base}.mjs`, `${base}.js`, join(base, 'index.ts')]) if (isFile(cand)) return cand;
  return null;
}

/** Edge functions a module calls by name. */
function calledFunctions(code) {
  const names = new Set();
  for (const m of code.matchAll(/functions\/v1\/([a-z0-9-]+)/g)) names.add(m[1]);
  for (const m of code.matchAll(/functions\.invoke\(\s*['"`]([a-z0-9-]+)['"`]/g)) names.add(m[1]);
  return [...names];
}

/** Every module reachable from the function entries, following called functions too. */
export function searchGraph(functionNames) {
  const seen = new Map();
  const queue = [];
  const external = [];
  const functions = new Set();
  const addFunction = (name, chain) => {
    if (functions.has(name)) return;
    functions.add(name);
    const entry = join(ROOT, 'supabase/functions', name, 'index.ts');
    if (!existsSync(entry)) return;
    if (!seen.has(entry)) { seen.set(entry, [...chain, rel(entry)]); queue.push(entry); }
  };
  for (const name of functionNames) addFunction(name, []);
  while (queue.length) {
    const file = queue.shift();
    const src = readFileSync(file, 'utf8');
    for (const spec of importsOf(src)) {
      const target = resolveSpec(file, spec);
      if (!target) { external.push({ spec, chain: seen.get(file) }); continue; }
      if (seen.has(target)) continue;
      seen.set(target, [...seen.get(file), rel(target)]);
      queue.push(target);
    }
    for (const name of calledFunctions(stripComments(src))) addFunction(name, seen.get(file));
  }
  return { modules: seen, external, functions };
}

function modelReach(functionNames) {
  const { modules, external, functions } = searchGraph(functionNames);
  const hits = [];
  for (const [file, chain] of modules) {
    const r = rel(file);
    if (MODEL_MODULES.some((re) => re.test(r))) { hits.push(`${chain.join(' → ')} (a model helper)`); continue; }
    /* The guard names the provider hosts in order to refuse them. */
    if (r === 'supabase/functions/_shared/noModelGuard.ts') continue;
    const code = stripComments(readFileSync(file, 'utf8'));
    const re = MODEL_CALL.find((x) => x.test(code));
    if (re) hits.push(`${chain.join(' → ')} (${re})`);
  }
  for (const { spec, chain } of external) if (MODEL_MODULES.some((re) => re.test(spec))) hits.push(`${chain.join(' → ')} → ${spec}`);
  for (const name of functions) if (AI_FUNCTIONS.test(name)) hits.push(`calls the AI function ${name}`);
  return { hits, size: modules.size, functions: [...functions] };
}

for (const name of SEARCH_PATH_FUNCTIONS) {
  test(`zero AI: nothing reachable from ${name} (imports and called functions, every path) calls a model`, () => {
    assert.ok(existsSync(join(ROOT, 'supabase/functions', name, 'index.ts')), name);
    const { hits, size } = modelReach([name]);
    assert.ok(size > 3, `${name}: graph of ${size} modules`);
    assert.deepEqual(hits, [], `a model call is reachable from Find Property:\n${hits.join('\n')}`);
  });
}

test('zero AI: the search path as a whole (all functions together, their callees included)', () => {
  const { hits, functions, size } = modelReach(SEARCH_PATH_FUNCTIONS);
  console.log(`find property search path: ${size} modules, functions ${functions.sort().join(', ')}; model calls per search: 0`);
  assert.deepEqual(hits, []);
});

test('the detector works: it does find the model behind HOMI chat and behind Find Buyers', () => {
  assert.ok(modelReach(['homatch-ai']).hits.length > 0, 'homatch-ai reaches a model');
  assert.ok(modelReach(['classify-signals-v2']).hits.length > 0, 'classify-signals-v2 reaches a model (behind its switch)');
});

test('no fallback to a model: the retired prompts, schemas-as-prompts and quota are gone from the path', () => {
  const ms = readFileSync(join(ROOT, 'supabase/functions/marketplace-search/index.ts'), 'utf8');
  const sh = readFileSync(join(ROOT, 'supabase/functions/_shared/marketplaceSearch.ts'), 'utf8');
  const plan = readFileSync(join(ROOT, 'supabase/functions/find-property-plan/index.ts'), 'utf8');
  for (const src of [ms, sh, plan]) {
    assert.doesNotMatch(stripComments(src), /SEARCH_BRIEF_INSTRUCTIONS|RESULTS_INTELLIGENCE_INSTRUCTIONS|SYSTEM_PROMPT|consumeUnderstandQuota|recordAiUsage|gpt-/);
  }
  assert.match(ms, /understandSearchText\(text, \{ converter \}\)/, 'understand reads with the deterministic engine');
  assert.match(sh, /applyIntelligence\(properties, deterministicIntelligence\(properties, request\)\)/, 'Results Intelligence is code');
  assert.match(plan, /readConstraints\(text\)/, 'the legacy planner drafts with the deterministic reader');
  const brief = readFileSync(join(ROOT, 'src/research-core/marketplace/brief.ts'), 'utf8');
  assert.doesNotMatch(brief, /SEARCH_BRIEF_INSTRUCTIONS/);
});

test('runtime guard: every search-path function installs the no-model guard first', () => {
  for (const name of SEARCH_PATH_FUNCTIONS) {
    const src = readFileSync(join(ROOT, 'supabase/functions', name, 'index.ts'), 'utf8');
    assert.match(src, new RegExp(`installNoModelGuard\\('${name}'\\)`), name);
  }
});

test('paid Deep Search (find-property-run): no direct model call, and the runtime guard refuses any', () => {
  /* Its graph reaches the Find Buyers campaign module only through shared run bookkeeping
     (discoveryRun → campaignRun); that module's model planning is behind the default-OFF
     find_buyers_ai_planning switch, and this function's isolate refuses model requests. */
  const src = readFileSync(join(ROOT, 'supabase/functions/find-property-run/index.ts'), 'utf8');
  assert.match(src, /installNoModelGuard\('find-property-run'\)/);
  assert.doesNotMatch(stripComments(src), new RegExp(MODEL_CALL.map((r) => r.source).join('|')));
});

test('runtime guard: a request to a model provider is refused and counted; everything else passes through', async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => { calls.push(String(input?.url ?? input)); return new Response('ok'); };
  const errors = console.error;
  console.error = () => {};
  try {
    const guard = await import(pathToFileURL(join(ROOT, 'supabase/functions/_shared/noModelGuard.ts')).href);
    guard.installNoModelGuard('test-fn');
    guard.installNoModelGuard('test-fn');
    await assert.rejects(() => fetch('https://api.openai.com/v1/responses', { method: 'POST' }), /MODEL_CALL_BLOCKED/);
    await assert.rejects(() => fetch(new URL('https://api.anthropic.com/v1/messages')), /MODEL_CALL_BLOCKED/);
    await assert.rejects(() => fetch(new Request('https://generativelanguage.googleapis.com/v1/models')), /MODEL_CALL_BLOCKED/);
    assert.equal((await fetch('https://example.supabase.co/rest/v1/x')).status, 200);
    assert.deepEqual(calls, ['https://example.supabase.co/rest/v1/x'], 'a refused request never leaves the process');
    assert.equal(guard.modelCallsBlocked().count, 3);
    assert.equal(guard.isModelEndpoint('https://api.openai.com.evil.example/'), false);
    assert.equal(guard.isModelEndpoint('https://eu.api.openai.com/v1'), true);
  } finally {
    globalThis.fetch = original;
    console.error = errors;
  }
});

test('the customer client of the search talks only to the search functions', () => {
  const client = readFileSync(join(ROOT, 'src/services/marketplaceSearch.ts'), 'utf8');
  const invoked = [...client.matchAll(/functions\.invoke\(\s*['"`]([a-z0-9-]+)['"`]/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(invoked)], ['marketplace-search']);
  const experience = readFileSync(join(ROOT, 'src/components/findProperty/MarketplaceSearchExperience.tsx'), 'utf8');
  assert.doesNotMatch(experience, /homatch-ai/, 'paid HOMI analysis (PropertyAI) is only reached by the customer opening it');
});
