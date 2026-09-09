import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decideHandoff, isTerminalNetworkRefusal, isHandoffCapable,
  specFor, feasibilityMatrix,
} from '../sources.ts';

/*
 * The handoff decision is the one place where a mistake has a customer-visible
 * cost in both directions:
 *
 *   - deciding RETRY_IN_SERVER_BROWSER on a refused network shows the customer
 *     a CAPTCHA that CANNOT be solved from where it is rendered, and
 *   - deciding USER_SIDE_HANDOFF on a source that cannot actually be
 *     reproduced strands them on a page with no way to finish.
 *
 * So these tests are mostly about refusing to be clever.
 */

const inputs = { cadastralCode: '01.19.36.018.041', companyIdCode: '404670272' };

/* ---------------------------------------------------------------- *
 * Terminal refusal detection                                        *
 * ---------------------------------------------------------------- */

test('the real Google block-page wording is recognised as a network refusal', () => {
  assert.equal(
    isTerminalNetworkRefusal('Your computer or network may be sending automated queries.'),
    true
  );
  assert.equal(isTerminalNetworkRefusal('We have detected unusual traffic from your computer network'), true);
});

test('a bare "try again later" is NOT enough to declare a network refusal', () => {
  // Too generic — plenty of ordinary error pages say this, and acting on it
  // would push customers into handoffs they do not need.
  assert.equal(isTerminalNetworkRefusal('Service temporarily unavailable. Try again later.'), false);
});

test('"try again later" DOES count when it appears with automated-query language', () => {
  assert.equal(
    isTerminalNetworkRefusal('Try again later — automated requests were detected from this network.'),
    true
  );
});

test('an ordinary CAPTCHA page is not a refusal', () => {
  assert.equal(isTerminalNetworkRefusal('Please verify you are human by selecting all traffic lights'), false);
  assert.equal(isTerminalNetworkRefusal(''), false);
  assert.equal(isTerminalNetworkRefusal(null), false);
  assert.equal(isTerminalNetworkRefusal(undefined), false);
});

/* ---------------------------------------------------------------- *
 * The core rule                                                     *
 * ---------------------------------------------------------------- */

test('a terminal refusal on a capable source goes STRAIGHT to user-side handoff', () => {
  const plan = decideHandoff({
    sourceKey: 'enforcement.debtors', status: 'BLOCKED',
    networkRefusal: true, available: inputs,
  });
  assert.equal(plan.decision, 'USER_SIDE_HANDOFF');
  assert.equal(plan.kind, 'VERIFY_ON_SOURCE');
});

test('the customer is NEVER asked to solve a CAPTCHA on a refused network', () => {
  // Even though the status is CAPTCHA_REQUIRED, the refusal wins: showing a
  // Railway screenshot here would be showing an unsolvable puzzle.
  const plan = decideHandoff({
    sourceKey: 'enforcement.debtors', status: 'CAPTCHA_REQUIRED',
    networkRefusal: true, available: inputs,
  });
  assert.notEqual(plan.decision, 'RETRY_IN_SERVER_BROWSER');
  assert.equal(plan.decision, 'USER_SIDE_HANDOFF');
});

/*
 * SUPERSEDED BY A REAL PRODUCTION FAILURE.
 *
 * This test used to assert the opposite: that an ordinary CAPTCHA stayed in
 * the server browser "where Buster helps", and that only a terminal network
 * refusal was handed to the customer.
 *
 * A live customer test (job 49c5f98d-972b-4e72-8ebf-dd228f24992b, source
 * rstax, networkBlocked=false) showed what that assertion actually bought: a
 * person was shown a Google reCAPTCHA image challenge rendered inside the
 * Railway Chromium as a streamed screenshot, and asked to click on it.
 *
 * The distinction between "hard puzzle" and "refused network" is real, but it
 * is not the customer's problem and it must not decide WHERE a human works.
 * Once a human is needed at all, the human works in their own browser.
 */
test('an ordinary CAPTCHA is handed to the customer, not solved in our browser', () => {
  const plan = decideHandoff({
    sourceKey: 'enforcement.debtors', status: 'CAPTCHA_REQUIRED',
    networkRefusal: false, available: inputs,
  });
  assert.equal(plan.decision, 'USER_SIDE_HANDOFF');
});

/* ---------------------------------------------------------------- *
 * Fail closed                                                       *
 * ---------------------------------------------------------------- */

test('a session-bound source is skipped rather than handed off', () => {
  const plan = decideHandoff({
    sourceKey: 'mygov.permits', status: 'BLOCKED',
    networkRefusal: true, available: inputs,
  });
  assert.equal(plan.decision, 'SKIP_SOURCE');
  assert.match(plan.reason, /SESSION_BOUND/);
});

test('an unknown source fails closed to SKIP rather than being offered', () => {
  const plan = decideHandoff({
    sourceKey: 'some.new.source', status: 'BLOCKED',
    networkRefusal: true, available: inputs,
  });
  assert.equal(plan.decision, 'SKIP_SOURCE');
  assert.equal(specFor('some.new.source'), null);
});

test('a handoff is not offered when the inputs it needs are missing', () => {
  const plan = decideHandoff({
    sourceKey: 'enforcement.debtors', status: 'BLOCKED',
    networkRefusal: true, available: { cadastralCode: '01.19.36.018.041' }, // no company id
  });
  assert.equal(plan.decision, 'SKIP_SOURCE');
  assert.match(plan.reason, /companyIdCode/);
});

test('blank-string inputs count as missing, not as present', () => {
  const plan = decideHandoff({
    sourceKey: 'enforcement.debtors', status: 'BLOCKED',
    networkRefusal: true, available: { companyIdCode: '   ' },
  });
  assert.equal(plan.decision, 'SKIP_SOURCE');
});

/* ---------------------------------------------------------------- *
 * No loops                                                          *
 * ---------------------------------------------------------------- */

test('a cancelled or expired handoff is never re-offered', () => {
  for (const prior of ['CANCELLED', 'EXPIRED']) {
    const plan = decideHandoff({
      sourceKey: 'enforcement.debtors', status: 'BLOCKED',
      networkRefusal: true, available: inputs, priorAttempt: prior,
    });
    assert.equal(plan.decision, 'SKIP_SOURCE', `${prior} must not loop the customer back`);
  }
});

test('a completed handoff is never re-offered', () => {
  const plan = decideHandoff({
    sourceKey: 'enforcement.debtors', status: 'BLOCKED',
    networkRefusal: true, available: inputs, priorAttempt: 'COMPLETED',
  });
  assert.equal(plan.decision, 'SKIP_SOURCE');
});

/* ---------------------------------------------------------------- *
 * The matrix itself                                                 *
 * ---------------------------------------------------------------- */

test('capability and handoff-capability agree for every source in the matrix', () => {
  for (const s of feasibilityMatrix()) {
    const expected = s.capability === 'PUBLIC_LOOKUP' || s.capability === 'REPEATABLE_WITH_INPUTS';
    assert.equal(isHandoffCapable(s.key), expected, `${s.key} disagrees with its capability`);
  }
});

test('every source in the matrix documents its reasoning', () => {
  for (const s of feasibilityMatrix()) {
    assert.ok(s.note && s.note.length > 40, `${s.key} has no real justification`);
    assert.ok(Array.isArray(s.requiredInputs));
  }
});

test('only a source whose artifact (not session) was missing may claim serverCanContinue', () => {
  for (const s of feasibilityMatrix()) {
    if (s.serverCanContinue) {
      assert.equal(s.kind, 'FETCH_AND_RETURN', `${s.key} claims server continuation without a fetchable artifact`);
    }
  }
});

test('a source needing no human verification is skipped, not handed off', () => {
  const plan = decideHandoff({
    sourceKey: 'napr.registry', status: 'SUCCESS',
    networkRefusal: false, available: inputs,
  });
  assert.equal(plan.decision, 'SKIP_SOURCE');
  assert.match(plan.reason, /no human verification needed/);
});
