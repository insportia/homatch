// A report that is built must actually be kept.
//
// Found by forcing a re-synthesis in production and then reading the row: the
// report came back over HTTP with mode MODEL and nothing rejected, and
// synthesis_at had not moved. It had been generated, billed, returned once
// and lost — and the next view would generate and lose it again.
//
// The cause was a permission, not a policy. research_jobs has an RLS policy
// letting an owner update their own row, but the `authenticated` role has no
// table-level UPDATE grant, and a policy filters ROWS rather than granting
// privileges. Reproduced directly with the customer's own token:
//
//   42501 permission denied for table research_jobs
//
// persist() swallowed that into a console line.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const code = (p) =>
  readFileSync(join(ROOT, p), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

const FN = 'supabase/functions/verify-synthesis/index.ts';

test('a failed write is reported rather than swallowed', () => {
  const src = code(FN);
  const persist = src.slice(src.indexOf('async function persist'));
  const body = persist.slice(0, persist.indexOf('\n}'));

  assert.ok(/const \{ error \}/.test(body), 'the result of the write is still ignored');
  assert.ok(/if \(error\)/.test(body), 'a failed write is not detected');
  assert.ok(/console\.error/.test(body), 'a failed write is not reported');
  assert.ok(!/try \{/.test(body), 'the write is still wrapped in a swallowing try/catch');
});

test('the write-back uses a client that is allowed to write', () => {
  const src = code(FN);
  assert.ok(/const writer = serviceKey/.test(src), 'there is no dedicated writer client');
  assert.ok(/persist\(writer, jobId, payload\)/.test(src), 'the model path still writes as the caller');
  assert.ok(/persist\(writer, jobId, emptyPayload\)/.test(src), 'the empty path still writes as the caller');
  assert.ok(!/persist\(supabase,/.test(src), 'a persist site still uses the caller client');
});

test('reads still go through the caller, under RLS', () => {
  // The authorisation must not move. A caller can only ever persist for a job
  // they were already allowed to load.
  const src = code(FN);
  const load = src.slice(src.indexOf("from('research_jobs')"));
  assert.ok(/await supabase\s*\n?\s*\.from\('research_jobs'\)/.test(src) ||
            /const \{ data: job, error \} = await supabase/.test(src),
    'the job is no longer loaded through the caller client');
  assert.ok(!/const \{ data: job[\s\S]{0,80}writer/.test(src),
    'the job is loaded with elevated privileges');
});

test('the fix is not a table-level grant', () => {
  // Widening UPDATE on research_jobs to every authenticated user would let
  // somebody rewrite their own result_json, which later feeds AI context —
  // a much bigger door than the one being closed.
  const src = readFileSync(join(ROOT, FN), 'utf8');
  assert.ok(!/GRANT\s+UPDATE/i.test(src), 'the function suggests widening the grant');
});

test('a missing service key degrades rather than crashing', () => {
  const src = code(FN);
  assert.ok(/serviceKey\s*\n?\s*\?[\s\S]{0,120}:\s*supabase/.test(src),
    'there is no fallback when no service key is configured');
});
