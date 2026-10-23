// Finance V2.1 — one price resolution. provider_price_book is the canonical registry; the few
// places that still hold their own copy (Design Studio PRICE_TABLE, the Find Buyers OpenAI
// default) must equal the book's seeds, and no edge function may hard-code a model rate again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const read = (p) => readFileSync(join(root, p), 'utf8');
const V21 = read('supabase/migrations/20261123090000_finance_v2_1_cost_coverage.sql');
const V2 = read('supabase/migrations/20261119140000_finance_v2_engine.sql');

/** ('PROVIDER', 'model', 'UNIT', rate::numeric, …) tuples from a seed block. */
function seeds(sql) {
  const out = new Map();
  for (const m of sql.matchAll(/\('([A-Z]+)',\s*'([^']+)',\s*'([A-Z_]+)',\s*([\d.]+)::numeric/g)) out.set(`${m[1]}|${m[2]}|${m[3]}`, Number(m[4]));
  return out;
}

test('Design Studio PRICE_TABLE equals the book rows the V2.1 migration seeds (USD per 1M tokens)', async () => {
  const { PRICE_TABLE } = await import('../../supabase/functions/_shared/designStudio/imageProviders.ts');
  const book = seeds(V21);
  const unitOf = { textIn: 'INPUT_TOKEN', imageIn: 'IMAGE_INPUT_TOKEN', cachedIn: 'CACHED_INPUT_TOKEN', imageOut: 'IMAGE_OUTPUT_TOKEN', textOut: 'OUTPUT_TOKEN' };
  let compared = 0;
  for (const [model, price] of Object.entries(PRICE_TABLE)) {
    const provider = model.startsWith('gemini') ? 'GEMINI' : 'OPENAI';
    for (const [field, unit] of Object.entries(unitOf)) {
      const key = `${provider}|${model}|${unit}`;
      if (price[field] == null) { assert.equal(book.has(key), false, `${key}: TS has no rate, the book must not invent one`); continue; }
      assert.equal(book.get(key), price[field], `${key}: PRICE_TABLE ${price[field]} vs book ${book.get(key)}`);
      compared++;
    }
  }
  assert.ok(compared >= 20, `compared ${compared} rates`);
});

test('the Find Buyers OpenAI default equals the book gpt-4o-mini rates', async () => {
  const { DEFAULT_PRICE_BOOK } = await import('../../supabase/functions/_shared/findBuyers/openai.ts');
  const book = seeds(V2);
  assert.equal(DEFAULT_PRICE_BOOK.model, 'gpt-4o-mini');
  assert.equal(DEFAULT_PRICE_BOOK.inputPerMTokMicros / 1e6, book.get('OPENAI|gpt-4o-mini|INPUT_TOKEN'));
  assert.equal(DEFAULT_PRICE_BOOK.outputPerMTokMicros / 1e6, book.get('OPENAI|gpt-4o-mini|OUTPUT_TOKEN'));
});

test('production drift is reported live: finance_v2_price_drift() compares the settings copy with the book', () => {
  assert.match(V21, /create or replace function public\.finance_v2_price_drift\(\)/);
  assert.match(V21, /find_buyers_openai_price_book/);
  assert.match(V21, /perform public\.finance_require_admin\(\);[\s\S]{0,40}return/);
});

function walk(dir, acc = []) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (f === 'node_modules' || f === '__tests__') continue;
    if (statSync(p).isDirectory()) walk(p, acc); else if (/\.ts$/.test(f)) acc.push(p);
  }
  return acc;
}

test('no edge function hard-codes a per-token model rate (rates live in provider_price_book)', () => {
  /* Allowed: the two pinned copies above, and the Find Buyers default whose drift the test above checks. */
  const allowed = new Set(['supabase/functions/_shared/designStudio/imageProviders.ts', 'supabase/functions/_shared/findBuyers/openai.ts']);
  const offenders = [];
  for (const file of walk(join(root, 'supabase/functions'))) {
    const rel = file.slice(root.length);
    if (allowed.has(rel)) continue;
    const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    if (/\b0\.15\s*\/\s*1[_,]?000[_,]?000\b|\b0\.60?\s*\/\s*1[_,]?000[_,]?000\b|OPENAI_USD_PER_MTOK/.test(code)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `hard-coded model rates: ${offenders.join(', ')}`);
});
