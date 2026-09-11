// Continue Verification, and how a TypeError became customer copy.
//
// THE REPORTED FAILURE
//
//   Continue Verification -> "Cannot read properties of undefined (reading 'filter')"
//
// THE MECHANISM, traced through the live journey rather than guessed at:
//
//   1. advance()'s catch ends with `error: String(e)`, so ANYTHING thrown
//      inside it is written verbatim into research_jobs.error.
//   2. sanitizeForCustomer only scrubbed SCREAMING_SNAKE markers
//      (INTERNAL_TERMINAL_MARKER), so a real runtime error passed straight
//      through it.
//   3. VerifyPage's check/run/resume/skip all do
//      `if (data?.error) throw new Error(data.error)` BEFORE looking at
//      status, so the raw string became the message on screen.
//
// Reproduced against a disposable WAITING_HUMAN job in production: skip() on a
// job whose worker session was gone surfaced "Error: missing worker job" —
// an internal string, shown to a customer, through exactly this path.
//
// Guarding whichever function happened to throw fixes one instance. The fix
// under test here closes the class.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const read = (p) => readFileSync(join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
const code = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');

const AGENT = 'supabase/functions/research-agent/index.ts';

/** The pattern the edge function uses, re-declared so behaviour is exercised. */
const RAW_RUNTIME_ERROR = new RegExp(
  [
    String.raw`^\s*\w*Error\b`,
    String.raw`Cannot read propert`,
    String.raw`is not a function`,
    String.raw`is not defined`,
    String.raw`undefined is not`,
    String.raw`null is not`,
    String.raw`\n\s*at `,
  ].join('|'),
  'i'
);

/* ── the exact strings that reached, or could reach, a customer ──────── */

test('the reported error is recognised as a runtime error', () => {
  assert.ok(RAW_RUNTIME_ERROR.test("TypeError: Cannot read properties of undefined (reading 'filter')"));
  assert.ok(RAW_RUNTIME_ERROR.test("Cannot read properties of undefined (reading 'filter')"));
});

test('the string the live journey actually produced is recognised', () => {
  // Observed on a disposable job: skip() with no worker session.
  assert.ok(RAW_RUNTIME_ERROR.test('Error: missing worker job'));
});

test('every runtime-error shape is recognised, not just the reported one', () => {
  for (const s of [
    'ReferenceError: extractControlStructure is not defined',
    'TypeError: r.sections.filter is not a function',
    'SyntaxError: Unexpected token }',
    'Error: fetch failed',
    'undefined is not an object',
    'null is not an object (evaluating \'x.y\')',
    'TypeError: x is undefined\n    at advance (file:///src/index.ts:100:5)',
  ]) {
    assert.ok(RAW_RUNTIME_ERROR.test(s), `"${s.slice(0, 50)}" would still reach a customer`);
  }
});

test('a deliberate, customer-safe marker is NOT mistaken for a crash', () => {
  // These are the pipeline's own vocabulary and have their own handling.
  for (const s of ['HUMAN_VERIFICATION_EXPIRED', 'RESEARCH_ABANDONED_BEFORE_COMPLETION']) {
    assert.equal(RAW_RUNTIME_ERROR.test(s), false, `${s} was treated as a runtime error`);
  }
});

test('ordinary prose is not swallowed', () => {
  // The guard must not eat a message written for a person.
  for (const s of [
    'ოფიციალური წყარო დროებით მიუწვდომელია.',
    'The official source could not be reached in time.',
    'Verification was not completed.',
  ]) {
    assert.equal(RAW_RUNTIME_ERROR.test(s), false, `"${s}" was suppressed`);
  }
});

/* ── the fix is wired where the journey actually passes ──────────────── */

test('the customer boundary drops a raw runtime error and says INCOMPLETE', () => {
  const agent = code(AGENT);
  assert.ok(/RAW_RUNTIME_ERROR/.test(agent), 'raw runtime errors reach the customer again');

  const fn = agent.slice(agent.indexOf('function sanitizeForCustomer'));
  const body = fn.slice(0, 2500);
  assert.ok(/RAW_RUNTIME_ERROR\.test\(String\(job\.error\)\)/.test(body),
    'the guard is declared but never applied at the customer boundary');
  assert.ok(/terminalReason: 'INCOMPLETE'/.test(body),
    'no safe reason replaces the dropped error');
});

test('the raw value is still kept for admins', () => {
  // Diagnosing a crash needs the real string; only what LEAVES is replaced.
  const agent = code(AGENT);
  const fn = agent.slice(agent.indexOf('function sanitizeForCustomer'));
  const body = fn.slice(0, 2500);
  assert.ok(/_rawRuntimeError, \.\.\.withoutRaw/.test(body),
    'the error is rewritten in place rather than stripped from the response');
  assert.ok(!/update\(\{[^}]*error:/.test(body), 'the sanitiser writes to the stored row');
});

test('the guard runs before the marker check, so a crash cannot be mislabelled', () => {
  const agent = code(AGENT);
  const fn = agent.slice(agent.indexOf('function sanitizeForCustomer'));
  const raw = fn.indexOf('RAW_RUNTIME_ERROR.test');
  const marker = fn.indexOf('INTERNAL_TERMINAL_MARKER.test');
  assert.ok(raw > 0 && marker > 0 && raw < marker,
    'the runtime-error guard no longer runs first');
});

/* ── what the journey itself must preserve ───────────────────────────── */

test('skip releases one source and never starts a second job', () => {
  // Verified live: skip() on a disposable WAITING_HUMAN job kept the same job
  // id and left officialEvidence intact.
  const agent = code(AGENT);
  const skip = agent.slice(agent.indexOf("action === 'skip' && j.status === 'WAITING_HUMAN'"));
  const body = skip.slice(0, 1800);
  assert.ok(!/\.insert\(/.test(body), 'the skip path inserts a new research job');
  assert.ok(!/result_json: \{\}/.test(body), 'the skip path discards collected evidence');
});

test('redemption is idempotent, so a repeated Continue click is harmless', () => {
  // The authority is the database RPC. Verified live against production:
  // first call -> already:false, second call -> already:true, no second
  // redemption and no error.
  const fn = code('supabase/functions/verification-handoff/index.ts');
  assert.ok(/redeem_human_verification_handoff/.test(fn),
    'redemption no longer goes through the locking RPC');
  assert.ok(!/update\(\{ status: 'COMPLETED'/.test(fn),
    'the function marks handoffs complete itself, outside the RPC lock');
});
