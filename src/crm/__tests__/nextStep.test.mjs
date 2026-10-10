// SUGGESTED NEXT STEP — the rules, one fact at a time.
//
// Deterministic and model-free: the same facts always give the same suggestion, it never
// infers interest from a delivered or opened message, and a recorded decision
// (NOT_INTERESTED, CLOSED) outranks everything else.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NO_REPLY_DAYS, suggestNextStep } from '../nextStep.ts';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const daysAgo = (n) => new Date(NOW - n * 86400000).toISOString();
const code = (input) => suggestNextStep({ now: NOW, ...input }).code;

test('every suggestion names its translation keys from its code', () => {
  const s = suggestNextStep({ status: 'UNLOCKED', now: NOW });
  assert.equal(s.titleKey, `crm_next_${s.code}_title`);
  assert.equal(s.bodyKey, `crm_next_${s.code}_body`);
});

test('a recorded decision outranks everything', () => {
  const busy = { messages: [{ mine: false, createdAt: daysAgo(0) }], followUpAt: daysAgo(1) };
  assert.equal(code({ status: 'NOT_INTERESTED', ...busy }), 'respect_decision');
  assert.equal(suggestNextStep({ status: 'NOT_INTERESTED', now: NOW }).action, null);
  assert.equal(code({ status: 'CLOSED', ...busy }), 'record_outcome');
});

test('a due follow-up outranks activity inference', () => {
  assert.equal(code({ status: 'CONTACTED', followUpAt: daysAgo(0.1), messages: [{ mine: false, createdAt: daysAgo(0) }] }), 'follow_up_due');
  /* A future follow-up is not due. */
  assert.notEqual(code({ status: 'CONTACTED', followUpAt: new Date(NOW + 3600000).toISOString() }), 'follow_up_due');
});

test('they wrote last → reply', () => {
  assert.equal(code({ status: 'DELIVERED', messages: [
    { mine: true, createdAt: daysAgo(2) },
    { mine: false, createdAt: daysAgo(1) },
  ] }), 'reply');
  assert.equal(code({ status: 'REPLIED', messages: [] }), 'reply');
  assert.equal(suggestNextStep({ status: 'REPLIED', now: NOW }).action, 'conversation');
});

test('order of messages does not matter — the newest decides', () => {
  const msgs = [{ mine: false, createdAt: daysAgo(5) }, { mine: true, createdAt: daysAgo(1) }];
  assert.equal(code({ status: 'REPLIED', messages: msgs }), 'wait_for_reply');
  assert.equal(code({ status: 'REPLIED', messages: [...msgs].reverse() }), 'wait_for_reply');
});

test('unlocked with no messages → first message', () => {
  assert.equal(code({ status: 'UNLOCKED' }), 'first_message');
});

test(`contacted with no reply for ${NO_REPLY_DAYS}+ days → follow-up; sooner → wait`, () => {
  assert.equal(code({ status: 'CONTACTED', messages: [{ mine: true, createdAt: daysAgo(NO_REPLY_DAYS + 0.5) }] }), 'follow_up_no_reply');
  assert.equal(code({ status: 'CONTACTED', messages: [{ mine: true, createdAt: daysAgo(1) }] }), 'wait_for_reply');
  /* Already has a future reminder: no need to suggest another. */
  assert.equal(code({
    status: 'CONTACTED',
    messages: [{ mine: true, createdAt: daysAgo(10) }],
    followUpAt: new Date(NOW + 86400000).toISOString(),
  }), 'wait_for_reply');
});

test('CONTACTED by email (no chat messages) is judged by last activity', () => {
  assert.equal(code({ status: 'CONTACTED', lastActivityAt: daysAgo(4) }), 'follow_up_no_reply');
  assert.equal(code({ status: 'CONTACTED', lastActivityAt: daysAgo(1) }), 'wait_for_reply');
});

test('delivery is never read as interest', () => {
  for (const status of ['DELIVERED', 'CONTACTED']) {
    const s = suggestNextStep({ status, messages: [{ mine: true, createdAt: daysAgo(0.5) }], now: NOW });
    assert.ok(!['propose_viewing', 'confirm_viewing'].includes(s.code), `${status} produced ${s.code}`);
  }
});

test('owner-set interest and viewings have their own steps', () => {
  assert.equal(code({ status: 'INTERESTED', messages: [{ mine: true, createdAt: daysAgo(0) }] }), 'propose_viewing');
  assert.equal(code({ status: 'VIEWING_SCHEDULED', messages: [{ mine: true, createdAt: daysAgo(0) }] }), 'confirm_viewing');
});

test('garbage input degrades to a safe suggestion, never throws', () => {
  assert.doesNotThrow(() => suggestNextStep({ status: '', messages: [{ mine: true, createdAt: 'not a date' }], followUpAt: 'nope', now: NOW }));
  assert.equal(code({ status: 'SOMETHING_NEW' }), 'review');
});

test('the rule module calls no model and imports nothing', () => {
  const src = readFileSync(new URL('../nextStep.ts', import.meta.url), 'utf8');
  assert.ok(!/^\s*import\s/m.test(src), 'nextStep.ts must stay import-free');
  assert.ok(!/fetch\(|functions\.invoke|anthropic|openai/i.test(src), 'nextStep.ts must not call a model');
});
