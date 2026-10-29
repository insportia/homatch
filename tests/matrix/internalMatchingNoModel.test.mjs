// INTERNAL MATCHING IS CODE ONLY (owner, 2026-10-29).
//
// Internal buyer/tenant matching — run-matching-v2, supply-matching, the continuous matching
// worker and the SQL tiers behind internal_match_* — must never call a language model. It is
// unlimited in every plan, so a model call there is an unbounded cost, and a match explanation
// must be reproducible from code.
//
// This walks the STATIC import graph from each entry point (relative imports, re-exports and
// literal dynamic imports, transitively) and asserts no reachable module talks to a model:
// no OpenAI / Anthropic / Gemini endpoint, no OpenAI SDK, no OPENAI_API_KEY read, and none of
// the repository's own model helpers. A module added to the graph later that does is a failure
// here, with the import chain that reached it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');

/** What a model call looks like in source. Comments are stripped before matching. */
const MODEL_CALL = [
  /api\.openai\.com/, /api\.anthropic\.com/, /generativelanguage\.googleapis\.com/,
  /OPENAI_API_KEY/, /ANTHROPIC_API_KEY/,
  /\bopenAiJson\s*\(/, /\bclassifyCandidates\s*\(/,
];
/** Imports that are a model client by themselves (SDKs, the repo's own helpers). */
const MODEL_MODULES = [
  /(^|[/:@])openai(@[^/]*)?($|\/)/, /@anthropic-ai\//,
  /_shared\/findBuyers\/(openai|aiClassify|aiReplay|translate)\.ts$/,
  /_shared\/(providers|propertyChatAi|emailStudio|jobs)\.ts$/,
];

const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

function importsOf(file) {
  const src = readFileSync(file, 'utf8');
  const specs = new Set();
  for (const m of src.matchAll(/\b(?:import|export)\s[^'"`;]*?\sfrom\s*['"]([^'"]+)['"]/g)) specs.add(m[1]);
  for (const m of src.matchAll(/\bimport\s*['"]([^'"]+)['"]/g)) specs.add(m[1]);
  for (const m of src.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) specs.add(m[1]);
  return [...specs];
}

function resolveSpec(from, spec) {
  if (!spec.startsWith('.')) return null;
  const base = resolve(dirname(from), spec);
  for (const cand of [base, `${base}.ts`, `${base}.mjs`, `${base}.js`, join(base, 'index.ts')]) {
    if (existsSync(cand) && readdirSafe(cand) === null) return cand;
  }
  return null;
}
function readdirSafe(p) { try { return readdirSync(p); } catch { return null; } }

/** Every module reachable from `entry`, with the chain that reached it. */
function walk(entry) {
  const seen = new Map([[entry, [rel(entry)]]]);
  const queue = [entry];
  const external = [];
  while (queue.length) {
    const file = queue.shift();
    for (const spec of importsOf(file)) {
      const target = resolveSpec(file, spec);
      if (!target) { external.push({ spec, chain: seen.get(file) }); continue; }
      if (seen.has(target)) continue;
      seen.set(target, [...seen.get(file), rel(target)]);
      queue.push(target);
    }
  }
  return { modules: seen, external };
}

function modelReach(entry) {
  const { modules, external } = walk(entry);
  const hits = [];
  for (const [file, chain] of modules) {
    const r = rel(file);
    if (MODEL_MODULES.some((re) => re.test(r))) { hits.push(`${chain.join(' → ')} (a model helper)`); continue; }
    const code = stripComments(readFileSync(file, 'utf8'));
    const re = MODEL_CALL.find((x) => x.test(code));
    if (re) hits.push(`${chain.join(' → ')} (${re})`);
  }
  for (const { spec, chain } of external) if (MODEL_MODULES.some((re) => re.test(spec))) hits.push(`${chain.join(' → ')} → ${spec}`);
  return { hits, size: modules.size };
}

const ENTRIES = [
  'supabase/functions/run-matching-v2/index.ts',
  'supabase/functions/supply-matching/index.ts',
  'supabase/functions/continuous-matching-worker/index.ts',
];

for (const entry of ENTRIES) {
  test(`internal matching is code only: nothing reachable from ${entry} calls a model`, () => {
    const file = join(ROOT, entry);
    assert.ok(existsSync(file), `${entry} exists`);
    const { hits, size } = modelReach(file);
    assert.ok(size >= 1);
    assert.deepEqual(hits, [], `a model call is reachable from internal matching:\n${hits.join('\n')}`);
  });
}

test('the detector itself works: a Find Buyers pipeline does reach a model helper (so a clean result above means something)', () => {
  const { hits } = modelReach(join(ROOT, 'supabase/functions/_shared/findBuyers/pipeline.ts'));
  assert.ok(hits.length > 0, 'the walker must see aiClassify/openai behind the pipeline');
});

test('the SQL tiers of internal matching call no model and reach only code-only matching functions', () => {
  const dir = join(ROOT, 'supabase/migrations');
  const allowedEdge = new Set(['supply-matching', 'run-matching-v2', 'continuous-matching-worker']);
  const offenders = [];
  let checked = 0;
  for (const name of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, name), 'utf8');
    const parts = sql.split(/(?=create\s+or\s+replace\s+function\s)/i);
    for (const part of parts) {
      const fn = part.match(/^create\s+or\s+replace\s+function\s+(?:public\.)?("?[\w]+"?)/i)?.[1];
      if (!fn || !/match/i.test(fn)) continue;
      checked++;
      const body = part.replace(/--.*$/gm, '');
      if (/openai|anthropic|generativelanguage/i.test(body)) offenders.push(`${name}: ${fn} names a model provider`);
      for (const m of body.matchAll(/functions\/v1\/([a-z0-9-]+)/gi)) {
        if (!allowedEdge.has(m[1])) offenders.push(`${name}: ${fn} calls edge function ${m[1]}`);
      }
    }
  }
  assert.ok(checked > 10, `matching SQL functions were found (${checked})`);
  assert.deepEqual(offenders, []);
});
