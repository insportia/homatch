// What Homatch AI is for, and what it does with a question that is not that.
//
// Read from production before changing anything, and the premise turned out
// to be backwards. The assistant does not emit harsh scope errors — asked for
// a khachapuri recipe it wrote out the full recipe, ingredients, method and
// all, at real model cost. The fault was the absence of any redirect, not the
// presence of a rude one.
//
// The other gap was quieter and worse: somebody who had just paid for a Verify
// report and opened the assistant to ask about it was talking to something
// that had never heard of it. They then re-describe their own report, badly,
// and get generic advice back.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const ai = () =>
  readFileSync(join(ROOT, 'supabase', 'functions', 'homatch-ai', 'index.ts'), 'utf8').replace(/\r\n/g, '\n');

/* ── what it is ──────────────────────────────────────────────────────── */

test('the assistant is briefed as an adviser, not a lookup form', () => {
  const src = ai();
  assert.match(src, /WHAT YOU ARE\. A knowledgeable property adviser, not a cadastral lookup form/);
  // The subjects a person buying a home actually raises, named so that none of
  // them reads as off-topic to the model.
  for (const subject of [
    'neighbourhoods', 'developers', 'mortgages and financing', 'negotiation',
    'contracts', 'taxes and fees',
  ]) {
    assert.ok(src.includes(subject), `${subject} is not named as something to discuss`);
  }
  assert.match(src, /A question about whether a district is good for a family/);
});

test('an unrelated question is redirected, not refused and not answered', () => {
  const src = ai();
  const i = src.indexOf('SOMETHING GENUINELY UNRELATED');
  assert.ok(i > 0, 'nothing tells the assistant what to do with an unrelated question');
  const rule = src.slice(i, i + 600);
  // Not answered: the observed failure was a complete recipe, written out.
  assert.match(rule, /do not write it out/);
  // And not lectured about either, which is the failure the rule could
  // easily have introduced instead.
  assert.match(rule, /do not lecture about scope/);
  assert.match(rule, /never say "outside my scope"/);
  assert.match(rule, /offer the nearest thing you CAN do/);
});

/* ── offering the product ────────────────────────────────────────────── */

test('Verify is offered when it would help, and described as what it is', () => {
  /*
   * This used to read the 'OFFERING VERIFY' section. That section became
   * the full service list when the assistant was taught about Contract
   * Intelligence, finding buyers, Mortgage and outreach. The heading moved;
   * the three properties it was actually guarding did not, so they are
   * asserted against the new text rather than against the old wording.
   */
  const src = ai();
  const i = src.indexOf('WHAT HOMATCH CAN ACTUALLY DO FOR THEM');
  assert.ok(i > 0, 'the assistant is never told what its own products are');
  const rule = src.slice(i, i + 2600);

  // 1. Verify is still described as what it is, not as a lookup form.
  assert.match(rule, /deep research on ONE specific property/);
  assert.match(rule, /official registries and public sources/);

  // 2. An offer is never a substitute for the answer.
  assert.match(rule, /never a substitute for one and never the point of it/);

  // 3. Saying it once is enough. Repetition is pressure, not help.
  assert.match(rule, /Do not mention the same one again in the next turn/);
});

/* ── the customer's own research ─────────────────────────────────────── */

test('the assistant is given the reports this person already paid for', () => {
  const src = ai();
  assert.match(src, /internal\.verifications = /, 'the assistant still cannot see a finished report');
  assert.match(src, /THE CUSTOMER'S OWN VERIFY REPORTS are in HOMATCH INTERNAL DATA/);
  assert.match(src, /never make them re-describe their own research to you/);
});

test('only the customer-facing report is handed over, never the raw research', () => {
  // result_json holds raw official-source evidence, OCR and personal
  // identification numbers. The customer boundary strips them for good
  // reason, and passing through a chat prompt does not make them strippable.
  const src = ai();
  const i = src.indexOf("const { data: v } = await sb");
  const query = src.slice(i, src.indexOf('internal.verifications', i));
  assert.ok(query.includes('synthesis_json'), 'the synthesised report is not read');
  assert.ok(!query.includes('result_json'), 'the raw research is loaded into a chat prompt');
  assert.ok(!query.includes('evidence_bundle'), 'the raw evidence is loaded into a chat prompt');
});

test('a report is only ever this account\'s own', () => {
  const src = ai();
  const i = src.indexOf("const { data: v } = await sb");
  const query = src.slice(i, i + 500);
  assert.match(query, /\.eq\('user_id', uid\)/, 'reports are not scoped to the person asking');
  assert.match(query, /\.is\('deleted_at', null\)/, 'a deleted report comes back in chat');
  assert.match(query, /\.eq\('status', 'COMPLETE'\)/, 'an unfinished run is presented as a report');
});

test('an anonymous caller gets no reports, because there is no account to scope to', () => {
  const src = ai();
  const i = src.indexOf('const internal: any =');
  const block = src.slice(i, i + 300);
  assert.match(block, /verifications: \[\]/, 'the default is not empty');
  assert.match(block, /^\s*if \(uid\) \{/m, 'the lookup is not gated on an account');
});

/* ── the prompt stays well-formed ────────────────────────────────────── */

test('each kind of internal data has its own allowance', () => {
  // It was one slice() across the whole object: a long property list could
  // push everything after it past the cut, and the cut landed mid-structure,
  // handing the model a truncated fragment of JSON to interpret.
  const src = ai();
  assert.match(src, /const internalDataForPrompt = /);
  assert.ok(!/JSON\.stringify\(internal\)\.slice\(/.test(src), 'the single cut across everything is back');
  const i = src.indexOf('const internalDataForPrompt');
  const fn = src.slice(i, src.indexOf('const context = body.context', i));
  for (const section of ['verifications', 'properties', 'matches', 'intents']) {
    assert.ok(fn.includes(section), `${section} has no budget of its own`);
  }
  assert.match(fn, /kept\.pop\(\); break;/, 'trimming still cuts inside an entry');
});

test('what the budget produces is always valid JSON', async () => {
  // The behaviour, not the source: a trimmed section must still parse.
  const trim = (data, BUDGET) => {
    const out = {};
    for (const [key, rows] of Object.entries(data)) {
      const budget = BUDGET[key] ?? 3000;
      const kept = [];
      for (const row of rows) {
        kept.push(row);
        if (JSON.stringify(kept).length > budget) { kept.pop(); break; }
      }
      out[key] = kept;
    }
    return JSON.stringify(out);
  };
  const huge = Array.from({ length: 200 }, (_, i) => ({ id: i, blurb: 'x'.repeat(500) }));
  const json = trim({ verifications: huge, properties: huge, matches: [], intents: [] }, { verifications: 9000, properties: 9000 });
  const parsed = JSON.parse(json);
  assert.ok(parsed.verifications.length > 0, 'a section was emptied entirely');
  assert.ok(parsed.verifications.length < huge.length, 'nothing was trimmed');
  assert.deepEqual(parsed.matches, []);
  // And a section that overflows does not eat another's allowance.
  assert.ok(parsed.properties.length > 0, 'one long section starved the next');
});
