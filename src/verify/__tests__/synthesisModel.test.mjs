// WHICH MODEL WRITES THE BUYER INTELLIGENCE REPORT.
//
// The GPT-6 Astra experiment ran on this one stage and was ended: the reports
// it produced were not an improvement on the ones gpt-5.6-luna writes. What
// must not be lost in the restore is the thing the experiment fixed on its
// way past — before it, a provider refusal was dropped on the floor
// (`if (res.ok)` and nothing else), so an unknown model id or an unauthorised
// project produced a deterministic report indistinguishable from a successful
// one. That was a real defect independent of which model is configured.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');
const code = (...p) => read(...p)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');

test('the final synthesis runs on gpt-5.6-luna', () => {
  const src = code('supabase', 'functions', 'verify-synthesis', 'index.ts');
  assert.match(src, /const VERIFY_SYNTHESIS_MODEL = 'gpt-5\.6-luna';/);
});

test('ASTRA_USED_BY_VERIFY = NO, anywhere in the tree', () => {
  for (const f of [
    ['supabase', 'functions', 'verify-synthesis', 'index.ts'],
    ['supabase', 'functions', 'research-agent', 'index.ts'],
  ]) {
    assert.ok(!read(...f).includes('gpt-6-astra'), `${f.join('/')} still names Astra`);
  }
});

test('the COGS row names the model that actually wrote the report', () => {
  // Attributing synthesis to a model that never ran would also price it at
  // that model's rate.
  const src = code('supabase', 'functions', 'research-agent', 'index.ts');
  assert.match(src, /OPENAI_SYNTHESIS_MODEL'\)\?\.trim\(\)[\s\S]{0,40}?\|\| 'gpt-5\.6-luna'/);
});

test('SILENT_FALLBACK = NO: an unavailable model is still reported, not absorbed', () => {
  const src = code('supabase', 'functions', 'verify-synthesis', 'index.ts');
  // Kept from the experiment on purpose.
  assert.match(src, /MODEL_UNAVAILABLE_STATUSES = new Set\(\[400, 401, 403, 404\]\)/);
  assert.match(src, /SYNTHESIS_MODEL_UNAVAILABLE/);
  assert.match(src, /synthesis_model_unavailable/);
  // A transient blip still degrades the prose rather than losing the report.
  assert.match(src, /console\.error\('synthesis model call failed'/);
});
