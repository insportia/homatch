// reportBackgroundBuild.test.mjs — the report is built once, outside the request, and the page waits for it (prod 176264ba, 2026-10-23).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const code = (p) => readFileSync(fileURLToPath(new URL(`../../../${p}`, import.meta.url)), 'utf8');
const vs = code('supabase/functions/verify-synthesis/index.ts');
const ra = code('supabase/functions/research-agent/index.ts');
const page = code('src/pages/VerifyPage.tsx');

test('a first build runs in the background and the caller is answered "pending" at once', () => {
  const at = vs.indexOf('THE BUILD OUTLIVES THE REQUEST');
  assert.ok(at > 0);
  const block = vs.slice(at, vs.indexOf('return json(await buildReport(job, writer, { autoUpgrade: false, trigger, forced: !!body?.force }));', at));
  assert.match(block, /if \(!body\?\.force && rt\?\.waitUntil\) \{/);
  assert.match(block, /rt\.waitUntil\(work\);\n\s+return json\(\{ pending: true, retryAfterMs: 5000 \}, 202\);/);
  // A background failure is retried by the driver, never left PENDING.
  assert.match(block, /update\(\{ synthesis_state: 'FAILED' \}\)\.eq\('id', jobId\)\.eq\('synthesis_state', 'PENDING'\)/);
});

test('a customer build claims first, so two builds of one report cannot run together', () => {
  const at = vs.indexOf('THE BUILD OUTLIVES THE REQUEST');
  const block = vs.slice(at, at + 3000);
  assert.match(block, /if \(!internal\) \{\n\s+const claim = await claimReportBuild\(writer, jobId\);/);
  assert.match(block, /if \(claim === 'LOST'\) return json\(\{ pending: true, retryAfterMs: 4000 \}, 202\);/);
  assert.match(block, /if \(claim === 'EXHAUSTED'\) return json\(\{ error: 'report_unavailable' \}, 503\);/);
  const claim = vs.slice(vs.indexOf('async function claimReportBuild'), vs.indexOf('async function persist('));
  assert.match(claim, /synthesis_attempts: attempts \+ 1/);
  assert.match(claim, /\.eq\('synthesis_attempts', attempts\)/);
  assert.match(claim, /if \(attempts >= REPORT_MAX_ATTEMPTS\) return 'EXHAUSTED';/);
  assert.match(vs, /const REPORT_MAX_ATTEMPTS = 4;/);
  assert.match(ra, /const MAX_SYNTHESIS_ATTEMPTS = 4;/);
});

test('a build still running is never swept as stale: one window, above the 400 s wall clock, on both sides', () => {
  assert.match(vs, /const REPORT_BUILD_STALE_MS = 7 \* 60 \* 1000;/);
  assert.match(vs, /pendingAge < REPORT_BUILD_STALE_MS\)/);
  assert.doesNotMatch(vs, /pendingAge < 4 \* 60 \* 1000/);
  assert.match(ra, /const SYNTHESIS_ATTEMPT_TIMEOUT_MS = 7 \* 60 \* 1000;/);
});

test('the page waits for the report through 504s and timeouts, and only gives up at its deadline', () => {
  assert.match(page, /const SYNTHESIS_WAIT_MS=9\*60\*1000;/);
  assert.doesNotMatch(page, /attempt<45/);
  assert.match(page, /const transient=!!error&&!\(data as any\)\?\.error&&\(status===0\|\|status===502\|\|status===504\);/);
  assert.match(page, /if\(!\(data as any\)\?\.pending&&!transient\)break;\n\s*if\(Date\.now\(\)>deadline\)break;/);
  // A timed-out read is caught and asked again, not thrown into the evidence view.
  assert.match(page, /catch\(e\)\{res=\{data:null,error:e\}\}/);
});

test('the fresh-photo cost row uses a provider the enum accepts', () => {
  const at = ra.indexOf("operation_type: 'FRESH_PHOTOS_VERIFY'");
  assert.ok(at > 0);
  assert.match(ra.slice(at - 200, at), /provider: 'OTHER',/);
  assert.doesNotMatch(ra, /provider: 'WIKIMEDIA_COMMONS'/);
});
