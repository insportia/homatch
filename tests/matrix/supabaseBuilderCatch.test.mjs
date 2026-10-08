// NO `.catch(` ON A SUPABASE QUERY BUILDER.
//
// A supabase-js PostgREST builder (what .from(...)…, .rpc(...) return) is
// LAZY and only THENABLE: it has `then`, no `catch`. `builder.catch(...)`
// throws `TypeError: ... .catch is not a function` before the request is ever
// sent. Found in production 2026-10-04:
//   - _shared/findBuyers/campaign.ts  → every Find Buyers search lost its
//     memo23 plan (0 actor runs; only native Telegram ran)
//   - research-purchase               → a failed purchase never released its
//     credit reservation
//   - active-search-notify            → each trigger notified one subscriber,
//     then stopped; last_notified_at was never written
// Await the builder inside try/catch (and check `{ error }`) instead. A real
// Promise (an async function's result, storage .remove(), fetch) may use .catch.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { stripComments } from '../../scripts/lib/stripComments.mjs';

const ROOT = process.cwd();
const BUILDER_STEP = /\.(select|insert|update|upsert|delete|eq|neq|in|is|match|maybeSingle|single|limit|order|range|filter|or|not|gte|lte|gt|lt|ilike|like|contains)\(|\.rpc\(/;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (e === 'node_modules' || e === '__tests__') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

/** Every statement that starts a builder chain (`x.from(` / `x.rpc(`) and ends in `.catch(` without passing through `.then(`. */
export function builderCatches(src) {
  const hits = [];
  const re = /([\w$.)\]]+)\s*\.\s*(from|rpc)\s*\(/g;
  let m;
  while ((m = re.exec(src))) {
    if (/(^|\.)(Array|Object|Buffer|Uint8Array|String|storage)$/.test(m[1])) continue;
    let depth = 0; let end = src.length;
    for (let i = m.index; i < src.length; i++) {
      const c = src[i];
      if ('([{'.includes(c)) depth++;
      else if (')]}'.includes(c)) { depth--; if (depth < 0) { end = i; break; } }
      else if (c === ';' && depth === 0) { end = i; break; }
    }
    const stmt = src.slice(m.index, end);
    const k = stmt.indexOf('.catch(');
    if (k > 0 && !/\.then\(/.test(stmt.slice(0, k)) && BUILDER_STEP.test(stmt.slice(0, k))) {
      hits.push({ line: src.slice(0, m.index).split('\n').length, stmt: stmt.replace(/\s+/g, ' ').slice(0, 120) });
    }
  }
  return hits;
}

test('the scanner catches the production shapes and ignores real Promises', () => {
  assert.equal(builderCatches("await db.from('t').upsert({a:1}, { onConflict: 'a' }).catch(() => undefined);").length, 1);
  assert.equal(builderCatches("await admin.rpc('release', { p: 1 }).catch(() => {});").length, 1);
  assert.equal(builderCatches("await s.from('t').update({x}).eq('id', id).catch(() => {});").length, 1);
  assert.equal(builderCatches("await db.from('t').insert(r).then(() => 1).catch(() => 0);").length, 0, '.then() returns a real Promise');
  assert.equal(builderCatches("await supabase.storage.from('b').remove([p]).catch(() => undefined);").length, 0, 'storage returns a Promise');
  assert.equal(builderCatches("const xs = Array.from(set).map(f); await doThing().catch(() => 0);").length, 0);
});

test('no edge function chains .catch onto a Supabase query builder', () => {
  const hits = [];
  for (const f of walk(join(ROOT, 'supabase', 'functions'))) {
    for (const h of builderCatches(stripComments(readFileSync(f, 'utf8')))) hits.push(`${relative(ROOT, f)}:${h.line}  ${h.stmt}`);
  }
  assert.deepEqual(hits, [], `builder.catch throws before the request is sent:\n${hits.join('\n')}`);
});
