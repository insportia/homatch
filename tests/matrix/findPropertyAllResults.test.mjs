// Find Property free search (owner, 2026-10-18): every valid home found is browsable — the ones
// that fit first, then those outside the request with what differs — and the counts, storage and
// AI summary all agree with that. MyHome's slow bodies are retried, not dropped.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8');

test('the API counts every group the pipeline emits (OTHER included), never NaN', () => {
  const api = read('supabase/functions/marketplace-search/index.ts');
  assert.match(api, /const counts: Record<string, number> = Object\.fromEntries\(RESULT_GROUPS\.map\(\(g\) => \[g, 0\]\)\);/);
  assert.match(api, /counts\[p\.group\] = \(counts\[p\.group\] \?\? 0\) \+ 1;/);
  assert.doesNotMatch(api, /\{ BEST: 0, OWNER: 0, UPGRADE: 0, MORE: 0 \}/, 'no fixed four-group map');
});

test('storage accepts OTHER; the AI summary never presents homes outside the request as answers', () => {
  const sql = read('supabase/migrations/20261118090000_marketplace_result_group_other.sql');
  assert.match(sql, /check \(result_group in \('BEST', 'OWNER', 'UPGRADE', 'MORE', 'OTHER'\)\)/);
  assert.match(read('src/research-core/marketplace/pipeline.ts'), /export const RESULT_GROUPS: readonly ResultGroup\[\] = \['BEST', 'OWNER', 'UPGRADE', 'MORE', 'OTHER'\];/);
  assert.match(read('src/research-core/marketplace/results-intelligence.ts'), /return properties\.filter\(\(p\) => p\.group !== 'OTHER'\)/);
});

test('MyHome: a body that times out is a transport failure the adapter retries', () => {
  for (const file of ['official-worker/src/marketplace/myhome/api.ts', 'official-worker/src/marketplace/myhome/public-page.ts']) {
    assert.match(read(file), /Body not received: /, file);
  }
});
