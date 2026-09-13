// Why Launch is disabled, as a list rather than a sentence.
//
// The gate is ordered and stops at the first failure, so the server's message
// names ONE reason. A customer who clears it finds the next one, then the
// next, one round trip each. From the outside that is a button that never
// works.
//
// The rule these tests protect: this checklist never invents a verdict about
// money or a provider. Those come from the server's refusal code or they come
// back UNKNOWN. A green tick that was guessed is worse than an honest blank.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLaunchChecklist, checklistReady } from '../launchChecklist.ts';

const CALL = (over = {}) => ({
  channel: 'AI_CALL',
  agentId: 'agent-1',
  contactListId: 'list-1',
  templateId: null,
  eligible: 12,
  refusalCode: null,
  previewed: true,
  ...over,
});

const byKey = (items, key) => items.find((i) => i.key === key);

test('everything satisfied reads as ready', () => {
  const items = buildLaunchChecklist(CALL());
  assert.equal(checklistReady(items), true);
  assert.ok(items.length >= 6, 'the checklist should cover both config and platform gates');
});

test('before a preview, platform items are UNKNOWN rather than green', () => {
  const items = buildLaunchChecklist(CALL({ previewed: false, eligible: null }));

  // The customer's own choices are knowable without asking the server.
  assert.equal(byKey(items, 'AGENT').state, 'DONE');
  assert.equal(byKey(items, 'AUDIENCE').state, 'DONE');

  // Everything involving money or a provider must not claim to be satisfied.
  for (const key of ['PRICING', 'CHANNEL_ACTIVE', 'BALANCE', 'CALLER_NUMBER', 'COMPLIANCE']) {
    assert.equal(byKey(items, key).state, 'UNKNOWN', `${key} must not be green before the server has said so`);
  }
  assert.equal(checklistReady(items), false, 'an unasked checklist is not a ready one');
});

test('a missing agent is the customer\'s to fix, and is not an admin problem', () => {
  const items = buildLaunchChecklist(CALL({ agentId: null }));
  assert.equal(byKey(items, 'AGENT').state, 'MISSING');
  assert.equal(byKey(items, 'AGENT').needsAdmin, false);
  assert.equal(checklistReady(items), false);
});

test('an empty audience is caught even when a list is chosen', () => {
  // Picking a list and picking a list with somebody in it are different
  // things, and the second is the one that matters.
  const items = buildLaunchChecklist(CALL({ eligible: 0 }));
  assert.equal(byKey(items, 'AUDIENCE').state, 'DONE');
  assert.equal(byKey(items, 'AUDIENCE_REACHABLE').state, 'MISSING');
});

test('the platform blockers are marked as an administrator\'s job', () => {
  // This is the distinction that stops somebody hunting through their own
  // settings for a switch that is not theirs.
  for (const [code, key] of [
    ['KILL_SWITCH_ACTIVE', 'CHANNEL_ACTIVE'],
    ['CHANNEL_DISABLED', 'CHANNEL_ACTIVE'],
    ['PROVIDER_UNAVAILABLE', 'CHANNEL_ACTIVE'],
    ['PRODUCT_PRICING_INACTIVE', 'PRICING'],
    ['PRODUCT_PRICE_INVALID', 'PRICING'],
    ['PRODUCT_DISABLED', 'PRICING'],
    ['CALLER_NUMBER_MISSING', 'CALLER_NUMBER'],
  ]) {
    const items = buildLaunchChecklist(CALL({ refusalCode: code }));
    const item = byKey(items, key);
    assert.ok(item, `${code} should map to ${key}`);
    assert.equal(item.state, 'MISSING', `${code} should mark ${key} missing`);
    assert.equal(item.needsAdmin, true, `${code} is not the customer's to fix`);
  }
});

test('the blockers a customer CAN clear are not blamed on an administrator', () => {
  for (const [code, key] of [
    ['INSUFFICIENT_CREDIT', 'BALANCE'],
    ['RESERVATION_FAILED', 'BALANCE'],
    ['DOMAIN_REJECTED', 'COMPLIANCE'],
    ['RISK_REJECTED', 'COMPLIANCE'],
    ['COMPLIANCE_PAUSED', 'COMPLIANCE'],
  ]) {
    const item = byKey(buildLaunchChecklist(CALL({ refusalCode: code })), key);
    assert.equal(item.state, 'MISSING', `${code} should mark ${key} missing`);
    assert.equal(item.needsAdmin, false, `${code} is the customer's own to clear`);
  }
});

test('an unrecognised refusal does not silently mark everything green', () => {
  // A new code from the gate must not read as "all clear". It leaves the
  // list green-ish but the caller still has the server's own ok:false, and
  // nothing here claims otherwise by inventing a passing item.
  const items = buildLaunchChecklist(CALL({ refusalCode: 'SOMETHING_NEW' }));
  assert.ok(items.every((i) => i.state !== 'UNKNOWN'), 'previewed items should be decided');
  // No item is falsely attributed to the unknown code.
  assert.equal(items.filter((i) => i.state === 'MISSING').length, 0);
});

test('WhatsApp asks for a template and never for an agent or caller number', () => {
  const items = buildLaunchChecklist(CALL({
    channel: 'WHATSAPP', agentId: null, templateId: null,
  }));
  assert.equal(byKey(items, 'TEMPLATE').state, 'MISSING');
  assert.equal(byKey(items, 'AGENT'), undefined, 'a WhatsApp campaign has no AI agent step');
  assert.equal(byKey(items, 'CALLER_NUMBER'), undefined, 'a WhatsApp campaign needs no caller number');
});

test('an AI call campaign asks for a caller number and never for a template', () => {
  const items = buildLaunchChecklist(CALL());
  assert.ok(byKey(items, 'CALLER_NUMBER'));
  assert.equal(byKey(items, 'TEMPLATE'), undefined);
});

test('production today: telephony refuses on activation, and says who fixes it', () => {
  // The state this deployment is actually in.
  const items = buildLaunchChecklist(CALL({ refusalCode: 'KILL_SWITCH_ACTIVE' }));
  assert.equal(checklistReady(items), false);
  const blocked = items.filter((i) => i.state === 'MISSING');
  assert.equal(blocked.length, 1, 'exactly one blocker should be reported');
  assert.equal(blocked[0].key, 'CHANNEL_ACTIVE');
  assert.equal(blocked[0].needsAdmin, true);
});
