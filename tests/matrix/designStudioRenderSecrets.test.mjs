// Design Studio renders: provider keys, the quote secret, provider endpoints
// and the image-model prompts live on the server only. The browser asks for a
// quote and presents it back; it never prices, never prompts, never holds a key.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

function walk(dir, out = []) {
  let entries = [];
  try { entries = readdirSync(join(ROOT, dir)); } catch { return out; }
  for (const e of entries) {
    const p = `${dir}/${e}`;
    if (statSync(join(ROOT, p)).isDirectory()) { if (e !== '__tests__' && e !== 'node_modules') walk(p, out); }
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
  return out;
}

// The browser's Design Studio code (tests excluded: they may name what they forbid).
const CLIENT = [...walk('src/services/designStudio'), ...walk('src/lib/designStudio'), ...walk('src/components/designStudio')];
const SERVER_ONLY = [
  /OPENAI_API_KEY/, /GEMINI_API_KEY/, /DS_RENDER_QUOTE_SECRET/, /SUPABASE_SERVICE_ROLE_KEY/, /DS_RENDER_PRICES/,
  /api\.openai\.com/, /generativelanguage\.googleapis\.com/, /x-goog-api-key/i,
  /_shared\/designStudio\/(imageProviders|renderPrompt|renderPricing)/,
  /KEEP_STRUCTURE|finishPrompt|editPrompt|signQuote|quoteSecret/,
];

test('Design Studio client code exists to be checked', () => {
  assert.ok(CLIENT.includes('src/services/designStudio/renders.ts'));
  assert.ok(CLIENT.length > 10);
});

test('no provider key, quote secret, provider endpoint, price override or prompt builder reaches Design Studio client code', () => {
  const hits = [];
  for (const f of CLIENT) {
    const src = read(f);
    for (const re of SERVER_ONLY) if (re.test(src)) hits.push(`${f}: ${re}`);
  }
  assert.deepEqual(hits, []);
});

test('the client never sends a price or a prompt: only the signed quote token travels back', () => {
  const svc = read('src/services/designStudio/renders.ts');
  const bodies = [...svc.matchAll(/call<[^>]*>\('render-[a-z]+', ([\s\S]*?)\);/g)].map((m) => m[1]);
  assert.equal(bodies.length, 4, 'quote, start, status, edit');
  for (const b of bodies) {
    assert.ok(!/\bcredits\b|\bprompt\b|\bprovider\b|\bmodel\b/.test(b), `a request body carries no price/prompt/provider: ${b.slice(0, 80)}`);
  }
  assert.match(svc, /quoteToken: input\.quote\.token/);
});

test('the render routes answer records without the idempotency key, the quote or the lease, and never a prompt or key', () => {
  const routes = read('supabase/functions/design-studio-reconstruct/renders.ts');
  const record = /const RECORD = '([^']+)'/.exec(routes)?.[1] ?? '';
  assert.ok(record.includes('final_key') && record.includes('finish'));
  for (const hidden of ['idempotency_key', 'quote', 'lease_at', 'cost', 'timings']) assert.ok(!record.split(/,\s*/).includes(hidden), `${hidden} is not in RECORD`);
  const responses = [...routes.matchAll(/json\(([^;]*)\);?/g)].map((m) => m[1]);
  // The quote secret only ever signs (signQuote(claims, secret)); it is never a value in an answer.
  for (const r of responses) assert.ok(!/prompt|apiKey|API_KEY|\bsecret\b/i.test(r.replace('signQuote(claims, secret)', 'signQuote()')), `a response carries no prompt/key: ${r.slice(0, 80)}`);
  // Keys are read from the environment inside the providers only.
  assert.ok(!/Deno\.env\.get\('(OPENAI|GEMINI)_API_KEY'\)/.test(routes));
});

test('the admin-only provider override is checked by is_admin() on the server', () => {
  const routes = read('supabase/functions/design-studio-reconstruct/renders.ts');
  assert.match(routes, /rpc\('is_admin'\)/);
  assert.match(routes, /'ADMIN_ONLY'/);
});
