// developerAdsStorable.test.mjs — third-party ad text can never make a Verify job unwritable (prod 12272abd, 2026-10-23).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { pgSafe } from '../officialRecovery.ts';
import { normalizeAds } from '../developerAds.ts';

const lone = (s) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s);

test('an ad body cut through an emoji is stored without the broken half', () => {
  const cut = '🏠 Villa Residence — ახალი პროექტი 😀'.slice(0, -1); // ends on a lone high surrogate
  assert.ok(lone(cut));
  const items = [{ adArchiveID: '1', pageName: 'Villa Residence', snapshot: { body: { text: cut }, title: 'X\u0000Y' } }];
  const stats = { nul: 0, surrogates: 0 };
  const out = JSON.stringify(normalizeAds(pgSafe(items, stats)));
  assert.ok(!lone(JSON.parse(out) && out.replace(/\\u[0-9a-f]{4}/gi, (m) => String.fromCharCode(parseInt(m.slice(2), 16)))), 'no lone surrogate reaches storage');
  assert.ok(!out.includes('\\u0000'));
  assert.ok(stats.surrogates >= 1 && stats.nul >= 1);
});

test('research-agent cleans ad items where they enter, and a refused final write stops the step', () => {
  const src = readFileSync(fileURLToPath(new URL('../../../supabase/functions/research-agent/index.ts', import.meta.url)), 'utf8');
  assert.match(src, /const normalized = normalizeAds\(pgSafe\(items, stats\)\);/);
  const at = src.indexOf("const finished = await sb.from('research_jobs').update({ status: 'COMPLETE'");
  const after = src.slice(at, at + 1200);
  assert.match(after, /if \(finished\?\.error\) \{\n\s+console\.error\(JSON\.stringify\(\{ scope: 'verify_finish_write'/);
  // Nothing after the guard runs for a job that did not become COMPLETE.
  assert.ok(after.indexOf('return finished;') < after.indexOf('recordVerificationCost'), 'bookkeeping ran for an unwritten job');
});
