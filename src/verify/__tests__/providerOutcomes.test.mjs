// Each provider's state reflects what it actually did; one provider's failure
// never changes another's state or erases its evidence.
import test from 'node:test';
import assert from 'node:assert/strict';
import { providerOutcomes, classifyFailure, researchCompleteness } from '../providerOutcomes.ts';

const doc = { complete: true };
const tasOk = { source: 'tas', status: 'SEARCH_CONFIRMED', documents: [doc, doc], tasApi: { ledger: { incomplete: false, incompleteReasons: [] } } };
const tasPartial = { source: 'tas', status: 'SEARCH_CONFIRMED', documents: [doc], tasApi: { ledger: { incomplete: true, incompleteReasons: ['RUN_DEADLINE'] } } };
const mygovOk = { source: 'mygov', status: 'SEARCH_CONFIRMED', documents: [doc] };
const job = (results, extra = {}) => ({ browserOfficial: { results }, ...extra });
const stateOf = (outs, p) => outs.find((o) => o.provider === p)?.state;

test('one provider fails, the others keep their states and evidence', () => {
  const outs = providerOutcomes(job([tasOk, { source: 'mygov', status: 'FAILED', error: 'fetch failed ECONNRESET', documents: [] }, { source: 'rstax', status: 'WAITING_HUMAN', documents: [] }]));
  assert.equal(stateOf(outs, 'tas'), 'VERIFIED');
  assert.equal(outs.find((o) => o.provider === 'tas').evidenceCount, 2);
  assert.equal(stateOf(outs, 'mygov'), 'TEMPORARILY_UNAVAILABLE');
  assert.equal(stateOf(outs, 'rstax'), 'CAPTCHA_REQUIRED');
});

test('all providers failing: every one is reported, none is "clean"', () => {
  const outs = providerOutcomes(job([], { browserOfficial: { results: [], unavailable: true } }));
  assert.deepEqual(outs.map((o) => o.state), ['TEMPORARILY_UNAVAILABLE', 'TEMPORARILY_UNAVAILABLE']);
  assert.equal(researchCompleteness(outs).complete, false);
});

test('incomplete TAS processing is PARTIAL with its reason; a missing ledger is never VERIFIED', () => {
  const outs = providerOutcomes(job([tasPartial, mygovOk]));
  assert.equal(stateOf(outs, 'tas'), 'PARTIAL');
  assert.match(outs[0].reason, /RUN_DEADLINE/);
  assert.equal(stateOf(providerOutcomes(job([{ ...tasOk, tasApi: { cases: [] } }])), 'tas'), 'PARTIAL');
});

test('a failure after evidence was collected keeps that evidence as PARTIAL', () => {
  const outs = providerOutcomes(job([{ source: 'mygov', status: 'FAILED', error: 'TIMEOUT', documents: [doc, doc, doc] }]));
  assert.equal(stateOf(outs, 'mygov'), 'PARTIAL');
  assert.equal(outs.find((o) => o.provider === 'mygov').evidenceCount, 3);
});

test('source changes, CAPTCHA states and searched-but-empty are distinguished', () => {
  assert.equal(stateOf(providerOutcomes(job([{ source: 'rstax', status: 'SEARCH_CONTROL_NOT_FOUND' }])), 'rstax'), 'SOURCE_CHANGED');
  assert.equal(stateOf(providerOutcomes(job([{ source: 'mygov', status: 'NO_RESULT_CONFIRMED' }])), 'mygov'), 'COMPLETED');
  const unattended = providerOutcomes(job([{ source: 'rstax', status: 'SKIPPED_HUMAN_VERIFICATION' }], { _unattendedVerificationSkips: [{ source: 'rs.taxpayer' }] }));
  assert.deepEqual([stateOf(unattended, 'rstax'), unattended.find((o) => o.provider === 'rstax').reason], ['CAPTCHA_REQUIRED', 'VERIFICATION_UNATTENDED']);
  assert.equal(stateOf(providerOutcomes(job([{ source: 'mygov', status: 'BLOCKED', captcha: { type: 'image' } }])), 'mygov'), 'CAPTCHA_REQUIRED');
  assert.equal(stateOf(providerOutcomes(job([{ source: 'mygov', status: 'BLOCKED' }])), 'mygov'), 'TEMPORARILY_UNAVAILABLE');
});

test('failure text is classified, never trusted as a CAPTCHA by default', () => {
  assert.equal(classifyFailure('DwrParseError: expected , or }').state, 'SOURCE_CHANGED');
  assert.equal(classifyFailure('HTTP 503 Service Unavailable').state, 'TEMPORARILY_UNAVAILABLE');
  assert.equal(classifyFailure('429 Too Many Requests').reason, 'RATE_LIMITED');
  assert.equal(classifyFailure('TAS_API_DEADLINE').state, 'TIMEOUT');
  assert.equal(classifyFailure('captcha rejected by source').state, 'CAPTCHA_FAILED');
  assert.equal(classifyFailure('something odd').state, 'FAILED');
});

test('a provider that never ran is NOT_VERIFIED; marketplace appears only when enabled', () => {
  const outs = providerOutcomes(job([tasOk]));
  assert.equal(stateOf(outs, 'mygov'), 'NOT_VERIFIED');
  assert.equal(stateOf(outs, 'myhome'), undefined);
  const mk = providerOutcomes(job([tasOk, mygovOk], { _verifyMarket: { state: 'COMPLETE' }, _marketplaceLedger: { myhome: { status: 'COMPLETE', listings: 7 }, ssge: { status: 'FAILED', listings: 0 } } }));
  assert.equal(stateOf(mk, 'myhome'), 'VERIFIED');
  assert.equal(stateOf(mk, 'ssge'), 'FAILED');
  // Market failure never lowers official completeness.
  assert.equal(researchCompleteness(mk).complete, true);
});
