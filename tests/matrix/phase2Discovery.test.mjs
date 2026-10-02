// PHASE 2 — UNIVERSAL DISCOVERY: the guarantees each slice adds, read from
// the sources that implement them (docs/claude/PHASE2_DISCOVERY.md).
//
// Slice 0 (safety)
//   * the legacy v1 matcher and classifier run with the service role and have
//     no callers, so only a service-role caller may reach them
//   * the external unlock sends ONE idempotency key per opening of the dialog
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

test('legacy v1 run-matching and classify-signals refuse any non-service caller before touching data', () => {
  for (const fn of ['run-matching', 'classify-signals']) {
    const src = read(`supabase/functions/${fn}/index.ts`);
    const guard = src.indexOf("bearer !== serviceKey");
    const firstQuery = src.search(/\.from\('/);
    assert.ok(guard > 0, `${fn} compares the bearer with the service key`);
    assert.ok(firstQuery > guard, `${fn} checks the caller before its first query`);
    assert.match(src, /status: 403/, `${fn} answers 403`);
  }
});

test('the external unlock mints its idempotency key once per opening, never on render', () => {
  const src = read('src/components/matching/ExternalContactUnlockModal.tsx');
  assert.match(src, /const idempotencyKey = React\.useMemo\(/);
  assert.match(src, /\[open, matchId\]/);
  assert.doesNotMatch(src, /^\s*const idempotencyKey = `/m, 'no render-time key');
});
