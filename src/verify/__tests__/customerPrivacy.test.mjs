// What a customer is allowed to be shown.
//
// The primary report was checked for privacy and passed. The EVIDENCE DRAWER
// was not — it was excluded from the check as "raw research" — and it was
// displaying four private individuals' Georgian personal numbers, taken from
// building-permit applications and rendered as technical facts shaped
// "ლევან ჩაჩუა პ/ნ 01012012287".
//
// The drawer is customer-facing. Anything a customer can open is in scope,
// and these assertions cover the whole payload rather than the prose alone.

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

/* ── personal identifiers ────────────────────────────────────────────── */

test('an eleven-digit personal number is stripped from customer payloads', () => {
  const src = code(AGENT);
  assert.ok(/PERSONAL_ID_RE/.test(src), 'nothing removes a bare personal number');
  assert.ok(/PERSONAL_ID_LABEL_RE/.test(src), 'the "პ/ნ" label form is not removed');
  // Both must actually run inside the string sanitiser, not merely exist.
  const fn = src.slice(src.indexOf('function sanitizeCustomerString'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  assert.ok(body.includes('PERSONAL_ID_LABEL_RE'), 'the label form is declared but never applied');
  assert.ok(body.includes('PERSONAL_ID_RE'), 'the bare form is declared but never applied');
});

test('a nine-digit company id is NOT treated as a personal number', () => {
  // A company identification number is public by design and is the thing a
  // buyer pastes into the taxpayer register. Conflating the two would remove
  // a genuinely useful fact.
  const src = code(AGENT);
  const decl = src.slice(src.indexOf('const PERSONAL_ID_RE'), src.indexOf('function sanitizeCustomerString'));
  assert.ok(/\\d\{11\}/.test(decl), 'the personal-number pattern is not pinned to eleven digits');
  assert.ok(!/\\d\{9\}/.test(decl), 'the pattern would also match a nine-digit company id');
  assert.ok(!/\\d\{9,/.test(decl), 'the pattern spans company-id lengths');
});

test('the redaction runs on every string in the payload, not just the summary', () => {
  const src = code(AGENT);
  // sanitizeCustomerReport recurses and routes every string through the
  // string sanitiser; that is what reaches nested technical facts.
  assert.ok(/sanitizeCustomerString\(value\)/.test(src.replace(/\s+/g, '')) ||
            /sanitizeCustomerString\(value\)/.test(src),
    'strings are not routed through the sanitiser');
});

/* ── permit participants ─────────────────────────────────────────────── */

test('permit applicants and drawing co-authors are dropped, not merely redacted', () => {
  const src = code(AGENT);
  assert.ok(/PERMIT_PARTICIPANT_FACT_KEYS/.test(src), 'permit participants are still shown');
  assert.ok(/isPermitParticipantFact/.test(src), 'there is no filter for them');
  for (const k of ['applicant', 'coauthors', 'architect', 'engineer']) {
    assert.ok(src.includes(`'${k}'`), `${k} is not treated as a permit participant`);
  }
  // The filter must be wired into the array branch, which is where facts live.
  const fn = src.slice(src.indexOf('function sanitizeCustomerReport'));
  assert.ok(fn.slice(0, 400).includes('isPermitParticipantFact'),
    'the filter exists but is never applied to arrays');
});

test('the filter keys on the fact name, so a property attribute survives', () => {
  const src = code(AGENT);
  const fn = src.slice(src.indexOf('function isPermitParticipantFact'));
  const body = fn.slice(0, fn.indexOf('\n}'));
  // It must look at `key`, not at the value — dropping anything whose VALUE
  // mentions a person would delete legitimate registry prose.
  assert.ok(/\.key/.test(body), 'the filter does not key on the fact name');
  assert.ok(!/\.value/.test(body), 'the filter inspects values and could delete real findings');
});

/* ── the rule this whole file exists to enforce ──────────────────────── */

test('an applicant is never promoted to owner, shareholder or developer', () => {
  // Role inference must stay evidence-bound: a name on an application is an
  // applicant and nothing more.
  const people = code('src/verify/intelligence/peopleIntelligence.ts');
  assert.ok(/looksLikePersonName/.test(people), 'name validation is gone');
  assert.ok(/redactPersonalData/.test(people), 'participant records are no longer redacted');
  // The participant model may only carry roles the register actually states.
  assert.ok(!/role:\s*'OWNER'/.test(people) || /REGISTERED/.test(people),
    'an owner role is assigned without a registered source');
});

/* ── what the reuse work must never tell a customer ──────────────────── */

test('the reuse plan never reaches a customer payload', () => {
  // _reusePlan records how much of this verification Homatch already knew,
  // which stages were eased off and how many searches were authorised. The
  // mandate is explicit that a customer is never told that most information
  // was cached, that Homatch had already paid for it, how cheap the job was
  // internally, or how many model calls were avoided. It is also a BILLABLE
  // purchase at an unchanged price, and a customer shown a "92% reused" figure
  // would reasonably ask why they paid full price.
  const src = code(AGENT);
  const fn = src.slice(src.indexOf('function sanitizeForCustomer'));
  const body = fn.slice(0, fn.indexOf('\nfunction '));
  assert.ok(body.includes('delete r._reusePlan'), 'the reuse plan survives into the customer payload');
  assert.ok(body.includes('delete r.webSearchCalls'), 'the web-search count survives into the customer payload');
});

test('the reuse plan is carried on the job precisely so it can be stripped once', () => {
  // It is written into result_json at job creation and removed at the one
  // boundary a customer reads through. If it stopped being stored the
  // measurement would vanish; if it stopped being deleted the customer would
  // be shown Homatch's internal economics. Both halves have to stay.
  const src = code(AGENT);
  assert.ok(/_reusePlan:\s*reusePlan/.test(src) || /_reusePlan:\s*prior\._reusePlan/.test(src),
    'the plan is no longer recorded against the job at all');
});
